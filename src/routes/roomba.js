const express = require('express');
const roomba = require('../services/roombaService');

const router = express.Router();

// GET /api/roomba/status
router.get('/status', async (req, res) => {
  try {
    if (!roomba.isConfigured()) {
      return res.json({ ok: true, status: 'unconfigured' });
    }
    const state = await roomba.getStatus();
    res.json({ ok: true, status: 'ok', roomba: state });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// GET /api/roomba/map — recorregut de l'última neteja (o de la que està en curs)
router.get('/map', (req, res) => {
  res.json({ ok: true, ...roomba.getMap() });
});

// POST /api/roomba/map/reset — esborra el recorregut guardat
router.post('/map/reset', (req, res) => {
  roomba.resetMap();
  res.json({ ok: true });
});

// POST /api/roomba/start | /pause | /resume | /stop | /dock
['start', 'pause', 'resume', 'stop', 'dock'].forEach((action) => {
  router.post(`/${action}`, async (req, res) => {
    try {
      await roomba[action]();
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, error: err.message });
    }
  });
});

module.exports = router;
