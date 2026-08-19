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
    modelsLoaded:     false,
    loadingModels:    false,
    cameraActive:     false,
    detecting:        false,
    autoDetectTimer:  null,
    currentResident:  null,
    currentVehicles:  [],
    selectedVehicle:  null,
    selectedMode:     null,
    actionType:       null,
    openVisitId:      null,
    openVehicleLogId: null,
    _lastDescriptor:  null,
  };

  /* ── Elementos DOM ──────────────────────────────────────────────────────── */
  const el = () => ({
    screenFacial:         document.getElementById('screen-facial'),
    video:                document.getElementById('facial-video'),
    canvas:               document.getElementById('facial-canvas'),
    loadingOverlay:       document.getElementById('facial-loading-overlay'),
    loadingText:          document.getElementById('facial-loading-text'),
    statusDot:            document.getElementById('facial-status-dot'),
    statusText:           document.getElementById('facial-status-text'),
    confidenceChip:       document.getElementById('facial-confidence-chip'),
    captureBtn:           document.getElementById('facial-capture-btn'),
    backBtn:              document.getElementById('facial-back-btn'),
    modalOverlay:         document.getElementById('facial-modal-overlay'),
    modalAvatar:          document.getElementById('modal-resident-avatar'),
    modalAvatarPh:        document.getElementById('modal-resident-avatar-ph'),
    modalName:            document.getElementById('modal-resident-name'),
    modalSub:             document.getElementById('modal-resident-sub'),
    modalBadge:           document.getElementById('modal-resident-badge'),
    modalBadgeText:       document.getElementById('modal-badge-text'),
    modalActionLabel:     document.getElementById('modal-action-label'),
    modeBtnPie:           document.getElementById('mode-btn-pie'),
    modeBtnVehiculo:      document.getElementById('mode-btn-vehiculo'),
    confirmBtn:           document.getElementById('modal-confirm-btn'),
    cancelBtn:            document.getElementById('modal-cancel-btn'),
    vehicleDrawerOverlay: document.getElementById('facial-vehicle-drawer-overlay'),
    vehicleDrawer:        document.getElementById('facial-vehicle-drawer'),
    vehicleList:          document.getElementById('facial-vehicle-list'),
    vehicleConfirmBtn:    document.getElementById('vehicle-drawer-confirm'),
    vehicleCloseBtn:      document.getElementById('vehicle-drawer-close'),
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
    toast.style.color       = isError ? '#f87171' : '#4ade80';
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
    const video  = document.getElementById('facial-video');
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
      STATE.selectedMode    = null;

      // Verificar si tiene ingreso abierto
      let actionType = 'ingreso';
      let openVisitId = null;
      let openVehicleLogId = null;

      if (res.data.openVisit) {
        actionType       = 'salida';
        openVisitId      = res.data.openVisit._id;
        openVehicleLogId = res.data.openVehicleLog?._id || null;
      } else {
        try {
          const visitCheck = await porteriaAPI.request(
            `/api/residents/${res.data.resident._id}/open-visit`
          );
          if (visitCheck?.success && visitCheck.data?.visit) {
            actionType       = 'salida';
            openVisitId      = visitCheck.data.visit._id;
            openVehicleLogId = visitCheck.data.vehicleLog?._id || null;
          }
        } catch (_) { /* sin ingreso abierto */ }
      }

      STATE.actionType       = actionType;
      STATE.openVisitId      = openVisitId;
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
      if (e.modalAvatar)   { e.modalAvatar.src = resident.fotoUrl; e.modalAvatar.style.display = ''; }
      if (e.modalAvatarPh) e.modalAvatarPh.style.display = 'none';
    } else {
      if (e.modalAvatar)   e.modalAvatar.style.display = 'none';
      if (e.modalAvatarPh) {
        e.modalAvatarPh.style.display = '';
        e.modalAvatarPh.textContent = (resident.nombre || 'R').charAt(0).toUpperCase();
      }
    }

    if (e.modalName) e.modalName.textContent = resident.nombre || '—';
    if (e.modalSub)  e.modalSub.textContent  = `Apto ${resident.apartamento}` + (resident.cedula ? ` · C.C. ${resident.cedula}` : '');

    if (confidence !== null && confidence !== undefined) {
      if (e.modalBadgeText) e.modalBadgeText.textContent = `${confidence}% coincidencia`;
      if (e.modalBadge)     e.modalBadge.style.display = '';
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

    // Deshabilitar botón vehículo si no tiene vehículos registrados
    if (e.modeBtnVehiculo) {
      const sinVehiculos = STATE.currentVehicles.length === 0;
      e.modeBtnVehiculo.style.opacity       = sinVehiculos ? '0.4' : '';
      e.modeBtnVehiculo.style.pointerEvents = sinVehiculos ? 'none' : '';
      e.modeBtnVehiculo.title               = sinVehiculos ? 'Sin vehículos registrados' : '';
    }

    selectMode(null);
    if (e.confirmBtn) e.confirmBtn.disabled = true;
    e.modalOverlay.classList.add('open');
  }

  /* ── Selección de modo ──────────────────────────────────────────────────── */
  function selectMode(mode) {
    STATE.selectedMode = mode;
    const e = el();
    if (e.modeBtnPie)      e.modeBtnPie.classList.toggle('selected', mode === 'pie');
    if (e.modeBtnVehiculo) e.modeBtnVehiculo.classList.toggle('selected', mode === 'vehiculo');
    
    const inlineVehicleSection = document.getElementById('inline-vehicle-section');
    if (inlineVehicleSection) {
      if (mode === 'vehiculo') {
        inlineVehicleSection.style.display = 'block';
        if (STATE.actionType === 'salida' && STATE.openVehicleLogId) {
           // We already know the vehicle from the entry
           inlineVehicleSection.style.display = 'none';
           if (e.confirmBtn) e.confirmBtn.disabled = false;
        } else {
           renderInlineVehicles();
           if (e.confirmBtn) e.confirmBtn.disabled = !STATE.selectedVehicle;
        }
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
    if (STATE.selectedMode === 'vehiculo' && !STATE.selectedVehicle && !(STATE.actionType === 'salida' && STATE.openVehicleLogId)) {
       showFacialToast('Debes seleccionar un vehículo', true);
       return;
    }
    await submitAction();
  }

  /* ── Mostrar vehículos inline ───────────────────────────────────────────── */
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

  function _selectVehicle(vehicleId) {
    const e = el();
    if (vehicleId === 'otro') {
      STATE.selectedVehicle = { _id: 'otro' }; // Placeholder
      document.getElementById('facial-vehicle-other-form').style.display = 'block';
      if (e.confirmBtn) e.confirmBtn.disabled = false;
    } else {
      STATE.selectedVehicle = STATE.currentVehicles.find(v => v._id === vehicleId) || null;
      document.getElementById('facial-vehicle-other-form').style.display = 'none';
      if (e.confirmBtn) e.confirmBtn.disabled = false;
    }

    document.querySelectorAll('.vehicle-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.id === vehicleId);
    });
  }

  function closeVehicleDrawer() {
    const e = el();
    if (e.vehicleDrawerOverlay) e.vehicleDrawerOverlay.classList.remove('open');
    if (e.vehicleDrawer)        e.vehicleDrawer.classList.remove('open');
  }

  /* ── Submit al servidor ─────────────────────────────────────────────────── */
  async function submitAction() {
    const e = el();
    if (e.confirmBtn) { e.confirmBtn.disabled = true; e.confirmBtn.textContent = 'Registrando…'; }

    try {
      let res;

      if (STATE.actionType === 'ingreso') {
        const body = {
          descriptor: STATE._lastDescriptor,
          localId:    `local_${Date.now()}`,
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
        const body = { horaSalida: new Date().toISOString(), metodoSalida: 'facial' };
        if (STATE.selectedMode === 'vehiculo' && STATE.openVehicleLogId) {
          body.vehicleLogId = STATE.openVehicleLogId;
        }
        res = await porteriaAPI.request(`/api/facial-access/${STATE.openVisitId}/salida`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      }

      if (res?.success) {
        // Tarea 3: Guardar el registro en Dexie para que aparezca en el historial
        if (res.data?.visit) {
          const vData = res.data.visit;
          const user = JSON.parse(localStorage.getItem('sgar_user') || '{}');
          // Guardarlo en DB local y marcarlo sincronizado
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
        showFacialToast(`${STATE.actionType === 'ingreso' ? 'Ingreso' : 'Salida'} registrado — ${modoLabel} ✓`);
        if (typeof refreshRecientes === 'function') await refreshRecientes();
        setTimeout(() => navigate('main'), 1800);
      } else {
        showFacialToast(res?.message || 'Error al registrar', true);
        if (e.confirmBtn) {
          e.confirmBtn.disabled    = false;
          e.confirmBtn.textContent = STATE.actionType === 'ingreso' ? 'Registrar Ingreso' : 'Registrar Salida';
        }
      }

    } catch (err) {
      console.error('[Facial] submitAction error:', err);
      showFacialToast('Error de conexión', true);
      if (e.confirmBtn) {
        e.confirmBtn.disabled    = false;
        e.confirmBtn.textContent = STATE.actionType === 'ingreso' ? 'Registrar Ingreso' : 'Registrar Salida';
      }
    }
  }

  function closeModal() {
    const overlay = document.getElementById('facial-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  /* ── Abrir pantalla facial ──────────────────────────────────────────────── */
  async function openFacialScreen() {
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

    if (e.modeBtnPie)      e.modeBtnPie.addEventListener('click',      () => selectMode('pie'));
    if (e.modeBtnVehiculo) e.modeBtnVehiculo.addEventListener('click', () => selectMode('vehiculo'));
    if (e.confirmBtn)      e.confirmBtn.addEventListener('click',      confirmAction);
    if (e.cancelBtn)       e.cancelBtn.addEventListener('click',       () => { closeModal(); startAutoDetect(); });

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
    if (e.vehicleCloseBtn)      e.vehicleCloseBtn.addEventListener('click', closeVehicleDrawer);
    if (e.vehicleDrawerOverlay) e.vehicleDrawerOverlay.addEventListener('click', closeVehicleDrawer);
  }

  return { init, openFacialScreen, closeFacialScreen, _selectVehicle };
})();