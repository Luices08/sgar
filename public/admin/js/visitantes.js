'use strict';

function escHtml(str) {
  if (typeof SGAR !== 'undefined' && typeof SGAR.escHtml === 'function') {
    return SGAR.escHtml(str);
  }
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let currentPage = 1;
let currentTab = 'todos';
let searchTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  if (!SGAR.requireAuth()) return;
  SGAR.initDrawer('drawer-visitor');

  const searchEl = document.getElementById('search-input');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        currentPage = 1;
        loadVisitors();
      }, 350);
    });
  }

  document.getElementById('filter-tipo')?.addEventListener('change', () => {
    currentPage = 1;
    loadVisitors();
  });

  document.getElementById('filter-estado-acceso')?.addEventListener('change', (e) => {
    currentPage = 1;
    if (e.target.value === 'dentro') {
      switchTab('dentro', false);
    } else {
      switchTab('todos', false);
    }
    loadVisitors();
  });

  document.getElementById('filter-date')?.addEventListener('change', () => {
    currentPage = 1;
    loadVisitors();
  });

  // Pestañas
  document.getElementById('tab-todos-visitantes')?.addEventListener('click', () => switchTab('todos'));
  document.getElementById('tab-visitantes-dentro')?.addEventListener('click', () => switchTab('dentro'));

  loadVisitors();
});

function switchTab(tab, triggerReload = true) {
  currentTab = tab;
  const tabTodos = document.getElementById('tab-todos-visitantes');
  const tabDentro = document.getElementById('tab-visitantes-dentro');
  const filterEstado = document.getElementById('filter-estado-acceso');

  if (tab === 'dentro') {
    if (tabDentro) {
      tabDentro.style.background = 'var(--acento)';
      tabDentro.style.color = '#fff';
    }
    if (tabTodos) {
      tabTodos.style.background = 'var(--bg)';
      tabTodos.style.color = 'var(--text-muted)';
    }
    if (filterEstado && filterEstado.value !== 'dentro') {
      filterEstado.value = 'dentro';
    }
  } else {
    if (tabTodos) {
      tabTodos.style.background = 'var(--acento)';
      tabTodos.style.color = '#fff';
    }
    if (tabDentro) {
      tabDentro.style.background = 'var(--bg)';
      tabDentro.style.color = 'var(--text-muted)';
    }
    if (filterEstado && filterEstado.value === 'dentro') {
      filterEstado.value = '';
    }
  }

  if (triggerReload) {
    currentPage = 1;
    loadVisitors();
  }
}

async function loadVisitors() {
  const tbody = document.getElementById('visitors-tbody');
  const q = document.getElementById('search-input')?.value.trim() || '';
  const tipo = document.getElementById('filter-tipo')?.value || '';
  const fecha = document.getElementById('filter-date')?.value || '';
  let estado = document.getElementById('filter-estado-acceso')?.value || '';

  if (currentTab === 'dentro') {
    estado = 'dentro';
  }

  let url = `/api/visitors?page=${currentPage}&limit=20`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  if (tipo) url += `&tipo=${tipo}`;
  if (fecha) url += `&fecha=${fecha}`;
  if (estado) url += `&estado=${estado}`;

  try {
    const data = await SGAR.api(url);
    if (!data || !data.success) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="table-loading" style="color:#ef4444;">${data?.message || 'Error cargando visitantes'}</td></tr>`;
      return;
    }

    const { data: visitors, pagination, meta } = data;
    const totalCount = pagination.total || 0;
    const dentroCount = meta?.dentroCount ?? 0;

    document.getElementById('sub-count').textContent = `${totalCount} registros encontrados · ${dentroCount} actualmente adentro`;
    
    const badgeTodos = document.getElementById('badge-count-todos');
    if (badgeTodos) badgeTodos.textContent = `${totalCount}`;

    const badgeDentro = document.getElementById('badge-count-dentro');
    if (badgeDentro) badgeDentro.textContent = `${dentroCount} adentro`;

    if (!visitors.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="table-loading">No se encontraron visitantes con los filtros seleccionados</td></tr>';
      return;
    }

    tbody.innerHTML = visitors.map(v => {
      const isDom = v.tipo === 'domicilio';
      const isTec = v.tipo === 'tecnico_mantenimiento' || v.tipo === 'tecnico';
      
      let nombreDisplay = v.nombre || 'Visitante';
      if (isDom && v.empresa) {
        nombreDisplay = `${v.empresa}${v.nombre ? ` (${v.nombre})` : ''}`;
      } else if (isTec && v.empresa) {
        nombreDisplay = `${v.nombre} <small style="color:#64748b;">· ${v.empresa}</small>`;
      }

      const tipoBadge = isDom
        ? '<span class="badge" style="background:#fef3c7;color:#92400e;font-weight:700;">Domicilio</span>'
        : (isTec
            ? '<span class="badge" style="background:#f3e8ff;color:#7e22ce;font-weight:700;">Técnico</span>'
            : '<span class="badge" style="background:#e0f2fe;color:#0369a1;font-weight:700;">Visita</span>');

      const vehiculoDisplay = v.placa
        ? `<strong style="font-family:monospace; color:var(--acento);">${v.placa}</strong> <small style="color:#64748b;">(${v.tipoVehiculo || 'Carro'})</small>`
        : '<span style="color:#64748b;">A pie</span>';

      const horaSalidaDisplay = v.horaSalida
        ? SGAR.fmtDate(v.horaSalida)
        : '<span style="color:#15803d; font-weight:700;">En el conjunto</span>';

      const estadoBadge = v.estadoAcceso === 'dentro'
        ? '<span class="badge" style="background:#dcfce7;color:#15803d;font-weight:700;display:inline-flex;align-items:center;gap:4px;">Dentro</span>'
        : '<span class="badge" style="background:#f1f5f9;color:#64748b;font-weight:600;">Fuera</span>';

      return `
        <tr>
          <td><strong>${SGAR.escHtml(nombreDisplay)}</strong></td>
          <td>${v.cedula || '<span style="color:#94a3b8">—</span>'}</td>
          <td><strong>${v.apartamento || '—'}</strong></td>
          <td>${tipoBadge}</td>
          <td>${vehiculoDisplay}</td>
          <td>${SGAR.fmtDate(v.horaIngreso)}</td>
          <td>${horaSalidaDisplay}</td>
          <td>${estadoBadge}</td>
          <td>${v.celador_nombre || '<span style="color:#94a3b8">—</span>'}</td>
          <td>
            <button class="btn-secondary btn-sm" onclick="openVisitorDetail('${v._id}')">Ver Detalle</button>
          </td>
        </tr>
      `;
    }).join('');

    SGAR.renderPagination('pagination', pagination, (p) => { currentPage = p; loadVisitors(); });
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="table-loading" style="color:#ef4444;">Error cargando visitantes: ${err.message}</td></tr>`;
  }
}

