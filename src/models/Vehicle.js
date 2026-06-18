'use strict';

const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
  tenant_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Tenant',
    required: true,
    index:    true,
  },
  propietarios: [{
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Resident',
  }],
  tipo: {
    type:     String,
    enum:     ['Carro', 'Motocicleta', 'Otro'],
    required: true,
  },
  placa: {
    type:      String,
    trim:      true,
    uppercase: true,
    required: function() {
      return this.tipo === 'Carro' || this.tipo === 'Motocicleta';
    },
    validate: {
      validator: function(v) {
        if (!v) return true;
        if (this.tipo === 'Carro') return /^[A-Z]{3} \d{3}$/.test(v);
        if (this.tipo === 'Motocicleta') return /^[A-Z]{3} \d{2}[A-Z]$/.test(v);
        return true;
      },
      message: props => `${props.value} no es un formato de placa válido`
    }
  },
  marca: {
    type: String,
    trim: true,
  },
  modelo: {
    type: String,
    trim: true,
  },
  anio: {
    type: Number,
  },
  color: {
    type: String,
    trim: true,
  },
  foto: {
    type: String, // Base64 o URL
    default: '',
  },
  apartamento: {
    type:     String,
    required: true,
    trim:     true,
    uppercase: true,
  },
  activo: {
    type:    Boolean,
    default: true,
  },
  registradoEnPorteria: {
    type:    Boolean,
    default: false,
  },
  esTemporal: {
    type:    Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

vehicleSchema.index({ tenant_id: 1, placa: 1 });

module.exports = mongoose.model('Vehicle', vehicleSchema);
