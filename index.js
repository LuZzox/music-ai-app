const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const mongoose = require('mongoose');
const mm = require('music-metadata');
const app = express();

// Memory management: Force garbage collection if available
// Configure multer for disk storage to avoid memory issues
const uploadDir = path.join(__dirname, 'uploads');
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// Memory management - force GC if available (only in development)
if (global.gc) {
  setInterval(() => {
    global.gc();
    if (process.env.NODE_ENV === 'development') console.log('Forced garbage collection');
  }, 60000); // Run GC every minute
}

// Cleanup old temporary files periodically
async function cleanupTempFiles() {
  try {
    const files = await fs.readdir(uploadDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const file of files) {
      const filePath = path.join(uploadDir, file);
      const stats = await fs.stat(filePath);
      if (now - stats.mtime.getTime() > maxAge) {
        await fs.unlink(filePath);
        console.log(`Cleaned up old temp file: ${file}`);
      }
    }
  } catch (err) {
    console.error('Error cleaning up temp files:', err);
  }
}

// Run cleanup every hour
setInterval(cleanupTempFiles, 60 * 60 * 1000);

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/musica';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✓ Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Mongoose Schemas
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  displayName: String,
  profilePicture: Buffer,
  profilePictureMime: String,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const mp3Schema = new mongoose.Schema({
  fileName: { type: String, required: true },
  fileData: { type: Buffer, required: true },
  fileHash: String,
  coverData: Buffer,
  coverMime: String,
  uploaderEmail: String,
  uploaderName: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});
mp3Schema.index({ userId: 1, fileHash: 1 }, { unique: true });
const Mp3File = mongoose.model('Mp3File', mp3Schema);

const playlistSchema = new mongoose.Schema({
  name: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  trackIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Mp3File' }],
  createdAt: { type: Date, default: Date.now }
});
const Playlist = mongoose.model('Playlist', playlistSchema);

// New Mongoose Schemas for persistent tokens and queue
const authTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  email: { type: String, required: true }, // Added email for token data
  token: { type: String, required: true, unique: true },
  expiry: { type: Date, required: true }
});
const AuthToken = mongoose.model('AuthToken', authTokenSchema);

const userQueueItemSchema = new mongoose.Schema({
  id: { type: mongoose.Schema.Types.ObjectId, required: true },
  fileName: { type: String, required: true }
}, { _id: false }); // Don't create an _id for subdocuments

const userQueueSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  queueItems: [userQueueItemSchema],
  historyItems: [userQueueItemSchema] // For play-prev
});
const UserQueue = mongoose.model('UserQueue', userQueueSchema);

// Helper functions converted to Async Mongoose calls
async function getUserByEmail(email) {
  return await User.findOne({ email: email.toLowerCase() });
}

async function getUserById(id) {
  return await User.findById(id);
}

async function createUser(email, passwordHash, displayName) {
  const user = new User({ email: email.toLowerCase(), passwordHash, displayName });
  return await user.save();
}

async function getMp3FilesByUser(userId) {
  return await Mp3File.find({ userId }).sort({ createdAt: -1 }).select('-fileData -coverData');
}

async function getMp3FileById(id) {
  return await Mp3File.findById(id);
}

async function getMp3FileMetadataById(id) {
  return await Mp3File.findById(id).select('fileName uploaderName uploaderEmail userId createdAt coverMime');
}

async function deleteMp3File(userId, id) {
  return await Mp3File.deleteOne({ _id: id, userId });
}

async function findExistingMp3(userId, fileHash, fileName) {
  return await Mp3File.findOne({ userId, $or: [{ fileHash }, { fileName }] });
}

async function createMp3FileRecord(data) {
  const file = new Mp3File(data);
  return await file.save();
}

async function searchMp3Files(query) {
  return await Mp3File.find({ fileName: new RegExp(query, 'i') })
    .limit(30)
    .sort({ createdAt: -1 })
    .select('-fileData -coverData');
}

async function listRecentMp3Files() {
  return await Mp3File.find().limit(30).sort({ createdAt: -1 }).select('-fileData -coverData');
}

async function getPlaylistById(userId, id) {
  return await Playlist.findOne({ _id: id, userId });
}

async function listPlaylists(userId) {
  return await Playlist.find({ userId }).sort({ createdAt: -1 });
}

async function createPlaylistRecord(name, userId) {
  const playlist = new Playlist({ name, userId, trackIds: [] });
  return await playlist.save();
}

async function savePlaylistTracks(id, userId, trackIds) {
  return await Playlist.updateOne({ _id: id, userId }, { $set: { trackIds } });
}

