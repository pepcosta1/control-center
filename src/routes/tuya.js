const express = require('express');
const tuyaService = require('../services/tuyaService');
const discordService = require('../services/discordService');

const router = express.Router();

// GET /api/tuya/status — estat del termòstat (temperatura actual/objectiu, on/off, mode)
router.get('/status', async (req, res) => {
  try {
    if (!tuyaService.isConfigured()) {
      return res.json({ ok: true, status: 'unconfigured' });
    }
    const thermostat = await tuyaService.getThermostat();
    res.json({ ok: true, status: 'connected', thermostat });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/tuya/power — body: { on: boolean }
router.post('/power', async (req, res) => {
  try {
    const { on } = req.body || {};
    if (typeof on !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'El camp "on" ha de ser true o false' });
    }
    await tuyaService.setPower(on);
    discordService.notifyQuiet(`🔥 **Calefacció** ${on ? 'engegada ✅' : 'apagada ⭕'}`);
    res.json({ ok: true, on });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/tuya/temperature — body: { temperature: number }
router.post('/temperature', async (req, res) => {
  try {
    const { temperature } = req.body || {};
    if (typeof temperature !== 'number' || !Number.isFinite(temperature)) {
      return res.status(400).json({ ok: false, error: 'El camp "temperature" ha de ser un número' });
    }
    await tuyaService.setTemperature(temperature);
    discordService.notifyQuiet(`🌡️ **Calefacció** a ${temperature} °C`);
    res.json({ ok: true, temperature });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// GET /api/tuya/devices — tots els dispositius Tuya del compte vinculat
router.get('/devices', async (req, res) => {
  try {
    if (!tuyaService.isConfigured()) {
      return res.status(503).json({ ok: false, error: 'Tuya no configurat (revisa el .env)' });
    }
    const devices = await tuyaService.listDevices();
    res.json({ ok: true, devices });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
