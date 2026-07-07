const express = require('express');
const smartthingsService = require('../services/smartthingsService');
const discordService = require('../services/discordService');

const router = express.Router();

// GET /api/smartthings/status — estat actual de la TV (encès, volum, mute, app)
router.get('/status', async (req, res) => {
  try {
    if (!smartthingsService.isConfigured()) {
      return res.json({ ok: true, status: 'unconfigured' });
    }
    const tv = await smartthingsService.getTvStatus();
    res.json({ ok: true, status: 'connected', tv });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/smartthings/power — body: { on: boolean }
router.post('/power', async (req, res) => {
  try {
    const { on } = req.body || {};
    if (typeof on !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'El camp "on" ha de ser true o false' });
    }
    await smartthingsService.setPower(on);
    discordService.notifyQuiet(`📺 **TV** ${on ? 'encesa ✅' : 'apagada ⭕'}`);
    res.json({ ok: true, on });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/smartthings/volume — body: { level: 0-100 } o { direction: "up"|"down" }
router.post('/volume', async (req, res) => {
  try {
    const { level, direction } = req.body || {};
    if (direction === 'up' || direction === 'down') {
      await smartthingsService.nudgeVolume(direction);
      return res.json({ ok: true, direction });
    }
    if (typeof level !== 'number' || !Number.isFinite(level)) {
      return res.status(400).json({
        ok: false,
        error: 'Cal "level" (0-100) o "direction" ("up"/"down")',
      });
    }
    await smartthingsService.setVolume(level);
    res.json({ ok: true, level: Math.round(level) });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/smartthings/mute — body: { muted: boolean }
router.post('/mute', async (req, res) => {
  try {
    const { muted } = req.body || {};
    if (typeof muted !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'El camp "muted" ha de ser true o false' });
    }
    await smartthingsService.setMute(muted);
    res.json({ ok: true, muted });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/smartthings/launch-app — body: { appId: "netflix" | app_id cru }
router.post('/launch-app', async (req, res) => {
  try {
    const { appId } = req.body || {};
    if (!appId || typeof appId !== 'string') {
      return res.status(400).json({ ok: false, error: 'Cal el camp "appId"' });
    }
    const result = await smartthingsService.launchApp(appId);
    discordService.notifyQuiet(`📺 **TV** → obrint ${appId}`);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// GET /api/smartthings/devices — tots els dispositius del compte vinculat
router.get('/devices', async (req, res) => {
  try {
    if (!smartthingsService.isConfigured()) {
      return res.status(503).json({ ok: false, error: 'SmartThings no configurat (revisa el .env)' });
    }
    const devices = await smartthingsService.listDevices();
    res.json({ ok: true, devices });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