const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGODB_URI }),
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // Persistent for 30 days
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    path: '/',
    domain: undefined
  },
  name: 'musica.sid'
};

app.use(express.json({ limit: '10mb' }));
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

app.use(session(sessionConfig));

app.use(express.static('public'));

class Mp3FileItem {
  constructor(id, fileName) {
    this.id = id;
    this.fileName = fileName;
  }
}

class Queue {
  async getOrCreateUserQueue(userId) {
    let userQueue = await UserQueue.findOne({ userId });
    if (!userQueue) {
      userQueue = new UserQueue({ userId, queueItems: [], historyItems: [] });
      await userQueue.save();
    }
    return userQueue;
  }

  async addMp3File(userId, mp3File) {
    const userQueue = await this.getOrCreateUserQueue(userId);
    userQueue.queueItems.push(mp3File);
    await userQueue.save();
    return userQueue.queueItems;
  }

  async getNextMp3File(userId) {
    const userQueue = await this.getOrCreateUserQueue(userId);
    const next = userQueue.queueItems.shift(); // Remove from front of queue
    if (next) {
      userQueue.historyItems.push(next); // Add to history
      // Limit history size to prevent it from growing indefinitely
      if (userQueue.historyItems.length > 50) { // Keep last 50 tracks in history
        userQueue.historyItems.shift();
      }
    }
    await userQueue.save();
    return next;
  }

  async getPreviousMp3File(userId) {
    const userQueue = await this.getOrCreateUserQueue(userId);
    const previous = userQueue.historyItems.pop(); // Remove from end of history
    if (previous) {
      userQueue.queueItems.unshift(previous); // Add back to front of queue
    }
    await userQueue.save();
    return previous;
  }

  async getQueue(userId) {
    const userQueue = await this.getOrCreateUserQueue(userId);
    return userQueue.queueItems;
  }

  async shuffleQueue(userId) {
    const userQueue = await this.getOrCreateUserQueue(userId);
    const queue = userQueue.queueItems;
    if (queue.length === 0) {
      return null;
    }
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    await userQueue.save();
    return queue;
  }

  async removeMp3File(userId, id) {
    const userQueue = await this.getOrCreateUserQueue(userId);
    userQueue.queueItems = userQueue.queueItems.filter(item => item.id.toString() !== id.toString());
    userQueue.historyItems = userQueue.historyItems.filter(item => item.id.toString() !== id.toString()); // Also remove from history
    await userQueue.save();
  }

  async setQueue(userId, newQueueItems) {
    const userQueue = await this.getOrCreateUserQueue(userId);
    userQueue.queueItems = newQueueItems;
    await userQueue.save();
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
// const tokenStore = new Map(); // REMOVED: Replaced by AuthToken Mongoose model
// let lastCleanup = Date.now(); // REMOVED: Cleanup handled by Mongoose

function generateToken() {
  return crypto.randomBytes(16).toString('hex'); // Reduced from 32 to 16 bytes
}

async function cleanupExpiredTokens() {
  const now = new Date();
  await AuthToken.deleteMany({ expiry: { $lt: now } });
  // console.log(`Cleaned up expired tokens from DB`); // Optional logging
}

async function storeToken(userId, email) {
  await cleanupExpiredTokens(); // Cleanup before storing new token
  
  const token = generateToken();
  const expiry = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)); // Persistent for 30 days
  const authToken = new AuthToken({ userId, email, token, expiry });
  await authToken.save();
  
  return token;
}

async function validateToken(token) {
  const authToken = await AuthToken.findOne({ token });
  if (!authToken) return null;
  if (authToken.expiry < new Date()) {
    await AuthToken.deleteOne({ _id: authToken._id });
    return null;
  }
  return { userId: authToken.userId, email: authToken.email };
}

async function clearToken(token) {
  await AuthToken.deleteOne({ token });
}

async function ensureAuthenticated(req, res, next) { // Made async
  // Check session first
  if (req.session && req.session.userId) {
    return next();
  }
  
  // Fall back to token auth (Authorization header)
  const authHeader = req.headers.authorization || '';
  let token = null;
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);
  if (tokenMatch) {
    token = tokenMatch[1];
  } else if (req.query.token) { // Support token in query parameter for direct streaming (audio tags)
    token = req.query.token;
  }

  if (token) {
    const tokenData = await validateToken(token); // AWAIT here
    if (tokenData) {
      req.session.userId = tokenData.userId;
      req.session.userEmail = tokenData.email;
      // Optionally, fetch displayName if needed for session
      const user = await User.findById(tokenData.userId).select('displayName');
      if (user) req.session.displayName = user.displayName;

      // Save session to ensure it's persisted for future requests
      return req.session.save(err => {
        if (err) console.error('Error saving session after token auth:', err);
        next();
      });
    }
  }
  
  res.status(401).json({ error: 'Unauthorized' });
}

