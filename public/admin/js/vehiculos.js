'use strict';

let currentPage = 1;
let searchTimer = null;
let allTenantResidents = [];
let selectedAuthIds = new Set();
let authSearchQuery = '';

document.addEventListener('DOMContentLoaded', () => {
  if (!SGAR.requireAuth()) return;
  SGAR.initDrawer('drawer-vehicle');

  document.getElementById('btn-nuevo').addEventListener('click', openNew);
  document.getElementById('form-vehicle').addEventListener('submit', submitVehicle);
  
  const searchEl = document.getElementById('search-input');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { currentPage = 1; loadVehicles(); }, 400);
    });
  }

  document.getElementById('filter-tipo')?.addEventListener('change', () => {
    currentPage = 1;
    loadVehicles();
  });

  // Handle Tipo change
  document.getElementById('v-tipo').addEventListener('change', handleTipoChange);

  // Handle Apartamento change to refresh options
  document.getElementById('v-apartamento').addEventListener('input', () => {
    populatePrincipalSelect();
    renderAutorizadosCheckboxes();
  });

  // Handle live search in autorizados
  document.getElementById('v-auth-search')?.addEventListener('input', (e) => {
    authSearchQuery = e.target.value.toLowerCase().trim();
    renderAutorizadosCheckboxes();
  });

  // Handle Responsable Principal change
  document.getElementById('v-responsable-principal')?.addEventListener('change', () => {
    const principalId = document.getElementById('v-responsable-principal').value;
    if (principalId) {
      selectedAuthIds.delete(String(principalId));
    }
    renderAutorizadosCheckboxes();
  });

  // Handle Photo upload
  document.getElementById('v-foto-upload').addEventListener('change', handlePhotoUpload);

  loadVehicles();
  loadAllResidents();

  // Handle URL parameters for auto-assigning vehicle to a resident
  const urlParams = new URLSearchParams(window.location.search);
  const aptoParam = urlParams.get('apto');
  const residenteParam = urlParams.get('residente');
  if (aptoParam && residenteParam) {
    openNew();
    document.getElementById('v-apartamento').value = aptoParam;
    loadAllResidents().then(() => {
      populatePrincipalSelect(residenteParam);
      renderAutorizadosCheckboxes();
    });
    window.history.replaceState({}, document.title, window.location.pathname);
  }
});

async function loadAllResidents() {
  try {
    const res = await SGAR.api('/api/residents?limit=500&activo=true');
    if (res && res.success && Array.isArray(res.data)) {
      allTenantResidents = res.data;
    }
  } catch (err) {
    console.error('Error cargando residentes:', err);
  }
}

function handleTipoChange() {
  const tipo = document.getElementById('v-tipo').value;
  const labelReq = document.getElementById('label-placa-req');
  const inputPlaca = document.getElementById('v-placa');
  const helpPlaca = document.getElementById('placa-help');

  if (tipo === 'Carro' || tipo === 'Motocicleta') {
    labelReq.style.display = 'inline';
    inputPlaca.required = true;
    helpPlaca.textContent = tipo === 'Carro' ? 'Ej: AAA 000 para Carro' : 'Ej: AAA 00A para Moto';
  } else {
    labelReq.style.display = 'none';
    inputPlaca.required = false;
    helpPlaca.textContent = 'Opcional para Otro';
  }
}

