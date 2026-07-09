const config = require('../config');
const store = require('./store');

/**
 * Servei SmartThings: client de la SmartThings REST API per controlar la TV
 * Samsung (i, en el futur, altres dispositius vinculats al compte).
 *
 * - Autenticació preferida: OAuth (SMARTTHINGS_CLIENT_ID/SECRET/REDIRECT_URI
 *   al .env; tokens a data/store.json amb refresc automàtic, com Spotify).
 *   Els PAT creats des de finals del 2024 caduquen a les 24h, per això només
 *   queden com a alternativa (SMARTTHINGS_PAT).
 * - El refresh token de SmartThings ROTA a cada refresc i caduca als 30 dies
 *   si no s'usa: un temporitzador de manteniment el refresca cada 12h.
 * - Segueix el mateix patró que tuyaService.js: fetch directe contra l'API,
 *   sense cap dependència npm.
 * - Els errors es converteixen en missatges entenedors amb codi HTTP i mai
 *   fan petar el servidor (sempre es propaguen com a Error amb .status).
 *
 * Docs: https://developer.smartthings.com/docs/api/public
 */

const API_BASE = 'https://api.smartthings.com/v1';
const AUTH_BASE = 'https://api.smartthings.com';
const OAUTH_SCOPES = 'r:devices:* x:devices:*';
const TOKEN_KEY = 'smartthingsTokens';
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // renova 5 min abans de caducar

// Noms amistosos → app_id de Tizen (Samsung). Es poden afegir més o passar
// directament un app_id cru al body de /launch-app. Aquests valors són els
// habituals però poden variar segons el model de TV; ajusta'ls si cal.
const APP_IDS = {
  netflix: '3201907018807',
  primevideo: '3201910019365',
  'prime-video': '3201910019365',
  disney: '3201901017640',
  'disney+': '3201901017640',
  disneyplus: '3201901017640',
  youtube: '111299001912',
  appletv: '3201807016597',
  'apple-tv': '3201807016597',
  spotify: '3201606009684',
};

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

// --- OAuth ---------------------------------------------------------

function oauthConfigured() {
  const s = config.smartthings;
  return !!(s.clientId && s.clientSecret && s.redirectUri);
}

function hasTokens() {
  return !!store.get(TOKEN_KEY);
}

function isConfigured() {
  return !!(config.smartthings.deviceId && (config.smartthings.pat || oauthConfigured()));
}

// Cal que l'usuari passi per /api/smartthings/login? (OAuth a punt però sense tokens)
function needsAuthorization() {
  return oauthConfigured() && !hasTokens() && !config.smartthings.pat;
}

function getAuthUrl() {
  if (!oauthConfigured()) {
    throw httpError('OAuth de SmartThings no configurat (SMARTTHINGS_CLIENT_ID/SECRET/REDIRECT_URI al .env)', 503);
  }
  const params = new URLSearchParams({
    client_id: config.smartthings.clientId,
    response_type: 'code',
    redirect_uri: config.smartthings.redirectUri,
    scope: OAUTH_SCOPES,
  });
  return `${AUTH_BASE}/oauth/authorize?${params}`;
}

async function tokenRequest(params) {
  const basic = Buffer.from(
    `${config.smartthings.clientId}:${config.smartthings.clientSecret}`
  ).toString('base64');
  let res;
  try {
    res = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    });
  } catch (err) {
    throw httpError(`No s'ha pogut contactar amb SmartThings (OAuth): ${err.message}`, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error_description || data.error || `error ${res.status}`;
    throw httpError(`SmartThings OAuth: ${msg}`, res.status === 400 || res.status === 401 ? 401 : 502);
  }
  return data;
}

function saveTokens(data, prev) {
  store.set(TOKEN_KEY, {
    access_token: data.access_token,
    // El refresh token ROTA: si no en ve un de nou, conserva l'anterior
    refresh_token: data.refresh_token || (prev && prev.refresh_token) || null,
    expires_at: Date.now() + (data.expires_in ? data.expires_in * 1000 : 24 * 3600 * 1000),
  });
}

// Bescanvia el codi del callback per tokens (un sol cop, en autoritzar)
async function handleCallback(code) {
  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: config.smartthings.clientId,
    redirect_uri: config.smartthings.redirectUri,
  });
  saveTokens(data, null);
  console.log('[smartthings] Autoritzat via OAuth; tokens desats a data/store.json');
}

let refreshPromise = null; // evita refrescos simultanis (el refresh token rota!)
function refreshTokens() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const prev = store.get(TOKEN_KEY);
      if (!prev || !prev.refresh_token) {
        throw httpError("SmartThings sense autoritzar: obre /api/smartthings/login", 401);
      }
      const data = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: prev.refresh_token,
        client_id: config.smartthings.clientId,
      });
      saveTokens(data, prev);
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function getAccessToken() {
  if (oauthConfigured() && hasTokens()) {
    let tokens = store.get(TOKEN_KEY);
    if (Date.now() > tokens.expires_at - REFRESH_MARGIN_MS) {
      await refreshTokens();
      tokens = store.get(TOKEN_KEY);
    }
    return tokens.access_token;
  }
  if (config.smartthings.pat) return config.smartthings.pat;
  if (oauthConfigured()) {
    throw httpError("SmartThings sense autoritzar: obre /api/smartthings/login", 401);
  }
  throw httpError('SmartThings no configurat (revisa el .env)', 503);
}

// Manteniment: el refresh token caduca als 30 dies si no s'usa; refrescant
// cada 12h es manté viu encara que no s'obri mai la vista TV
if (oauthConfigured()) {
  const keepalive = setInterval(() => {
    if (hasTokens()) {
      refreshTokens().catch((err) => console.warn(`[smartthings] keepalive: ${err.message}`));
    }
  }, 12 * 3600 * 1000);
  if (keepalive.unref) keepalive.unref();
}

