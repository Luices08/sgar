'use strict';

let currentPage = 1;
let searchTimer = null;

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

  // Handle Tipo change
  document.getElementById('v-tipo').addEventListener('change', handleTipoChange);

  // Handle Apartamento change to load residents
  document.getElementById('v-apartamento').addEventListener('blur', loadResidentsByApto);

  // Handle Photo upload
  document.getElementById('v-foto-upload').addEventListener('change', handlePhotoUpload);

  loadVehicles();

  // Handle URL parameters for auto-assigning vehicle to a resident
  const urlParams = new URLSearchParams(window.location.search);
  const aptoParam = urlParams.get('apto');
  const residenteParam = urlParams.get('residente');
  if (aptoParam && residenteParam) {
    openNew();
    document.getElementById('v-apartamento').value = aptoParam;
    loadResidentsByApto().then(() => {
      document.getElementById('v-resident_id').value = residenteParam;
    });
    // Limpiar la URL para evitar que se vuelva a abrir si el usuario recarga
    window.history.replaceState({}, document.title, window.location.pathname);
  }
});

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

async function loadResidentsByApto() {
  const apto = document.getElementById('v-apartamento').value.trim();
  const select = document.getElementById('v-resident_id');
  
  // Guardar el valor actual para reasignarlo si es posible
  const currentValue = select.value;

  select.innerHTML = '<option value="">(Buscando...)</option>';
  
  if (!apto) {
    select.innerHTML = '<option value="">(Sin asignar)</option>';
    return;
  }

  const res = await SGAR.api(`/api/residents?apartamento=${encodeURIComponent(apto)}&limit=100`);
  if (!res || !res.success || !res.data || res.data.length === 0) {
    select.innerHTML = '<option value="">(Sin asignar - No hay residentes)</option>';
    return;
  }

  select.innerHTML = '<option value="">(Sin asignar)</option>' + res.data.map(r => 
    `<option value="${r._id}">${r.nombre}</option>`
  ).join('');

  // Re-seleccionar si es posible
  if (currentValue && Array.from(select.options).some(o => o.value === currentValue)) {
    select.value = currentValue;
  }
}

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
  const url = `/api/vehicles?page=${currentPage}&limit=20${q ? '&q=' + encodeURIComponent(q) : ''}`;
  const data = await SGAR.api(url);
  
  if (!data || !data.success) return;

  const { data: vehicles, pagination } = data;
  document.getElementById('sub-count').textContent = `${pagination.total} vehículos`;

  const tbody = document.getElementById('vehicles-tbody');
  if (!vehicles.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-loading">Sin resultados</td></tr>';
    return;
  }

  tbody.innerHTML = vehicles.map(v => {
    const fotoHtml = v.foto ? `<img src="${v.foto}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover;">` : '<div style="width: 40px; height: 40px; border-radius: 4px; background: #eee; display: flex; align-items: center; justify-content: center; font-size: 0.6rem; color: #999;">Sin foto</div>';
    return `
    <tr>
      <td>${fotoHtml}</td>
      <td><strong>${v.placa || '—'}</strong></td>
      <td>${v.tipo}</td>
      <td>${v.marca || ''} ${v.modelo || ''}</td>
      <td>${v.apartamento}</td>
      <td>${v.resident_id ? v.resident_id.nombre : '—'}</td>
      <td>${SGAR.activeBadge(v.activo)}</td>
      <td>
        <button class="btn-secondary btn-sm" onclick="openEdit(${JSON.stringify(v).replace(/"/g,'&quot;')})">Editar</button>
        <button class="btn-secondary btn-sm" style="color:#d32f2f; border-color:#d32f2f; margin-left: 5px;" onclick="deleteVehicle('${v._id}')">Eliminar</button>
      </td>
    </tr>
  `}).join('');

  SGAR.renderPagination('pagination', pagination, (p) => { currentPage = p; loadVehicles(); });
}

function openNew() {
  document.getElementById('v-edit-id').value = '';
  document.getElementById('drawer-title').textContent = 'Nuevo Vehículo';
  document.getElementById('form-vehicle').reset();
  
  document.getElementById('field-v-estado').style.display = 'none';
  document.getElementById('v-foto-base64').value = '';
  document.getElementById('v-foto-preview-container').style.display = 'none';
  document.getElementById('v-foto-name').textContent = 'Sin archivo';
  document.getElementById('v-resident_id').innerHTML = '<option value="">(Sin asignar)</option>';

  SGAR.clearFormError('v-form-error');
  handleTipoChange(); // Init UI rules
  SGAR.openDrawer('drawer-vehicle');
}

function openEdit(v) {
  document.getElementById('v-edit-id').value = v._id;
  document.getElementById('drawer-title').textContent = 'Editar Vehículo';
  
  document.getElementById('v-tipo').value = v.tipo || 'Carro';
  document.getElementById('v-placa').value = v.placa || '';
  document.getElementById('v-marca').value = v.marca || '';
  document.getElementById('v-modelo').value = v.modelo || '';
  document.getElementById('v-anio').value = v.anio || '';
  document.getElementById('v-color').value = v.color || '';
  document.getElementById('v-apartamento').value = v.apartamento || '';
  
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

  // Set Resident Select placeholder temporarily, then load
  const resSelect = document.getElementById('v-resident_id');
  if (v.resident_id) {
    resSelect.innerHTML = `<option value="${v.resident_id._id}">${v.resident_id.nombre}</option>`;
  } else {
    resSelect.innerHTML = '<option value="">(Sin asignar)</option>';
  }

  // Async load residents for the apto
  loadResidentsByApto();
  
  SGAR.clearFormError('v-form-error');
  handleTipoChange(); // Init UI rules
  SGAR.openDrawer('drawer-vehicle');
}

async function submitVehicle(e) {
  e.preventDefault();
  SGAR.clearFormError('v-form-error');
  
  const editId = document.getElementById('v-edit-id').value;
  const tipo = document.getElementById('v-tipo').value;
  let placa = document.getElementById('v-placa').value.trim().toUpperCase();
  
  // Custom Regex Validation logic here for UX feedback
  if (tipo === 'Carro') {
    if (!/^[A-Z]{3} \d{3}$/.test(placa)) {
      return SGAR.showFormError('v-form-error', 'La placa de Carro debe tener el formato: AAA 000 (3 letras, espacio, 3 números)');
    }
  } else if (tipo === 'Motocicleta') {
    if (!/^[A-Z]{3} \d{2}[A-Z]$/.test(placa)) {
      return SGAR.showFormError('v-form-error', 'La placa de Motocicleta debe tener el formato: AAA 00A (3 letras, espacio, 2 números, 1 letra)');
    }
  }

  const payload = {
    tipo,
    placa,
    marca: document.getElementById('v-marca').value.trim(),
    modelo: document.getElementById('v-modelo').value.trim(),
    anio: document.getElementById('v-anio').value || undefined,
    color: document.getElementById('v-color').value.trim(),
    apartamento: document.getElementById('v-apartamento').value.trim(),
    resident_id: document.getElementById('v-resident_id').value || null,
    foto: document.getElementById('v-foto-base64').value || undefined,
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
