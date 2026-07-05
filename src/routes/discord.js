const express = require('express');
const discord = require('../services/discordService');

const router = express.Router();

// GET /api/discord/status
router.get('/status', (req, res) => {
  res.json({ ok: true, ...discord.getStatus() });
});

// POST /api/discord/notify — body: { message, channelId? }
router.post('/notify', async (req, res) => {
  try {
    const { message, channelId } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ ok: false, error: 'Falta el camp "message"' });
    }
    await discord.notify(message, channelId);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
