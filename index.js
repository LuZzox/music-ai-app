const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const Database = require('better-sqlite3');
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

// Initialize SQLite database
const db = new Database('./music.db', { verbose: console.log });

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    displayName TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS mp3_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fileName TEXT NOT NULL,
    fileData BLOB,
    fileHash TEXT UNIQUE,
    coverData BLOB,
    coverMime TEXT,
    uploaderEmail TEXT,
    uploaderName TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    userId INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    userId INTEGER NOT NULL,
    trackIds TEXT, -- JSON array of track IDs
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
`);

console.log('✓ Connected to SQLite database');

// SQLite prepared statements
const dbStatements = {
  // Users
  createUser: db.prepare('INSERT INTO users (email, passwordHash, displayName) VALUES (?, ?, ?)'),
  getUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  
  // MP3 Files
  createMp3File: db.prepare('INSERT INTO mp3_files (fileName, fileData, fileHash, coverData, coverMime, uploaderEmail, uploaderName, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  getMp3FileById: db.prepare('SELECT * FROM mp3_files WHERE id = ?'),
  getMp3FilesByUser: db.prepare('SELECT id, fileName, createdAt FROM mp3_files WHERE userId = ? ORDER BY createdAt DESC'),
  getAllMp3Files: db.prepare('SELECT id, fileName, uploaderName, createdAt FROM mp3_files ORDER BY createdAt DESC LIMIT ? OFFSET ?'),
  getMp3FileCount: db.prepare('SELECT COUNT(*) as count FROM mp3_files'),
  deleteMp3File: db.prepare('DELETE FROM mp3_files WHERE id = ? AND userId = ?'),
  
  // Playlists
  createPlaylist: db.prepare('INSERT INTO playlists (name, userId, trackIds) VALUES (?, ?, ?)'),
  getPlaylistsByUser: db.prepare('SELECT * FROM playlists WHERE userId = ? ORDER BY createdAt DESC'),
  getPlaylistById: db.prepare('SELECT * FROM playlists WHERE id = ? AND userId = ?'),
  getPlaylistByIdAndUser: db.prepare('SELECT * FROM playlists WHERE id = ? AND userId = ?'),
  updatePlaylist: db.prepare('UPDATE playlists SET name = ?, trackIds = ? WHERE id = ? AND userId = ?'),
  updatePlaylistTracks: db.prepare('UPDATE playlists SET trackIds = ? WHERE id = ? AND userId = ?'),
  deletePlaylist: db.prepare('DELETE FROM playlists WHERE id = ? AND userId = ?')
};

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

// Configure session store
const store = new SQLiteStore({ db: 'sessions.db', dir: __dirname });

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
    coverUrl: row.coverData ? `/cover/${row._id}` : null,
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
    const existing = dbStatements.getUserByEmail.get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = dbStatements.createUser.run(email.toLowerCase(), passwordHash, displayName);
    const userId = result.lastInsertRowid;
    
    req.session.userId = userId;
    req.session.userEmail = email.toLowerCase();
    req.session.displayName = displayName;
    console.log('[SIGNUP] Session set for user:', email, 'SessionID:', req.sessionID);
    
    // Generate token as fallback auth
    const token = storeToken(userId, email.toLowerCase());
    
    // Save session
    req.session.save((err) => {
      if (err) {
        console.error('[SIGNUP] Session save error:', err);
        return res.json({ 
          id: userId, 
          email: email.toLowerCase(), 
          displayName: displayName,
          token: token,
          authMethod: 'token-fallback'
        });
      }
      console.log('[SIGNUP] Session saved successfully for:', email);
      res.json({ 
        id: userId, 
        email: email.toLowerCase(), 
        displayName: displayName,
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
    const user = dbStatements.getUserByEmail.get(email.toLowerCase());
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
    
    // Generate token as fallback auth
    const token = storeToken(user.id, user.email);
    
    // Save session
    req.session.save((err) => {
      if (err) {
        console.error('[LOGIN] Session save error:', err);
        return res.json({ 
          id: user.id, 
          email: user.email, 
          displayName: user.displayName,
          token: token,
          authMethod: 'token-fallback'
        });
      }
      console.log('[LOGIN] Session saved successfully for:', user.email);
      res.json({ 
        id: user.id, 
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
    const rows = dbStatements.getMp3FilesByUser.all(req.session.userId);
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
    const fileData = file.buffer;
    const fileHash = crypto.createHash('sha256').update(fileData).digest('hex');

    try {
      // Check if file already exists
      const existing = db.prepare('SELECT id FROM mp3_files WHERE userId = ? AND (fileHash = ? OR fileName = ?)').get(req.session.userId, fileHash, fileName);
      if (existing) {
        skipped.push(fileName);
        continue;
      }

      const cover = await parseCoverDataFromBuffer(fileData, file.mimetype);
      const result = dbStatements.createMp3File.run(
        fileName,
        fileData,
        fileHash,
        cover.coverData,
        cover.coverMime,
        req.session.userEmail,
        req.session.displayName || req.session.userEmail,
        req.session.userId
      );
      
      const mp3File = new Mp3FileItem(result.lastInsertRowid, fileName);
      queue.addMp3File(req.session.userId, mp3File);
      uploaded.push(fileName);
    } catch (err) {
      skipped.push(`${fileName} (error: ${err.message})`);
    }
  }

  res.status(201).json({ uploaded, skipped });
});

app.delete('/mp3_files/:id', ensureAuthenticated, async (req, res) => {
  try {
    const result = dbStatements.deleteMp3File.run(req.params.id, req.session.userId);
    if (result.changes === 0) {
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
    const row = dbStatements.getMp3FileById.get(req.params.id);
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

app.get('/cover/:id', ensureAuthenticated, async (req, res) => {
  try {
    const row = dbStatements.getMp3FileById.get(req.params.id);
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
    
    let rows;
    if (query) {
      // Simple text search in filename
      rows = db.prepare('SELECT * FROM mp3_files WHERE fileName LIKE ? ORDER BY createdAt DESC LIMIT 30').all(`%${query}%`);
    } else {
      // Return all tracks
      rows = dbStatements.getAllMp3Files.all(30, 0);
    }

    res.json(rows.map(row => ({
      id: row.id,
      fileName: row.fileName,
      uploaderName: row.uploaderName,
      createdAt: row.createdAt,
      owned: row.userId === req.session.userId
    })));

  } catch (err) {
    console.error('search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/import/:id', ensureAuthenticated, async (req, res) => {
  try {
    const source = dbStatements.getMp3FileById.get(req.params.id);
    if (!source) {
      return res.status(404).json({ error: 'Track not found' });
    }
    if (source.userId === req.session.userId) {
      return res.status(409).json({ error: 'Track already in your library' });
    }
    
    // Check if user already has this track
    const existing = db.prepare('SELECT id FROM mp3_files WHERE userId = ? AND (fileHash = ? OR fileName = ?)').get(req.session.userId, source.fileHash, source.fileName);
    if (existing) {
      return res.status(409).json({ error: 'You already have this track in your library' });
    }
    
    const result = dbStatements.createMp3File.run(
      source.fileName,
      source.fileData,
      source.fileHash,
      source.coverData,
      source.coverMime,
      req.session.userEmail,
      req.session.displayName || req.session.userEmail,
      req.session.userId
    );
    
    const mp3File = new Mp3FileItem(result.lastInsertRowid, source.fileName);
    queue.addMp3File(req.session.userId, mp3File);
    res.status(201).json({ id: result.lastInsertRowid, fileName: source.fileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/playlists', ensureAuthenticated, async (req, res) => {
  try {
    const playlists = dbStatements.getPlaylistsByUser.all(req.session.userId);
    res.json(playlists.map(item => {
      const trackIds = item.trackIds ? JSON.parse(item.trackIds) : [];
      return { id: item.id, name: item.name, trackCount: trackIds.length };
    }));
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
    const result = dbStatements.createPlaylist.run(name.trim(), req.session.userId, JSON.stringify([]));
    res.status(201).json({ id: result.lastInsertRowid, name: name.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/playlists/:id', ensureAuthenticated, async (req, res) => {
  try {
    const playlist = dbStatements.getPlaylistById.get(req.params.id, req.session.userId);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    const trackIds = playlist.trackIds ? JSON.parse(playlist.trackIds) : [];
    if (trackIds.length === 0) {
      return res.json({ id: playlist.id, name: playlist.name, tracks: [] });
    }
    
    // Get tracks
    const placeholders = trackIds.map(() => '?').join(',');
    const tracks = db.prepare(`SELECT * FROM mp3_files WHERE id IN (${placeholders})`).all(...trackIds);
    
    res.json({ 
      id: playlist.id, 
      name: playlist.name, 
      tracks: tracks.map(row => ({
        id: row.id,
        fileName: row.fileName,
        uploaderName: row.uploaderName,
        createdAt: row.createdAt,
        owned: row.userId === req.session.userId
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
    const playlist = dbStatements.getPlaylistByIdAndUser.get(req.params.id, req.session.userId);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    const track = dbStatements.getMp3FileById.get(trackId);
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }
    const trackIds = playlist.trackIds ? JSON.parse(playlist.trackIds) : [];
    if (trackIds.includes(trackId)) {
      return res.status(409).json({ error: 'Track already in playlist' });
    }
    trackIds.push(trackId);
    dbStatements.updatePlaylistTracks.run(JSON.stringify(trackIds), req.params.id, req.session.userId);
    res.json({ message: 'Track added to playlist' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/playlists/:id/tracks/:trackId', ensureAuthenticated, async (req, res) => {
  try {
    const playlist = dbStatements.getPlaylistByIdAndUser.get(req.params.id, req.session.userId);
    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    const trackIds = playlist.trackIds ? JSON.parse(playlist.trackIds) : [];
    const filteredTrackIds = trackIds.filter(id => id !== req.params.trackId);
    dbStatements.updatePlaylistTracks.run(JSON.stringify(filteredTrackIds), req.params.id, req.session.userId);
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
    const row = dbStatements.getMp3FileById.get(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'MP3 file not found' });
    }

    const mp3File = new Mp3FileItem(row.id, row.fileName);
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