function populatePrincipalSelect(selectedPrincipalId = null) {
  const selectPrincipal = document.getElementById('v-responsable-principal');
  if (!selectPrincipal) return;

  const currentVal = selectedPrincipalId !== null ? selectedPrincipalId : selectPrincipal.value;
  const apto = document.getElementById('v-apartamento').value.trim().toUpperCase();

  if (!allTenantResidents || allTenantResidents.length === 0) {
    selectPrincipal.innerHTML = '<option value="">(Sin asignar)</option>';
    return;
  }

  const aptoResidents = apto ? allTenantResidents.filter(r => (r.apartamento || '').toUpperCase() === apto) : [];
  const otherResidents = apto ? allTenantResidents.filter(r => (r.apartamento || '').toUpperCase() !== apto) : allTenantResidents;

  let html = '<option value="">(Sin asignar)</option>';

  if (apto && aptoResidents.length > 0) {
    html += `<optgroup label="Residentes Apto ${apto}">` + aptoResidents.map(r =>
      `<option value="${r._id}">${r.nombre} (C.C. ${r.cedula || '—'})</option>`
    ).join('') + '</optgroup>';

    if (otherResidents.length > 0) {
      html += `<optgroup label="Otros Residentes del Conjunto">` + otherResidents.map(r =>
        `<option value="${r._id}">${r.nombre} (Apto ${r.apartamento || '—'} - C.C. ${r.cedula || '—'})</option>`
      ).join('') + '</optgroup>';
    }
  } else {
    html += allTenantResidents.map(r =>
      `<option value="${r._id}">${r.nombre} (Apto ${r.apartamento || '—'} - C.C. ${r.cedula || '—'})</option>`
    ).join('');
  }

  selectPrincipal.innerHTML = html;
  if (currentVal) {
    selectPrincipal.value = currentVal;
  }
}

function renderAutorizadosCheckboxes() {
  const containerAuth = document.getElementById('v-autorizados-container');
  const principalId = document.getElementById('v-responsable-principal')?.value || '';

  if (!containerAuth) return;

  if (!allTenantResidents || allTenantResidents.length === 0) {
    containerAuth.innerHTML = '<span style="color:#94a3b8; font-size:12px;">No hay residentes registrados en el conjunto</span>';
    return;
  }

  const filtered = allTenantResidents.filter(r => {
    if (!authSearchQuery) return true;
    const nameMatch = (r.nombre || '').toLowerCase().includes(authSearchQuery);
    const aptoMatch = (r.apartamento || '').toLowerCase().includes(authSearchQuery);
    const cedMatch  = (r.cedula || '').toLowerCase().includes(authSearchQuery);
    return nameMatch || aptoMatch || cedMatch;
  });

  if (filtered.length === 0) {
    containerAuth.innerHTML = '<span style="color:#94a3b8; font-size:12px;">No se encontraron residentes con el filtro</span>';
    return;
  }

  containerAuth.innerHTML = filtered.map(r => {
    const isPrincipal = String(r._id) === String(principalId);
    const isChecked = !isPrincipal && selectedAuthIds.has(String(r._id));
    const disabled = isPrincipal ? 'disabled' : '';

    return `
      <label style="display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:13px; padding:4px 6px; border-radius:4px; cursor:${isPrincipal ? 'not-allowed' : 'pointer'}; opacity:${isPrincipal ? '0.5' : '1'}; background:${isChecked ? 'var(--acento-bg, #eff6ff)' : 'transparent'};">
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" class="chk-autorizado" value="${r._id}" ${isChecked ? 'checked' : ''} ${disabled} onchange="toggleAutorizado('${r._id}', this.checked)">
          <span><strong>${r.nombre}</strong> <small style="color:#64748b;">(Apto ${r.apartamento || '—'})</small></span>
        </div>
        ${isPrincipal ? '<small style="color:var(--acento); font-weight:700;">Responsable Principal</small>' : `<small style="color:#94a3b8;">C.C. ${r.cedula || '—'}</small>`}
      </label>
    `;
  }).join('');
}

window.toggleAutorizado = function(residentId, isChecked) {
  if (isChecked) {
    selectedAuthIds.add(String(residentId));
  } else {
    selectedAuthIds.delete(String(residentId));
  }
  renderAutorizadosCheckboxes();
};

async function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById('v-foto-name').textContent = file.name;

  const reader = new FileReader();
  reader.onload = function(event) {
    const base64 = event.target.result;
    document.getElementById('v-foto-base64').value = base64;
    
    const previewContainer = document.getElementById('v-foto-preview-container');
    const previewImage = document.getElementById('v-foto-preview');
    previewContainer.style.display = 'flex';
    previewImage.src = base64;
  };
  reader.readAsDataURL(file);
}

