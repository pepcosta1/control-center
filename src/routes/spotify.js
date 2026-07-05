const crypto = require('crypto');
const express = require('express');
const spotify = require('../services/spotifyService');
const lyricsService = require('../services/lyricsService');

const router = express.Router();

// GET /api/spotify/status
router.get('/status', (req, res) => {
  res.json({ ok: true, configured: spotify.isConfigured(), connected: spotify.isConnected() });
});

// GET /api/spotify/login — inicia el flux OAuth (redirecció al consentiment de Spotify)
router.get('/login', (req, res) => {
  if (!spotify.isConfigured()) {
    return res.status(503).json({ ok: false, error: 'Spotify no configurat (revisa el .env)' });
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.spotifyState = state;
  res.redirect(spotify.getAuthUrl(state));
});

// GET /api/spotify/callback — Spotify torna aquí amb el codi d'autorització
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      return res.redirect('/?spotify=denied');
    }
    if (!state || state !== req.session.spotifyState) {
      return res.status(400).send('Estat OAuth invàlid. Torna a començar des del panell.');
    }
    delete req.session.spotifyState;
    await spotify.exchangeCode(code);
    res.redirect('/');
  } catch (err) {
    console.error('[spotify] Error al callback:', err.message);
    res.status(500).send(`Error connectant amb Spotify: ${err.message}`);
  }
});

// POST /api/spotify/disconnect — esborra els tokens guardats
router.post('/disconnect', (req, res) => {
  spotify.disconnect();
  res.json({ ok: true });
});

// GET /api/spotify/now-playing
router.get('/now-playing', async (req, res) => {
  try {
    res.json({ ok: true, ...(await spotify.nowPlaying()) });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/spotify/play — body opcional: { contextUri } (playlist) o { trackUri } (cançó concreta)
router.post('/play', async (req, res) => {
  try {
    const { contextUri, trackUri } = req.body || {};
    if (trackUri) {
      await spotify.playTrack(trackUri);
    } else {
      await spotify.play(contextUri);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/spotify/pause
router.post('/pause', async (req, res) => {
  try {
    await spotify.pause();
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/spotify/next
router.post('/next', async (req, res) => {
  try {
    await spotify.next();
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/spotify/previous
router.post('/previous', async (req, res) => {
  try {
    await spotify.previous();
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// GET /api/spotify/recent?limit=20 — últimes cançons escoltades (màx. 50)
router.get('/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    res.json({ ok: true, tracks: await spotify.recentlyPlayed(limit) });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/spotify/volume — body: { percent: 0-100 }
router.post('/volume', async (req, res) => {
  try {
    const { percent } = req.body || {};
    if (typeof percent !== 'number') {
      return res.status(400).json({ ok: false, error: 'Falta el camp "percent" (0-100)' });
    }
    await spotify.setVolume(percent);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// GET /api/spotify/devices — dispositius Spotify disponibles
router.get('/devices', async (req, res) => {
  try {
    res.json({ ok: true, devices: await spotify.devices() });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/spotify/transfer — body: { deviceId } — mou la reproducció a un altre dispositiu
router.post('/transfer', async (req, res) => {
  try {
    const { deviceId } = req.body || {};
    if (!deviceId) {
      return res.status(400).json({ ok: false, error: 'Falta el camp "deviceId"' });
    }
    await spotify.transferPlayback(deviceId);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/spotify/seek — body: { positionMs }
router.post('/seek', async (req, res) => {
  try {
    const { positionMs } = req.body || {};
    if (typeof positionMs !== 'number') {
      return res.status(400).json({ ok: false, error: 'Falta el camp "positionMs"' });
    }
    await spotify.seek(positionMs);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// GET /api/spotify/lyrics?track=...&artist=...&album=...&duration=180
router.get('/lyrics', async (req, res) => {
  try {
    const { track, artist, album, duration } = req.query;
    if (!track || !artist) {
      return res.status(400).json({ ok: false, error: 'Falten els paràmetres "track" i "artist"' });
    }
    const result = await lyricsService.getLyrics(artist, track, album, parseInt(duration, 10) || undefined);
    if (!result) {
      return res.status(404).json({ ok: false, error: 'No s\'ha trobat la lletra d\'aquesta cançó' });
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// GET /api/spotify/playlists
router.get('/playlists', async (req, res) => {
  try {
    res.json({ ok: true, playlists: await spotify.playlists() });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
