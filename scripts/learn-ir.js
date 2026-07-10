#!/usr/bin/env node
/**
 * Aprèn un codi IR amb el Broadlink RM4 i el desa a broadlinkCodes.json.
 *
 * Ús:   node scripts/learn-ir.js <seccio.clau>
 * Ex.:  node scripts/learn-ir.js llum.llum_on
 *       node scripts/learn-ir.js ac.ac_cool_23
 *
 * Sense argument, només mostra el codi après per pantalla (no desa res).
 * Cal BROADLINK_IP al .env i el dispositiu desbloquejat a l'app
 * (ajustos del dispositiu → desactivar "Lock device").
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const broadlink = require('node-broadlink');

const IP = process.env.BROADLINK_IP;
const CODES_FILE = path.join(__dirname, '..', 'src', 'config', 'broadlinkCodes.json');
const LEARN_WINDOW_MS = 30000;

async function connect() {
  if (!IP) throw new Error('Falta BROADLINK_IP al .env');
  const devices = await broadlink.discover(4000, { address: '0.0.0.0', broadcastAddress: IP });
  if (!devices.length) throw new Error(`Cap Broadlink a ${IP}`);
  let device = devices[0];
  if (typeof device.sendData !== 'function') {
    device = new broadlink.Rm4pro(
      device.host, device.mac, device.deviceType, 'RM4 pro', 'Broadlink', device.name, device.isLocked
    );
  }
  try {
    await device.auth();
  } catch (err) {
    if (/65535|-1/.test(String(err.message))) {
      throw new Error("El Broadlink està bloquejat: desactiva 'Lock device' a l'app de Broadlink");
    }
    throw err;
  }
  return device;
}

(async () => {
  const target = process.argv[2] || null;
  if (target && !/^[a-z0-9_]+\.[a-z0-9_]+$/i.test(target)) {
    console.error('Format de destinació invàlid. Exemple: llum.llum_on');
    process.exit(1);
  }

  const device = await connect();
  console.log('Connectat al RM4. Entrant en mode aprenentatge…');
  await device.enterLearning();
  console.log('👉 APUNTA el comandament al Broadlink i PREM el botó (tens 30 segons; el LED blanc s\'apaga quan el rep)');

  const deadline = Date.now() + LEARN_WINDOW_MS;
  let code = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const data = await device.checkData();
      if (data && data.length) { code = Buffer.from(data).toString('hex'); break; }
    } catch (e) { /* encara no hi ha codi: seguim esperant */ }
  }

  if (!code) {
    console.error('✗ No s\'ha rebut cap codi en 30 segons. Torna-ho a provar.');
    process.exit(1);
  }

  console.log(`✓ Codi rebut (${code.length / 2} bytes):\n${code}`);

  if (target) {
    const [section, key] = target.split('.');
    const codes = JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
    if (!codes[section]) codes[section] = {};
    codes[section][key] = code;
    fs.writeFileSync(CODES_FILE, JSON.stringify(codes, null, 2) + '\n');
    console.log(`✓ Desat a broadlinkCodes.json → ${section}.${key}`);
  } else {
    console.log('(No s\'ha desat: passa una destinació com ara llum.llum_on per desar-lo)');
  }
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
