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
  }

  // Eventos de login
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('login-pwd').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  // Monitorear conexión
  initConnectionMonitor();
});

/* ─── LOGIN ──────────────────────────────────────────────────────────────────── */
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pwd   = document.getElementById('login-pwd').value;
  const btn   = document.getElementById('btn-login');
  const err   = document.getElementById('login-error');

  if (!email || !pwd) { showLoginError('Completa todos los campos'); return; }

  btn.disabled    = true;
  btn.textContent = 'Ingresando…';
  err.style.display = 'none';

  const res = await porteriaAPI.login(email, pwd);

  btn.disabled    = false;
  btn.textContent = 'Ingresar';

  if (!res?.success) {
    showLoginError(res?.message || 'Error al iniciar sesión');
    return;
  }

  if (res.data.user.rol !== 'celador') {
    // Redirigir al panel si no es celador
    window.location.href = '/admin/dashboard';
    return;
  }

  await initApp();
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent   = msg;
  el.style.display = 'block';
}

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

  // Eventos de la pantalla principal
  document.getElementById('btn-visita').addEventListener('click',   () => openFormVisita());
  document.getElementById('btn-domicilio').addEventListener('click', () => openFormDomicilio());
  document.getElementById('btn-placa').addEventListener('click',     () => openFormPlaca());
  document.getElementById('btn-ver-historial').addEventListener('click', () => navigate('historial'));
  document.getElementById('btn-back-historial').addEventListener('click', () => navigate('main'));
  document.getElementById('btn-back-analiticas').addEventListener('click', () => navigate('main'));
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

/* ─── FORMULARIO VISITA ──────────────────────────────────────────────────────── */
function openFormVisita(editData = null) {
  const html = `
    <div id="f-error" class="form-error" style="display:none"></div>
    <div class="form-field">
      <label>Nombre del visitante</label>
      <input type="text" id="f-nombre" placeholder="Nombre completo" value="${editData?.nombre || ''}" autocomplete="off">
    </div>
    <div class="form-row">
      <div class="form-field">
        <label>Cédula</label>
        <input type="text" id="f-cedula" placeholder="1234567890" value="${editData?.cedula || ''}" inputmode="numeric">
      </div>
      <div class="form-field">
        <label>Apartamento *</label>
        <input type="text" id="f-apto" placeholder="101" value="${editData?.apartamento || ''}" autocomplete="off" required>
      </div>
    </div>
    <div class="form-field">
      <label>Código de invitación</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="f-codigo" placeholder="000000" maxlength="6" inputmode="numeric" style="flex:1">
        <button type="button" class="btn-action-secondary" id="btn-validate-code" style="width:auto;padding:0 14px;margin:0;font-size:13px">Validar</button>
      </div>
    </div>
    <div id="inv-info" style="display:none" class="form-ocr-bar found"></div>
    <input type="hidden" id="f-inv-id">
    <button class="btn-action" id="btn-submit-visita">${editData ? 'Actualizar' : 'Registrar visita'}</button>
  `;

  openDrawer('Registrar Visita', html);

  document.getElementById('btn-submit-visita').addEventListener('click', () => submitVisita(editData?.id));
  document.getElementById('btn-validate-code').addEventListener('click', validateCode);
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

  if (!apto) { document.getElementById('f-error').textContent = 'El apartamento es requerido'; document.getElementById('f-error').style.display = ''; return; }

  // Si tiene invitación, completarla en servidor
  if (invId && navigator.onLine) {
    const res = await porteriaAPI.completarInvitacion(invId);
    if (res?.success) {
      closeDrawer();
      await refreshRecientes();
      showToast('Visita registrada con invitación ✓');
      return;
    }
  }

  const visitData = {
    tipo:         'visita',
    nombre,
    cedula,
    apartamento:  apto,
    celador_id:   user.user_id,
    celador_nombre: user.nombre,
    tenant_id:    tenant?._id || user.tenant_id,
    horaIngreso:  new Date().toISOString(),
    metodoIdentificacion: invId ? 'codigo_invitacion' : 'manual',
    invitation_id: invId || null,
  };

  const res = await porteriaAPI.registrarVisita(visitData);
  if (res.success) {
    closeDrawer();
    await refreshRecientes();
    await updateSyncBanner();
    showToast(res.local ? 'Visita guardada offline ↯' : 'Visita registrada ✓');
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
        <div class="ri-name">${v.nombre || v.empresa || v.placa || '—'}</div>
        <div class="ri-meta">Apto ${v.apartamento} · ${fmtHora(v.horaIngreso)}</div>
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
      <span class="hi-time">${fmtHora(v.horaIngreso)}</span>
      <div class="ri-badge ${v.tipo}" style="flex-shrink:0">${v.tipo}</div>
      <div class="hi-info">
        <div class="hi-name">${v.nombre || v.empresa || v.placa || '—'}</div>
        <div class="hi-apto">Apto ${v.apartamento}</div>
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
