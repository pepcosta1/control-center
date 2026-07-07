const express = require('express');
const acService = require('../services/acService');
const discordService = require('../services/discordService');

const router = express.Router();

// GET /api/ac/status — estat ASSUMIT (última ordre enviada; l'IR no confirma)
router.get('/status', (req, res) => {
  try {
    if (!acService.isConfigured()) {
      return res.json({ ok: true, status: 'unconfigured' });
    }
    res.json({ ok: true, status: 'assumed', ac: acService.getStatus() });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/ac/set — body: { power?: boolean, mode?: "cool", temp?: number }
router.post('/set', async (req, res) => {
  try {
    const { power, mode, temp } = req.body || {};
    if (power === undefined && mode === undefined && temp === undefined) {
      return res.status(400).json({ ok: false, error: 'Cal indicar "power", "mode" o "temp"' });
    }
    if (power !== undefined && typeof power !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'El camp "power" ha de ser true o false' });
    }
    if (temp !== undefined && (typeof temp !== 'number' || !Number.isFinite(temp))) {
      return res.status(400).json({ ok: false, error: 'El camp "temp" ha de ser un número' });
    }
    if (mode !== undefined && typeof mode !== 'string') {
      return res.status(400).json({ ok: false, error: 'El camp "mode" ha de ser text' });
    }

    const ac = await acService.setState({ power, mode, temp });
    discordService.notifyQuiet(
      ac.power
        ? `❄️ **Aire condicionat** a ${ac.temp} °C (${ac.mode})`
        : '❄️ **Aire condicionat** apagat ⭕'
    );
    res.json({ ok: true, ac });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
