'use strict';

require('dotenv').config();
const express      = require('express');
const path         = require('path');
const morgan       = require('morgan');
const helmet       = require('helmet');
const cors         = require('cors');
const cookieParser = require('cookie-parser');

const connectDB    = require('./config/database');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

const app = express();

// ─── BASE DE DATOS ─────────────────────────────────────────────────────────────
connectDB();

// ─── SEGURIDAD Y PARSERS ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false   // se ajusta en producción
}));
app.use(cors({ origin: `http://localhost:${process.env.PORT || 3000}` }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ─── MOTOR DE VISTAS (EJS) ─────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// ─── ARCHIVOS ESTÁTICOS ────────────────────────────────────────────────────────
app.use('/static/admin',    express.static(path.join(__dirname, '..', 'public', 'admin')));
app.use('/static/porteria', express.static(path.join(__dirname, '..', 'public', 'porteria')));
app.use('/static/residente',express.static(path.join(__dirname, '..', 'public', 'residente')));
app.use('/uploads',         express.static(path.join(__dirname, '..', 'uploads')));
app.use('/models', express.static(path.join(__dirname, '../public/models')));

// ─── RUTAS ─────────────────────────────────────────────────────────────────────
// Se registran en ZIP 2 (auth) y subsiguientes
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/tenants',     require('./routes/tenants'));
app.use('/api/users',       require('./routes/users'));
app.use('/api/residents',   require('./routes/residents'));
app.use('/api/visits',      require('./routes/visits'));
app.use('/api/vehicles',    require('./routes/vehicles'));
app.use('/api/notifications',   require('./routes/notifications'));
app.use('/api/invitations',     require('./routes/invitations'));
app.use('/api/vehicle-access',  require('./routes/vehicleAccess'));  // Historial + permisos vehiculares
app.use('/api/visitors',        require('./routes/visitors'));        // Registro manual + código
app.use('/api/facial-access',   require('./routes/facialAccess'));    // Reconocimiento facial residentes
app.use('/api/facial-enrollment', require('./routes/facialEnrollment')); // Enrolamiento biométrico

// Rutas de vistas EJS
app.use('/admin',     require('./routes/views/admin'));
app.use('/porteria',  require('./routes/views/porteria'));
app.use('/residente', require('./routes/views/residente'));

// Raíz → login
app.get('/', (req, res) => res.redirect('/admin/login'));

// ─── MANEJO DE ERRORES ─────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── INICIO ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🏢  SGAR corriendo en http://localhost:${PORT}`);
  console.log(`   Panel Admin  → http://localhost:${PORT}/admin`);
  console.log(`   Portería     → http://localhost:${PORT}/porteria`);
  console.log(`   Residente    → http://localhost:${PORT}/residente\n`);
});

module.exports = app;
