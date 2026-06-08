'use strict';

const bcrypt      = require('bcryptjs');
const asyncHandler= require('../utils/asyncHandler');
const { ok, created, error, paginated } = require('../utils/response');
const { ROLES }   = require('../config/constants');

const Resident         = require('../models/Resident');
const User             = require('../models/User');
const Visit            = require('../models/Visit');
const VehicleAccessLog = require('../models/VehicleAccessLog');
const { VISIT_TYPES }  = require('../config/constants');

// ─── LISTAR RESIDENTES ────────────────────────────────────────────────────────
const list = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const skip  = (page - 1) * limit;

  const filter = { tenant_id: req.tenantId };
  if (req.query.activo !== undefined) filter.activo = req.query.activo !== 'false';
  if (req.query.apartamento) filter.apartamento = req.query.apartamento.toUpperCase();
  if (req.query.q) {
    const re = new RegExp(req.query.q, 'i');
    filter.$or = [{ nombre: re }, { cedula: re }, { apartamento: re }];
  }

  const [residents, total] = await Promise.all([
    Resident.find(filter).sort({ apartamento: 1, nombre: 1 }).skip(skip).limit(limit).lean(),
    Resident.countDocuments(filter),
  ]);

  return paginated(res, residents, total, page, limit);
});

// ─── OBTENER UN RESIDENTE ─────────────────────────────────────────────────────
const getOne = asyncHandler(async (req, res) => {
  const resident = await Resident.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!resident) return error(res, 'Residente no encontrado', 404);
  return ok(res, { resident });
});

// ─── CREAR RESIDENTE ──────────────────────────────────────────────────────────
const create = asyncHandler(async (req, res) => {
  const { nombre, cedula, apartamento, telefono, email } = req.body;
  if (!nombre || !apartamento) {
    return error(res, 'nombre y apartamento son requeridos', 400);
  }

  const fotoUrl = req.file ? `/uploads/residentes/${req.file.filename}` : null;

  const resident = await Resident.create({
    tenant_id:   req.tenantId,
    nombre,
    cedula,
    apartamento: apartamento.toUpperCase(),
    telefono,
    email,
    fotoUrl,
  });

  // Si se envía una contraseña y hay email, crear cuenta de usuario inmediatamente
  if (req.body.password && req.body.password.length >= 6 && email) {
    try {
      const hashed = await bcrypt.hash(req.body.password, 12);
      const user = await User.create({
        nombre:    nombre,
        email:     email.toLowerCase().trim(),
        password:  hashed,
        rol:       ROLES.RESIDENTE,
        tenant_id: req.tenantId,
        resident_id: resident._id,
        activo:    true,
      });
      resident.user_id = user._id;
      await resident.save();
    } catch (e) {
      // No abortar creación del residente si falla la creación de usuario
      console.warn('No se pudo crear usuario para residente:', e.message);
    }
  }

  return created(res, { resident }, 'Residente creado');
});

// ─── ACTUALIZAR token facial (compatibilidad) ─────────────────────────────────
const updateFaceId = asyncHandler(async (req, res) => {
  const { faceId, faceToken } = req.body;
  const token = faceId || faceToken;
  if (!token) return error(res, 'faceId o faceToken es requerido', 400);

  const resident = await Resident.findOneAndUpdate(
    { _id: req.params.id, tenant_id: req.tenantId },
    { faceId: token },
    { new: true }
  );

  if (!resident) return error(res, 'Residente no encontrado', 404);
  return ok(res, { resident }, 'Token facial actualizado');
});

// ─── ACTUALIZAR RESIDENTE ─────────────────────────────────────────────────────
const update = asyncHandler(async (req, res) => {
  const { nombre, cedula, apartamento, telefono, email, activo, password } = req.body;
  const updateData = {};
  if (nombre      !== undefined) updateData.nombre      = nombre;
  if (cedula      !== undefined) updateData.cedula      = cedula;
  if (apartamento !== undefined) updateData.apartamento = apartamento.toUpperCase();
  if (telefono    !== undefined) updateData.telefono    = telefono;
  if (email       !== undefined) updateData.email       = email;
  if (activo      !== undefined) updateData.activo      = activo;
  if (req.file)                  updateData.fotoUrl     = `/uploads/residentes/${req.file.filename}`;

  const resident = await Resident.findOneAndUpdate(
    { _id: req.params.id, tenant_id: req.tenantId },
    updateData,
    { new: true, runValidators: true }
  );

  if (!resident) return error(res, 'Residente no encontrado', 404);

  // Si envían password y el residente tiene usuario, actualizar la contraseña
  if (password && password.length >= 6 && resident.user_id) {
    const hashed = await bcrypt.hash(password, 12);
    await User.findByIdAndUpdate(resident.user_id, { password: hashed, email: email || resident.email });
  } else if (password && password.length >= 6 && !resident.user_id && resident.email) {
    // Si envían password, no tenía usuario y sí tiene email, se lo creamos
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      nombre:    resident.nombre,
      email:     resident.email.toLowerCase().trim(),
      password:  hashed,
      rol:       ROLES.RESIDENTE,
      tenant_id: req.tenantId,
      resident_id: resident._id,
      activo:    true,
    });
    resident.user_id = user._id;
    await resident.save();
  } else if (email && resident.user_id) {
    // Si cambia el email, sincronizar con el User
    await User.findByIdAndUpdate(resident.user_id, { email: email.toLowerCase().trim() });
  }

  return ok(res, { resident }, 'Residente actualizado');
});

