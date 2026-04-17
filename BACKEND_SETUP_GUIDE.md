# 🔧 Fixing "Failed to Fetch" Login Error

## Problem
The app shows "failed to fetch" when trying to login. This means it can't connect to the backend.

## Root Cause
- ❌ Render backend has MongoDB connection issues
- ❌ Or your phone can't reach the Render URL
- ❌ Need to connect to your local backend instead

---

## ✅ QUICK FIX (3 minutes)

### Step 1: Start Local Backend Server
Double-click this file:
```
start-server.bat
```

You should see:
```
Server started on port 3000
✓ Connected to MongoDB
```

**Keep this window open!**

### Step 2: Configure Backend URL in App

On your Android phone:
1. Open **musica** app
2. Go to **Library** tab (top navigation)
3. Scroll down to "Backend URL" section
4. Enter your PC's IP address with port 3000:
   ```
   http://192.168.1.100:3000
   ```

### Step 3: Refresh App
- Close and reopen the app
- Try signing up or logging in again
- Should work! ✅

---

## 🔍 Finding Your PC's IP Address

**Windows Command Prompt:**
```
ipconfig
```

Look for: **IPv4 Address** (usually `192.168.1.x` or `10.0.0.x`)

**Example:**
```
IPv4 Address . . . . . . . . . . . . : 192.168.1.100
```

Then use: `http://192.168.1.100:3000` in the app

---

## ❓ Troubleshooting

### "Connection refused"
- ✅ Make sure `start-server.bat` is still running
- ✅ Check you used the correct IP address
- ✅ Make sure phone and PC are on same WiFi

### "Still not working"
1. Try using localhost first (on PC):
   - Open browser to: `http://localhost:3000/health`
   - Should return: `{"status":"ok"}`

2. Check MongoDB connection on PC:
   - Open server window
   - Look for: `✓ Connected to MongoDB`
   - If error, MongoDB might not be running

3. Check firewall:
   - Windows Firewall might block port 3000
   - Allow Node.js through firewall

### "No music shows up after login"
- ✅ This is normal! No one has uploaded music yet
- ✅ Upload a test MP3 file:
  1. Go to **Library** tab
  2. Click "Upload Track"
  3. Select an MP3 file
  4. Click Upload

---

## 📱 Alternative: Test on PC Browser

To test without Android device:
1. Start server: `start-server.bat`
2. Open browser: `http://localhost:3000`
3. Should see musica login screen
4. Test signup and upload

---

## 🔄 For Production (Render)

To fix the Render backend:

1. Go to `https://dashboard.render.com`
2. Select your "music-ai-app" service
3. Check "Environment" variables
4. Verify `MONGODB_URI` is set correctly
5. Click "Deploy" to redeploy

---

## ✅ Success Checklist

- ✓ `start-server.bat` is running
- ✓ Backend URL set in app to: `http://<YOUR_IP>:3000`
- ✓ Can login/signup
- ✓ Can upload music
- ✓ Can see uploaded tracks
- ✓ Can play music

**All working? Great! Enjoy musica! 🎵**

---

## 📞 Need More Help?

**Error Messages:**
- `ECONNREFUSED` → Backend server not running, start `start-server.bat`
- `ENOTFOUND` → Wrong IP address, use `ipconfig` to find it
- `MongooseServerSelectionError` → MongoDB not running on PC

**File locations:**
- Backend code: `C:\Users\sharl\Desktop\music-ai-app\index.js`
- Database: `C:\Users\sharl\Desktop\music-ai-app\music.db`
- Frontend code: `C:\Users\sharl\Desktop\music-ai-app\public\app.js`

**To stop server:**
- Press `CTRL+C` in the server window
- Then type `Y` and press Enter
