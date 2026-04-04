const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const app = express();

const storage = multer.memoryStorage();

const upload = multer({ storage });

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Configure SQLite database connection
let db = new sqlite3.Database('./music.db');

// Create tables if they don't exist and migrate schema if needed
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS mp3_files (
      id INTEGER PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_data BLOB NOT NULL,
      file_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.get("PRAGMA table_info(mp3_files)", (err, row) => {
    if (!err && row) {
      // Column exists; nothing else needed here.
    }
  });

  db.all("PRAGMA table_info(mp3_files)", (err, rows) => {
    if (!err && rows && !rows.some(col => col.name === 'file_hash')) {
      db.run('ALTER TABLE mp3_files ADD COLUMN file_hash TEXT');
    }
  });

  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_mp3_files_file_hash ON mp3_files(file_hash)');
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

// Initialize queue and player
const queue = new Queue();
const player = new Player();

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
  db.all('SELECT id, file_name, created_at FROM mp3_files ORDER BY created_at DESC', (err, rows) => {
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
  const fileData = req.file.buffer;
  const fileHash = crypto.createHash('sha256').update(fileData).digest('hex');

  db.get('SELECT id FROM mp3_files WHERE file_hash = ? OR file_name = ?', [fileHash, fileName], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (existing) {
      return res.status(409).json({ error: 'Duplicate track found: same file name or same file content' });
    }

    db.run('INSERT INTO mp3_files (file_name, file_data, file_hash) VALUES (?, ?, ?)', [fileName, fileData, fileHash], function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const mp3File = new Mp3File(this.lastID, fileName);
      queue.addMp3File(mp3File);
      res.status(201).json({ id: this.lastID, fileName });
    });
  });
});

app.delete('/mp3_files/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.run('DELETE FROM mp3_files WHERE id = ?', [id], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Track not found' });
    }
    queue.mp3Files = queue.mp3Files.filter(item => item.id !== id);
    res.json({ message: 'Track deleted', id });
  });
});

app.get('/play/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT id, file_name, file_data FROM mp3_files WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'MP3 file not found' });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `inline; filename="${row.file_name}"`);
    res.send(row.file_data);
  });
});

app.get('/stop', (req, res) => {
  player.stopPlaying();
  res.send('Playback stopped');
});

app.post('/queue/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT id, file_name FROM mp3_files WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'MP3 file not found' });
    const mp3File = new Mp3File(row.id, row.file_name);
    queue.addMp3File(mp3File);
    res.json({ message: 'Added to queue', file: mp3File });
  });
});

app.get('/play-next', (req, res) => {
  const nextFile = queue.getNextMp3File();
  if (nextFile) {
    player.playMp3File(nextFile);
    res.json({ playing: nextFile });
  } else {
    res.json({ message: 'No files in queue' });
  }
});

app.get('/queue', (req, res) => {
  res.json(queue.mp3Files);
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
