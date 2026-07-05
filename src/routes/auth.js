const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');

const router = express.Router();

// Limitació d'intents de login en memòria (n'hi ha prou per a un sol usuari)
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const attempts = new Map(); // ip -> { count, lockedUntil }

function isLocked(ip) {
  const entry = attempts.get(ip);
  return !!(entry && entry.lockedUntil && entry.lockedUntil > Date.now());
}

function registerFailure(ip) {
  const entry = attempts.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCK_MS;
    entry.count = 0;
  }
  attempts.set(ip, entry);
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Falten usuari o contrasenya' });
    }
    if (isLocked(req.ip)) {
      return res.status(429).json({ ok: false, error: 'Massa intents fallits. Torna-ho a provar d\'aquí 15 minuts.' });
    }
    if (!config.admin.passwordHash) {
      return res.status(500).json({ ok: false, error: 'ADMIN_PASSWORD_HASH no configurat al .env' });
    }

    const userOk = username === config.admin.user;
    const passOk = await bcrypt.compare(password, config.admin.passwordHash);
    if (!userOk || !passOk) {
      registerFailure(req.ip);
      return res.status(401).json({ ok: false, error: 'Credencials incorrectes' });
    }

    attempts.delete(req.ip);
    // Regenerem la sessió per evitar fixació de sessió
    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ ok: false, error: 'No s\'ha pogut crear la sessió' });
      }
      req.session.user = { name: username };
      res.json({ ok: true, user: { name: username } });
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('cc.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ ok: true, user: req.session.user });
  }
  res.status(401).json({ ok: false, error: 'No autenticat' });
});

module.exports = router;
