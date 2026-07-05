const config = require('../config');

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  // Els dispositius amb accés limitat entren sense login (només endolls i llista)
  if (isRestricted(req)) {
    return next();
  }
  res.status(401).json({ ok: false, error: 'No autenticat' });
}

function getClientIp(req) {
  // Amb trust proxy, req.ip ja és la IP del client (X-Forwarded-For de tailscale serve)
  return (req.ip || '').replace(/^::ffff:/, '');
}

function isRestricted(req) {
  return config.restrictedIps.includes(getClientIp(req));
}

// Bloqueja les rutes sensibles per als dispositius amb accés limitat
function blockRestricted(req, res, next) {
  if (isRestricted(req)) {
    return res.status(403).json({ ok: false, error: 'Aquest dispositiu no té accés a aquesta funció' });
  }
  next();
}

module.exports = { requireAuth, isRestricted, blockRestricted, getClientIp };
