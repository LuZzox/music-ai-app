Music App Backend

This is the backend of a music app built using Node.js with Express and SQLite.
The app allows users to add, retrieve, play, and stop MP3 files.

Features:
- Add MP3 file to database
- Retrieve list of all MP3 files
- Play current MP3 file
- Stop playback

Installation:
1. Clone this repository
2. Run command npm install to install required packages
3. Start the server using command npm start

Usage:
1. Open http://localhost:3000 in your browser to access the front end.
2. Use the interface to upload a music file, view saved tracks, and play music directly.

Mobile usage:
1. Make sure your phone is on the same Wi-Fi network as this computer.
2. Find your computer's local IP address (for example, 192.168.1.100).
3. Open your phone browser and go to http://<your-computer-ip>:3000.
4. Upload and play music from your phone using the same interface.

Cloud deployment:
1. Deploy the backend to a remote host so the app works when your computer is off.
2. Render is a good choice for simple deployments; use `render.yaml` already included in this repo.
3. Another simple option is Railway or Heroku.

Render deployment steps:
1. Push your project to GitHub.
2. Create a new Web Service on Render and connect your GitHub repo.
3. Set the root directory to the repository root.
4. Use `npm install` as the build command and `npm start` as the start command.
5. After deploy, copy the public URL and enter it into the app's Backend URL field.

Railway deployment steps:
1. Create a new project on Railway and connect your GitHub repo.
2. Set the start command to `npm start`.
3. Deploy the service and use the generated domain as the backend URL.

Important:
- The Android wrapper will load the front-end UI from the app bundle.
- The backend must be deployed on a reachable server and the backend URL configured in the app.
- With a remote backend, your phone app works even when your computer is off.

Important:
- The Android wrapper will load the front-end UI from the app bundle.
- The backend must be deployed on a server and the backend URL configured in the app.

API Endpoints:
1. Upload an MP3 file: POST /upload
   Use a multipart/form-data request with field name "music".
2. Get saved tracks: GET /mp3_files
3. Get a track playback URL: GET /play/:id
4. Stop playback: GET /stop