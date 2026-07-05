# Centre de Control

Panell personal (PWA instal·lable a iPhone) per controlar serveis des d'un sol lloc:
**Meross** (endolls), **Spotify** (reproductor) i **Discord** (notificacions), amb
backend Node.js/Express darrere de Nginx + HTTPS en una VM d'Oracle Cloud.

## Estat de les fases

| Fase | Mòdul | Estat |
|------|-------|-------|
| 1 | Meross (llistar dispositius, on/off, estat en temps real) | ✅ Implementat |
| 1 | Autenticació (login amb sessió, un usuari admin) | ✅ Implementat |
| 1 | PWA (manifest, service worker, mobile-first) | ✅ Implementat |
| 2 | Spotify (OAuth, reproductor, playlists) | ✅ Implementat |
| 3 | Discord (bot, notificacions al canal) | ✅ Implementat |

## Estructura

```
control-center/
├── server.js                  # Punt d'entrada Express
├── ecosystem.config.js        # Configuració PM2
├── .env.example               # Plantilla de variables d'entorn
├── src/
│   ├── config.js              # Lectura i validació del .env
│   ├── middleware/auth.js     # requireAuth (protegeix /api/*)
│   ├── routes/                # Un fitxer de rutes per integració
│   │   ├── auth.js            # /api/auth (login, logout, me)
│   │   ├── meross.js          # /api/meross
│   │   ├── spotify.js         # /api/spotify (fase 2)
│   │   └── discord.js         # /api/discord (fase 3)
│   └── services/
│       ├── merossService.js   # Connexió al núvol Meross + cache d'estat
│       └── store.js           # Magatzem JSON (data/store.json) per a tokens
├── public/                    # Frontend PWA (HTML/CSS/JS vanilla)
├── scripts/hash-password.js   # Genera el hash bcrypt de l'admin
└── deploy/                    # nginx.conf + setup-vm.sh
```

**Per afegir una integració nova** (Telegram, Home Assistant…): crea
`src/routes/<nom>.js` + `src/services/<nom>Service.js`, munta la ruta a
`server.js` amb `requireAuth`, i afegeix la targeta al frontend. Els secrets van
al `.env` i les dades persistents a `store.js`.

## API

Totes les respostes són JSON amb el format `{ ok: true, ... }` o `{ ok: false, error: "..." }`.

### Auth
- `POST /api/auth/login` — body `{ username, password }`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Meross (requereix sessió)
- `GET /api/meross/status` — estat de la connexió amb el núvol Meross
- `GET /api/meross/devices` — llista amb `{ id, name, type, online, channels: [{ channel, name, onoff }] }`
- `POST /api/meross/devices/:id/toggle` — body `{ channel?: 0, on: true|false }` (notifica a Discord si el bot està actiu)
- `POST /api/meross/devices/:id/refresh` — força rellegir l'estat

### Spotify (requereix sessió)
- `GET /api/spotify/login` — inicia l'OAuth (obre-ho al navegador des del panell)
- `GET /api/spotify/callback` — retorn de Spotify (automàtic)
- `GET /api/spotify/status` — `{ configured, connected }`
- `GET /api/spotify/now-playing` — cançó actual
- `POST /api/spotify/play` — body opcional `{ contextUri }` per reproduir una playlist
- `POST /api/spotify/pause` · `POST /api/spotify/next` · `POST /api/spotify/previous`
- `GET /api/spotify/playlists` — playlists de l'usuari
- `POST /api/spotify/disconnect` — esborra els tokens guardats

### Discord (requereix sessió)
- `GET /api/discord/status` — estat del bot
- `POST /api/discord/notify` — body `{ message, channelId? }` (per defecte usa DISCORD_CHANNEL_ID)

## Execució en local (desenvolupament)

```bash
npm install
cp .env.example .env
# Edita .env: com a mínim SESSION_SECRET, ADMIN_PASSWORD_HASH i credencials Meross
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → SESSION_SECRET
npm run hash-password -- laTevaContrasenya                                  # → ADMIN_PASSWORD_HASH
npm run dev
```

