const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const supabase = require('../services/supabaseService');
const { isRestricted } = require('../middleware/auth');

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

    // 1) Supabase Auth (si està configurat): el camp "username" és l'email
    let user = null;
    if (supabase.isConfigured() && username.includes('@')) {
      try {
        user = await supabase.verifyCredentials(username, password);
      } catch (err) {
        // Supabase caigut o pausat: no bloquegem el login, cau al fallback local
        console.warn(`[auth] Supabase no disponible (${err.message}); es prova el login local`);
      }
    }

    // 2) Fallback local: usuari admin del .env (porta d'emergència)
    if (!user && config.admin.passwordHash) {
      const userOk = username === config.admin.user;
      const passOk = await bcrypt.compare(password, config.admin.passwordHash);
      if (userOk && passOk) user = { name: username };
    }

    if (!user) {
      if (!supabase.isConfigured() && !config.admin.passwordHash) {
        return res.status(500).json({ ok: false, error: 'Cap mètode de login configurat al .env (Supabase o ADMIN_PASSWORD_HASH)' });
      }
      registerFailure(req.ip);
      return res.status(401).json({ ok: false, error: 'Credencials incorrectes' });
    }

    attempts.delete(req.ip);
    // Regenerem la sessió per evitar fixació de sessió
    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ ok: false, error: 'No s\'ha pogut crear la sessió' });
      }
      req.session.user = user;
      res.json({ ok: true, user });
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
    return res.json({ ok: true, user: req.session.user, restricted: isRestricted(req) });
  }
  // Dispositiu limitat: sessió automàtica de convidat, sense login
  if (isRestricted(req)) {
    return res.json({ ok: true, user: { name: 'convidat' }, restricted: true });
  }
  res.status(401).json({ ok: false, error: 'No autenticat' });
});

module.exports = router;
