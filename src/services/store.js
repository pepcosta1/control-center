const fs = require('fs');
const path = require('path');

/**
 * Magatzem JSON senzill per a dades persistents (tokens OAuth de Spotify, etc.).
 * Fitxer: data/store.json — mai s'envia al frontend ni es puja a git.
 */

const FILE = path.join(__dirname, '..', '..', 'data', 'store.json');

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    return {};
  }
}

function writeAll(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

function get(key, fallback = null) {
  const data = readAll();
  return key in data ? data[key] : fallback;
}

function set(key, value) {
  const data = readAll();
  data[key] = value;
  writeAll(data);
}

function remove(key) {
  const data = readAll();
  delete data[key];
  writeAll(data);
}

module.exports = { get, set, remove };
