'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const connectDB   = require('../config/database');
const { ROLES }   = require('../config/constants');

// Importar modelos (se crean en ZIP 3)
const Tenant = require('../models/Tenant');
const User   = require('../models/User');

const seed = async () => {
  await connectDB();
  console.log('\n🌱  Iniciando seed de datos...\n');

  // Limpiar colecciones
  await Tenant.deleteMany({});
  await User.deleteMany({});
  console.log('🗑️   Colecciones limpiadas');

  // ─── TENANT DE DEMOSTRACIÓN ──────────────────────────────────────────────
  const tenant = await Tenant.create({
    nombre:       'Conjunto Residencial Los Pinos',
    tenant_id:    'c_lospinos_001',
    colorAcento:  '#2d6a4f',
    imagenUrl:    '/uploads/default-conjunto.jpg',
    descripcion:  'Conjunto de demostración para desarrollo',
    activo:       true,
    deliveryEmpresas: ['Rappi', 'iFood', 'DidiFood', 'Otro'],
  });
  console.log(`✅  Tenant creado: ${tenant.nombre} (${tenant.tenant_id})`);

  // ─── ADMIN CONTROL ───────────────────────────────────────────────────────
  const pwdAdmin = await bcrypt.hash('admin123', 12);
  const adminControl = await User.create({
    nombre:    'Admin Control',
    email:     'admin@sgar.local',
    password:  pwdAdmin,
    rol:       ROLES.ADMIN_CONTROL,
    tenant_id: null,
    activo:    true,
  });
  console.log(`✅  AdminControl creado: ${adminControl.email}`);

  // ─── ADMIN CONJUNTO ──────────────────────────────────────────────────────
  const pwdConjunto = await bcrypt.hash('conjunto123', 12);
  const adminConjunto = await User.create({
    nombre:    'Admin Los Pinos',
    email:     'admin.lospinos@sgar.local',
    password:  pwdConjunto,
    rol:       ROLES.ADMIN_CONJUNTO,
    tenant_id: tenant._id,
    activo:    true,
  });
  console.log(`✅  AdminConjunto creado: ${adminConjunto.email}`);

  // ─── CELADOR ─────────────────────────────────────────────────────────────
  const pwdCelador = await bcrypt.hash('celador123', 12);
  const celador = await User.create({
    nombre:    'Carlos Celador',
    email:     'celador1@sgar.local',
    password:  pwdCelador,
    rol:       ROLES.CELADOR,
    tenant_id: tenant._id,
    activo:    true,
  });
  console.log(`✅  Celador creado: ${celador.email}`);

  // ─── RESIDENTE ────────────────────────────────────────────────────────
  const pwdResidente = await bcrypt.hash('residente123', 12);
  const residente = await User.create({
    nombre:    'María Residente',
    email:     'residente1@sgar.local',
    password:  pwdResidente,
    rol:       ROLES.RESIDENTE,
    tenant_id: tenant._id,
    activo:    true,
  });
  console.log(`✅  Residente creado: ${residente.email}`);

  console.log('\n📋  CREDENCIALES DE ACCESO:');
  console.log('   AdminControl  → admin@sgar.local          / admin123');
  console.log('   AdminConjunto → admin.lospinos@sgar.local  / conjunto123');
  console.log('   Celador       → celador1@sgar.local        / celador123');
  console.log('   Residente     → residente1@sgar.local      / residente123');
  console.log('\n✨  Seed completado exitosamente\n');

  await mongoose.disconnect();
  process.exit(0);
};

seed().catch((err) => {
  console.error('❌  Error en seed:', err.message);
  process.exit(1);
});
