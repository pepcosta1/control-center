const dorita980 = require('dorita980');
const config = require('../config');

/**
 * Servei Roomba (iRobot) via protocol LOCAL amb dorita980.
 *
 * IMPORTANT: el robot només es pot controlar des de la seva xarxa local
 * (192.168.x.x). Si el backend corre fora de casa (VM al núvol), cal una
 * porta Tailscale (subnet router) en un aparell de casa perquè hi arribi.
 *
 * La connexió s'obre i es tanca a cada operació: el Roomba només accepta
 * UNA connexió alhora, i mantenir-la oberta bloquejaria l'app d'iRobot.
 */

const CONNECT_TIMEOUT_MS = 10000;
const FAIL_COOLDOWN_MS = 60000; // si no s'hi arriba, no reintentar fins d'aquí 1 min

const PHASE_LABELS = {
  charge: 'Carregant a la base',
  run: 'Netejant',
  stop: 'Aturat',
  pause: 'En pausa',
  hmUsrDock: 'Tornant a la base',
  hmMidMsn: 'Tornant a la base',
  hmPostMsn: 'Tornant a la base',
  evac: 'Buidant el dipòsit',
  stuck: 'Encallat!',
};

let lastFailure = { at: 0, message: null };

function isConfigured() {
  return !!(config.roomba.ip && config.roomba.blid && config.roomba.password);
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connect() {
  const robot = new dorita980.Local(config.roomba.blid, config.roomba.password, config.roomba.ip);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, CONNECT_TIMEOUT_MS);
    robot.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    robot.on('error', (err) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
  return robot;
}

async function withRobot(fn) {
  if (!isConfigured()) {
    throw httpError('Roomba no configurat (revisa el .env)', 503);
  }
  if (Date.now() - lastFailure.at < FAIL_COOLDOWN_MS) {
    throw httpError(lastFailure.message, 502);
  }

  let robot;
  try {
    robot = await connect();
    lastFailure = { at: 0, message: null };
  } catch (err) {
    lastFailure = {
      at: Date.now(),
      message: `No s'ha pogut connectar amb el Roomba (${config.roomba.ip}): ${err.message}`,
    };
    throw httpError(lastFailure.message, 502);
  }

  try {
    return await fn(robot);
  } finally {
    try { robot.end(); } catch (e) { /* la connexió ja estava tancada */ }
  }
}

async function getStatus() {
  return withRobot(async (robot) => {
    const s = await robot.getRobotState(['name', 'batPct', 'cleanMissionStatus', 'bin']);
    const phase = s.cleanMissionStatus ? s.cleanMissionStatus.phase : null;
    return {
      name: s.name || 'Roomba',
      batteryPct: typeof s.batPct === 'number' ? s.batPct : null,
      phase,
      phaseLabel: PHASE_LABELS[phase] || phase || 'desconegut',
      binFull: !!(s.bin && s.bin.full),
      cleaning: phase === 'run',
    };
  });
}

async function start() {
  return withRobot((robot) => robot.start());
}

async function pause() {
  return withRobot((robot) => robot.pause());
}

async function resume() {
  return withRobot((robot) => robot.resume());
}

async function stop() {
  return withRobot((robot) => robot.stop());
}

// Per anar a la base primer cal pausar la neteja (requisit del protocol iRobot)
async function dock() {
  return withRobot(async (robot) => {
    try {
      await robot.pause();
      await sleep(2000);
    } catch (e) { /* si ja estava aturat, seguim */ }
    await robot.dock();
  });
}

module.exports = {
  isConfigured,
  getStatus,
  start,
  pause,
  resume,
  stop,
  dock,
};
