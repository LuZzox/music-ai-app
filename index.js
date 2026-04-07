const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const multer = require('multer');
const mongoose = require('mongoose');
const crypto = require('crypto');
const app = express();

const storage = multer.memoryStorage();
const upload = multer({ storage });

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/musicify';

// Warn if using default local connection in production environment
if (process.env.NODE_ENV === 'production' && !process.env.MONGODB_URI) {
  console.warn('⚠️  WARNING: No MONGODB_URI set. Using default local MongoDB.');
  console.warn('⚠️  Set MONGODB_URI environment variable to connect to MongoDB Atlas.');
}

// Check for placeholder cluster name
if (mongoUri.includes('cluster0.mongodb.net')) {
  console.warn('⚠️  WARNING: Using cluster0.mongodb.net placeholder.');
  console.warn('⚠️  Replace cluster0 with your actual MongoDB Atlas cluster name.');
}

mongoose.set('strictQuery', false);

// Handle connection state changes
mongoose.connection.on('connected', () => {
  console.log('✓ Connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('✗ MongoDB connection error:');
  console.error(`  Error: ${err.message}`);
  console.error('');
  console.error('Troubleshooting:');
  console.error('1. Check MONGODB_URI environment variable is correct');
  console.error('2. If using cluster0.mongodb.net, replace it with your actual cluster name');
  console.error('3. Verify MongoDB user credentials (email/password)');
  console.error('4. Allow Network Access in MongoDB Atlas (IP whitelist)');
  console.error('5. For Render: add 0.0.0.0/0 to Atlas IP access list');
  console.error('');
  console.error('Server continuing, but database operations will fail.');
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  Disconnected from MongoDB');
});

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  family: 4,
  retryWrites: true
}).catch(err => {
  // Log initial connection error but don't crash
  console.error('✗ Initial MongoDB connection failed:');
  console.error(`  Error: ${err.message}`);
});

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  passwordHash: { type: String, required: true },
  displayName: String,
  createdAt: { type: Date, default: Date.now }
});

const mp3FileSchema = new mongoose.Schema({
  fileName: String,
  fileData: Buffer,
  fileHash: String,
  uploaderEmail: String,
  uploaderName: String,
  createdAt: { type: Date, default: Date.now },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});

