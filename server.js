// Load environment variables first
require('dotenv').config();

const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Import Models
const { Message, Profile, StickerPack, Sticker, Settings } = require('./models');

const app = express();

// Create HTTP server
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 20e6, // 20MB for base64
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ── MongoDB Connection ──
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('❌ MONGO_URI is not defined in environment variables');
    console.error('Please set MONGO_URI in .env file or environment variables');
    process.exit(1);
}

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB Connected Successfully'))
.catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
});

// ── Middleware ──
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── View Engine Setup ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Multer Configuration ──
// Memory storage for file uploads (convert to base64)
const memStorage = multer.memoryStorage();
const upload = multer({ 
    storage: memStorage, 
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Disk storage for .wastickers upload (zip)
const tmpStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'tmp');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '_' + file.originalname);
    }
});

const diskUpload = multer({ 
    storage: tmpStorage, 
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// ── Helper Functions ──
function bufToDataUri(buf, mime) {
    return `data:${mime};base64,${buf.toString('base64')}`;
}

function telegramSend(botToken, chatId, text) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ chat_id: chatId, text });
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${botToken}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ ok: false, error: e.message });
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ── ZIP Parser (Native, no dependencies) ──
function parseZip(buf) {
    const entries = [];
    try {
        let i = 0;
        while (i < buf.length - 4) {
            // Local file header signature = 0x04034b50
            if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x03 && buf[i+3] === 0x04) {
                const compression = buf.readUInt16LE(i + 8);
                const compSize = buf.readUInt32LE(i + 18);
                const uncompSize = buf.readUInt32LE(i + 22);
                const nameLen = buf.readUInt16LE(i + 26);
                const extraLen = buf.readUInt16LE(i + 28);
                const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
                const dataStart = i + 30 + nameLen + extraLen;
                const compData = buf.slice(dataStart, dataStart + compSize);

                // Skip directories
                if (!name.endsWith('/') && compSize > 0) {
                    let data;
                    if (compression === 0) {
                        // Stored (no compression)
                        data = compData;
                    } else if (compression === 8) {
                        // Deflate
                        try {
                            const zlib = require('zlib');
                            data = zlib.inflateRawSync(compData);
                        } catch(e) {
                            data = compData; // fallback
                        }
                    } else {
                        data = compData;
                    }
                    // Only keep the filename (not path)
                    const shortName = name.split('/').pop();
                    if (shortName) entries.push({ name: shortName, data });
                }
                i = dataStart + compSize;
            } else {
                i++;
            }
        }
    } catch(e) {
        console.error('ZIP parse error:', e.message);
    }
    return entries;
}

// ── Routes ──

// Pages
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
    try {
        const packs = await StickerPack.find().sort({ createdAt: -1 });
        const packsWithCount = await Promise.all(packs.map(async p => {
            const count = await Sticker.countDocuments({ packId: p._id });
            return { ...p.toObject(), count };
        }));
        const botToken = (await Settings.findOne({ key: 'botToken' }))?.value || '';
        const chatId = (await Settings.findOne({ key: 'chatId' }))?.value || '';
        res.render('admin', { packs: packsWithCount, botToken, chatId });
    } catch (error) {
        console.error('Admin route error:', error);
        res.redirect('/?error=' + encodeURIComponent(error.message));
    }
});

// ── API Routes ──

// Get messages
app.get('/api/messages', async (req, res) => {
    try {
        const messages = await Message.find().sort({ createdAt: 1 });
        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: error.message });
    }
});