// Removed requireDatabase middleware - SQLite is always available

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
    coverUrl: (row.coverData || row.coverMime) ? `/cover/${row._id}` : null,
    uploaderEmail: row.uploaderEmail,
    uploaderName: row.uploaderName,
    owned: row.userId.toString() === userId.toString(),
    created_at: row.createdAt
  };
}

app.post('/signup', async (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const existing = await getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await createUser(email, passwordHash, displayName);
    const userId = newUser.id;

    req.session.userId = userId;
    req.session.userEmail = newUser.email;
    req.session.displayName = newUser.displayName;
    console.log('[SIGNUP] Session set for user:', email, 'SessionID:', req.sessionID);

    const token = await storeToken(userId, newUser.email); // AWAIT here

    req.session.save((err) => {
      if (err) {
        console.error('[SIGNUP] Session save error:', err);
        return res.json({
          id: userId,
          email: newUser.email,
          displayName: newUser.displayName,
          hasPicture: !!newUser.profilePicture,
          token: token,
          authMethod: 'token-fallback'
        });
      }
      console.log('[SIGNUP] Session saved successfully for:', email);
      res.json({
        id: userId,
        email: newUser.email,
        displayName: newUser.displayName,
        hasPicture: !!newUser.profilePicture,
        token: token,
        authMethod: 'session'
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.displayName = user.displayName;
    console.log('[LOGIN] Session set for user:', user.email, 'SessionID:', req.sessionID);

    const token = await storeToken(user.id, user.email); // AWAIT here

    req.session.save((err) => {
      if (err) {
        console.error('[LOGIN] Session save error:', err);
        return res.json({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          hasPicture: !!user.profilePicture,
          token: token,
          authMethod: 'token-fallback'
        });
      }
      console.log('[LOGIN] Session saved successfully for:', user.email);
      res.json({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        hasPicture: !!user.profilePicture,
        token: token,
        authMethod: 'session'
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/logout', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (token) { // If a token was used, clear it from DB
      clearToken(token).catch(console.error);
    }
    res.json({ success: true });
  });
});

app.post('/user/profile', ensureAuthenticated, upload.single('avatar'), async (req, res) => { // Made async
  const { displayName } = req.body;
  const updateData = {};
  if (displayName) updateData.displayName = displayName;
  if (req.file) {
    const fileData = await fs.readFile(req.file.path);
    updateData.profilePicture = fileData;
    updateData.profilePictureMime = req.file.mimetype;
    await fs.unlink(req.file.path);
  }
  try {
    const user = await User.findByIdAndUpdate(req.session.userId, updateData, { new: true }).select('email displayName profilePicture');
    req.session.displayName = user.displayName;
    res.json({ success: true, user: { id: user._id, email: user.email, displayName: user.displayName, hasPicture: !!user.profilePicture } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/user/avatar', ensureAuthenticated, async (req, res) => { // Made async
  const user = await User.findById(req.session.userId).select('profilePicture profilePictureMime');
  if (!user || !user.profilePicture) return res.status(404).send();
  res.set('Content-Type', user.profilePictureMime);
  res.send(user.profilePicture);
});

app.get('/auth/user', async (req, res) => { // Made async
  // Check session first
  if (req.session && req.session.userId) {
    const user = await User.findById(req.session.userId).select('displayName email profilePicture');
    return res.json({ authenticated: true, user: { id: req.session.userId, email: user.email, displayName: user.displayName, hasPicture: !!user.profilePicture } });
  }
  
  // Check token as fallback
  const authHeader = req.headers.authorization || '';
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);
  if (tokenMatch) {
    const token = tokenMatch[1];
    const tokenData = await validateToken(token); // AWAIT here
    if (tokenData) {
      console.log('[AUTH/USER] ✓ Token authenticated:', tokenData.email);
      const user = await User.findById(tokenData.userId).select('displayName email profilePicture');
      return res.json({ authenticated: true, user: { id: tokenData.userId, email: user.email, displayName: user.displayName, hasPicture: !!user.profilePicture } });
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
    dbConnected: true,
    timestamp: new Date().toISOString()
  };
  console.log('[DEBUG] Session debug info:', debug);
  res.json(debug);
});

// Health check endpoint - no auth required
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    dbConnected: true,
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
  try {
    const rows = await getMp3FilesByUser(req.session.userId);
    res.json(rows.map(row => ({
      id: row.id,
      fileName: row.fileName,
      uploaderName: row.uploaderName,
      createdAt: row.createdAt,
      owned: true
    })));
  } catch (err) {
    console.error('mp3_files error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/track-meta/:id', ensureAuthenticated, async (req, res) => {
  try {
    const track = await getMp3FileMetadataById(req.params.id);
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }
    // Utilise mapTrack pour formater les métadonnées pour le frontend
    res.json(mapTrack(track, req.session.userId));
  } catch (err) {
    console.error('/track-meta error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/mp3_files', ensureAuthenticated, (req, res) => {
  const mp3File = new Mp3FileItem(req.body.id, req.body.fileName);
  res.status(201).send(`MP3 file added: ${mp3File.fileName}`);
});

app.post('/upload', ensureAuthenticated, upload.array('music'), async (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const uploaded = [];
  const skipped = [];

  for (const file of files) {
    const fileName = file.originalname;
    const filePath = file.path;

    try {
      const fileData = await fs.readFile(filePath);
      const fileHash = crypto.createHash('sha256').update(fileData).digest('hex');

      const existing = await findExistingMp3(req.session.userId, fileHash, fileName);
      if (existing) {
        skipped.push(fileName);
        await fs.unlink(filePath);
        continue;
      }

      const cover = await parseCoverDataFromBuffer(fileData, file.mimetype);
      const result = await createMp3FileRecord({
        fileName,
        fileData,
        fileHash,
        coverData: cover.coverData,
        coverMime: cover.coverMime,
        uploaderEmail: req.session.userEmail,
        uploaderName: req.session.displayName || req.session.userEmail,
        userId: req.session.userId
      });

      const mp3File = new Mp3FileItem(result.id, fileName);
      queue.addMp3File(req.session.userId, mp3File);
      uploaded.push(fileName);

      await fs.unlink(filePath);
    } catch (err) {
      skipped.push(`${fileName} (error: ${err.message})`);
      try {
        await fs.unlink(filePath);
      } catch (cleanupErr) {
        console.error('Failed to cleanup temp file:', cleanupErr);
      }
    }
  }

  res.status(201).json({ uploaded, skipped });
});

app.delete('/mp3_files/:id', ensureAuthenticated, async (req, res) => {
  try {
    const result = await deleteMp3File(req.session.userId, req.params.id);
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Track not found' });
    }
    queue.removeMp3File(req.session.userId, req.params.id);
    res.json({ message: 'Track deleted', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/play/:id', ensureAuthenticated, async (req, res) => {
  try {
    const row = await getMp3FileById(req.params.id);
    if (!row || !row.fileData || row.fileData.length === 0) {
      return res.status(404).json({ error: 'MP3 file not found or missing audio data' });
    }

    const totalLength = row.fileData.length;
    const range = req.headers.range;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `inline; filename="${row.fileName.replace(/"/g, "'")}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1;
      const chunksize = (end - start) + 1;
      
      if (start >= totalLength || end >= totalLength) {
        res.status(416).send('Requested Range Not Satisfiable');
        return;
      }

      res.status(206).set({
        'Content-Range': `bytes ${start}-${end}/${totalLength}`,
        'Content-Length': chunksize
      }).send(row.fileData.slice(start, end + 1));
    } else {
      res.setHeader('Content-Length', totalLength);
      res.send(row.fileData);
    }
  } catch (err) {
    console.error('/play error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/cover/:id', ensureAuthenticated, async (req, res) => {
  try {
    const row = await getMp3FileById(req.params.id);
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
  try {
    const query = (req.query.q || '').trim();
    const rows = query ? await searchMp3Files(query) : await listRecentMp3Files();

    res.json(rows.map(row => ({
      id: row.id,
      fileName: row.fileName,
      uploaderName: row.uploaderName,
      createdAt: row.createdAt,
      owned: row.userId.toString() === req.session.userId.toString()
    })));

  } catch (err) {
    console.error('search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/import/:id', ensureAuthenticated, async (req, res) => {
  try {
    const source = await getMp3FileById(req.params.id);
    if (!source) {
      return res.status(404).json({ error: 'Track not found' });
    }
    if (source.userId === req.session.userId) {
      return res.status(409).json({ error: 'Track already in your library' });
    }

    const existing = await findExistingMp3(req.session.userId, source.fileHash, source.fileName);
    if (existing) {
      return res.status(409).json({ error: 'You already have this track in your library' });
    }

    const created = await createMp3FileRecord({
      fileName: source.fileName,
      fileData: source.fileData,
      fileHash: source.fileHash,
      coverData: source.coverData,
      coverMime: source.coverMime,
      uploaderEmail: req.session.userEmail,
      uploaderName: req.session.displayName || req.session.userEmail,
      userId: req.session.userId
    });

    const mp3File = new Mp3FileItem(created.id, source.fileName);
    queue.addMp3File(req.session.userId, mp3File);
    res.status(201).json({ id: created.id, fileName: source.fileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/playlists', ensureAuthenticated, async (req, res) => {
  try {
    const playlists = await listPlaylists(req.session.userId);
    res.json(playlists.map(item => ({
      id: item.id,
      name: item.name,
      trackCount: item.trackIds.length
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/playlists', ensureAuthenticated, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Playlist name is required' });
    }
    const result = await createPlaylistRecord(name.trim(), req.session.userId);
    res.status(201).json({ id: result.id, name: result.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/playlists/:id', ensureAuthenticated, async (req, res) => {
  try {
    const playlist = await getPlaylistById(req.session.userId, req.params.id);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    if (playlist.trackIds.length === 0) {
      return res.json({ id: playlist.id, name: playlist.name, tracks: [] });
    }

    const tracksData = await Promise.all(playlist.trackIds.map(id => getMp3FileMetadataById(id))); // Récupère seulement les métadonnées
    const tracks = tracksData.filter(Boolean);
    res.json({
      id: playlist.id,
      name: playlist.name,
      tracks: tracks.map(row => ({
        id: row.id,
        fileName: row.fileName,
        uploaderName: row.uploaderName,
        createdAt: row.createdAt,
        owned: row.userId.toString() === req.session.userId.toString()
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/playlists/:id/tracks', ensureAuthenticated, async (req, res) => {
  try {
    const { trackId } = req.body;
    if (!trackId) {
      return res.status(400).json({ error: 'trackId is required' });
    }
    const playlist = await getPlaylistById(req.session.userId, req.params.id);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    const track = await getMp3FileById(trackId);
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }
    const existingIds = playlist.trackIds;
    if (existingIds.includes(trackId)) {
      return res.status(409).json({ error: 'Track already in playlist' });
    }
    existingIds.push(trackId);
    await savePlaylistTracks(req.params.id, req.session.userId, existingIds);
    res.json({ message: 'Track added to playlist' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/playlists/:id/tracks/:trackId', ensureAuthenticated, async (req, res) => {
  try {
    const playlist = await getPlaylistById(req.session.userId, req.params.id);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    const filtered = playlist.trackIds.filter(id => id.toString() !== req.params.trackId);
    await savePlaylistTracks(req.params.id, req.session.userId, filtered);
    res.json({ message: 'Track removed from playlist' });
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
    const row = await getMp3FileById(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'MP3 file not found' });
    }

    const mp3File = new Mp3FileItem(row.id, row.fileName);
    await queue.addMp3File(req.session.userId, mp3File); // AWAIT here
    res.json({ message: 'Added to queue', file: mp3File });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/play-next', ensureAuthenticated, async (req, res) => {
  const nextFile = await queue.getNextMp3File(req.session.userId); // AWAIT here
  if (nextFile) {
    player.playMp3File(nextFile);
    const meta = await getMp3FileMetadataById(nextFile.id);
    res.json({ 
      playing: { 
        ...nextFile, 
        details: meta ? mapTrack(meta, req.session.userId) : null 
      } 
    });
  } else {
    res.json({ message: 'No files in queue' });
  }
});

app.get('/play-prev', ensureAuthenticated, async (req, res) => {
  const prevFile = await queue.getPreviousMp3File(req.session.userId); // AWAIT here
  if (prevFile) {
    player.playMp3File(prevFile);
    const meta = await getMp3FileMetadataById(prevFile.id);
    res.json({ 
      playing: { 
        ...prevFile, 
        details: meta ? mapTrack(meta, req.session.userId) : null 
      } 
    });
  } else {
    res.json({ message: 'No previous track' });
  }
});

app.post('/shuffle', ensureAuthenticated, (req, res) => {
  const shuffledQueue = queue.shuffleQueue(req.session.userId); // This is now async, but not awaited here.
  res.json({ queue: shuffledQueue });
});

app.get('/queue', ensureAuthenticated, async (req, res) => { // Made async
  res.json(await queue.getQueue(req.session.userId)); // AWAIT here
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