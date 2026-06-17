const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Message, Profile, Sticker, Settings } = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://factotask:Vaibhav0503V@cluster0.wmm2alz.mongodb.net/tgchat';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public/uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Native HTTPS post for Telegram
function telegramSend(botToken, chatId, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: chatId, text });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── ROUTES ──

app.get('/', (req, res) => res.render('index'));

app.get('/chat/:user', async (req, res) => {
  const user = req.params.user;
  if (!['tanji', 'hinata'].includes(user)) return res.redirect('/');
  const profile = await Profile.findOne({ user }) || { user, avatar: '' };
  const otherUser = user === 'tanji' ? 'hinata' : 'tanji';
  const otherProfile = await Profile.findOne({ user: otherUser }) || { user: otherUser, avatar: '' };
  res.render('chat', { user, profile, otherProfile });
});

app.get('/admin', async (req, res) => {
  const stickers = await Sticker.find().sort({ createdAt: -1 });
  const botToken = (await Settings.findOne({ key: 'botToken' }))?.value || '';
  const chatId = (await Settings.findOne({ key: 'chatId' }))?.value || '';
  res.render('admin', { stickers, botToken, chatId });
});

// ── API ──

app.get('/api/messages', async (req, res) => {
  try { res.json(await Message.find().sort({ createdAt: 1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/avatar/:user', upload.single('avatar'), async (req, res) => {
  try {
    const { user } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const avatarUrl = '/uploads/' + req.file.filename;
    await Profile.findOneAndUpdate({ user }, { avatar: avatarUrl, updatedAt: new Date() }, { upsert: true });
    io.emit('avatarUpdate', { user, avatar: avatarUrl });
    res.json({ avatar: avatarUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    res.json({
      url: '/uploads/' + req.file.filename,
      name: req.file.originalname,
      size: req.file.size,
      isImage: req.file.mimetype.startsWith('image/')
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stickers', async (req, res) => {
  res.json(await Sticker.find().sort({ createdAt: -1 }));
});

app.get('/api/profile/:user', async (req, res) => {
  const p = await Profile.findOne({ user: req.params.user }) || { user: req.params.user, avatar: '' };
  res.json(p);
});

// Admin
app.post('/admin/sticker', async (req, res) => {
  try {
    const { url, name } = req.body;
    if (!url) return res.redirect('/admin?error=No URL provided');
    const isGif = url.toLowerCase().includes('.gif') || url.toLowerCase().includes('giphy') || url.toLowerCase().includes('tenor');
    await Sticker.create({ url, name: name || 'Sticker', type: isGif ? 'gif' : 'image' });
    res.redirect('/admin?success=Sticker added successfully');
  } catch (e) { res.redirect('/admin?error=' + encodeURIComponent(e.message)); }
});

app.post('/admin/sticker/delete/:id', async (req, res) => {
  await Sticker.findByIdAndDelete(req.params.id);
  res.redirect('/admin?success=Sticker deleted');
});

app.post('/admin/settings', async (req, res) => {
  try {
    const { botToken, chatId } = req.body;
    await Settings.findOneAndUpdate({ key: 'botToken' }, { value: botToken || '' }, { upsert: true });
    await Settings.findOneAndUpdate({ key: 'chatId' }, { value: chatId || '' }, { upsert: true });
    res.redirect('/admin?success=Settings saved');
  } catch (e) { res.redirect('/admin?error=' + encodeURIComponent(e.message)); }
});

// ── SOCKET.IO ──
const online = {};

io.on('connection', socket => {
  socket.on('join', async user => {
    socket.user = user;
    online[user] = true;
    socket.join('chat');
    io.to('chat').emit('onlineStatus', online);
    const msgs = await Message.find().sort({ createdAt: 1 }).limit(500);
    socket.emit('history', msgs);
    const other = user === 'tanji' ? 'hinata' : 'tanji';
    await Message.updateMany({ sender: other, read: false }, { read: true });
    io.to('chat').emit('messagesRead', { by: user });
  });

  socket.on('sendMessage', async data => {
    try {
      const msg = await Message.create({
        sender: data.sender,
        type: data.type || 'text',
        content: data.content || '',
        fileUrl: data.fileUrl || '',
        fileName: data.fileName || '',
        fileSize: data.fileSize || 0,
        stickerUrl: data.stickerUrl || '',
        replyTo: data.replyTo || { id: null, sender: '', content: '', type: 'text', stickerUrl: '' }
      });
      io.to('chat').emit('newMessage', msg);
    } catch (e) { console.error('sendMessage error:', e); }
  });

  socket.on('typing', data => socket.to('chat').emit('typing', data));
  socket.on('stopTyping', data => socket.to('chat').emit('stopTyping', data));

  socket.on('callOnline', async data => {
    try {
      const botToken = (await Settings.findOne({ key: 'botToken' }))?.value;
      const chatId = (await Settings.findOne({ key: 'chatId' }))?.value;
      if (botToken && chatId) {
        await telegramSend(botToken, chatId, '🟢 Online');
      }
    } catch (e) { console.error('Telegram error:', e.message); }
  });

  socket.on('disconnect', () => {
    if (socket.user) { delete online[socket.user]; io.to('chat').emit('onlineStatus', online); }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
