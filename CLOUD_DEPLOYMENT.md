# Cloud Deployment Guide

## Option 1: Render.com (Recommended)

1. **Push to GitHub**: Commit and push your code to a GitHub repository
2. **Create Render Account**: Go to [render.com](https://render.com) and sign up
3. **Create New Web Service**:
   - Connect your GitHub repository
   - Set root directory to repository root
   - Build Command: `npm install`
   - Start Command: `npm start`
4. **Environment Variables**:
   - `SESSION_SECRET`: Generate a random string (Render will auto-generate one)
5. **Deploy**: Click "Create Web Service"

Your app will be available at: `https://your-service-name.onrender.com`

## Option 2: Railway

1. **Create Railway Account**: Go to [railway.app](https://railway.app)
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