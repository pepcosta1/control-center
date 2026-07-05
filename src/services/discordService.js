const { Client, GatewayIntentBits, Events } = require('discord.js');
const config = require('../config');

/**
 * Servei Discord: bot connectat via discord.js que envia notificacions
 * al canal configurat (DISCORD_CHANNEL_ID).
 */

const state = {
  status: 'disconnected', // unconfigured | connecting | connected | error
  error: null,
  botTag: null,
};

let client = null;

async function init() {
  if (!config.discord.botToken) {
    state.status = 'unconfigured';
    console.warn('[discord] DISCORD_BOT_TOKEN no configurat; mòdul desactivat');
    return;
  }

  state.status = 'connecting';
  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (c) => {
    state.status = 'connected';
    state.error = null;
    state.botTag = c.user.tag;
    console.log(`[discord] Bot connectat com a ${c.user.tag}`);
  });

  client.on(Events.Error, (err) => {
    console.error('[discord] Error:', err.message);
  });

  try {
    await client.login(config.discord.botToken);
  } catch (err) {
    state.status = 'error';
    state.error = err.message;
    throw err;
  }
}

function getStatus() {
  return {
    status: state.status,
    error: state.error,
    botTag: state.botTag,
    channelConfigured: !!config.discord.channelId,
  };
}

async function notify(message, channelId) {
  if (state.status !== 'connected') {
    throw Object.assign(new Error('El bot de Discord no està connectat'), { status: 503 });
  }
  const targetId = channelId || config.discord.channelId;
  if (!targetId) {
    throw Object.assign(new Error('DISCORD_CHANNEL_ID no configurat al .env'), { status: 500 });
  }
  const channel = await client.channels.fetch(targetId);
  if (!channel || !channel.isTextBased()) {
    throw Object.assign(new Error('El canal no existeix o no és de text'), { status: 404 });
  }
  await channel.send(message);
}

// Variant silenciosa per a notificacions automàtiques (no ha de trencar mai la petició original)
function notifyQuiet(message) {
  notify(message).catch((err) => {
    console.warn('[discord] No s\'ha pogut enviar la notificació:', err.message);
  });
}

module.exports = { init, getStatus, notify, notifyQuiet };
