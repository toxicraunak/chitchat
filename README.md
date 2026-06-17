# TanjiChat 💬

A private 2-person Telegram-style chat between Tanji and Hinata.

## Features
- 📱 Full mobile-optimized Telegram-style UI
- 💬 Real-time chat via Socket.io
- 🖼️ Send images, files, stickers
- 👆 Swipe to reply (just like Telegram)
- 😊 Sticker panel with admin-uploaded stickers
- 📞 Voice call button → sends Telegram notification
- 👤 Custom profile picture for each user
- 💾 All data stored in MongoDB

## Deployment on Render

1. Push this project to a GitHub repo
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` and sets everything up
5. Click Deploy!

## Pages
- `/` → Gender select (Tanji / Hinata)
- `/chat/tanji` → Tanji's chat
- `/chat/hinata` → Hinata's chat  
- `/admin` → Admin panel (add stickers, set Telegram bot)

## Admin Panel
- Add sticker image/GIF URLs
- Set Telegram Bot Token + Chat ID for call notifications
