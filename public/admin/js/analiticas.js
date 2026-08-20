'use strict';
function getLocalDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

let currentPeriod = 'dia';
let currentDate   = getLocalDateStr();
let selectedTenantId   = null;
let selectedTenantName = null;

document.addEventListener('DOMContentLoaded', async () => {
  const user = SGAR.requireAuth();
  if (!user) return;

  const dateInput = document.getElementById('filter-date');
  if (dateInput) {
    dateInput.value = currentDate;
    dateInput.addEventListener('change', (e) => {
      currentDate = e.target.value;
      refreshCurrentView();
    });
  }

  // Configurar botones de periodo
  document.querySelectorAll('.btn-period').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-period').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = 'var(--text-muted)';
      });
      btn.classList.add('active');
      btn.style.background = 'var(--acento)';
      btn.style.color = '#fff';
      currentPeriod = btn.dataset.period;
      refreshCurrentView();
    });
  });

  const btnRefresh = document.getElementById('btn-refresh-analytics');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => refreshCurrentView());
  }

  const btnBackGlobal = document.getElementById('btn-back-global');
  if (btnBackGlobal) {
    btnBackGlobal.addEventListener('click', () => {
      selectedTenantId = null;
      selectedTenantName = null;
      document.getElementById('drilldown-banner').style.display = 'none';
      document.getElementById('view-conjunto').style.display = 'none';
      document.getElementById('view-admincontrol').style.display = 'block';
      loadGlobalAnalytics();
    });
  }

  // Establecer botón activo inicial
  const btnDia = document.getElementById('btn-period-dia');
  if (btnDia) {
    btnDia.style.background = 'var(--acento)';
    btnDia.style.color = '#fff';
  }

  // Carga inicial
  if (user.rol === 'adminControl') {
    document.getElementById('view-admincontrol').style.display = 'block';
    loadGlobalAnalytics();
  } else {
    document.getElementById('view-conjunto').style.display = 'block';
    loadConjuntoAnalytics();
  }
});

function refreshCurrentView() {
  const user = SGAR.getUser();
  if (!user) return;

  if (user.rol === 'adminControl' && !selectedTenantId) {
    loadGlobalAnalytics();
  } else {
    loadConjuntoAnalytics();
  }
}

function getPeriodTitle() {
  const dateObj = new Date(currentDate + 'T12:00:00');
  if (currentPeriod === 'dia') {
    return dateObj.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } else if (currentPeriod === 'semana') {
    return 'Últimos 7 días';
  } else if (currentPeriod === 'mes') {
    return 'Últimos 30 días';
  }
  return 'Periodo seleccionado';
}

/* ═════════════════════════════════════════════════════════════════════════════
   1. ANALÍTICAS GLOBALES (SuperAdmin)
   ═════════════════════════════════════════════════════════════════════════════ */
async function loadGlobalAnalytics() {
  document.getElementById('analytics-subtitle').textContent = `Métricas consolidadas de todos los conjuntos — ${getPeriodTitle()}`;

  const res = await SGAR.api(`/api/analytics/global?periodo=${currentPeriod}&fecha=${currentDate}`);
  if (!res?.success) return;

  const { resumenGlobal, conjuntos } = res.data;

  // Actualizar franja de totales
  document.getElementById('sg-total-entradas').textContent     = resumenGlobal.granTotalEntradas.toLocaleString();
  document.getElementById('sg-total-salidas').textContent      = resumenGlobal.granTotalSalidas.toLocaleString();
  document.getElementById('sg-total-ingresos-veh').textContent = resumenGlobal.granTotalIngresosVehiculos.toLocaleString();
  document.getElementById('sg-total-salidas-veh').textContent  = resumenGlobal.granTotalSalidasVehiculos.toLocaleString();
  document.getElementById('sg-total-movimientos').textContent  = resumenGlobal.granTotalMovimientos.toLocaleString();
  document.getElementById('sg-conjuntos-count').textContent    = `${conjuntos.length} conjuntos registrados`;

  // Construir gráfica comparativa global
  const labels = conjuntos.map(c => c.nombre);
  const dataEntradasPeat = conjuntos.map(c => c.entradas);
  const dataSalidasPeat  = conjuntos.map(c => c.salidas);
  const dataIngresosVeh  = conjuntos.map(c => c.ingresosVehiculos);
  const dataSalidasVeh   = conjuntos.map(c => c.salidasVehiculos);

  buildGroupedBarChart('chart-global-conjuntos', labels, [
    { label: 'Entradas Peatonales', data: dataEntradasPeat, color: '#10b981' },
    { label: 'Salidas Peatonales', data: dataSalidasPeat, color: '#ef4444' },
    { label: 'Ingresos Vehiculares', data: dataIngresosVeh, color: '#3b82f6' },
    { label: 'Salidas Vehiculares', data: dataSalidasVeh, color: '#f59e0b' },
  ]);

  // Renderizar tabla
  const tbody = document.getElementById('tbody-global-conjuntos');
  if (!conjuntos.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-loading">No hay conjuntos activos registrados</td></tr>';
    return;
  }

  tbody.innerHTML = conjuntos.map(c => `
    <tr>
      <td>
        <strong>${SGAR.escHtml(c.nombre)}</strong>
        <div style="font-size:11.5px; color:var(--text-muted);"><code>${c.slug}</code> ${c.nit ? '· NIT: ' + c.nit : ''}</div>
      </td>
      <td>${c.ciudad || 'Bogotá'}</td>
      <td style="color:#15803d; font-weight:600;">${c.entradas}</td>
      <td style="color:#b91c1c; font-weight:600;">${c.salidas}</td>
      <td style="color:#2563eb; font-weight:600;">${c.ingresosVehiculos}</td>
      <td style="color:#d97706; font-weight:600;">${c.salidasVehiculos}</td>
      <td><strong>${c.totalMovimientos}</strong></td>
      <td><span class="badge ${c.activo ? 'badge-active' : 'badge-inactive'}">${c.estado || (c.activo ? 'activo' : 'inactivo')}</span></td>
      <td style="text-align:right;">
        <button class="btn-primary btn-sm" onclick="drilldownConjunto('${c._id}', '${SGAR.escHtml(c.nombre)}')">
          Ver analíticas
        </button>
      </td>
    </tr>
  `).join('');
}

