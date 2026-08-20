'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const user = SGAR.requireAuth();
  if (!user) return;

  const tenant = SGAR.getTenant();

  const imp = localStorage.getItem('sgar_impersonate_tenant');

  if (user.rol === 'adminControl' && !imp) {
    document.getElementById('page-title').textContent    = 'Conjuntos Residenciales';
    document.getElementById('page-subtitle').textContent = 'Todos los conjuntos del sistema';
    document.getElementById('btn-nuevo').style.display   = 'inline-flex';
    document.getElementById('btn-nuevo-label').textContent = 'Nuevo conjunto';
    document.getElementById('view-admincontrol').style.display = 'block';
    SGAR.initDrawer('drawer-tenant');
    SGAR.initDrawer('drawer-admin');
    loadTenants();
    document.getElementById('btn-nuevo').addEventListener('click', () => openNewTenant());
    document.getElementById('form-tenant').addEventListener('submit', submitTenant);
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

  grid.innerHTML = tenants.map(t => {
    let estadoBadge = '<span class="badge" style="background:#dcfce7;color:#15803d;font-weight:700">Activo</span>';
    if (t.estado === 'suspendido') {
      estadoBadge = '<span class="badge" style="background:#fee2e2;color:#b91c1c;font-weight:700" title="' + (t.motivoSuspension ? SGAR.escHtml(t.motivoSuspension) : '') + '">Suspendido</span>';
    } else if (t.estado === 'inactivo' || !t.activo) {
      estadoBadge = '<span class="badge" style="background:#f1f5f9;color:#475569;font-weight:700">Inactivo</span>';
    }

    const nitStr = t.nit ? ` · NIT: ${t.nit}` : '';
    const adminStr = t.adminPrincipal ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Admin: <strong>${t.adminPrincipal.nombre}</strong> (${t.adminPrincipal.email})</div>` : '';

    return `
    <div class="tenant-card">
      <div class="tenant-card-img" style="background-image:url('${t.imagenUrl || ''}'); background-color:#e0e0e0;"></div>
      <div class="tenant-card-body">
        <div class="tenant-card-name">${t.nombre}</div>
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">
          ${t.ciudad || 'Bogotá'}${nitStr} · <code>${t.tenant_id}</code>
        </div>
        ${adminStr}
        <div class="tenant-card-stats" style="margin-top:8px;">
          <div class="tenant-stat-item">
            <span class="tenant-stat-num">${t.stats?.residentes ?? '—'}</span>
            <span>Residentes</span>
          </div>
          <div class="tenant-stat-item">
            <span class="tenant-stat-num">${t.stats?.celadores ?? '—'}</span>
            <span>Celadores</span>
          </div>
          <div class="tenant-stat-item">
            <span class="tenant-stat-num">${t.stats?.visitas ?? '—'}</span>
            <span>Visitas</span>
          </div>
          <div class="tenant-stat-item" style="margin-left:auto; align-items:flex-end;">
            ${estadoBadge}
            <span style="margin-top:5px;font-size:11px;color:var(--text-muted);">Estado</span>
          </div>
        </div>
      </div>
      <div class="tenant-card-actions">
        <button class="btn-primary btn-sm" onclick="enterTenant(${JSON.stringify(t).replace(/"/g,'&quot;')})">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Ingresar
        </button>
        <button class="btn-secondary btn-sm" onclick="editTenant('${t._id}', ${JSON.stringify(t).replace(/"/g,'&quot;')})">Editar</button>
        <button class="btn-secondary btn-sm" style="color:#dc2626; border-color:#dc2626;" onclick="deleteTenant('${t._id}', '${t.nombre}')">Archivar</button>
      </div>
      <div class="tenant-card-accent-bar" style="background:${t.colorAcento}"></div>
    </div>
  `}).join('');
}

function openNewTenant() {
  document.getElementById('tenant-edit-id').value = '';
  document.getElementById('drawer-title').textContent = 'Nuevo Conjunto Residencial';
  document.getElementById('form-tenant').reset();
  SGAR.clearFormError('form-error');
  document.getElementById('f-tenant-id').disabled = false;
  document.getElementById('admin-fields').style.display = 'block';
  document.getElementById('admin-crud-section').style.display = 'none';
  document.getElementById('field-estado').style.display = 'none';
  document.getElementById('field-motivo-suspension').style.display = 'none';
  SGAR.openDrawer('drawer-tenant');
}

function editTenant(id, t) {
  document.getElementById('tenant-edit-id').value  = id;
  document.getElementById('drawer-title').textContent = 'Editar Conjunto Residencial';
  document.getElementById('f-tenant-id').value     = t.tenant_id || '';
  document.getElementById('f-tenant-id').disabled = true; // slug no modificable en edición directa
  document.getElementById('f-nombre').value         = t.nombre    || '';
  document.getElementById('f-nit').value            = t.nit       || '';
  document.getElementById('f-ciudad').value         = t.ciudad    || 'Bogotá';
  document.getElementById('f-direccion').value      = t.direccion || '';
  document.getElementById('f-telefono').value       = t.telefono  || '';
  document.getElementById('f-email-contacto').value = t.emailContacto || '';
  document.getElementById('f-descripcion').value    = t.descripcion || '';
  
  const estadoSelect = document.getElementById('f-estado');
  estadoSelect.value = t.estado || (t.activo ? 'activo' : 'inactivo');
  document.getElementById('f-motivo-suspension').value = t.motivoSuspension || '';
  document.getElementById('field-motivo-suspension').style.display = (estadoSelect.value === 'suspendido') ? 'block' : 'none';

  estadoSelect.onchange = () => {
    document.getElementById('field-motivo-suspension').style.display = (estadoSelect.value === 'suspendido') ? 'block' : 'none';
  };

  document.getElementById('admin-fields').style.display = 'none';
  document.getElementById('admin-crud-section').style.display = 'block';
  document.getElementById('field-estado').style.display = 'block';
  SGAR.clearFormError('form-error');
  loadAdmins(id);
  SGAR.openDrawer('drawer-tenant');
}

async function submitTenant(e) {
  e.preventDefault();
  const editId  = document.getElementById('tenant-edit-id').value;
  const isEdit  = !!editId;
  const formData = new FormData();

  formData.append('nombre',        document.getElementById('f-nombre').value.trim());
  formData.append('nit',           document.getElementById('f-nit').value.trim());
  formData.append('ciudad',        document.getElementById('f-ciudad').value.trim());
  formData.append('direccion',     document.getElementById('f-direccion').value.trim());
  formData.append('telefono',      document.getElementById('f-telefono').value.trim());
  formData.append('emailContacto', document.getElementById('f-email-contacto').value.trim());
  formData.append('descripcion',   document.getElementById('f-descripcion').value.trim());
  formData.append('colorAcento',   '#2563eb');

  if (!isEdit) {
    formData.append('tenant_id',     document.getElementById('f-tenant-id').value.trim());
    formData.append('adminEmail',    document.getElementById('f-admin-email').value.trim());
    formData.append('adminNombre',   document.getElementById('f-admin-nombre').value.trim());
    formData.append('adminPassword', document.getElementById('f-admin-pwd').value.trim());
  } else {
    const estado = document.getElementById('f-estado').value;
    formData.append('estado', estado);
    if (estado === 'suspendido') {
      formData.append('motivoSuspension', document.getElementById('f-motivo-suspension').value.trim());
    }
  }

  const file = document.getElementById('f-imagen').files[0];
  if (file) formData.append('imagen_conjunto', file);

  SGAR.clearFormError('form-error');
  const res = isEdit
    ? await SGAR.apiForm(`/api/tenants/${editId}`, formData, 'PUT')
    : await SGAR.apiForm('/api/tenants', formData, 'POST');

  if (!res || !res.success) {
    SGAR.showFormError('form-error', res?.message || 'Error al guardar el conjunto');
    return;
  }
  SGAR.closeDrawer('drawer-tenant');
  loadTenants();
}

async function deleteTenant(id, nombre) {
  const pwd = prompt(`ARCHIVAR CONJUNTO\n\nEstás a punto de desactivar y archivar el conjunto "${nombre}".\nLos usuarios de este conjunto ya no podrán ingresar, pero los registros históricos (visitas, accesos, bitácoras) se preservarán.\n\nPara confirmar, ingresa tu contraseña de SuperAdmin:`);
  if (!pwd) return;

  const res = await SGAR.api(`/api/tenants/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ password: pwd })
  });

  if (res && res.success) {
    alert('Conjunto archivado exitosamente. La información histórica ha sido preservada.');
    loadTenants();
  } else {
    alert(res?.message || 'Error al archivar conjunto');
  }
}

