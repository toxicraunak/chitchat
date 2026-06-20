require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Message, Profile, StickerPack, Sticker, Settings } = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 30e6,
  pingTimeout: 60000,
  pingInterval: 25000
});

// ── MONGODB — URI strictly from .env ──
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI not found in .env file! Please create a .env file with MONGO_URI=your_connection_string');
  process.exit(1);
}
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => { console.error('❌ MongoDB Error:', err.message); process.exit(1); });

app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const memStorage = multer.memoryStorage();
const upload = multer({ storage: memStorage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB for videos

const tmpStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'tmp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
});
const diskUpload = multer({ storage: tmpStorage, limits: { fileSize: 100 * 1024 * 1024 } });

function telegramSend(botToken, chatId, text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, text });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
    });
    req.on('error', err => { console.error('TG req error:', err.message); resolve({}); });
    req.write(body); req.end();
  });
}

function bufToDataUri(buf, mime) {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ── PAGES ──
app.get('/', (req, res) => res.render('index'));

app.get('/chat/:user', async (req, res) => {
  const user = req.params.user;
  if (!['tanji', 'hinata'].includes(user)) return res.redirect('/');
  const profile = await Profile.findOne({ user }).lean() || { user, avatar: '' };
  const otherUser = user === 'tanji' ? 'hinata' : 'tanji';
  const otherProfile = await Profile.findOne({ user: otherUser }).lean() || { user: otherUser, avatar: '' };
  res.render('chat', { user, profile, otherProfile });
});

app.get('/admin', async (req, res) => {
  // Only fetch pack metadata + count — NOT the heavy sticker data
  const packs = await StickerPack.find().sort({ createdAt: -1 }).lean();
  const botToken = (await Settings.findOne({ key: 'botToken' }).lean())?.value || '';
  const chatId = (await Settings.findOne({ key: 'chatId' }).lean())?.value || '';
  const bgImages = await Settings.find({ key: /^bgImage_/ }).lean();
  res.render('admin', { packs, botToken, chatId, bgImages });
});

// ── API: MESSAGES — PAGINATED (20 per page, newest first then reversed) ──
app.get('/api/messages', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const before = req.query.before; // ISO date string — fetch messages BEFORE this timestamp

    const query = before ? { createdAt: { $lt: new Date(before) } } : {};

    // Fetch newest-first (for "before" pagination), then reverse to chronological order
    const msgs = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    msgs.reverse(); // oldest → newest for correct rendering order

    // Check if there are more (older) messages beyond this batch
    let hasMore = false;
    if (msgs.length > 0) {
      const oldestInBatch = msgs[0].createdAt;
      const olderCount = await Message.countDocuments({ createdAt: { $lt: oldestInBatch } });
      hasMore = olderCount > 0;
    }

    res.json({ ok: true, msgs, hasMore });
  } catch (e) {
    console.error('GET /api/messages error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/profile/:user', async (req, res) => {
  const p = await Profile.findOne({ user: req.params.user }).lean() || { avatar: '' };
  res.json(p);
});

app.post('/api/avatar/:user', upload.single('avatar'), async (req, res) => {
  try {
    const { user } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const dataUri = bufToDataUri(req.file.buffer, req.file.mimetype);
    await Profile.findOneAndUpdate({ user }, { avatar: dataUri, updatedAt: new Date() }, { upsert: true });
    io.emit('avatarUpdate', { user, avatar: dataUri });
    res.json({ ok: true, avatar: dataUri });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const isImage = req.file.mimetype.startsWith('image/');
    const isVideo = req.file.mimetype.startsWith('video/');
    if (isImage) {
      const dataUri = bufToDataUri(req.file.buffer, req.file.mimetype);
      res.json({ ok: true, dataUri, name: req.file.originalname, size: req.file.size, isImage: true });
    } else {
      // Videos and other files go to disk (too large for base64/mongo)
      const dir = path.join(__dirname, 'public/uploads');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fname = Date.now() + '_' + req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      fs.writeFileSync(path.join(dir, fname), req.file.buffer);
      res.json({
        ok: true,
        url: '/uploads/' + fname,
        name: req.file.originalname,
        size: req.file.size,
        isImage: false,
        isVideo,
        mime: req.file.mimetype
      });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: STICKER PACKS — LAZY LOADING ──
// 1) Lightweight: pack list with icon only (NOT sticker data)
app.get('/api/sticker-packs', async (req, res) => {
  try {
    const packs = await StickerPack.find().sort({ createdAt: -1 }).lean();
    res.json(packs.map(p => ({
      _id: p._id, title: p.title, author: p.author, icon: p.icon, stickerCount: p.stickerCount || 0
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2) Heavy: stickers for ONE pack — fetched only when user opens that pack tab
app.get('/api/sticker-packs/:packId/stickers', async (req, res) => {
  try {
    const stickers = await Sticker.find({ packId: req.params.packId }).sort({ index: 1 }).lean();
    res.json(stickers.map(s => ({ _id: s._id, data: s.data, name: s.name })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bg-images', async (req, res) => {
  const bgs = await Settings.find({ key: /^bgImage_/ }).lean();
  res.json(bgs.map(b => ({ id: b.key.replace('bgImage_', ''), data: b.value })));
});

app.post('/api/messages/read', async (req, res) => {
  const { by } = req.body;
  const other = by === 'tanji' ? 'hinata' : 'tanji';
  await Message.updateMany({ sender: other, read: false }, { read: true });
  io.to('chat').emit('messagesRead', { by });
  res.json({ ok: true });
});

// ── ADMIN ──
app.post('/admin/bg-upload', upload.single('bgimage'), async (req, res) => {
  try {
    if (!req.file) return res.redirect('/admin?error=No file');
    if (!req.file.mimetype.startsWith('image/')) return res.redirect('/admin?error=Image only');
    const dataUri = bufToDataUri(req.file.buffer, req.file.mimetype);
    const id = Date.now().toString();
    await Settings.findOneAndUpdate({ key: 'bgImage_' + id }, { value: dataUri }, { upsert: true });
    res.redirect('/admin?success=Background added!');
  } catch (e) { res.redirect('/admin?error=' + encodeURIComponent(e.message)); }
});

app.post('/admin/bg-delete/:id', async (req, res) => {
  await Settings.deleteOne({ key: 'bgImage_' + req.params.id });
  res.redirect('/admin?success=Background deleted');
});

app.post('/admin/upload-pack', diskUpload.single('wastickers'), async (req, res) => {
  const tmpFile = req.file?.path;
  try {
    if (!req.file) return res.redirect('/admin?error=No file uploaded');
    const buf = fs.readFileSync(tmpFile);
    const entries = parseZip(buf);
    if (!entries || entries.length === 0) return res.redirect('/admin?error=ZIP empty or unreadable');

    let title = req.file.originalname.replace(/\.(wastickers|zip)$/i, '') || 'Sticker Pack';
    let author = '';
    let iconData = '';

    const titleEntry = entries.find(e => e.name.toLowerCase() === 'title.txt');
    const authorEntry = entries.find(e => e.name.toLowerCase() === 'author.txt');
    const iconEntry = entries.find(e => /^(tray|icon|tray_icon)\.(png|webp|jpg|jpeg)$/i.test(e.name));

    if (titleEntry) { const t = titleEntry.data.toString('utf8').trim(); if (t) title = t; }
    if (authorEntry) author = authorEntry.data.toString('utf8').trim();
    if (iconEntry) {
      const mime = /\.webp$/i.test(iconEntry.name) ? 'image/webp' : 'image/png';
      iconData = bufToDataUri(iconEntry.data, mime);
    }

    const stickerEntries = entries
      .filter(e => /\.(webp|png|gif)$/i.test(e.name) && !/^(tray|icon|tray_icon)\./i.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const pack = await StickerPack.create({ title, author, icon: iconData, stickerCount: stickerEntries.length });

    let idx = 0;
    for (const entry of stickerEntries) {
      const mime = /\.gif$/i.test(entry.name) ? 'image/gif' : /\.png$/i.test(entry.name) ? 'image/png' : 'image/webp';
      await Sticker.create({ packId: pack._id, data: bufToDataUri(entry.data, mime), index: idx++, name: entry.name });
    }

    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    res.redirect('/admin?success=' + encodeURIComponent(`"${title}" — ${idx} stickers added!`));
  } catch (e) {
    console.error('Pack upload error:', e);
    if (tmpFile && fs.existsSync(tmpFile)) try { fs.unlinkSync(tmpFile); } catch(_) {}
    res.redirect('/admin?error=' + encodeURIComponent(e.message));
  }
});

app.post('/admin/pack/delete/:id', async (req, res) => {
  try {
    await Sticker.deleteMany({ packId: req.params.id });
    await StickerPack.findByIdAndDelete(req.params.id);
    res.redirect('/admin?success=Pack deleted');
  } catch (e) { res.redirect('/admin?error=' + encodeURIComponent(e.message)); }
});

app.post('/admin/settings', async (req, res) => {
  try {
    await Settings.findOneAndUpdate({ key: 'botToken' }, { value: req.body.botToken || '' }, { upsert: true });
    await Settings.findOneAndUpdate({ key: 'chatId' }, { value: req.body.chatId || '' }, { upsert: true });
    res.redirect('/admin?success=Settings saved');
  } catch (e) { res.redirect('/admin?error=' + encodeURIComponent(e.message)); }
});

// ── ZIP PARSER (native, no npm dependency) ──
function parseZip(buf) {
  const entries = [];
  try {
    let i = 0;
    while (i < buf.length - 4) {
      if (buf[i]===0x50 && buf[i+1]===0x4b && buf[i+2]===0x03 && buf[i+3]===0x04) {
        const compression = buf.readUInt16LE(i + 8);
        const compSize    = buf.readUInt32LE(i + 18);
        const nameLen     = buf.readUInt16LE(i + 26);
        const extraLen    = buf.readUInt16LE(i + 28);
        const name        = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
        const dataStart   = i + 30 + nameLen + extraLen;
        const compData    = buf.slice(dataStart, dataStart + compSize);
        if (!name.endsWith('/') && compSize > 0) {
          let data = compData;
          if (compression === 8) {
            try { data = require('zlib').inflateRawSync(compData); } catch(_) { data = compData; }
          }
          const shortName = name.split('/').pop();
          if (shortName) entries.push({ name: shortName, data });
        }
        i = dataStart + compSize;
      } else { i++; }
    }
  } catch(e) { console.error('ZIP parse error:', e.message); }
  return entries;
}

// ── SOCKET.IO — real-time events only (messages history via REST) ──
const online = {};

io.on('connection', socket => {
  socket.on('join', async user => {
    if (!['tanji','hinata'].includes(user)) return;
    socket.user = user;
    online[user] = true;
    socket.join('chat');
    io.to('chat').emit('onlineStatus', online);

    const other = user === 'tanji' ? 'hinata' : 'tanji';
    await Message.updateMany({ sender: other, read: false }, { read: true });
    io.to('chat').emit('messagesRead', { by: user });
  });

  socket.on('sendMessage', async data => {
    try {
      const msg = await Message.create({
        sender:     data.sender,
        type:       data.type     || 'text',
        content:    data.content  || '',
        fileData:   data.fileData || '',
        fileUrl:    data.fileUrl  || '',
        fileName:   data.fileName || '',
        fileSize:   data.fileSize || 0,
        fileMime:   data.fileMime || '',
        stickerId:  data.stickerId  || null,
        stickerUrl: data.stickerUrl || '',
        replyTo:    data.replyTo || { id: null, sender: '', content: '', type: 'text', stickerUrl: '' },
        reactions: []
      });
      io.to('chat').emit('newMessage', msg.toObject());
    } catch (e) { console.error('sendMessage error:', e.message); }
  });

  socket.on('addReaction', async ({ msgId, emoji, user }) => {
    try {
      const msg = await Message.findById(msgId);
      if (!msg) return;
      msg.reactions = msg.reactions.filter(r => r.by !== user);
      if (emoji) msg.reactions.push({ emoji, by: user });
      await msg.save();
      io.to('chat').emit('reactionUpdate', { msgId, reactions: msg.reactions });
    } catch (e) { console.error('reaction error:', e.message); }
  });

  // Edit a text message — only original sender can edit, only text messages
  socket.on('editMessage', async ({ msgId, newContent, user }) => {
    try {
      const msg = await Message.findById(msgId);
      if (!msg) return;
      if (msg.sender !== user) return; // only sender can edit their own message
      if (msg.type !== 'text') return; // only text messages are editable
      if (msg.deleted) return;
      const trimmed = (newContent || '').trim();
      if (!trimmed) return;
      msg.content = trimmed;
      msg.edited = true;
      await msg.save();
      io.to('chat').emit('messageEdited', { msgId, content: msg.content, edited: true });
    } catch (e) { console.error('editMessage error:', e.message); }
  });

  // Delete a message — only original sender can delete
  socket.on('deleteMessage', async ({ msgId, user }) => {
    try {
      const msg = await Message.findById(msgId);
      if (!msg) return;
      if (msg.sender !== user) return; // only sender can delete their own message
      msg.deleted = true;
      msg.content = '';
      msg.fileData = '';
      msg.fileUrl = '';
      msg.stickerUrl = '';
      msg.reactions = [];
      await msg.save();
      io.to('chat').emit('messageDeleted', { msgId });
    } catch (e) { console.error('deleteMessage error:', e.message); }
  });

  socket.on('typing',     data => socket.to('chat').emit('typing', data));
  socket.on('stopTyping', data => socket.to('chat').emit('stopTyping', data));

  socket.on('callOnline', async () => {
    try {
      const botToken = (await Settings.findOne({ key: 'botToken' }).lean())?.value;
      const chatId   = (await Settings.findOne({ key: 'chatId'   }).lean())?.value;
      if (botToken && chatId) await telegramSend(botToken, chatId, '🟢 Online');
    } catch (e) { console.error('Telegram error:', e.message); }
  });

  socket.on('disconnect', () => {
    if (socket.user) {
      delete online[socket.user];
      io.to('chat').emit('onlineStatus', online);
    }
  });
});

// ── ERROR HANDLER (e.g. multer file-too-large) ──
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 100MB)' });
  }
  if (err) {
    console.error('Unhandled error:', err.message);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
  next();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 TanjiChat running → http://localhost:${PORT}`));