async function openVisitorDetail(id) {
  const data = await SGAR.api(`/api/visits/${id}`);
  if (!data?.success) return;
  const v = data.data.visit;
  const body = document.getElementById('visitor-detail-body');
  if (!body) return;

  const calcularDuracion = (ingreso, salida) => {
    if (!ingreso) return null;
    const fin = salida ? new Date(salida) : new Date();
    const diff = Math.max(0, Math.floor((fin - new Date(ingreso)) / 60000));
    if (diff < 60) return `${diff} min`;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return `${h}h ${m}m`;
  };

  const duracion = calcularDuracion(v.horaIngreso, v.horaSalida);

  const vehIngresoInfo = v.placa
    ? `<strong>${v.placa}</strong> (${v.tipoVehiculo || 'Carro'}${v.marcaVehiculo ? ` · ${v.marcaVehiculo}` : ''}${v.modeloVehiculo ? ` ${v.modeloVehiculo}` : ''})`
    : 'A pie';

  const vehSalidaInfo = v.horaSalida
    ? (v.placaSalida
      ? `<strong>${v.placaSalida}</strong> (Otro vehículo)`
      : (v.placa ? `<strong>${v.placa}</strong> (Mismo vehículo)` : 'A pie'))
    : '—';

  const fields = [
    ['Tipo de visitante', SGAR.tipoBadge(v.tipo)],
    ['Nombre / Persona', v.nombre || v.empresa || '—'],
    ['Cédula', v.cedula || '—'],
    ['Apartamento de destino', v.apartamento || '—'],
    ['Vehículo de ingreso', vehIngresoInfo],
    ['Vehículo de salida', vehSalidaInfo],
    ['Estado actual', v.horaSalida ? 'Salida registrada' : '<span style="color:#15803d;font-weight:700">Dentro del conjunto</span>'],
  ];

  if (v.tipo === 'domicilio') {
    fields.push(
      ['── DETALLES DEL DOMICILIO ──', '────────────────────'],
      ['Estado del domicilio', v.estadoDomicilio === 'recibido' ? '<span style="color:#15803d;font-weight:700;">Recibido por residente</span>' : '<span style="color:#d97706;font-weight:700;">En portería (Pendiente de reclamar)</span>'],
      ['Llegada a portería', SGAR.fmtDate(v.fechaLlegada || v.horaIngreso)],
      ['Notificación enviada', v.fechaNotificacion ? SGAR.fmtDate(v.fechaNotificacion) : '—'],
      ['Recepción confirmada', v.fechaRecepcion ? SGAR.fmtDate(v.fechaRecepcion) : 'Pendiente por el residente'],
      ['Recibido por', v.recibidoPorNombre || (v.estadoDomicilio === 'recibido' ? 'Residente' : '—')]
    );
  }

  fields.push(
    ['── ENTRADA ──', '────────────────────'],
    ['Hora de ingreso', SGAR.fmtDate(v.horaIngreso)],
    ['Método de ingreso', v.metodoIdentificacion || 'manual'],
    ['Celador que ingresó', v.celador_nombre || '—'],
    ['── SALIDA ──', '────────────────────'],
    ['Hora de salida', v.horaSalida ? SGAR.fmtDate(v.horaSalida) : 'Aún dentro del conjunto'],
    ['Método de salida', v.horaSalida ? (v.metodoSalida || 'manual') : '—'],
    ['Celador que registró salida', v.horaSalida ? (v.celador_salida_nombre || '—') : '—'],
    ['Duración de estadía', duracion || (v.horaSalida ? '—' : 'En curso…')]
  );

  if (v.observaciones) {
    fields.push(
      ['── OBSERVACIONES ──', '────────────────────'],
      ['Notas', SGAR.escHtml(v.observaciones)]
    );
  }

  let html = fields.map(([l, val]) => {
    if (val === '────────────────────') {
      return `<div style="font-weight:700;font-size:0.75rem;color:var(--text-faint);letter-spacing:0.05em;margin:12px 0 4px;text-transform:uppercase;">${l.replace(/──/g,'').trim()}</div>`;
    }
    return `
      <div class="field-preview" style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.875rem;">
        <span style="color:var(--text-muted);">${l}</span>
        <span style="text-align:right;">${val}</span>
      </div>
    `;
  }).join('');

  body.innerHTML = html;
  SGAR.openDrawer('drawer-visitor');
}
