/**
 * Servei de lletres via LRCLIB (https://lrclib.net) — API pública i gratuïta.
 * Memòria cau en memòria per no repetir peticions per la mateixa cançó.
 */

const LRCLIB_BASE = 'https://lrclib.net/api';
const USER_AGENT = 'control-center-personal/0.1 (panell domèstic)';

const cache = new Map(); // "artist|track" -> { lyrics, synced } | null
const MAX_CACHE = 200;

function cacheKey(artist, track) {
  return `${artist.toLowerCase()}|${track.toLowerCase()}`;
}

async function lrclibGet(path) {
  const res = await fetch(`${LRCLIB_BASE}${path}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw Object.assign(new Error(`LRCLIB ha respost ${res.status}`), { status: 502 });
  }
  return res.json();
}

async function getLyrics(artist, track, album, durationSec) {
  const key = cacheKey(artist, track);
  if (cache.has(key)) return cache.get(key);

  // 1) Cerca exacta
  const params = new URLSearchParams({ artist_name: artist, track_name: track });
  if (album) params.set('album_name', album);
  if (durationSec) params.set('duration', String(durationSec));
  let data = await lrclibGet(`/get?${params.toString()}`);

  // 2) Si falla, cerca aproximada i agafa el primer resultat amb lletra
  if (!data) {
    const q = new URLSearchParams({ artist_name: artist, track_name: track });
    const results = await lrclibGet(`/search?${q.toString()}`);
    if (Array.isArray(results)) {
      data = results.find((r) => r.plainLyrics) || null;
    }
  }

  const result = data && data.plainLyrics
    ? { lyrics: data.plainLyrics, synced: data.syncedLyrics || null }
    : null;

  if (cache.size >= MAX_CACHE) {
    cache.delete(cache.keys().next().value); // fes lloc esborrant l'entrada més antiga
  }
  cache.set(key, result);
  return result;
}

module.exports = { getLyrics };
