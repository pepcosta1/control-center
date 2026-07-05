#!/usr/bin/env node
// Ús: npm run hash-password -- laTevaContrasenya
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Ús: npm run hash-password -- <contrasenya>');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
console.log('Copia això al .env com a ADMIN_PASSWORD_HASH:');
console.log(hash);
