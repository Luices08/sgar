'use strict';

/**
 * residentes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Panel de administración de residentes.
 *
 * Enrolamiento facial:
 *   - Usa face-api.js para extraer el descriptor facial (128 números Float32)
 *     directamente desde la cámara, sin guardar ninguna foto.
 *   - El descriptor se envía al backend vía POST /api/facial-enrollment/:id/descriptor
 *   - En portería, el mismo descriptor se compara con distancia euclidiana.
 *
 * face-api.js requiere los modelos en /models/:
 *   - tiny_face_detector_model-*
 *   - face_landmark_68_model-*
 *   - face_recognition_model-*
 */

let currentPage  = 1;
let searchTimer  = null;
let cameraStream = null;

// Descriptor facial real (Float32Array de 128 dims) capturado con face-api.js
let capturedDescriptor = null;

// Estado de carga de modelos face-api.js
let faceApiLoaded  = false;
let faceApiLoading = false;

// ─────────────────────────────────────────────────────────────────────────────
// INICIALIZACIÓN
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!SGAR.requireAuth()) return;
  SGAR.initDrawer('drawer-resident');
  document.getElementById('btn-nuevo').addEventListener('click', openNew);
  document.getElementById('form-resident').addEventListener('submit', submitResident);
  document.getElementById('btn-create-account').addEventListener('click', createAccount);
  document.getElementById('btn-camera-start').addEventListener('click', startCamera);
  document.getElementById('btn-camera-capture').addEventListener('click', captureFace);
  document.getElementById('btn-camera-retake').addEventListener('click', retakeFace);
  document.getElementById('drawer-close')?.addEventListener('click', stopCamera);
  document.getElementById('drawer-overlay')?.addEventListener('click', stopCamera);

  const searchEl = document.getElementById('search-input');
  if (searchEl) searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentPage = 1; loadResidents(); }, 400);
  });

  loadResidents();
});

