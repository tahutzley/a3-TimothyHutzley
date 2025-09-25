const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config();
const bcrypt = require('bcryptjs');

const dir  = 'public/';
const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/a2timer';

const app = express();

app.use(express.json());
app.use(express.text({ type: '*/*' }));
app.use(express.static(path.join(__dirname, dir)));

const cookieSession = require('cookie-session');

app.set('trust proxy', 1);
app.use(cookieSession({
  name: 'sid',
  keys: [process.env.SESSION_SECRET || 'development_only_secret'],
  maxAge: 86400000, // 24 hours
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production', // set true on HTTPS
}));

function requireAuth(req, res, next) {
  if (!req.session || !req.session.username) {
    return res.status(401).json({ error: 'auth_required' });
  }
  next();
}

app.post('/auth/upsert', async (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const username = String(body?.username || '').trim().toLowerCase();
    const password = String(body?.password || '');

    const Users = db.collection('users');
    const user = await Users.findOne({ username });

    if (!user) {
      const passHash = await bcrypt.hash(password, 10);
      await Users.insertOne({ username, passHash, createdAt: Date.now() });
      req.session.username = username;
      return res.status(201).json({ ok: true, mode: 'register', username, note: 'New account created automatically.' });
    }

    const ok = await bcrypt.compare(password, user.passHash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    req.session.username = username;
    res.json({ ok: true, mode: 'login', username });
  } catch (e) {
    const dup = e?.code === 11000;
    console.error('auth upsert error:', e);
    res.status(dup ? 409 : 500).json({ error: dup ? 'username_taken' : 'auth_failed' });
  }
});

// POST /auth/logout
app.post('/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// GET /me
app.get('/me', (req, res) => {
  const username = req.session?.username || null;
  res.json({ user: username ? { username } : null });
});

let client;  
let db;       
let Scores; 

// GET /highscores
app.get('/highscores', requireAuth, async (req, res) => {
  try {
    const entries = await Scores
      .find({ username: req.session.username }, { projection: { _id: 0, name: 1, timeMs: 1, score: 1, ts: 1 } })
      .sort({ timeMs: 1 })
      .toArray();
    console.log('Fetched highscores for', req.session.username, entries.length, 'entries');
    res.status(200).json({ entries });
  } catch (e) {
    console.error('GET /highscores error:', e);
    res.status(500).json({ error: 'db_read_failed' });
  }
});

// POST /submit
app.post('/submit', requireAuth, async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); }
      catch { return res.status(400).type('text/plain').send('Invalid JSON'); }
    }

    const name = (body.yourName || '').trim() || 'Anonymous';
    const t = Number(body.timeMs);
    if (!Number.isFinite(t) || t < 0) return res.status(400).json({ error: 'invalid timeMs' });

    const doc = { username: req.session.username, name, timeMs: Math.round(t), score: Math.round((5000 - t) / 50), ts: Date.now() };
    await Scores.insertOne(doc);

    const entries = await Scores
      .find({ username: req.session.username }, { projection: { _id: 0, name: 1, timeMs: 1, score: 1, ts: 1 } })
      .sort({ timeMs: 1 })
      .toArray();

    res.status(200).json({ ok: true, entries });
  } catch (e) {
    console.error('POST /submit error:', e);
    res.status(500).json({ error: 'db_write_failed' });
  }
});

// POST /delete  { id }
app.post('/delete', requireAuth, async (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const id = body?.id;
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

    await Scores.deleteOne({ ts: id });

    const entries = await Scores
      .find({ username: req.session.username }, { projection: { _id: 0, name: 1, timeMs: 1, score: 1, ts: 1 } })
      .sort({ timeMs: 1 })
      .toArray();

    res.status(200).json({ ok: true, entries });
  } catch (e) {
    console.error('POST /delete error:', e);
    res.status(500).json({ error: 'db_delete_failed' });
  }
});

// POST /rename  { id, yourName }
app.post('/rename', requireAuth, async (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    const id = body?.id;
    const name = (body?.yourName || '').trim();
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    if (!name) return res.status(400).json({ error: 'name_required' });

    await Scores.updateOne({ ts: id }, { $set: { name } });

    const entries = await Scores
      .find({ username: req.session.username }, { projection: { _id: 0, name: 1, timeMs: 1, score: 1, ts: 1 } })
      .sort({ timeMs: 1 })
      .toArray();

    res.status(200).json({ ok: true, entries });
  } catch (e) {
    console.error('POST /rename error:', e);
    res.status(500).json({ error: 'db_update_failed' });
  }
});

async function start() {
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();

    db = client.db('a3persistence');

    Scores = db.collection('scores');
    const Users = db.collection('users');
    await Users.createIndex({ username: 1 }, { unique: true });
    await Scores.createIndex({ username: 1, timeMs: 1 });

    await Scores.createIndex({ timeMs: 1 });
    await Scores.createIndex({ ts: 1 }, { unique: true });

    app.listen(PORT, () => {
      console.log('Mongo connected');
      console.log(`Express server listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Mongo connection error:', err);
    process.exit(1);
  }
}

start();
