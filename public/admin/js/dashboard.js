'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const user = SGAR.requireAuth();
  if (!user) return;

  const tenant = SGAR.getTenant();

  if (user.rol === 'adminControl') {
    document.getElementById('page-title').textContent    = 'Conjuntos Residenciales';
    document.getElementById('page-subtitle').textContent = 'Todos los conjuntos del sistema';
    document.getElementById('btn-nuevo').style.display   = 'inline-flex';
    document.getElementById('btn-nuevo-label').textContent = 'Nuevo conjunto';
    document.getElementById('view-admincontrol').style.display = 'block';
    SGAR.initDrawer('drawer-tenant');
    loadTenants();
    document.getElementById('btn-nuevo').addEventListener('click', () => openNewTenant());
    document.getElementById('form-tenant').addEventListener('submit', submitTenant);
    syncColorPicker();
  } else {
    const nombre = tenant ? tenant.nombre : 'Mi Conjunto';
    document.getElementById('page-title').textContent    = nombre;
    document.getElementById('page-subtitle').textContent = 'Estado del día';
    document.getElementById('view-adminconjunto').style.display = 'block';
    document.getElementById('timeline-date').textContent =
      new Date().toLocaleDateString('es-CO', { weekday:'long', day:'numeric', month:'long' });
    loadDashboardConjunto();
    setInterval(loadDashboardConjunto, 60000);
  }
});

/* ── ADMIN CONTROL: TENANTS ─────────────────────────────────────────────────── */
async function loadTenants() {
  const data = await SGAR.api('/api/tenants?limit=50');
  if (!data || !data.success) return;

  const grid = document.getElementById('tenants-grid');
  const tenants = data.data;
  if (!tenants.length) {
    grid.innerHTML = '<div class="empty-state">No hay conjuntos registrados. Crea el primero.</div>';
    return;
  }

  grid.innerHTML = tenants.map(t => `
    <div class="tenant-card">
      <div class="tenant-card-img" style="background-image:url('${t.imagenUrl || ''}'); background-color:#e0e0e0;"></div>
      <div class="tenant-card-body">
        <div class="tenant-card-name">${t.nombre}</div>
        <div class="tenant-card-stats">
          <div class="tenant-stat-item">
            <span class="tenant-stat-num">${t.stats?.residentes ?? '—'}</span>
            <span>Residentes</span>
          </div>
          <div class="tenant-stat-item">
            <span class="tenant-stat-num">${t.stats?.celadores ?? '—'}</span>
            <span>Celadores</span>
          </div>
          <div class="tenant-stat-item">
            <span class="tenant-stat-num">${t.activo ? 'Activo' : 'Inactivo'}</span>
            <span>Estado</span>
          </div>
        </div>
      </div>
      <div class="tenant-card-actions">
        <button class="btn-secondary btn-sm" onclick="editTenant('${t._id}', ${JSON.stringify(t).replace(/"/g,'&quot;')})">Editar</button>
      </div>
      <div class="tenant-card-accent-bar" style="background:${t.colorAcento}"></div>
    </div>
  `).join('');
}

function openNewTenant() {
  document.getElementById('tenant-edit-id').value = '';
  document.getElementById('drawer-title').textContent = 'Nuevo Conjunto';
  document.getElementById('form-tenant').reset();
  SGAR.clearFormError('form-error');
  document.getElementById('f-admin-email').closest('.form-field').style.display = '';
  SGAR.openDrawer('drawer-tenant');
}

function editTenant(id, t) {
  document.getElementById('tenant-edit-id').value  = id;
  document.getElementById('drawer-title').textContent = 'Editar Conjunto';
  document.getElementById('f-tenant-id').value     = t.tenant_id || '';
  document.getElementById('f-nombre').value         = t.nombre    || '';
  document.getElementById('f-descripcion').value    = t.descripcion || '';
  document.getElementById('f-color').value          = t.colorAcento || '#1a1a2e';
  document.getElementById('f-color-text').value     = t.colorAcento || '#1a1a2e';
  document.getElementById('f-admin-email').closest('.form-field').style.display = 'none';
  SGAR.clearFormError('form-error');
  SGAR.openDrawer('drawer-tenant');
}

async function submitTenant(e) {
  e.preventDefault();
  const editId  = document.getElementById('tenant-edit-id').value;
  const isEdit  = !!editId;
  const formData = new FormData();

  if (!isEdit) {
    formData.append('tenant_id',     document.getElementById('f-tenant-id').value.trim());
    formData.append('adminEmail',    document.getElementById('f-admin-email').value.trim());
    formData.append('adminNombre',   document.getElementById('f-admin-nombre').value.trim());
    formData.append('adminPassword', document.getElementById('f-admin-pwd').value.trim());
  }
  formData.append('nombre',      document.getElementById('f-nombre').value.trim());
  formData.append('descripcion', document.getElementById('f-descripcion').value.trim());
  formData.append('colorAcento', document.getElementById('f-color-text').value.trim());

  const file = document.getElementById('f-imagen').files[0];
  if (file) formData.append('imagen_conjunto', file);

  SGAR.clearFormError('form-error');
  const res = isEdit
    ? await SGAR.apiForm(`/api/tenants/${editId}`, formData, 'PUT')
    : await SGAR.apiForm('/api/tenants', formData, 'POST');

  if (!res || !res.success) {
    SGAR.showFormError('form-error', res?.message || 'Error al guardar');
    return;
  }
  SGAR.closeDrawer('drawer-tenant');
  loadTenants();
}

function syncColorPicker() {
  const picker = document.getElementById('f-color');
  const text   = document.getElementById('f-color-text');
  if (!picker || !text) return;
  picker.addEventListener('input', () => { text.value = picker.value; });
  text.addEventListener('input',  () => {
    if (/^#[0-9A-Fa-f]{6}$/.test(text.value)) picker.value = text.value;
  });
}

/* ── ADMIN CONJUNTO: BITÁCORA ───────────────────────────────────────────────── */
async function loadDashboardConjunto() {
  const today = SGAR.todayISO();
  const [visitsRes] = await Promise.all([
    SGAR.api(`/api/visits?fecha=${today}&limit=50`),
  ]);

  if (!visitsRes || !visitsRes.success) return;

  const visits = visitsRes.data;
  const now    = new Date();
  const sinceHour = new Date(now.getTime() - 60 * 60 * 1000);
  const hourCount = visits.filter(v => new Date(v.horaIngreso) >= sinceHour).length;

  document.getElementById('stat-hora').textContent      = hourCount;
  document.getElementById('stat-hoy').textContent       = visitsRes.pagination?.total ?? visits.length;

  renderTimeline(visits);
}

function renderTimeline(visits) {
  const list = document.getElementById('timeline-list');
  if (!visits.length) {
    list.innerHTML = '<div class="empty-state">No hay registros de acceso hoy.</div>';
    return;
  }

  list.innerHTML = visits.map(v => `
    <div class="timeline-item">
      <span class="ti-time">${SGAR.fmtTime(v.horaIngreso)}</span>
      <span class="ti-badge ${v.tipo}">${v.tipo}</span>
      <div class="ti-info">
        <div class="ti-name">${v.nombre || v.empresa || v.placa || '—'}</div>
        <div class="ti-apto">Apto ${v.apartamento}</div>
      </div>
      <div class="ti-actions">
        <button class="btn-secondary btn-sm" onclick="window.location.href='/admin/registros'">Ver</button>
      </div>
    </div>
  `).join('');
}