// ── ADMIN CRUD ─────────────────────────────────────────────────────────────
async function loadAdmins(tenantId) {
  const res = await SGAR.api(`/api/users?rol=adminConjunto&limit=10&tenant_id=${tenantId}`);
  if (!res || !res.success) return;
  const tbody = document.getElementById('admins-tbody');
  const admins = res.data;
  if (admins.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-loading">No hay administradores registrados.</td></tr>';
  } else {
    tbody.innerHTML = admins.map(a => `
      <tr>
        <td>${a.nombre}</td>
        <td>${a.email}</td>
        <td>${SGAR.activeBadge(a.activo)}</td>
        <td>
          <button type="button" class="btn-secondary btn-sm" onclick="editAdmin('${a._id}', ${JSON.stringify(a).replace(/"/g,'&quot;')})">Editar</button>
          <button type="button" class="btn-secondary btn-sm" onclick="toggleAdmin('${a._id}', ${a.activo})">${a.activo ? 'Desactivar' : 'Activar'}</button>
          <button type="button" class="btn-secondary btn-sm" style="color:#d32f2f; border-color:#d32f2f" onclick="deleteAdmin('${a._id}')">Eliminar</button>
        </td>
      </tr>
    `).join('');
  }
}

window.toggleAdmin = async function(id, activo) {
  if (!confirm(`¿${activo ? 'Desactivar' : 'Activar'} administrador?`)) return;
  await SGAR.api(`/api/users/${id}/toggle`, { method: 'PATCH' });
  loadAdmins(document.getElementById('tenant-edit-id').value);
}

