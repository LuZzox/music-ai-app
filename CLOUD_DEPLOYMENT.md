# Cloud Deployment Guide

## Option 1: Raspberry Pi (Home Server - Recommended)

Hosting on a Pi is the most stable free method.

1. **Install Node.js**: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs`
2. **Transfer Files**: Use Git or SCP to move your project to `/home/pi/music-ai-app`.
3. **Setup Environment**:
   - Create a `.env` file on the Pi.
   - Add `MONGODB_URI` and `SESSION_SECRET`.
4. **Install & Run**: 
   - `npm install`
   - `sudo npm install -g pm2`
   - `pm2 start index.js --name musica` (This keeps the app running forever).
5. **Expose to Internet**:
   - Use **Cloudflare Tunnel** (cloudflared) for a permanent, secure URL.

## Option 2: Local Tunnel (PC)

If you don't want to pay for a server, you can host it on your own PC and make it public:

1. **Start your server**: Run `npm start`.
2. **Install Localtunnel**: Open a new terminal and run `npm install -g localtunnel`.
3. **Start the tunnel**: Run `lt --port 3000 --subdomain your-unique-name`.
4. **Update App**: Put `https://your-unique-name.loca.lt` into your app's Backend URL.

*Note: Your PC must be on for the app to work.*

## Option 2: Render.com

1. **Push to GitHub**: Commit and push your code.
2. **Create Web Service**: Connect your repo.
3. **Limits**: Free, but "sleeps" after 15 minutes and is slow to wake up.
2. **Create New Project**: Connect your GitHub repository
3. **Set Start Command**: `npm start`
4. **Add Environment Variable**: `SESSION_SECRET=your-random-string`
5. **Deploy**

## Option 3: Heroku

1. **Install Heroku CLI**: `npm install -g heroku`
2. **Login**: `heroku login`
3. **Create App**: `heroku create your-app-name`
4. **Set Environment**: `heroku config:set SESSION_SECRET=your-random-string`
5. **Deploy**: `git push heroku main`

## Important Notes

- SQLite database (`music.db`) will be created automatically in the cloud
- **Data Persistence**: In free cloud tiers, your database and uploaded files may be lost on redeployment. For production use, consider upgrading to a paid plan with persistent storage, or switch to a cloud database like PostgreSQL.
- Your uploaded music files will be stored in the database
- The app will work 24/7 once deployed
- Free tiers have usage limits - monitor your usage

## Testing Deployment

After deployment, update your mobile app's backend URL to point to the cloud service instead of `http://localhost:3000`.