window.drilldownConjunto = function(tenantId, tenantName) {
  selectedTenantId = tenantId;
  selectedTenantName = tenantName;

  document.getElementById('view-admincontrol').style.display = 'none';
  document.getElementById('view-conjunto').style.display = 'block';

  const banner = document.getElementById('drilldown-banner');
  const bannerName = document.getElementById('drilldown-name');
  if (banner && bannerName) {
    bannerName.textContent = tenantName;
    banner.style.display = 'flex';
  }

  loadConjuntoAnalytics();
};

/* ═════════════════════════════════════════════════════════════════════════════
   2. ANALÍTICAS DE CONJUNTO (AdminConjunto & Drilldown)
   ═════════════════════════════════════════════════════════════════════════════ */
async function loadConjuntoAnalytics() {
  const url = selectedTenantId
    ? `/api/analytics/conjunto?periodo=${currentPeriod}&fecha=${currentDate}&tenant_id=${selectedTenantId}`
    : `/api/analytics/conjunto?periodo=${currentPeriod}&fecha=${currentDate}`;

  const res = await SGAR.api(url);
  if (!res?.success) return;

  const { tenant, accesos, vehiculos } = res.data;
  const nombreConjunto = tenant ? tenant.nombre : (selectedTenantName || 'Mi Conjunto');

  document.getElementById('analytics-subtitle').textContent =
    `Estadísticas operativas de ${nombreConjunto} — ${getPeriodTitle()}`;

  // 1. Resumen de Accesos Peatonales
  document.getElementById('sc-entradas').textContent  = accesos.totalEntradas.toLocaleString();
  document.getElementById('sc-salidas').textContent   = accesos.totalSalidas.toLocaleString();
  document.getElementById('sc-total-mov').textContent = accesos.totalMovimientos.toLocaleString();
  document.getElementById('sc-dentro').textContent    = accesos.personasDentro.toLocaleString();

  // Gráfica de Accesos por Hora / Día
  const titleChartAccesos = document.getElementById('title-chart-accesos-horas');
  if (currentPeriod === 'dia') {
    if (titleChartAccesos) titleChartAccesos.textContent = 'Entradas y Salidas por Franja Horaria (00:00 – 23:00)';
    const labelsHoras = accesos.porHora.map(h => h.label);
    const dataEntradas = accesos.porHora.map(h => h.entradas);
    const dataSalidas  = accesos.porHora.map(h => h.salidas);
    buildGroupedBarChart('chart-accesos-horas', labelsHoras, [
      { label: 'Entradas', data: dataEntradas, color: '#10b981' },
      { label: 'Salidas',  data: dataSalidas,  color: '#ef4444' },
    ]);
  } else {
    if (titleChartAccesos) titleChartAccesos.textContent = `Entradas y Salidas Diarias (${currentPeriod === 'semana' ? '7 días' : '30 días'})`;
    const labelsDias = accesos.porDia.map(d => d.label);
    const dataEntradas = accesos.porDia.map(d => d.entradas);
    const dataSalidas  = accesos.porDia.map(d => d.salidas);
    buildGroupedBarChart('chart-accesos-horas', labelsDias, [
      { label: 'Entradas', data: dataEntradas, color: '#10b981' },
      { label: 'Salidas',  data: dataSalidas,  color: '#ef4444' },
    ]);
  }

  // Gráfica de Accesos por Tipo
  const tipoLabelsMap = {
    residente: 'Residentes',
    visita: 'Visitas',
    domicilio: 'Domicilios',
    tecnico_mantenimiento: 'Técnicos',
    vehiculo: 'Vehículos',
  };
  const tipoLabels = accesos.porTipo.map(t => tipoLabelsMap[t.tipo] || t.tipo);
  const tipoValues = accesos.porTipo.map(t => t.count);
  buildDoughnutChart('chart-accesos-tipo', tipoLabels, tipoValues);

  // 2. Resumen de Vehículos
  document.getElementById('sc-ingresos-veh').textContent   = vehiculos.totalIngresos.toLocaleString();
  document.getElementById('sc-salidas-veh').textContent    = vehiculos.totalSalidas.toLocaleString();
  document.getElementById('sc-total-veh-mov').textContent  = vehiculos.totalMovimientos.toLocaleString();
  document.getElementById('sc-veh-dentro').textContent     = vehiculos.vehiculosDentro.toLocaleString();

  // Gráfica de Vehículos por Hora / Día
  const titleChartVeh = document.getElementById('title-chart-vehiculos-horas');
  if (currentPeriod === 'dia') {
    if (titleChartVeh) titleChartVeh.textContent = 'Flujo Vehicular por Franja Horaria (Ingresos vs Salidas)';
    const labelsHorasVeh = vehiculos.porHora.map(h => h.label);
    const dataIngresos = vehiculos.porHora.map(h => h.ingresos);
    const dataSalidas  = vehiculos.porHora.map(h => h.salidas);
    buildGroupedBarChart('chart-vehiculos-horas', labelsHorasVeh, [
      { label: 'Ingresos Vehiculares', data: dataIngresos, color: '#3b82f6' },
      { label: 'Salidas Vehiculares',  data: dataSalidas,  color: '#f59e0b' },
    ]);
  } else {
    if (titleChartVeh) titleChartVeh.textContent = `Flujo Vehicular Diario (${currentPeriod === 'semana' ? '7 días' : '30 días'})`;
    const labelsDiasVeh = vehiculos.porDia.map(d => d.label);
    const dataIngresos = vehiculos.porDia.map(d => d.ingresos);
    buildGroupedBarChart('chart-vehiculos-horas', labelsDiasVeh, [
      { label: 'Ingresos Vehiculares', data: dataIngresos, color: '#3b82f6' },
    ]);
  }

  // 3. Tabla de Top Vehículos con Mayor Movimiento
  const tbodyTopVeh = document.getElementById('tbody-top-vehiculos');
  const topVeh = vehiculos.topVehiculos || [];
  document.getElementById('sc-top-veh-count').textContent = `${topVeh.length} vehículos activos`;

  if (!topVeh.length) {
    tbodyTopVeh.innerHTML = '<tr><td colspan="8" class="table-loading">Sin movimientos vehiculares en este periodo</td></tr>';
    return;
  }

  tbodyTopVeh.innerHTML = topVeh.map((v, idx) => {
    const alertaBadge = v.alertasNoAutorizado > 0
      ? `<span class="badge" style="background:#fee2e2;color:#b91c1c;font-weight:700;">${v.alertasNoAutorizado} no autorizada(s)</span>`
      : `<span class="badge" style="background:#dcfce7;color:#15803d;">Normal</span>`;

    return `
      <tr>
        <td><strong style="color:var(--acento); margin-right:4px;">#${idx + 1}</strong> <strong>${SGAR.escHtml(v.placa)}</strong></td>
        <td>${v.tipoVehiculo || 'Carro'}</td>
        <td><strong>Apto ${v.apartamento || '—'}</strong></td>
        <td>${SGAR.escHtml(v.responsablePrincipal || '—')}</td>
        <td style="text-align:center; color:#2563eb; font-weight:600;">${v.ingresos}</td>
        <td style="text-align:center; color:#d97706; font-weight:600;">${v.salidas}</td>
        <td style="text-align:center; font-weight:800; font-size:14px;">${v.totalMovimientos}</td>
        <td>${alertaBadge}</td>
      </tr>
    `;
  }).join('');
}