// --- Client HTTP ---------------------------------------------------

async function request(method, path, bodyObj, retrying = false) {
  const token = await getAccessToken();

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });
  } catch (err) {
    // Error de xarxa (DNS, timeout…): no fem petar el servidor
    throw httpError(`No s'ha pogut contactar amb SmartThings: ${err.message}`, 502);
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) {
      // Amb OAuth: prova un refresc forçat i reintenta un sol cop
      if (!retrying && oauthConfigured() && hasTokens()) {
        try { await refreshTokens(); } catch (e) { throw httpError(`${e.message}`, 401); }
        return request(method, path, bodyObj, true);
      }
      throw httpError(
        oauthConfigured()
          ? "Autorització de SmartThings caducada: torna a passar per /api/smartthings/login"
          : 'PAT de SmartThings invàlid o caducat',
        401
      );
    }
    if (res.status === 403) {
      throw httpError('El token no té permisos suficients per a aquesta acció', 403);
    }
    if (res.status === 404) {
      throw httpError('Dispositiu SmartThings no trobat (revisa el device_id)', 404);
    }
    if (res.status === 409) {
      // Conflicte típic: la TV està apagada i no accepta l'ordre
      throw httpError('El dispositiu no respon (potser està apagat)', 409);
    }
    const msg = (data && (data.error && data.error.message)) || data.message || `error ${res.status}`;
    throw httpError(`SmartThings: ${msg}`, 502);
  }

  return data;
}

// Envia una o més ordres a un dispositiu (per defecte, la TV configurada)
async function sendCommands(commands, deviceId = config.smartthings.deviceId) {
  if (!deviceId) throw httpError('Falta el device_id de la TV al .env', 503);
  await request('POST', `/devices/${deviceId}/commands`, { commands });
}

// Llegeix un atribut del component "main" de la resposta d'estat
function readAttr(components, capability, attribute) {
  const main = (components && components.main) || {};
  const cap = main[capability];
  if (!cap || !cap[attribute]) return undefined;
  return cap[attribute].value;
}

async function getTvStatus() {
  const deviceId = config.smartthings.deviceId;
  if (!deviceId) throw httpError('Falta el device_id de la TV al .env', 503);

  // Estat i salut (online/offline) en paral·lel; la salut és opcional
  const [status, health] = await Promise.all([
    request('GET', `/devices/${deviceId}/status`),
    request('GET', `/devices/${deviceId}/health`).catch(() => null),
  ]);

  const components = status.components || {};
  const power = readAttr(components, 'switch', 'switch'); // "on" | "off"
  const volume = readAttr(components, 'audioVolume', 'volume');
  const mute = readAttr(components, 'audioMute', 'mute'); // "muted" | "unmuted"
  const inputSource =
    readAttr(components, 'samsungvd.mediaInputSource', 'inputSource') ||
    readAttr(components, 'mediaInputSource', 'inputSource') ||
    null;
  // L'app en execució no sempre és llegible via API; ho intentem i, si no, null
  const app =
    readAttr(components, 'custom.launchapp', 'appName') ||
    readAttr(components, 'samsungvd.mediaInputSource', 'appName') ||
    null;

  return {
    id: deviceId,
    online: health ? health.state === 'ONLINE' : true,
    power: power === 'on' ? true : power === 'off' ? false : null,
    volume: typeof volume === 'number' ? volume : null,
    muted: mute === 'muted',
    inputSource,
    app,
  };
}

async function setPower(on) {
  await sendCommands([
    { component: 'main', capability: 'switch', command: on ? 'on' : 'off' },
  ]);
}

// Volum absolut (0–100). Accepta també direcció relativa via setVolume nadiu.
async function setVolume(level) {
  const value = Math.round(level);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw httpError('El volum ha de ser un número entre 0 i 100', 400);
  }
  await sendCommands([
    { component: 'main', capability: 'audioVolume', command: 'setVolume', arguments: [value] },
  ]);
}

// Puja/baixa un pas amb les ordres natives volumeUp/volumeDown
async function nudgeVolume(direction) {
  const command = direction === 'down' ? 'volumeDown' : 'volumeUp';
  await sendCommands([{ component: 'main', capability: 'audioVolume', command }]);
}

async function setMute(muted) {
  await sendCommands([
    { component: 'main', capability: 'audioMute', command: muted ? 'mute' : 'unmute' },
  ]);
}

async function launchApp(appId) {
  const raw = String(appId || '').trim();
  if (!raw) throw httpError('Falta el paràmetre "appId"', 400);
  // Accepta un nom amistós (netflix, disney+…) o un app_id cru
  const resolved = APP_IDS[raw.toLowerCase()] || raw;
  await sendCommands([
    { component: 'main', capability: 'custom.launchapp', command: 'launchApp', arguments: [resolved] },
  ]);
  return { appId: resolved };
}

// Llista tots els dispositius del compte vinculat (per afegir-ne més en el futur)
async function listDevices() {
  const data = await request('GET', '/devices');
  return (data.items || []).map((d) => ({
    id: d.deviceId,
    name: d.label || d.name,
    type: d.deviceTypeName || (d.deviceManufacturerCode ? 'dispositiu' : 'desconegut'),
    isTv: d.deviceId === config.smartthings.deviceId,
  }));
}

module.exports = {
  isConfigured,
  needsAuthorization,
  getAuthUrl,
  handleCallback,
  getTvStatus,
  setPower,
  setVolume,
  nudgeVolume,
  setMute,
  launchApp,
  listDevices,
  APP_IDS,
};
