const config = require('../config');

/**
 * Servei Supabase: de moment, només verificació de credencials contra
 * Supabase Auth (proveïdor Email) per al login del panell.
 *
 * - Patró del projecte: fetch directe a l'API REST, sense dependència npm.
 * - El token que retorna Supabase es DESCARTA: la sessió del panell segueix
 *   sent l'express-session de sempre (vegeu routes/auth.js).
 * - Si Supabase no està configurat o no respon, el login cau al fallback
 *   local (usuari admin del .env) — porta d'emergència si el projecte
 *   gratuït està pausat o el servei caigut.
 */

const TIMEOUT_MS = 8000;

function isConfigured() {
  return !!(config.supabase.url && config.supabase.anonKey);
}

// Retorna { name } si les credencials són vàlides, null si són incorrectes,
// i llença error si Supabase no respon (per poder distingir-ho al fallback)
async function verifyCredentials(email, password) {
  const res = await fetch(`${config.supabase.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: config.supabase.anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const data = await res.json().catch(() => ({}));

  if (res.ok && data.user) {
    const meta = data.user.user_metadata || {};
    return { name: meta.display_name || meta.name || data.user.email || email };
  }
  // 400/401/422: credencials incorrectes (o email sense confirmar)
  if (res.status === 400 || res.status === 401 || res.status === 422) {
    return null;
  }
  // Qualsevol altra cosa (projecte pausat, 5xx…): tracta-ho com a caiguda
  throw new Error(`Supabase ha respost ${res.status}`);
}

module.exports = { isConfigured, verifyCredentials };
