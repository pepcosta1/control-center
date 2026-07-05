function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.status(401).json({ ok: false, error: 'No autenticat' });
}

module.exports = { requireAuth };
