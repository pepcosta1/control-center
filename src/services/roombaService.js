const dorita980 = require('dorita980');
const config = require('../config');
const store = require('./store');

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
  // Si estem gravant el recorregut, reutilitzem aquella connexió:
  // el robot només n'accepta una i no en podem obrir una segona
  if (tracker.robot && typeof tracker.robot.end === 'function') {
    return fn(tracker.robot);
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

function shapeStatus(s) {
  const phase = s.cleanMissionStatus ? s.cleanMissionStatus.phase : null;
  return {
    name: s.name || 'Roomba',
    batteryPct: typeof s.batPct === 'number' ? s.batPct : null,
    phase,
    phaseLabel: PHASE_LABELS[phase] || phase || 'desconegut',
    binFull: !!(s.bin && s.bin.full),
    cleaning: phase === 'run',
  };
}

async function getStatus() {
  // Amb la gravació activa, l'estat surt de la memòria cau (mateixa connexió)
  if (tracker.robot && tracker.state.cleanMissionStatus) {
    return shapeStatus(tracker.state);
  }
  const status = await withRobot(async (robot) => {
    const s = await robot.getRobotState(['name', 'batPct', 'cleanMissionStatus', 'bin']);
    return shapeStatus(s);
  });
  // Si algú ha engegat la neteja des de l'app d'iRobot, comencem a gravar igualment
  if (status.cleaning) startTracking();
  return status;
}

async function start() {
  const r = await withRobot((robot) => robot.start());
  setTimeout(startTracking, 3000); // gravar el recorregut d'aquesta neteja
  return r;
}

async function pause() {
  return withRobot((robot) => robot.pause());
}

async function resume() {
  const r = await withRobot((robot) => robot.resume());
  setTimeout(startTracking, 3000);
  return r;
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

// --- Mapa del recorregut -------------------------------------------------
// L'i7 emet la seva posició (pose {x, y} en cm, origen a la base) mentre neteja.
// El plànol "smart map" de l'app d'iRobot viu al seu núvol i NO es pot baixar
// pel protocol local, però gravant la pose podem dibuixar el recorregut real.
// Mentre es grava es manté UNA connexió oberta (les ordres la reutilitzen).

const MAP_KEY = 'roomba_map';
const MAX_POINTS = 20000;          // ~2 h de neteja; evita un store.json infinit
const MIN_MOVE_CM = 5;             // no guardar punts si no s'ha mogut
const TRACK_IDLE_MS = 10 * 60 * 1000; // sense senyal de neteja 10 min → plegar
const MOVING_PHASES = ['run', 'hmUsrDock', 'hmMidMsn', 'hmPostMsn'];

const tracker = {
  robot: null,
  state: {},
  points: [],
  startedAt: null,
  sawRun: false,
  lastRunAt: 0,
  watchdog: null,
};

async function startTracking() {
  if (tracker.robot || !isConfigured()) return;
  tracker.robot = {}; // reserva el lloc mentre connectem (evita dobles)
  let robot;
  try {
    robot = await connect();
  } catch (e) {
    tracker.robot = null;
    return;
  }
  tracker.robot = robot;
  tracker.state = {};
  tracker.points = [];
  tracker.startedAt = Date.now();
  tracker.sawRun = false;
  tracker.lastRunAt = Date.now();

  robot.on('state', (s) => {
    Object.assign(tracker.state, s);
    const phase = tracker.state.cleanMissionStatus && tracker.state.cleanMissionStatus.phase;
    if (MOVING_PHASES.includes(phase)) {
      tracker.sawRun = true;
      tracker.lastRunAt = Date.now();
      const pose = tracker.state.pose;
      if (pose && pose.point && tracker.points.length < MAX_POINTS) {
        const last = tracker.points[tracker.points.length - 1];
        const { x, y } = pose.point;
        if (!last || Math.hypot(x - last[0], y - last[1]) >= MIN_MOVE_CM) {
          tracker.points.push([x, y]);
        }
      }
    }
    // Missió acabada (torna a carregar): desem i tanquem
    if (phase === 'charge' && tracker.sawRun) stopTracking();
  });
  robot.on('error', () => stopTracking());
  robot.on('close', () => stopTracking());

  tracker.watchdog = setInterval(() => {
    if (Date.now() - tracker.lastRunAt > TRACK_IDLE_MS) stopTracking();
  }, 60000);
}

function stopTracking() {
  const robot = tracker.robot;
  if (!robot) return;
  tracker.robot = null;
  clearInterval(tracker.watchdog);
  tracker.watchdog = null;
  if (tracker.points.length > 1) {
    store.set(MAP_KEY, {
      points: tracker.points,
      startedAt: tracker.startedAt,
      endedAt: Date.now(),
    });
  }
  if (typeof robot.end === 'function') {
    try { robot.end(); } catch (e) { /* ja tancada */ }
  }
}

function getMap() {
  if (tracker.robot && tracker.points.length) {
    return { tracking: true, points: tracker.points, startedAt: tracker.startedAt, endedAt: null };
  }
  const saved = store.get(MAP_KEY);
  if (saved) return { tracking: !!tracker.robot, ...saved };
  return { tracking: !!tracker.robot, points: [], startedAt: null, endedAt: null };
}

function resetMap() {
  tracker.points = [];
  store.remove(MAP_KEY);
}

module.exports = {
  isConfigured,
  getStatus,
  start,
  pause,
  resume,
  stop,
  dock,
  getMap,
  resetMap,
};
