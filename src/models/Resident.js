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
  // ID generado por FaceIO al momento del enrolamiento biométrico
  faceId: {
    type:    String,
    default: null,
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
}, {
  timestamps: true,
});

// Índices para búsquedas frecuentes
residentSchema.index({ tenant_id: 1, apartamento: 1 });
residentSchema.index({ tenant_id: 1, cedula: 1 });
residentSchema.index({ tenant_id: 1, faceId: 1 });

module.exports = mongoose.model('Resident', residentSchema);