Obre `http://localhost:3000`. En local posa `HOST=0.0.0.0` i `NODE_ENV=development`
al `.env` (amb `NODE_ENV=production` la cookie de sessió és `secure` i no funciona sense HTTPS).

## Desplegament recomanat: VM Oracle + Tailscale (sense obrir ports)

Més senzill i segur que l'opció clàssica: el panell només és accessible des dels
teus dispositius amb Tailscale (VPN privada gratuïta), amb HTTPS automàtic.

```bash
# 1. A la VM (Ubuntu): projecte + Node + PM2
git clone <el-teu-repo> ~/control-center && cd ~/control-center
bash deploy/setup-vm.sh          # Nginx/Certbot s'instal·len però no els farem servir
npm install --omit=dev
cp .env.example .env && nano .env

# 2. Tailscale + HTTPS
bash deploy/setup-tailscale.sh   # instal·la, inicia sessió i publica el port 3000
```

El script mostra la URL final (tipus `https://nom-vm.tailXXXX.ts.net`). Després:

1. Al `.env`: `BASE_URL` i `SPOTIFY_REDIRECT_URI` amb aquesta URL,
   `NODE_ENV=production`, `HOST=127.0.0.1`. Afegeix el redirect URI al
   Spotify Developer Dashboard.
2. Arrenca: `pm2 start ecosystem.config.js && pm2 save && pm2 startup`.
3. A l'iPhone: instal·la l'app **Tailscale**, inicia-hi sessió amb el mateix
   compte, obre la URL a Safari i **Afegir a la pantalla d'inici**.

## Desplegament clàssic públic (Nginx + Certbot + domini)

### 1. Preparar la VM

```bash
# Des de la VM:
git clone <el-teu-repo> ~/control-center   # o puja els fitxers amb scp
cd ~/control-center
bash deploy/setup-vm.sh
```

El script instal·la Node 22, Nginx, Certbot i PM2, i obre els ports 80/443 a
l'iptables local. **A més**, cal obrir 80 i 443 a la *Security List* (o NSG) de
la VCN a la consola d'Oracle Cloud: *Networking → Virtual Cloud Networks → la
teva VCN → Security Lists → Ingress Rules*.

### 2. Domini

Crea un registre **A** al teu DNS apuntant a la IP pública de la VM
(si no tens domini, DuckDNS és una opció gratuïta). Sense domini no hi ha
HTTPS vàlid, i sense HTTPS no funcionen ni la PWA ni l'OAuth de Spotify.

### 3. Configurar l'app

```bash
cd ~/control-center
npm install --omit=dev
cp .env.example .env
nano .env    # SESSION_SECRET, ADMIN_*, MEROSS_*, BASE_URL=https://el-teu-domini
```

### 4. Nginx + HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/control-center
sudo nano /etc/nginx/sites-available/control-center   # substitueix EL_TEU_DOMINI
sudo ln -s /etc/nginx/sites-available/control-center /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d el-teu-domini.exemple.com   # certificat + renovació automàtica
```

### 5. Arrencar amb PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # executa la comanda que et mostri perquè arrenqui amb la VM
```

Comandes útils: `pm2 logs control-center`, `pm2 restart control-center`, `pm2 status`.

### 6. Instal·lar la PWA a l'iPhone

1. Obre `https://el-teu-domini` a **Safari** i fes login.
2. Botó de compartir → **Afegir a la pantalla d'inici**.
3. S'obre a pantalla completa (standalone) amb la seva pròpia icona.

## Notes i limitacions

- **Sessions en memòria**: si PM2 reinicia el procés, cal tornar a fer login.
  Acceptable per a un sol usuari; si molesta, es pot canviar a un session store
  amb fitxer o SQLite.
- **Login del núvol Meross**: Meross canvia de tant en tant la signatura de la
  seva API no oficial. Si el mòdul deixa de connectar, actualitza la llibreria:
  `npm update meross-cloud`.
- **Seguretat**: cap secret arriba mai al frontend; totes les rutes `/api/*`
  (excepte `/api/auth`) requereixen sessió; login limitat a 5 intents per IP
  cada 15 minuts.
