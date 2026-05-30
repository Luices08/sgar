'use strict';

const bcrypt      = require('bcryptjs');
const asyncHandler= require('../utils/asyncHandler');
const { ok, created, error, paginated } = require('../utils/response');
const { ROLES }   = require('../config/constants');
const faceioService = require('../services/faceioService');

const Resident = require('../models/Resident');
const User     = require('../models/User');

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

  // Enrolamiento FaceIO automático si hay foto configurada
  if (fotoUrl && process.env.FACEIO_API_KEY) {
    try {
      const faceioResult = await faceioService.enrollFace(fotoUrl);
      if (faceioResult && faceioResult.faceId) {
        resident.faceId = faceioResult.faceId;
        await resident.save();
        console.log(`FaceID enrollado para residente ${resident._id}: ${faceioResult.faceId}`);
      }
    } catch (faceioError) {
      console.warn('Error en enrolamiento FaceIO (continuando sin él):', faceioError.message);
      // Continuamos sin FaceIO - no es crítico para la creación del residente
    }
  }

  return created(res, { resident }, 'Residente creado');
});

// ─── ACTUALIZAR faceId (POST-enrolamiento FaceIO) ─────────────────────────────
const updateFaceId = asyncHandler(async (req, res) => {
  const { faceId } = req.body;
  if (!faceId) return error(res, 'faceId es requerido', 400);

  const resident = await Resident.findOneAndUpdate(
    { _id: req.params.id, tenant_id: req.tenantId },
    { faceId },
    { new: true }
  );

  if (!resident) return error(res, 'Residente no encontrado', 404);
  return ok(res, { resident }, 'faceId actualizado');
});

// ─── ACTUALIZAR RESIDENTE ─────────────────────────────────────────────────────
const update = asyncHandler(async (req, res) => {
  const { nombre, cedula, apartamento, telefono, email, activo } = req.body;
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
  return ok(res, { resident }, 'Residente actualizado');
});

// ─── CREAR CUENTA DE ACCESO (Residente) ───────────────────────────────────────
const createAccount = asyncHandler(async (req, res) => {
  const resident = await Resident.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!resident) return error(res, 'Residente no encontrado', 404);
  if (resident.user_id) return error(res, 'Este residente ya tiene cuenta de acceso', 409);
  if (!resident.email)  return error(res, 'El residente no tiene email registrado', 400);

  // Contraseña inicial = número de cédula
  const initialPwd = resident.cedula || '123456';
  const hashed     = await bcrypt.hash(initialPwd, 12);

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
    password_inicial: initialPwd,
  }, 'Cuenta de acceso creada. Contraseña inicial = cédula');
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

module.exports = { list, getOne, create, updateFaceId, update, createAccount, bulkImport };
