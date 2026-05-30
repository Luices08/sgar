# SGAR — Sistema de Gestión de Acceso Residencial

Aplicación web multi-tenant académica que emula un modelo SaaS local para administrar el control de acceso en conjuntos residenciales.

---

## Estructura del Proyecto

```
sgar/
├── src/
│   ├── app.js                  # Entrada principal de Express
│   ├── config/
│   │   ├── database.js         # Conexión MongoDB
│   │   ├── constants.js        # Constantes del sistema
│   │   └── multer.js           # Configuración de uploads
│   ├── middlewares/
│   │   ├── auth.js             # [ZIP 2] Validación JWT
│   │   ├── authorize.js        # [ZIP 2] Control por rol
│   │   ├── tenantFilter.js     # [ZIP 2] Filtro tenant_id
│   │   └── errorHandler.js     # Manejo de errores
│   ├── models/
│   │   ├── Tenant.js           # [ZIP 3]
│   │   ├── User.js             # [ZIP 3]
│   │   ├── Resident.js         # [ZIP 3]
│   │   ├── Visit.js            # [ZIP 3]
│   │   ├── Vehicle.js          # [ZIP 3]
│   │   ├── Notification.js     # [ZIP 3]
│   │   └── Invitation.js       # [ZIP 3]
│   ├── routes/
│   │   ├── auth.js             # [ZIP 2]
│   │   ├── tenants.js          # [ZIP 3]
│   │   ├── users.js            # [ZIP 3]
│   │   ├── residents.js        # [ZIP 3]
│   │   ├── visits.js           # [ZIP 3]
│   │   ├── vehicles.js         # [ZIP 3]
│   │   ├── notifications.js    # [ZIP 3]
│   │   ├── invitations.js      # [ZIP 3]
│   │   └── views/
│   │       ├── admin.js        # [ZIP 4]
│   │       ├── porteria.js     # [ZIP 5]
│   │       └── residente.js    # [ZIP 6]
│   ├── controllers/            # [ZIP 2-6]
│   ├── services/               # [ZIP 2-6]
│   └── utils/
│       ├── asyncHandler.js
│       ├── response.js
│       └── seed.js
├── views/
│   ├── admin/                  # [ZIP 4] Plantillas EJS panel admin
│   ├── porteria/               # [ZIP 5] Plantillas EJS portería
│   ├── residente/              # [ZIP 6] Plantillas EJS residente
│   └── error.ejs               # Vista de error genérica
├── public/
│   ├── admin/
│   │   ├── css/                # [ZIP 4]
│   │   └── js/                 # [ZIP 4]
│   ├── porteria/
│   │   ├── css/                # [ZIP 5]
│   │   └── js/                 # [ZIP 5] incluye sw.js y dexie
│   └── residente/
│       ├── css/                # [ZIP 6]
│       └── js/                 # [ZIP 6]
├── uploads/                    # Generado automáticamente
├── logs/                       # Generado automáticamente
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## Instalación y Puesta en Marcha

### Prerequisitos

- Node.js 18+
- MongoDB 6+ corriendo en localhost:27017

### Pasos

```bash
# 1. Descomprimir todos los ZIPs en la misma carpeta sgar/
# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# 4. (Opcional) Cargar datos de demostración
npm run seed

# 5. Iniciar servidor
npm run dev     # Desarrollo (nodemon)
npm start       # Producción
```

### URLs

| Interfaz          | URL                          | Usuario demo                    |
|-------------------|------------------------------|---------------------------------|
| Panel Admin       | http://localhost:3000/admin  | admin@sgar.local / admin123     |
| AdminConjunto     | http://localhost:3000/admin  | admin.lospinos@sgar.local / ... |
| Portería (PWA)    | http://localhost:3000/porteria| celador1@sgar.local / celador123|
| Residente (PWA)   | http://localhost:3000/residente| (crear desde AdminConjunto)   |

---

## Orden de Instalación de ZIPs

| ZIP | Contenido                              |
|-----|----------------------------------------|
| 01  | Estructura base, Express, config       |
| 02  | Autenticación JWT, middlewares         |
| 03  | Modelos MongoDB, API REST completa     |
| 04  | Panel Admin EJS (AdminControl + AdminConjunto) |
| 05  | PWA Portería (Celador, Offline-First)  |
| 06  | PWA Residente                          |

Todos los ZIPs comparten la misma raíz `sgar/`. Descomprimir en orden en la misma carpeta.

---

## Decisiones Arquitectónicas Clave

- **Multitenancy por campo**: `tenant_id` indexado en todas las colecciones
- **Write-Through**: toda escritura del Celador va primero a Dexie.js
- **Offline-First**: Service Worker + Dexie.js en la PWA de Portería
- **Sin frameworks de frontend**: EJS + Vanilla JS + fetch() nativo
- **JWT con tenant_id embebido**: sin consultas adicionales para aislar datos
- **Auditoría completa**: ediciones/eliminaciones conservan historial en Visits

---

*Luis Esteban Morales Gasca — ADSO 3142784*
