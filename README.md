# TanjiChat 💬

Private 2-person Telegram-style chat between Tanji and Hinata — fully optimized.

## ⚡ Setup (IMPORTANT — MongoDB URL ke liye)

1. Project folder me `.env` naam ki file banao (`.env.example` ko copy karke):
   ```
   cp .env.example .env
   ```
2. `.env` file kholo aur apna MongoDB connection string daalo:
   ```
   MONGO_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/tgchat
   PORT=3000
   ```
3. **`.env` file kabhi GitHub pe push mat karo** — `.gitignore` me already excluded hai.

## 🚀 Local run

```bash
npm install
npm start
```
Browser me kholo: `http://localhost:3000`

## 🌐 Render Deployment

1. GitHub repo banao, push karo (`.env` push NAHI hoga — sahi hai)
2. [render.com](https://render.com) → New Web Service → repo connect karo
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. **Environment → Add Environment Variable**:
   - Key: `MONGO_URI`
   - Value: apna MongoDB connection string
6. Deploy!

## ✨ Features

- 📱 Full mobile-optimized Telegram-style UI
- 💬 Real-time chat via Socket.io
- 🖼️ Images/DP MongoDB me base64 format me save (Render restart pe delete nahi hote)
- 👆 Swipe to reply
- 👍 Long-press → 45+ emoji reactions (❤️🔥😂🥰 etc.)
- 🎨 8 solid color themes + custom background images (admin se upload)
- 😊 WhatsApp `.wastickers` pack upload — pura pack ek click me add
- ⚡ **Optimized loading**: sirf 20 messages initial load, scroll-up pe purane aur load hote hain
- ⚡ **Lazy sticker loading**: sticker pack ka data tabhi load hota hai jab uska tab open karo
- 📞 Voice call button → Telegram bot ko "Online" message bhejta hai

## 📂 Pages

- `/` → Gender select (Tanji / Hinata)
- `/chat/tanji` → Tanji's chat
- `/chat/hinata` → Hinata's chat
- `/admin` → Admin panel (stickers, backgrounds, Telegram bot settings)

## ⚙️ Admin Panel

- **Telegram Settings** — Bot Token + Chat ID (call button ke liye)
- **Chat Backgrounds** — image upload karo, dono users select kar sakte hain
- **Sticker Packs** — `.wastickers` file upload, pura pack ek baar me add

## 🔧 Performance Notes

- Messages REST API se load hote hain (`/api/messages?limit=20&before=...`), socket sirf real-time updates ke liye
- Sticker packs: list (icons) light load hota hai, actual stickers (base64) tab tak load nahi hote jab tak tab open na karo
- Scroll top ke 80px ke andar aate hi automatically purane 20 messages aur load ho jaate hain
