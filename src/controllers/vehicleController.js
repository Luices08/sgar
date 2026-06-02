'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, error, paginated } = require('../utils/response');
const Vehicle = require('../models/Vehicle');

const list = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const skip  = (page - 1) * limit;
  const filter = { tenant_id: req.tenantId };
  if (req.query.activo !== undefined) filter.activo = req.query.activo !== 'false';
  if (req.query.registradoEnPorteria !== undefined) {
    filter.registradoEnPorteria = req.query.registradoEnPorteria !== 'false';
  }
  if (req.query.q) {
    const re = new RegExp(req.query.q, 'i');
    filter.$or = [{ placa: re }, { apartamento: re }, { descripcion: re }];
  }
  const [vehicles, total] = await Promise.all([
    Vehicle.find(filter).sort({ placa: 1 }).skip(skip).limit(limit).lean(),
    Vehicle.countDocuments(filter),
  ]);
  return paginated(res, vehicles, total, page, limit);
});

// ─── LISTAR VEHÍCULOS POR RESIDENTE ─────────────────────────────────────────
const listByResident = asyncHandler(async (req, res) => {
  const vehicles = await Vehicle.find({
    tenant_id:   req.tenantId,
    resident_id: req.params.residentId,
    activo:      true,
  }).sort({ placa: 1 }).lean();

  return ok(res, { vehicles, total: vehicles.length });
});

const create = asyncHandler(async (req, res) => {
  const { placa, descripcion, apartamento, resident_id } = req.body;
  if (!placa || !apartamento) return error(res, 'placa y apartamento son requeridos', 400);
  const vehicle = await Vehicle.create({
    tenant_id:   req.tenantId,
    placa:       placa.toUpperCase(),
    descripcion,
    apartamento: apartamento.toUpperCase(),
    resident_id: resident_id || null,
  });
  return created(res, { vehicle }, 'Vehículo registrado');
});

const update = asyncHandler(async (req, res) => {
  const { descripcion, apartamento, activo } = req.body;
  const updateData = {};
  if (descripcion !== undefined) updateData.descripcion = descripcion;
  if (apartamento !== undefined) updateData.apartamento = apartamento.toUpperCase();
  if (activo      !== undefined) updateData.activo      = activo;
  const vehicle = await Vehicle.findOneAndUpdate(
    { _id: req.params.id, tenant_id: req.tenantId },
    updateData,
    { new: true }
  );
  if (!vehicle) return error(res, 'Vehículo no encontrado', 404);
  return ok(res, { vehicle }, 'Vehículo actualizado');
});

const remove = asyncHandler(async (req, res) => {
  const v = await Vehicle.findOneAndDelete({ _id: req.params.id, tenant_id: req.tenantId });
  if (!v) return error(res, 'Vehículo no encontrado', 404);
  return ok(res, {}, 'Vehículo eliminado');
});

module.exports = { list, listByResident, create, update, remove };
