'use strict';

const mongoose = require('mongoose');

/**
 * VehicleInvitation
 * Invitaciones de asignación y autorización de vehículos entre residentes.
 * Cuando un residente responsable principal autoriza a otro residente,
 * este último debe aceptar la invitación antes de quedar formalmente autorizado.
 */
const vehicleInvitationSchema = new mongoose.Schema({
  tenant_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Tenant',
    required: true,
    index:    true,
  },
  vehicle_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Vehicle',
    required: true,
  },
  placa: {
    type:      String,
    required:  true,
    uppercase: true,
    trim:      true,
  },
  // Residente responsable principal que emite la invitación
  propietario_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Resident',
    required: true,
  },
  propietario_nombre: {
    type: String,
    trim: true,
  },
  // Residente invitado a estar autorizado
  residente_invitado_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Resident',
    required: true,
    index:    true,
  },
  residente_invitado_nombre: {
    type: String,
    trim: true,
  },
  apartamento: {
    type:      String,
    uppercase: true,
    trim:      true,
  },
  estado: {
    type:    String,
    enum:    ['pendiente', 'aceptada', 'rechazada', 'cancelada'],
    default: 'pendiente',
    index:   true,
  },
  respondidoEn: {
    type:    Date,
    default: null,
  },
  mensaje: {
    type:    String,
    trim:    true,
    default: '',
  },
}, {
  timestamps: true,
});

vehicleInvitationSchema.index({ tenant_id: 1, vehicle_id: 1, estado: 1 });
vehicleInvitationSchema.index({ tenant_id: 1, residente_invitado_id: 1, estado: 1 });
vehicleInvitationSchema.index({ tenant_id: 1, propietario_id: 1, createdAt: -1 });

module.exports = mongoose.model('VehicleInvitation', vehicleInvitationSchema);
