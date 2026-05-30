'use strict';
let currentPage = 1;
let searchTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  if (!SGAR.requireAuth()) return;
  SGAR.initDrawer('drawer-resident');
  document.getElementById('btn-nuevo').addEventListener('click', openNew);
  document.getElementById('form-resident').addEventListener('submit', submitResident);
  document.getElementById('btn-create-account').addEventListener('click', createAccount);

  const searchEl = document.getElementById('search-input');
  if (searchEl) searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentPage = 1; loadResidents(); }, 400);
  });

  loadResidents();
});

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

function openNew() {
  document.getElementById('r-edit-id').value = '';
  document.getElementById('drawer-title').textContent = 'Nuevo Residente';
  document.getElementById('form-resident').reset();
  document.getElementById('btn-create-account').style.display = 'none';
  SGAR.clearFormError('r-form-error');
  SGAR.openDrawer('drawer-resident');
}

function openEdit(r) {
  document.getElementById('r-edit-id').value = r._id;
  document.getElementById('drawer-title').textContent = 'Editar Residente';
  document.getElementById('r-nombre').value     = r.nombre     || '';
  document.getElementById('r-apartamento').value = r.apartamento || '';
  document.getElementById('r-cedula').value      = r.cedula     || '';
  document.getElementById('r-email').value       = r.email      || '';
  document.getElementById('r-telefono').value    = r.telefono   || '';
  document.getElementById('btn-create-account').style.display = r.user_id ? 'none' : 'block';
  SGAR.clearFormError('r-form-error');
  SGAR.openDrawer('drawer-resident');
}

async function submitResident(e) {
  e.preventDefault();
  const editId = document.getElementById('r-edit-id').value;
  const fd = new FormData();
  fd.append('nombre',      document.getElementById('r-nombre').value.trim());
  fd.append('apartamento', document.getElementById('r-apartamento').value.trim());
  fd.append('cedula',      document.getElementById('r-cedula').value.trim());
  fd.append('email',       document.getElementById('r-email').value.trim());
  fd.append('telefono',    document.getElementById('r-telefono').value.trim());
  const foto = document.getElementById('r-foto').files[0];
  if (foto) fd.append('foto', foto);

  SGAR.clearFormError('r-form-error');
  const res = editId
    ? await SGAR.apiForm(`/api/residents/${editId}`, fd, 'PUT')
    : await SGAR.apiForm('/api/residents', fd, 'POST');

  if (!res?.success) { SGAR.showFormError('r-form-error', res?.message || 'Error'); return; }
  SGAR.closeDrawer('drawer-resident');
  loadResidents();
}

async function createAccount() {
  const editId = document.getElementById('r-edit-id').value;
  if (!editId) return;
  const res = await SGAR.api(`/api/residents/${editId}/account`, { method: 'POST' });
  if (!res?.success) { alert(res?.message || 'Error al crear cuenta'); return; }
  alert(`Cuenta creada.\nEmail: ${res.data.email}\nContraseña inicial: ${res.data.password_inicial}`);
  SGAR.closeDrawer('drawer-resident');
}
