const mongoose = require('mongoose');

// Message Schema
const messageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['tanji', 'hinata'], required: true },
  type: { type: String, enum: ['text', 'image', 'file', 'sticker'], default: 'text' },
  content: { type: String, default: '' },
  fileUrl: { type: String, default: '' },
  fileName: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },
  stickerUrl: { type: String, default: '' },
  replyTo: {
    id: { type: mongoose.Schema.Types.ObjectId, default: null },
    sender: { type: String, default: '' },
    content: { type: String, default: '' },
    type: { type: String, default: 'text' },
    stickerUrl: { type: String, default: '' }
  },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// User Profile Schema
const profileSchema = new mongoose.Schema({
  user: { type: String, enum: ['tanji', 'hinata'], unique: true },
  avatar: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});

// Sticker Schema
const stickerSchema = new mongoose.Schema({
  url: { type: String, required: true },
  name: { type: String, default: '' },
  type: { type: String, enum: ['image', 'gif'], default: 'image' },
  createdAt: { type: Date, default: Date.now }
});

// Settings Schema (admin)
const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: { type: String, default: '' }
});

const Message = mongoose.model('Message', messageSchema);
const Profile = mongoose.model('Profile', profileSchema);
const Sticker = mongoose.model('Sticker', stickerSchema);
const Settings = mongoose.model('Settings', settingsSchema);

module.exports = { Message, Profile, Sticker, Settings };
