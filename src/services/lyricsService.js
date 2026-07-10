/**
 * Servei de lletres via LRCLIB (https://lrclib.net) — API pública i gratuïta.
 * Memòria cau en memòria per no repetir peticions per la mateixa cançó.
 *
 * Rendiment: la cerca exacta (/get) i l'aproximada (/search) es fan EN
 * PARAL·LEL (la exacta falla sovint per àlbum/durada que no quadren, i
 * fer-les en sèrie doblava l'espera). Les peticions duen timeout i les
 * crides simultànies per la mateixa cançó comparteixen una sola petició.
 */

const LRCLIB_BASE = 'https://lrclib.net/api';
const USER_AGENT = 'control-center-personal/0.1 (panell domèstic)';
// LRCLIB pot ser MOLT lent (7-9s per petició mesurats el jul 2026); el
// prefetch del frontend amaga aquesta espera, però el timeout ha de deixar-hi marge
const TIMEOUT_MS = 15000;

const cache = new Map(); // "artist|track" -> { lyrics, synced } | null
const inflight = new Map(); // "artist|track" -> Promise (dedupe de crides simultànies)
const MAX_CACHE = 200;

function cacheKey(artist, track) {
  return `${artist.toLowerCase()}|${track.toLowerCase()}`;
}

async function lrclibGet(path) {
  const res = await fetch(`${LRCLIB_BASE}${path}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw Object.assign(new Error(`LRCLIB ha respost ${res.status}`), { status: 502 });
  }
  return res.json();
}

async function fetchLyrics(artist, track, album, durationSec) {
  const getParams = new URLSearchParams({ artist_name: artist, track_name: track });
  if (album) getParams.set('album_name', album);
  if (durationSec) getParams.set('duration', String(durationSec));
  const searchParams = new URLSearchParams({ artist_name: artist, track_name: track });

  // Les dues surten alhora, però NO esperem la /search (que a LRCLIB pot
  // trigar 5-8s) si la /get (ràpida) ja ha trobat la lletra
  const exactPromise = lrclibGet(`/get?${getParams.toString()}`);
  const searchPromise = lrclibGet(`/search?${searchParams.toString()}`);

  let data = null;
  let exactError = null;
  try {
    data = await exactPromise;
  } catch (err) {
    exactError = err;
  }

  if (data) {
    searchPromise.catch(() => {}); // ja no cal; evita un unhandled rejection
  } else {
    try {
      const results = await searchPromise;
      if (Array.isArray(results)) {
        // Prioritza un resultat amb lletra sincronitzada (karaoke) sobre només text
        data =
          results.find((r) => r.syncedLyrics) ||
          results.find((r) => r.plainLyrics) ||
          null;
      }
    } catch (err) {
      // Si les DUES peticions han petat (xarxa, timeout…), propaga l'error
      // en lloc de guardar un "no trobada" fals a la memòria cau
      if (exactError) throw exactError;
      throw err;
    }
  }

  return data && data.plainLyrics
    ? { lyrics: data.plainLyrics, synced: data.syncedLyrics || null }
    : null;
}

function getLyrics(artist, track, album, durationSec) {
  const key = cacheKey(artist, track);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inflight.has(key)) return inflight.get(key);

  const promise = fetchLyrics(artist, track, album, durationSec)
    .then((result) => {
      if (cache.size >= MAX_CACHE) {
        cache.delete(cache.keys().next().value); // fes lloc esborrant l'entrada més antiga
      }
      cache.set(key, result);
      return result;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

module.exports = { getLyrics };
