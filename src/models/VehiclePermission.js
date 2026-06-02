'use strict';

const mongoose = require('mongoose');

/**
 * VehiclePermission
 * Permisos temporales otorgados por el propietario de un vehículo
 * para que un tercero lo use en un ingreso específico.
 */
const vehiclePermissionSchema = new mongoose.Schema({
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
    type:     String,
    required: true,
    uppercase: true,
    trim:     true,
  },

  // ─── PROPIETARIO ──────────────────────────────────────────────────────────
  propietario_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Resident',
    required: true,
  },
  propietario_nombre: {
    type: String,
    trim: true,
  },

  // ─── CONDUCTOR SOLICITANTE ────────────────────────────────────────────────
  conductor_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Resident',
    default: null,
  },
  conductor_nombre: {
    type: String,
    trim: true,
  },

  // ─── ESTADO DEL PERMISO ───────────────────────────────────────────────────
  // 'pendiente' → esperando respuesta del propietario
  // 'aprobado'  → propietario dijo Sí, se requiere verificación facial
  // 'rechazado' → propietario dijo No, celador notificado
  // 'expirado'  → propietario no respondió en el tiempo límite
  // 'completado'→ acceso verificado y autorizado (facial OK)
  estado: {
    type:    String,
    enum:    ['pendiente', 'aprobado', 'rechazado', 'expirado', 'completado'],
    default: 'pendiente',
  },

  // ─── RESPUESTA DEL PROPIETARIO ────────────────────────────────────────────
  respondidoEn: {
    type:    Date,
    default: null,
  },

  // ─── VERIFICACIÓN FACIAL DEL CONDUCTOR ───────────────────────────────────
  // Solo cuando estado = 'completado'
  verificadoFacialEn: {
    type:    Date,
    default: null,
  },

  // ─── TIEMPOS ──────────────────────────────────────────────────────────────
  // Límite de tiempo para que el propietario responda (por defecto 3 min)
  expiraEn: {
    type:    Date,
    required: true,
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

  // Referencia al log de acceso vehicular resultante
  accessLog_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'VehicleAccessLog',
    default: null,
  },
}, {
  timestamps: true,
});

vehiclePermissionSchema.index({ tenant_id: 1, createdAt: -1 });
vehiclePermissionSchema.index({ tenant_id: 1, propietario_id: 1 });
vehiclePermissionSchema.index({ tenant_id: 1, estado: 1 });
vehiclePermissionSchema.index({ expiraEn: 1 });   // para job de expiración

module.exports = mongoose.model('VehiclePermission', vehiclePermissionSchema);
