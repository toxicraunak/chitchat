const mongoose = require('mongoose');

// Message Schema — fileData as base64 for images
const messageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['tanji', 'hinata'], required: true },
  type: { type: String, enum: ['text', 'image', 'file', 'sticker'], default: 'text' },
  content: { type: String, default: '' },
  // For images: store base64 data URI directly in mongo
  fileData: { type: String, default: '' },   // base64 data URI (images only)
  fileUrl: { type: String, default: '' },    // fallback / files
  fileName: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },
  fileMime: { type: String, default: '' },
  // Sticker references pack+index
  stickerId: { type: mongoose.Schema.Types.ObjectId, default: null },
  stickerUrl: { type: String, default: '' }, // base64 data URI
  replyTo: {
    id: { type: mongoose.Schema.Types.ObjectId, default: null },
    sender: { type: String, default: '' },
    content: { type: String, default: '' },
    type: { type: String, default: 'text' },
    stickerUrl: { type: String, default: '' }
  },
  reactions: [{
    emoji: String,
    by: String  // 'tanji' or 'hinata'
  }],
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// User Profile Schema — avatar as base64
const profileSchema = new mongoose.Schema({
  user: { type: String, enum: ['tanji', 'hinata'], unique: true },
  avatar: { type: String, default: '' },  // base64 data URI
  updatedAt: { type: Date, default: Date.now }
});

// Sticker Pack Schema — each pack from .wastickers file
const stickerPackSchema = new mongoose.Schema({
  title: { type: String, default: 'Sticker Pack' },
  author: { type: String, default: '' },
  icon: { type: String, default: '' },  // base64 data URI of pack icon
  createdAt: { type: Date, default: Date.now }
});

// Individual Sticker — linked to a pack
const stickerSchema = new mongoose.Schema({
  packId: { type: mongoose.Schema.Types.ObjectId, ref: 'StickerPack', required: true },
  data: { type: String, required: true },  // base64 data URI (webp/png/gif)
  index: { type: Number, default: 0 },
  name: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

// Settings
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
