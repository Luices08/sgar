/* ─── SGAR Portería — Lógica principal ──────────────────────────────────────── */
'use strict';

let currentScreen = 'login';
let deliveryEmpresas = ['Rappi', 'iFood', 'DidiFood', 'Otro'];
let syncInterval = null;

/* ─── INICIALIZACIÓN ─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Registrar Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/porteria/sw.js').catch(console.warn);
  }

  // Aplicar color del tenant desde Dexie (antes de cualquier petición)
  const colorGuardado = await dbConfig.get('colorAcento');
  if (colorGuardado) document.documentElement.style.setProperty('--acento', colorGuardado);

  // Verificar si ya hay sesión
  const token = localStorage.getItem('sgar_token');
  const user  = localStorage.getItem('sgar_user');
  if (token && user) {
    await initApp();
  } else {
    window.location.href = '/admin/login';
    return;
  }

  // Monitorear conexión
  initConnectionMonitor();
});

/* ─── INICIALIZAR APP (post-login) ───────────────────────────────────────────── */
async function initApp() {
  const user   = JSON.parse(localStorage.getItem('sgar_user') || '{}');
  const tenant = await dbConfig.get('tenant');

  // Nombre del conjunto en header
  const nombre = tenant?.nombre || await dbConfig.get('conjuntoNombre') || 'Portería';
  document.getElementById('conjunto-nombre').textContent = nombre;
  document.getElementById('menu-name').textContent       = user.nombre || 'Celador';
  document.getElementById('menu-avatar').textContent     = (user.nombre || 'C').charAt(0).toUpperCase();
  document.getElementById('menu-conjunto').textContent   = nombre;

  // Empresas de domicilio
  const emps = await dbConfig.get('deliveryEmpresas');
  if (emps) deliveryEmpresas = emps;

  // Eventos de la pantalla principal (Acciones Online / Normal)
  document.getElementById('btn-registro-residente').addEventListener('click', () => facialModule.openFacialScreen());
  
  const btnVisita = document.getElementById('btn-registro-visita');
  if(btnVisita) btnVisita.addEventListener('click', () => { navigate('visitas'); loadPendientes(); });
  
  const btnDomicilio = document.getElementById('btn-registro-domicilio');
  if(btnDomicilio) btnDomicilio.addEventListener('click', () => openFormDomicilio());

  // Eventos de modo Offline/Manual
  const btnManualRes = document.getElementById('btn-manual-residente');
  if(btnManualRes) btnManualRes.addEventListener('click', () => openFormVisita({ isResidentManual: true }));

  const btnManualVis = document.getElementById('btn-manual-visita');
  if(btnManualVis) btnManualVis.addEventListener('click', () => openFormVisita());

  const btnManualDom = document.getElementById('btn-manual-domicilio');
  if(btnManualDom) btnManualDom.addEventListener('click', () => openFormDomicilio());

  // Historial y otros
  document.getElementById('btn-ver-historial').addEventListener('click', () => navigate('historial'));
  document.getElementById('btn-back-historial').addEventListener('click', () => navigate('main'));
  document.getElementById('btn-back-analiticas').addEventListener('click', () => navigate('main'));
  document.getElementById('btn-back-visitas')?.addEventListener('click', () => navigate('main'));
  
  // Eventos de la nueva pantalla de visitas
  document.getElementById('btn-manual-visita-online')?.addEventListener('click', () => openSearchResidentForVisit());
  document.getElementById('btn-verificar')?.addEventListener('click', verificarCodigoCentro);
  document.getElementById('search-invitations')?.addEventListener('input', filtrarTarjetas);
  document.getElementById('btn-refresh-invitations')?.addEventListener('click', loadPendientes);

  document.getElementById('btn-sync').addEventListener('click', doSync);
  document.getElementById('btn-logout').addEventListener('click', doLogout);

  // Menú lateral
  document.getElementById('btn-menu').addEventListener('click', toggleMenu);
  document.getElementById('menu-overlay').addEventListener('click', closeMenu);

  // Drawer
  document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);

  navigate('main');
  await refreshRecientes();
  await updateSyncBanner();

  // Inicializar módulo facial
  facialModule.init();

  // Sincronizar cada 30 segundos si hay conexión
  syncInterval = setInterval(async () => {
    if (navigator.onLine) {
      const r = await porteriaAPI.syncPendientes();
      if (r.synced > 0) await updateSyncBanner();
    }
  }, 30000);
}

