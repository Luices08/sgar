'use strict';

const mongoose = require('mongoose');

/**
 * VehicleAccessLog
 * Historial de ingresos y salidas de vehículos.
 * Registra accesos vehiculares, trazabilidad del conductor, si está autorizado
 * o si es un conductor no autorizado (identificando al responsable principal).
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
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Vehicle',
    default: null,
  },
  placa: {
    type:      String,
    required:  true,
    trim:      true,
    uppercase: true,
  },
  tipoVehiculo: {
    type:    String,
    enum:    ['Carro', 'Motocicleta', 'Otro'],
    default: 'Carro',
  },
  esVehiculoRegistrado: {
    type:    Boolean,
    default: true,
  },

  // ─── RESPONSABLE PRINCIPAL REGISTRADO ─────────────────────────────────────
  responsablePrincipal_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Resident',
    default: null,
  },
  responsablePrincipal_nombre: {
    type:    String,
    trim:    true,
    default: null,
  },
  apartamento: {
    type:      String,
    trim:      true,
    uppercase: true,
    default:   null,
  },

  // Compatibilidad hacia atrás
  propietario_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Resident',
    default: null,
  },
  propietario_nombre: {
    type:    String,
    trim:    true,
    default: null,
  },

  // ─── CONDUCTOR REAL ───────────────────────────────────────────────────────
  conductor_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Resident',
    default: null,
  },
  conductor_nombre: {
    type:    String,
    trim:    true,
    default: null,
  },
  conductor_tipo: {
    type:    String,
    enum:    ['residente', 'visitante', 'tercero'],
    default: 'residente',
  },
  // true = El conductor es el Responsable Principal o una Persona Autorizada
  esAutorizado: {
    type:    Boolean,
    default: true,
  },
  // true = Salta advertencia al celador porque el conductor no está autorizado
  alertaNoAutorizado: {
    type:    Boolean,
    default: false,
  },

  // Compatibilidad hacia atrás
  esPropietario: {
    type:    Boolean,
    default: true,
  },
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
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  celador_nombre: {
    type: String,
  },
  celador_salida_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'User',
    default: null,
  },
  celador_salida_nombre: {
    type:    String,
    default: null,
  },
  registradoEnPorteria: {
    type:    Boolean,
    default: false,
  },
  visit_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Visit',
    default: null,
  },
}, {
  timestamps: true,
});

vehicleAccessLogSchema.index({ tenant_id: 1, horaIngreso: -1 });
vehicleAccessLogSchema.index({ tenant_id: 1, placa: 1 });
vehicleAccessLogSchema.index({ tenant_id: 1, responsablePrincipal_id: 1 });
vehicleAccessLogSchema.index({ tenant_id: 1, vehicle_id: 1 });
vehicleAccessLogSchema.index({ tenant_id: 1, alertaNoAutorizado: 1 });

module.exports = mongoose.model('VehicleAccessLog', vehicleAccessLogSchema);
