if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

const POLL_MS = 10000;
let pollTimer = null;

// --- Utilitats ---
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Sessió caducada');
  }
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data;
}

function setBadge(el, text, cls) {
  el.textContent = text;
  el.className = `badge ${cls}`;
}

// --- Sessió ---
document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignora */ }
  window.location.href = '/login.html';
});

// =====================================================================
// MEROSS
// =====================================================================
const merossBadge = document.getElementById('meross-badge');
const merossList = document.getElementById('meross-devices');

function renderDevices(devices) {
  if (!devices.length) {
    merossList.innerHTML = '<p class="muted">No s\'ha trobat cap dispositiu.</p>';
    return;
  }

  merossList.innerHTML = '';
  devices.forEach((dev) => {
    dev.channels.forEach((ch) => {
      const row = document.createElement('div');
      row.className = 'device-row' + (dev.online ? '' : ' device-offline');

      const info = document.createElement('div');
      info.className = 'device-info';
      const name = document.createElement('div');
      name.className = 'device-name';
      name.textContent = dev.channels.length > 1 ? `${dev.name} · ${ch.name}` : dev.name;
      const meta = document.createElement('div');
      meta.className = 'device-meta';
      meta.textContent = dev.online ? dev.type : `${dev.type} · fora de línia`;
      info.append(name, meta);

      const label = document.createElement('label');
      label.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = ch.onoff === 1;
      input.disabled = !dev.online || ch.onoff === null;
      input.addEventListener('change', () => toggleDevice(dev.id, ch.channel, input));
      const slider = document.createElement('span');
      slider.className = 'slider';
      label.append(input, slider);

      row.append(info, label);
      merossList.appendChild(row);
    });
  });
}

