const express = require('express');
const session = require('express-session');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'verdant.db');

if (!fs.existsSync(path.join(__dirname, 'public', 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'public', 'uploads'), { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function (err, rows) {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      bio TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      role TEXT DEFAULT 'user',
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS novels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      genre TEXT NOT NULL,
      status TEXT NOT NULL,
      tags TEXT DEFAULT '',
      link TEXT DEFAULT '',
      description TEXT NOT NULL,
      cover_url TEXT DEFAULT '',
      featured INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      chapter_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      rating INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  const admin = await get(`SELECT * FROM users WHERE email = ?`, ['admin@verdant.local']);
  if (!admin) {
    const hash = await bcrypt.hash('admin123', 10);
    await run(
      `INSERT INTO users (username, email, password_hash, bio, avatar_url, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Admin', 'admin@verdant.local', hash, 'Administrator Verdant Novel Library', '', 'admin', new Date().toISOString()]
    );
  }
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: 'verdant_secret_key_local_only',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
  filename: (_, file, cb) => {
    const safe = Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  }
});

const upload = multer({ storage });

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Musisz być zalogowany.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Brak uprawnień.' });
  }
  next();
}

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post('/api/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Uzupełnij wszystkie pola.' });
    }

    const exists = await get(`SELECT id FROM users WHERE email = ? OR username = ?`, [email, username]);
    if (exists) {
      return res.status(400).json({ error: 'Taki użytkownik już istnieje.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await run(
      `INSERT INTO users (username, email, password_hash, bio, avatar_url, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [username, email, hash, '', '', 'user', new Date().toISOString()]
    );

    const user = {
      id: result.lastID,
      username,
      email,
      bio: '',
      avatar_url: '',
      role: 'user'
    };

    req.session.user = user;
    res.json({ ok: true, user });
  } catch (error) {
    res.status(500).json({ error: 'Błąd rejestracji.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const user = await get(`SELECT * FROM users WHERE email = ?`, [email]);
    if (!user) {
      return res.status(400).json({ error: 'Nieprawidłowy email lub hasło.' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(400).json({ error: 'Nieprawidłowy email lub hasło.' });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      bio: user.bio,
      avatar_url: user.avatar_url,
      role: user.role
    };

    res.json({ ok: true, user: req.session.user });
  } catch (error) {
    res.status(500).json({ error: 'Błąd logowania.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.put('/api/profile', requireAuth, async (req, res) => {
  try {
    const bio = String(req.body.bio || '').trim();
    const avatar_url = String(req.body.avatar_url || '').trim();

    await run(`UPDATE users SET bio = ?, avatar_url = ? WHERE id = ?`, [
      bio, avatar_url, req.session.user.id
    ]);

    req.session.user.bio = bio;
    req.session.user.avatar_url = avatar_url;

    res.json({ ok: true, user: req.session.user });
  } catch (error) {
    res.status(500).json({ error: 'Nie udało się zaktualizować profilu.' });
  }
});

app.post('/api/upload-cover', requireAuth, upload.single('cover'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nie wybrano pliku.' });
  }
  res.json({ ok: true, url: '/uploads/' + req.file.filename });
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await get(
      `SELECT id, username, email, bio, avatar_url, role, created_at FROM users WHERE id = ?`,
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'Nie znaleziono użytkownika.' });

    const novels = await all(
      `SELECT id, title, genre, status, featured, created_at, updated_at
       FROM novels WHERE user_id = ? ORDER BY updated_at DESC`,
      [req.params.id]
    );

    res.json({ user, novels });
  } catch (error) {
    res.status(500).json({ error: 'Błąd pobierania profilu.' });
  }
});

app.get('/api/novels', async (req, res) => {
  try {
    const novels = await all(`
      SELECT n.*,
             u.username,
             (SELECT COUNT(*) FROM reviews r WHERE r.novel_id = n.id) AS reviews_count,
             (SELECT COUNT(*) FROM comments c WHERE c.novel_id = n.id) AS comments_count,
             (SELECT COUNT(*) FROM chapters ch WHERE ch.novel_id = n.id) AS chapters_count,
             COALESCE((SELECT ROUND(AVG(r.rating), 2) FROM reviews r WHERE r.novel_id = n.id), 0) AS avg_rating
      FROM novels n
      JOIN users u ON u.id = n.user_id
      ORDER BY n.updated_at DESC
    `);
    res.json({ novels });
  } catch (error) {
    res.status(500).json({ error: 'Błąd pobierania listy.' });
  }
});

app.get('/api/novels/:id', async (req, res) => {
  try {
    const novel = await get(`
      SELECT n.*, u.username, u.id AS owner_id
      FROM novels n
      JOIN users u ON u.id = n.user_id
      WHERE n.id = ?
    `, [req.params.id]);

    if (!novel) {
      return res.status(404).json({ error: 'Nie znaleziono wpisu.' });
    }

    const chapters = await all(
      `SELECT * FROM chapters WHERE novel_id = ? ORDER BY chapter_number ASC, id ASC`,
      [req.params.id]
    );
    const reviews = await all(`
      SELECT r.*, u.username
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      WHERE r.novel_id = ?
      ORDER BY r.created_at DESC
    `, [req.params.id]);
    const comments = await all(`
      SELECT c.*, u.username
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.novel_id = ?
      ORDER BY c.created_at DESC
    `, [req.params.id]);

    const ratingRow = await get(
      `SELECT COALESCE(ROUND(AVG(rating), 2), 0) AS avg_rating FROM reviews WHERE novel_id = ?`,
      [req.params.id]
    );

    res.json({
      novel: {
        ...novel,
        avg_rating: ratingRow?.avg_rating || 0,
        chapters,
        reviews,
        comments
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Błąd pobierania wpisu.' });
  }
});

app.post('/api/novels', requireAuth, async (req, res) => {
  try {
    const {
      title, author, genre, status, tags, link, description,
      cover_url, featured, chapters
    } = req.body;

    if (!title || !author || !genre || !description) {
      return res.status(400).json({ error: 'Uzupełnij wymagane pola.' });
    }

    const now = new Date().toISOString();
    const result = await run(`
      INSERT INTO novels (
        user_id, title, author, genre, status, tags, link, description,
        cover_url, featured, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      req.session.user.id,
      String(title).trim(),
      String(author).trim(),
      String(genre).trim(),
      String(status || 'Gotowa').trim(),
      String(tags || '').trim(),
      String(link || '').trim(),
      String(description).trim(),
      String(cover_url || '').trim(),
      featured ? 1 : 0,
      now,
      now
    ]);

    if (Array.isArray(chapters)) {
      for (const ch of chapters) {
        if (!String(ch.title || '').trim() && !String(ch.content || '').trim()) continue;
        await run(`
          INSERT INTO chapters (novel_id, chapter_number, title, content, created_at)
          VALUES (?, ?, ?, ?, ?)
        `, [
          result.lastID,
          Number(ch.chapter_number || 0),
          String(ch.title || '').trim() || 'Bez tytułu',
          String(ch.content || '').trim() || '',
          new Date().toISOString()
        ]);
      }
    }

    res.json({ ok: true, id: result.lastID });
  } catch (error) {
    res.status(500).json({ error: 'Błąd dodawania wpisu.' });
  }
});

app.put('/api/novels/:id', requireAuth, async (req, res) => {
  try {
    const novel = await get(`SELECT * FROM novels WHERE id = ?`, [req.params.id]);
    if (!novel) return res.status(404).json({ error: 'Nie znaleziono wpisu.' });

    if (novel.user_id !== req.session.user.id && req.session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Brak uprawnień do edycji.' });
    }

    const {
      title, author, genre, status, tags, link, description,
      cover_url, featured, chapters
    } = req.body;

    await run(`
      UPDATE novels
      SET title = ?, author = ?, genre = ?, status = ?, tags = ?, link = ?,
          description = ?, cover_url = ?, featured = ?, updated_at = ?
      WHERE id = ?
    `, [
      String(title).trim(),
      String(author).trim(),
      String(genre).trim(),
      String(status || 'Gotowa').trim(),
      String(tags || '').trim(),
      String(link || '').trim(),
      String(description).trim(),
      String(cover_url || '').trim(),
      featured ? 1 : 0,
      new Date().toISOString(),
      req.params.id
    ]);

    await run(`DELETE FROM chapters WHERE novel_id = ?`, [req.params.id]);

    if (Array.isArray(chapters)) {
      for (const ch of chapters) {
        if (!String(ch.title || '').trim() && !String(ch.content || '').trim()) continue;
        await run(`
          INSERT INTO chapters (novel_id, chapter_number, title, content, created_at)
          VALUES (?, ?, ?, ?, ?)
        `, [
          req.params.id,
          Number(ch.chapter_number || 0),
          String(ch.title || '').trim() || 'Bez tytułu',
          String(ch.content || '').trim() || '',
          new Date().toISOString()
        ]);
      }
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Błąd aktualizacji wpisu.' });
  }
});

app.delete('/api/novels/:id', requireAuth, async (req, res) => {
  try {
    const novel = await get(`SELECT * FROM novels WHERE id = ?`, [req.params.id]);
    if (!novel) return res.status(404).json({ error: 'Nie znaleziono wpisu.' });

    if (novel.user_id !== req.session.user.id && req.session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Brak uprawnień do usunięcia.' });
    }

    await run(`DELETE FROM reviews WHERE novel_id = ?`, [req.params.id]);
    await run(`DELETE FROM comments WHERE novel_id = ?`, [req.params.id]);
    await run(`DELETE FROM chapters WHERE novel_id = ?`, [req.params.id]);
    await run(`DELETE FROM novels WHERE id = ?`, [req.params.id]);

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Błąd usuwania wpisu.' });
  }
});

app.post('/api/novels/:id/reviews', requireAuth, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const text = String(req.body.text || '').trim();
    const rating = Number(req.body.rating || 0);

    if (!title || !text || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Nieprawidłowe dane recenzji.' });
    }

    await run(`
      INSERT INTO reviews (novel_id, user_id, title, rating, text, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      req.params.id,
      req.session.user.id,
      title,
      rating,
      text,
      new Date().toISOString()
    ]);

    await run(`UPDATE novels SET updated_at = ? WHERE id = ?`, [new Date().toISOString(), req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Błąd dodawania recenzji.' });
  }
});

app.post('/api/novels/:id/comments', requireAuth, async (req, res) => {
  try {
    const text = String(req.body.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Komentarz nie może być pusty.' });
    }

    await run(`
      INSERT INTO comments (novel_id, user_id, text, created_at)
      VALUES (?, ?, ?, ?)
    `, [
      req.params.id,
      req.session.user.id,
      text,
      new Date().toISOString()
    ]);

    await run(`UPDATE novels SET updated_at = ? WHERE id = ?`, [new Date().toISOString(), req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Błąd dodawania komentarza.' });
  }
});

app.get('/api/rankings', async (req, res) => {
  try {
    const period = String(req.query.period || 'all');
    let since = null;

    if (period === 'weekly') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      since = d.toISOString();
    } else if (period === 'monthly') {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      since = d.toISOString();
    }

    const novels = await all(`
      SELECT n.*, u.username
      FROM novels n
      JOIN users u ON u.id = n.user_id
    `);

    const ranked = [];
    for (const novel of novels) {
      const reviews = await all(
        `SELECT * FROM reviews WHERE novel_id = ? ${since ? 'AND created_at >= ?' : ''}`,
        since ? [novel.id, since] : [novel.id]
      );
      const comments = await all(
        `SELECT * FROM comments WHERE novel_id = ? ${since ? 'AND created_at >= ?' : ''}`,
        since ? [novel.id, since] : [novel.id]
      );
      const chapters = await all(
        `SELECT * FROM chapters WHERE novel_id = ? ${since ? 'AND created_at >= ?' : ''}`,
        since ? [novel.id, since] : [novel.id]
      );

      const avg = reviews.length
        ? reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / reviews.length
        : 0;
      const score = (avg * 3) + (reviews.length * 2) + comments.length + (chapters.length * 1.5);

      ranked.push({
        ...novel,
        avg_rating: Number(avg.toFixed(2)),
        reviews_count: reviews.length,
        comments_count: comments.length,
        chapters_count: chapters.length,
        score: Number(score.toFixed(2))
      });
    }

    ranked.sort((a, b) => b.score - a.score);
    res.json({ period, items: ranked });
  } catch (error) {
    res.status(500).json({ error: 'Błąd pobierania rankingów.' });
  }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const users = await get(`SELECT COUNT(*) AS count FROM users`);
    const novels = await get(`SELECT COUNT(*) AS count FROM novels`);
    const chapters = await get(`SELECT COUNT(*) AS count FROM chapters`);
    const reviews = await get(`SELECT COUNT(*) AS count FROM reviews`);
    const comments = await get(`SELECT COUNT(*) AS count FROM comments`);

    const latestUsers = await all(`
      SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 8
    `);
    const latestNovels = await all(`
      SELECT id, title, status, featured, updated_at FROM novels ORDER BY updated_at DESC LIMIT 8
    `);

    res.json({
      totals: {
        users: users.count,
        novels: novels.count,
        chapters: chapters.count,
        reviews: reviews.count,
        comments: comments.count
      },
      latestUsers,
      latestNovels
    });
  } catch (error) {
    res.status(500).json({ error: 'Błąd pobierania statystyk admina.' });
  }
});

app.get('*', (req, res) => {
  const requested = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
  const filePath = path.join(__dirname, 'public', requested);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Verdant server działa na http://localhost:${PORT}`);
  });
}).catch((error) => {
  console.error('Nie udało się uruchomić bazy:', error);
});
