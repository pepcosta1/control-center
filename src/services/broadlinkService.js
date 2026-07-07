const fs = require('fs');
const path = require('path');
const broadlink = require('node-broadlink');
const config = require('../config');

/**
 * Servei Broadlink: enviament de codis IR ja apresos a través d'un RM4
 * (Mini o Pro) de la xarxa local. Reutilitzable per qualsevol aparell
 * only-IR (aire condicionat, llums, etc.).
 *
 * - Connexió per IP fixa (BROADLINK_IP al .env): el paquet de descobriment
 *   s'envia directament a la IP del dispositiu (unicast), més fiable que el
 *   broadcast a tota la xarxa.
 * - PROTOCOL LOCAL: com el Roomba i el Deco, el backend ha de tenir accés a
 *   la LAN de casa (des de la VM, via el subnet router de Tailscale).
 * - La connexió autenticada es reutilitza entre enviaments i es descarta si
 *   falla, per reconnectar al següent intent.
 */

const DISCOVER_TIMEOUT_MS = 1500;
const OP_TIMEOUT_MS = 6000;
const CODES_FILE = path.join(__dirname, '..', 'config', 'broadlinkCodes.json');

let devicePromise = null; // connexió en curs o establerta (es reusa)

function isConfigured() {
  return !!config.broadlink.ip;
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(httpError(message, 502)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function connect() {
  // Unicast: el "hello" va directe a la IP del Broadlink en lloc de broadcast
  const devices = await withTimeout(
    broadlink.discover(DISCOVER_TIMEOUT_MS, {
      address: '0.0.0.0',
      broadcastAddress: config.broadlink.ip,
    }),
    OP_TIMEOUT_MS,
    `El Broadlink (${config.broadlink.ip}) no respon: el backend arriba a la xarxa de casa?`
  );
  if (!devices.length) {
    throw httpError(
      `No s'ha trobat cap Broadlink a ${config.broadlink.ip} (revisa la IP i que el backend arribi a la xarxa de casa)`,
      502
    );
  }
  const device = devices[0];
  await withTimeout(device.auth(), OP_TIMEOUT_MS, 'El Broadlink no ha acceptat l\'autenticació');
  console.log(`[broadlink] Connectat: ${device.model || `tipus ${device.deviceType}`} a ${config.broadlink.ip}`);
  return device;
}

async function getDevice() {
  if (!isConfigured()) {
    throw httpError('Broadlink no configurat (afegeix BROADLINK_IP al .env)', 503);
  }
  if (!devicePromise) {
    devicePromise = connect().catch((err) => {
      devicePromise = null; // no deixis cachejada una connexió fallida
      throw err;
    });
  }
  return devicePromise;
}

// Envia un codi IR en hexadecimal (tal com l'exporta l'app de Broadlink)
async function sendCode(hex) {
  const clean = String(hex || '').replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]{8,}$/.test(clean)) {
    throw httpError('Codi IR invàlid (s\'espera una cadena hexadecimal)', 400);
  }
  const device = await getDevice();
  try {
    await withTimeout(
      device.sendData(clean),
      OP_TIMEOUT_MS,
      'El Broadlink no ha respost en enviar el codi IR'
    );
  } catch (err) {
    devicePromise = null; // força reconnexió al següent intent
    throw err.status ? err : httpError(`No s'ha pogut enviar el codi IR: ${err.message}`, 502);
  }
}

// Llegeix els codis IR de disc a cada crida (sense cache de require):
// així es poden enganxar codis nous sense reiniciar el servei
function readCodes() {
  try {
    return JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
  } catch (err) {
    console.warn(`[broadlink] No s'ha pogut llegir broadlinkCodes.json: ${err.message}`);
    return {};
  }
}

module.exports = {
  isConfigured,
  sendCode,
  readCodes,
};
