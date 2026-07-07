const express = require('express');
const broadlinkService = require('../services/broadlinkService');
const discordService = require('../services/discordService');

const router = express.Router();

// Comandes IR enviables directament: totes les seccions del fitxer de codis
// excepte "ac" (que té el seu propi servei amb estat assumit) i les claus
// d'ajuda. Només es llisten les que ja tenen codi après (no buit).
function flatCommands() {
  const out = {};
  Object.entries(broadlinkService.readCodes()).forEach(([section, cmds]) => {
    if (section.startsWith('_') || section === 'ac') return;
    if (cmds && typeof cmds === 'object') {
      Object.entries(cmds).forEach(([name, hex]) => {
        if (hex) out[name] = hex;
      });
    }
  });
  return out;
}

// GET /api/broadlink/commands — noms de les comandes disponibles
router.get('/commands', (req, res) => {
  try {
    res.json({
      ok: true,
      configured: broadlinkService.isConfigured(),
      commands: Object.keys(flatCommands()),
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/broadlink/send — body: { command: "llum_on" }
router.post('/send', async (req, res) => {
  try {
    const { command } = req.body || {};
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ ok: false, error: 'Cal el camp "command"' });
    }
    const hex = flatCommands()[command];
    if (!hex) {
      return res.status(404).json({
        ok: false,
        error: `Comanda desconeguda o sense codi après: "${command}" (revisa broadlinkCodes.json)`,
      });
    }
    await broadlinkService.sendCode(hex);
    discordService.notifyQuiet(`💡 **IR** → ${command}`);
    res.json({ ok: true, command });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