/* ═════════════════════════════════════════════════════════════════════════════
   3. GENERADORES DE GRÁFICAS (Chart.js)
   ═════════════════════════════════════════════════════════════════════════════ */
function buildGroupedBarChart(canvasId, labels, datasetsConfig) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  const ctx = canvas.getContext('2d');
  const datasets = datasetsConfig.map(ds => ({
    label:           ds.label,
    data:            ds.data,
    backgroundColor: ds.color + 'cc',
    borderColor:     ds.color,
    borderWidth:     1.5,
    borderRadius:    4,
    barPercentage:   0.8,
  }));

  new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: datasets.length > 1,
          position: 'top',
          labels: { font: { size: 12, family: 'Inter, sans-serif' }, boxWidth: 14 }
        },
        tooltip: {
          padding: 10,
          boxPadding: 4,
          usePointStyle: true,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11, family: 'Inter, sans-serif' } },
        },
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: { precision: 0, font: { size: 11, family: 'Inter, sans-serif' } },
        },
      },
    },
  });
}

function buildDoughnutChart(canvasId, labels, values) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  if (!values.length || values.every(v => v === 0)) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const palette = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6b7280'];

  const ctx = canvas.getContext('2d');
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: palette.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#ffffff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11, family: 'Inter, sans-serif' }, boxWidth: 12 },
        },
      },
      cutout: '65%',
    },
  });
}
