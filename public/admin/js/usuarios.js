'use strict';
let currentPage = 1;
document.addEventListener('DOMContentLoaded', async () => {
  if (!SGAR.requireAuth()) return;
  SGAR.initDrawer('drawer-user');
  document.getElementById('btn-nuevo').addEventListener('click', openNew);
  document.getElementById('form-user').addEventListener('submit', submitUser);
  document.getElementById('filter-rol').addEventListener('change', () => { currentPage = 1; loadUsers(); });
  document.getElementById('u-rol').addEventListener('change', (e) => {
    const needsTenant = ['adminConjunto','celador'].includes(e.target.value);
    document.getElementById('field-tenant').style.display = needsTenant ? '' : 'none';
  });
  await loadTenantOptions();
  loadUsers();
});

async function loadTenantOptions() {
  const data = await SGAR.api('/api/tenants?limit=100');
  if (!data?.success) return;
  const sel = document.getElementById('u-tenant');
  data.data.forEach(t => {
    const opt = document.createElement('option');
    opt.value       = t._id;
    opt.textContent = t.nombre;
    sel.appendChild(opt);
  });
}

async function loadUsers() {
  const rol  = document.getElementById('filter-rol').value;
  const url  = `/api/users?page=${currentPage}&limit=20${rol ? '&rol=' + rol : ''}`;
  const data = await SGAR.api(url);
  if (!data?.success) return;

  const { data: users, pagination } = data;
  document.getElementById('sub-count').textContent = `${pagination.total} usuarios`;

  const tbody = document.getElementById('users-tbody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-loading">Sin usuarios</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${u.nombre}</td>
      <td>${u.cedula || '—'}</td>
      <td>${u.email}</td>
      <td><span class="badge" style="background:#f0f0f0;color:#555">${u.rol}</span></td>
      <td>${u.tenant_id?.nombre || (u.tenant_id ? 'Asignado' : '—')}</td>
      <td>${SGAR.activeBadge(u.activo)}</td>
      <td>
        <button class="btn-secondary btn-sm" onclick="toggleUser('${u._id}', ${u.activo})">
          ${u.activo ? 'Desactivar' : 'Activar'}
        </button>
      </td>
    </tr>
  `).join('');

  SGAR.renderPagination('pagination', pagination, (p) => { currentPage = p; loadUsers(); });
}

function openNew() {
  document.getElementById('form-user').reset();
  const cedEl = document.getElementById('u-cedula');
  if (cedEl) cedEl.value = '';
  document.getElementById('field-tenant').style.display = 'none';
  SGAR.clearFormError('u-form-error');
  SGAR.openDrawer('drawer-user');
}

async function submitUser(e) {
  e.preventDefault();
  const body = {
    nombre:    document.getElementById('u-nombre').value.trim(),
    cedula:    document.getElementById('u-cedula')?.value.trim() || undefined,
    email:     document.getElementById('u-email').value.trim(),
    password:  document.getElementById('u-pwd').value,
    rol:       document.getElementById('u-rol').value,
    tenant_id: document.getElementById('u-tenant').value || undefined,
  };
  SGAR.clearFormError('u-form-error');
  const res = await SGAR.api('/api/users', { method: 'POST', body: JSON.stringify(body) });
  if (!res?.success) { SGAR.showFormError('u-form-error', res?.message || 'Error'); return; }
  SGAR.closeDrawer('drawer-user');
  loadUsers();
}

async function toggleUser(id, activo) {
  if (!confirm(`¿${activo ? 'Desactivar' : 'Activar'} este usuario?`)) return;
  const res = await SGAR.api(`/api/users/${id}/toggle`, { method: 'PATCH' });
  if (!res?.success) { alert(res?.message); return; }
  loadUsers();
}