async function toggleDevice(deviceId, channel, input) {
  const wanted = input.checked;
  input.disabled = true;
  try {
    await api(`/api/meross/devices/${encodeURIComponent(deviceId)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ channel, on: wanted }),
    });
  } catch (err) {
    input.checked = !wanted; // reverteix si ha fallat
    alert(`No s'ha pogut canviar l'estat: ${err.message}`);
  } finally {
    input.disabled = false;
  }
}

async function loadMeross() {
  try {
    const status = await api('/api/meross/status');
    if (status.status === 'unconfigured') {
      setBadge(merossBadge, 'no configurat', 'badge-muted');
      merossList.innerHTML = '<p class="muted">Afegeix MEROSS_EMAIL i MEROSS_PASSWORD al .env del servidor.</p>';
      return;
    }
    if (status.status === 'error') {
      setBadge(merossBadge, 'error', 'badge-err');
      merossList.innerHTML = `<p class="error">${status.error || 'Error de connexió amb Meross'}</p>`;
      return;
    }
    if (status.status !== 'connected') {
      setBadge(merossBadge, 'connectant…', 'badge-muted');
      return;
    }

    setBadge(merossBadge, 'connectat', 'badge-ok');
    const { devices } = await api('/api/meross/devices');
    renderDevices(devices);
  } catch (err) {
    setBadge(merossBadge, 'error', 'badge-err');
    merossList.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

// =====================================================================
// TUYA / CALEFACCIÓ
// =====================================================================
const tuyaBadge = document.getElementById('tuya-badge');
const tuyaBody = document.getElementById('tuya-body');
let tuyaUiBuilt = false;
let tuyaLastTarget = null;   // últim objectiu confirmat pel servidor
let tuyaPendingTemp = null;  // objectiu triat per l'usuari, pendent d'enviar
let tuyaSendTimer = null;
let tuyaLimits = { min: 5, max: 35, step: 0.5 };

function fmtTemp(t) {
  if (typeof t !== 'number') return '—';
  return `${t % 1 ? t.toFixed(1) : t} °C`;
}

function showTuyaErr(msg) {
  const el = document.getElementById('tuya-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function renderTuyaTarget(temp, pending) {
  const el = document.getElementById('tuya-target');
  if (!el) return;
  el.textContent = fmtTemp(temp);
  el.classList.toggle('pending', !!pending);
}

// Cada toc de +/- ajusta l'objectiu en local; s'envia quan l'usuari para (debounce)
function nudgeTuyaTemp(direction) {
  const base = tuyaPendingTemp !== null ? tuyaPendingTemp : tuyaLastTarget;
  if (base === null) return;
  const next = Math.round((base + direction * tuyaLimits.step) * 10) / 10;
  tuyaPendingTemp = Math.min(tuyaLimits.max, Math.max(tuyaLimits.min, next));
  renderTuyaTarget(tuyaPendingTemp, true);
  clearTimeout(tuyaSendTimer);
  tuyaSendTimer = setTimeout(sendTuyaTemp, 900);
}

async function sendTuyaTemp() {
  const temp = tuyaPendingTemp;
  if (temp === null) return;
  try {
    await api('/api/tuya/temperature', {
      method: 'POST',
      body: JSON.stringify({ temperature: temp }),
    });
    tuyaLastTarget = temp;
    renderTuyaTarget(temp, false);
  } catch (err) {
    showTuyaErr(`No s'ha pogut canviar la temperatura: ${err.message}`);
    renderTuyaTarget(tuyaLastTarget, false);
  } finally {
    tuyaPendingTemp = null;
  }
}

function buildTuyaUi() {
  tuyaBody.innerHTML = `
    <div class="device-row">
      <div class="device-info">
        <div class="device-name" id="tuya-name">Termòstat</div>
        <div class="device-meta" id="tuya-meta">—</div>
      </div>
      <label class="switch">
        <input type="checkbox" id="tuya-power">
        <span class="slider"></span>
      </label>
    </div>
    <div class="thermo" id="tuya-thermo">
      <button id="tuya-temp-down" class="btn-round" title="Baixa la temperatura">−</button>
      <div class="thermo-display">
        <div class="thermo-target" id="tuya-target">—</div>
        <div class="device-meta">objectiu · ara <span id="tuya-current">—</span></div>
      </div>
      <button id="tuya-temp-up" class="btn-round" title="Puja la temperatura">＋</button>
    </div>
    <p id="tuya-error" class="error hidden"></p>
  `;
  tuyaUiBuilt = true;

  const power = document.getElementById('tuya-power');
  power.addEventListener('change', async () => {
    const wanted = power.checked;
    power.disabled = true;
    try {
      await api('/api/tuya/power', {
        method: 'POST',
        body: JSON.stringify({ on: wanted }),
      });
      setTimeout(loadTuya, 800); // dona temps al dispositiu a aplicar el canvi
    } catch (err) {
      power.checked = !wanted; // reverteix si ha fallat
      showTuyaErr(`No s'ha pogut canviar l'estat: ${err.message}`);
    } finally {
      power.disabled = false;
    }
  });

  document.getElementById('tuya-temp-down').addEventListener('click', () => nudgeTuyaTemp(-1));
  document.getElementById('tuya-temp-up').addEventListener('click', () => nudgeTuyaTemp(1));
}

function updateTuyaUi(t) {
  tuyaLimits = { min: t.minTemp, max: t.maxTemp, step: t.step || 0.5 };
  document.getElementById('tuya-name').textContent = t.name;
  const metaParts = [];
  if (t.mode) metaParts.push(`mode ${t.mode}`);
  if (!t.online) metaParts.push('fora de línia');
  document.getElementById('tuya-meta').textContent = metaParts.join(' · ') || 'termòstat';
  document.getElementById('tuya-current').textContent = fmtTemp(t.currentTemp);
  document.getElementById('tuya-thermo').classList.toggle('thermo-off', t.on === false);

  const power = document.getElementById('tuya-power');
  if (!power.disabled) power.checked = t.on === true;
  power.disabled = !t.online || t.on === null;

  tuyaLastTarget = t.targetTemp;
  // No trepitgis l'objectiu mentre l'usuari està tocant +/-
  if (tuyaPendingTemp === null) renderTuyaTarget(t.targetTemp, false);
}

// =====================================================================
// ROOMBA
// =====================================================================
const roombaBadge = document.getElementById('roomba-badge');
const roombaBody = document.getElementById('roomba-body');
let roombaUiBuilt = false;

function buildRoombaUi() {
  roombaBody.innerHTML = `
    <div class="device-row">
      <div class="device-info">
        <div class="device-name" id="rb-name">Roomba</div>
        <div class="device-meta" id="rb-meta">—</div>
      </div>
      <div class="rb-batt" id="rb-batt">—</div>
    </div>
    <div class="rb-controls">
      <button id="rb-start" class="btn-small">▶ Neteja</button>
      <button id="rb-pause" class="btn-small">⏸ Pausa</button>
      <button id="rb-dock" class="btn-small">🏠 A la base</button>
    </div>
    <p id="rb-error" class="error hidden"></p>
  `;
  roombaUiBuilt = true;

  const showErr = (msg) => {
    const el = document.getElementById('rb-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 5000);
  };

  const cmd = (action) => async (e) => {
    e.target.disabled = true;
    try {
      await api(`/api/roomba/${action}`, { method: 'POST' });
      setTimeout(loadRoomba, 1500); // dona temps al robot a canviar d'estat
    } catch (err) {
      showErr(err.message);
    } finally {
      e.target.disabled = false;
    }
  };

  document.getElementById('rb-start').addEventListener('click', cmd('start'));
  document.getElementById('rb-pause').addEventListener('click', cmd('pause'));
  document.getElementById('rb-dock').addEventListener('click', cmd('dock'));
}

async function loadRoomba() {
  try {
    const data = await api('/api/roomba/status');
    if (data.status === 'unconfigured') {
      setBadge(roombaBadge, 'no configurat', 'badge-muted');
      roombaBody.innerHTML = '<p class="muted">Afegeix ROOMBA_IP, ROOMBA_BLID i ROOMBA_PASSWORD al .env del servidor.</p>';
      roombaUiBuilt = false;
      return;
    }
    const r = data.roomba;
    setBadge(roombaBadge, r.cleaning ? 'netejant' : 'connectat', 'badge-ok');
    if (!roombaUiBuilt) buildRoombaUi();
    document.getElementById('rb-name').textContent = r.name;
    document.getElementById('rb-meta').textContent =
      r.phaseLabel + (r.binFull ? ' · dipòsit ple!' : '');
    document.getElementById('rb-batt').textContent =
      r.batteryPct !== null ? `🔋 ${r.batteryPct}%` : '';
  } catch (err) {
    setBadge(roombaBadge, 'fora de línia', 'badge-err');
    roombaBody.innerHTML = `<p class="muted">${err.message}</p>`;
    roombaUiBuilt = false;
  }
}

async function loadTuya() {
  try {
    const data = await api('/api/tuya/status');
    if (data.status === 'unconfigured') {
      setBadge(tuyaBadge, 'no configurat', 'badge-muted');
      tuyaBody.innerHTML = '<p class="muted">Afegeix les credencials de Tuya al .env del servidor.</p>';
      tuyaUiBuilt = false;
      return;
    }
    const t = data.thermostat;
    setBadge(tuyaBadge, t.online ? 'connectat' : 'fora de línia', t.online ? 'badge-ok' : 'badge-muted');
    if (!tuyaUiBuilt) buildTuyaUi();
    updateTuyaUi(t);
  } catch (err) {
    setBadge(tuyaBadge, 'error', 'badge-err');
    tuyaBody.innerHTML = `<p class="error">${err.message}</p>`;
    tuyaUiBuilt = false;
  }
}

// =====================================================================
// SPOTIFY
// =====================================================================
const spotifyBadge = document.getElementById('spotify-badge');
const spotifyBody = document.getElementById('spotify-body');
let spotifyPlaying = false;
let spotifyUiBuilt = false;
let currentTrack = null;
// Última posició coneguda de reproducció; entre sondejos s'interpola amb el rellotge local
let playbackPos = { progressMs: 0, at: 0, playing: false };
let seekDragging = false;
let volDragging = false;
let progressTimer = null;

async function refreshDevices() {
  const sel = document.getElementById('sp-device');
  if (!sel || document.activeElement === sel) return; // no toquis el desplegable mentre l'usuari el fa servir
  try {
    const { devices } = await api('/api/spotify/devices');
    sel.innerHTML = '';
    if (!devices.length) {
      sel.appendChild(new Option('Cap dispositiu actiu', ''));
      return;
    }
    devices.forEach((d) => {
      const opt = new Option(`${d.active ? '▶ ' : ''}${d.name} (${d.type})`, d.id);
      opt.selected = d.active;
      sel.appendChild(opt);
    });
  } catch (err) { /* silenciós: es reintenta al següent sondeig */ }
}

function fmtTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateProgressBar() {
  if (seekDragging || !currentTrack || !currentTrack.durationMs) return;
  const bar = document.getElementById('sp-seek');
  if (!bar) return;
  const pos = Math.min(currentPositionMs(), currentTrack.durationMs);
  bar.value = Math.round((pos / currentTrack.durationMs) * 1000);
  document.getElementById('sp-time-cur').textContent = fmtTime(pos);
  document.getElementById('sp-time-tot').textContent = fmtTime(currentTrack.durationMs);
}

function buildSpotifyPlayer() {
  spotifyBody.innerHTML = `
    <div class="player">
      <img id="sp-cover" class="player-cover hidden" alt="">
      <div class="player-track">
        <div id="sp-title" class="device-name">—</div>
        <div id="sp-artist" class="device-meta">Res sonant</div>
      </div>
    </div>
    <div class="player-progress">
      <span id="sp-time-cur" class="player-time">0:00</span>
      <input type="range" id="sp-seek" min="0" max="1000" value="0" step="1" aria-label="Posició de la cançó">
      <span id="sp-time-tot" class="player-time">0:00</span>
    </div>
    <div class="player-controls">
      <button id="sp-prev" class="btn-round" title="Anterior">⏮</button>
      <button id="sp-playpause" class="btn-round btn-big" title="Reprodueix/Pausa">▶</button>
      <button id="sp-next" class="btn-round" title="Següent">⏭</button>
    </div>
    <button id="sp-lyrics" class="btn-small btn-lyrics">🎤 Lletra</button>
    <div class="player-volume">
      <span class="vol-icon">🔉</span>
      <input type="range" id="sp-volume" min="0" max="100" value="50" step="1" aria-label="Volum">
      <span class="vol-icon">🔊</span>
    </div>
    <div class="player-devices">
      <select id="sp-device" aria-label="Dispositiu de reproducció">
        <option value="">Dispositius…</option>
      </select>
    </div>
    <div class="player-playlists">
      <select id="sp-playlist"><option value="">Les meves playlists…</option></select>
      <button id="sp-play-playlist" class="btn-small">Reprodueix</button>
    </div>
    <form id="sp-search-form" class="sp-search">
      <input type="search" id="sp-search-input" placeholder="Cerca a Spotify…" autocomplete="off">
      <select id="sp-search-type">
        <option value="track">Cançons</option>
        <option value="album">Àlbums</option>
        <option value="artist">Artistes</option>
        <option value="playlist">Llistes</option>
      </select>
      <button type="submit" class="btn-small">🔍</button>
    </form>
    <div id="sp-search-results" class="recent-list"></div>
    <p id="sp-error" class="error hidden"></p>
    <details class="recent-section" id="sp-recent-details">
      <summary class="recent-title">Escoltades recentment ▾</summary>
      <div id="sp-recent" class="recent-list"><p class="muted">Carregant…</p></div>
    </details>
  `;
  spotifyUiBuilt = true;

  const showErr = (msg) => {
    const el = document.getElementById('sp-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 5000);
  };

  const cmd = (path, body) => async () => {
    try {
      await api(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      setTimeout(loadSpotify, 500); // dona temps a Spotify a aplicar el canvi
    } catch (err) {
      showErr(err.message);
    }
  };

  document.getElementById('sp-prev').addEventListener('click', cmd('/api/spotify/previous'));
  document.getElementById('sp-next').addEventListener('click', cmd('/api/spotify/next'));
  document.getElementById('sp-playpause').addEventListener('click', async () => {
    try {
      await api(spotifyPlaying ? '/api/spotify/pause' : '/api/spotify/play', { method: 'POST' });
      setTimeout(loadSpotify, 500);
    } catch (err) {
      showErr(err.message);
    }
  });
  document.getElementById('sp-lyrics').addEventListener('click', openLyrics);

  // Barra de progrés: arrossega per moure't dins de la cançó
  const seekBar = document.getElementById('sp-seek');
  seekBar.addEventListener('input', () => {
    seekDragging = true;
    if (currentTrack && currentTrack.durationMs) {
      document.getElementById('sp-time-cur').textContent =
        fmtTime((seekBar.value / 1000) * currentTrack.durationMs);
    }
  });
  seekBar.addEventListener('change', async () => {
    if (!currentTrack || !currentTrack.durationMs) {
      seekDragging = false;
      return;
    }
    const positionMs = Math.round((seekBar.value / 1000) * currentTrack.durationMs);
    try {
      await api('/api/spotify/seek', {
        method: 'POST',
        body: JSON.stringify({ positionMs }),
      });
      playbackPos = { progressMs: positionMs, at: Date.now(), playing: playbackPos.playing };
    } catch (err) {
      showErr(err.message);
    } finally {
      seekDragging = false;
    }
  });

  // Volum
  const volBar = document.getElementById('sp-volume');
  volBar.addEventListener('input', () => { volDragging = true; });
  volBar.addEventListener('change', async () => {
    try {
      await api('/api/spotify/volume', {
        method: 'POST',
        body: JSON.stringify({ percent: Number(volBar.value) }),
      });
    } catch (err) {
      showErr(err.message); // alguns dispositius (p. ex. iPhone) no accepten volum remot
    } finally {
      volDragging = false;
    }
  });

  // Selector de dispositiu
  const deviceSel = document.getElementById('sp-device');
  deviceSel.addEventListener('change', async () => {
    const id = deviceSel.value;
    if (!id) return;
    try {
      await api('/api/spotify/transfer', {
        method: 'POST',
        body: JSON.stringify({ deviceId: id }),
      });
      setTimeout(loadSpotify, 800);
    } catch (err) {
      showErr(err.message);
    }
  });

  // Cercador
  document.getElementById('sp-search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = document.getElementById('sp-search-input').value.trim();
    const type = document.getElementById('sp-search-type').value;
    const box = document.getElementById('sp-search-results');
    if (!q) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = '<p class="muted">Cercant…</p>';
    try {
      const { results } = await api(`/api/spotify/search?q=${encodeURIComponent(q)}&type=${type}`);
      renderSearchResults(box, results);
    } catch (err) {
      box.innerHTML = `<p class="error">${err.message}</p>`;
    }
  });

  // Refresc suau de la barra cada segon (interpolant entre sondejos)
  if (!progressTimer) {
    progressTimer = setInterval(updateProgressBar, 1000);
  }
  document.getElementById('sp-play-playlist').addEventListener('click', async () => {
    const uri = document.getElementById('sp-playlist').value;
    if (!uri) return;
    try {
      await api('/api/spotify/play', { method: 'POST', body: JSON.stringify({ contextUri: uri }) });
      setTimeout(loadSpotify, 500);
    } catch (err) {
      showErr(err.message);
    }
  });

  // Carrega les playlists un sol cop
  api('/api/spotify/playlists')
    .then(({ playlists }) => {
      const select = document.getElementById('sp-playlist');
      playlists.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.uri;
        opt.textContent = `${p.name} (${p.tracks})`;
        select.appendChild(opt);
      });
    })
    .catch(() => {});
}

function renderSearchResults(box, results) {
  if (!results.length) {
    box.innerHTML = '<p class="muted">Cap resultat.</p>';
    return;
  }
  box.innerHTML = '';

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn-small search-clear';
  clear.textContent = '✕ Neteja resultats';
  clear.addEventListener('click', () => { box.innerHTML = ''; });
  box.appendChild(clear);

  results.forEach((r) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'recent-row';
    row.title = 'Reprodueix a Spotify';

    if (r.image) {
      const img = document.createElement('img');
      img.className = 'recent-cover';
      img.src = r.image;
      img.alt = '';
      row.appendChild(img);
    }
    const info = document.createElement('div');
    info.className = 'device-info';
    const name = document.createElement('div');
    name.className = 'recent-name';
    name.textContent = r.name;
    const meta = document.createElement('div');
    meta.className = 'device-meta';
    meta.textContent = r.subtitle;
    info.append(name, meta);
    row.appendChild(info);

    const playIcon = document.createElement('span');
    playIcon.className = 'recent-play';
    playIcon.textContent = '▶';
    row.appendChild(playIcon);

    row.addEventListener('click', async () => {
      row.classList.add('recent-loading');
      try {
        // Les cançons es reprodueixen soles; àlbums/artistes/llistes com a context
        const body = r.type === 'track' ? { trackUri: r.uri } : { contextUri: r.uri };
        await api('/api/spotify/play', { method: 'POST', body: JSON.stringify(body) });
        setTimeout(loadSpotify, 600);
      } catch (err) {
        alert(`No s'ha pogut reproduir: ${err.message}`);
      } finally {
        row.classList.remove('recent-loading');
      }
    });

    box.appendChild(row);
  });
}

