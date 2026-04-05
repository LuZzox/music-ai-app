const express = require('express');
const session = require('express-session');
const passport = require('passport');
const MongoStore = require('connect-mongo');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const multer = require('multer');
const mongoose = require('mongoose');
const crypto = require('crypto');
const app = express();

const storage = multer.memoryStorage();
const upload = multer({ storage });

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/musicify';

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log(`Connected to MongoDB: ${mongoUri}`);
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

const userSchema = new mongoose.Schema({
  googleId: { type: String, unique: true },
  displayName: String,
  email: String
}, { timestamps: true });

const mp3FileSchema = new mongoose.Schema({
  fileName: String,
  fileData: Buffer,
  fileHash: String,
  createdAt: { type: Date, default: Date.now },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});

const User = mongoose.model('User', userSchema);
const Mp3FileModel = mongoose.model('Mp3File', mp3FileSchema);

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: mongoUri, collectionName: 'sessions' }),
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static('public'));

class Mp3FileItem {
  constructor(id, fileName) {
    this.id = id;
    this.fileName = fileName;
  }
}

class Queue {
  constructor() {
    this.userQueues = new Map();
  }

  addMp3File(userId, mp3File) {
    const key = userId.toString();
    const queue = this.userQueues.get(key) || [];
    queue.push(mp3File);
    this.userQueues.set(key, queue);
    return queue;
  }

  getNextMp3File(userId) {
    const key = userId.toString();
    const queue = this.userQueues.get(key) || [];
    const next = queue.length > 0 ? queue.shift() : null;
    this.userQueues.set(key, queue);
    return next;
  }

  getQueue(userId) {
    return this.userQueues.get(userId.toString()) || [];
  }

  removeMp3File(userId, id) {
    const key = userId.toString();
    const queue = this.userQueues.get(key) || [];
    this.userQueues.set(key, queue.filter(item => item.id.toString() !== id.toString()));
  }
}

class Player {
  constructor() {
    this.currentMp3File = null;
    this.playing = false;
  }

  playMp3File(mp3File) {
    if (mp3File !== null) {
      this.currentMp3File = mp3File;
      this.playing = true;
    } else {
      console.error('No MP3 file to play');
    }
  }

  stopPlaying() {
    this.playing = false;
  }
}

const queue = new Queue();
const player = new Player();

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  User.findById(id, 'googleId displayName email', (err, user) => {
    done(err, user);
  });
});

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
}, (accessToken, refreshToken, profile, done) => {
  const googleId = profile.id;
  const displayName = profile.displayName || `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim();
  const email = profile.emails && profile.emails[0] && profile.emails[0].value;

  User.findOne({ googleId }, (err, user) => {
    if (err) return done(err);
    if (user) return done(null, user);

    const newUser = new User({ googleId, displayName, email });
    newUser.save((saveErr, savedUser) => {
      if (saveErr) return done(saveErr);
      done(null, savedUser);
    });
  });
}));

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Define MusicManager class to manage MP3 files
class MusicManager {
  constructor() {
    this.mp3Files = [];
  }

  addMp3File(mp3File) {
    return this.mp3Files.push(mp3File);
  }

  getMp3Files() {
    return this.mp3Files;
  }
}

module.exports = { Queue, Player, MusicManager, app };

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', passport.authenticate('google', {
  failureRedirect: '/login-failure'
}), (req, res) => {
  res.redirect('/');
});

app.get('/login-failure', (req, res) => {
  res.status(401).send('<h1>Login failed</h1><p><a href="/">Return to Musicify</a></p>');
});

app.get('/auth/user', (req, res) => {
  if (req.isAuthenticated()) {
    return res.json({
      authenticated: true,
      user: {
        id: req.user.id,
        name: req.user.displayName,
        email: req.user.email
      }
    });
  }
  res.json({ authenticated: false });
});

app.post('/auth/logout', (req, res) => {
  req.logout(err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.get('/mp3_files', ensureAuthenticated, async (req, res) => {
  try {
    const rows = await Mp3FileModel.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(rows.map(row => ({ id: row._id, file_name: row.fileName, created_at: row.createdAt })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/mp3_files', ensureAuthenticated, (req, res) => {
  const mp3File = new Mp3FileItem(req.body.id, req.body.fileName);
  res.status(201).send(`MP3 file added: ${mp3File.fileName}`);
});

app.post('/upload', ensureAuthenticated, upload.single('music'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileName = req.file.originalname;
  const fileData = req.file.buffer;
  const fileHash = crypto.createHash('sha256').update(fileData).digest('hex');

  try {
    const existing = await Mp3FileModel.findOne({ userId: req.user.id, $or: [{ fileHash }, { fileName }] });
    if (existing) {
      return res.status(409).json({ error: 'Duplicate track found: same file name or same file content' });
    }

    const mp3Document = new Mp3FileModel({ fileName, fileData, fileHash, userId: req.user.id });
    await mp3Document.save();

    const mp3File = new Mp3FileItem(mp3Document._id, fileName);
    queue.addMp3File(req.user.id, mp3File);

    res.status(201).json({ id: mp3Document._id, fileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/mp3_files/:id', ensureAuthenticated, async (req, res) => {
  try {
    const result = await Mp3FileModel.deleteOne({ _id: req.params.id, userId: req.user.id });
    if (!result.deletedCount) {
      return res.status(404).json({ error: 'Track not found' });
    }
    queue.removeMp3File(req.user.id, req.params.id);
    res.json({ message: 'Track deleted', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/play/:id', ensureAuthenticated, async (req, res) => {
  try {
    const row = await Mp3FileModel.findOne({ _id: req.params.id, userId: req.user.id });
    if (!row) {
      return res.status(404).json({ error: 'MP3 file not found' });
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `inline; filename="${row.fileName}"`);
    res.send(row.fileData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/stop', ensureAuthenticated, (req, res) => {
  player.stopPlaying();
  res.send('Playback stopped');
});

app.post('/queue/:id', ensureAuthenticated, async (req, res) => {
  try {
    const row = await Mp3FileModel.findOne({ _id: req.params.id, userId: req.user.id });
    if (!row) {
      return res.status(404).json({ error: 'MP3 file not found' });
    }

    const mp3File = new Mp3FileItem(row._id, row.fileName);
    queue.addMp3File(req.user.id, mp3File);
    res.json({ message: 'Added to queue', file: mp3File });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/play-next', ensureAuthenticated, (req, res) => {
  const nextFile = queue.getNextMp3File(req.user.id);
  if (nextFile) {
    player.playMp3File(nextFile);
    res.json({ playing: nextFile });
  } else {
    res.json({ message: 'No files in queue' });
  }
});

app.get('/queue', ensureAuthenticated, (req, res) => {
  res.json(queue.getQueue(req.user.id));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server only when run directly
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server started on port ${port}`);
  });
}
