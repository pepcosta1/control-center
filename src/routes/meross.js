const express = require('express');
const merossService = require('../services/merossService');
const discordService = require('../services/discordService');

const router = express.Router();

// GET /api/meross/status — estat de la connexió amb el núvol de Meross
router.get('/status', (req, res) => {
  res.json({ ok: true, ...merossService.getStatus() });
});

// GET /api/meross/devices — llista de dispositius amb estat per canal
router.get('/devices', (req, res) => {
  try {
    const status = merossService.getStatus();
    if (status.status === 'unconfigured') {
      return res.status(503).json({ ok: false, error: 'Meross no configurat (revisa el .env)' });
    }
    res.json({ ok: true, devices: merossService.listDevices() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/meross/devices/:id/toggle — body: { channel?: number, on: boolean }
router.post('/devices/:id/toggle', async (req, res) => {
  try {
    const { on, channel = 0 } = req.body || {};
    if (typeof on !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'El camp "on" ha de ser true o false' });
    }
    const device = await merossService.toggle(req.params.id, Number(channel), on);
    discordService.notifyQuiet(`🔌 **${device.name}** ${on ? 'encès ✅' : 'apagat ⭕'}`);
    res.json({ ok: true, device });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/meross/devices/:id/refresh — força rellegir l'estat del dispositiu
router.post('/devices/:id/refresh', async (req, res) => {
  try {
    const device = await merossService.refreshDevice(req.params.id);
    res.json({ ok: true, device });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
