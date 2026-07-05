const MerossCloud = require('meross-cloud');
const config = require('../config');

/**
 * Servei Meross: manté una connexió persistent amb el núvol de Meross,
 * una memòria cau de dispositius i el seu estat (on/off per canal).
 *
 * Estats del servei:
 *  - unconfigured: falten MEROSS_EMAIL / MEROSS_PASSWORD al .env
 *  - connecting / connected / error
 */

const state = {
  status: 'disconnected',
  error: null,
};

// deviceId -> { id, def, device, online, channels: [{ channel, name, onoff }] }
const devices = new Map();

let meross = null;

function buildChannels(deviceDef) {
  const defChannels = Array.isArray(deviceDef.channels) && deviceDef.channels.length > 0
    ? deviceDef.channels
    : [{}];
  return defChannels.map((ch, i) => ({
    channel: i,
    name: (ch && ch.devName) || (i === 0 ? deviceDef.devName : `Canal ${i}`),
    onoff: null, // desconegut fins que arribi el primer estat
  }));
}

function applyToggleState(entry, item) {
  // item: { channel, onoff } (onoff: 1 encès, 0 apagat)
  const ch = entry.channels.find((c) => c.channel === (item.channel || 0));
  if (ch) {
    ch.onoff = item.onoff ? 1 : 0;
  }
}

function parseDigest(entry, all) {
  const digest = all && all.all && all.all.digest;
  if (!digest) return;
  if (Array.isArray(digest.togglex)) {
    digest.togglex.forEach((item) => applyToggleState(entry, item));
  } else if (digest.togglex) {
    applyToggleState(entry, digest.togglex);
  } else if (digest.toggle) {
    // Dispositius antics d'un sol canal (Appliance.Control.Toggle)
    applyToggleState(entry, { channel: 0, onoff: digest.toggle.onoff });
  }
}

function handlePush(entry, namespace, payload) {
  if (!payload) return;
  if (namespace === 'Appliance.Control.ToggleX' && payload.togglex) {
    const items = Array.isArray(payload.togglex) ? payload.togglex : [payload.togglex];
    items.forEach((item) => applyToggleState(entry, item));
  } else if (namespace === 'Appliance.Control.Toggle' && payload.toggle) {
    applyToggleState(entry, { channel: 0, onoff: payload.toggle.onoff });
  } else if (namespace === 'Appliance.System.Online' && payload.online) {
    entry.online = payload.online.status === 1;
  }
}

function refreshDevice(deviceId) {
  const entry = devices.get(deviceId);
  if (!entry) return Promise.reject(new Error('Dispositiu desconegut'));
  return new Promise((resolve, reject) => {
    entry.device.getSystemAllData((err, data) => {
      if (err) return reject(new Error(`No s'ha pogut llegir l'estat: ${err.message || err}`));
      parseDigest(entry, data);
      resolve(serializeDevice(entry));
    });
  });
}

function serializeDevice(entry) {
  return {
    id: entry.id,
    name: entry.def.devName || entry.id,
    type: entry.def.deviceType || 'desconegut',
    online: entry.online,
    channels: entry.channels.map((c) => ({ channel: c.channel, name: c.name, onoff: c.onoff })),
  };
}

async function init() {
  if (!config.meross.email || !config.meross.password) {
    state.status = 'unconfigured';
    console.warn('[meross] MEROSS_EMAIL/MEROSS_PASSWORD no configurats; mòdul desactivat');
    return;
  }

  state.status = 'connecting';
  meross = new MerossCloud({
    email: config.meross.email,
    password: config.meross.password,
    logger: () => {},
    localHandlerEnabled: false,
    timeout: 15000,
  });

  meross.on('deviceInitialized', (deviceId, deviceDef, device) => {
    const entry = {
      id: deviceId,
      def: deviceDef,
      device,
      online: deviceDef.onlineStatus === 1,
      channels: buildChannels(deviceDef),
    };
    devices.set(deviceId, entry);
    console.log(`[meross] Dispositiu trobat: ${deviceDef.devName} (${deviceDef.deviceType})`);

    device.on('connected', () => {
      entry.online = true;
      refreshDevice(deviceId).catch((err) => {
        console.warn(`[meross] ${deviceDef.devName}: ${err.message}`);
      });
    });
    device.on('close', () => {
      entry.online = false;
    });
    device.on('error', (err) => {
      console.warn(`[meross] ${deviceDef.devName} error:`, err && err.message ? err.message : err);
    });
    device.on('data', (namespace, payload) => handlePush(entry, namespace, payload));
  });

  meross.on('error', (err) => {
    console.error('[meross] Error de connexió:', err && err.message ? err.message : err);
  });

  await new Promise((resolve, reject) => {
    meross.connect((err) => {
      if (err) {
        state.status = 'error';
        state.error = err.message || String(err);
        return reject(err instanceof Error ? err : new Error(String(err)));
      }
      resolve();
    });
  });

  state.status = 'connected';
  state.error = null;
  console.log(`[meross] Connectat (${devices.size} dispositius)`);
}

function getStatus() {
  return { status: state.status, error: state.error, deviceCount: devices.size };
}

function listDevices() {
  return Array.from(devices.values()).map(serializeDevice);
}

function toggle(deviceId, channel, on) {
  const entry = devices.get(deviceId);
  if (!entry) return Promise.reject(Object.assign(new Error('Dispositiu no trobat'), { status: 404 }));
  if (!entry.online) return Promise.reject(Object.assign(new Error('El dispositiu està fora de línia'), { status: 409 }));

  return new Promise((resolve, reject) => {
    entry.device.controlToggleX(channel, on ? 1 : 0, (err) => {
      if (err) return reject(new Error(`No s'ha pogut canviar l'estat: ${err.message || err}`));
      applyToggleState(entry, { channel, onoff: on ? 1 : 0 });
      resolve(serializeDevice(entry));
    });
  });
}

module.exports = {
  init,
  getStatus,
  listDevices,
  toggle,
  refreshDevice,
  isReady: () => state.status === 'connected',
};