async function loadVehicles() {
  const q = document.getElementById('search-input')?.value.trim() || '';
  const tipo = document.getElementById('filter-tipo')?.value || '';
  let url = `/api/vehicles?page=${currentPage}&limit=20`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  if (tipo) url += `&tipo=${tipo}`;

  const data = await SGAR.api(url);
  if (!data || !data.success) return;

  const { data: vehicles, pagination } = data;
  document.getElementById('sub-count').textContent = `${pagination.total} vehículos`;

  const tbody = document.getElementById('vehicles-tbody');
  if (!vehicles.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="table-loading">Sin resultados para los filtros</td></tr>';
    return;
  }

  tbody.innerHTML = vehicles.map(v => {
    const fotoHtml = v.foto
      ? `<img src="${v.foto}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover;">`
      : '<div style="width: 40px; height: 40px; border-radius: 4px; background: #eee; display: flex; align-items: center; justify-content: center; font-size: 0.6rem; color: #999;">Sin foto</div>';

    const respNombre = v.responsablePrincipal?.nombre 
      ? `<strong>${v.responsablePrincipal.nombre}</strong> <small style="color:#64748b;">(Apto ${v.responsablePrincipal.apartamento || v.apartamento})</small>`
      : (v.propietarios && v.propietarios[0]?.nombre 
          ? `<strong>${v.propietarios[0].nombre}</strong>` 
          : '<span style="color:#94a3b8">—</span>');
    
    let autorizadosHtml = '<span style="color:#94a3b8">—</span>';
    if (v.autorizados && v.autorizados.length > 0) {
      autorizadosHtml = v.autorizados.map(a => {
        const nom = a.nombre || 'Residente';
        const apt = a.apartamento ? ` (Apto ${a.apartamento})` : '';
        return `<span class="badge" style="background:#e0f2fe;color:#0369a1;margin:2px 2px;display:inline-block;font-size:11px;">${nom}${apt}</span>`;
      }).join('');
    }

    const regBadge = v.esExterno
      ? '<span class="badge" style="background:#fef3c7;color:#92400e">Externo</span>'
      : '<span class="badge" style="background:#dcfce7;color:#15803d">SGAR</span>';

    return `
    <tr>
      <td>${fotoHtml}</td>
      <td><strong>${v.placa || '—'}</strong></td>
      <td>${v.tipo}</td>
      <td>${v.marca || ''} ${v.modelo || ''}</td>
      <td><strong>${v.apartamento}</strong></td>
      <td>${respNombre}</td>
      <td>${autorizadosHtml}</td>
      <td>${regBadge}</td>
      <td>${SGAR.activeBadge(v.activo)}</td>
      <td>
        <button class="btn-secondary btn-sm" onclick="openEdit(${JSON.stringify(v).replace(/"/g,'&quot;')})">Editar</button>
        <button class="btn-secondary btn-sm" style="color:#d32f2f; border-color:#d32f2f; margin-left: 5px;" onclick="deleteVehicle('${v._id}')">Eliminar</button>
      </td>
    </tr>
  `}).join('');

  SGAR.renderPagination('pagination', pagination, (p) => { currentPage = p; loadVehicles(); });
}

async function openNew() {
  document.getElementById('v-edit-id').value = '';
  document.getElementById('drawer-title').textContent = 'Nuevo Vehículo';
  document.getElementById('form-vehicle').reset();
  
  document.getElementById('field-v-estado').style.display = 'none';
  document.getElementById('v-foto-base64').value = '';
  document.getElementById('v-foto-preview-container').style.display = 'none';
  document.getElementById('v-foto-name').textContent = 'Sin archivo';
  document.getElementById('v-es-externo').value = 'false';
  
  selectedAuthIds.clear();
  authSearchQuery = '';
  const searchInput = document.getElementById('v-auth-search');
  if (searchInput) searchInput.value = '';

  if (!allTenantResidents || allTenantResidents.length === 0) {
    await loadAllResidents();
  }

  populatePrincipalSelect();
  renderAutorizadosCheckboxes();

  SGAR.clearFormError('v-form-error');
  handleTipoChange();
  SGAR.openDrawer('drawer-vehicle');
}

