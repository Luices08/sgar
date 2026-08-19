'use strict';

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  tenant_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Tenant',
    required: true,
    index:    true,
  },
  // Destinatario (null = visible para todos los admins del tenant)
  user_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'User',
    default: null,
    index:   true,
  },
  apartamento: {
    type:  String,
    trim:  true,
    uppercase: true,
  },
  // Contenido
  tipo: {
    type:    String,
    enum:    [
      'visita', 'domicilio', 'vehiculo', 'sistema',
      'vehiculo_nuevo',                // Vehículo registrado en portería → aviso al admin
      'permiso_vehiculo',              // Solicitud de permiso → propietario debe responder
      'permiso_aprobado',              // Propietario dijo Sí → aviso al celador
      'permiso_rechazado',             // Propietario dijo No → aviso al celador
      'invitacion_vehiculo',           // Propietario invita a residente a estar autorizado
      'invitacion_vehiculo_aceptada',  // Residente aceptó la autorización
      'invitacion_vehiculo_rechazada', // Residente rechazó la autorización
      'alerta_vehiculo_no_autorizado', // Alerta al responsable principal por conductor no autorizado
      'tecnico_mantenimiento',
      'autorizacion_visita',           // Celador pide permiso de ingreso a Residente
      'solicitud_ayuda',               // Residente pide ayuda o soporte al celador
      'panico',                        // Botón de pánico
      'emergencia',                    // Alerta de emergencia
    ],
    default: 'sistema',
  },
  estadoAprobacion: {
    type: String,
    enum: ['pendiente', 'aprobado', 'rechazado'],
    default: 'pendiente',
  },
  titulo: {
    type:     String,
    required: true,
    maxlength: 200,
  },
  mensaje: {
    type:     String,
    required: true,
    maxlength: 1000,
  },
  // Referencia al registro de visita que generó la notificación
  visit_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Visit',
    default: null,
  },
  // Referencia a invitación de vehículo
  vehicle_invitation_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'VehicleInvitation',
    default: null,
  },
  // Referencia a vehículo
  vehicle_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Vehicle',
    default: null,
  },
  // Referencia al permiso vehicular (cuando tipo = 'permiso_*')
  permission_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'VehiclePermission',
    default: null,
  },
  // Indica si el residente debe dar una respuesta (para permisos vehiculares o recepción de domicilios)
  requiereRespuesta: {
    type:    Boolean,
    default: false,
  },
  estadoDomicilio: {
    type:    String,
    enum:    ['pendiente', 'recibido', 'ingresado'],
    default: null,
  },
  fechaRecepcion: {
    type:    Date,
    default: null,
  },
  leida: {
    type:    Boolean,
    default: false,
    index:   true,
  },
}, {
  timestamps: true,
});

notificationSchema.index({ user_id: 1, leida: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
