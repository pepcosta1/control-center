const config = require('../config');
const store = require('./store');

/**
 * Servei Spotify: OAuth authorization code flow + Web API.
 * Els tokens es guarden a data/store.json (mai s'envien al frontend)
 * i l'access token es refresca automàticament quan caduca.
 */

const TOKEN_KEY = 'spotify_tokens';
const AUTH_BASE = 'https://accounts.spotify.com';
const API_BASE = 'https://api.spotify.com/v1';

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function isConfigured() {
  return !!(config.spotify.clientId && config.spotify.clientSecret && config.spotify.redirectUri);
}

function isConnected() {
  const t = store.get(TOKEN_KEY);
  return !!(t && t.refresh_token);
}

function disconnect() {
  store.remove(TOKEN_KEY);
}

function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: config.spotify.clientId,
    response_type: 'code',
    redirect_uri: config.spotify.redirectUri,
    scope: SCOPES,
    state,
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

async function tokenRequest(bodyParams) {
  const res = await fetch(`${AUTH_BASE}/api/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' + Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64'),
    },
    body: new URLSearchParams(bodyParams).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw httpError(data.error_description || data.error || `Spotify token: error ${res.status}`, 502);
  }
  return data;
}

function saveTokens(data, previous) {
  store.set(TOKEN_KEY, {
    access_token: data.access_token,
    // Spotify no sempre retorna refresh_token en refrescar: conservem l'anterior
    refresh_token: data.refresh_token || (previous && previous.refresh_token) || null,
    expires_at: Date.now() + ((data.expires_in || 3600) - 60) * 1000,
  });
}

async function exchangeCode(code) {
  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.spotify.redirectUri,
  });
  saveTokens(data, store.get(TOKEN_KEY));
}

async function getAccessToken() {
  const tokens = store.get(TOKEN_KEY);
  if (!tokens || !tokens.refresh_token) {
    throw httpError('Spotify no connectat. Fes clic a "Connecta amb Spotify".', 401);
  }
  if (Date.now() >= tokens.expires_at) {
    const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    saveTokens(data, tokens);
    return store.get(TOKEN_KEY).access_token;
  }
  return tokens.access_token;
}

async function api(method, path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (e) { /* resposta no JSON */ }
  }
  if (!res.ok) {
    if (res.status === 404 && path.startsWith('/me/player')) {
      throw httpError('Cap dispositiu Spotify actiu. Obre Spotify al mòbil o l\'ordinador i reprodueix alguna cosa un moment.', 409);
    }
    const msg = (data && data.error && data.error.message) || `Spotify ha respost ${res.status}`;
    throw httpError(msg, res.status === 401 ? 401 : 502);
  }
  return data;
}

// --- Operacions del reproductor ---

async function nowPlaying() {
  const d = await api('GET', '/me/player');
  if (!d || !d.item) return { playing: false, track: null };
  return {
    playing: !!d.is_playing,
    progressMs: d.progress_ms,
    device: d.device ? d.device.name : null,
    volumePercent: d.device ? d.device.volume_percent : null,
    track: {
      name: d.item.name,
      artists: (d.item.artists || []).map((a) => a.name).join(', '),
      album: d.item.album ? d.item.album.name : null,
      image: d.item.album && d.item.album.images && d.item.album.images.length
        ? d.item.album.images[d.item.album.images.length > 1 ? 1 : 0].url
        : null,
      durationMs: d.item.duration_ms,
      uri: d.item.uri,
    },
  };
}

async function play(contextUri) {
  await api('PUT', '/me/player/play', contextUri ? { context_uri: contextUri } : undefined);
}

async function playTrack(trackUri) {
  await api('PUT', '/me/player/play', { uris: [trackUri] });
}

async function seek(positionMs) {
  await api('PUT', `/me/player/seek?position_ms=${Math.max(0, Math.round(positionMs))}`);
}

async function setVolume(percent) {
  const vol = Math.min(100, Math.max(0, Math.round(percent)));
  await api('PUT', `/me/player/volume?volume_percent=${vol}`);
}

async function devices() {
  const d = await api('GET', '/me/player/devices');
  return (d.devices || []).map((dev) => ({
    id: dev.id,
    name: dev.name,
    type: dev.type,
    active: !!dev.is_active,
    volumePercent: dev.volume_percent,
  }));
}

async function transferPlayback(deviceId) {
  await api('PUT', '/me/player', { device_ids: [deviceId], play: true });
}

async function pause() {
  await api('PUT', '/me/player/pause');
}

async function next() {
  await api('POST', '/me/player/next');
}

async function previous() {
  await api('POST', '/me/player/previous');
}

async function recentlyPlayed(limit = 10) {
  const d = await api('GET', `/me/player/recently-played?limit=${Math.min(Math.max(limit, 1), 50)}`);
  return (d.items || []).map((item) => ({
    name: item.track.name,
    artists: (item.track.artists || []).map((a) => a.name).join(', '),
    album: item.track.album ? item.track.album.name : null,
    image: item.track.album && item.track.album.images && item.track.album.images.length
      ? item.track.album.images[item.track.album.images.length - 1].url
      : null,
    uri: item.track.uri,
    playedAt: item.played_at,
  }));
}

async function playlists() {
  const d = await api('GET', '/me/playlists?limit=50');
  return (d.items || []).map((p) => ({
    id: p.id,
    name: p.name,
    uri: p.uri,
    tracks: p.tracks ? p.tracks.total : 0,
  }));
}

module.exports = {
  isConfigured,
  isConnected,
  disconnect,
  getAuthUrl,
  exchangeCode,
  nowPlaying,
  play,
  pause,
  next,
  previous,
  playlists,
  recentlyPlayed,
  playTrack,
  seek,
  setVolume,
  devices,
  transferPlayback,
};