// ─────────────────────────────────────────────────────────────────────────────
// CARGA DE MODELOS face-api.js
// Los modelos deben estar en /models/ del servidor público.
// ─────────────────────────────────────────────────────────────────────────────
async function loadFaceApiModels() {
  if (faceApiLoaded) return true;
  if (faceApiLoading) {
    // Esperar a que termine la carga en curso
    while (faceApiLoading) await new Promise(r => setTimeout(r, 100));
    return faceApiLoaded;
  }

  if (typeof faceapi === 'undefined') {
    console.warn('[face-api.js] Librería no cargada. Asegúrese de incluir face-api.min.js en el HTML.');
    return false;
  }

  faceApiLoading = true;
  try {
    const MODEL_URL = '/models';
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    faceApiLoaded = true;
    console.log('[face-api.js] Modelos cargados correctamente.');
  } catch (err) {
    console.error('[face-api.js] Error cargando modelos:', err);
    faceApiLoaded = false;
  } finally {
    faceApiLoading = false;
  }
  return faceApiLoaded;
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTA DE RESIDENTES
// ─────────────────────────────────────────────────────────────────────────────
async function loadResidents() {
  const q    = document.getElementById('search-input')?.value.trim() || '';
  const url  = `/api/residents?page=${currentPage}&limit=20${q ? '&q=' + encodeURIComponent(q) : ''}`;
  const data = await SGAR.api(url);
  if (!data || !data.success) return;

  const { data: residents, pagination } = data;
  document.getElementById('sub-count').textContent = `${pagination.total} residentes`;

  const tbody = document.getElementById('residents-tbody');
  if (!residents.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-loading">Sin resultados</td></tr>';
    return;
  }

  tbody.innerHTML = residents.map(r => `
    <tr>
      <td>${r.nombre}</td>
      <td><strong>${r.apartamento}</strong></td>
      <td>${r.cedula || '—'}</td>
      <td>${r.email || '—'}</td>
      <td>${r.telefono || '—'}</td>
      <td>${SGAR.activeBadge(r.activo)}</td>
      <td>
        <button class="btn-secondary btn-sm" onclick="openEdit(${JSON.stringify(r).replace(/"/g,'&quot;')})">Editar</button>
      </td>
    </tr>
  `).join('');

  SGAR.renderPagination('pagination', pagination, (p) => { currentPage = p; loadResidents(); });
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAWER: NUEVO / EDITAR
// ─────────────────────────────────────────────────────────────────────────────
function openNew() {
  document.getElementById('r-edit-id').value = '';
  document.getElementById('drawer-title').textContent = 'Nuevo Residente';
  document.getElementById('form-resident').reset();
  document.getElementById('btn-create-account').style.display = 'none';
  resetCameraCapture();
  SGAR.clearFormError('r-form-error');
  SGAR.openDrawer('drawer-resident');
}

function openEdit(r) {
  document.getElementById('r-edit-id').value = r._id;
  document.getElementById('drawer-title').textContent = 'Editar Residente';
  document.getElementById('r-nombre').value      = r.nombre      || '';
  document.getElementById('r-apartamento').value = r.apartamento || '';
  document.getElementById('r-cedula').value      = r.cedula      || '';
  document.getElementById('r-email').value       = r.email       || '';
  document.getElementById('r-telefono').value    = r.telefono    || '';
  document.getElementById('btn-create-account').style.display = r.user_id ? 'none' : 'block';
  resetCameraCapture();
  setExistingFacePreview(r.faceId);
  SGAR.clearFormError('r-form-error');
  SGAR.openDrawer('drawer-resident');
}

// ─────────────────────────────────────────────────────────────────────────────
// CÁMARA
// ─────────────────────────────────────────────────────────────────────────────
async function startCamera() {
  SGAR.clearFormError('r-form-error');
  if (!navigator.mediaDevices?.getUserMedia) {
    SGAR.showFormError('r-form-error', 'Este navegador no permite activar la cámara.');
    return;
  }

  // Cargar modelos face-api.js en segundo plano mientras se enciende la cámara
  loadFaceApiModels().catch(console.warn);

  try {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    const video = document.getElementById('r-camera-video');
    video.srcObject = cameraStream;
    video.style.display = 'block';
    document.getElementById('r-camera-preview').style.display = 'none';
    document.getElementById('btn-camera-capture').disabled = false;
    document.getElementById('btn-camera-start').textContent = 'Reiniciar cámara';
    document.getElementById('btn-camera-retake').style.display = 'none';
  } catch (err) {
    SGAR.showFormError('r-form-error', `No se pudo prender la cámara: ${err.message}`);
  }
}

/**
 * captureFace
 * Usa face-api.js para detectar el rostro en el video y extraer el descriptor
 * facial de 128 dimensiones (facial landmarks). NO guarda ninguna foto.
 */
async function captureFace() {
  const video = document.getElementById('r-camera-video');
  if (!video.videoWidth || !video.videoHeight) {
    SGAR.showFormError('r-form-error', 'Espere a que la cámara cargue antes de capturar.');
    return;
  }

  const captureBtn = document.getElementById('btn-camera-capture');
  captureBtn.disabled = true;
  captureBtn.textContent = 'Analizando rostro…';
  SGAR.clearFormError('r-form-error');

  try {
    // Asegurarse de que los modelos están cargados
    const modelsReady = await loadFaceApiModels();
    if (!modelsReady) {
      SGAR.showFormError('r-form-error',
        'Los modelos de reconocimiento facial no están disponibles. ' +
        'Verifique que los archivos en /models/ existen en el servidor.'
      );
      captureBtn.disabled = false;
      captureBtn.textContent = 'Capturar rostro';
      return;
    }

    // Detectar rostro + landmarks + descriptor en el frame actual del video
    const detection = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      SGAR.showFormError('r-form-error',
        'No se detectó ningún rostro. Asegúrese de estar frente a la cámara con buena iluminación.'
      );
      captureBtn.disabled = false;
      captureBtn.textContent = 'Capturar rostro';
      return;
    }

    // El descriptor es un Float32Array de 128 elementos
    capturedDescriptor = Array.from(detection.descriptor);

    // Mostrar preview con el recuadro del rostro detectado sobre canvas
    const canvas = document.getElementById('r-camera-canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // Dibujar cuadro y puntos de landmarks
    const resized = faceapi.resizeResults(detection, { width: video.videoWidth, height: video.videoHeight });
    faceapi.draw.drawDetections(canvas, resized);
    faceapi.draw.drawFaceLandmarks(canvas, resized);

    stopCamera();

    // Mostrar el canvas como preview (sin almacenar la imagen)
    const preview = document.getElementById('r-camera-preview');
    preview.style.display = 'flex';
    preview.style.backgroundImage = `url('${canvas.toDataURL('image/jpeg', 0.8)}')`;
    preview.classList.add('has-image');
    preview.classList.remove('is-enrolled');
    preview.innerHTML = '<span>✓ Landmarks detectados — listo para enrolar</span>';
    document.getElementById('btn-camera-start').textContent = 'Prender cámara';
    document.getElementById('btn-camera-retake').style.display = '';

  } catch (err) {
    SGAR.showFormError('r-form-error', `Error al analizar rostro: ${err.message}`);
    captureBtn.disabled = false;
  } finally {
    captureBtn.textContent = 'Capturar rostro';
  }
}

function retakeFace() {
  capturedDescriptor = null;
  startCamera();
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  const video = document.getElementById('r-camera-video');
  if (video) {
    video.pause();
    video.srcObject = null;
    video.style.display = 'none';
  }
  const captureBtn = document.getElementById('btn-camera-capture');
  if (captureBtn) captureBtn.disabled = true;
}

function resetCameraCapture() {
  stopCamera();
  capturedDescriptor = null;
  document.getElementById('btn-camera-start').textContent = 'Prender cámara';
  document.getElementById('btn-camera-retake').style.display = 'none';
  const preview = document.getElementById('r-camera-preview');
  preview.style.display = 'flex';
  preview.classList.remove('has-image', 'is-enrolled');
  preview.style.backgroundImage = '';
  preview.innerHTML = '<span>Sin captura facial</span>';
}

function setExistingFacePreview(faceId) {
  if (!faceId) return;
  const preview = document.getElementById('r-camera-preview');
  preview.style.display = 'flex';
  preview.classList.add('has-image', 'is-enrolled');
  preview.style.backgroundImage = '';
  preview.innerHTML = '<span>✓ Rostro ya enrolado (descriptor guardado)</span>';
  document.getElementById('btn-camera-retake').style.display = '';
}

// ─────────────────────────────────────────────────────────────────────────────
// ENROLAMIENTO — enviar descriptor al backend
// ─────────────────────────────────────────────────────────────────────────────
async function enrollDescriptor(residentId) {
  return SGAR.api(`/api/facial-enrollment/${residentId}/descriptor`, {
    method: 'POST',
    body: JSON.stringify({ descriptor: capturedDescriptor }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBMIT RESIDENTE
// ─────────────────────────────────────────────────────────────────────────────
async function submitResident(e) {
  e.preventDefault();
  const editId = document.getElementById('r-edit-id').value;

  // Para nuevo residente se requiere captura facial
  SGAR.clearFormError('r-form-error');
  if (!editId && !capturedDescriptor) {
    SGAR.showFormError('r-form-error', 'Capture el rostro del residente con la cámara antes de guardar.');
    return;
  }

  const fd = new FormData();
  fd.append('nombre',      document.getElementById('r-nombre').value.trim());
  fd.append('apartamento', document.getElementById('r-apartamento').value.trim());
  fd.append('cedula',      document.getElementById('r-cedula').value.trim());
  fd.append('email',       document.getElementById('r-email').value.trim());
  fd.append('telefono',    document.getElementById('r-telefono').value.trim());
  // NO se adjunta foto — solo el descriptor va al endpoint de enrolamiento

  const submitBtn = e.submitter || document.querySelector('#form-resident button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  const res = editId
    ? await SGAR.apiForm(`/api/residents/${editId}`, fd, 'PUT')
    : await SGAR.apiForm('/api/residents', fd, 'POST');

  if (!res?.success) {
    if (submitBtn) submitBtn.disabled = false;
    SGAR.showFormError('r-form-error', res?.message || 'Error al guardar residente');
    return;
  }

  const residentId = res.data?.resident?._id || editId;

  // Enviar descriptor facial si fue capturado
  if (capturedDescriptor && residentId) {
    const enrollRes = await enrollDescriptor(residentId);
    if (!enrollRes?.success) {
      if (submitBtn) submitBtn.disabled = false;
      SGAR.showFormError('r-form-error',
        `Residente guardado, pero no se pudo enrolar el rostro: ${enrollRes?.message || 'Error'}`
      );
      loadResidents();
      return;
    }
  }

  if (submitBtn) submitBtn.disabled = false;
  stopCamera();
  SGAR.closeDrawer('drawer-resident');
  loadResidents();
}

// ─────────────────────────────────────────────────────────────────────────────
// CREAR CUENTA DE USUARIO
// ─────────────────────────────────────────────────────────────────────────────
async function createAccount() {
  const editId = document.getElementById('r-edit-id').value;
  if (!editId) return;
  const res = await SGAR.api(`/api/residents/${editId}/account`, { method: 'POST' });
  if (!res?.success) { alert(res?.message || 'Error al crear cuenta'); return; }
  alert(`Cuenta creada.\nEmail: ${res.data.email}\nContraseña inicial: ${res.data.password_inicial}`);
  SGAR.closeDrawer('drawer-resident');
}
