const mongoose = require('mongoose');

// Message Schema — fileData as base64 for images
const messageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['tanji', 'hinata'], required: true },
  type: { type: String, enum: ['text', 'image', 'file', 'sticker'], default: 'text' },
  content: { type: String, default: '' },
  fileData: { type: String, default: '' },   // base64 data URI (images only)
  fileUrl: { type: String, default: '' },    // files on disk
  fileName: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },
  fileMime: { type: String, default: '' },
  stickerId: { type: mongoose.Schema.Types.ObjectId, default: null },
  stickerUrl: { type: String, default: '' }, // base64 data URI
  replyTo: {
    id: { type: mongoose.Schema.Types.ObjectId, default: null },
    sender: { type: String, default: '' },
    content: { type: String, default: '' },
    type: { type: String, default: 'text' },
    stickerUrl: { type: String, default: '' }
  },
  reactions: [{ emoji: String, by: String }],
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
// Index for fast pagination queries
messageSchema.index({ createdAt: -1 });

// User Profile — avatar as base64
const profileSchema = new mongoose.Schema({
  user: { type: String, enum: ['tanji', 'hinata'], unique: true },
  avatar: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});

// Sticker Pack — metadata only (icon is small, loads with pack list)
const stickerPackSchema = new mongoose.Schema({
  title: { type: String, default: 'Sticker Pack' },
  author: { type: String, default: '' },
  icon: { type: String, default: '' },  // base64 data URI of pack icon (small)
  stickerCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Individual Sticker — heavy base64 data, only loaded when pack opened
const stickerSchema = new mongoose.Schema({
  packId: { type: mongoose.Schema.Types.ObjectId, ref: 'StickerPack', required: true, index: true },
  data: { type: String, required: true },
  index: { type: Number, default: 0 },
  name: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: { type: String, default: '' }
});

const Message = mongoose.model('Message', messageSchema);
const Profile = mongoose.model('Profile', profileSchema);
const StickerPack = mongoose.model('StickerPack', stickerPackSchema);
const Sticker = mongoose.model('Sticker', stickerSchema);
const Settings = mongoose.model('Settings', settingsSchema);

module.exports = { Message, Profile, StickerPack, Sticker, Settings };
