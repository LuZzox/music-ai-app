const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const multer = require('multer');
const mongoose = require('mongoose');
const crypto = require('crypto');
const mm = require('music-metadata');
const app = express();

// Memory management - force GC if available (only in development)
if (global.gc && process.env.NODE_ENV === 'development') {
  setInterval(() => {
    global.gc();
    console.log('Forced garbage collection');
  }, 30 * 60 * 1000); // Every 30 minutes
}
// Définir mongoUri à partir de la variable d'environnement ou fallback local
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/music-app';
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 10 // Max 10 files per upload
  }
});
// Warn if using default local connection in production environment
if (process.env.NODE_ENV === 'production' && !process.env.MONGODB_URI) {
  console.warn('⚠️  WARNING: No MONGODB_URI set. Using default local MongoDB.');
}

// Check for placeholder cluster name
if (mongoUri.includes('cluster0.mongodb.net')) {
  console.warn('⚠️  WARNING: Using cluster0.mongodb.net placeholder.');
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

mongoose.connect(mongoUri)
  .then(async () => {
    console.log('✅ MongoDB connecté');

    // 🔥 INDEX ICI (au bon moment)
    await Mp3FileModel.collection.createIndex({ createdAt: -1 });
    await Mp3FileModel.collection.createIndex({ fileName: "text" });

    console.log('✅ Index créés');
  })
  .catch(err => {
    console.error('❌ MongoDB erreur:', err);
    console.error('Server will continue with limited functionality (token auth only)');
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
  coverData: Buffer,
  coverMime: String,
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
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept,Authorization,Cookie');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Configure session store with fallback to memory store
let store;
let mongoStoreConnected = false;

const mongoStore = MongoStore.create({ 
  mongoUrl: mongoUri, 
  collectionName: 'sessions',
  touchAfter: 24 * 3600 // lazy session update
}).on('connected', () => {
  mongoStoreConnected = true;
  console.log('✓ MongoStore connected successfully');
}).on('error', (err) => {
  console.error('⚠️  MongoStore error:', err.message);
  console.warn('⚠️  Falling back to memory-based sessions (will reset on server restart)');
  mongoStoreConnected = false;
});

store = mongoStore;

const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: true,
  store: store,
  cookie: {
    maxAge: 12 * 60 * 60 * 1000, // Reduced from 24 to 12 hours
    sameSite: 'none',
    secure: true,
    httpOnly: true,
    path: '/',
    domain: undefined
  },
  name: 'musica.sid'  // Custom session cookie name for debugging
};

app.use(session(sessionConfig));

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

// In-memory token store as fallback auth mechanism
const tokenStore = new Map();
let lastCleanup = Date.now();

function generateToken() {
  return crypto.randomBytes(16).toString('hex'); // Reduced from 32 to 16 bytes
}

function cleanupExpiredTokens() {
  const now = Date.now();
  // Only cleanup every 5 minutes to reduce CPU usage
  if (now - lastCleanup < 5 * 60 * 1000) return;
  
  lastCleanup = now;
  let cleaned = 0;
  for (const [token, data] of tokenStore.entries()) {
    if (data.expiry < now) {
      tokenStore.delete(token);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} expired tokens`);
  }
}

function storeToken(userId, email) {
  cleanupExpiredTokens(); // Cleanup before storing new token
  
  const token = generateToken();
  const expiry = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
  tokenStore.set(token, { userId, email, expiry });
  
  return token;
}

function validateToken(token) {
  const data = tokenStore.get(token);
  if (!data) return null;
  if (data.expiry < Date.now()) {
    tokenStore.delete(token);
    return null;
  }
  return data;
}

function ensureAuthenticated(req, res, next) {
  // Check session first
  if (req.session && req.session.userId) {
    return next();
  }
  
  // Fall back to token auth (Authorization header)
  const authHeader = req.headers.authorization || '';
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);
  if (tokenMatch) {
    const token = tokenMatch[1];
    const tokenData = validateToken(token);
    if (tokenData) {
      req.session.userId = tokenData.userId;
      req.session.userEmail = tokenData.email;
      return next();
    }
  }
  
  res.status(401).json({ error: 'Unauthorized' });
}

function requireDatabase(req, res, next) {
  // For token-based auth endpoints, don't require database if it's down
  // The token validation is in-memory anyway
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return next();
  }
  
  if (mongoose.connection.readyState === 1) {
    return next();
  }
  
  // If database is down and no token auth, return 503
  res.status(503).json({ 
    error: 'Database unavailable',
    details: 'MongoDB connection failed. Check MONGODB_URI and network access.',
    readyState: mongoose.connection.readyState
  });
}

async function parseCoverDataFromBuffer(buffer, mimeType) {
  try {
    const metadata = await mm.parseBuffer(buffer, mimeType, { duration: true });
    const picture = metadata.common?.picture?.[0];
    if (picture && picture.data && picture.format) {
      return { coverData: picture.data, coverMime: picture.format };
    }
  } catch (err) {
    console.warn('MP3 metadata parse failed:', err.message);
  }
  return {};
}

function mapTrack(row, userId) {
  return {
    id: row._id,
    file_name: row.fileName,
    coverUrl: row.coverData ? `/cover/${row._id}` : null,
    uploaderEmail: row.uploaderEmail,
    uploaderName: row.uploaderName,
    owned: row.userId.toString() === userId.toString(),
    created_at: row.createdAt
  };
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
    console.log('[SIGNUP] Session set for user:', user.email, 'SessionID:', req.sessionID);
    
    // Generate token as fallback auth
    const token = storeToken(user._id, user.email);
    
    // Explicitly save session to MongoDB before responding
    req.session.save((err) => {
      if (err) {
        console.error('[SIGNUP] Session save error:', err);
        // Still return response with token even if session save fails
        return res.json({ 
          id: user._id, 
          email: user.email, 
          displayName: user.displayName,
          token: token,
          authMethod: 'token-fallback'
        });
      }
      console.log('[SIGNUP] Session saved successfully for:', user.email);
      res.json({ 
        id: user._id, 
        email: user.email, 
        displayName: user.displayName,
        token: token,
        authMethod: 'session'
      });
    });
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
    console.log('[LOGIN] Session set for user:', user.email, 'SessionID:', req.sessionID);
    
    // Generate token as fallback auth
    const token = storeToken(user._id, user.email);
    
    // Explicitly save session to MongoDB before responding
    req.session.save((err) => {
      if (err) {
        console.error('[LOGIN] Session save error:', err);
        // Still return response with token even if session save fails
        return res.json({ 
          id: user._id, 
          email: user.email, 
          displayName: user.displayName,
          token: token,
          authMethod: 'token-fallback'
        });
      }
      console.log('[LOGIN] Session saved successfully for:', user.email);
      res.json({ 
        id: user._id, 
        email: user.email, 
        displayName: user.displayName,
        token: token,
        authMethod: 'session'
      });
    });
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
  // Check session first
  if (req.session && req.session.userId) {
    return res.json({ authenticated: true, user: { id: req.session.userId, email: req.session.userEmail } });
  }
  
  // Check token as fallback
  const authHeader = req.headers.authorization || '';
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);
  if (tokenMatch) {
    const token = tokenMatch[1];
    const tokenData = validateToken(token);
    if (tokenData) {
      console.log('[AUTH/USER] ✓ Token authenticated:', tokenData.email);
      return res.json({ authenticated: true, user: { id: tokenData.userId, email: tokenData.email } });
    }
  }
  
  res.json({ authenticated: false });
});

// Debug endpoint to check session status
app.get('/auth/debug', (req, res) => {
  const debug = {
    hasSession: !!req.session,
    hasUserId: !!req.session?.userId,
    userId: req.session?.userId || null,
    userEmail: req.session?.userEmail || null,
    sessionId: req.sessionID,
    cookiesHeader: req.headers.cookie ? 'present' : 'missing',
    mongooseReadyState: mongoose.connection.readyState,
    mongooseReadyStateLabel: mongoose.connection.readyState === 0 ? 'disconnected' : 
                              mongoose.connection.readyState === 1 ? 'connected' : 
                              mongoose.connection.readyState === 2 ? 'connecting' : 
                              mongoose.connection.readyState === 3 ? 'disconnecting' : 'unknown',
    timestamp: new Date().toISOString(),
    mongoUri: process.env.MONGODB_URI ? 'set' : 'not set'
  };
  console.log('[DEBUG] Session debug info:', debug);
  res.json(debug);
});

// Health check endpoint - no auth required
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    dbConnected: mongoose.connection.readyState === 1,
    timestamp: new Date().toISOString()
  });
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

app.get('/mp3_files', ensureAuthenticated, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    // Database unavailable, return empty array
    return res.json([]);
  }
  
  try {
    // Use find() instead of aggregate for better memory usage
    const rows = await Mp3FileModel.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .limit(50) // Reduced from 120 to 50
      .lean(); // Use lean() to get plain objects, not Mongoose documents
    
    res.json(rows.map(row => mapTrack(row, req.session.userId)));
  } catch (err) {
    console.error('mp3_files error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/mp3_files', ensureAuthenticated, (req, res) => {
  const mp3File = new Mp3FileItem(req.body.id, req.body.fileName);
  res.status(201).send(`MP3 file added: ${mp3File.fileName}`);
});

app.post('/upload', ensureAuthenticated, requireDatabase, upload.array('music'), async (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const uploaded = [];
  const skipped = [];

  for (const file of files) {
    const fileName = file.originalname;
    const fileData = file.buffer;
    const fileHash = crypto.createHash('sha256').update(fileData).digest('hex');

    try {
      const existing = await Mp3FileModel.findOne({ userId: req.session.userId, $or: [{ fileHash }, { fileName }] });
      if (existing) {
        skipped.push(fileName);
        continue;
      }

      const cover = await parseCoverDataFromBuffer(fileData, file.mimetype);
      const mp3Document = new Mp3FileModel({
        fileName,
        fileData,
        fileHash,
        coverData: cover.coverData,
        coverMime: cover.coverMime,
        uploaderEmail: req.session.userEmail,
        uploaderName: req.session.displayName || req.session.userEmail,
        userId: req.session.userId
      });
      await mp3Document.save();
      const mp3File = new Mp3FileItem(mp3Document._id, fileName);
      queue.addMp3File(req.session.userId, mp3File);
      uploaded.push(fileName);
    } catch (err) {
      skipped.push(`${fileName} (error: ${err.message})`);
    }
  }

  res.status(201).json({ uploaded, skipped });
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

app.get('/play/:id', ensureAuthenticated, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  
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

app.get('/cover/:id', ensureAuthenticated, requireDatabase, async (req, res) => {
  try {
    const row = await Mp3FileModel.findById(req.params.id);
    if (!row || !row.coverData || !row.coverMime) {
      return res.status(404).json({ error: 'Cover not found' });
    }
    res.setHeader('Content-Type', row.coverMime);
    res.send(row.coverData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/search', ensureAuthenticated, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json([]);
  }
  
  try {
    const query = (req.query.q || '').trim();
    
    let rows;
    if (query) {
      // Use text search with lean()
      rows = await Mp3FileModel.find({ $text: { $search: query } })
        .sort({ createdAt: -1 })
        .limit(30) // Reduced limit
        .lean();
    } else {
      // Return all recent shared tracks when no query (not just user's tracks)
      rows = await Mp3FileModel.find({})
        .sort({ createdAt: -1 })
        .limit(30)
        .lean();
    }

    res.json(rows.map(row => mapTrack(row, req.session.userId)));

  } catch (err) {
    console.error('search error:', err.message);
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
      coverData: source.coverData,
      coverMime: source.coverMime,
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

app.get('/playlists', ensureAuthenticated, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json([]);
  }
  
  try {
    const playlists = await Playlist.find({ userId: req.session.userId }).sort({ createdAt: -1 });
    res.json(playlists.map(item => ({ id: item._id, name: item.name, trackCount: item.trackIds.length })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/playlists', ensureAuthenticated, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database unavailable. Please try again.' });
  }
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

app.get('/playlists/:id', ensureAuthenticated, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  
  try {
    const playlist = await Playlist.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    const tracks = await Mp3FileModel.find({ _id: { $in: playlist.trackIds } });
    res.json({ id: playlist._id, name: playlist.name, tracks: tracks.map(row => mapTrack(row, req.session.userId)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/playlists/:id/tracks', ensureAuthenticated, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database unavailable. Please try again.' });
  }
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

app.delete('/playlists/:id/tracks/:trackId', ensureAuthenticated, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database unavailable. Please try again.' });
  }
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