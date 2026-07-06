const crypto = require('crypto');
const config = require('../config');

/**
 * Servei Tuya: client de la Tuya Cloud API (OpenAPI) per al termòstat Garza.
 *
 * - Autenticació amb signatura HMAC-SHA256 (mètode v2 de Tuya) i token
 *   temporal que es renova automàticament quan caduca o és rebutjat.
 * - Les temperatures de Tuya venen escalades (p. ex. 215 = 21,5 °C); l'escala
 *   es llegeix de l'especificació del dispositiu i, si no està disponible,
 *   es dedueix heurísticament dels valors actuals.
 */

const REGION_HOSTS = {
  eu: 'https://openapi.tuyaeu.com',
  us: 'https://openapi.tuyaus.com',
  cn: 'https://openapi.tuyacn.com',
  in: 'https://openapi.tuyain.com',
};

// Codis de propietat (DP) habituals per a l'interruptor dels termòstats Tuya
const SWITCH_CODES = ['switch', 'switch_1', 'switch_on', 'power'];

const TUYA_TOKEN_INVALID = 1010;

const token = { value: null, uid: null, expiresAt: 0, pending: null };

// Codis i escales del termòstat; es carrega un cop i es completa amb l'estat real
let spec = null;

function isConfigured() {
  return !!(config.tuya.accessId && config.tuya.accessSecret && config.tuya.deviceId);
}