window.deleteAdmin = async function(id) {
  if (!confirm('¿Eliminar administrador? Esta acción no se puede deshacer.')) return;
  await SGAR.api(`/api/users/${id}`, { method: 'DELETE' });
  loadAdmins(document.getElementById('tenant-edit-id').value);
}

window.editAdmin = function(id, a) {
  document.getElementById('admin-edit-id').value = id;
  document.getElementById('a-nombre').value = a.nombre;
  document.getElementById('a-email').value = a.email;
  document.getElementById('a-pwd').value = '';
  document.getElementById('a-pwd').required = false;
  document.getElementById('admin-drawer-title').textContent = 'Editar Administrador';
  SGAR.clearFormError('a-form-error');
  SGAR.openDrawer('drawer-admin');
  document.getElementById('drawer-admin-overlay').style.display = 'block';
}

document.getElementById('btn-add-admin')?.addEventListener('click', () => {
  document.getElementById('admin-edit-id').value = '';
  document.getElementById('form-admin').reset();
  document.getElementById('a-pwd').required = true;
  document.getElementById('admin-drawer-title').textContent = 'Nuevo Administrador';
  SGAR.clearFormError('a-form-error');
  SGAR.openDrawer('drawer-admin');
  document.getElementById('drawer-admin-overlay').style.display = 'block';
});

document.getElementById('admin-drawer-close')?.addEventListener('click', () => {
  SGAR.closeDrawer('drawer-admin');
  document.getElementById('drawer-admin-overlay').style.display = 'none';
});

document.getElementById('form-admin')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('admin-edit-id').value;
  const tenantId = document.getElementById('tenant-edit-id').value;
  
  const body = {
    nombre: document.getElementById('a-nombre').value.trim(),
    email: document.getElementById('a-email').value.trim(),
    rol: 'adminConjunto',
    tenant_id: tenantId
  };
  
  const pwd = document.getElementById('a-pwd').value;
  if (pwd) body.password = pwd;

  SGAR.clearFormError('a-form-error');

  if (id) {
    const res = await SGAR.api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    if (!res || !res.success) { SGAR.showFormError('a-form-error', res?.message || 'Error al actualizar'); return; }
    if (pwd) await SGAR.api(`/api/users/${id}/password`, { method: 'PATCH', body: JSON.stringify({ newPassword: pwd }) });
  } else {
    const res = await SGAR.api('/api/users', { method: 'POST', body: JSON.stringify(body) });
    if (!res || !res.success) { SGAR.showFormError('a-form-error', res?.message || 'Error al crear'); return; }
  }

  SGAR.closeDrawer('drawer-admin');
  document.getElementById('drawer-admin-overlay').style.display = 'none';
  loadAdmins(tenantId);
});

function enterTenant(t) {
  // Guardamos el tenant que vamos a impersonar
  localStorage.setItem('sgar_impersonate_tenant', JSON.stringify(t));
  window.location.reload();
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
      <div class="ti-icon ${v.tipo}"></div>
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