const playlistSchema = new mongoose.Schema({
  name: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  trackIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Mp3File' }],
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Mp3FileModel = mongoose.model('Mp3File', mp3FileSchema);
const Playlist = mongoose.model('Playlist', playlistSchema);

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
    this.playHistory = new Map();
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
    if (next) {
      const history = this.playHistory.get(key) || [];
      history.push(next);
      this.playHistory.set(key, history);
    }
    this.userQueues.set(key, queue);
    return next;
  }

  getPreviousMp3File(userId) {
    const key = userId.toString();
    const history = this.playHistory.get(key) || [];
    if (history.length === 0) {
      return null;
    }
    const previous = history.pop();
    return previous;
  }

  getQueue(userId) {
    return this.userQueues.get(userId.toString()) || [];
  }

  shuffleQueue(userId) {
    const key = userId.toString();
    const queue = this.userQueues.get(key) || [];
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    this.userQueues.set(key, queue);
    return queue;
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

function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function requireDatabase(req, res, next) {
  if (mongoose.connection.readyState === 1) {
    return next();
  }
  res.status(503).json({ 
    error: 'Database unavailable',
    details: 'MongoDB connection failed. Check MONGODB_URI and network access.',
    readyState: mongoose.connection.readyState
  });
}

app.post('/signup', requireDatabase, async (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = new User({ email: email.toLowerCase(), passwordHash, displayName });
    await user.save();
    req.session.userId = user._id;
    req.session.userEmail = user.email;
    req.session.displayName = user.displayName;
    res.json({ id: user._id, email: user.email, displayName: user.displayName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/login', requireDatabase, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    req.session.userId = user._id;
    req.session.userEmail = user.email;
    req.session.displayName = user.displayName;
    res.json({ id: user._id, email: user.email, displayName: user.displayName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

app.get('/auth/user', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ authenticated: true, user: { id: req.session.userId, email: req.session.userEmail } });
  }
  res.json({ authenticated: false });
});

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

app.get('/mp3_files', ensureAuthenticated, requireDatabase, async (req, res) => {
  try {
    const rows = await Mp3FileModel.find({ userId: req.session.userId }).sort({ createdAt: -1 });
    res.json(rows.map(row => ({ id: row._id, file_name: row.fileName, created_at: row.createdAt })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/mp3_files', ensureAuthenticated, (req, res) => {
  const mp3File = new Mp3FileItem(req.body.id, req.body.fileName);
  res.status(201).send(`MP3 file added: ${mp3File.fileName}`);
});

app.post('/upload', ensureAuthenticated, requireDatabase, upload.single('music'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileName = req.file.originalname;
  const fileData = req.file.buffer;
  const fileHash = crypto.createHash('sha256').update(fileData).digest('hex');

  try {
    const existing = await Mp3FileModel.findOne({ userId: req.session.userId, $or: [{ fileHash }, { fileName }] });
    if (existing) {
      return res.status(409).json({ error: 'Duplicate track found: same file name or same file content' });
    }

    const mp3Document = new Mp3FileModel({
      fileName,
      fileData,
      fileHash,
      uploaderEmail: req.session.userEmail,
      uploaderName: req.session.displayName || req.session.userEmail,
      userId: req.session.userId
    });
    await mp3Document.save();

    const mp3File = new Mp3FileItem(mp3Document._id, fileName);
    queue.addMp3File(req.session.userId, mp3File);

    res.status(201).json({ id: mp3Document._id, fileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/mp3_files/:id', ensureAuthenticated, requireDatabase, async (req, res) => {
  try {
    const result = await Mp3FileModel.deleteOne({ _id: req.params.id, userId: req.session.userId });
    if (!result.deletedCount) {
      return res.status(404).json({ error: 'Track not found' });
    }
    queue.removeMp3File(req.session.userId, req.params.id);
    res.json({ message: 'Track deleted', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/play/:id', ensureAuthenticated, requireDatabase, async (req, res) => {
  try {
    const row = await Mp3FileModel.findById(req.params.id);
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

app.get('/search', ensureAuthenticated, requireDatabase, async (req, res) => {
  try {
    const query = (req.query.q || '').trim();
    const filter = query ? { fileName: { $regex: query, $options: 'i' } } : {};
    const rows = await Mp3FileModel.find(filter).sort({ createdAt: -1 }).limit(120);
    res.json(rows.map(row => ({
      id: row._id,
      file_name: row.fileName,
      uploaderEmail: row.uploaderEmail,
      owned: row.userId.toString() === req.session.userId.toString(),
      created_at: row.createdAt
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/import/:id', ensureAuthenticated, requireDatabase, async (req, res) => {
  try {
    const source = await Mp3FileModel.findById(req.params.id);
    if (!source) {
      return res.status(404).json({ error: 'Track not found' });
    }
    if (source.userId.toString() === req.session.userId.toString()) {
      return res.status(409).json({ error: 'Track already in your library' });
    }
    const existing = await Mp3FileModel.findOne({
      userId: req.session.userId,
      $or: [{ fileHash: source.fileHash }, { fileName: source.fileName }]
    });
    if (existing) {
      return res.status(409).json({ error: 'You already have this track in your library' });
    }
    const copy = new Mp3FileModel({
      fileName: source.fileName,
      fileData: source.fileData,
      fileHash: source.fileHash,
      uploaderEmail: req.session.userEmail,
      uploaderName: req.session.displayName || req.session.userEmail,
      userId: req.session.userId
    });
    await copy.save();
    const mp3File = new Mp3FileItem(copy._id, copy.fileName);
    queue.addMp3File(req.session.userId, mp3File);
    res.status(201).json({ id: copy._id, fileName: copy.fileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/playlists', ensureAuthenticated, requireDatabase, async (req, res) => {
  try {
    const playlists = await Playlist.find({ userId: req.session.userId }).sort({ createdAt: -1 });
    res.json(playlists.map(item => ({ id: item._id, name: item.name, trackCount: item.trackIds.length })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/playlists', ensureAuthenticated, requireDatabase, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Playlist name is required' });
    }
    const playlist = new Playlist({ name: name.trim(), userId: req.session.userId, trackIds: [] });
    await playlist.save();
    res.status(201).json({ id: playlist._id, name: playlist.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/playlists/:id', ensureAuthenticated, requireDatabase, async (req, res) => {
  try {
    const playlist = await Playlist.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    const tracks = await Mp3FileModel.find({ _id: { $in: playlist.trackIds } });
    res.json({ id: playlist._id, name: playlist.name, tracks: tracks.map(row => ({ id: row._id, file_name: row.fileName })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/playlists/:id/tracks', ensureAuthenticated, requireDatabase, async (req, res) => {
  try {
    const { trackId } = req.body;
    if (!trackId) {
      return res.status(400).json({ error: 'trackId is required' });
    }
    const playlist = await Playlist.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    const track = await Mp3FileModel.findById(trackId);
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }
    if (playlist.trackIds.some(id => id.toString() === trackId)) {
      return res.status(409).json({ error: 'Track already in playlist' });
    }
    playlist.trackIds.push(track._id);
    await playlist.save();
    res.json({ message: 'Track added to playlist' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/playlists/:id/tracks/:trackId', ensureAuthenticated, requireDatabase, async (req, res) => {
  try {
    const playlist = await Playlist.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    playlist.trackIds = playlist.trackIds.filter(id => id.toString() !== req.params.trackId);
    await playlist.save();
    res.json({ message: 'Track removed from playlist' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/stop', ensureAuthenticated, (req, res) => {
  player.stopPlaying();
  res.send('Playback stopped');
});

app.post('/queue/:id', ensureAuthenticated, requireDatabase, async (req, res) => {
  try {
    const row = await Mp3FileModel.findById(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'MP3 file not found' });
    }

    const mp3File = new Mp3FileItem(row._id, row.fileName);
    queue.addMp3File(req.session.userId, mp3File);
    res.json({ message: 'Added to queue', file: mp3File });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/play-next', ensureAuthenticated, (req, res) => {
  const nextFile = queue.getNextMp3File(req.session.userId);
  if (nextFile) {
    player.playMp3File(nextFile);
    res.json({ playing: nextFile });
  } else {
    res.json({ message: 'No files in queue' });
  }
});

app.get('/play-prev', ensureAuthenticated, (req, res) => {
  const prevFile = queue.getPreviousMp3File(req.session.userId);
  if (prevFile) {
    player.playMp3File(prevFile);
    res.json({ playing: prevFile });
  } else {
    res.json({ message: 'No previous track' });
  }
});

app.post('/shuffle', ensureAuthenticated, (req, res) => {
  const shuffledQueue = queue.shuffleQueue(req.session.userId);
  res.json({ queue: shuffledQueue });
});

app.get('/queue', ensureAuthenticated, (req, res) => {
  res.json(queue.getQueue(req.session.userId));
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: err.message || 'Server error' });
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