// ─── CREAR CUENTA DE ACCESO (Residente) ───────────────────────────────────────
const createAccount = asyncHandler(async (req, res) => {
  const resident = await Resident.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!resident) return error(res, 'Residente no encontrado', 404);
  if (resident.user_id) return error(res, 'Este residente ya tiene cuenta de acceso', 409);
  if (!resident.email)  return error(res, 'El residente no tiene email registrado', 400);

  const providedPwd = req.body.password;
  if (!providedPwd || providedPwd.length < 6) {
    return error(res, 'Debe proporcionar una contraseña de al menos 6 caracteres', 400);
  }

  const hashed = await bcrypt.hash(providedPwd, 12);

  const user = await User.create({
    nombre:    resident.nombre,
    email:     resident.email,
    password:  hashed,
    rol:       ROLES.RESIDENTE,
    tenant_id: resident.tenant_id,
    resident_id: resident._id,
    activo:    true,
  });

  resident.user_id = user._id;
  await resident.save();

  return created(res, {
    user_id:   user._id,
    email:     user.email,
  }, 'Cuenta de acceso creada exitosamente.');
});

// ─── CARGA MASIVA CSV ─────────────────────────────────────────────────────────
const bulkImport = asyncHandler(async (req, res) => {
  if (!req.body.rows || !Array.isArray(req.body.rows)) {
    return error(res, 'Se requiere el array "rows"', 400);
  }

  const required = ['nombre', 'apartamento'];
  const results  = { created: 0, errors: [] };

  for (const row of req.body.rows) {
    const missing = required.filter((f) => !row[f]);
    if (missing.length > 0) {
      results.errors.push({ row, error: `Campos faltantes: ${missing.join(', ')}` });
      continue;
    }
    try {
      await Resident.create({
        tenant_id:   req.tenantId,
        nombre:      row.nombre,
        cedula:      row.cedula,
        apartamento: row.apartamento.toUpperCase(),
        telefono:    row.telefono,
        email:       row.email,
      });
      results.created++;
    } catch (e) {
      results.errors.push({ row, error: e.message });
    }
  }

  return ok(res, results, `Importación: ${results.created} creados, ${results.errors.length} errores`);
});

// ─── INGRESO ABIERTO (sin salida) ────────────────────────────────────────────
// GET /api/residents/:id/open-visit
// Devuelve el registro de visita activo (tipo=residente) sin hora de salida.
const getOpenVisit = asyncHandler(async (req, res) => {
  const visit = await Visit.findOne({
    tenant_id:   req.tenantId,
    resident_id: req.params.id,
    tipo:        VISIT_TYPES.RESIDENTE,
    horaSalida:  null,
  })
    .sort({ horaIngreso: -1 })
    .lean();

  if (!visit) return ok(res, { visit: null, vehicleLog: null }, 'Sin ingreso abierto');

  const vehicleLog = await VehicleAccessLog.findOne({
    tenant_id:  req.tenantId,
    visit_id:   visit._id,
    horaSalida: null,
  }).lean();

  return ok(res, { visit, vehicleLog }, 'Ingreso abierto encontrado');
});

// ─── ELIMINAR RESIDENTE ───────────────────────────────────────────────────────
const removeResident = asyncHandler(async (req, res) => {
  const resident = await Resident.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!resident) return error(res, 'Residente no encontrado', 404);
  
  if (resident.user_id) {
    await User.findByIdAndDelete(resident.user_id);
  }
  await Resident.findByIdAndDelete(req.params.id);
  return ok(res, {}, 'Residente eliminado exitosamente');
});

module.exports = { list, getOne, create, updateFaceId, update, createAccount, bulkImport, getOpenVisit, remove: removeResident };