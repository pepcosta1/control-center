require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  sessionSecret: process.env.SESSION_SECRET || '',
  admin: {
    user: process.env.ADMIN_USER || 'admin',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
  },
  // IPs (de Tailscale o locals) amb accés limitat: només endolls i llista de la compra
  restrictedIps: (process.env.RESTRICTED_IPS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  meross: {
    email: process.env.MEROSS_EMAIL || '',
    password: process.env.MEROSS_PASSWORD || '',
  },
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || '',
  },
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || '',
    channelId: process.env.DISCORD_CHANNEL_ID || '',
  },
};

if (!config.sessionSecret) {
  if (config.env === 'production') {
    throw new Error('Falta SESSION_SECRET al .env (obligatori en producció)');
  }
  console.warn('[config] SESSION_SECRET no definit; s\'usa un valor de desenvolupament');
  config.sessionSecret = 'dev-secret-no-usar-en-produccio';
}

module.exports = config;
