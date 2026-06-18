'use strict';

const mongoose = require('mongoose');

const residentSchema = new mongoose.Schema({
  tenant_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Tenant',
    required: true,
    index:    true,
  },
  nombre: {
    type:     String,
    required: true,
    trim:     true,
    maxlength: 100,
  },
  cedula: {
    type:  String,
    trim:  true,
  },
  apartamento: {
    type:     String,
    required: true,
    trim:     true,
    uppercase: true,
  },
  telefono: {
    type:  String,
    trim:  true,
  },
  email: {
    type:      String,
    lowercase: true,
    trim:      true,
  },
  fotoUrl: {
    type:    String,
    default: null,
  },
  // Token biométrico del proveedor facial externo (Face++). Opcional.
  faceId: {
    type:    String,
    default: null,
  },
  // Descriptor facial local generado con face-api.js (128 números Float32).
  // Se usa para reconocimiento sin depender de APIs externas.
  faceDescriptor: {
    type:    [Number],
    default: null,
    validate: {
      validator: function(v) {
        return v === null || v === undefined || v.length === 128;
      },
      message: 'faceDescriptor debe ser un array de 128 números (face-api.js descriptor)',
    },
  },
  activo: {
    type:    Boolean,
    default: true,
  },
  // Referencia al usuario del sistema (si tiene cuenta de acceso creada)
  user_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'User',
    default: null,
  },
  // Relación N:M con Vehículos
  vehiculos: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle',
  }],
}, {
  timestamps: true,
});

// Índices para búsquedas frecuentes
residentSchema.index({ tenant_id: 1, apartamento: 1 });
residentSchema.index({ tenant_id: 1, cedula: 1 });
residentSchema.index({ tenant_id: 1, faceId: 1 });

module.exports = mongoose.model('Resident', residentSchema);
