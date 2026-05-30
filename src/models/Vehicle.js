'use strict';

const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
  tenant_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Tenant',
    required: true,
    index:    true,
  },
  placa: {
    type:      String,
    required:  true,
    trim:      true,
    uppercase: true,
  },
  descripcion: {
    type:  String,
    trim:  true,     // Ej: "Toyota Corolla gris"
  },
  apartamento: {
    type:     String,
    required: true,
    trim:     true,
    uppercase: true,
  },
  resident_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Resident',
    default: null,
  },
  activo: {
    type:    Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

vehicleSchema.index({ tenant_id: 1, placa: 1 });

module.exports = mongoose.model('Vehicle', vehicleSchema);
