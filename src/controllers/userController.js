'use strict';

const bcrypt      = require('bcryptjs');
const asyncHandler= require('../utils/asyncHandler');
const { ok, created, error, paginated } = require('../utils/response');
const { ROLES }   = require('../config/constants');
const User        = require('../models/User');

// ─── LISTAR USUARIOS (por tenant) ─────────────────────────────────────────────
const list = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;

  const filter = {};
  if (req.tenantId) filter.tenant_id = req.tenantId;
  if (req.query.rol) filter.rol = req.query.rol;

  const [users, total] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  return paginated(res, users, total, page, limit);
});

// ─── CREAR USUARIO ────────────────────────────────────────────────────────────
const create = asyncHandler(async (req, res) => {
  const { nombre, email, password, rol, tenant_id } = req.body;
  if (!nombre || !email || !password || !rol) {
    return error(res, 'nombre, email, password y rol son requeridos', 400);
  }

  // Solo AdminControl puede crear otros AdminControl
  if (rol === ROLES.ADMIN_CONTROL && req.user.rol !== ROLES.ADMIN_CONTROL) {
    return error(res, 'Sin permisos para crear AdminControl', 403);
  }

  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) return error(res, 'El email ya está registrado', 409);

  const hashed = await bcrypt.hash(password, 12);
  const user   = await User.create({
    nombre,
    email:    email.toLowerCase().trim(),
    password: hashed,
    rol,
    tenant_id: tenant_id || req.tenantId || null,
    activo:    true,
  });

  return created(res, { user: { ...user.toObject(), password: undefined } }, 'Usuario creado');
});

// ─── ACTUALIZAR ESTADO ────────────────────────────────────────────────────────
const toggleActive = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return error(res, 'Usuario no encontrado', 404);

  // Verificar que pertenece al tenant (excepto AdminControl)
  if (req.user.rol !== ROLES.ADMIN_CONTROL) {
    if (!user.tenant_id || user.tenant_id.toString() !== req.tenantId.toString()) {
      return error(res, 'Sin permisos sobre este usuario', 403);
    }
  }

  user.activo = !user.activo;
  await user.save();
  return ok(res, { activo: user.activo }, `Usuario ${user.activo ? 'activado' : 'desactivado'}`);
});

// ─── RESETEAR CONTRASEÑA ──────────────────────────────────────────────────────
const resetPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return error(res, 'Nueva contraseña requerida (min 6 caracteres)', 400);
  }

  const user = await User.findById(req.params.id);
  if (!user) return error(res, 'Usuario no encontrado', 404);

  user.password = await bcrypt.hash(newPassword, 12);
  await user.save();
  return ok(res, {}, 'Contraseña restablecida');
});

module.exports = { list, create, toggleActive, resetPassword };
