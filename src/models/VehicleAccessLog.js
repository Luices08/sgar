'use strict';

const mongoose = require('mongoose');

/**
 * VehicleAccessLog
 * Historial de ingresos y salidas de vehículos.
 * Complementa la colección Visit para trazabilidad vehicular específica.
 */
const vehicleAccessLogSchema = new mongoose.Schema({
  tenant_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Tenant',
    required: true,
    index:    true,
  },

  // ─── VEHÍCULO ─────────────────────────────────────────────────────────────
  vehicle_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Vehicle',
    required: true,
  },
  placa: {
    type:      String,
    required:  true,
    trim:      true,
    uppercase: true,
  },

  // ─── PROPIETARIO REGISTRADO ───────────────────────────────────────────────
  propietario_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'Resident',
    default: null,
  },
  propietario_nombre: {
    type: String,
    trim: true,
  },

  // ─── CONDUCTOR REAL ───────────────────────────────────────────────────────
  // Puede ser el propietario u otra persona (residente o externo)
  conductor_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Resident',
    default: null,   // null si no se identificó por facial
  },
  conductor_nombre: {
    type: String,
    trim: true,
  },
  esPropietario: {
    type:    Boolean,
    default: true,   // false = uso por tercero
  },

  // ─── PERMISO (cuando esPropietario es false) ──────────────────────────────
  permission_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'VehiclePermission',
    default: null,
  },

  // ─── TIEMPOS ──────────────────────────────────────────────────────────────
  horaIngreso: {
    type:    Date,
    default: Date.now,
  },
  horaSalida: {
    type:    Date,
    default: null,
  },

  // ─── TRAZABILIDAD ─────────────────────────────────────────────────────────
  celador_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'User',
    required: true,
  },
  celador_nombre: {
    type: String,
  },
  registradoEnPorteria: {
    // true si el vehículo fue registrado en el momento del ingreso (no preregistrado)
    type:    Boolean,
    default: false,
  },
  visit_id: {
    // Referencia a la Visit general del conductor (si aplica)
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Visit',
    default: null,
  },
}, {
  timestamps: true,
});

vehicleAccessLogSchema.index({ tenant_id: 1, horaIngreso: -1 });
vehicleAccessLogSchema.index({ tenant_id: 1, placa: 1 });
vehicleAccessLogSchema.index({ tenant_id: 1, propietario_id: 1 });
vehicleAccessLogSchema.index({ tenant_id: 1, vehicle_id: 1 });

module.exports = mongoose.model('VehicleAccessLog', vehicleAccessLogSchema);
