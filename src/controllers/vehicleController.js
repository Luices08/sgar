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
    filter.$or = [{ placa: re }, { apartamento: re }, { marca: re }, { modelo: re }];
  }
  const [vehicles, total] = await Promise.all([
    Vehicle.find(filter).populate('propietarios', 'nombre').sort({ placa: 1 }).skip(skip).limit(limit).lean(),
    Vehicle.countDocuments(filter),
  ]);
  return paginated(res, vehicles, total, page, limit);
});

// ─── LISTAR VEHÍCULOS POR RESIDENTE ─────────────────────────────────────────
const listByResident = asyncHandler(async (req, res) => {
  const vehicles = await Vehicle.find({
    tenant_id:    req.tenantId,
    propietarios: req.params.residentId,
    activo:       true,
  }).sort({ placa: 1 }).lean();

  return ok(res, { vehicles, total: vehicles.length });
});

const create = asyncHandler(async (req, res) => {
  const { placa, tipo, marca, modelo, anio, color, foto, apartamento, propietarios, esTemporal } = req.body;
  if (!tipo || !apartamento) return error(res, 'tipo y apartamento son requeridos', 400);
  if ((tipo === 'Carro' || tipo === 'Motocicleta') && !placa) {
    return error(res, 'La placa es obligatoria para carros y motocicletas', 400);
  }

  try {
    const vehicle = await Vehicle.create({
      tenant_id:   req.tenantId,
      tipo,
      placa:       placa ? placa.toUpperCase() : undefined,
      marca,
      modelo,
      anio,
      color,
      foto,
      apartamento: apartamento.toUpperCase(),
      propietarios: Array.isArray(propietarios) ? propietarios : (propietarios ? [propietarios] : []),
      esTemporal:  esTemporal || false,
    });

    // Sincronizar Residentes (añadir vehículo)
    if (vehicle.propietarios && vehicle.propietarios.length > 0) {
      const Resident = require('../models/Resident');
      await Resident.updateMany(
        { _id: { $in: vehicle.propietarios } },
        { $addToSet: { vehiculos: vehicle._id } }
      );
    }

    return created(res, { vehicle }, 'Vehículo registrado');
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return error(res, messages.join(', '), 400);
    }
    throw err;
  }
});

const update = asyncHandler(async (req, res) => {
  const { placa, tipo, marca, modelo, anio, color, foto, apartamento, activo, propietarios, esTemporal, confirmarHuerfano } = req.body;
  
  const vehicle = await Vehicle.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!vehicle) return error(res, 'Vehículo no encontrado', 404);

  const updateData = {};
  if (tipo !== undefined) updateData.tipo = tipo;
  if (placa !== undefined) updateData.placa = placa.toUpperCase();
  if (marca !== undefined) updateData.marca = marca;
  if (modelo !== undefined) updateData.modelo = modelo;
  if (anio !== undefined) updateData.anio = anio;
  if (color !== undefined) updateData.color = color;
  if (foto !== undefined) updateData.foto = foto;
  if (apartamento !== undefined) updateData.apartamento = apartamento.toUpperCase();
  if (activo !== undefined) updateData.activo = activo;
  if (esTemporal !== undefined) updateData.esTemporal = esTemporal;

  let oldOwners = vehicle.propietarios.map(id => id.toString());
  let newOwners = Array.isArray(propietarios) ? propietarios : undefined;

  // REGLA DE NEGOCIO: Si se intenta dejar el array de propietarios vacío
  if (newOwners && newOwners.length === 0 && !confirmarHuerfano && !vehicle.esTemporal) {
    return res.status(200).json({ alerta: 'huerfano', message: 'El vehículo quedará sin propietarios.' });
  }

  if (newOwners !== undefined) {
    updateData.propietarios = newOwners;
  }

  try {
    const updatedVehicle = await Vehicle.findOneAndUpdate(
      { _id: req.params.id, tenant_id: req.tenantId },
      updateData,
      { new: true, runValidators: true }
    );

    // Sincronizar Residentes si hubo cambios en los propietarios
    if (newOwners !== undefined) {
      const Resident = require('../models/Resident');
      // Residentes eliminados del vehículo: quitar de su array vehiculos
      const removedOwners = oldOwners.filter(o => !newOwners.includes(o));
      if (removedOwners.length > 0) {
        await Resident.updateMany(
          { _id: { $in: removedOwners } },
          { $pull: { vehiculos: vehicle._id } }
        );
      }
      // Residentes agregados al vehículo: añadir a su array vehiculos
      const addedOwners = newOwners.filter(o => !oldOwners.includes(o));
      if (addedOwners.length > 0) {
        await Resident.updateMany(
          { _id: { $in: addedOwners } },
          { $addToSet: { vehiculos: vehicle._id } }
        );
      }
    }

    return ok(res, { vehicle: updatedVehicle }, 'Vehículo actualizado');
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return error(res, messages.join(', '), 400);
    }
    throw err;
  }
});

const remove = asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findOneAndDelete({ _id: req.params.id, tenant_id: req.tenantId });
  if (!vehicle) return error(res, 'Vehículo no encontrado', 404);

  // ELIMINACIÓN EN CASCADA
  const Resident = require('../models/Resident');
  await Resident.updateMany(
    { vehiculos: vehicle._id },
    { $pull: { vehiculos: vehicle._id } }
  );

  return ok(res, {}, 'Vehículo y referencias eliminados en cascada');
});

module.exports = { list, listByResident, create, update, remove };
