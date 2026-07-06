const express = require('express');
const decoService = require('../services/decoService');
const config = require('../config');

const router = express.Router();

// GET /api/deco/status — configuració del mòdul (no toca la xarxa)
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    status: decoService.isConfigured() ? 'configured' : 'unconfigured',
    presenceConfigured: !!config.deco.presenceMac,
  });
});

// GET /api/deco/nodes — estat de cada node Deco de la malla
router.get('/nodes', async (req, res) => {
  try {
    const nodes = await decoService.listNodes();
    res.json({ ok: true, nodes });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// GET /api/deco/devices — dispositius connectats ara mateix a la xarxa
router.get('/devices', async (req, res) => {
  try {
    const devices = await decoService.listAllClients();
    res.json({ ok: true, devices });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// GET /api/deco/presence — el dispositiu de referència (DECO_PRESENCE_MAC) és a casa?
router.get('/presence', async (req, res) => {
  try {
    const presence = await decoService.checkPresence();
    res.json({ ok: true, ...presence });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