async function openEdit(v) {
  document.getElementById('v-edit-id').value = v._id;
  document.getElementById('drawer-title').textContent = 'Editar Vehículo';
  
  document.getElementById('v-tipo').value = v.tipo || 'Carro';
  document.getElementById('v-placa').value = v.placa || '';
  document.getElementById('v-marca').value = v.marca || '';
  document.getElementById('v-modelo').value = v.modelo || '';
  document.getElementById('v-anio').value = v.anio || '';
  document.getElementById('v-color').value = v.color || '';
  document.getElementById('v-apartamento').value = v.apartamento || '';
  document.getElementById('v-es-externo').value = v.esExterno ? 'true' : 'false';
  
  document.getElementById('v-activo').value = v.activo ? 'true' : 'false';
  document.getElementById('field-v-estado').style.display = 'block';

  // Set foto
  document.getElementById('v-foto-base64').value = v.foto || '';
  if (v.foto) {
    document.getElementById('v-foto-preview-container').style.display = 'flex';
    document.getElementById('v-foto-preview').src = v.foto;
    document.getElementById('v-foto-name').textContent = 'Imagen actual';
  } else {
    document.getElementById('v-foto-preview-container').style.display = 'none';
    document.getElementById('v-foto-name').textContent = 'Sin archivo';
  }

  selectedAuthIds.clear();
  (v.autorizados || []).forEach(a => {
    const id = a._id || a;
    if (id) selectedAuthIds.add(String(id));
  });

  const principalId = v.responsablePrincipal?._id || v.responsablePrincipal || (v.propietarios && v.propietarios[0]?._id) || null;
  if (principalId) {
    selectedAuthIds.delete(String(principalId));
  }

  authSearchQuery = '';
  const searchInput = document.getElementById('v-auth-search');
  if (searchInput) searchInput.value = '';

  if (!allTenantResidents || allTenantResidents.length === 0) {
    await loadAllResidents();
  }

  populatePrincipalSelect(principalId);
  renderAutorizadosCheckboxes();
  
  SGAR.clearFormError('v-form-error');
  handleTipoChange();
  SGAR.openDrawer('drawer-vehicle');
}

async function submitVehicle(e) {
  e.preventDefault();
  SGAR.clearFormError('v-form-error');
  
  const editId = document.getElementById('v-edit-id').value;
  const tipo = document.getElementById('v-tipo').value;
  let placa = document.getElementById('v-placa').value.trim().toUpperCase();
  
  if (tipo === 'Carro') {
    if (!/^[A-Z]{3} \d{3}$/.test(placa)) {
      return SGAR.showFormError('v-form-error', 'La placa de Carro debe tener el formato: AAA 000');
    }
  } else if (tipo === 'Motocicleta') {
    if (!/^[A-Z]{3} \d{2}[A-Z]$/.test(placa)) {
      return SGAR.showFormError('v-form-error', 'La placa de Motocicleta debe tener el formato: AAA 00A');
    }
  }

  const autorizados = Array.from(selectedAuthIds);

  const payload = {
    tipo,
    placa,
    marca:                document.getElementById('v-marca').value.trim(),
    modelo:               document.getElementById('v-modelo').value.trim(),
    anio:                 document.getElementById('v-anio').value || undefined,
    color:                document.getElementById('v-color').value.trim(),
    apartamento:          document.getElementById('v-apartamento').value.trim(),
    responsablePrincipal: document.getElementById('v-responsable-principal').value || null,
    autorizados:          autorizados,
    esExterno:            document.getElementById('v-es-externo').value === 'true',
    foto:                 document.getElementById('v-foto-base64').value || undefined,
  };

  if (editId) {
    payload.activo = document.getElementById('v-activo').value === 'true';
  }

  const submitBtn = document.querySelector('#form-vehicle button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  const url = editId ? `/api/vehicles/${editId}` : '/api/vehicles';
  const method = editId ? 'PUT' : 'POST';

  const res = await SGAR.api(url, {
    method,
    body: JSON.stringify(payload)
  });

  if (submitBtn) submitBtn.disabled = false;

  if (!res || !res.success) {
    SGAR.showFormError('v-form-error', res?.message || 'Error al guardar el vehículo');
    return;
  }

  SGAR.closeDrawer('drawer-vehicle');
  loadVehicles();
}

async function deleteVehicle(id) {
  if (!id) return;
  if (!confirm('¿Estás seguro de eliminar este vehículo?')) return;
  
  const res = await SGAR.api(`/api/vehicles/${id}`, { method: 'DELETE' });
  if (!res || !res.success) {
    alert(res?.message || 'Error al eliminar');
    return;
  }
  loadVehicles();
}