// Avatar upload
app.post('/api/avatar/:user', upload.single('avatar'), async (req, res) => {
    try {
        const { user } = req.params;
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const dataUri = bufToDataUri(req.file.buffer, req.file.mimetype);
        await Profile.findOneAndUpdate(
            { user }, 
            { avatar: dataUri, updatedAt: new Date() }, 
            { upsert: true }
        );
        
        io.emit('avatarUpdate', { user, avatar: dataUri });
        res.json({ avatar: dataUri });
    } catch (error) {
        console.error('Avatar upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// File/Image upload
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const isImage = req.file.mimetype.startsWith('image/');
        
        if (isImage) {
            const dataUri = bufToDataUri(req.file.buffer, req.file.mimetype);
            res.json({ 
                dataUri, 
                name: req.file.originalname, 
                size: req.file.size, 
                isImage: true 
            });
        } else {
            // For non-images, store on disk
            const dir = path.join(__dirname, 'public/uploads');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            
            const fname = Date.now() + '_' + req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
            const filePath = path.join(dir, fname);
            fs.writeFileSync(filePath, req.file.buffer);
            
            res.json({ 
                url: '/uploads/' + fname, 
                name: req.file.originalname, 
                size: req.file.size, 
                isImage: false 
            });
        }
    } catch (error) {
        console.error('File upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all sticker packs
app.get('/api/stickers', async (req, res) => {
    try {
        const packs = await StickerPack.find().sort({ createdAt: -1 });
        const result = await Promise.all(packs.map(async pack => {
            const stickers = await Sticker.find({ packId: pack._id }).sort({ index: 1 });
            return {
                _id: pack._id,
                title: pack.title,
                author: pack.author,
                icon: pack.icon,
                stickers: stickers.map(s => ({ 
                    _id: s._id, 
                    data: s.data, 
                    name: s.name 
                }))
            };
        }));
        res.json(result);
    } catch (error) {
        console.error('Error fetching stickers:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get user profile
app.get('/api/profile/:user', async (req, res) => {
    try {
        const profile = await Profile.findOne({ user: req.params.user }) || { 
            user: req.params.user, 
            avatar: '' 
        };
        res.json(profile);
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ error: error.message });
    }
});

// ── Admin Routes ──

// Upload sticker pack
app.post('/admin/upload-pack', diskUpload.single('wastickers'), async (req, res) => {
    const tmpFile = req.file?.path;
    try {
        if (!req.file) {
            return res.redirect('/admin?error=No file uploaded');
        }

        const buf = fs.readFileSync(tmpFile);
        const entries = parseZip(buf);

        if (!entries || entries.length === 0) {
            return res.redirect('/admin?error=Could not read ZIP file');
        }

        // Find pack metadata
        let title = 'Sticker Pack';
        let author = '';
        let iconData = '';

        const titleEntry = entries.find(e => e.name.toLowerCase() === 'title.txt');
        const authorEntry = entries.find(e => e.name.toLowerCase() === 'author.txt');
        const iconEntry = entries.find(e => 
            e.name.toLowerCase() === 'tray.png' || 
            e.name.toLowerCase() === 'icon.png' || 
            e.name.toLowerCase() === 'tray_icon.png'
        );

        if (titleEntry) title = titleEntry.data.toString('utf8').trim() || title;
        if (authorEntry) author = authorEntry.data.toString('utf8').trim();
        if (iconEntry) iconData = bufToDataUri(iconEntry.data, 'image/png');

        // Create pack
        const pack = await StickerPack.create({ title, author, icon: iconData });

        // Find all webp/png sticker files
        const stickerEntries = entries
            .filter(e => /\.(webp|png|gif)$/i.test(e.name) && !/icon|tray/i.test(e.name))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        let idx = 0;
        for (const entry of stickerEntries) {
            const mime = entry.name.endsWith('.gif') ? 'image/gif'
                : entry.name.endsWith('.png') ? 'image/png'
                : 'image/webp';
            const dataUri = bufToDataUri(entry.data, mime);
            await Sticker.create({ 
                packId: pack._id, 
                data: dataUri, 
                index: idx++, 
                name: entry.name 
            });
        }

        // Cleanup tmp file
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        
        res.redirect('/admin?success=' + encodeURIComponent(`Pack "${title}" added with ${idx} stickers!`));
    } catch (error) {
        console.error('Pack upload error:', error);
        if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        res.redirect('/admin?error=' + encodeURIComponent(error.message));
    }
});

// Delete sticker pack
app.post('/admin/pack/delete/:id', async (req, res) => {
    try {
        await Sticker.deleteMany({ packId: req.params.id });
        await StickerPack.findByIdAndDelete(req.params.id);
        res.redirect('/admin?success=Pack deleted');
    } catch (error) {
        console.error('Delete pack error:', error);
        res.redirect('/admin?error=' + encodeURIComponent(error.message));
    }
});

// Save Telegram settings
app.post('/admin/settings', async (req, res) => {
    try {
        const { botToken, chatId } = req.body;
        await Settings.findOneAndUpdate(
            { key: 'botToken' }, 
            { value: botToken || '' }, 
            { upsert: true }
        );
        await Settings.findOneAndUpdate(
            { key: 'chatId' }, 
            { value: chatId || '' }, 
            { upsert: true }
        );
        res.redirect('/admin?success=Settings saved');
    } catch (error) {
        console.error('Settings save error:', error);
        res.redirect('/admin?error=' + encodeURIComponent(error.message));
    }
});

// ── WebSocket (Socket.IO) ──
const online = {};

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('join', async (user) => {
        try {
            socket.user = user;
            online[user] = true;
            socket.join('chat');
            
            io.to('chat').emit('onlineStatus', online);
            
            const msgs = await Message.find().sort({ createdAt: 1 }).limit(500);
            socket.emit('history', msgs);
            
            const other = user === 'tanji' ? 'hinata' : 'tanji';
            await Message.updateMany(
                { sender: other, read: false }, 
                { read: true }
            );
            io.to('chat').emit('messagesRead', { by: user });
        } catch (error) {
            console.error('Join error:', error);
        }
    });

    socket.on('sendMessage', async (data) => {
        try {
            const msg = await Message.create({
                sender: data.sender,
                type: data.type || 'text',
                content: data.content || '',
                fileData: data.fileData || '',
                fileUrl: data.fileUrl || '',
                fileName: data.fileName || '',
                fileSize: data.fileSize || 0,
                fileMime: data.fileMime || '',
                stickerId: data.stickerId || null,
                stickerUrl: data.stickerUrl || '',
                replyTo: data.replyTo || { 
                    id: null, 
                    sender: '', 
                    content: '', 
                    type: 'text', 
                    stickerUrl: '' 
                },
                reactions: []
            });
            
            io.to('chat').emit('newMessage', msg);
        } catch (error) {
            console.error('Send message error:', error);
        }
    });

    socket.on('addReaction', async ({ msgId, emoji, user }) => {
        try {
            const msg = await Message.findById(msgId);
            if (!msg) return;
            
            // Remove existing reaction by this user
            msg.reactions = msg.reactions.filter(r => r.by !== user);
            if (emoji) msg.reactions.push({ emoji, by: user });
            
            await msg.save();
            io.to('chat').emit('reactionUpdate', { msgId, reactions: msg.reactions });
        } catch (error) {
            console.error('Reaction error:', error);
        }
    });

    socket.on('typing', (data) => {
        socket.to('chat').emit('typing', data);
    });

    socket.on('stopTyping', (data) => {
        socket.to('chat').emit('stopTyping', data);
    });

    socket.on('callOnline', async () => {
        try {
            const botToken = (await Settings.findOne({ key: 'botToken' }))?.value;
            const chatId = (await Settings.findOne({ key: 'chatId' }))?.value;
            if (botToken && chatId) {
                await telegramSend(botToken, chatId, '🟢 Online');
            }
        } catch (error) {
            console.error('Telegram error:', error.message);
        }
    });

    socket.on('disconnect', () => {
        if (socket.user) {
            delete online[socket.user];
            io.to('chat').emit('onlineStatus', online);
        }
        console.log('Client disconnected:', socket.id);
    });
});

// ── Start Server ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// ── Error Handlers ──
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        mongoose.connection.close(false, () => {
            console.log('MongoDB connection closed');
            process.exit(0);
        });
    });
});