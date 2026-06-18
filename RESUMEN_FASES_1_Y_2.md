# Resumen Fases 1 y 2 - Rediseño del Sistema de Portería y Vehículos

Este documento resume todas las funcionalidades, refactorizaciones e implementaciones realizadas durante las Fases 1 y 2 del rediseño del sistema SGAR, enfocadas en la gestión de vehículos y el control de acceso en la portería.

---

## FASE 1: Gestión de Vehículos y Módulo Administrador

### 1. Modelado de Datos y Backend
*   **Actualización del Schema (`src/models/Vehicle.js`)**: Se expandió el modelo de vehículo para incluir los campos `tipo` (Carro, Motocicleta, Otro), `marca`, `modelo`, `anio`, `color`, `foto` (en Base64/URL) y su vinculación con el `resident_id`.
*   **Validaciones Estrictas por Regex**: Se implementó lógica a nivel del Schema y del controlador para validar el formato de las placas. Solo es obligatoria para "Carro" (formato `AAA 000`) y "Motocicleta" (formato `AAA 00A`). El tipo "Otro" permite guardar vehículos sin placa (bicicletas, patinetas, etc.).
*   **Controladores (`src/controllers/vehicleController.js`)**: Se actualizó el CRUD de vehículos para soportar las nuevas validaciones (manejando `runValidators: true` en actualizaciones) y retornando el nombre del residente (`populate`) en las listas.

### 2. Panel Administrador (UI/UX)
*   **Nuevo Módulo en el Sidebar (`views/admin/partials/nav.ejs`)**: Se agregó la pestaña "Vehículos" al menú lateral del administrador.
*   **Vista y Lógica Frontend (`views/admin/vehiculos.ejs`, `public/admin/js/vehiculos.js`)**: 
    *   Se creó una tabla responsiva para listar todos los vehículos registrados, mostrando la miniatura de la foto y el residente asignado.
    *   Se construyó un panel lateral ("Drawer") con un formulario interactivo para la creación y edición de vehículos.
    *   El formulario incluye previsualización de imágenes subidas en tiempo real (convertidas a Base64) y selección dinámica de residentes, filtrándolos automáticamente al ingresar el número de apartamento.
    *   Se integraron validaciones en caliente (Regex) directamente en el formulario antes de enviarlo al backend.

### 3. Adaptación Local (Dexie.db Offline-First)
*   **Migración de Base de Datos Local (`public/porteria/js/db.js`)**: Debido a que la placa (`placa`) ya no es obligatoria para todos los vehículos, se realizó un "upgrade" (de `db.version(1)` a `db.version(2)`) en Dexie.js para cambiar la clave primaria (`Primary Key`) de la tabla de vehículos a `_id` generado por Mongo. Esto garantiza que la caché de vehículos soporte múltiples registros del tipo "Otro" sin colisiones y mantiene 100% funcional el soporte Offline.

---

## FASE 2: Rediseño del Módulo de Portería y Flujo Facial

### 1. Reestructuración de la Interfaz del Celador
*   **Limpieza de la Vista Principal (`views/porteria/index.ejs`)**: Se eliminaron los 4 botones heredados ("Escaneo de placas", "Visitas", "Reconocimiento facial", "Domicilios") y se reemplazaron por las 3 grandes fases del nuevo diseño:
    1.  **Registro de Residente** (Enfocado en reconocimiento facial y acceso directo).
    2.  **Registro de Visita** (Dejado el esqueleto para la Fase 3).
    3.  **Registro de Domicilio** (Dejado el esqueleto para la Fase 3).

### 2. Integración del Acceso Facial y Vehículos
*   **Apertura Automática del Escáner**: El botón principal de "Registro de Residente" lanza directamente el escáner facial con la cámara en tiempo real (reutilizando y adaptando `face-api.js`).
*   **Flujo de Modalidad ("A Pie" vs "En Vehículo")**: Al detectar el rostro y verificar si el residente se encuentra en Ingreso o Salida, la interfaz despliega un modal interactivo donde el celador elige si el residente cruza "A pie" o "En vehículo".
*   **Drawer de Vehículos Vinculados (`public/porteria/js/facial.js`)**: Si el usuario selecciona "En Vehículo", el sistema desliza un panel mostrando la foto, marca, modelo y placa de **todos los vehículos que ese residente tiene asignados** en el sistema para que seleccione con cuál está ingresando.

### 3. Registro de Vehículos Temporales (La Opción "Otro")
*   **Registro en Caliente en Portería**: En el Drawer de selección de vehículos se agregó la opción permanente "Otro". Si el residente llega en un carro prestado o recién comprado que no está en la base de datos, el celador presiona "Otro".
*   **Formulario Inline**: Se despliega un mini-formulario donde el celador puede anotar rápidamente el `Tipo`, `Placa`, `Marca` y `Modelo`.
*   **Backend Habilitado (`src/controllers/facialAccessController.js`)**: El controlador recibe estos nuevos datos, valida si la placa ya existe (evitando duplicados) y si no, **crea el vehículo temporalmente a nombre de ese residente** al mismo tiempo que aprueba el Ingreso/Salida, guardando en los registros de auditoría (Log) el movimiento de ambos.

### 4. Soporte Offline y Registro Manual
*   **Botón de Registro Manual**: En caso de que la red se caiga o la cámara no funcione, se añadió un botón de escritura manual (ícono en la barra superior de la cámara). 
*   **Lógica de Formularios (`public/porteria/js/porteria.js`)**: Este botón despliega el formulario nativo del sistema adaptado dinámicamente (`isResidentManual: true`), pidiendo únicamente el Apartamento y Cédula del residente para completar su registro en la base de datos local Dexie (`Offline-First`) y sincronizarlo luego en background al recuperar la conexión.