// --- Lletra (modal amb sincronització estil karaoke) ---
const lyricsState = { timer: null, lines: [], activeIndex: -1, trackUri: null };

function getLyricsModal() {
  let overlay = document.getElementById('lyrics-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'lyrics-overlay';
  overlay.className = 'lyrics-overlay hidden';
  overlay.innerHTML = `
    <div class="lyrics-modal">
      <div class="lyrics-header">
        <div id="lyrics-title" class="device-name">Lletra</div>
        <button id="lyrics-close" class="btn-ghost" title="Tanca">✕</button>
      </div>
      <div id="lyrics-body" class="lyrics-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeLyrics();
  });
  overlay.querySelector('#lyrics-close').addEventListener('click', closeLyrics);
  return overlay;
}

function closeLyrics() {
  const overlay = document.getElementById('lyrics-overlay');
  if (overlay) overlay.classList.add('hidden');
  if (lyricsState.timer) {
    clearInterval(lyricsState.timer);
    lyricsState.timer = null;
  }
  lyricsState.trackUri = null;
}

// Converteix el format LRC ("[mm:ss.xx] text") en [{ t: ms, text }]
function parseLrc(synced) {
  const lines = [];
  synced.split('\n').forEach((raw) => {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) return;
    const text = raw.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim();
    tags.forEach((m) => {
      lines.push({ t: parseInt(m[1], 10) * 60000 + Math.round(parseFloat(m[2]) * 1000), text });
    });
  });
  return lines.sort((a, b) => a.t - b.t);
}

function currentPositionMs() {
  return playbackPos.progressMs + (playbackPos.playing ? Date.now() - playbackPos.at : 0);
}

function renderSyncedLyrics(body) {
  body.innerHTML = '';
  lyricsState.lines.forEach((line) => {
    const el = document.createElement('div');
    el.className = 'lyric-line';
    el.textContent = line.text || '♪';
    // Tocar una línia salta la cançó a aquell punt
    el.addEventListener('click', async () => {
      try {
        await api('/api/spotify/seek', {
          method: 'POST',
          body: JSON.stringify({ positionMs: line.t }),
        });
        playbackPos = { progressMs: line.t, at: Date.now(), playing: true };
        setTimeout(loadSpotify, 600);
      } catch (err) { /* si no es pot fer seek, no passa res */ }
    });
    body.appendChild(el);
  });
  lyricsState.activeIndex = -1;
}

function tickLyrics() {
  const overlay = document.getElementById('lyrics-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;

  // Si canvia la cançó amb el modal obert, recarrega la lletra automàticament
  if (currentTrack && lyricsState.trackUri && currentTrack.uri !== lyricsState.trackUri) {
    loadLyricsContent();
    return;
  }
  if (!lyricsState.lines.length) return;

  const pos = currentPositionMs();
  let idx = -1;
  for (let i = 0; i < lyricsState.lines.length; i++) {
    if (lyricsState.lines[i].t <= pos) idx = i;
    else break;
  }
  if (idx !== lyricsState.activeIndex) {
    const els = document.getElementById('lyrics-body').querySelectorAll('.lyric-line');
    if (lyricsState.activeIndex >= 0 && els[lyricsState.activeIndex]) {
      els[lyricsState.activeIndex].classList.remove('active');
    }
    if (idx >= 0 && els[idx]) {
      els[idx].classList.add('active');
      els[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    lyricsState.activeIndex = idx;
  }
}

async function loadLyricsContent() {
  const title = document.getElementById('lyrics-title');
  const body = document.getElementById('lyrics-body');
  lyricsState.lines = [];
  lyricsState.activeIndex = -1;
  lyricsState.trackUri = currentTrack ? currentTrack.uri : null;

  title.textContent = `${currentTrack.name} — ${currentTrack.artists}`;
  body.textContent = 'Buscant la lletra…';

  try {
    const params = new URLSearchParams({
      track: currentTrack.name,
      artist: currentTrack.artists.split(',')[0].trim(),
    });
    if (currentTrack.album) params.set('album', currentTrack.album);
    if (currentTrack.durationMs) params.set('duration', Math.round(currentTrack.durationMs / 1000));
    const data = await api(`/api/spotify/lyrics?${params.toString()}`);

    if (data.synced) {
      lyricsState.lines = parseLrc(data.synced);
      renderSyncedLyrics(body);
    } else {
      body.textContent = data.lyrics; // sense sincronia: lletra estàtica
    }
  } catch (err) {
    body.textContent = err.message;
  }
}

async function openLyrics() {
  if (!currentTrack) {
    alert('No hi ha cap cançó sonant ara mateix.');
    return;
  }
  getLyricsModal().classList.remove('hidden');
  await loadLyricsContent();
  if (!lyricsState.timer) {
    lyricsState.timer = setInterval(tickLyrics, 250);
  }
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'ara mateix';
  if (mins < 60) return `fa ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `fa ${hours} h`;
  return `fa ${Math.floor(hours / 24)} d`;
}

async function loadRecent() {
  const box = document.getElementById('sp-recent');
  if (!box) return;
  try {
    const { tracks } = await api('/api/spotify/recent?limit=50');
    if (!tracks.length) {
      box.innerHTML = '<p class="muted">Encara no hi ha historial.</p>';
      return;
    }
    box.innerHTML = '';
    tracks.forEach((t) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'recent-row';
      row.title = 'Reprodueix a Spotify';
      if (t.image) {
        const img = document.createElement('img');
        img.className = 'recent-cover';
        img.src = t.image;
        img.alt = '';
        row.appendChild(img);
      }
      const info = document.createElement('div');
      info.className = 'device-info';
      const name = document.createElement('div');
      name.className = 'recent-name';
      name.textContent = t.name;
      const meta = document.createElement('div');
      meta.className = 'device-meta';
      meta.textContent = `${t.artists} · ${timeAgo(t.playedAt)}`;
      info.append(name, meta);
      row.appendChild(info);

      const playIcon = document.createElement('span');
      playIcon.className = 'recent-play';
      playIcon.textContent = '▶';
      row.appendChild(playIcon);

      row.addEventListener('click', async () => {
        row.classList.add('recent-loading');
        try {
          await api('/api/spotify/play', {
            method: 'POST',
            body: JSON.stringify({ trackUri: t.uri }),
          });
          setTimeout(loadSpotify, 600);
        } catch (err) {
          alert(`No s'ha pogut reproduir: ${err.message}`);
        } finally {
          row.classList.remove('recent-loading');
        }
      });

      box.appendChild(row);
    });
  } catch (err) {
    // 403 = el token antic no té el permís nou: cal tornar a autoritzar
    if (/403|insufficient|scope/i.test(err.message)) {
      box.innerHTML =
        '<p class="muted">Cal un permís nou de Spotify. <a class="link" href="/api/spotify/login">Torna a connectar</a> per veure l\'historial.</p>';
    } else {
      box.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  }
}

function updateSpotifyPlayer(np) {
  spotifyPlaying = np.playing;
  currentTrack = np.track;
  playbackPos = { progressMs: np.progressMs || 0, at: Date.now(), playing: !!np.playing };
  const cover = document.getElementById('sp-cover');
  const title = document.getElementById('sp-title');
  const artist = document.getElementById('sp-artist');
  const btn = document.getElementById('sp-playpause');

  if (np.track) {
    title.textContent = np.track.name;
    artist.textContent = np.track.artists + (np.device ? ` · ${np.device}` : '');
    if (np.track.image) {
      cover.src = np.track.image;
      cover.classList.remove('hidden');
    } else {
      cover.classList.add('hidden');
    }
  } else {
    title.textContent = '—';
    artist.textContent = 'Res sonant';
    cover.classList.add('hidden');
  }
  btn.textContent = np.playing ? '⏸' : '▶';
  updateProgressBar();

  const volBar = document.getElementById('sp-volume');
  if (volBar && !volDragging && typeof np.volumePercent === 'number') {
    volBar.value = np.volumePercent;
  }
}

async function loadSpotify() {
  try {
    const status = await api('/api/spotify/status');
    if (!status.configured) {
      setBadge(spotifyBadge, 'no configurat', 'badge-muted');
      spotifyBody.innerHTML = '<p class="muted">Afegeix les credencials de Spotify al .env del servidor.</p>';
      spotifyUiBuilt = false;
      return;
    }
    if (!status.connected) {
      setBadge(spotifyBadge, 'desconnectat', 'badge-muted');
      spotifyBody.innerHTML =
        '<a class="btn-connect" href="/api/spotify/login">Connecta amb Spotify</a>';
      spotifyUiBuilt = false;
      return;
    }

    setBadge(spotifyBadge, 'connectat', 'badge-ok');
    const firstBuild = !spotifyUiBuilt;
    if (firstBuild) buildSpotifyPlayer();
    const np = await api('/api/spotify/now-playing');
    updateSpotifyPlayer(np);
    refreshDevices();
    if (firstBuild) loadRecent();
  } catch (err) {
    // 409 = cap dispositiu actiu: no és un error greu, mostrem-ho com a estat
    if (spotifyUiBuilt) {
      document.getElementById('sp-artist').textContent = err.message;
    } else {
      setBadge(spotifyBadge, 'error', 'badge-err');
      spotifyBody.innerHTML = `<p class="error">${err.message}</p>`;
    }
  }
}

// =====================================================================
// LLISTA DE LA COMPRA
// =====================================================================
const shopForm = document.getElementById('shop-form');
const shopInput = document.getElementById('shop-input');
const shopList = document.getElementById('shop-list');
const shopClear = document.getElementById('shop-clear');

function renderShopping(items) {
  if (!items.length) {
    shopList.innerHTML = '<p class="muted">La llista és buida. Afegeix el primer producte!</p>';
    shopClear.classList.add('hidden');
    return;
  }

  // Pendents primer, comprats al final
  const sorted = [...items].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
  shopList.innerHTML = '';
  sorted.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'shop-row' + (item.done ? ' shop-done' : '');

    const label = document.createElement('label');
    label.className = 'shop-label';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = item.done;
    check.addEventListener('change', async () => {
      try {
        await api(`/api/shopping/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ done: check.checked }),
        });
        loadShopping();
      } catch (err) {
        check.checked = !check.checked;
      }
    });
    const text = document.createElement('span');
    text.textContent = item.text;
    label.append(check, text);

    const del = document.createElement('button');
    del.className = 'shop-delete';
    del.title = 'Esborra';
    del.textContent = '✕';
    del.addEventListener('click', async () => {
      try {
        await api(`/api/shopping/${item.id}`, { method: 'DELETE' });
        loadShopping();
      } catch (err) { /* ignora */ }
    });

    row.append(label, del);
    shopList.appendChild(row);
  });

  shopClear.classList.toggle('hidden', !items.some((i) => i.done));
}

async function loadShopping() {
  try {
    const { items } = await api('/api/shopping');
    renderShopping(items);
  } catch (err) {
    shopList.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

shopForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = shopInput.value.trim();
  if (!text) return;
  shopInput.value = '';
  try {
    await api('/api/shopping', { method: 'POST', body: JSON.stringify({ text }) });
    loadShopping();
  } catch (err) {
    alert(`No s'ha pogut afegir: ${err.message}`);
    shopInput.value = text;
  }
  shopInput.focus();
});

shopClear.addEventListener('click', async () => {
  try {
    await api('/api/shopping/clear-done', { method: 'POST' });
    loadShopping();
  } catch (err) { /* ignora */ }
});

// =====================================================================
// XARXA (TP-LINK DECO)
// =====================================================================
const decoBadge = document.getElementById('deco-badge');
const decoBody = document.getElementById('deco-body');
let decoUiBuilt = false;
let decoPresenceConfigured = false;

function buildDecoUi() {
  decoBody.innerHTML = `
    <div id="deco-presence" class="deco-presence hidden"></div>
    <div id="deco-nodes" class="device-list"><p class="muted">Carregant nodes…</p></div>
    <details class="recent-section" id="deco-devices-details">
      <summary class="recent-title">Dispositius connectats ▾</summary>
      <div id="deco-devices" class="recent-list"><p class="muted">—</p></div>
    </details>
  `;
  decoUiBuilt = true;
  document.getElementById('deco-devices-details').addEventListener('toggle', (e) => {
    if (e.target.open) loadDecoDevices();
  });
}

function renderDecoNodes(nodes) {
  const box = document.getElementById('deco-nodes');
  if (!nodes.length) {
    box.innerHTML = '<p class="muted">No s\'ha trobat cap node Deco.</p>';
    return;
  }
  box.innerHTML = '';
  nodes.forEach((n) => {
    const row = document.createElement('div');
    row.className = 'device-row' + (n.online ? '' : ' device-offline');

    const info = document.createElement('div');
    info.className = 'device-info';
    const name = document.createElement('div');
    name.className = 'device-name';
    name.textContent = n.name + (n.master ? ' ★' : '');
    const meta = document.createElement('div');
    meta.className = 'device-meta';
    meta.textContent = [n.model, n.ip, n.online ? null : 'fora de línia'].filter(Boolean).join(' · ');
    info.append(name, meta);

    const dot = document.createElement('span');
    dot.className = 'dot ' + (n.online ? 'dot-ok' : 'dot-err');
    dot.title = n.online ? 'En línia' : 'Fora de línia';

    row.append(info, dot);
    box.appendChild(row);
  });
}

async function loadDecoPresence() {
  const el = document.getElementById('deco-presence');
  if (!el || !decoPresenceConfigured) return;
  try {
    const p = await api('/api/deco/presence');
    el.textContent = p.present ? '🏠 A casa' : '🚶 Fora';
    el.className = 'deco-presence ' + (p.present ? 'presence-home' : 'presence-away');
  } catch (err) {
    el.classList.add('hidden');
  }
}

async function loadDecoDevices() {
  const box = document.getElementById('deco-devices');
  const details = document.getElementById('deco-devices-details');
  if (!box || !details || !details.open) return;
  try {
    const { devices } = await api('/api/deco/devices');
    if (!devices.length) {
      box.innerHTML = '<p class="muted">Cap dispositiu connectat.</p>';
      return;
    }
    box.innerHTML = '';
    devices
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .forEach((d) => {
        const row = document.createElement('div');
        row.className = 'recent-row deco-client';
        const info = document.createElement('div');
        info.className = 'device-info';
        const name = document.createElement('div');
        name.className = 'recent-name';
        name.textContent = d.name;
        const meta = document.createElement('div');
        meta.className = 'device-meta';
        const conn = d.connection === 'wired' ? 'cable' : d.connection;
        meta.textContent = [d.ip, conn, d.node ? `via ${d.node}` : null].filter(Boolean).join(' · ');
        info.append(name, meta);
        row.appendChild(info);
        box.appendChild(row);
      });
  } catch (err) {
    box.innerHTML = `<p class="muted">${err.message}</p>`;
  }
}

async function loadDeco() {
  try {
    const st = await api('/api/deco/status');
    if (st.status === 'unconfigured') {
      setBadge(decoBadge, 'no configurat', 'badge-muted');
      decoBody.innerHTML = '<p class="muted">Afegeix DECO_HOST i DECO_PASSWORD al .env del servidor.</p>';
      decoUiBuilt = false;
      return;
    }
    decoPresenceConfigured = st.presenceConfigured;
    if (!decoUiBuilt) buildDecoUi();

    const { nodes } = await api('/api/deco/nodes');
    const allOk = nodes.length > 0 && nodes.every((n) => n.online);
    setBadge(decoBadge, allOk ? 'tot en línia' : 'atenció', allOk ? 'badge-ok' : 'badge-err');
    renderDecoNodes(nodes);

    const presenceEl = document.getElementById('deco-presence');
    if (decoPresenceConfigured && presenceEl.classList.contains('hidden')) {
      presenceEl.classList.remove('hidden');
      presenceEl.textContent = '…';
    }
    loadDecoPresence();
    loadDecoDevices(); // només refresca si el desplegable és obert
  } catch (err) {
    setBadge(decoBadge, 'error', 'badge-err');
    if (decoUiBuilt) {
      document.getElementById('deco-nodes').innerHTML = `<p class="error">${err.message}</p>`;
    } else {
      decoBody.innerHTML = `<p class="error">${err.message}</p>`;
    }
  }
}

// =====================================================================
// DISCORD
// =====================================================================
const discordBadge = document.getElementById('discord-badge');
const discordBody = document.getElementById('discord-body');
let discordUiBuilt = false;

async function loadDiscord() {
  try {
    const status = await api('/api/discord/status');
    if (status.status === 'unconfigured') {
      setBadge(discordBadge, 'no configurat', 'badge-muted');
      discordBody.innerHTML = '<p class="muted">Afegeix DISCORD_BOT_TOKEN al .env del servidor.</p>';
      discordUiBuilt = false;
      return;
    }
    if (status.status === 'error') {
      setBadge(discordBadge, 'error', 'badge-err');
      discordBody.innerHTML = `<p class="error">${status.error || 'Error de connexió'}</p>`;
      discordUiBuilt = false;
      return;
    }
    if (status.status !== 'connected') {
      setBadge(discordBadge, 'connectant…', 'badge-muted');
      return;
    }

    setBadge(discordBadge, 'connectat', 'badge-ok');
    if (!discordUiBuilt) {
      discordBody.innerHTML = `
        <p class="muted">Bot: ${status.botTag || '—'}. Les accions dels endolls es notifiquen al canal.</p>
        <button id="dc-test" class="btn-small">Envia missatge de prova</button>
        <p id="dc-result" class="muted hidden"></p>
      `;
      discordUiBuilt = true;
      document.getElementById('dc-test').addEventListener('click', async () => {
        const result = document.getElementById('dc-result');
        try {
          await api('/api/discord/notify', {
            method: 'POST',
            body: JSON.stringify({ message: '✅ Prova des del Centre de Control' }),
          });
          result.textContent = 'Missatge enviat!';
        } catch (err) {
          result.textContent = `Error: ${err.message}`;
        }
        result.classList.remove('hidden');
        setTimeout(() => result.classList.add('hidden'), 4000);
      });
    }
  } catch (err) {
    setBadge(discordBadge, 'error', 'badge-err');
    discordBody.innerHTML = `<p class="error">${err.message}</p>`;
    discordUiBuilt = false;
  }
}

// =====================================================================
// Navegació per pestanyes + sondeig de la pestanya activa
// =====================================================================
let restrictedMode = false;
let activeTab = null;
let pollTick = 0;

// Cada pestanya carrega només les seves dades quan és visible.
// adminOnly: no disponible per als dispositius amb accés limitat.
function loadDevices() {
  loadMeross();
  loadRoomba();
}

const TABS = {
  devices: { load: loadDevices },
  tuya: { load: loadTuya },
  spotify: { load: loadSpotify, adminOnly: true },
  shopping: { load: loadShopping },
  deco: { load: loadDeco, adminOnly: true },
  discord: { load: loadDiscord, adminOnly: true },
};

function setDrawer(open) {
  document.getElementById('drawer').classList.toggle('open', open);
  document.getElementById('drawer-overlay').classList.toggle('open', open);
}

function showTab(id) {
  if (!TABS[id]) return;
  activeTab = id;
  pollTick = 0;

  document.querySelectorAll('.page').forEach((p) => {
    p.classList.toggle('active', p.id === `page-${id}`);
  });
  document.querySelectorAll('.drawer-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === id);
  });

  const btn = document.querySelector(`.drawer-item[data-tab="${id}"]`);
  document.getElementById('topbar-title').textContent = btn ? btn.dataset.title : 'Centre de Control';
  setDrawer(false); // tanca el menú en triar una vista
  window.scrollTo(0, 0);
  TABS[id].load();
}

// Sondeja només la pestanya oberta (estalvia bateria i, al Roomba, connexions al robot)
function pollActive() {
  if (!activeTab || !TABS[activeTab]) return;
  TABS[activeTab].load();
  if (activeTab === 'spotify' && (++pollTick % 6 === 0)) loadRecent(); // historial cada ~60 s
}

async function start() {
  let me;
  try {
    me = await api('/api/auth/me');
  } catch (e) {
    return; // api() ja redirigeix al login
  }

  restrictedMode = !!me.restricted;
  if (restrictedMode) {
    // Mode limitat: treu les vistes no permeses i el botó de sortir
    document.getElementById('logout-btn').classList.add('hidden');
    Object.keys(TABS).forEach((id) => {
      if (TABS[id].adminOnly) {
        const page = document.getElementById(`page-${id}`);
        const btn = document.querySelector(`.drawer-item[data-tab="${id}"]`);
        if (page) page.remove();
        if (btn) btn.remove();
        delete TABS[id];
      }
    });
  }

  document.querySelectorAll('.drawer-item').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  // Obrir/tancar el menú lateral
  document.getElementById('menu-btn').addEventListener('click', () => {
    const open = document.getElementById('drawer').classList.contains('open');
    setDrawer(!open);
  });
  document.getElementById('drawer-overlay').addEventListener('click', () => setDrawer(false));

  showTab('devices');
  pollTimer = setInterval(pollActive, POLL_MS);
}

// Atura el sondeig quan l'app és en segon pla (estalvia bateria a l'iPhone)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(pollTimer);
    pollTimer = null;
  } else if (!pollTimer) {
    pollActive();
    pollTimer = setInterval(pollActive, POLL_MS);
  }
});

start();
