const store = require('./store');
const broadlinkService = require('./broadlinkService');
const codes = require('../config/broadlinkCodes.json');

/**
 * Servei de l'aire condicionat (Panasonic, només IR via Broadlink RM4).
 *
 * L'IR és unidireccional: l'aparell no confirma res, així que es manté un
 * "estat ASSUMIT" (l'última ordre enviada) persistit a data/store.json.
 * Si algú fa servir el comandament físic, l'estat assumit quedarà desfasat.
 *
 * Cada codi IR après combina tots els paràmetres alhora (mode + temperatura
 * + on/off), per això només es poden demanar combinacions apreses: els noms
 * són ac_cool_<temp> i ac_off a src/config/broadlinkCodes.json.
 */

const STORE_KEY = 'acState';
const MODES = ['cool']; // ampliable quan s'aprenguin codis d'altres modes

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function acCodes() {
  return codes.ac || {};
}

// Temperatures amb codi après (no buit), ordenades
function availableTemps() {
  return Object.keys(acCodes())
    .map((name) => {
      const m = name.match(/^ac_cool_(\d+)$/);
      return m && acCodes()[name] ? Number(m[1]) : null;
    })
    .filter((t) => t !== null)
    .sort((a, b) => a - b);
}

function getStatus() {
  const state = store.get(STORE_KEY, { power: null, mode: 'cool', temp: null, updatedAt: null });
  return {
    assumed: true, // l'IR no dona confirmació: això és l'última ordre enviada
    power: state.power,
    mode: state.mode,
    temp: state.temp,
    updatedAt: state.updatedAt,
    availableTemps: availableTemps(),
    offAvailable: !!acCodes().ac_off,
    modes: MODES,
  };
}

async function setState({ power, mode, temp }) {
  const current = store.get(STORE_KEY, { power: false, mode: 'cool', temp: null });
  const wantPower = typeof power === 'boolean' ? power : true;
  const wantMode = mode || current.mode || 'cool';
  const wantTemp = typeof temp === 'number' ? temp : current.temp;

  let codeName;
  if (!wantPower) {
    codeName = 'ac_off';
  } else {
    if (!MODES.includes(wantMode)) {
      throw httpError(`Mode "${wantMode}" no disponible (modes apresos: ${MODES.join(', ')})`, 400);
    }
    if (!Number.isInteger(wantTemp)) {
      throw httpError('Cal una temperatura (número enter)', 400);
    }
    codeName = `ac_cool_${wantTemp}`;
  }

  const hex = acCodes()[codeName];
  if (!hex) {
    const temps = availableTemps();
    throw httpError(
      `No hi ha cap codi IR après per a "${codeName}". ` +
        (temps.length
          ? `Temperatures disponibles: ${temps.join(', ')} °C. `
          : 'Encara no hi ha cap temperatura apresa. ') +
        'Aprèn el codi amb l\'app de Broadlink i enganxa\'l a src/config/broadlinkCodes.json',
      409
    );
  }

  await broadlinkService.sendCode(hex);

  // Només s'actualitza l'estat assumit si l'enviament no ha fallat
  const next = {
    power: wantPower,
    mode: wantMode,
    temp: wantPower ? wantTemp : current.temp, // en apagar es recorda l'última temp
    updatedAt: new Date().toISOString(),
  };
  store.set(STORE_KEY, next);
  return getStatus();
}

module.exports = {
  isConfigured: broadlinkService.isConfigured,
  getStatus,
  setState,
};
