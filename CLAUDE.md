# Centre de Control — guia per a Claude

Panell personal PWA (iPhone) + backend Express. UI i missatges sempre en **català**.

## Estètica del frontend

Quan generis o modifiquis UI (public/), evita l'estètica genèrica "AI slop" i fes triades distintives:

- **Estil general**: liquid glass, a l'estil iOS/iPhone — superfícies translúcides amb `backdrop-filter: blur()`, vores subtils amb `border: 1px solid rgba(255,255,255,0.15)`, capes que deixen entreveure el fons, reflexos i degradats suaus de llum sobre el vidre. Cantonades molt arrodonides (`border-radius` generós, a l'estil "squircle" d'iOS).
- **Tipografia**: fonts úniques i interessants, mai Arial/Inter/system-ui genèriques. Si vols mantenir l'aire Apple, es pot considerar SF Pro / -apple-system només en aquest context, però combinat amb algun detall tipogràfic propi per no caure en el look per defecte.
- **Color**: un color dominant + un accent nítid, com a variables CSS. Res de gradients morats sobre blanc.
- **Moviment**: animacions CSS suaus per a micro-interaccions (transicions de blur/opacity a l'obrir targetes o modals); un sol page-load ben orquestrat amb `animation-delay` esglaonat val més que efectes escampats.
- **Fons**: crea atmosfera (gradients en capes, taques de color difuminades darrere els panells de vidre) en lloc de colors sòlids plans — el fons és el que dona vida a l'efecte liquid glass.
- **Evita**: layouts predictibles, targetes arrodonides genèriques sense l'efecte de vidre, hero centrat amb tres cards, ombres a 0.1 opacity per tot arreu sense el component de transparència/blur.

Interpreta amb criteri propi i fes triades que encaixin amb el context del Centre de Control, no amb el disseny per defecte d'un panell d'admin genèric.

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
- **Tuya (termòstat Garza)**: Tuya Cloud API (data center EU) amb signatura HMAC-SHA256 i token que es renova sol; sense dependència npm. Variables: TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, TUYA_DEVICE_ID_TERMOSTAT, TUYA_REGION. Accessible també per a les IPs restringides (com els endolls). L'escala de temperatura es llegeix de l'especificació del dispositiu (fallback heurístic ×10).
- **TP-Link Deco (xarxa)**: API local NO oficial (port d'amosyuen/ha-tplink-deco, sense dependència npm; pot trencar-se amb firmware nou). NOMÉS lectura: nodes, clients i presència (DECO_PRESENCE_MAC). Variables: DECO_HOST, DECO_USERNAME, DECO_PASSWORD, DECO_PRESENCE_MAC. **APARCAT**: la VM del núvol no arriba a la LAN de casa (timeout); pendent d'una Raspberry Pi com a subnet router de Tailscale (prevista ~9 juliol 2026). Bloquejat per a IPs restringides (presència/inventari = sensible).
- **Roomba (iRobot)**: `dorita980` (protocol LOCAL, mateixa limitació que el Deco: cal la porta de casa). Variables: ROOMBA_IP, ROOMBA_BLID, ROOMBA_PASSWORD (instruccions per obtenir-les a .env.example). La connexió s'obre i tanca a cada operació (el robot només n'accepta una) i hi ha cooldown d'1 min si no s'hi arriba. Accessible per a IPs restringides.
- **Cookies de sessió**: en producció són `secure` → les proves amb curl a la VM s'han de fer contra la URL https de Tailscale, no contra http://127.0.0.1.

## En local (desenvolupament)

`npm run dev` (Node 24 al PC) i http://localhost:3000. El `.env` local existeix i funciona. No deixis servidors locals engegats: producció és la VM.
