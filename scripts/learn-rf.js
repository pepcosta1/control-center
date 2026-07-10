#!/usr/bin/env node
/**
 * Aprèn un codi RF (433 MHz) amb el Broadlink RM4 pro i el desa a
 * broadlinkCodes.json. Per a comandaments per radiofreqüència com el de la
 * llum de cristall (CristalRecord); per a comandaments IR usa learn-ir.js.
 *
 * Procés en DOS passos (així funciona l'RF dels Broadlink):
 *   1. Escombrat de freqüència: MANTÉN PREMUT el botó ~2-3 segons.
 *   2. Captura del paquet: prem el MATEIX botó breument.
 *
 * Ús:   node scripts/learn-rf.js <seccio.clau>
 * Ex.:  node scripts/learn-rf.js llum.power_toggle
 *
 * Cal BROADLINK_IP al .env i el dispositiu desbloquejat a l'app
 * ("Lock device" desactivat).
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const broadlink = require('node-broadlink');

const IP = process.env.BROADLINK_IP;
const CODES_FILE = path.join(__dirname, '..', 'src', 'config', 'broadlinkCodes.json');
const SWEEP_WINDOW_MS = 25000;
const CAPTURE_WINDOW_MS = 25000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  if (!IP) throw new Error('Falta BROADLINK_IP al .env');
  const devices = await broadlink.discover(4000, { address: '0.0.0.0', broadcastAddress: IP });
  if (!devices.length) throw new Error(`Cap Broadlink a ${IP}`);
  let device = devices[0];
  if (typeof device.sendData !== 'function' || typeof device.sweepFrequency !== 'function') {
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
    console.error('Format de destinació invàlid. Exemple: llum.power_toggle');
    process.exit(1);
  }

  const device = await connect();
  console.log('Connectat al RM4 pro.');

  // Pas 1: trobar la freqüència del comandament
  await device.sweepFrequency();
  console.log('👉 PAS 1: MANTÉN PREMUT el botó del comandament (2-3 segons) apuntant al Broadlink…');
  let freqOk = false;
  const sweepDeadline = Date.now() + SWEEP_WINDOW_MS;
  while (Date.now() < sweepDeadline) {
    await sleep(1000);
    try {
      if (await device.checkFrequency()) { freqOk = true; break; }
    } catch (e) { /* seguim esperant */ }
  }
  if (!freqOk) {
    try { await device.cancelSweepFrequency(); } catch (e) { /* ja tant era */ }
    console.error('✗ No s\'ha detectat la freqüència. Torna-ho a provar mantenint el botó més estona.');
    process.exit(1);
  }
  console.log('✓ Freqüència detectada!');

  // Pas 2: capturar el paquet RF concret
  await device.findRfPacket();
  console.log('👉 PAS 2: ara prem el MATEIX botó BREUMENT (un toc)…');
  let code = null;
  const capDeadline = Date.now() + CAPTURE_WINDOW_MS;
  while (Date.now() < capDeadline) {
    await sleep(1000);
    try {
      const data = await device.checkData();
      if (data && data.length) { code = Buffer.from(data).toString('hex'); break; }
    } catch (e) { /* seguim esperant */ }
  }
  if (!code) {
    console.error('✗ No s\'ha capturat el paquet RF. Torna a començar l\'script.');
    process.exit(1);
  }

  console.log(`✓ Codi RF rebut (${code.length / 2} bytes):\n${code}`);

  if (target) {
    const [section, key] = target.split('.');
    const codes = JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
    if (!codes[section]) codes[section] = {};
    codes[section][key] = code;
    fs.writeFileSync(CODES_FILE, JSON.stringify(codes, null, 2) + '\n');
    console.log(`✓ Desat a broadlinkCodes.json → ${section}.${key}`);
  } else {
    console.log('(No s\'ha desat: passa una destinació com ara llum.power_toggle per desar-lo)');
  }
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
