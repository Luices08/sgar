/* ─── SGAR Portería — Módulo de Acceso Facial ────────────────────────────────
   Flujo:
     1. Celador abre la pantalla facial
     2. La cámara arranca SIEMPRE, independiente de los modelos
     3. face-api.js detecta el rostro y envía el descriptor al servidor
     4. El servidor identifica al residente
     5. Si tiene ingreso abierto → registrar SALIDA, si no → INGRESO
     6. El celador elige: "a pie" o "en vehículo"
     7. Si elige vehículo → drawer con vehículos vinculados al residente
   ──────────────────────────────────────────────────────────────────────────── */
'use strict';

const facialModule = (() => {

  const STATE = {
    modelsLoaded: false,
    loadingModels: false,
    cameraActive: false,
    detecting: false,
    autoDetectTimer: null,
    expectedMode: null, // 'ingreso' | 'salida' | null
    currentResident: null,
    currentVehicles: [],
    selectedVehicle: null,
    selectedMode: null,
    actionType: null,
    openVisitId: null,
    openVehicleLogId: null,
    _lastDescriptor: null,
  };

  /* ── Elementos DOM ──────────────────────────────────────────────────────── */
  const el = () => ({
    screenFacial: document.getElementById('screen-facial'),
    video: document.getElementById('facial-video'),
    canvas: document.getElementById('facial-canvas'),
    loadingOverlay: document.getElementById('facial-loading-overlay'),
    loadingText: document.getElementById('facial-loading-text'),
    statusDot: document.getElementById('facial-status-dot'),
    statusText: document.getElementById('facial-status-text'),
    confidenceChip: document.getElementById('facial-confidence-chip'),
    captureBtn: document.getElementById('facial-capture-btn'),
    backBtn: document.getElementById('facial-back-btn'),
    modalOverlay: document.getElementById('facial-modal-overlay'),
    modalAvatar: document.getElementById('modal-resident-avatar'),
    modalAvatarPh: document.getElementById('modal-resident-avatar-ph'),
    modalName: document.getElementById('modal-resident-name'),
    modalSub: document.getElementById('modal-resident-sub'),
    modalBadge: document.getElementById('modal-resident-badge'),
    modalBadgeText: document.getElementById('modal-badge-text'),
    modalActionLabel: document.getElementById('modal-action-label'),
    modeBtnPie: document.getElementById('mode-btn-pie'),
    modeBtnVehiculo: document.getElementById('mode-btn-vehiculo'),
    confirmBtn: document.getElementById('modal-confirm-btn'),
    cancelBtn: document.getElementById('modal-cancel-btn'),
    vehicleDrawerOverlay: document.getElementById('facial-vehicle-drawer-overlay'),
    vehicleDrawer: document.getElementById('facial-vehicle-drawer'),
    vehicleList: document.getElementById('facial-vehicle-list'),
    vehicleConfirmBtn: document.getElementById('vehicle-drawer-confirm'),
    vehicleCloseBtn: document.getElementById('vehicle-drawer-close'),
  });

  /* ── Helpers UI ─────────────────────────────────────────────────────────── */
  function setStatus(state, text) {
    const e = el();
    if (!e.statusDot) return;
    e.statusDot.className = `facial-status-dot ${state}`;
    if (e.statusText) e.statusText.textContent = text;
  }

  function showConfidence(val) {
    const chip = document.getElementById('facial-confidence-chip');
    if (!chip) return;
    if (val !== null && val !== undefined) {
      chip.textContent = `${val}% confianza`;
      chip.style.display = '';
    } else {
      chip.style.display = 'none';
    }
  }

  function showFacialToast(msg, isError = false) {
    const toast = document.getElementById('facial-toast');
    if (!toast) return;
    toast.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
        ${isError
        ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
        : '<polyline points="20 6 9 17 4 12"/>'}
      </svg> ${msg}`;
    toast.style.borderColor = isError ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.35)';
    toast.style.color = isError ? '#f87171' : '#4ade80';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
  }

  /* ── Cargar modelos face-api.js ─────────────────────────────────────────── */
  async function loadModels() {
    if (STATE.modelsLoaded) return true;
    if (STATE.loadingModels) return false;
    STATE.loadingModels = true;

    const loadingText = document.getElementById('facial-loading-text');
    if (loadingText) loadingText.textContent = 'Cargando modelos de reconocimiento…';

    try {
      // La ruta /models está mapeada en app.js a public/models
      const MODEL_URL = '/models';
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
      STATE.modelsLoaded = true;
      console.log('[Facial] Modelos cargados correctamente');
      return true;
    } catch (err) {
      console.error('[Facial] Error cargando modelos:', err);
      setStatus('error', 'Error cargando modelos — intente recargar');
      return false;
    } finally {
      STATE.loadingModels = false;
      // Ocultar overlay de carga siempre, con o sin error
      const overlay = document.getElementById('facial-loading-overlay');
      if (overlay) overlay.classList.add('hidden');
    }
  }

  /* ── Iniciar cámara ─────────────────────────────────────────────────────── */
  async function startCamera() {
    const video = document.getElementById('facial-video');
    if (!video) return false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      video.srcObject = stream;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
        setTimeout(resolve, 3000); // fallback timeout
      });
      await video.play();
      STATE.cameraActive = true;
      console.log('[Facial] Cámara iniciada');
      return true;
    } catch (err) {
      console.error('[Facial] Error cámara:', err);
      setStatus('error', 'No se pudo acceder a la cámara — verifique permisos');
      showFacialToast('Sin acceso a la cámara', true);
      return false;
    }
  }

  /* ── Detener cámara ─────────────────────────────────────────────────────── */
  function stopCamera() {
    const video = document.getElementById('facial-video');
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    STATE.cameraActive = false;
    clearInterval(STATE.autoDetectTimer);
    STATE.autoDetectTimer = null;
  }

  /* ── Detectar rostro y extraer descriptor ───────────────────────────────── */
  async function detectFace() {
    const video = document.getElementById('facial-video');
    const canvas = document.getElementById('facial-canvas');
    if (!video || STATE.detecting || !STATE.modelsLoaded) return null;
    STATE.detecting = true;

    try {
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
      const detection = await faceapi
        .detectSingleFace(video, options)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        setStatus('scanning', 'Buscando rostro… Ubíquese frente a la cámara');
        return null;
      }

      // Dibujar landmarks sobre canvas
      if (canvas) {
        const dims = faceapi.matchDimensions(canvas, video, true);
        const resized = faceapi.resizeResults(detection, dims);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        faceapi.draw.drawFaceLandmarks(canvas, resized);
      }

      setStatus('detected', 'Rostro detectado — verificando identidad…');
      return Array.from(detection.descriptor);

    } catch (err) {
      console.warn('[Facial] Error detección:', err);
      return null;
    } finally {
      STATE.detecting = false;
    }
  }

  /* ── Verificar identidad con el servidor ────────────────────────────────── */
  async function verifyIdentity(descriptor) {
    const captureBtn = document.getElementById('facial-capture-btn');
    if (captureBtn) { captureBtn.classList.add('loading'); captureBtn.disabled = true; }
    clearInterval(STATE.autoDetectTimer);

    try {
      const res = await porteriaAPI.request('/api/facial-access/verificar', {
        method: 'POST',
        body: JSON.stringify({ descriptor }),
      });

      if (!res?.success) {
        setStatus('error', res?.message || 'Rostro no identificado en este conjunto');
        showFacialToast('Residente no encontrado', true);
        setTimeout(() => { setStatus('scanning', 'Buscando rostro…'); startAutoDetect(); }, 2500);
        return;
      }

      STATE.currentResident = res.data.resident;
      STATE.currentVehicles = res.data.vehiculos || [];
      STATE._lastDescriptor = descriptor;
      STATE.selectedVehicle = null;
      STATE.selectedMode = null;

      // Verificar si tiene ingreso abierto
      let actionType = 'ingreso';
      let openVisitId = null;
      let openVehicleLogId = null;

      if (res.data.openVisit) {
        actionType = 'salida';
        openVisitId = res.data.openVisit._id;
        openVehicleLogId = res.data.openVehicleLog?._id || null;
      } else {
        try {
          const visitCheck = await porteriaAPI.request(
            `/api/residents/${res.data.resident._id}/open-visit`
          );
          if (visitCheck?.success && visitCheck.data?.visit) {
            actionType = 'salida';
            openVisitId = visitCheck.data.visit._id;
            openVehicleLogId = visitCheck.data.vehicleLog?._id || null;
          }
        } catch (_) { /* sin ingreso abierto */ }
      }

      STATE.actionType = actionType;
      STATE.openVisitId = openVisitId;
      STATE.openVehicleLogId = openVehicleLogId;

      showConfidence(res.data.facial?.confidence ?? null);
      showResidentModal(res.data.resident, res.data.facial?.confidence);

      // Tarea 4: Apagar la cámara justo después de detectar un rostro exitosamente
      stopCamera();
    } catch (err) {
      console.error('[Facial] verifyIdentity error:', err);
      setStatus('error', 'Error de conexión al verificar');
      showFacialToast('Error al verificar — revise conexión', true);
      setTimeout(() => { setStatus('scanning', 'Buscando rostro…'); startAutoDetect(); }, 2500);
    } finally {
      if (captureBtn) { captureBtn.classList.remove('loading'); captureBtn.disabled = false; }
    }
  }

  /* ── Detección automática cada 2.5s ─────────────────────────────────────── */
  function startAutoDetect() {
    clearInterval(STATE.autoDetectTimer);
    if (!STATE.modelsLoaded) return; // No intentar sin modelos
    STATE.autoDetectTimer = setInterval(async () => {
      const descriptor = await detectFace();
      if (descriptor) {
        await verifyIdentity(descriptor);
      }
    }, 2500);
  }

  /* ── Mostrar modal ingreso/salida ───────────────────────────────────────── */
  function showResidentModal(resident, confidence) {
    const e = el();
    if (!e.modalOverlay) return;

    // Avatar
    if (resident.fotoUrl) {
      if (e.modalAvatar) { e.modalAvatar.src = resident.fotoUrl; e.modalAvatar.style.display = ''; }
      if (e.modalAvatarPh) e.modalAvatarPh.style.display = 'none';
    } else {
      if (e.modalAvatar) e.modalAvatar.style.display = 'none';
      if (e.modalAvatarPh) {
        e.modalAvatarPh.style.display = '';
        e.modalAvatarPh.textContent = (resident.nombre || 'R').charAt(0).toUpperCase();
      }
    }

    if (e.modalName) e.modalName.textContent = resident.nombre || '—';
    if (e.modalSub) e.modalSub.textContent = `Apto ${resident.apartamento}` + (resident.cedula ? ` · C.C. ${resident.cedula}` : '');

    if (confidence !== null && confidence !== undefined) {
      if (e.modalBadgeText) e.modalBadgeText.textContent = `${confidence}% coincidencia`;
      if (e.modalBadge) e.modalBadge.style.display = '';
    } else {
      if (e.modalBadge) e.modalBadge.style.display = 'none';
    }

    if (STATE.actionType === 'salida') {
      if (e.modalActionLabel) e.modalActionLabel.textContent = '¿Cómo sale el residente?';
      if (e.confirmBtn) { e.confirmBtn.textContent = 'Registrar Salida'; e.confirmBtn.className = 'confirm-btn danger'; }
    } else {
      if (e.modalActionLabel) e.modalActionLabel.textContent = '¿Cómo ingresa el residente?';
      if (e.confirmBtn) { e.confirmBtn.textContent = 'Registrar Ingreso'; e.confirmBtn.className = 'confirm-btn'; }
    }

    // Alerta de discrepancia de estado si aplica
    const alertEl = document.getElementById('modal-discrepancy-alert');
    if (alertEl) {
      if (STATE.expectedMode === 'ingreso' && STATE.actionType === 'salida') {
        alertEl.innerHTML = `<strong>Aviso:</strong> El residente ya se encuentra <strong>DENTRO</strong> del conjunto. Se registrará su <strong>SALIDA</strong>.`;
        alertEl.style.display = 'block';
      } else if (STATE.expectedMode === 'salida' && STATE.actionType === 'ingreso') {
        alertEl.innerHTML = `<strong>Aviso:</strong> El residente figura como <strong>FUERA</strong> del conjunto. Se registrará su <strong>INGRESO</strong>.`;
        alertEl.style.display = 'block';
      } else {
        alertEl.style.display = 'none';
      }
    }

    selectMode(null);
    if (e.confirmBtn) e.confirmBtn.disabled = true;
    e.modalOverlay.classList.add('open');
  }

  /* ── Selección de modo ──────────────────────────────────────────────────── */
  function selectMode(mode) {
    STATE.selectedMode = mode;
    const e = el();
    if (e.modeBtnPie) e.modeBtnPie.classList.toggle('selected', mode === 'pie');
    if (e.modeBtnVehiculo) e.modeBtnVehiculo.classList.toggle('selected', mode === 'vehiculo');

    const inlineVehicleSection = document.getElementById('inline-vehicle-section');
    if (inlineVehicleSection) {
      if (mode === 'vehiculo') {
        inlineVehicleSection.style.display = 'block';
        renderInlineVehicles();
        if (e.confirmBtn) e.confirmBtn.disabled = !STATE.selectedVehicle;
      } else {
        inlineVehicleSection.style.display = 'none';
        STATE.selectedVehicle = null;
        if (e.confirmBtn) e.confirmBtn.disabled = (mode === null);
      }
    } else {
      if (e.confirmBtn) e.confirmBtn.disabled = (mode === null);
    }
  }

  /* ── Confirmar acción ───────────────────────────────────────────────────── */
  async function confirmAction() {
    if (!STATE.selectedMode || !STATE.currentResident) return;
    if (STATE.selectedMode === 'vehiculo' && !STATE.selectedVehicle) {
      showFacialToast('Debes seleccionar un vehículo o ingresar datos', true);
      return;
    }
    await submitAction();
  }

  /* ── Mostrar vehículos inline ───────────────────────────────────────────── */
  let facialVehPollInterval = null;
  let facialVehDebounce = null;

  function renderInlineVehicles() {
    const vList = document.getElementById('facial-vehicle-list');
    if (!vList) return;

    let html = STATE.currentVehicles.map(v => {
      const fotoHtml = v.foto ? `<img src="${v.foto}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;margin-right:10px;">` : '<div style="width:40px;height:40px;background:#333;border-radius:4px;margin-right:10px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#888;">Sin foto</div>';
      return `
      <div class="vehicle-item ${STATE.selectedVehicle && STATE.selectedVehicle._id === v._id ? 'selected' : ''}" data-id="${v._id}" onclick="facialModule._selectVehicle('${v._id}')">
        ${fotoHtml}
        <div style="flex:1; text-align:left;">
          <div class="vehicle-plate">${v.placa || 'Sin placa'}</div>
          <div class="vehicle-desc">
            <div class="vehicle-desc-name">${v.marca || ''} ${v.modelo || ''}</div>
            <div class="vehicle-desc-apto">Apto ${v.apartamento}</div>
          </div>
        </div>
        <div class="vehicle-check">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      </div>
      `
    }).join('');

    // Opción "Otro vehículo temporal"
    html += `
      <div class="vehicle-item ${STATE.selectedVehicle && STATE.selectedVehicle._id === 'otro' ? 'selected' : ''}" data-id="otro" onclick="facialModule._selectVehicle('otro')" style="border: 1.5px dashed rgba(255,255,255,0.22); background: rgba(255,255,255,0.02);">
        <div style="width:40px;height:40px;background:rgba(255,255,255,0.08);border-radius:8px;margin-right:10px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.85);font-size:20px;font-weight:300;">+</div>
        <div style="flex:1; text-align:left;">
          <div style="font-size:14px; font-weight:700; color:#ffffff;">Otro vehículo</div>
          <div style="font-size:12px; color:rgba(255,255,255,0.45); margin-top:2px;">Ingresar datos manualmente</div>
        </div>
        <div class="vehicle-check">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      </div>
    `;

    vList.innerHTML = html;
  }

  const verificarPlacaFacialLive = async (targetPlaca) => {
    if (facialVehPollInterval) {
      clearInterval(facialVehPollInterval);
      facialVehPollInterval = null;
    }
    const alertBox = document.getElementById('box-facial-veh-alert');
    const cleanPlaca = (targetPlaca || '').replace(/[\s-]/g, '').trim().toUpperCase();
    if (!cleanPlaca || cleanPlaca.length < 3) {
      if (alertBox) { alertBox.style.display = 'none'; alertBox.innerHTML = ''; }
      return;
    }

    try {
      const vRes = await porteriaAPI.request('/api/vehicle-access/buscar-placa', {
        method: 'POST',
        body: JSON.stringify({ placa: cleanPlaca }),
      });

      if (vRes?.success && vRes.data?.registered && vRes.data?.vehicle) {
        const vh = vRes.data.vehicle;
        const resp = vRes.data.responsablePrincipal;
        const autorizados = vRes.data.autorizados || [];
        const propietarios = vRes.data.propietarios || [];

        // Autocompletar datos del vehículo si está en formulario "otro"
        const otroTipo = document.getElementById('v-otro-tipo');
        const otroMarca = document.getElementById('v-otro-marca');
        const otroModelo = document.getElementById('v-otro-modelo');
        if (otroTipo && vh.tipo) otroTipo.value = vh.tipo;
        if (otroMarca && !otroMarca.value && vh.marca) otroMarca.value = vh.marca;
        if (otroModelo && !otroModelo.value && vh.modelo) otroModelo.value = vh.modelo;

        // Comprobar si el residente identificado está formalmente autorizado
        const isDriverAuthorized = (
          (resp && (String(resp._id) === String(STATE.currentResident?._id) || String(resp.cedula) === String(STATE.currentResident?.cedula))) ||
          autorizados.some(a => String(a._id) === String(STATE.currentResident?._id) || String(a.cedula) === String(STATE.currentResident?.cedula)) ||
          propietarios.some(p => String(p._id || p) === String(STATE.currentResident?._id) || String(p.cedula) === String(STATE.currentResident?.cedula))
        );

        if (!isDriverAuthorized) {
          const titularNombre = resp?.nombre || 'Residente titular';
          const titularApto = resp?.apartamento || vh.apartamento || 'S/N';
          const titularTel = resp?.telefono || '';
          const titularUserId = resp?.user_id || '';
          const accionTxt = STATE.actionType === 'salida' ? 'SALIDA' : 'INGRESO';

          if (alertBox) {
            alertBox.style.display = 'block';
            alertBox.innerHTML = `
              <div style="background:rgba(245, 158, 11, 0.15); border:1.5px solid #f59e0b; border-radius:8px; padding:12px; text-align:left;">
                <div style="display:flex; align-items:center; gap:8px; font-weight:800; color:#fbbf24; font-size:13px;">
                  <span style="font-size:16px;"></span>
                  <span>VEHÍCULO REGISTRADO — REQUIERE AUTORIZACIÓN DE ${accionTxt}</span>
                </div>
                <div style="font-size:12px; color:#fef3c7; margin-top:4px; line-height:1.4;">
                  Este vehículo (<strong>${escHtml(vh.placa || cleanPlaca)}</strong>) pertenece al Apto <strong>${escHtml(titularApto)}</strong> &middot; Titular: <strong>${escHtml(titularNombre)}</strong>.
                  <br><span style="color:#fca5a5; font-weight:700;">El residente ${escHtml(STATE.currentResident?.nombre || '')} no figura como conductor autorizado de esta placa.</span>
                </div>
                <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; align-items:center;">
                  ${titularTel ? `
                    <a href="tel:${titularTel}" class="btn-action-sm" style="background:#059669; color:#fff; text-decoration:none; display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border-radius:6px; font-size:12px; font-weight:700; box-shadow:0 1px 2px rgba(0,0,0,0.2);">
                      Llamar a ${escHtml(titularNombre)} (${escHtml(titularTel)})
                    </a>
                  ` : '<span style="font-size:11px; color:#9ca3af;">Sin teléfono registrado</span>'}
                  <button type="button" id="btn-request-facial-veh-perm" class="btn-action-sm" style="background:#d97706; color:#fff; border:none; border-radius:6px; padding:7px 12px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
                    Pedir autorización al residente titular
                  </button>
                </div>
                <div id="facial-live-poll-status" style="margin-top:10px; font-size:13px; font-weight:700; display:none;"></div>
              </div>
            `;

            document.getElementById('btn-request-facial-veh-perm')?.addEventListener('click', async () => {
              const statusTag = document.getElementById('facial-live-poll-status');
              if (statusTag) {
                statusTag.style.display = 'block';
                statusTag.innerHTML = `<span style="color:#fbbf24;">Enviando solicitud de autorización al residente...</span>`;
              }

              try {
                const authReq = await porteriaAPI.request('/api/notifications/request-auth', {
                  method: 'POST',
                  body: JSON.stringify({
                    user_id: titularUserId,
                    apartamento: titularApto,
                    visitorName: STATE.currentResident?.nombre,
                    cedula: STATE.currentResident?.cedula || '',
                    tipo: 'permiso_vehiculo',
                    placa: vh.placa || cleanPlaca,
                    vehicle_id: vh._id,
                    accion: STATE.actionType,
                  }),
                });

                if (!authReq?.success) throw new Error(authReq?.message || 'Error al enviar solicitud');

                const notifId = authReq.data.notification_id;
                const permId = authReq.data.permission_id;
                if (permId) {
                  const fPerm = document.getElementById('f-facial-veh-perm-id');
                  if (fPerm) fPerm.value = permId;
                }

                if (statusTag) {
                  statusTag.innerHTML = `
                    <div style="background:rgba(245, 158, 11, 0.2); border:1px solid #f59e0b; border-radius:6px; padding:8px 10px; color:#fde68a; display:flex; align-items:center; gap:8px;">
                      <span class="spinner-inline" style="display:inline-block; width:14px; height:14px; border:2px solid #d97706; border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite;"></span>
                      <span>Esperando respuesta de <strong>${escHtml(titularNombre)}</strong> en tiempo real...</span>
                    </div>`;
                }

                facialVehPollInterval = setInterval(async () => {
                  try {
                    const st = await porteriaAPI.request(`/api/notifications/${notifId}/status`);
                    if (st?.success && st.data) {
                      const curStatus = st.data.status;
                      if (curStatus === 'aprobado') {
                        clearInterval(facialVehPollInterval);
                        facialVehPollInterval = null;
                        if (statusTag) {
                          statusTag.innerHTML = `
                            <div style="background:rgba(34, 197, 94, 0.2); border:1.5px solid #22c55e; border-radius:6px; padding:10px; color:#4ade80; font-size:13px; font-weight:800; display:flex; align-items:center; gap:8px;">
                              <span style="font-size:18px;"></span>
                              <span>¡ACCESO AUTORIZADO POR EL TITULAR DEL VEHÍCULO!</span>
                            </div>`;
                        }
                      } else if (curStatus === 'rechazado') {
                        clearInterval(facialVehPollInterval);
                        facialVehPollInterval = null;
                        if (statusTag) {
                          statusTag.innerHTML = `
                            <div style="background:rgba(239, 68, 68, 0.2); border:1.5px solid #ef4444; border-radius:6px; padding:10px; color:#f87171; font-size:13px; font-weight:800; display:flex; align-items:center; gap:8px;">
                              <span style="font-size:18px;"></span>
                              <span>ACCESO RECHAZADO POR EL TITULAR DEL VEHÍCULO</span>
                            </div>`;
                        }
                      }
                    }
                  } catch (_) { }
                }, 2500);

              } catch (err) {
                if (statusTag) {
                  statusTag.innerHTML = `<span style="color:#f87171;">Error: ${escHtml(err.message)}</span>`;
                }
              }
            });
          }
        } else {
          if (alertBox) { alertBox.style.display = 'none'; alertBox.innerHTML = ''; }
        }
      } else {
        if (alertBox) { alertBox.style.display = 'none'; alertBox.innerHTML = ''; }
      }
    } catch (_) {
      if (alertBox) { alertBox.style.display = 'none'; alertBox.innerHTML = ''; }
    }
  };

  function _selectVehicle(vehicleId) {
    const e = el();
    if (vehicleId === 'otro') {
      STATE.selectedVehicle = { _id: 'otro' }; // Placeholder
      document.getElementById('facial-vehicle-other-form').style.display = 'block';
      if (e.confirmBtn) e.confirmBtn.disabled = false;
      const inpOtro = document.getElementById('v-otro-placa');
      if (inpOtro) {
        verificarPlacaFacialLive(inpOtro.value);
        if (!inpOtro.dataset.listenerAttached) {
          inpOtro.dataset.listenerAttached = 'true';
          inpOtro.addEventListener('input', (ev) => {
            clearTimeout(facialVehDebounce);
            facialVehDebounce = setTimeout(() => {
              verificarPlacaFacialLive(ev.target.value);
            }, 300);
          });
        }
      }
    } else {
      STATE.selectedVehicle = STATE.currentVehicles.find(v => v._id === vehicleId) || null;
      document.getElementById('facial-vehicle-other-form').style.display = 'none';
      if (e.confirmBtn) e.confirmBtn.disabled = false;
      if (STATE.selectedVehicle) {
        verificarPlacaFacialLive(STATE.selectedVehicle.placa);
      }
    }

    document.querySelectorAll('.vehicle-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.id === vehicleId);
    });
  }

  function closeVehicleDrawer() {
    const e = el();
    if (e.vehicleDrawerOverlay) e.vehicleDrawerOverlay.classList.remove('open');
    if (e.vehicleDrawer) e.vehicleDrawer.classList.remove('open');
  }

  /* ── Submit al servidor ─────────────────────────────────────────────────── */
  async function submitAction() {
    const e = el();
    if (e.confirmBtn) { e.confirmBtn.disabled = true; e.confirmBtn.textContent = 'Registrando…'; }

    try {
      let res;
      const permId = document.getElementById('f-facial-veh-perm-id')?.value || null;

      if (STATE.actionType === 'ingreso') {
        const body = {
          descriptor: STATE._lastDescriptor,
          localId: `local_${Date.now()}`,
          permission_id: permId,
        };
        if (STATE.selectedMode === 'vehiculo') {
          if (STATE.selectedVehicle && STATE.selectedVehicle._id === 'otro') {
            body.vehiculoNuevo = {
              tipo: document.getElementById('v-otro-tipo').value,
              placa: document.getElementById('v-otro-placa').value.trim().toUpperCase(),
              marca: document.getElementById('v-otro-marca').value.trim(),
              modelo: document.getElementById('v-otro-modelo').value.trim()
            };
          } else if (STATE.selectedVehicle) {
            body.vehicle_id = STATE.selectedVehicle._id;
          }
        }
        res = await porteriaAPI.request('/api/facial-access/ingreso', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      } else {
        const body = {
          horaSalida: new Date().toISOString(),
          metodoSalida: 'facial',
          modoSalida: STATE.selectedMode,
          permission_id: permId,
        };
        if (STATE.selectedMode === 'vehiculo') {
          if (STATE.selectedVehicle && STATE.selectedVehicle._id === 'otro') {
            body.vehiculoSalidaNuevo = {
              tipo: document.getElementById('v-otro-tipo').value,
              placa: document.getElementById('v-otro-placa').value.trim().toUpperCase(),
              marca: document.getElementById('v-otro-marca').value.trim(),
              modelo: document.getElementById('v-otro-modelo').value.trim()
            };
          } else if (STATE.selectedVehicle) {
            body.vehicle_id = STATE.selectedVehicle._id;
            body.placaSalida = STATE.selectedVehicle.placa;
            body.tipoVehiculoSalida = STATE.selectedVehicle.tipo;
          }
          if (STATE.openVehicleLogId) {
            body.vehicleLogId = STATE.openVehicleLogId;
          }
        }
        res = await porteriaAPI.request(`/api/facial-access/${STATE.openVisitId}/salida`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      }

      if (res?.success) {
        // Guardar el registro en Dexie para que aparezca en el historial
        if (res.data?.visit) {
          const vData = res.data.visit;
          const user = JSON.parse(localStorage.getItem('sgar_user') || '{}');
          const localId = vData.localId || dbVisitas.newLocalId();
          const saved = await dbVisitas.save({
            ...vData,
            tenant_id: vData.tenant_id || user.tenant_id,
            localId,
            placa: STATE.selectedVehicle && STATE.selectedVehicle._id === 'otro'
              ? document.getElementById('v-otro-placa').value.trim().toUpperCase()
              : (STATE.selectedVehicle?.placa || vData.placa || undefined),
            movimiento: STATE.actionType // 'ingreso' o 'salida'
          });
          await dbVisitas.markSynced(saved.id);
        }

        closeModal();
        closeVehicleDrawer();
        const modoLabel = STATE.selectedMode === 'vehiculo'
          ? `en vehículo ${STATE.selectedVehicle?.placa || 'temporal'}`
          : 'a pie';
        showFacialToast(`${STATE.actionType === 'ingreso' ? 'Ingreso' : 'Salida'} registrado — ${modoLabel}`);
        if (typeof refreshRecientes === 'function') await refreshRecientes();
        if (typeof refreshBadges === 'function') await refreshBadges();
        if (typeof loadSalidasResidentes === 'function') await loadSalidasResidentes();
        setTimeout(() => navigate('main'), 1800);
      } else {
        showFacialToast(res?.message || 'Error al registrar', true);
        if (e.confirmBtn) {
          e.confirmBtn.disabled = false;
          e.confirmBtn.textContent = STATE.actionType === 'ingreso' ? 'Registrar Ingreso' : 'Registrar Salida';
        }
      }

    } catch (err) {
      console.error('[Facial] submitAction error:', err);
      showFacialToast('Error de conexión', true);
      if (e.confirmBtn) {
        e.confirmBtn.disabled = false;
        e.confirmBtn.textContent = STATE.actionType === 'ingreso' ? 'Registrar Ingreso' : 'Registrar Salida';
      }
    }
  }

  function closeModal() {
    const overlay = document.getElementById('facial-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  /* ── Abrir pantalla facial ──────────────────────────────────────────────── */
  async function openFacialScreen(options = {}) {
    STATE.expectedMode = (options && options.expectedMode) || null;
    navigate('facial');

    // Mostrar overlay de carga
    const loadingOverlay = document.getElementById('facial-loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    setStatus('scanning', 'Iniciando cámara…');

    // 1. Arrancar cámara PRIMERO — no depende de los modelos
    const camOk = await startCamera();
    if (!camOk) {
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
      return;
    }

    // Ocultar overlay ya que la cámara está lista
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
    setStatus('scanning', 'Cargando modelos de IA…');

    // 2. Cargar modelos en paralelo (no bloquea la cámara)
    const modelsOk = await loadModels();

    if (modelsOk) {
      setStatus('scanning', 'Buscando rostro… Ubíquese frente a la cámara');
      startAutoDetect();
    } else {
      setStatus('error', 'Modelos no disponibles — verifique que /models esté accesible');
    }
  }

  /* ── Cerrar pantalla facial ─────────────────────────────────────────────── */
  function closeFacialScreen() {
    stopCamera();
    closeModal();
    closeVehicleDrawer();
    navigate('main');
  }

  /* ── Inicializar listeners ───────────────────────────────────────────────── */
  function init() {
    const e = el();
    if (!e.screenFacial) return;

    if (e.backBtn) e.backBtn.addEventListener('click', closeFacialScreen);

    if (e.captureBtn) {
      e.captureBtn.addEventListener('click', async () => {
        if (!STATE.modelsLoaded) {
          showFacialToast('Modelos aún no cargados, espere un momento', true);
          return;
        }
        clearInterval(STATE.autoDetectTimer);
        let retries = 0;
        while (STATE.detecting && retries < 20) {
          await new Promise(r => setTimeout(r, 50));
          retries++;
        }
        setStatus('scanning', 'Detectando rostro…');
        const descriptor = await detectFace();
        if (descriptor) {
          STATE._lastDescriptor = descriptor;
          await verifyIdentity(descriptor);
        } else {
          setStatus('error', 'No se detectó ningún rostro — acérquese más');
          setTimeout(() => { setStatus('scanning', 'Buscando rostro…'); startAutoDetect(); }, 2000);
        }
      });
    }

    const btnManual = document.getElementById('btn-registro-manual');
    if (btnManual) {
      btnManual.addEventListener('click', () => {
        closeFacialScreen();
        // Here we could open a drawer for manual resident registration, or just prompt.
        // As requested: "si no hay conexión el registro se hará de forma manual"
        openFormVisita({ isResidentManual: true });
        // We will adapt openFormVisita in porteria.js to handle manual resident entry if needed.
      });
    }

    if (e.modeBtnPie) e.modeBtnPie.addEventListener('click', () => selectMode('pie'));
    if (e.modeBtnVehiculo) e.modeBtnVehiculo.addEventListener('click', () => selectMode('vehiculo'));
    if (e.confirmBtn) e.confirmBtn.addEventListener('click', confirmAction);
    if (e.cancelBtn) e.cancelBtn.addEventListener('click', () => { closeModal(); startAutoDetect(); });

    if (e.modalOverlay) {
      e.modalOverlay.addEventListener('click', (ev) => {
        if (ev.target === e.modalOverlay) { closeModal(); startAutoDetect(); }
      });
    }

    if (e.vehicleConfirmBtn) {
      e.vehicleConfirmBtn.addEventListener('click', async () => {
        closeVehicleDrawer();
        await submitAction();
      });
    }
    if (e.vehicleCloseBtn) e.vehicleCloseBtn.addEventListener('click', closeVehicleDrawer);
    if (e.vehicleDrawerOverlay) e.vehicleDrawerOverlay.addEventListener('click', closeVehicleDrawer);
  }

  return { init, openFacialScreen, closeFacialScreen, _selectVehicle };
})();