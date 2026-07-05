require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const config = require('./src/config');
const { requireAuth } = require('./src/middleware/auth');
const merossService = require('./src/services/merossService');

const app = express();

// Darrere de Nginx cal confiar en el primer proxy perquè les cookies "secure" funcionin
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json());

app.use(
  session({
    name: 'cc.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.env === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dies
    },
  })
);

// --- API ---
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/meross', requireAuth, require('./src/routes/meross'));
app.use('/api/spotify', requireAuth, require('./src/routes/spotify'));
app.use('/api/discord', requireAuth, require('./src/routes/discord'));

// 404 JSON per a rutes /api desconegudes
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Ruta no trobada' });
});

// --- Frontend estàtic (PWA) ---
app.use(express.static(path.join(__dirname, 'public')));

// Gestor d'errors global: sempre JSON per a /api
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (req.path.startsWith('/api')) {
    return res.status(err.status || 500).json({ ok: false, error: err.message || 'Error intern' });
  }
  res.status(500).send('Error intern del servidor');
});

app.listen(config.port, config.host, () => {
  console.log(`Centre de control escoltant a http://${config.host}:${config.port} (${config.env})`);
});

// Inicialitza els serveis en segon pla; si un falla, el servidor segueix viu
merossService.init().catch((err) => {
  console.error('[meross] No s\'ha pogut inicialitzar:', err.message);
});
require('./src/services/discordService').init().catch((err) => {
  console.error('[discord] No s\'ha pogut inicialitzar:', err.message);
});
