const crypto = require('crypto');
const http = require('http');
const https = require('https');
const config = require('../config');

/**
 * Servei TP-Link Deco: client de l'API local (no oficial) dels routers Deco.
 *
 * TP-Link no publica cap API: això és un port de la implementació per
 * enginyeria inversa d'amosyuen/ha-tplink-deco (Home Assistant), sense
 * dependències npm. El protocol pot trencar-se amb un firmware nou de
 * TP-Link; per això tots els errors es retornen nets, mai peten el servidor.
 *
 * Protocol: login xifrat (contrasenya amb RSA PKCS#1 v1.5, cos amb
 * AES-128-CBC, signatura RSA amb seq) contra el Deco principal; les crides
 * posteriors porten el token "stok" a la URL i la cookie "sysauth".
 * Mòdul NOMÉS de lectura: llista nodes, clients i detecta presència.
 */

const TIMEOUT_MS = 10000;

const session = {
  aesKey: null, // string de 16 dígits (també fa de clau AES en utf8)
  aesIv: null,
  passwordKey: null, // { n, e } en hex
  signKey: null,
  seq: null,
  stok: null,
  cookie: null,
  loginPromise: null,
};

function isConfigured() {
  return !!(config.deco.host && config.deco.password);
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function baseUrl() {
  const host = config.deco.host.replace(/\/+$/, '');
  return /^https?:\/\//.test(host) ? host : `http://${host}`;
}

function clearAuth() {
  session.seq = null;
  session.stok = null;
  session.cookie = null;
}

// --- Criptografia ---

function md5hex(text) {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

// TP-Link exigeix que la clau i l'IV d'AES siguin números de 16 dígits
function randomAesNumber() {
  let digits = String(crypto.randomInt(1, 10));
  for (let i = 0; i < 15; i++) digits += String(crypto.randomInt(0, 10));
  return digits;
}

// RSA PKCS#1 v1.5 per blocs, com ho fa el firmware (concatena l'hex de cada bloc)
function rsaEncrypt(key, plaintext) {
  const strip = (hex) => hex.replace(/^(00)+/, '');
  const toBuf = (hex) => Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
  const nBuf = toBuf(strip(key.n));
  const eBuf = toBuf(strip(key.e));
  const publicKey = crypto.createPublicKey({
    key: { kty: 'RSA', n: nBuf.toString('base64url'), e: eBuf.toString('base64url') },
    format: 'jwk',
  });

  const data = Buffer.from(plaintext, 'utf8');
  const chunkSize = nBuf.length - 11; // capçalera PKCS#1 v1.5
  let out = '';
  for (let i = 0; i < data.length; i += chunkSize) {
    out += crypto
      .publicEncrypt(
        { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
        data.subarray(i, i + chunkSize)
      )
      .toString('hex');
  }
  return out;
}

function aesEncrypt(plaintext) {
  const cipher = crypto.createCipheriv(
    'aes-128-cbc',
    Buffer.from(session.aesKey, 'utf8'),
    Buffer.from(session.aesIv, 'utf8')
  );
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');
}

function aesDecrypt(dataB64) {
  const decipher = crypto.createDecipheriv(
    'aes-128-cbc',
    Buffer.from(session.aesKey, 'utf8'),
    Buffer.from(session.aesIv, 'utf8')
  );
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

// --- HTTP (mòduls natius per poder acceptar el certificat autosignat del Deco) ---

function request(urlString, body, redirectsLeft = 2) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(session.cookie ? { Cookie: session.cookie } : {}),
        },
        rejectUnauthorized: false, // el Deco fa servir un certificat autosignat
        timeout: TIMEOUT_MS,
      },
      (res) => {
        // Alguns firmwares redirigeixen tot el http:// cap a https://
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const next = new URL(res.headers.location, url);
          return resolve(request(next.toString(), body, redirectsLeft - 1));
        }

        const setCookies = res.headers['set-cookie'] || [];
        for (const c of setCookies) {
          const m = /(sysauth=[a-f0-9]+)/.exec(c);
          if (m) session.cookie = m[1];
        }

        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            clearAuth();
            return reject(httpError(`El Deco ha rebutjat la petició (HTTP ${res.statusCode})`, 502));
          }
          if (res.statusCode !== 200) {
            return reject(httpError(`El Deco ha respost HTTP ${res.statusCode}`, 502));
          }
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(httpError('El Deco ha retornat una resposta no vàlida (canvi de firmware?)', 502));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => {
      clearAuth(); // per si el Deco s'ha reiniciat i la sessió ja no val
      reject(httpError(`No s'ha pogut connectar amb el Deco (${config.deco.host}): ${err.message}`, 502));
    });
    req.write(body);
    req.end();
  });
}

// --- Login ---

async function fetchKeys() {
  const res = await request(`${baseUrl()}/cgi-bin/luci/;stok=/login?form=keys`, '{"operation":"read"}');
  const keys = res && res.result && res.result.password;
  if (!Array.isArray(keys) || keys.length < 2) {
    throw httpError('El Deco no ha retornat les claus de login (canvi de firmware?)', 502);
  }
  session.passwordKey = { n: keys[0], e: keys[1] };
}

async function fetchAuth() {
  const res = await request(`${baseUrl()}/cgi-bin/luci/;stok=/login?form=auth`, '{"operation":"read"}');
  const result = res && res.result;
  if (!result || !Array.isArray(result.key) || typeof result.seq !== 'number') {
    throw httpError("El Deco no ha retornat la clau de signatura (canvi de firmware?)", 502);
  }
  session.signKey = { n: result.key[0], e: result.key[1] };
  session.seq = result.seq;
}

