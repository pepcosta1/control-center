const config = require('../config');

/**
 * Servei SmartThings: client de la SmartThings REST API per controlar la TV
 * Samsung (i, en el futur, altres dispositius vinculats al compte).
 *
 * - Autenticació amb un Personal Access Token (PAT) via .env, com a Bearer.
 * - Segueix el mateix patró que tuyaService.js: fetch directe contra l'API,
 *   sense cap dependència npm.
 * - Els errors es converteixen en missatges entenedors amb codi HTTP i mai
 *   fan petar el servidor (sempre es propaguen com a Error amb .status).
 *
 * Docs: https://developer.smartthings.com/docs/api/public
 */

const API_BASE = 'https://api.smartthings.com/v1';

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

function isConfigured() {
  return !!(config.smartthings.pat && config.smartthings.deviceId);
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function request(method, path, bodyObj) {
  if (!config.smartthings.pat) {
    throw httpError('SmartThings no configurat (revisa el .env)', 503);
  }

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${config.smartthings.pat}`,
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
      throw httpError('PAT de SmartThings invàlid o caducat', 401);
    }
    if (res.status === 403) {
      throw httpError('El PAT no té permisos suficients per a aquesta acció', 403);
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
  getTvStatus,
  setPower,
  setVolume,
  nudgeVolume,
  setMute,
  launchApp,
  listDevices,
  APP_IDS,
};
