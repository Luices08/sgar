'use strict';

/**
 * Script para crear (o actualizar) un usuario adminControl.
 * Uso: node src/utils/createAdmin.js
 *
 * Puedes cambiar el email/clave con variables de entorno al ejecutar:
 *   ADMIN_EMAIL=otro@correo.com ADMIN_PASSWORD=miclave node src/utils/createAdmin.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const connectDB = require('../config/database');
const { ROLES } = require('../config/constants');
const User = require('../models/User');

const EMAIL    = (process.env.ADMIN_EMAIL || 'admin@gmail.com').toLowerCase().trim();
const PASSWORD = process.env.ADMIN_PASSWORD || '123456';
const NOMBRE   = process.env.ADMIN_NOMBRE || 'Administrador';

const run = async () => {
  await connectDB();
  console.log('\n🌱  Creando/actualizando usuario admin...\n');

  const hashed = await bcrypt.hash(PASSWORD, 12);

  const existente = await User.findOne({ email: EMAIL });

  if (existente) {
    existente.password = hashed;
    existente.rol = ROLES.ADMIN_CONTROL;
    existente.activo = true;
    existente.tenant_id = null;
    await existente.save();
    console.log(`✅  Usuario existente actualizado: ${EMAIL}`);
  } else {
    await User.create({
      nombre:    NOMBRE,
      email:     EMAIL,
      password:  hashed,
      rol:       ROLES.ADMIN_CONTROL,
      tenant_id: null,
      activo:    true,
    });
    console.log(`✅  Usuario creado: ${EMAIL}`);
  }

  console.log('\n📋  CREDENCIALES:');
  console.log(`   Email : ${EMAIL}`);
  console.log(`   Clave : ${PASSWORD}`);
  console.log('\n✨  Listo\n');

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