function encodePayload(payload) {
  const data = aesEncrypt(JSON.stringify(payload));
  const hash = md5hex(`${config.deco.username}${config.deco.password}`);
  const signText = `k=${session.aesKey}&i=${session.aesIv}&h=${hash}&s=${session.seq + data.length}`;
  const sign = rsaEncrypt(session.signKey, signText);
  return `sign=${sign}&data=${encodeURIComponent(data)}`;
}

function decryptData(res, context) {
  if (!res || !res.data) {
    clearAuth();
    throw httpError(`${context}: el Deco ha retornat dades buides (sessió caducada?)`, 502);
  }
  let parsed;
  try {
    parsed = JSON.parse(aesDecrypt(res.data));
  } catch (e) {
    clearAuth();
    throw httpError(`${context}: no s'ha pogut desxifrar la resposta del Deco`, 502);
  }
  if (parsed.error_code && parsed.error_code !== 0) {
    if (parsed.error_code === -5002) {
      clearAuth();
      throw httpError('El Deco ha rebutjat la contrasenya (revisa DECO_PASSWORD)', 502);
    }
    throw httpError(`${context}: el Deco ha retornat l'error ${parsed.error_code}`, 502);
  }
  return parsed;
}

async function doLogin() {
  session.aesKey = randomAesNumber();
  session.aesIv = randomAesNumber();
  await fetchKeys();
  await fetchAuth();

  const passwordEncrypted = rsaEncrypt(session.passwordKey, config.deco.password);
  const body = encodePayload({ params: { password: passwordEncrypted }, operation: 'login' });
  const res = await request(`${baseUrl()}/cgi-bin/luci/;stok=/login?form=login`, body);
  const data = decryptData(res, 'Login');
  if (!data.result || !data.result.stok) {
    throw httpError('El login amb el Deco no ha retornat cap token', 502);
  }
  session.stok = data.result.stok;
}

function login() {
  // Evita logins simultanis quan arriben peticions en paral·lel
  if (!session.loginPromise) {
    session.loginPromise = doLogin().finally(() => {
      session.loginPromise = null;
    });
  }
  return session.loginPromise;
}

async function apiCall(path, form, payload, retry = true) {
  if (!isConfigured()) {
    throw httpError('Deco no configurat (revisa el .env)', 503);
  }
  if (!session.stok) await login();
  try {
    const body = encodePayload(payload);
    const url = `${baseUrl()}/cgi-bin/luci/;stok=${session.stok}${path}?form=${form}`;
    return decryptData(await request(url, body), form);
  } catch (err) {
    // Sessió caducada o Deco reiniciat: es reintenta un cop amb login nou
    if (retry && !session.stok) {
      return apiCall(path, form, payload, false);
    }
    throw err;
  }
}

// --- Utilitats de mapeig ---

function decodeName(name) {
  if (!name || typeof name !== 'string') return name;
  if (name.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(name)) {
    try {
      const decoded = Buffer.from(name, 'base64').toString('utf8');
      if (decoded && !decoded.includes('�')) return decoded;
    } catch (e) { /* no era base64 */ }
  }
  return name;
}

// "living_room" -> "Living Room" (els nicknames de fàbrica van en snake_case)
function snakeToTitle(text) {
  if (!text) return text;
  return text
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function normalizeMac(mac) {
  return String(mac || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase();
}

function mapNode(d) {
  return {
    mac: d.mac,
    name: d.custom_nickname ? decodeName(d.custom_nickname) : snakeToTitle(d.nickname) || d.device_model,
    model: d.device_model || null,
    ip: d.device_ip || null,
    online: d.group_status === 'connected',
    master: d.role === 'master',
  };
}

function mapClient(c, node) {
  return {
    mac: c.mac,
    name: decodeName(c.name) || c.mac,
    ip: c.ip || null,
    online: c.online !== false,
    connection: c.connection_type || null, // wired | band2_4 | band5...
    node: node ? node.name : null,
  };
}

// --- API pública del servei ---

async function listNodes() {
  const data = await apiCall('/admin/device', 'device_list', { operation: 'read' });
  const list = (data.result && data.result.device_list) || [];
  return list.map(mapNode);
}

async function listClients(decoMac = 'default') {
  const data = await apiCall('/admin/client', 'client_list', {
    operation: 'read',
    params: { device_mac: decoMac },
  });
  return (data.result && data.result.client_list) || [];
}

// Tots els clients de la xarxa, amb el node al qual estan connectats
async function listAllClients() {
  const nodes = await listNodes();
  const clients = new Map();
  for (const node of nodes) {
    if (!node.online) continue;
    try {
      (await listClients(node.mac)).forEach((c) => {
        if (!clients.has(c.mac)) clients.set(c.mac, mapClient(c, node));
      });
    } catch (err) {
      console.warn(`[deco] No s'han pogut llegir els clients de ${node.name}: ${err.message}`);
    }
  }
  // Si cap consulta per node ha funcionat, prova la consulta global
  if (clients.size === 0) {
    (await listClients('default')).forEach((c) => {
      if (!clients.has(c.mac)) clients.set(c.mac, mapClient(c, null));
    });
  }
  return Array.from(clients.values());
}

async function checkPresence() {
  if (!config.deco.presenceMac) {
    throw httpError('DECO_PRESENCE_MAC no configurat al .env', 400);
  }
  const wanted = normalizeMac(config.deco.presenceMac);
  const clients = await listClients('default');
  const found = clients.find((c) => normalizeMac(c.mac) === wanted);
  return {
    present: !!(found && found.online !== false),
    client: found ? mapClient(found, null) : null,
  };
}

module.exports = {
  isConfigured,
  listNodes,
  listAllClients,
  checkPresence,
};
