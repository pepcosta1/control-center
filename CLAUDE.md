# Centre de Control — guia per a Claude

Panell personal PWA (iPhone) + backend Express. UI i missatges sempre en **català**.

## Producció (IMPORTANT)

- L'app corre en una **VM d'Oracle** (Ubuntu ARM), no en aquest PC.
- URL de producció: **https://control.tail754c49.ts.net** (privada, xarxa Tailscale).
- Accés a la VM: `ssh ubuntu@158.179.210.233` (clau a `~/.ssh/id_ed25519`, ja configurada).
- El projecte a la VM és a `/home/ubuntu/control-center`, gestionat amb **PM2** (`control-center`).

### Com desplegar un canvi

1. Verifica sintaxi: `node --check <fitxer>` dels .js tocats.
2. Copia els fitxers canviats: `scp -o BatchMode=yes <fitxer> ubuntu@158.179.210.233:control-center/<ruta>/`
3. Reinicia: `ssh ubuntu@158.179.210.233 "pm2 restart control-center"`
4. Comprova: `ssh ubuntu@158.179.210.233 "pm2 logs control-center --nostream --lines 10"`
5. Fes commit i push a GitHub (repo privat `pepcosta1/control-center`).

La VM **no** té el repo git: s'actualitza per scp. El `.env` de la VM és la font de veritat de producció — no el trepitgis mai sencer; edita línies amb `sed` o a mà.

## Convencions del codi

- Un mòdul per integració: `src/routes/<nom>.js` + `src/services/<nom>Service.js`, muntat a `server.js` amb `requireAuth`.
- Respostes API sempre `{ ok: true, ... }` o `{ ok: false, error: "..." }` amb try/catch.
- Frontend vanilla (public/): si toques js/css/html, **incrementa la versió de `CACHE` a `public/sw.js`** (cc-vN) perquè la PWA es refresqui.
- Cap secret al frontend ni al repo: tot al `.env` (gitignored). Dades persistents (tokens Spotify, llista de la compra) a `data/store.json` via `src/services/store.js`.

## Estat i particularitats

- **Auth**: un admin (credencials de prova local: admin / test1234). Sessions en memòria (es perden en reiniciar; acceptat).
- **IPs restringides** (`RESTRICTED_IPS` al .env): entren sense login i només veuen endolls + llista de la compra; el servidor els bloqueja /api/spotify i /api/discord (403). Actualment: 100.66.136.110.
- **Spotify**: OAuth fet; tokens a data/store.json amb refresc automàtic. La cerca accepta **màxim 10 resultats** (app en mode desenvolupament de Spotify — no ho "arreglis").
- **Lletres**: LRCLIB (lrclib.net), gratuït i sense clau; mode karaoke amb format LRC.
- **Meross**: `meross-cloud` (npm audit avisa per `request`; sense fix, acceptat). 2 endolls mss710.
- **Discord**: bot connectat però el canal configurat dona "Unknown Channel" (pendent que l'usuari convidi el bot al servidor o corregeixi DISCORD_CHANNEL_ID).
- **Cookies de sessió**: en producció són `secure` → les proves amb curl a la VM s'han de fer contra la URL https de Tailscale, no contra http://127.0.0.1.

## En local (desenvolupament)

`npm run dev` (Node 24 al PC) i http://localhost:3000. El `.env` local existeix i funciona. No deixis servidors locals engegats: producció és la VM.