function baseUrl() {
  return REGION_HOSTS[config.tuya.region] || REGION_HOSTS.eu;
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

// Signatura v2: HMAC-SHA256(client_id + access_token + t + stringToSign, secret)
function buildHeaders(method, pathWithQuery, body, accessToken) {
  const t = String(Date.now());
  const stringToSign = [method, sha256(body || ''), '', pathWithQuery].join('\n');
  const sign = crypto
    .createHmac('sha256', config.tuya.accessSecret)
    .update(config.tuya.accessId + (accessToken || '') + t + stringToSign, 'utf8')
    .digest('hex')
    .toUpperCase();

  const headers = {
    client_id: config.tuya.accessId,
    sign,
    t,
    sign_method: 'HMAC-SHA256',
    'Content-Type': 'application/json',
  };
  if (accessToken) headers.access_token = accessToken;
  return headers;
}

async function rawRequest(method, pathWithQuery, body, accessToken) {
  const res = await fetch(baseUrl() + pathWithQuery, {
    method,
    headers: buildHeaders(method, pathWithQuery, body, accessToken),
    body: body || undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const err = httpError(`Tuya: ${data.msg || `error ${res.status}`}`, 502);
    err.code = data.code;
    throw err;
  }
  return data.result;
}

async function getToken() {
  if (token.value && Date.now() < token.expiresAt) return token.value;
  if (!token.pending) {
    token.pending = rawRequest('GET', '/v1.0/token?grant_type=1', '', null)
      .then((result) => {
        token.value = result.access_token;
        token.uid = result.uid;
        token.expiresAt = Date.now() + ((result.expire_time || 7200) - 60) * 1000;
        return token.value;
      })
      .finally(() => {
        token.pending = null;
      });
  }
  return token.pending;
}

async function apiRequest(method, pathWithQuery, bodyObj) {
  if (!isConfigured()) {
    throw httpError('Tuya no configurat (revisa el .env)', 503);
  }
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const accessToken = await getToken();
  try {
    return await rawRequest(method, pathWithQuery, body, accessToken);
  } catch (err) {
    if (err.code !== TUYA_TOKEN_INVALID) throw err;
    // Token rebutjat pel servidor: se'n demana un de nou i es reintenta un cop
    token.value = null;
    token.expiresAt = 0;
    return rawRequest(method, pathWithQuery, body, await getToken());
  }
}

function parseValues(json) {
  try {
    return JSON.parse(json || '{}');
  } catch (e) {
    return {};
  }
}

async function getSpec() {
  if (spec) return spec;
  const s = {
    trusted: false,
    switchCode: null,
    tempSetCode: 'temp_set',
    tempCurrentCode: 'temp_current',
    modeCode: null,
    setDiv: null, // divisor d'escala (10^scale); null = pendent de deduir
    curDiv: null,
    min: 5,
    max: 35,
    step: 0.5,
  };

  try {
    const result = await apiRequest('GET', `/v1.0/devices/${config.tuya.deviceId}/specifications`);
    for (const fn of result.functions || []) {
      if (!s.switchCode && SWITCH_CODES.includes(fn.code)) s.switchCode = fn.code;
      if (fn.code === 'mode') s.modeCode = 'mode';
      if (fn.code === s.tempSetCode) {
        const v = parseValues(fn.values);
        s.setDiv = Math.pow(10, v.scale || 0);
        if (typeof v.min === 'number') s.min = v.min / s.setDiv;
        if (typeof v.max === 'number') s.max = v.max / s.setDiv;
        if (typeof v.step === 'number' && v.step > 0) s.step = v.step / s.setDiv;
        s.trusted = true;
      }
    }
    for (const st of result.status || []) {
      if (st.code === s.tempCurrentCode) {
        const v = parseValues(st.values);
        s.curDiv = Math.pow(10, v.scale || 0);
      }
    }
  } catch (err) {
    console.warn(`[tuya] No s'ha pogut llegir l'especificació (${err.message}); s'usen valors heurístics`);
  }

  spec = s;
  return s;
}

// Sense especificació fiable, un valor >= 50 segur que està escalat ×10
// (cap habitatge és a 50 °C; 215 vol dir 21,5 °C)
function inferDivisor(raw) {
  return typeof raw === 'number' && Math.abs(raw) >= 50 ? 10 : 1;
}

async function getThermostat() {
  const [s, device] = await Promise.all([
    getSpec(),
    apiRequest('GET', `/v1.0/devices/${config.tuya.deviceId}`),
  ]);

  const status = {};
  (device.status || []).forEach((item) => {
    status[item.code] = item.value;
  });

  // Completa el que l'especificació no hagi aclarit amb l'estat real
  if (!s.switchCode) {
    s.switchCode = SWITCH_CODES.find((c) => typeof status[c] === 'boolean') || 'switch';
  }
  if (!s.modeCode && typeof status.mode === 'string') s.modeCode = 'mode';
  const rawTarget = status[s.tempSetCode];
  const rawCurrent = status[s.tempCurrentCode];
  if (!s.setDiv) s.setDiv = inferDivisor(rawTarget);
  if (!s.curDiv) s.curDiv = inferDivisor(rawCurrent);

  return {
    id: device.id,
    name: device.name || 'Termòstat',
    online: device.online !== false,
    on: typeof status[s.switchCode] === 'boolean' ? status[s.switchCode] : null,
    currentTemp: typeof rawCurrent === 'number' ? rawCurrent / s.curDiv : null,
    targetTemp: typeof rawTarget === 'number' ? rawTarget / s.setDiv : null,
    mode: s.modeCode ? status[s.modeCode] || null : null,
    minTemp: s.min,
    maxTemp: s.max,
    step: s.step,
  };
}

async function sendCommands(commands) {
  await apiRequest('POST', `/v1.0/devices/${config.tuya.deviceId}/commands`, { commands });
}

async function setPower(on) {
  const s = await getSpec();
  if (!s.switchCode) await getThermostat(); // dedueix el codi de l'interruptor
  await sendCommands([{ code: s.switchCode || 'switch', value: on }]);
}

async function setTemperature(temperature) {
  const s = await getSpec();
  if (temperature < s.min || temperature > s.max) {
    throw httpError(`La temperatura ha d'estar entre ${s.min} i ${s.max} °C`, 400);
  }
  if (!s.setDiv) await getThermostat(); // dedueix l'escala del valor actual
  await sendCommands([{ code: s.tempSetCode, value: Math.round(temperature * (s.setDiv || 1)) }]);
}

async function listDevices() {
  await getToken(); // el llistat penja de l'uid del compte vinculat, que ve amb el token
  if (!token.uid) {
    throw httpError("Tuya no ha retornat cap uid: revisa que el compte de l'app estigui vinculat al projecte", 502);
  }
  const result = await apiRequest('GET', `/v1.0/users/${token.uid}/devices`);
  return (result || []).map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    product: d.product_name,
    online: d.online !== false,
  }));
}

module.exports = {
  isConfigured,
  getThermostat,
  setPower,
  setTemperature,
  listDevices,
};