/* ─── NAVEGACIÓN ─────────────────────────────────────────────────────────────── */
function navigate(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${screen}`).classList.add('active');
  currentScreen = screen;
  closeMenu();

  if (screen === 'historial') loadHistorial();
  if (screen === 'visitas') loadPendientes();
  if (screen === 'facial') {} // Manejado por facialModule
}

/* ─── MENÚ ───────────────────────────────────────────────────────────────────── */
function toggleMenu() {
  document.getElementById('side-menu').classList.toggle('open');
  document.getElementById('menu-overlay').classList.toggle('open');
}
function closeMenu() {
  document.getElementById('side-menu').classList.remove('open');
  document.getElementById('menu-overlay').classList.remove('open');
}

/* ─── DRAWER ─────────────────────────────────────────────────────────────────── */
function openDrawer(title, html) {
  document.getElementById('drawer-title').textContent = title;
  document.getElementById('drawer-body').innerHTML    = html;
  document.getElementById('bottom-drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  document.getElementById('bottom-drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* ─── FORMULARIO VISITA / RESIDENTE MANUAL ───────────────────────────────────── */
function openFormVisita(editData = null) {
  const isResident = editData && editData.isResidentManual;
  const isEdit = editData && !editData.isResidentManual && editData.id;

  const html = `
    <div id="f-error" class="form-error" style="display:none"></div>
    <div class="form-field">
      <label>${isResident ? 'Nombre del Residente' : 'Nombre del visitante'}</label>
      <input type="text" id="f-nombre" placeholder="Nombre completo" value="${editData?.nombre || ''}" autocomplete="off">
    </div>
    <div class="form-row">
      <div class="form-field">
        <label>Cédula ${isResident ? '*' : ''}</label>
        <input type="text" id="f-cedula" placeholder="1234567890" value="${editData?.cedula || ''}" inputmode="numeric">
      </div>
      <div class="form-field">
        <label>Apartamento *</label>
        <input type="text" id="f-apto" placeholder="101" value="${editData?.apartamento || ''}" autocomplete="off" required>
      </div>
    </div>
    ${!isResident ? `
    <div class="form-field">
      <label>Código de invitación</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="f-codigo" placeholder="000000" maxlength="6" inputmode="numeric" style="flex:1">
        <button type="button" class="btn-action-secondary" id="btn-validate-code" style="width:auto;padding:0 14px;margin:0;font-size:13px">Validar</button>
      </div>
    </div>
    <div id="inv-info" style="display:none" class="form-ocr-bar found"></div>
    ` : ''}
    <input type="hidden" id="f-inv-id">
    <input type="hidden" id="f-is-resident" value="${isResident ? 'true' : 'false'}">
    <button class="btn-action" id="btn-submit-visita">${isEdit ? 'Actualizar' : (isResident ? 'Registrar acceso manual' : 'Registrar visita')}</button>
  `;

  openDrawer(isResident ? 'Registro Manual de Residente' : 'Registrar Visita', html);

  document.getElementById('btn-submit-visita').addEventListener('click', () => submitVisita(isEdit ? editData.id : null));
  if (!isResident) {
    document.getElementById('btn-validate-code').addEventListener('click', validateCode);
  }
}

async function validateCode() {
  const codigo = document.getElementById('f-codigo').value.trim();
  if (!codigo) return;
  const res = await porteriaAPI.validarInvitacion(codigo);
  if (res?.success) {
    const inv = res.data;
    document.getElementById('f-nombre').value = inv.nombreVisitante;
    document.getElementById('f-apto').value   = inv.apartamento;
    document.getElementById('f-inv-id').value = inv.invitation_id;
    document.getElementById('inv-info').style.display = '';
    document.getElementById('inv-info').textContent   = `✓ Invitación válida — Apto ${inv.apartamento}`;
  } else {
    showToast('Código inválido o ya utilizado');
  }
}

async function submitVisita(editLocalId = null) {
  const nombre = document.getElementById('f-nombre').value.trim();
  const cedula = document.getElementById('f-cedula').value.trim();
  const apto   = document.getElementById('f-apto').value.trim();
  const invId  = document.getElementById('f-inv-id').value.trim();
  const user   = JSON.parse(localStorage.getItem('sgar_user') || '{}');
  const tenant = await dbConfig.get('tenant');

  const isResident = document.getElementById('f-is-resident').value === 'true';

  if (!apto) { document.getElementById('f-error').textContent = 'El apartamento es requerido'; document.getElementById('f-error').style.display = ''; return; }
  if (isResident && !cedula) { document.getElementById('f-error').textContent = 'La cédula es requerida para el registro manual'; document.getElementById('f-error').style.display = ''; return; }

  // Si tiene invitación, completarla en servidor
  if (invId && navigator.onLine && !isResident) {
    const res = await porteriaAPI.completarInvitacion(invId);
    if (res?.success) {
      closeDrawer();
      await refreshRecientes();
      showToast('Visita registrada con invitación ✓');
      return;
    }
  }

  const visitData = {
    tipo:         isResident ? 'residente' : 'visita',
    nombre,
    cedula,
    apartamento:  apto,
    celador_id:   user.user_id,
    celador_nombre: user.nombre,
    tenant_id:    tenant?._id || user.tenant_id,
    horaIngreso:  new Date().toISOString(),
    metodoIdentificacion: isResident ? 'manual' : (invId ? 'codigo_invitacion' : 'manual'),
    invitation_id: invId || null,
    movimiento:   'ingreso',
  };

  const res = await porteriaAPI.registrarVisita(visitData);
  if (res.success) {
    closeDrawer();
    await refreshRecientes();
    await updateSyncBanner();
    showToast(res.local ? 'Registro guardado offline ↯' : 'Registro exitoso ✓');
  } else {
    document.getElementById('f-error').textContent = res.message || 'Error al registrar';
    document.getElementById('f-error').style.display = '';
  }
}

/* ─── FORMULARIO DOMICILIO ───────────────────────────────────────────────────── */
function openFormDomicilio() {
  const empresaOptions = deliveryEmpresas.map(e =>
    `<option value="${e}">${e}</option>`
  ).join('');

  const html = `
    <div id="fd-error" class="form-error" style="display:none"></div>
    <div class="form-field">
      <label>Empresa *</label>
      <select id="fd-empresa"><option value="">Seleccionar…</option>${empresaOptions}</select>
    </div>
    <div class="form-field">
      <label>Apartamento *</label>
      <input type="text" id="fd-apto" placeholder="101" autocomplete="off" inputmode="text">
    </div>
    <div class="form-field">
      <label>Nombre del mensajero</label>
      <input type="text" id="fd-mensajero" placeholder="Opcional" autocomplete="off">
    </div>
    <button class="btn-action" id="btn-submit-domicilio">Registrar domicilio</button>
  `;

  openDrawer('Registrar Domicilio', html);
  document.getElementById('btn-submit-domicilio').addEventListener('click', submitDomicilio);
}

async function submitDomicilio() {
  const empresa   = document.getElementById('fd-empresa').value;
  const apto      = document.getElementById('fd-apto').value.trim();
  const mensajero = document.getElementById('fd-mensajero').value.trim();
  const user      = JSON.parse(localStorage.getItem('sgar_user') || '{}');
  const tenant    = await dbConfig.get('tenant');

  if (!empresa) { document.getElementById('fd-error').textContent = 'Selecciona la empresa'; document.getElementById('fd-error').style.display = ''; return; }
  if (!apto)    { document.getElementById('fd-error').textContent = 'El apartamento es requerido'; document.getElementById('fd-error').style.display = ''; return; }

  const visitData = {
    tipo:         'domicilio',
    empresa,
    nombre:       mensajero || empresa,
    apartamento:  apto,
    celador_id:   user.user_id,
    celador_nombre: user.nombre,
    tenant_id:    tenant?._id || user.tenant_id,
    horaIngreso:  new Date().toISOString(),
    metodoIdentificacion: 'manual',
    movimiento:   'ingreso',
  };

  const res = await porteriaAPI.registrarVisita(visitData);
  if (res.success) {
    closeDrawer();
    await refreshRecientes();
    await updateSyncBanner();
    showToast(res.local ? 'Domicilio guardado offline ↯' : 'Domicilio registrado ✓');
  }
}

/* ─── FORMULARIO PLACA ───────────────────────────────────────────────────────── */
function openFormPlaca() {
  const html = `
    <div id="fp-error" class="form-error" style="display:none"></div>
    <div class="form-field">
      <label>Número de placa *</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="fp-placa" placeholder="ABC123" maxlength="8" autocomplete="off"
          style="text-transform:uppercase;flex:1" inputmode="text">
        <button type="button" class="btn-action-secondary" id="btn-buscar-placa"
          style="width:auto;padding:0 14px;margin:0;font-size:13px">Buscar</button>
      </div>
    </div>
    <div id="fp-ocr-info" class="form-ocr-bar" style="display:none"></div>
    <div class="form-field">
      <label>Apartamento *</label>
      <input type="text" id="fp-apto" placeholder="101" autocomplete="off">
    </div>
    <button class="btn-action" id="btn-submit-placa">Registrar vehículo</button>
  `;

  openDrawer('Escanear / Registrar Placa', html);

  const placaEl = document.getElementById('fp-placa');
  placaEl.addEventListener('input', () => { placaEl.value = placaEl.value.toUpperCase(); });
  document.getElementById('btn-buscar-placa').addEventListener('click', buscarPlaca);
  document.getElementById('btn-submit-placa').addEventListener('click', submitPlaca);
}

async function buscarPlaca() {
  const placa = document.getElementById('fp-placa').value.trim().toUpperCase();
  if (!placa) return;

  const res   = await porteriaAPI.buscarPlaca(placa);
  const info  = document.getElementById('fp-ocr-info');

  if (res?.success && res.data?.vehicle) {
    const v = res.data.vehicle;
    document.getElementById('fp-apto').value = v.apartamento;
    info.style.display = '';
    info.className     = 'form-ocr-bar found';
    info.textContent   = `✓ Placa registrada — Apto ${v.apartamento}${v.descripcion ? ' — ' + v.descripcion : ''}`;
  } else {
    info.style.display = '';
    info.className     = 'form-ocr-bar';
    info.textContent   = 'Placa no encontrada en el registro. Ingresa el apartamento manualmente.';
  }
}

async function submitPlaca() {
  const placa = document.getElementById('fp-placa').value.trim().toUpperCase();
  const apto  = document.getElementById('fp-apto').value.trim();
  const user  = JSON.parse(localStorage.getItem('sgar_user') || '{}');
  const tenant= await dbConfig.get('tenant');

  if (!placa) { document.getElementById('fp-error').textContent = 'Ingresa la placa'; document.getElementById('fp-error').style.display = ''; return; }
  if (!apto)  { document.getElementById('fp-error').textContent = 'Ingresa el apartamento'; document.getElementById('fp-error').style.display = ''; return; }

  const visitData = {
    tipo:         'vehiculo',
    placa,
    apartamento:  apto,
    celador_id:   user.user_id,
    celador_nombre: user.nombre,
    tenant_id:    tenant?._id || user.tenant_id,
    horaIngreso:  new Date().toISOString(),
    metodoIdentificacion: 'manual',
    movimiento:   'ingreso',
  };

  const res = await porteriaAPI.registrarVisita(visitData);
  if (res.success) {
    closeDrawer();
    await refreshRecientes();
    await updateSyncBanner();
    showToast(res.local ? 'Vehículo guardado offline ↯' : 'Vehículo registrado ✓');
  }
}

/* ─── RECIENTES ──────────────────────────────────────────────────────────────── */
async function refreshRecientes() {
  const recientes = await dbVisitas.getRecientes(3);
  const listEl    = document.getElementById('recent-list');

  if (!recientes.length) {
    listEl.innerHTML = '<div class="empty-recent">Sin registros en este turno</div>';
    return;
  }

  listEl.innerHTML = recientes.map(v => `
    <div class="recent-item">
      <span class="ri-badge ${v.tipo}">${v.tipo}</span>
      <div class="ri-info">
        <div class="ri-name">${v.nombre || v.empresa || '—'} ${v.placa ? `(Vehículo: ${v.placa})` : ''}</div>
        <div class="ri-meta">Apto ${v.apartamento} · ${fmtHora(v.movimiento === 'salida' ? (v.horaSalida || v.horaIngreso) : v.horaIngreso)} · <b style="color:${v.movimiento === 'salida' ? '#e53e3e' : '#38a169'}">${(v.movimiento || 'ingreso').toUpperCase()}</b></div>
      </div>
      <div class="ri-actions">
        <button class="btn-edit" onclick="editarVisita(${v.id})" title="Editar">✎</button>
        ${v.syncStatus === 'pendiente'
          ? `<button class="btn-del" onclick="eliminarVisita(${v.id})" title="Eliminar">✕</button>`
          : ''}
      </div>
    </div>
  `).join('');
}

/* ─── CENTRO DE CONTROL DE VISITAS ───────────────────────────────────────────── */
let invitacionesActivas = [];

async function loadPendientes() {
  if (!navigator.onLine) {
    document.getElementById('cards-container').innerHTML = '<p style="color:#e53e3e; padding: 20px;">Sin conexión. No se pueden cargar las invitaciones en espera.</p>';
    return;
  }
  
  const res = await porteriaAPI.request('/api/visits/pendientes');
  if (res?.success) {
    invitacionesActivas = res.data.invitaciones || [];
    renderTarjetas('');
  }
}

function renderTarjetas(filtro = '') {
  const container = document.getElementById('cards-container');
  if (!container) return;
  container.innerHTML = '';
  
  const termo = filtro.toLowerCase();
  const filtradas = invitacionesActivas.filter(inv => 
    (inv.apartamento || '').toLowerCase().includes(termo) || 
    (inv.nombreVisitante || '').toLowerCase().includes(termo)
  );

  if (filtradas.length === 0) {
    container.innerHTML = '<div class="empty-recent" style="padding:24px 0;">No hay invitaciones en espera</div>';
    return;
  }

  filtradas.forEach(inv => {
    const card = document.createElement('div');
    card.className = 'history-item';
    card.style.cursor = 'pointer';
    card.style.borderLeftColor = 'var(--acento)';
    card.style.marginBottom = '8px';
    
    const fechaCaducidad = new Date(inv.tiempo_caducidad);
    const hh = fechaCaducidad.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const dd = fechaCaducidad.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' });
    const fmtCaduca = isNaN(fechaCaducidad.getTime()) ? 'N/A' : `${dd} ${hh}`;

    card.innerHTML = `
      <div class="hi-info">
        <div class="hi-name">${inv.nombreVisitante}</div>
        <div class="hi-apto">Apto ${inv.apartamento} &middot; ${inv.personasEsperadas || 1} persona(s) &middot; Vence ${fmtCaduca}</div>
      </div>
      <div style="background:var(--bg); border:1px solid var(--border); border-radius:var(--radius); padding:6px 12px; font-family:monospace; font-weight:700; font-size:16px; letter-spacing:4px; color:var(--text); flex-shrink:0;">${inv.codigo}</div>
    `;
    
    card.addEventListener('click', () => {
      const codigoInput = document.getElementById('codigo-input');
      if(codigoInput) {
        codigoInput.value = inv.codigo;
        codigoInput.focus();
        codigoInput.style.borderColor = 'var(--acento)';
      }
    });
    
    container.appendChild(card);
  });
}

function filtrarTarjetas(e) {
  renderTarjetas(e.target.value);
}

async function verificarCodigoCentro() {
  const code = document.getElementById('codigo-input').value.trim();
  if (code.length < 6) return alert('Por favor, ingrese un código válido de 6 dígitos.');
  
  if (!navigator.onLine) return alert('Se requiere conexión para verificar códigos.');

  try {
    const btn = document.getElementById('btn-verificar');
    btn.disabled = true;
    btn.textContent = 'Verificando...';

    // Llamar a verificar-codigo primero
    const res = await porteriaAPI.request('/api/visits/verificar-codigo', {
      method: 'POST',
      body: JSON.stringify({ codigo: code })
    });

    if (!res.success) {
      throw new Error(res.message);
    }

    const inv = res.data.invitation;
    const html = `
      <!-- Tarjeta resumen del visitante -->
      <div style="background:var(--bg); border-radius:var(--radius); padding:16px; margin-bottom:16px;">
        <div class="ri-badge visita" style="margin-bottom:10px; display:inline-block;">Invitación válida</div>
        <div style="font-size:16px; font-weight:700; color:var(--text); margin-bottom:4px;">${inv.nombreVisitante}</div>
        <div style="font-size:13px; color:var(--text-muted);">Apto <strong>${inv.apartamento}</strong></div>
        <div style="margin-top:12px; display:flex; gap:16px;">
          <div>
            <div style="font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.4px;">Personas</div>
            <div style="font-size:15px; font-weight:600;">${inv.personasEsperadas || 1}</div>
          </div>
          <div>
            <div style="font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.4px;">Cédula</div>
            <div style="font-size:15px; font-weight:600;">${inv.cedulaVisitante || '—'}</div>
          </div>
        </div>
      </div>
      <button id="btn-confirmar-ingreso-inv" class="btn-action">
        Confirmar Ingreso
      </button>
    `;
    
    openDrawer('Confirmar Invitación', html);
    
    document.getElementById('btn-confirmar-ingreso-inv').addEventListener('click', async () => {
      try {
        document.getElementById('btn-confirmar-ingreso-inv').disabled = true;
        document.getElementById('btn-confirmar-ingreso-inv').textContent = 'Registrando...';
        
        const regRes = await porteriaAPI.request('/api/visits/registrar-ingreso', {
          method: 'POST',
          body: JSON.stringify({ codigo: code })
        });
        
        if (!regRes.success) throw new Error(regRes.message);
        
        const visit = regRes.data?.visit;
        if (visit) {
           visit.syncStatus = 'sincronizado';
           visit.localId = visit._id;
           await db.visitas.put(visit);
        }

        closeDrawer();
        alert('Visita confirmada y registrada exitosamente.');
        
        // Remover de la lista activa localmente, recargar historial
        invitacionesActivas = invitacionesActivas.filter(i => i.codigo !== code);
        document.getElementById('codigo-input').value = '';
        renderTarjetas(document.getElementById('search-invitations')?.value || '');
        
        // Si queremos regresar y actualizar recientes
        navigate('main');
        refreshRecientes();
      } catch(err) {
        alert(err.message || 'Error al registrar.');
      } finally {
        document.getElementById('btn-confirmar-ingreso-inv').disabled = false;
        document.getElementById('btn-confirmar-ingreso-inv').textContent = 'Confirmar Ingreso';
      }
    });

  } catch (err) {
    alert(err.message || 'Error al procesar. Verifique código o caducidad.');
  } finally {
    const btn = document.getElementById('btn-verificar');
    btn.disabled = false;
    btn.textContent = 'Verificar e Ingresar';
  }
}

/* ─── VISITA NO ESPERADA (AUTORIZACIÓN) ──────────────────────────────────────── */
function openSearchResidentForVisit() {
  const html = `
    <div style="padding: 10px;">
      <p style="margin-bottom:10px; font-size:1rem;">Busca el residente al que se dirige la visita:</p>
      <input type="text" id="sr-input" class="search-input" placeholder="Nombre o Cédula" style="width:100%; margin-bottom:15px; font-size:1.1rem;">
      <div id="sr-results" style="max-height: 250px; overflow-y: auto;"></div>
    </div>
  `;
  openDrawer('Buscar Residente', html);

  // Actualizar datos de residentes en background
  if (navigator.onLine) {
    porteriaAPI.request('/api/residents?limit=1000').then(res => {
      if (res && res.success) dbResidentes.cargarDesdeServidor(res.data);
    }).catch(console.warn);
  }

  const srInput = document.getElementById('sr-input');
  srInput.addEventListener('input', async (e) => {
    const q = e.target.value.toLowerCase().trim();
    const resultsContainer = document.getElementById('sr-results');
    if (q.length < 2) {
      resultsContainer.innerHTML = '';
      return;
    }
    const allRes = await db.residentes.toArray();
    const matches = allRes.filter(r => 
      (r.nombre||'').toLowerCase().includes(q) || 
      (r.cedula||'').toLowerCase().includes(q)
    ).slice(0, 10);

    if (matches.length === 0) {
      resultsContainer.innerHTML = '<p style="color:#666;">No se encontraron residentes.</p>';
      return;
    }

    resultsContainer.innerHTML = matches.map(r => `
      <div style="padding: 12px; border: 1px solid #e5e7eb; margin-bottom: 8px; border-radius: 6px; cursor:pointer; background:#f9fafb;" onclick="selectResidentForAuth('${r._id}')">
        <strong style="color:#111827;">${r.nombre}</strong><br>
        <span style="color:#4b5563; font-size:0.9rem;">Cédula: ${r.cedula || 'N/A'} | Apto: ${r.apartamento}</span>
      </div>
    `).join('');
  });
}

window.selectResidentForAuth = async function(id) {
  const resident = await db.residentes.get(id);
  const html = `
    <div style="background:var(--bg); border-radius:var(--radius); padding:16px; margin-bottom:16px; display:flex; align-items:center; gap:14px;">
      <div style="width:48px; height:48px; border-radius:50%; background:var(--acento); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:20px; flex-shrink:0;">${resident.nombre.charAt(0).toUpperCase()}</div>
      <div>
        <div style="font-size:16px; font-weight:700; color:var(--text);">${resident.nombre}</div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Apto ${resident.apartamento}</div>
        ${resident.telefono ? `<div style="font-size:12px; color:var(--text-muted);">&#128222; ${resident.telefono}</div>` : '<div style="font-size:12px; color:var(--text-muted);">Sin teléfono registrado</div>'}
      </div>
    </div>

    <div class="form-field">
      <label>Nombre del visitante <span style="font-weight:400; text-transform:none;">(Opcional)</span></label>
      <input type="text" id="sr-visitor-name" placeholder="Ej: María García" autocomplete="off">
    </div>

    <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
      ${resident.telefono ? `
        <a href="tel:${resident.telefono}" class="btn-action" style="text-align:center; text-decoration:none; background:var(--success);">
          &#128222; Llamar al Residente
        </a>
      ` : ''}

      <button class="btn-action" onclick="enviarNotificacionAutorizacion('${resident.user_id}', '${resident.apartamento}')" style="background:var(--warning);">
        &#128276; Notificar desde la App
      </button>

      <button class="btn-action-secondary" onclick="openFormVisita({ apartamento: '${resident.apartamento}' })">
        Registrar visita manualmente
      </button>
    </div>

    <div id="sr-auth-status" style="margin-top:20px; text-align:center;"></div>
  `;
  openDrawer('Autorizar Visita — Apto ' + resident.apartamento, html);
}

window.enviarNotificacionAutorizacion = async function(userId, apto) {
  const visitorName = document.getElementById('sr-visitor-name').value.trim() || 'Alguien';
  try {
    const statusEl = document.getElementById('sr-auth-status');
    statusEl.textContent = 'Enviando notificación...';

    const res = await porteriaAPI.request('/api/notifications/request-auth', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, apartamento: apto, visitorName })
    });

    if (!res.success) throw new Error(res.message);
    
    statusEl.innerHTML = '<span style="color:#2563eb;">Notificación enviada. Esperando respuesta del residente...</span>';
    
    // Iniciar polling
    const notifId = res.data.notification_id;
    const pollInterval = setInterval(async () => {
      // Si el drawer se cierra, dejamos de consultar
      if (!document.getElementById('sr-auth-status')) {
        clearInterval(pollInterval);
        return;
      }
      
      const st = await porteriaAPI.request(`/api/notifications/${notifId}/status`);
      if (st.success) {
         if (st.data.status === 'aprobado') {
             statusEl.innerHTML = '<span style="color:#10b981; font-size:1.4rem;">¡VISITA APROBADA!</span>';
             statusEl.innerHTML += `<br><button onclick="openFormVisita({ apartamento: '${apto}', nombre: '${visitorName}', isResidentManual: false })" class="btn-primary" style="margin-top:15px; width:100%;">Proceder a Registrar</button>`;
             clearInterval(pollInterval);
         } else if (st.data.status === 'rechazado') {
             statusEl.innerHTML = '<span style="color:#ef4444; font-size:1.4rem;">VISITA RECHAZADA</span>';
             clearInterval(pollInterval);
         }
      }
    }, 3000);

  } catch(e) {
    alert(e.message || 'Error al enviar la notificación. ¿Hay conexión?');
    document.getElementById('sr-auth-status').textContent = '';
  }
}

/* ─── HISTORIAL ──────────────────────────────────────────────────────────────── */
async function loadHistorial() {
  const turno = await dbVisitas.getTurno();
  const listEl = document.getElementById('historial-list');

  if (!turno.length) {
    listEl.innerHTML = '<div class="empty-recent" style="padding:40px 16px">Sin registros aún</div>';
    return;
  }

  listEl.innerHTML = turno.map(v => `
    <div class="history-item">
      <span class="hi-time">${fmtHora(v.movimiento === 'salida' ? (v.horaSalida || v.horaIngreso) : v.horaIngreso)}</span>
      <div class="ri-badge ${v.tipo}" style="flex-shrink:0">${v.tipo}</div>
      <div class="hi-info">
        <div class="hi-name">${v.nombre || v.empresa || '—'} ${v.placa ? `(Vehículo: ${v.placa})` : ''}</div>
        <div class="hi-apto">Apto ${v.apartamento} · <b style="color:${v.movimiento === 'salida' ? '#e53e3e' : '#38a169'}">${(v.movimiento || 'ingreso').toUpperCase()}</b></div>
      </div>
      ${v.syncStatus === 'pendiente'
        ? '<span class="hi-pending">↯ Pendiente</span>'
        : ''}
    </div>
  `).join('');
}

/* ─── EDITAR / ELIMINAR ──────────────────────────────────────────────────────── */
async function editarVisita(id) {
  const visits = await dbVisitas.getTurno();
  const v = visits.find(x => x.id === id);
  if (!v) return;
  if (v.tipo === 'visita')    openFormVisita(v);
  if (v.tipo === 'domicilio') openFormDomicilio(); // simplificado
}

async function eliminarVisita(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  await dbVisitas.delete(id);
  await refreshRecientes();
  await updateSyncBanner();
}

/* ─── SYNC BANNER ────────────────────────────────────────────────────────────── */
async function updateSyncBanner() {
  const count   = await dbVisitas.countPendientes();
  const banner  = document.getElementById('sync-banner');
  const countEl = document.getElementById('sync-count');
  if (count > 0) {
    banner.style.display  = 'flex';
    countEl.textContent   = `${count} registro${count > 1 ? 's' : ''} pendiente${count > 1 ? 's' : ''} de sincronización`;
  } else {
    banner.style.display  = 'none';
  }
}

async function doSync() {
  const dot = document.getElementById('conn-dot');
  dot.className = 'conn-dot syncing';
  const res = await porteriaAPI.syncPendientes();
  await updateSyncBanner();
  dot.className = navigator.onLine ? 'conn-dot' : 'conn-dot offline';
  showToast(`${res.synced} registro${res.synced !== 1 ? 's' : ''} sincronizado${res.synced !== 1 ? 's' : ''}`);
}

/* ─── LOGOUT ─────────────────────────────────────────────────────────────────── */
async function doLogout() {
  if (await dbVisitas.countPendientes() > 0) {
    if (!confirm('Hay registros pendientes de sincronizar. ¿Cerrar sesión de todas formas?')) return;
  }
  clearInterval(syncInterval);
  await porteriaAPI.logout();
}

/* ─── CONNECTION MONITOR ─────────────────────────────────────────────────────── */
function initConnectionMonitor() {
  const dot   = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');

  function update() {
    if (navigator.onLine) {
      dot.className    = 'conn-dot';
      label.textContent = 'Online';
    } else {
      dot.className    = 'conn-dot offline';
      label.textContent = 'Offline';
    }
  }

  window.addEventListener('online',  async () => {
    update();
    const res = await porteriaAPI.syncPendientes();
    if (res.synced > 0) {
      await updateSyncBanner();
      showToast(`${res.synced} registros sincronizados al reconectar`);
    }
  });
  window.addEventListener('offline', update);
  update();
}

/* ─── UTILIDADES ─────────────────────────────────────────────────────────────── */
function fmtHora(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}