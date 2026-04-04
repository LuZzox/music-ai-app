const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const app = express();

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    cb(null, safeName);
  }
});

const upload = multer({ storage });

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));

// Configure SQLite database connection
let db = new sqlite3.Database('./music.db');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS mp3_files (
      id INTEGER PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

// Define MP3File class to represent MP3 files
class Mp3File {
  constructor(id, fileName) {
    this.id = id;
    this.fileName = fileName;
  }
}

// Define Queue class to store and retrieve MP3 files
class Queue {
  constructor() {
    this.mp3Files = [];
  }

  addMp3File(mp3File) {
    return this.mp3Files.push(mp3File);
  }

  getNextMp3File() {
    if (this.mp3Files.length > 0) {
      return this.mp3Files.shift();
    } else {
      return null;
    }
  }
}

// Define Player class to play MP3 files
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

module.exports = { Mp3File, Queue, Player, MusicManager, app };

// Define API routes
app.get('/mp3_files', (req, res) => {
  db.all('SELECT id, file_name, file_path, created_at FROM mp3_files ORDER BY created_at DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/mp3_files', (req, res) => {
  const mp3File = new Mp3File(req.body.id, req.body.fileName);
  res.status(201).send(`MP3 file added: ${mp3File.fileName}`);
});

app.post('/upload', upload.single('music'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileName = req.file.originalname;
  const filePath = req.file.filename;

  db.run('INSERT INTO mp3_files (file_name, file_path) VALUES (?, ?)', [fileName, filePath], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ id: this.lastID, fileName, url: `/uploads/${filePath}` });
  });
});

app.get('/play/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT id, file_name, file_path FROM mp3_files WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'MP3 file not found' });
    res.json({ id: row.id, fileName: row.file_name, url: `/uploads/${row.file_path}` });
  });
});

app.get('/stop', (req, res) => {
  res.send('Playback stopped');
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
