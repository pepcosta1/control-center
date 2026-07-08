# Centre de Control — arquitectura i processos

Panell personal PWA (instal·lable a l'iPhone) per controlar dispositius i
serveis de casa des d'un sol lloc. Backend Node.js/Express, frontend vanilla
(HTML/CSS/JS), desplegat en una VM Oracle Cloud i exposat únicament per
Tailscale (sense obrir ports públics).

## 1. Flux general d'una petició

```
PWA (iPhone, Safari standalone)
        │  fetch /api/...
        ▼
Servidor Express (server.js)
        │
        ├─ express.json()
        ├─ express-session (cookie "cc.sid", 30 dies)
        ├─ requireAuth        → bloqueja si no hi ha sessió
        ├─ blockRestricted    → 403 per a IPs restringides en rutes sensibles
        ▼
Router (src/routes/<nom>.js)
        │  valida params, crida el servei, retorna { ok, ... }
        ▼
Service (src/services/<nom>Service.js)
        │  crida l'API externa / dispositiu local, gestiona tokens i cache
        ▼
API externa / dispositiu (núvol o LAN de casa)
```

Totes les respostes API segueixen el mateix contracte:
`{ ok: true, ... }` o `{ ok: false, error: "..." }`.

## 2. Mòduls per integració

| Mòdul | Ruta base | Servei | Protocol | Nota |
|---|---|---|---|---|
| Auth | `/api/auth` | `middleware/auth.js` | sessió (bcrypt) | 1 usuari admin, 5 intents/15min per IP |
| Meross | `/api/meross` | `merossService.js` | núvol (`meross-cloud`) | 2 endolls mss710 |
| Tuya | `/api/tuya` | `tuyaService.js` | núvol, HMAC-SHA256 | termòstat, sense dependència npm |
| SmartThings | `/api/smartthings` | `smartthingsService.js` | núvol (PAT) | control de la TV |
| AC (climatitzador) | `/api/ac` | `acService.js` | IR (Broadlink) | estat *assumit*, no confirmat |
| Broadlink | `/api/broadlink` | `broadlinkService.js` | IR local | comandes genèriques apreses |
| Roomba | `/api/roomba` | `roombaService.js` | LAN local (`dorita980`) | connexió puntual + cooldown 1 min |
| Spotify | `/api/spotify` | `spotifyService.js` | OAuth núvol | tokens a `data/store.json`, refresc automàtic |
| Discord | `/api/discord` | `discordService.js` | bot (`discord.js`) | notificacions a un canal |
| Deco (xarxa) | `/api/deco` | `decoService.js` | API local no oficial | només lectura; **aparcat** (VM no arriba a la LAN) |
| Shopping | `/api/shopping` | `store.js` | JSON local | llista de la compra, CRUD simple |

**Per afegir una integració nova**: crear `src/routes/<nom>.js` +
`src/services/<nom>Service.js`, muntar-la a `server.js` amb `requireAuth`
(i `blockRestricted` si conté dades sensibles), afegir la targeta al
frontend i, si es toca `public/`, pujar la versió `CACHE` de `public/sw.js`.

## 3. Endpoints per mòdul

### Auth (`/api/auth`, sense sessió prèvia)
- `POST /login` — `{ username, password }`
- `POST /logout`
- `GET /me`

### Meross (`/api/meross`)
- `GET /status` — connexió amb el núvol Meross
- `GET /devices` — llista `{ id, name, type, online, channels }`
- `POST /devices/:id/toggle` — `{ channel?, on }` (notifica Discord)
- `POST /devices/:id/refresh`

### Tuya (`/api/tuya`)
- `GET /status`, `GET /devices`
- `POST /power` — `{ on }`
- `POST /temperature` — `{ value }`

### SmartThings (`/api/smartthings`)
- `GET /status`, `GET /devices`
- `POST /power`, `POST /volume`, `POST /mute`, `POST /launch-app`

### AC (`/api/ac`)
- `GET /status` — estat assumit (l'IR no confirma)
- `POST /set` — envia comanda IR

### Broadlink (`/api/broadlink`)
- `GET /commands` — comandes IR apreses disponibles
- `POST /send` — `{ command }`

### Roomba (`/api/roomba`)
- `GET /status`
- `POST /:action` (start/stop/dock, etc.)

### Spotify (`/api/spotify`)
- `GET /login`, `GET /callback` — OAuth
- `GET /status`, `GET /now-playing`, `GET /recent`, `GET /devices`, `GET /playlists`, `GET /search`, `GET /lyrics`
- `POST /play`, `POST /pause`, `POST /next`, `POST /previous`, `POST /volume`, `POST /transfer`, `POST /seek`, `POST /disconnect`

### Discord (`/api/discord`)
- `GET /status`
- `POST /notify` — `{ message, channelId? }`

### Deco (`/api/deco`)
- `GET /status`, `GET /nodes`, `GET /devices`, `GET /presence`

### Shopping (`/api/shopping`)
- `GET /`, `POST /`, `DELETE /:id`, `POST /clear-done`

## 4. Autenticació i control d'accés

- Sessions en memòria (`express-session`); es perden en reiniciar el procés
  (acceptat per a un únic usuari).
- **IPs restringides** (`RESTRICTED_IPS`): entren sense login però només
  veuen endolls, termòstat i llista de la compra. El middleware
  `blockRestricted` retalla l'accés (403) a Spotify, Discord, SmartThings,
  AC i Deco.
- Cap secret arriba al frontend; tot viu al `.env` (gitignored).

## 5. Persistència

- `data/store.json` (via `src/services/store.js`): tokens Spotify (amb
  refresc automàtic) i llista de la compra.
- Sense base de dades: tot és fitxer JSON local a la VM.

## 6. Desplegament (producció)

- VM Oracle Cloud (Ubuntu ARM), gestionada amb **PM2** (`ecosystem.config.js`).
- Exposada només via **Tailscale** (VPN privada, HTTPS automàtic) — sense
  obrir ports a internet. Existeix també una opció clàssica amb Nginx +
  Certbot + domini públic (`deploy/nginx.conf`, `deploy/setup-vm.sh`).
- **La VM no té el repo git**: els canvis es pugen per `scp` fitxer a
  fitxer i es reinicia amb `pm2 restart control-center`.
- Procés de desplegament d'un canvi:
  1. `node --check <fitxer>` per validar sintaxi
  2. `scp` del fitxer canviat a la VM
  3. `pm2 restart control-center`
  4. `pm2 logs control-center --nostream --lines 10` per comprovar
  5. commit + push al repo (`pepcosta1/control-center`, privat)

## 7. Variables d'entorn (noms, sense valors)

```
NODE_ENV, PORT, HOST, BASE_URL, SESSION_SECRET
ADMIN_USER, ADMIN_PASSWORD_HASH, RESTRICTED_IPS
MEROSS_EMAIL, MEROSS_PASSWORD
SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI
DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID
TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, TUYA_DEVICE_ID_TERMOSTAT, TUYA_REGION
SMARTTHINGS_PAT, SMARTTHINGS_TV_DEVICE_ID
BROADLINK_IP
ROOMBA_IP, ROOMBA_BLID, ROOMBA_PASSWORD
DECO_HOST, DECO_USERNAME, DECO_PASSWORD, DECO_PRESENCE_MAC
```

## 8. Estat conegut i limitacions

- **Deco**: aparcat — la VM del núvol no arriba a la LAN de casa (timeout).
  Pendent d'una Raspberry Pi com a subnet router de Tailscale.
- **Discord**: bot connectat, però el canal configurat dona "Unknown
  Channel" (pendent convidar el bot o corregir `DISCORD_CHANNEL_ID`).
- **Spotify**: cerca limitada a 10 resultats (app en mode desenvolupament
  al dashboard de Spotify).
- **Roomba i Deco**: protocol local, requereixen accés a la LAN de casa —
  mateixa limitació que el punt anterior.
- **Meross**: `npm audit` avisa per la dependència `request`; sense fix
  disponible, acceptat conscientment.
