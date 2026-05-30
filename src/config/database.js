'use strict';

const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sgar', {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`✅  MongoDB conectado: ${conn.connection.host}`);
  } catch (err) {
    console.error(`❌  Error al conectar MongoDB: ${err.message}`);
    process.exit(1);
  }
};

// Eventos de conexión
mongoose.connection.on('disconnected', () =>
  console.warn('⚠️   MongoDB desconectado')
);
mongoose.connection.on('reconnected', () =>
  console.log('🔄  MongoDB reconectado')
);

module.exports = connectDB;
