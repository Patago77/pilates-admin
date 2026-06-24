
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ===== MODAL FORMULARIO MOVIMIENTO =====
window.abrirModalMovimiento = async function() {
  // Setear fecha de hoy si está vacía
  const fechaEl = document.getElementById("fecha");
  if (fechaEl && !fechaEl.value) fechaEl.valueAsDate = new Date();

  // Si dia >= 20 pre-completar serviceMonth con el mes siguiente
  const serviceMonthEl = document.getElementById("serviceMonth");
  if (serviceMonthEl && !serviceMonthEl.value) {
    const hoy = new Date();
    const mesServicio = hoy.getDate() >= 20
      ? new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1)
      : hoy;
    serviceMonthEl.value = mesServicio.getFullYear() + "-" + String(mesServicio.getMonth() + 1).padStart(2, "0");
  }

  // Cuando el admin cambia la fecha de pago, actualizar serviceMonth automáticamente
  const fechaInputModal = document.getElementById("fecha");
  if (fechaInputModal && serviceMonthEl && !fechaInputModal._smListenerAdded) {
    fechaInputModal._smListenerAdded = true;
    fechaInputModal.addEventListener("change", () => {
      const parts = fechaInputModal.value.split("-");
      if (parts.length === 3) {
        const d = parseInt(parts[2], 10);
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const sugerido = d >= 20
          ? new Date(y, m + 1, 1)
          : new Date(y, m, 1);
        serviceMonthEl.value = sugerido.getFullYear() + "-" + String(sugerido.getMonth() + 1).padStart(2, "0");
      }
    });
  }

  // Cargar planes dinamicamente desde la DB
  const selectAbono = document.getElementById("subscriptionType");
  if (selectAbono && selectAbono.options.length <= 1) {
    try {
      const resp = await fetch(`${API_URL}/planes`, { headers: getAuthHeaders() });
      const planes = await resp.json();
      selectAbono.innerHTML = '<option value="">Seleccioná un abono</option>';
      planes.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.codigo;
        opt.textContent = p.nombre + (p.precio > 0 ? ' — $' + Number(p.precio).toLocaleString('es-AR') : '');
        selectAbono.appendChild(opt);
      });
    } catch(e) {
      console.error('Error cargando planes:', e);
    }
  }

  if (typeof iniciarBuscadorAlumno === 'function') iniciarBuscadorAlumno();
  bootstrap.Modal.getOrCreateInstance(document.getElementById("modalMovimientoForm")).show();
};


// ===== TABS HISTORIAL =====
window.switchHistorialTab = function(tab) {
  const tabPagos = document.getElementById("tab-pagos");
  const tabMovs  = document.getElementById("tab-movimientos");
  const btnPagos = document.getElementById("tab-pagos-btn");
  const btnMovs  = document.getElementById("tab-movimientos-btn");

  if (tab === "pagos") {
    tabPagos?.classList.remove("d-none");
    tabMovs?.classList.add("d-none");
    btnPagos?.classList.add("active");
    btnMovs?.classList.remove("active");
  } else {
    tabPagos?.classList.add("d-none");
    tabMovs?.classList.remove("d-none");
    btnPagos?.classList.remove("active");
    btnMovs?.classList.add("active");
    aplicarFiltroMovimientosModal();
  }
};


// ===== HISTORIAL ASISTENCIAS POR ALUMNO =====
window.verAsistenciasAlumno = async function(documento, nombre) {
  try {
    const resp = await fetch(`${API_URL}/attendance/alumno/${documento}`, {
      headers: getAuthHeaders()
    });
    if (!resp.ok) throw new Error("No se pudieron obtener las asistencias.");
    const asistencias = await resp.json();

    let html = "";
    if (!asistencias.length) {
      html = '<p class="text-muted text-center py-3">Sin asistencias registradas.</p>';
    } else {
      html = `<table class="table table-sm table-striped">
        <thead class="table-dark">
          <tr><th>Fecha</th><th>Horario</th></tr>
        </thead>
        <tbody>
          ${asistencias.map(a => `
            <tr>
              <td>${new Date(a.fecha).toLocaleDateString("es-AR")}</td>
              <td>${a.horario || "—"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>`;
    }

    Swal.fire({ didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; },
      title: `📋 Asistencias — ${nombre}`,
      html: `<div style="max-height:400px;overflow-y:auto">${html}</div>
             <div class="mt-2 text-muted small">Total: ${asistencias.length} clases</div>`,
      width: 500,
      confirmButtonText: "Cerrar"
    });
  } catch(err) {
    handleError(err);
  }
};


// ===== MODAL ALUMNOS =====
let alumnosModalData = [];

window.abrirModalAlumnos = async function() {
  await cargarAlumnosModal();
  bootstrap.Modal.getOrCreateInstance(document.getElementById("modalAlumnos")).show();
};

window.cargarAlumnosModal = async function() {
  const mostrarInactivos = document.getElementById("mostrarInactivos")?.checked;
  const url = mostrarInactivos
    ? `${API_URL}/students?todos=true`
    : `${API_URL}/students`;

  try {
    const resp = await fetch(url + (url.includes('?') ? '&' : '?') + 'limit=500', { headers: getAuthHeaders() });
    if (!resp.ok) throw new Error("No se pudieron obtener los alumnos.");
    const data = await resp.json();
    alumnosModalData = Array.isArray(data) ? data : (data.students || []);
    renderTablaAlumnos();
  } catch(err) {
    handleError(err);
  }
};

function renderTablaAlumnos() {
  const q = (document.getElementById("filtroAlumnosModal")?.value || "").toLowerCase().trim();
  const filtrados = alumnosModalData.filter(a =>
    (a.nombre || "").toLowerCase().includes(q) ||
    (a.documento || "").toLowerCase().includes(q)
  );

  const tbody = document.getElementById("tablaAlumnosModal");
  const total = document.getElementById("totalAlumnosModal");

  tbody.innerHTML = filtrados.map(a => `
    <tr class="${a.activo == 0 ? 'table-secondary text-muted' : ''}">
      <td>${escapeHtml(a.nombre)}</td>
      <td>${escapeHtml(a.documento)}</td>
      <td>${escapeHtml(a.telefono) || "—"}</td>
      <td>
        <span class="badge ${a.activo != 0 ? 'bg-success' : 'bg-secondary'}">
          ${a.activo != 0 ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td>
        <button class="btn btn-sm ${a.activo != 0 ? 'btn-outline-danger' : 'btn-outline-success'}"
          onclick="toggleActivoAlumno('${escapeHtml(a.documento)}', ${a.activo != 0 ? 0 : 1})">
          ${a.activo != 0 ? 'Desactivar' : 'Activar'}
        </button>
      </td>
    </tr>
  `).join("");

  if (total) total.textContent = `${filtrados.length} alumnos`;
}

window.toggleActivoAlumno = async function(documento, nuevoEstado) {
  const accion = nuevoEstado === 0 ? "desactivar" : "activar";
  const confirm = await Swal.fire({ didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; },
    title: `¿${nuevoEstado === 0 ? 'Desactivar' : 'Activar'} alumno?`,
    text: nuevoEstado === 0
      ? "No aparecerá en pendientes ni en las listas activas."
      : "Volverá a aparecer en las listas activas.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: `Sí, ${accion}`,
    cancelButtonText: "Cancelar"
  });
  if (!confirm.isConfirmed) return;

  try {
    const resp = await fetch(`${API_URL}/students/${documento}/activo`, {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({ activo: nuevoEstado })
    });
    if (!resp.ok) throw new Error("No se pudo actualizar el estado.");

    Swal.fire({ didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; },
      toast: true, position: "top-end", icon: "success",
      title: `Alumno ${nuevoEstado === 0 ? 'desactivado' : 'activado'}`,
      showConfirmButton: false, timer: 2000
    });

    await cargarAlumnosModal();
    await cargarTarjetasEstadoMes();
  } catch(err) {
    handleError(err);
  }
};


// ===== MODAL ASISTENCIAS =====
window.abrirModalAsistencias = async function() {
  // Cargar alumnos en el select del modal
  try {
    const resp = await fetch(`${API_URL}/students?limit=500`, { headers: getAuthHeaders() });
    const data = await resp.json();
    const alumnos = Array.isArray(data) ? data : (data.students || []);
    const select = document.getElementById("asistenciaAlumno");
    if (select) {
      select.innerHTML = '<option value="">Seleccioná un alumno</option>';
      alumnos.forEach(a => {
        select.innerHTML += `<option value="${escapeHtml(a.documento)}">${escapeHtml(a.nombre)}</option>`;
      });
    }
  } catch(e) { console.error(e); }

  await cargarAsistenciasHoy();
  bootstrap.Modal.getOrCreateInstance(document.getElementById("modalAsistencias")).show();
};

async function cargarAsistenciasHoy() {
  try {
    const resp = await fetch(`${API_URL}/attendance/hoy`, { headers: getAuthHeaders() });
    if (!resp.ok) throw new Error("No se pudieron obtener las asistencias.");
    const asistencias = await resp.json();

    const lista = document.getElementById("asistenciasHoyLista");
    const total = document.getElementById("totalAsistenciasHoy");

    if (!asistencias.length) {
      lista.innerHTML = '<div class="text-center text-muted py-3">No hay asistencias registradas hoy.</div>';
      if (total) total.textContent = "";
      return;
    }

    // Agrupar por horario
    const grupos = {};
    asistencias.forEach(a => {
      const h = a.horario || "Sin horario";
      if (!grupos[h]) grupos[h] = [];
      grupos[h].push(a);
    });

    lista.innerHTML = Object.entries(grupos).map(([horario, alumnos]) => `
      <div class="mb-3">
        <div class="fw-bold text-primary mb-1">🕐 ${horario} — ${alumnos.length} alumno${alumnos.length > 1 ? "s" : ""}</div>
        <div class="d-flex flex-wrap gap-2">
          ${alumnos.map(a => `
            <span class="badge bg-light text-dark border px-3 py-2">
              ${a.nombre || a.documento}
            </span>
          `).join("")}
        </div>
      </div>
    `).join("");

    if (total) total.textContent = `Total hoy: ${asistencias.length} asistencias`;
  } catch(err) {
    console.error(err);
  }
}

window.registrarAsistenciaModal = async function() {
  const documento = document.getElementById("asistenciaAlumno")?.value;
  const horario   = document.getElementById("asistenciaHorario")?.value;

  if (!documento) return Swal.fire("Error", "Seleccioná un alumno.", "warning");
  if (!horario)   return Swal.fire("Error", "Seleccioná un horario.", "warning");

  try {
    const resp = await fetch(`${API_URL}/attendance`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ documento, horario })
    });
    if (!resp.ok) throw new Error("No se pudo registrar la asistencia.");

    Swal.fire({ didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; }, icon: "success", title: "Asistencia registrada", timer: 1500, showConfirmButton: false });
    document.getElementById("asistenciaAlumno").value = "";
    document.getElementById("asistenciaHorario").value = "";
    await cargarAsistenciasHoy();
  } catch(err) {
    handleError(err);
  }
};


// ===== MODAL MES HISTORICO =====
window.abrirModalMesHistorico = function() {
  const selector = document.getElementById("selectorMesHistorico");
  if (selector && !selector.value) {
    const hoy = new Date();
    const mes = String(hoy.getMonth() + 1).padStart(2, "0");
    selector.value = `${hoy.getFullYear()}-${mes}`;
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById("modalMesHistorico")).show();
};

window.cargarResumenMesHistorico = async function() {
  const mes = document.getElementById("selectorMesHistorico")?.value;
  if (!mes) return;

  try {
    // Resumen ingresos/gastos/saldo
    const resp = await fetch(`${API_URL}/resumen/mensual?mes=${mes}`, {
      headers: getAuthHeaders()
    });
    if (!resp.ok) throw new Error("No se pudo obtener el resumen.");
    const { totalIngresos, totalGastos, saldo } = await resp.json();

    document.getElementById("historicoIngresos").textContent = `$${Number(totalIngresos).toLocaleString("es-AR")}`;
    document.getElementById("historicoGastos").textContent   = `$${Number(totalGastos).toLocaleString("es-AR")}`;

    const saldoEl = document.getElementById("historicoSaldo");
    saldoEl.textContent = `$${Number(saldo).toLocaleString("es-AR")}`;
    saldoEl.className = `fw-bold fs-5 mt-1 ${saldo < 0 ? "text-danger" : "text-success"}`;

    // Detalle gastos
    const respG = await fetch(`${API_URL}/gastos/detalle/${mes}`, {
      headers: getAuthHeaders()
    });
    const gastos = respG.ok ? await respG.json() : [];

    const tbody = document.getElementById("historicoGastosDetalle");
    tbody.innerHTML = gastos.length
      ? gastos.map(g => `
          <tr>
            <td>${new Date(g.fecha).toLocaleDateString("es-AR")}</td>
            <td>${escapeHtml(g.categoria)}</td>
            <td>${escapeHtml(g.descripcion) || "—"}</td>
            <td class="text-end">$${parseFloat(g.monto).toLocaleString("es-AR")}</td>
          </tr>
        `).join("")
      : '<tr><td colspan="4" class="text-center text-muted">Sin gastos registrados</td></tr>';

    document.getElementById("resumenMesHistorico").classList.remove("d-none");
    document.getElementById("historicoVacio").classList.add("d-none");

  } catch (error) {
    handleError(error);
  }
};


// ===== MODAL GASTOS DEL MES =====
window.abrirModalGastosMes = async function() {
  try {
    const mes = mesActualYYYYMM();
    const res = await fetch(`${API_URL}/gastos/detalle/${mes}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("No se pudieron obtener los gastos.");

    const gastos = await res.json();
    const tbody = document.getElementById("tablaGastosModal");
    const vacio = document.getElementById("gastosModalVacio");
    const total = document.getElementById("totalGastosModal");

    if (!gastos.length) {
      tbody.innerHTML = "";
      vacio?.classList.remove("d-none");
      if (total) total.textContent = "";
    } else {
      vacio?.classList.add("d-none");
      tbody.innerHTML = gastos.map(g => `
        <tr>
          <td>${new Date(g.fecha).toLocaleDateString("es-AR")}</td>
          <td>${g.categoria}</td>
          <td>${g.descripcion || "—"}</td>
          <td class="text-end">$${parseFloat(g.monto).toLocaleString("es-AR")}</td>
          <td>
            <button class="btn btn-sm btn-warning" onclick="editarGasto(${g.id})">✏️</button>
            <button class="btn btn-sm btn-danger" onclick="eliminarGastoModal(${g.id})">🗑️</button>
          </td>
        </tr>
      `).join("");

      const totalMonto = gastos.reduce((acc, g) => acc + parseFloat(g.monto || 0), 0);
      if (total) total.textContent = `Total: $${totalMonto.toLocaleString("es-AR")}`;
    }

    bootstrap.Modal.getOrCreateInstance(document.getElementById("modalGastosMes")).show();
  } catch (error) {
    handleError(error);
  }
};

window.eliminarGastoModal = async function(id) {
  const confirm = await Swal.fire({ didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; },
    title: "¿Eliminar gasto?",
    text: "Esta acción no se puede deshacer.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Sí, eliminar",
    cancelButtonText: "Cancelar"
  });
  if (!confirm.isConfirmed) return;

  try {
    const res = await fetch(`${API_URL}/gastos/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("No se pudo eliminar el gasto.");
    Swal.fire("Eliminado", "Gasto eliminado correctamente.", "success");
    await cargarResumenMensual();
    abrirModalGastosMes();
  } catch (error) {
    handleError(error);
  }
};


// ===== SELECTOR TIPO MOVIMIENTO =====
function seleccionarTipo(tipo) {
  const tipoSelect = document.getElementById("tipoMovimiento");
  const camposIngreso = document.getElementById("camposIngreso");
  const camposGasto = document.getElementById("camposGasto");
  const btnIngreso = document.getElementById("btnTipoIngreso");
  const btnGasto = document.getElementById("btnTipoGasto");

  if (tipoSelect) tipoSelect.value = tipo;

  const alumnoDocumento = document.getElementById("alumnoDocumento");
  const subscriptionType = document.getElementById("subscriptionType");
  const alumnoSearch = document.getElementById("alumnoSearch");

  if (tipo === "ingreso") {
    camposIngreso?.classList.remove("d-none");
    camposGasto?.classList.add("d-none");
    btnIngreso?.classList.add("btn-success");
    btnIngreso?.classList.remove("btn-outline-success");
    btnGasto?.classList.add("btn-outline-danger");
    btnGasto?.classList.remove("btn-danger");
    if (alumnoDocumento) alumnoDocumento.required = true;
    if (subscriptionType) subscriptionType.required = true;
    if (alumnoSearch) alumnoSearch.required = true;
  } else {
    camposIngreso?.classList.add("d-none");
    camposGasto?.classList.remove("d-none");
    btnGasto?.classList.add("btn-danger");
    btnGasto?.classList.remove("btn-outline-danger");
    btnIngreso?.classList.add("btn-outline-success");
    btnIngreso?.classList.remove("btn-success");
    if (alumnoDocumento) alumnoDocumento.required = false;
    if (subscriptionType) subscriptionType.required = false;
    if (alumnoSearch) alumnoSearch.required = false;
  }
}


// ===== MODAL MOVIMIENTOS =====
function aplicarFiltroMovimientosModal() {
  const nombre = document.getElementById("filtroMovNombreModal")?.value.toLowerCase().trim() || "";
  const mes    = document.getElementById("filtroMovMesModal")?.value || "";

  const filtrados = todosLosPagos.filter(p => {
    const matchNombre = !nombre || (p.fullName || "").toLowerCase().includes(nombre);
    const matchMes    = !mes    || (p.paymentDate || "").startsWith(mes);
    return matchNombre && matchMes;
  });

  const tbody = document.getElementById("clientPaymentsTableModal");
  const sinResultados = document.getElementById("filtroMovsSinResultadosModal");

  if (!tbody) return;

  if (!filtrados.length) {
    tbody.innerHTML = "";
    sinResultados?.classList.remove("d-none");
    return;
  }

  sinResultados?.classList.add("d-none");
  tbody.innerHTML = filtrados.map(p => `
    <tr>
      <td>${p.id}</td>
      <td>${p.fullName}</td>
      <td>${new Date(p.paymentDate).toLocaleDateString('es-AR')}</td>
      <td class="text-end">$${parseFloat(p.amount).toLocaleString('es-AR')}</td>
      <td>
        <button class="btn btn-sm btn-outline-secondary" title="Descargar recibo PDF" onclick="descargarRecibo(${p.id})">PDF</button>
        <button class="btn btn-sm btn-warning" onclick="editPayment(${p.id})">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="deletePayment(${p.id})">🗑️</button>
      </td>
    </tr>
  `).join('');
}

window.abrirModalMovimientos = function() {
  switchHistorialTab('movimientos');
  const modalEl = document.getElementById("modalHistorialAlumno");
  document.getElementById("modalHistorialNombre").textContent = "Todos los movimientos";
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
};


// ===== FILTRO TABLA MOVIMIENTOS =====
let todosLosPagos = [];

function aplicarFiltroMovimientos() {
  const nombre = document.getElementById("filtroMovNombre")?.value.toLowerCase().trim() || "";
  const mes    = document.getElementById("filtroMovMes")?.value || "";

  const filtrados = todosLosPagos.filter(p => {
    const matchNombre = !nombre || (p.fullName || "").toLowerCase().includes(nombre);
    const matchMes    = !mes    || (p.paymentDate || "").startsWith(mes);
    return matchNombre && matchMes;
  });

  const tbody = document.getElementById("clientPaymentsTableBody");
  const sinResultados = document.getElementById("filtroMovsSinResultados");

  if (!tbody) return;

  if (!filtrados.length) {
    tbody.innerHTML = "";
    sinResultados?.classList.remove("d-none");
    return;
  }

  sinResultados?.classList.add("d-none");
  tbody.innerHTML = filtrados.map(p => `
    <tr>
      <td>${p.id}</td>
      <td>${p.fullName}</td>
      <td>${new Date(p.paymentDate).toLocaleDateString('es-AR')}</td>
      <td class="text-end">$${parseFloat(p.amount).toLocaleString('es-AR')}</td>
      <td>
        <button class="btn btn-sm btn-outline-secondary" title="Descargar recibo PDF" onclick="descargarRecibo(${p.id})">PDF</button>
        <button class="btn btn-sm btn-warning" onclick="editPayment(${p.id})">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="deletePayment(${p.id})">🗑️</button>
      </td>
    </tr>
  `).join('');
}

// ✅ Variables globales
if (typeof mesActualMostrado === "undefined") { var mesActualMostrado = null; }
let chartSerieMensual = null;

// ✅ API URL:
// - En local: http://localhost:3000/api
// - En Contabo (Nginx): /api  (mismo dominio)
const API_URL = (() => {
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1") return "http://localhost:3005/api";
  return "/api";
})();

let _userRole = 'admin';

// Interceptor global: agrega credentials a todos los fetch hacia la API
const _origFetch = window.fetch.bind(window);
window.fetch = function(url, opts = {}) {
  if (typeof url === 'string' && (url.startsWith(API_URL) || url.includes('/api/'))) {
    opts = { ...opts, credentials: 'include' };
  }
  return _origFetch(url, opts);
};


// ===== FUNCIONES UTILES =====
function handleError(error, silent = false) {
  console.error(error.message || error);
  if (silent) {
    Swal.fire({
      toast: true, position: "bottom-end", icon: "warning",
      title: error.message || "Error al cargar datos",
      showConfirmButton: false, timer: 3500, timerProgressBar: true
    });
  } else {
    Swal.fire("Error", error.message || "Ocurrió un error.", "error");
  }
}

function getAuthHeaders() {
  return { "Content-Type": "application/json" };
}

function getAuthFetchOpts(extra = {}) {
  return { credentials: 'include', ...extra, headers: { ...getAuthHeaders(), ...(extra.headers || {}) } };
}

function toggleContainers(showApp) {
  document.getElementById("loginContainer").style.display = showApp ? "none" : "block";
  document.getElementById("appContainer").style.display = showApp ? "block" : "none";
}

// ===== CARGAR ALUMNOS EN SELECT =====
async function cargarAlumnos() {
  try {
    const resp = await fetch(`${API_URL}/students?limit=500`, { headers: getAuthHeaders() });
    if (!resp.ok) throw new Error("No se pudieron obtener los alumnos.");
    const data = await resp.json();
    const alumnos = Array.isArray(data) ? data : (data.students || []);
    // Precargar en el buscador del formulario de pago
    if (typeof _todosAlumnos !== 'undefined') {
      _todosAlumnos = alumnos.filter(a => a.activo == 1).sort((a,b) => a.nombre.localeCompare(b.nombre, 'es'));
    }
    // También llenar el select de asistencias si existe
    const selectAsist = document.getElementById('alumnoDocumento');
    if (selectAsist && selectAsist.tagName === 'SELECT') {
      selectAsist.innerHTML = '<option value="">Seleccioná un alumno</option>';
      alumnos.forEach(a => {
        selectAsist.innerHTML += `<option value="${a.documento}">${a.nombre} (${a.documento})</option>`;
      });
    }
  } catch (error) {
    handleError(error, true);
  }
}

// ===== ROL DE USUARIO =====
function applyRoleVisibility(role) {
  _userRole = role || 'admin';
  // Actualiza visibilidad del nav usando ROLE_PAGES del sistema anterior
  if (typeof aplicarPermisos === 'function') aplicarPermisos();
  // Oculta KPIs financieros del dashboard para no-admin
  document.querySelectorAll('.admin-only-kpi').forEach(el => {
    el.style.display = (_userRole !== 'admin') ? 'none' : '';
  });
}

// ===== VERIFICAR AUTENTICACIÓN =====
async function checkAuth() {
  try {
    const r = await fetch(`${API_URL}/students?limit=1`);
    if (r.status === 401 || r.status === 403) {
      toggleContainers(false);
      return false;
    }
    toggleContainers(true);
    try {
      const meRes = await fetch(`${API_URL}/me`);
      if (meRes.ok) {
        const me = await meRes.json();
        applyRoleVisibility(me.role);
      }
    } catch (_) {}
    return true;
  } catch (error) {
    console.error("Error verificando sesión:", error);
    toggleContainers(false);
    return false;
  }
}

// ===== LOGIN =====
async function login(event) {
  event.preventDefault();
  const email = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  if (!email || !password) {
    return Swal.fire("Error", "Usuario y contraseña requeridos.", "warning");
  }
  try {
    const response = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Error al iniciar sesión");

    toggleContainers(true);
    applyRoleVisibility(data.user?.role);

    if (typeof cargarResumenMensual === "function") await cargarResumenMensual();
    if (typeof cargarDashboard === "function") await cargarDashboard();
    if (typeof cargarPagos === "function") await cargarPagos();
    if (typeof cargarAlumnos === "function") await cargarAlumnos();
    if (typeof cargarSerieMensual === "function") {
      setTimeout(() => cargarSerieMensual(), 100);
    }
    if (typeof cargarTarjetasEstadoMes === "function") await cargarTarjetasEstadoMes();

    Swal.fire({ didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; },
      toast: true,
      position: "top-end",
      icon: "success",
      title: "Bienvenido",
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true
    });
  } catch (error) {
    handleError(error);
  }
}

// ===== HELPERS UI =====
function updateAmount() {
  const subscriptionType = document.getElementById("subscriptionType")?.value;
  const amountField = document.getElementById("monto");
  const contenedorMonto = document.getElementById("contenedorMonto");

  if (!subscriptionType || subscriptionType === "") {
    contenedorMonto.classList.remove("d-none");
    amountField.value = "";
    return;
  }

  if (amountField && contenedorMonto) {
    amountField.value = subscriptionType;
    contenedorMonto.classList.add("d-none");
  }
}

function mesActualYYYYMM() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function normalizar(str) {
  return (str || "").toString().toLowerCase().trim();
}

// ===== RENDER CARDS =====
function renderCards({ list, containerId, pageState, metaId, pageId, status }) {
  const perPage = pageState.perPage;
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  pageState.page = Math.min(pageState.page, totalPages);

  const start = (pageState.page - 1) * perPage;
  const chunk = list.slice(start, start + perPage);

  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = chunk.map(item => {
    const badgeClass = status === "pending" ? "badge-pending" : "badge-paid";
    const badgeText  = status === "pending" ? "Pendiente" : "Pagó";

    const extra = status === "paid"
      ? `<div class="sub">Monto mes: <b>$${Number(item.totalMes || 0).toLocaleString()}</b></div>
         <div class="sub">Último pago: ${item.ultimoPago || "—"}</div>
         <div class="sub">Doc: ${item.documento || "—"}</div>
         <div class="sub clases-${item.documento}">Clases este mes: ...</div>`
      : `<div class="sub">Doc: ${item.documento || "—"}</div>
         <div class="sub clases-${item.documento}">Clases este mes: ...</div>`;

    return `
      <div class="mini-card ${status === "paid" ? "paid" : "pending"}">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div class="name">${item.nombre}</div>
          <span class="badge-soft ${badgeClass}">${badgeText}</span>
        </div>
        ${extra}
        <div class="mt-2 d-flex gap-1">
          <button class="btn btn-sm btn-outline-primary"
            onclick="verHistorialAlumno('${item.documento || ""}')">
            Historial
          </button>
          <button class="btn btn-sm btn-outline-success"
            onclick="recordatorioWhatsapp('${item.nombre || ""}', '${item.telefono || ""}')">
            ${item.telefono ? "💬 WhatsApp" : "WhatsApp"}
          </button>
          <button class="btn btn-sm btn-outline-info"
            onclick="registrarAsistencia('${item.documento}')">
            Asistencia
          </button>
          <button class="btn btn-sm btn-outline-secondary"
            onclick="verAsistenciasAlumno('${item.documento}', '${item.nombre}')">
            📋
          </button>
          <button class="btn btn-sm btn-outline-primary"
            onclick="verPerfilAlumno('${item.documento}')">
            Perfil
          </button>
        </div>
      </div>
    `;
  }).join("");

  setTimeout(() => {
    chunk.forEach(item => {
      cargarClasesMes(item.documento);
    });
  }, 100);

  const meta = document.getElementById(metaId);
  if (meta) meta.textContent = `${total} alumnos · ${perPage} por página`;

  const pageEl = document.getElementById(pageId);
  if (pageEl) pageEl.textContent = `Página ${pageState.page} / ${totalPages}`;
}

const stateCards = {
  pendientes: { page: 1, perPage: 12, q: "" },
  pagaron:    { page: 1, perPage: 12, q: "" },
  raw: { pendientes: [], pagaron: [] }
};

// ===== TARJETAS ESTADO MES =====
async function cargarTarjetasEstadoMes() {
  try {
    const mes = mesActualYYYYMM();

    const [stResp, payResp] = await Promise.all([
      fetch(`${API_URL}/students?limit=500`, { headers: getAuthHeaders() }),
      fetch(`${API_URL}/payments?limit=500`, { headers: getAuthHeaders() })
    ]);

    if (!stResp.ok) throw new Error("No pude obtener students");
    if (!payResp.ok) throw new Error("No pude obtener payments");

    const stData   = await stResp.json();
    const students = Array.isArray(stData) ? stData : (stData.students || []);
    const payJson  = await payResp.json();
    const payments = Array.isArray(payJson.payments) ? payJson.payments : [];

    const pagosMes = payments.filter(p => (p.serviceMonth || "").trim() === mes);

    const map = new Map();
    for (const p of pagosMes) {
      const doc = (p.documento || "").toString().trim();
      if (!doc) continue;
      const prev = map.get(doc) || { totalMes: 0, ultimoPago: null };
      prev.totalMes += Number(p.amount || 0);
      const fecha = (p.paymentDate || "").toString();
      if (!prev.ultimoPago || fecha > prev.ultimoPago) prev.ultimoPago = fecha;
      map.set(doc, prev);
    }

    const pendientes = [];
    const pagaron = [];

    (Array.isArray(students) ? students : []).forEach(s => {
      if (!s.activo) return;
      const doc = (s.documento || "").toString().trim();
      const nombre = s.nombre || "(sin nombre)";
      const telefono = (s.telefono || "").toString().trim();
      const info = map.get(doc);
      if (info) {
        pagaron.push({ nombre, documento: doc, totalMes: info.totalMes, ultimoPago: info.ultimoPago, telefono });
      } else {
        pendientes.push({ nombre, documento: doc, telefono });
      }
    });

    pendientes.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    pagaron.sort((a, b) => (b.totalMes || 0) - (a.totalMes || 0));

    stateCards.raw.pendientes = pendientes;
    stateCards.raw.pagaron = pagaron;

    aplicarFiltrosYRender();
  } catch (err) {
    console.error(err);
  }
}

// ===== ALERTA PENDIENTES =====
function actualizarAlertaPendientes() {
  const pendientes = stateCards.raw.pendientes.length;
  const alerta = document.getElementById("alertaPendientes");
  const cantidad = document.getElementById("cantidadPendientes");

  if (!alerta || !cantidad) return;

  if (pendientes > 0) {
    alerta.classList.remove("d-none");
    cantidad.textContent = pendientes;
  } else {
    alerta.classList.add("d-none");
  }
}

// ===== FILTROS Y RENDER =====
function aplicarFiltrosYRender() {
  const qPen = normalizar(stateCards.pendientes.q);
  const qPag = normalizar(stateCards.pagaron.q);

  const listPen = stateCards.raw.pendientes.filter(x =>
    normalizar(x.nombre).includes(qPen) || normalizar(x.documento).includes(qPen)
  );
  const listPag = stateCards.raw.pagaron.filter(x =>
    normalizar(x.nombre).includes(qPag) || normalizar(x.documento).includes(qPag)
  );

  renderCards({ list: listPen, containerId: "pendientesCards", pageState: stateCards.pendientes, metaId: "pendientesMeta", pageId: "pendientesPage", status: "pending" });
  renderCards({ list: listPag, containerId: "pagaronCards",    pageState: stateCards.pagaron,    metaId: "pagaronMeta",    pageId: "pagaronPage",    status: "paid" });
}

// ===== CLASES DEL MES =====
async function cargarClasesMes(documento) {
  try {
    const resp = await fetch(`${API_URL}/abono/${documento}`, {
      headers: getAuthHeaders()
    });
    const data = await resp.json();
    const el = document.querySelector(`.clases-${documento}`);
    if (el) {
      const usadas = data.clases_usadas || 0;
      const total  = data.clases_abono  || 0;
      const restantes = data.restantes  || 0;
      if (total === 0 && usadas > 0) {
        el.innerHTML = `Clases: <b>${usadas}</b> · Plan personalizado`;
      } else if (total === 0) {
        el.innerHTML = `Sin abono registrado`;
      } else {
        el.innerHTML = `Clases: <b>${usadas} / ${total}</b> · Restantes: <b>${restantes}</b>`;
      }
    }
  } catch (err) {
    console.error("Error cargando clases", err);
  }
}

// ===== GASTOS MENSUALES =====
async function mostrarGastosMensuales() {
  try {
    const res = await fetch(`${API_URL}/gastos/por-mes`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("No se pudieron obtener los gastos mensuales");

    const data = await res.json();
    const container = document.getElementById("tablaGastosMensuales");

    container.innerHTML = data.map(row => {
      const mes   = row.mes ?? row.month ?? row.Month ?? row.periodo ?? row.period ?? row.mes_anio;
      const total = row.total ?? row.Total ?? row.suma ?? row.totalGastos ?? 0;
      return `
        <tr>
          <td>${mes}</td>
          <td class="text-end">$${parseFloat(total).toLocaleString("es-AR")}</td>
          <td>
            <button class="btn btn-outline-primary btn-sm" onclick="verDetalleGastos('${mes}')">Ver</button>
          </td>
        </tr>
      `;
    }).join("");
  } catch (error) {
    handleError(error);
  }
}

async function verDetalleGastos(mes) {
  const contenedor = document.getElementById("detalleGastosMensuales");
  if (mesActualMostrado === mes) {
    contenedor.style.display = "none";
    mesActualMostrado = null;
    return;
  }

  try {
    const res = await fetch(`${API_URL}/gastos/detalle/${mes}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("No se pudo obtener los detalles del gasto.");
    const data = await res.json();

    mesActualMostrado = mes;
    contenedor.style.display = "block";

    const cuerpo = document.getElementById("detalleGastosBody");
    cuerpo.innerHTML = "";

    data.forEach(gasto => {
      const fila = document.createElement("tr");
      fila.innerHTML = `
        <td>${new Date(gasto.fecha).toLocaleDateString("es-AR")}</td>
        <td>${gasto.categoria}</td>
        <td>${gasto.descripcion}</td>
        <td class="text-end">$${parseFloat(gasto.monto).toLocaleString("es-AR")}</td>
        <td>
          <button class="btn btn-sm btn-warning" onclick="editarGasto(${gasto.id})">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="eliminarGasto(${gasto.id}, '${mes}')">🗑️</button>
        </td>
      `;
      cuerpo.appendChild(fila);
    });
  } catch (error) {
    handleError(error);
  }
}

// ===== RESUMEN MENSUAL =====
async function cargarResumenMensual() {
  const ids = ["kpiIncome", "kpiGastos", "kpiSaldo"];
  ids.forEach(id => document.getElementById(id)?.classList.add("loading"));
  try {
    const response = await fetch(`${API_URL}/resumen/mensual`, {
      method: "GET",
      headers: getAuthHeaders()
    });
    if (!response.ok) throw new Error("No se pudo obtener el resumen mensual");

    const { totalIngresos, totalGastos, saldo } = await response.json();

    document.getElementById("kpiIncome").textContent = totalIngresos.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
    document.getElementById("kpiGastos").textContent = totalGastos.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
    document.getElementById("kpiSaldo").textContent  = saldo.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  } catch (error) {
    handleError(error);
  } finally {
    ids.forEach(id => document.getElementById(id)?.classList.remove("loading"));
  }
}

// ===== PAGOS =====
async function cargarPagos() {
  const tbody = document.getElementById("clientPaymentsTableBody");
  if (tbody) tbody.innerHTML = Array(4).fill('<tr>' + Array(5).fill('<td><div class="sk sk-line" style="width:80%"></div></td>').join('') + '</tr>').join('');
  try {
    const response = await fetch(`${API_URL}/payments`, {
      method: "GET",
      headers: getAuthHeaders()
    });
    if (!response.ok) throw new Error("No se pudieron obtener los pagos");

    const data = await response.json();

    if (tbody && Array.isArray(data.payments)) {
      const payments = [...data.payments];
      payments.sort((a, b) => (b.id || 0) - (a.id || 0));
      todosLosPagos = payments;
      aplicarFiltroMovimientos();
    }

  } catch (error) {
    handleError(error);
  }
}

// ===== RECIBO PDF =====
window.descargarRecibo = function(id) {
  const a = document.createElement("a");
  a.href = `${API_URL}/recibo/${id}`;
  a.download = `recibo-${id}.pdf`;
  a.click();
};

// ===== CRUD PAGOS =====
async function deletePayment(id) {
  const confirm = await Swal.fire({ didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; },
    title: "¿Eliminar pago?",
    text: "Esta acción no se puede deshacer.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Sí, eliminar",
    cancelButtonText: "Cancelar"
  });
  if (!confirm.isConfirmed) return;

  try {
    const response = await fetch(`${API_URL}/payments/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders()
    });
    if (!response.ok) throw new Error("No se pudo eliminar el pago");
    Swal.fire("Eliminado", "Pago eliminado correctamente.", "success");
    await cargarResumenMensual();
    await cargarPagos();
  } catch (error) {
    handleError(error);
  }
}

function seleccionarEstadoEP(btn) {
  document.querySelectorAll(".estado-chip-ep").forEach(b => {
    b.classList.remove("btn-success","btn-danger","btn-warning");
    b.classList.add("btn-outline-secondary");
  });
  const colorMap = { al_dia:"btn-success", debe:"btn-danger", le_debemos:"btn-warning" };
  btn.classList.remove("btn-outline-secondary","btn-outline-success","btn-outline-danger","btn-outline-warning");
  btn.classList.add(colorMap[btn.dataset.estado] || "btn-success");
  document.getElementById("ep-estadoDeuda").value = btn.dataset.estado;
}

async function editPayment(id) {
  window.currentPaymentId = id;
  try {
    const response = await fetch(`${API_URL}/payments/${id}`, { headers: getAuthHeaders() });
    if (!response.ok) throw new Error("No se pudo obtener el pago");
    const pago = await response.json();

    document.getElementById("ep-fullName").value = pago.fullName || "";
    document.getElementById("ep-documento").value = pago.documento || "";
    document.getElementById("ep-subscriptionType").value = pago.subscriptionType || "";
    document.getElementById("ep-amount").value = pago.amount || "";
    document.getElementById("ep-paymentDate").value = new Date(pago.paymentDate).toISOString().split("T")[0];
    const epComentarios = document.getElementById("ep-comentarios");
    if (epComentarios) epComentarios.value = pago.comentarios || "";

    // Pre-seleccionar chip de estado de deuda
    const estadoActual = pago.estadoDeuda || "al_dia";
    document.getElementById("ep-estadoDeuda").value = estadoActual;
    document.querySelectorAll(".estado-chip-ep").forEach(b => {
      const colorMap = { al_dia:"btn-success", debe:"btn-danger", le_debemos:"btn-warning" };
      const activo = b.dataset.estado === estadoActual;
      b.className = `btn btn-sm estado-chip-ep ${activo ? colorMap[b.dataset.estado] : "btn-outline-secondary"}`;
    });

    const modal = new bootstrap.Modal(document.getElementById("modalEditarPago"));
    modal.show();
  } catch (error) {
    handleError(error);
  }
}

async function guardarEditarPago() {
  const id = window.currentPaymentId;
  const fullName = document.getElementById("ep-fullName").value.trim();
  const subscriptionType = document.getElementById("ep-subscriptionType").value.trim();
  const amount = parseFloat(document.getElementById("ep-amount").value);
  const paymentDate = document.getElementById("ep-paymentDate").value;
  const estadoDeuda = document.getElementById("ep-estadoDeuda")?.value || "al_dia";
  const comentarios = document.getElementById("ep-comentarios")?.value?.trim() || "";

  if (!fullName || !subscriptionType || !paymentDate || isNaN(amount)) {
    return Swal.fire("Error", "Todos los campos son obligatorios.", "warning");
  }

  try {
    const res = await fetch(`${API_URL}/payments/${id}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify({ fullName, subscriptionType, amount, paymentDate, estadoDeuda, comentarios })
    });
    if (!res.ok) throw new Error("No se pudo actualizar el pago");

    bootstrap.Modal.getInstance(document.getElementById("modalEditarPago")).hide();
    await Swal.fire({ title: "Actualizado", text: "El pago se actualizó correctamente.", icon: "success", didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; } });
    await cargarResumenMensual();
    await cargarPagos();
    if (typeof cargarMovimientosExt === "function") await cargarMovimientosExt();
  } catch (error) {
    handleError(error);
  }
}

// ===== CRUD GASTOS =====
async function eliminarGasto(id, mes) {
  try {
    const confirm = await Swal.fire({ didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; },
      title: "¿Estás seguro?",
      text: "Este gasto será eliminado.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar"
    });
    if (!confirm.isConfirmed) return;

    const res = await fetch(`${API_URL}/gastos/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("No se pudo eliminar el gasto.");

    Swal.fire("¡Eliminado!", "El gasto fue eliminado correctamente.", "success");
    verDetalleGastos(mes);
  } catch (error) {
    handleError(error);
  }
}

async function editarGasto(id) {
  try {
    const res = await fetch(`${API_URL}/gastos/${id}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("No se pudo obtener el gasto para editar.");

    const gasto = await res.json();

    const { value: formValues } = await Swal.fire({ didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; },
      title: "Editar Gasto",
      html: `
        <input id="swal-fecha" class="swal2-input" type="date" value="${gasto.fecha.split("T")[0]}">
        <input id="swal-categoria" class="swal2-input" placeholder="Categoría" value="${gasto.categoria}">
        <input id="swal-descripcion" class="swal2-input" placeholder="Descripción" value="${gasto.descripcion}">
        <input id="swal-monto" class="swal2-input" type="number" placeholder="Monto" value="${gasto.monto}">
      `,
      focusConfirm: false,
      preConfirm: () => ({
        fecha: document.getElementById("swal-fecha").value,
        categoria: document.getElementById("swal-categoria").value,
        descripcion: document.getElementById("swal-descripcion").value,
        monto: parseFloat(document.getElementById("swal-monto").value)
      })
    });

    if (!formValues) return;

    const update = await fetch(`${API_URL}/gastos/${id}`, {
      method: "PUT",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(formValues)
    });
    if (!update.ok) throw new Error("No se pudo actualizar el gasto.");

    Swal.fire("Actualizado", "El gasto fue actualizado exitosamente", "success");
    const mes = gasto.fecha.slice(0, 7);
    verDetalleGastos(mes);
  } catch (error) {
    handleError(error);
  }
}

// ===== SERIE MENSUAL (GRÁFICO + TABLA) =====
function formatARS(n) {
  return Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

async function cargarSerieMensual(months = 12) {
  try {
    const resp = await fetch(`${API_URL}/resumen/serie?months=${months}`, {
      headers: getAuthHeaders()
    });
    if (!resp.ok) throw new Error("No se pudo obtener la serie mensual.");

    const { series } = await resp.json();
    const rows = Array.isArray(series) ? series : [];

    // Tabla
    const tbody = document.getElementById("tbodySerieMensual");
    if (tbody) {
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td data-label="Mes">${r.mes}</td>
          <td data-label="Ingresos" class="text-end">${formatARS(r.totalIngresos)}</td>
          <td data-label="Gastos" class="text-end">${formatARS(r.totalGastos)}</td>
          <td data-label="Saldo" class="text-end ${Number(r.saldo) < 0 ? "text-danger" : ""}">
            ${formatARS(r.saldo)}
          </td>
        </tr>
      `).join("");
    }

    // Gráfico
    const canvas = document.getElementById("chartSerieMensual");
    if (!canvas) {
      console.warn("Canvas chartSerieMensual no encontrado");
      return;
    }
    const ctx = canvas.getContext("2d");

    const labels   = rows.map(r => r.mes);
    const ingresos = rows.map(r => Number(r.totalIngresos || 0));
    const gastos   = rows.map(r => Number(r.totalGastos || 0));
    const saldo    = rows.map(r => Number(r.saldo || 0));

    if (chartSerieMensual) chartSerieMensual.destroy();

    chartSerieMensual = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Ingresos", data: ingresos },
          { label: "Gastos",   data: gastos },
          { label: "Saldo",    data: saldo, type: "line" }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: { y: { ticks: { callback: (v) => formatARS(v) } } }
      }
    });
  } catch (err) {
    console.error("Error cargando serie mensual:", err);
  }
}

// ===== DASHBOARD KPIs =====
let _dashPagaron   = [];
let _dashPendientes = [];

async function cargarDashboard() {
  try {
    const response = await fetch(`${API_URL}/dashboard`, { headers: getAuthHeaders() });
    if (!response.ok) throw new Error("No se pudo obtener el dashboard");
    const data = await response.json();

    _dashPagaron    = data.upcomingPayments || [];
    _dashPendientes = data.overduePayments  || [];

    const fmt = n => Number(n).toLocaleString('es-AR', { style:'currency', currency:'ARS', maximumFractionDigits:0 });

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    // Ingresos/gastos/saldo del mes desde el dashboard
    if (data.ingresosMes !== undefined) {
      set('kpiIncome', fmt(data.ingresosMes));
      set('kpiGastos',  fmt(data.gastosMes));
      const saldo = data.saldoMes;
      const elSaldo = document.getElementById('kpiSaldo');
      if (elSaldo) {
        elSaldo.textContent = fmt(saldo);
        elSaldo.style.color = saldo >= 0 ? 'var(--green)' : 'var(--danger)';
      }
    }

    set('kpiActivos',    _dashPagaron.length);
    set('kpiPendientes', _dashPendientes.length);
    set('kpiReservasHoy', data.reservasHoy ?? 0);

    const subHoy = document.getElementById('kpiReservasHoySub');
    if (subHoy) subHoy.textContent = data.reservasHoy === 1 ? 'reserva confirmada hoy' : 'reservas confirmadas hoy';

    // Alerta pendientes
    const alerta = document.getElementById('alertaPendientes');
    const cant   = document.getElementById('cantidadPendientes');
    if (alerta && _dashPendientes.length > 0) {
      alerta.classList.remove('d-none');
      if (cant) cant.textContent = _dashPendientes.length;
    } else if (alerta) {
      alerta.classList.add('d-none');
    }

    // Transferencias pendientes de confirmar (Opción C)
    if (typeof cargarTransferenciasPendientes === 'function') cargarTransferenciasPendientes();

    // Panel cobranza 1-10
    cargarPanelCobroMes(data.upcomingPayments?.length ?? 0, data.totalActivos ?? 0, data.ingresosMes ?? 0);
  } catch (error) {
    console.error("Error cargando dashboard:", error);
  }
}

async function cargarPanelCobroMes(pagaron, totalActivos, ingresosMes) {
  const panel    = document.getElementById('panelCobroMes');
  const contenido = document.getElementById('contenidoPanelCobro');
  if (!panel || !contenido) return;

  // Si no recibimos datos frescos, volvemos a buscar
  if (pagaron === undefined) {
    try {
      const resp = await fetch(`${API_URL}/dashboard`, { headers: getAuthHeaders() });
      const d = await resp.json();
      pagaron     = d.upcomingPayments?.length ?? 0;
      totalActivos = d.totalActivos ?? 0;
      ingresosMes  = d.ingresosMes  ?? 0;
    } catch { return; }
  }

  const hoyAR   = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const diaHoy  = parseInt(hoyAR.split('-')[2], 10);
  const pct     = totalActivos > 0 ? Math.min(100, Math.round((pagaron / totalActivos) * 100)) : 0;
  const sinPago = Math.max(0, totalActivos - pagaron);
  const fmt     = n => Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

  const enPeriodo = diaHoy >= 1 && diaHoy <= 10;
  const diasRestantes = enPeriodo ? (10 - diaHoy) : 0;

  let alertaPeriodo = '';
  if (enPeriodo) {
    alertaPeriodo = `<div class="alert alert-success py-2 mb-3" style="font-size:.85rem;">
      ✅ Estás en el período de cobro — quedan <strong>${diasRestantes} día${diasRestantes !== 1 ? 's' : ''}</strong> hasta el día 10.
    </div>`;
  } else if (diaHoy > 10) {
    const diasParaProx = 31 - diaHoy; // aprox
    alertaPeriodo = `<div class="alert alert-secondary py-2 mb-3" style="font-size:.85rem;">
      📅 Período de cobro: 1 al 10 de cada mes — el próximo comienza en ~${diasParaProx} días.
    </div>`;
  }

  const barColor = pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626';

  contenido.innerHTML = `
    ${alertaPeriodo}
    <div class="row g-3 mb-3 text-center">
      <div class="col-4">
        <div style="font-size:1.6rem;font-weight:700;color:#16a34a;">${pagaron}</div>
        <div style="font-size:.78rem;color:#6b7280;">Pagaron</div>
      </div>
      <div class="col-4">
        <div style="font-size:1.6rem;font-weight:700;color:#dc2626;">${sinPago}</div>
        <div style="font-size:.78rem;color:#6b7280;">Sin pago</div>
      </div>
      <div class="col-4">
        <div style="font-size:1.6rem;font-weight:700;color:#1d4ed8;">${totalActivos}</div>
        <div style="font-size:.78rem;color:#6b7280;">Activos</div>
      </div>
    </div>
    <div class="mb-2" style="font-size:.8rem;color:#6b7280;">Cobranza: <strong>${pct}%</strong></div>
    <div style="background:#e5e7eb;border-radius:8px;height:14px;overflow:hidden;margin-bottom:12px;">
      <div style="width:${pct}%;background:${barColor};height:100%;border-radius:8px;transition:width .4s;"></div>
    </div>
    <div class="d-flex align-items-center justify-content-between">
      <span style="font-size:.85rem;color:#6b7280;">Recaudado este mes: <strong>${fmt(ingresosMes)}</strong></span>
      ${sinPago > 0 ? `<button class="btn btn-sm btn-success" onclick="irAvisarSinPago()">💳 Avisar a ${sinPago} alumna${sinPago !== 1 ? 's' : ''}</button>` : '<span class="badge bg-success">¡Todas pagaron! 🎉</span>'}
    </div>`;

  panel.style.display = '';
}

function irAvisarSinPago() {
  // Va a la página de Avisos y pre-selecciona "Sin pago este mes"
  if (typeof saGoPage === 'function') saGoPage('avisos');
  setTimeout(() => {
    const radio = document.getElementById('avisoSinPago');
    if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
    const templateBtn = document.querySelector('[onclick="avisarTemplate(\'pago1al10\')"]');
    if (templateBtn) templateBtn.click();
  }, 400);
}

// ===== WHATSAPP =====
function recordatorioWhatsapp(nombre, telefono) {
  const mensaje = `Hola ${nombre}! Hace un rato que no te vemos... Necesitas algun horario en especial? Contanos para que puedas seguir entrenando con nosotros. Saludos, Bienestar es Movimiento Pilates`;
  const numero = telefono ? telefono.replace(/\D/g, "") : "";
  const url = numero
    ? `https://web.whatsapp.com/send/?phone=${numero}&text=${encodeURIComponent(mensaje)}&app_absent=0`
    : `https://web.whatsapp.com/send?text=${encodeURIComponent(mensaje)}`;
  window.open(url, "_blank");
}

window.verHistorialAlumno = async function(documento) {
  try {
    const response = await fetch(`${API_URL}/payments/buscar/${encodeURIComponent(documento)}`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) throw new Error("No se pudo obtener el historial.");

    const pagos = await response.json();

    const nombreEl = document.querySelector(`.clases-${documento}`);
    const card = nombreEl ? nombreEl.closest('.mini-card') : null;
    const nombre = card ? card.querySelector('.name')?.textContent?.trim() : documento;

    document.getElementById("modalHistorialNombre").textContent = nombre || documento;

    const tbody = document.getElementById("tablaHistorialModal");
    if (!pagos.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Sin pagos registrados</td></tr>';
    } else {
      tbody.innerHTML = pagos.map(p => '<tr><td>' + new Date(p.paymentDate).toLocaleDateString("es-AR") + '</td><td>' + p.subscriptionType + '</td><td class="text-end">$' + parseFloat(p.amount).toLocaleString("es-AR") + '</td><td>' + (p.comentarios || "") + '</td></tr>').join("");
    }

    const modalEl = document.getElementById("modalHistorialAlumno");
    bootstrap.Modal.getOrCreateInstance(modalEl).show();

  } catch (error) {
    handleError(error);
  }
};

function abrirPago(documento, nombre) {
  const docInput = document.getElementById("alumnoDocumento");
  if (docInput) docInput.value = documento;

  const nombreInput = document.getElementById("nombreAlumno");
  if (nombreInput) nombreInput.value = nombre;

  const form = document.getElementById("movimientoForm");
  if (form) form.scrollIntoView({ behavior: "smooth" });
}

// ===== ASISTENCIA =====
async function registrarAsistencia(documento) {
  try {
    const resp = await fetch(`${API_URL}/attendance`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ documento })
    });
    if (!resp.ok) throw new Error("No se pudo registrar asistencia");

    Swal.fire({ didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; }, icon: "success", title: "Asistencia registrada", timer: 1500, showConfirmButton: false });
  } catch (err) {
    console.error(err);
    Swal.fire({ didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; }, icon: "error", title: "Error", text: "No se pudo registrar asistencia" });
  }
}

// ===== PAGINACIÓN =====
function paginaSiguiente(tipo) {
  const state = tipo === "pagaron" ? stateCards.pagaron : stateCards.pendientes;
  const total = tipo === "pagaron" ? stateCards.raw.pagaron.length : stateCards.raw.pendientes.length;
  const totalPages = Math.ceil(total / state.perPage);
  if (state.page < totalPages) state.page++;
  aplicarFiltrosYRender();
}

function paginaAnterior(tipo) {
  const state = tipo === "pagaron" ? stateCards.pagaron : stateCards.pendientes;
  if (state.page > 1) state.page--;
  aplicarFiltrosYRender();
}

// ===== WIRE TARJETAS UI =====
function wireTarjetasUI() {
  const penPrev = document.getElementById("pendientesPrev");
  const penNext = document.getElementById("pendientesNext");
  const pagPrev = document.getElementById("pagaronPrev");
  const pagNext = document.getElementById("pagaronNext");

  if (penPrev) penPrev.onclick = () => { stateCards.pendientes.page = Math.max(1, stateCards.pendientes.page - 1); aplicarFiltrosYRender(); };
  if (penNext) penNext.onclick = () => { stateCards.pendientes.page += 1; aplicarFiltrosYRender(); };
  if (pagPrev) pagPrev.onclick = () => { stateCards.pagaron.page = Math.max(1, stateCards.pagaron.page - 1); aplicarFiltrosYRender(); };
  if (pagNext) pagNext.onclick = () => { stateCards.pagaron.page += 1; aplicarFiltrosYRender(); };

  const penSearch = document.getElementById("pendientesSearch");
  const pagSearch = document.getElementById("pagaronSearch");

  if (penSearch) penSearch.oninput = (e) => { stateCards.pendientes.q = e.target.value; stateCards.pendientes.page = 1; aplicarFiltrosYRender(); };
  if (pagSearch) pagSearch.oninput = (e) => { stateCards.pagaron.q = e.target.value; stateCards.pagaron.page = 1; aplicarFiltrosYRender(); };
}


// ===== DOM CONTENT LOADED =====
document.addEventListener("DOMContentLoaded", async () => {

  const tipoMovimientoSelect = document.getElementById("tipoMovimiento");
  const camposIngreso  = document.getElementById("camposIngreso");
  const camposGasto    = document.getElementById("camposGasto");
  const contenedorMonto = document.getElementById("contenedorMonto");
  const form = document.getElementById("movimientoForm");

  // Verificar sesión
  const autenticado = await checkAuth();

  if (autenticado) {
    if (typeof cargarResumenMensual     === "function") await cargarResumenMensual();
    if (typeof cargarDashboard          === "function") await cargarDashboard();
    if (typeof cargarPagos              === "function") await cargarPagos();
    if (typeof cargarAlumnos            === "function") await cargarAlumnos();
    if (typeof cargarSerieMensual       === "function") await cargarSerieMensual();
    if (typeof cargarTarjetasEstadoMes  === "function") await cargarTarjetasEstadoMes();
    if (typeof cargarSaludEstudio        === "function") await cargarSaludEstudio();
    if (typeof cargarReformers            === "function") await cargarReformers();
    if (typeof cargarInformeMes           === "function") await cargarInformeMes();
    if (typeof cargarPlanes               === "function") await cargarPlanes();
    if (typeof cargarFeriados             === "function") await cargarFeriados();
    wireTarjetasUI();
  }

  // ===== MODAL NUEVO ALUMNO =====
  const btnNuevoAlumno = document.getElementById("btnNuevoAlumno");
  if (btnNuevoAlumno) {
    btnNuevoAlumno.addEventListener("click", () => {
      const modalEl = document.getElementById("modalNuevoAlumno");
      if (!modalEl) { console.warn("Modal no encontrado"); return; }
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    });
  }

  window.cerrarModalAlumno = function () {
    const modalEl = document.getElementById("modalNuevoAlumno");
    if (!modalEl) return;
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
  };

  const formNuevoAlumno = document.getElementById('formNuevoAlumno');
  if (formNuevoAlumno) {
    formNuevoAlumno.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre            = document.getElementById('nombreAlumnoNuevo').value.trim();
      const documento         = document.getElementById('documentoAlumnoNuevo').value.trim();
      const email             = document.getElementById('emailAlumnoNuevo').value.trim();
      const telefono          = document.getElementById('telefonoAlumnoNuevo').value.trim();
      const fechaNacimiento   = document.getElementById('fechaNacimientoNuevo')?.value || null;

      if (!nombre || !documento) {
        return Swal.fire("Error", "Completá nombre y documento", "warning");
      }

      try {
        const resp = await fetch(`${API_URL}/students`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ nombre, documento, email, telefono, fechaNacimiento })
        });
        if (!resp.ok) {
          const data = await resp.json();
          throw new Error(data.error || "No se pudo guardar el alumno.");
        }
        Swal.fire("Guardado", "Alumno registrado correctamente", "success");
        cerrarModalAlumno();
        await cargarAlumnos();
        await cargarDashboard();
        await cargarPagos();
        await cargarResumenMensual();
        await cargarSerieMensual();
        await cargarTarjetasEstadoMes();
        wireTarjetasUI();
        actualizarAlertaPendientes();
        const select = document.getElementById('alumnoDocumento');
        select.value = documento;
      } catch (error) {
        handleError(error);
      }
    });
  }

  // ===== FORMULARIO MOVIMIENTOS =====
  if (form) {
    if (tipoMovimientoSelect) {
      tipoMovimientoSelect.addEventListener("change", () => {
        const tipo = tipoMovimientoSelect.value;
        const alumnoDocumento = document.getElementById("alumnoDocumento");
        const subscriptionType = document.getElementById("subscriptionType");
        const alumnoSearch = document.getElementById("alumnoSearch");

        if (tipo === "ingreso") {
          camposIngreso?.classList.remove("d-none");
          camposGasto?.classList.add("d-none");
          updateAmount();
          if (alumnoDocumento)   alumnoDocumento.required = true;
          if (subscriptionType)  subscriptionType.required = true;
          if (alumnoSearch)      alumnoSearch.required = true;
        } else {
          camposIngreso?.classList.add("d-none");
          camposGasto?.classList.remove("d-none");
          contenedorMonto?.classList.remove("d-none");
          if (alumnoDocumento)   alumnoDocumento.required = false;
          if (subscriptionType)  subscriptionType.required = false;
          if (alumnoSearch)      alumnoSearch.required = false;
        }
      });
    } else {
      console.warn("[UI] Falta #tipoMovimiento; se omite change listener.");
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const tipo  = tipoMovimientoSelect?.value || "ingreso";
      const fecha = document.getElementById("fecha")?.value;
      const monto = parseFloat(document.getElementById("monto")?.value);

      if (!fecha || isNaN(monto) || monto < 0) {
        return Swal.fire("Error", "Fecha y monto válidos son obligatorios.", "warning");
      }

      let data = {};
      let endpoint = "";

      if (tipo === "ingreso") {
        const alumnoSelect   = document.getElementById("alumnoDocumento");
        const subscriptionEl = document.getElementById("subscriptionType");

        if (!alumnoSelect || !subscriptionEl) {
          return Swal.fire("Error", "Faltan campos de ingreso en el formulario.", "warning");
        }

        const documento    = alumnoSelect.value;
        const nombreAlumno = document.getElementById('alumnoSearch')?.value?.trim() || alumnoSelect.options[alumnoSelect.selectedIndex]?.text?.split(" (")[0] || "";
        const subscriptionType = subscriptionEl.value;

        if (!documento || !subscriptionType) {
          return Swal.fire("Error", "Completá alumno y abono.", "warning");
        }

        const serviceMonth = document.getElementById("serviceMonth")?.value || "";
        const comentarios = document.getElementById("comentarioPago")?.value?.trim() || "";
        const metodoPago = document.getElementById("metodoPagoValue")?.value || "";
        const estadoDeuda = document.getElementById("estadoDeudaValue")?.value || "al_dia";
        data = { documento, fullName: nombreAlumno, subscriptionType, amount: monto, paymentDate: fecha, serviceMonth, comentarios, metodoPago, estadoDeuda };
        endpoint = "/payments";
      } else {
        const categoria  = document.getElementById("expenseCategory")?.value?.trim();
        const descripcion = document.getElementById("expenseDescription")?.value?.trim() || "";
        if (!categoria) return Swal.fire("Error", "Completá categoría del gasto.", "warning");

        data = { fecha, monto, categoria, descripcion };
        endpoint = "/gastos";
      }

      try {
        const response = await fetch(`${API_URL}${endpoint}`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify(data)
        });

        if (!response.ok) {
          let msg = "Error al guardar el movimiento.";
          try {
            const err = await response.json();
            msg = err.error || err.message || msg;
          } catch {}
          throw new Error(msg);
        }

        Swal.fire({ title: "Guardado", text: "Movimiento registrado con éxito.", icon: "success", didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; } });

        const tipoActual = tipoMovimientoSelect?.value || "ingreso";
        form.reset();
        if (tipoMovimientoSelect) {
          tipoMovimientoSelect.value = tipoActual;
          tipoMovimientoSelect.dispatchEvent(new Event("change"));
        }
        const fechaEl = document.getElementById("fecha");
        if (fechaEl) fechaEl.valueAsDate = new Date();
        document.getElementById("monto")?.focus();

        await cargarResumenMensual();
        await cargarPagos();
      } catch (error) {
        handleError(error);
      }
    });
  } else {
    console.warn("[UI] Falta #movimientoForm; no se pueden registrar listeners.");
  }

  // ===== LOGIN / LOGOUT =====
  document.getElementById("loginForm")?.addEventListener("submit", login);

  document.getElementById("logoutButton")?.addEventListener("click", () => {
    Swal.fire({ didOpen: () => { document.querySelector(".swal2-container").style.zIndex = "99999"; },
      title: "¿Cerrar sesión?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, cerrar sesión",
      cancelButtonText: "Cancelar"
    }).then(async result => {
      if (result.isConfirmed) {
        await fetch(`${API_URL}/logout`, { method: 'POST' });
        location.reload();
      }
    });
  });

  // ===== HISTORIAL =====
  document.getElementById('btnBuscarHistorial')?.addEventListener('click', async () => {
    const documento  = document.getElementById('inputDocumentoHistorial').value.trim();
    const contenedor = document.getElementById('historialPagosAlumno');
    const cuerpoTabla = document.getElementById('tablaHistorialPagos');

    if (!documento) {
      return Swal.fire("Falta el documento", "Ingresá un número de documento.", "warning");
    }

    try {
      const response = await fetch(`${API_URL}/payments/buscar/${encodeURIComponent(documento)}`, {
        headers: getAuthHeaders()
      });
      if (!response.ok) throw new Error("No se pudo obtener el historial.");

      const pagos = await response.json();
      if (!pagos.length) {
        contenedor.style.display = "none";
        return Swal.fire("Sin resultados", "No hay pagos registrados para ese documento.", "info");
      }

      contenedor.style.display = "block";
      cuerpoTabla.innerHTML = pagos.map(p => `
        <tr>
          <td>${new Date(p.paymentDate).toLocaleDateString("es-AR")}</td>
          <td>${p.subscriptionType}</td>
          <td class="text-end">$${parseFloat(p.amount).toLocaleString("es-AR")}</td>
          <td>${p.comentarios || ''}</td>
        </tr>
      `).join('');
    } catch (error) {
      contenedor.style.display = "none";
      handleError(error);
    }
  });

  // ===== FILTRO ALUMNOS MODAL =====
  document.getElementById("filtroAlumnosModal")?.addEventListener("input", renderTablaAlumnos);

  // ===== FILTROS MOVIMIENTOS MODAL =====
  document.getElementById("filtroMovNombreModal")?.addEventListener("input", aplicarFiltroMovimientosModal);
  document.getElementById("filtroMovMesModal")?.addEventListener("change", aplicarFiltroMovimientosModal);
  document.getElementById("btnLimpiarFiltroMovsModal")?.addEventListener("click", () => {
    const nombre = document.getElementById("filtroMovNombreModal");
    const mes    = document.getElementById("filtroMovMesModal");
    if (nombre) nombre.value = "";
    if (mes)    mes.value    = "";
    aplicarFiltroMovimientosModal();
  });

  // Botón Ver todo abre el modal
  document.getElementById("btnMovsVerTodo")?.addEventListener("click", abrirModalMovimientos);

  // ===== RECORDAR TODOS =====
  document.getElementById("btnRecordarTodos")?.addEventListener("click", () => {
    const pendientes = stateCards.raw.pendientes;
    if (!pendientes.length) return;

    const nombres = pendientes.map(a => a.nombre).join(", ");
    const mensaje = `Hola! Hace un rato que no te vemos... Necesitas algun horario en especial? Contanos para que puedas seguir entrenando con nosotros. Saludos, Bienestar es Movimiento Pilates`;
    window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, "_blank");
  });

});

// ============================================================
// SALUD DEL ESTUDIO
// ============================================================
async function cargarSaludEstudio() {
  try {
    const resp = await fetch(`${API_URL}/stats/salud`, { headers: getAuthHeaders() });
    if (!resp.ok) return;
    const d = await resp.json();

    // Score badge
    const scoreEl = document.getElementById('saludScore');
    if (scoreEl) {
      scoreEl.textContent = `Score ${d.score}/100`;
      scoreEl.className = 'badge fs-6 ' + (
        d.score >= 75 ? 'bg-success' :
        d.score >= 50 ? 'bg-warning text-dark' : 'bg-danger'
      );
    }

    // Descripcion
    const desc = document.getElementById('saludDescripcion');
    if (desc) {
      desc.textContent = d.score >= 75
        ? 'Estudio en excelente forma. Seguí así.'
        : d.score >= 50
        ? 'Base sólida con oportunidades sin activar.'
        : 'Hay puntos críticos que necesitan atención inmediata.';
    }

    // Cobranza
    const cob = d.tasa_cobranza;
    const cobEl = document.getElementById('saludCobranza');
    const cobBadge = document.getElementById('saludCobranzaBadge');
    if (cobEl) cobEl.textContent = cob + '%';
    if (cobBadge) {
      cobBadge.textContent = cob >= 75 ? 'Buena' : cob >= 50 ? 'Mejorable' : 'Critica';
      cobBadge.className = 'small fw-bold ' + (cob >= 75 ? 'text-success' : cob >= 50 ? 'text-warning' : 'text-danger');
    }

    // Margen
    const mg = d.margen;
    const mgEl = document.getElementById('saludMargen');
    const mgBadge = document.getElementById('saludMargenBadge');
    if (mgEl) mgEl.textContent = mg + '%';
    if (mgBadge) {
      mgBadge.textContent = mg >= 50 ? 'Muy bueno' : mg >= 30 ? 'Aceptable' : 'Bajo';
      mgBadge.className = 'small fw-bold ' + (mg >= 50 ? 'text-success' : mg >= 30 ? 'text-warning' : 'text-danger');
    }

    // Ticket promedio
    const tkEl = document.getElementById('saludTicket');
    const tkBadge = document.getElementById('saludTicketBadge');
    if (tkEl) tkEl.textContent = '$' + d.ticket_promedio.toLocaleString('es-AR');
    if (tkBadge) {
      const dispersion = d.ticket_max > 0
        ? Math.round((d.ticket_max - d.ticket_promedio) / d.ticket_max * 100) : 0;
      tkBadge.textContent = dispersion > 40 ? 'Muy disperso' : dispersion > 20 ? 'Disperso' : 'Uniforme';
      tkBadge.className = 'small fw-bold ' + (dispersion > 40 ? 'text-warning' : 'text-success');
    }

    // En riesgo
    const riesgoEl = document.getElementById('saludRiesgo');
    if (riesgoEl) {
      riesgoEl.textContent = d.en_riesgo;
      riesgoEl.className = 'fw-bold fs-5 ' + (d.en_riesgo > 5 ? 'text-danger' : d.en_riesgo > 0 ? 'text-warning' : 'text-success');
    }

    // Potencial
    const potEl = document.getElementById('saludPotencial');
    if (potEl) {
      potEl.textContent = '$' + d.potencial.total.toLocaleString('es-AR');
      potEl.className = 'fw-bold text-success';
    }

  } catch (err) {
    handleError(err, true);
  }
}

// ============================================================
// REFORMERS
// ============================================================
const RF_DAYS = ['Lun','Mar','Mié','Jue','Vie'];
const RF_HOURS = ['9h','10h','11h','12h','18h','19h'];
const RF_HORARIO_REAL = [0,1,2,3,4,5];
const RF_DEF_ON = {0:[0,1,2,7,8,9],1:[0,1,2,7,8,9],2:[0,1,2,7,8,9],3:[0,1,2,7,8,9],4:[0,1,2,7,8,9],5:[1,2,3]};

let rfSlots = {};

function rfInitSlots(horarioGuardado) {
  RF_DAYS.forEach((d,di) => {
    rfSlots[di] = {};
    RF_HOURS.forEach((h,hi) => {
      if (horarioGuardado && horarioGuardado[di] !== undefined) {
        rfSlots[di][hi] = horarioGuardado[di][hi];
      } else {
        rfSlots[di][hi] = RF_DEF_ON[di] && RF_DEF_ON[di].includes(hi);
      }
    });
  });
}

function rfBuildGrid() {
  const g = document.getElementById('rfHorario');
  if (!g) return;
  g.innerHTML = '';
  RF_DAYS.forEach((d,di) => {
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:3px;min-width:42px';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:11px;text-align:center;color:#888;padding-bottom:3px;font-weight:500';
    lbl.textContent = d;
    col.appendChild(lbl);
    RF_HOURS.forEach((h,hi) => {
      const s = document.createElement('div');
      s.style.cssText = 'height:24px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;cursor:pointer;user-select:none;border:1px solid transparent;transition:all .12s';
      s.textContent = h;
      rfSlotStyle(s, rfSlots[di][hi]);
      s.onclick = () => {
        rfSlots[di][hi] = !rfSlots[di][hi];
        rfSlotStyle(s, rfSlots[di][hi]);
        rfCalc();
      };
      col.appendChild(s);
    });
    g.appendChild(col);
  });
}

function rfSlotStyle(el, on) {
  if (on) {
    el.style.background = '#d1e7dd';
    el.style.borderColor = '#5DCAA5';
    el.style.color = '#085041';
    el.style.fontWeight = '500';
  } else {
    el.style.background = '#f8f9fa';
    el.style.borderColor = 'transparent';
    el.style.color = '#aaa';
    el.style.fontWeight = '400';
  }
}

function rfFmt(n) {
  return '$' + Math.round(n).toLocaleString('es-AR');
}

function rfCalc() {
  const refs    = parseInt(document.getElementById('rfCantidad')?.value) || 4;
  const precio  = parseInt(document.getElementById('rfPrecioClase')?.value) || 15000;
  const alq     = parseInt(document.getElementById('rfPrecioAlquiler')?.value) || 25000;
  const sueldo  = parseInt(document.getElementById('rfSueldoProfe')?.value) || 8000;
  const precio2 = parseInt(document.getElementById('rfPrecioProfe')?.value) || 15000;
  const alumnos = parseInt(document.getElementById('rfAlumnos')?.value) || 1;

  let total = 0, ocu = 0, dead = 0;
  RF_DAYS.forEach((d,di) => RF_HOURS.forEach((h,hi) => {
    total++;
    rfSlots[di][hi] ? ocu++ : dead++;
  }));

  const tRef = total * refs;
  const oRef = ocu * refs;
  const dRef = dead * refs;
  const pct  = tRef > 0 ? Math.round(oRef / tRef * 100) : 0;
  // Ocupacion real = sobre el horario de trabajo definido (no slots teoricos)

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('rfTotal',    tRef + 'hs');
  set('rfOcupadas', oRef + 'hs');
  set('rfMuertas',  dRef + 'hs');
  set('rfOcupacion', pct + '%');

  const aSem = dRef * alq;
  const aMes = aSem * 4.3;
  const bIng = dRef * alumnos * precio2;
  const bCos = dRef * sueldo;
  const bNet = bIng - bCos;
  const bMes = bNet * 4.3;

  set('rfAHs',  dRef + 'hs');
  set('rfASem', rfFmt(aSem));
  set('rfAMes', rfFmt(aMes));
  set('rfBIng', rfFmt(bIng) + '/sem');
  set('rfBCos', rfFmt(bCos) + '/sem');
  set('rfBNet', rfFmt(bNet) + '/sem');
  set('rfBMes', rfFmt(bMes));

  const aWins = aMes >= bMes;
  const tagA = document.getElementById('rfTagA');
  const tagB = document.getElementById('rfTagB');
  if (tagA) { tagA.textContent = aWins ? 'Recomendado' : 'Alternativa'; tagA.className = 'badge ' + (aWins ? 'bg-success' : 'bg-secondary'); }
  if (tagB) { tagB.textContent = !aWins ? 'Recomendado' : 'Alternativa'; tagB.className = 'badge ' + (!aWins ? 'bg-success' : 'bg-secondary'); }
}

function toggleConfigReformers() {
  const el = document.getElementById('configReformers');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function guardarConfigReformers() {
  const horario = {};
  RF_DAYS.forEach((d,di) => { horario[di] = {}; RF_HOURS.forEach((h,hi) => { horario[di][hi] = rfSlots[di][hi]; }); });

  const body = {
    cantidad:           parseInt(document.getElementById('rfCantidad')?.value) || 4,
    precio_clase:       parseInt(document.getElementById('rfPrecioClase')?.value) || 15000,
    precio_alquiler:    parseInt(document.getElementById('rfPrecioAlquiler')?.value) || 25000,
    sueldo_profe:       parseInt(document.getElementById('rfSueldoProfe')?.value) || 8000,
    precio_clase_profe: parseInt(document.getElementById('rfPrecioProfe')?.value) || 15000,
    alumnos_por_reformer: parseInt(document.getElementById('rfAlumnos')?.value) || 1,
    horario
  };

  try {
    const resp = await fetch(`${API_URL}/stats/reformers`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (resp.ok) {
      toggleConfigReformers();
      alert('Configuracion guardada');
    }
  } catch (err) {
    console.error('Error guardando reformers:', err);
  }
}

async function cargarReformers() {
  try {
    const resp = await fetch(`${API_URL}/stats/reformers`, { headers: getAuthHeaders() });
    if (!resp.ok) return;
    const d = await resp.json();

    if (d.cantidad) document.getElementById('rfCantidad').value = d.cantidad;
    if (d.precio_clase) document.getElementById('rfPrecioClase').value = d.precio_clase;
    if (d.precio_alquiler) document.getElementById('rfPrecioAlquiler').value = d.precio_alquiler;
    if (d.sueldo_profe) document.getElementById('rfSueldoProfe').value = d.sueldo_profe;
    if (d.precio_clase_profe) document.getElementById('rfPrecioProfe').value = d.precio_clase_profe;
    if (d.alumnos_por_reformer) document.getElementById('rfAlumnos').value = d.alumnos_por_reformer;

    rfInitSlots(d.horario);
    rfBuildGrid();
    rfCalc();
  } catch (err) {
    handleError(err, true);
    rfInitSlots(null);
    rfBuildGrid();
    rfCalc();
  }
}

// ============================================================
// NAVEGACION DIAGNOSTICO / DASHBOARD
// ============================================================
window.mostrarDiagnostico = function() {
  document.getElementById('paginaDashboard').style.display = 'none';
  document.getElementById('paginaDiagnostico').style.display = 'block';
  if (typeof cargarSaludEstudio === 'function') cargarSaludEstudio();
  if (typeof cargarReformers    === 'function') cargarReformers();
}

window.mostrarDashboard = function() {
  document.getElementById('paginaDiagnostico').style.display = 'none';
  document.getElementById('paginaDashboard').style.display = 'block';
}

// ============================================================
// MODAL TARJETAS ALUMNOS
// ============================================================
window.abrirModalTarjetas = function(tipo) {
  const renderLista = (containerId, lista, color) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = lista.length
      ? lista.map(n => `<div style="padding:7px 0;border-bottom:1px solid #f0eeff;font-size:13px;font-weight:500;">${n}</div>`).join('')
      : `<div class="text-muted text-center py-3" style="font-size:13px;">Sin registros</div>`;
  };
  renderLista('panelPendientesModal', _dashPendientes, 'var(--danger)');
  renderLista('panelPagaronModal',    _dashPagaron,    'var(--green)');
  switchTarjetas(tipo);
  const modal = new bootstrap.Modal(document.getElementById('modalTarjetasAlumnos'));
  modal.show();
}

window.switchTarjetas = function(tipo) {
  const panelP = document.getElementById('panelPendientesModal');
  const panelPa = document.getElementById('panelPagaronModal');
  const titulo = document.getElementById('modalTarjetasTitulo');
  if (tipo === 'pendientes') {
    panelP.style.display = 'block';
    panelPa.style.display = 'none';
    if (titulo) titulo.textContent = 'Pendientes este mes';
  } else {
    panelP.style.display = 'none';
    panelPa.style.display = 'block';
    if (titulo) titulo.textContent = 'Pagaron este mes';
  }
}

// ============================================================
// IMPORTAR NEOCITA
// ============================================================
window.switchTabImportar = function(tab, btn) {
  document.getElementById('tabImportarAsistencia').style.display = tab === 'asistencia' ? 'block' : 'none';
  document.getElementById('tabImportarClientes').style.display   = tab === 'clientes'   ? 'block' : 'none';
  document.getElementById('tabImportarReservas').style.display   = tab === 'reservas'   ? 'block' : 'none';
  document.querySelectorAll('#tabsImportar .nav-link').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

window.previewAgenda = async function() {
  const file = document.getElementById('csvAgenda').files[0];
  if (!file) return alert('Selecciona un archivo CSV primero');
  const form = new FormData();
  form.append('csv', file);
  const el = document.getElementById('previewAgenda');
  el.innerHTML = '<div class="text-muted small">Procesando...</div>';
  try {
    const resp = await fetch(`${API_URL}/importar/preview`, { method: 'POST', headers: getAuthHeadersUpload(), body: form });
    const d = await resp.json();
    if (!resp.ok) { el.innerHTML = `<div class="alert alert-danger">${d.error}</div>`; return; }
    document.getElementById('btnConfirmarAgenda').style.display = 'inline-block';
    el.innerHTML = `
      <div class="row g-2 mb-3">
        <div class="col-6 col-md-3"><div class="card border-0 bg-light p-2 text-center">
          <div class="small text-muted">Asistencias</div>
          <div class="fw-bold fs-5 text-success">${d.asistieron}</div>
        </div></div>
        <div class="col-6 col-md-3"><div class="card border-0 bg-light p-2 text-center">
          <div class="small text-muted">No asistieron</div>
          <div class="fw-bold fs-5 text-muted">${d.no_asistieron}</div>
        </div></div>
        <div class="col-6 col-md-3"><div class="card border-0 bg-light p-2 text-center">
          <div class="small text-muted">Reconocidos</div>
          <div class="fw-bold fs-5 text-success">${d.reconocidos}</div>
        </div></div>
        <div class="col-6 col-md-3"><div class="card border-0 bg-light p-2 text-center">
          <div class="small text-muted">No reconocidos</div>
          <div class="fw-bold fs-5 text-warning">${d.no_reconocidos}</div>
        </div></div>
      </div>
      <div class="small text-muted mb-2">Periodo: ${d.fechas_rango.desde} al ${d.fechas_rango.hasta}</div>
      ${d.muestra.length ? `
        <div class="small fw-bold mb-1">Muestra de asistencias a importar:</div>
        <div class="table-responsive"><table class="table table-sm table-striped mb-0">
          <thead><tr><th>Fecha</th><th>Hora</th><th>Alumno</th><th>Documento</th></tr></thead>
          <tbody>${d.muestra.map(r => `<tr><td>${r.fecha}</td><td>${r.hora}</td><td>${r.nombre}</td><td>${r.documento}</td></tr>`).join('')}</tbody>
        </table></div>` : ''}
      ${d.no_reconocidos_lista.length ? `
        <div class="small fw-bold mt-2 mb-1 text-warning">Alumnos no encontrados en el sistema:</div>
        <div class="table-responsive"><table class="table table-sm mb-0">
          <thead><tr><th>Documento</th><th>Nombre NeoCita</th></tr></thead>
          <tbody>${d.no_reconocidos_lista.map(r => `<tr><td>${r.documento}</td><td>${r.cliente}</td></tr>`).join('')}</tbody>
        </table></div>` : ''}
    `;
  } catch(err) {
    el.innerHTML = '<div class="alert alert-danger">Error procesando el archivo</div>';
  }
}

window.confirmarAgenda = async function() {
  if (!confirm('Confirmas la importacion de asistencias?')) return;
  const file = document.getElementById('csvAgenda').files[0];
  if (!file) return;
  const form = new FormData();
  form.append('csv', file);
  const el = document.getElementById('previewAgenda');
  try {
    const resp = await fetch(`${API_URL}/importar/confirmar`, { method: 'POST', headers: getAuthHeadersUpload(), body: form });
    const d = await resp.json();
    if (!resp.ok) { alert(d.error); return; }
    document.getElementById('btnConfirmarAgenda').style.display = 'none';
    el.innerHTML = `<div class="alert alert-success">${d.mensaje}</div>`;
    document.getElementById('csvAgenda').value = '';
  } catch(err) {
    alert('Error importando asistencias');
  }
}

window.importarClientes = async function() {
  const file = document.getElementById('csvClientes').files[0];
  if (!file) return alert('Selecciona un archivo CSV primero');
  if (!confirm('Esto actualizara email y WhatsApp de alumnos existentes y creara nuevos registros inactivos. Continuar?')) return;
  const form = new FormData();
  form.append('csv', file);
  const el = document.getElementById('resultadoClientes');
  el.innerHTML = '<div class="text-muted small">Procesando...</div>';
  try {
    const resp = await fetch(`${API_URL}/importar/clientes`, { method: 'POST', headers: getAuthHeadersUpload(), body: form });
    const d = await resp.json();
    el.innerHTML = resp.ok
      ? `<div class="alert alert-success">${d.mensaje}</div>`
      : `<div class="alert alert-danger">${d.error}</div>`;
  } catch(err) {
    el.innerHTML = '<div class="alert alert-danger">Error importando clientes</div>';
  }
}

window.previewReservas = async function() {
  const file = document.getElementById('csvReservas').files[0];
  if (!file) return alert('Seleccioná un archivo CSV primero');
  const form = new FormData();
  form.append('csv', file);
  const el = document.getElementById('previewReservas');
  el.innerHTML = '<div class="text-muted small">Procesando...</div>';
  document.getElementById('btnConfirmarReservas').style.display = 'none';
  try {
    const resp = await fetch(`${API_URL}/importar/agenda/preview`, { method: 'POST', headers: getAuthHeadersUpload(), body: form });
    const d = await resp.json();
    if (!resp.ok) { el.innerHTML = `<div class="alert alert-danger">${d.error}</div>`; return; }

    const colores = { documento: '#1D9E75', nombre_exacto: '#6D28D9', nombre_parcial: '#854F0B', no_encontrado: '#E24B4A' };
    const etiquetas = { documento: 'Por DNI', nombre_exacto: 'Nombre exacto', nombre_parcial: 'Nombre parcial', no_encontrado: 'No encontrado' };

    el.innerHTML = `
      <div class="d-flex gap-2 flex-wrap mb-3">
        <span class="badge" style="background:#1D9E75">${d.resumen.por_documento} por DNI</span>
        <span class="badge" style="background:#6D28D9">${d.resumen.por_nombre} por nombre</span>
        <span class="badge" style="background:#E24B4A">${d.resumen.no_encontrados} no encontrados</span>
        <span class="badge bg-secondary">${d.resumen.total} futuros en total</span>
      </div>
      <div style="max-height:340px;overflow-y:auto;border:1px solid #e9e4ff;border-radius:8px;">
        <table class="table table-sm mb-0" style="font-size:12px;">
          <thead style="position:sticky;top:0;background:#f8f7ff;">
            <tr><th>Fecha</th><th>Hora</th><th>Neocita</th><th>Sistema</th><th>Match</th></tr>
          </thead>
          <tbody>
            ${d.registros.map(r => `
              <tr>
                <td>${r.fechaISO}</td>
                <td>${r.hora}</td>
                <td>${r.cliente}</td>
                <td>${r.nombre_sistema || '<span class="text-danger">—</span>'}</td>
                <td><span style="font-size:11px;font-weight:600;color:${colores[r.metodo]}">${etiquetas[r.metodo]}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    if (d.resumen.por_documento + d.resumen.por_nombre > 0) {
      document.getElementById('btnConfirmarReservas').style.display = 'inline-block';
    }
  } catch(err) {
    el.innerHTML = '<div class="alert alert-danger">Error al procesar el archivo.</div>';
  }
}

window.confirmarReservas = async function() {
  const file = document.getElementById('csvReservas').files[0];
  if (!file) return;
  if (!confirm(`¿Confirmar la importación de reservas futuras? Los duplicados se ignorarán.`)) return;
  const form = new FormData();
  form.append('csv', file);
  const el = document.getElementById('previewReservas');
  try {
    const resp = await fetch(`${API_URL}/importar/agenda/confirmar`, { method: 'POST', headers: getAuthHeadersUpload(), body: form });
    const d = await resp.json();
    if (!resp.ok) { el.innerHTML = `<div class="alert alert-danger">${d.error}</div>`; return; }
    let html = `<div class="alert alert-success mb-2">${d.mensaje}</div>`;
    if (d.noEncontradosLista && d.noEncontradosLista.length > 0) {
      html += `<div style="border:1px solid #fce8e8;border-radius:8px;padding:12px;background:#fff9f9;">
        <div style="font-size:12px;font-weight:700;color:#a32d2d;margin-bottom:8px;">Alumnos no encontrados en el sistema (${d.noEncontradosLista.length}):</div>
        ${d.noEncontradosLista.map(n => `<div style="font-size:12px;padding:3px 0;border-bottom:1px solid #f0eeff;">${n}</div>`).join('')}
      </div>`;
    }
    el.innerHTML = html;
    document.getElementById('btnConfirmarReservas').style.display = 'none';
  } catch(err) {
    el.innerHTML = '<div class="alert alert-danger">Error al importar.</div>';
  }
}

function getAuthHeadersUpload() {
  return {};
}

// ============================================================
// INFORME DEL MES
// ============================================================
window.switchTabInforme = function(tab, btn) {
  document.getElementById('tabInformeSinPagar').style.display = tab === 'sinPagar' ? 'block' : 'none';
  document.getElementById('tabInformeSinVenir').style.display = tab === 'sinVenir' ? 'block' : 'none';
  document.querySelectorAll('#tabsInforme .nav-link').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function renderListaInforme(containerId, lista, tipo) {
  const el = document.getElementById(containerId);
  if (!lista.length) {
    el.innerHTML = '<div class="text-muted small py-2">No hay alumnos en esta categoria.</div>';
    return;
  }
  el.innerHTML = lista.map(a => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;border:0.5px solid var(--color-border-tertiary);margin-bottom:6px;background:var(--color-background-primary)">
      <div style="width:34px;height:34px;border-radius:50%;background:${tipo==='sinPagar'?'#FCEBEB':'#FAEEDA'};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:${tipo==='sinPagar'?'#791F1F':'#633806'};flex-shrink:0">
        ${(a.nombre||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:var(--color-text-primary)">${a.nombre || a.documento}</div>
        <div style="font-size:11px;color:var(--color-text-tertiary)">Doc: ${a.documento}</div>
      </div>
      ${a.telefono ? `
      <a href="https://wa.me/${a.telefono.replace(/\D/g,'')}" target="_blank"
        style="background:#E1F5EE;border:0.5px solid #5DCAA5;border-radius:6px;padding:4px 10px;font-size:11px;color:#085041;text-decoration:none;white-space:nowrap">
        WhatsApp
      </a>` : ''}
      ${tipo === 'sinPagar' ? `
      <button onclick="cobrarRapido('${a.documento}','${(a.nombre||'').replace(/'/g,"\\'")}');event.stopPropagation();"
        style="background:#6d28d9;border:none;border-radius:6px;padding:4px 10px;font-size:11px;color:#fff;white-space:nowrap;cursor:pointer;">
        Cobrar
      </button>` : ''}
    </div>
  `).join('');
}

window.cobrarRapido = function(documento, nombre) {
  document.getElementById('cobrarRapidoDoc').value   = documento;
  document.getElementById('cobrarRapidoNombre').textContent = nombre;
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  document.getElementById('cobrarRapidoFecha').value = hoy;
  // plan_4 por defecto
  const sel = document.getElementById('cobrarRapidoPlan');
  sel.value = 'plan_4';
  document.getElementById('cobrarRapidoMonto').value = '55000';
  new bootstrap.Modal(document.getElementById('modalCobrarRapido')).show();
};

// Sincronizar monto cuando cambia el plan
document.addEventListener('change', e => {
  if (e.target.id !== 'cobrarRapidoPlan') return;
  const opt = e.target.selectedOptions[0];
  if (opt) document.getElementById('cobrarRapidoMonto').value = opt.dataset.precio || '';
});

window.confirmarCobrarRapido = async function() {
  const documento = document.getElementById('cobrarRapidoDoc').value;
  const nombre    = document.getElementById('cobrarRapidoNombre').textContent;
  const plan      = document.getElementById('cobrarRapidoPlan').value;
  const monto     = parseFloat(document.getElementById('cobrarRapidoMonto').value);
  const fecha     = document.getElementById('cobrarRapidoFecha').value;
  if (!documento || !plan || !fecha || isNaN(monto)) return;
  try {
    const r = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: nombre, subscriptionType: plan, paymentDate: fecha, amount: monto, documento })
    });
    const d = await r.json();
    if (!r.ok) { alert(d.error || 'Error al registrar el pago.'); return; }
    bootstrap.Modal.getInstance(document.getElementById('modalCobrarRapido'))?.hide();
    await cargarInformeMes();
  } catch(e) { alert('Error de conexión.'); }
};

window.cargarInformeMes = async function() {
  try {
    const resp = await fetch(`${API_URL}/stats/informe-mes`, { headers: getAuthHeaders() });
    if (!resp.ok) return;
    const d = await resp.json();

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('infKpiSinPagar',    d.periodo_cobro_activo ? d.sin_pagar.length : '-');
    set('infKpiSinVenir',    d.sin_venir.length);
    set('infKpiNoVolvieron', d.no_volvieron);
    set('infKpiRegulares',   d.regulares);

    const sinPagarEl = document.getElementById('infKpiSinPagar');
    if (sinPagarEl && !d.periodo_cobro_activo) {
      sinPagarEl.style.color = '#888';
      sinPagarEl.title = 'El periodo de cobro empieza el dia 1 del mes';
    }

    const descEl = document.querySelector('#tabInformeSinPagar .text-muted');
    if (descEl) {
      descEl.textContent = d.periodo_cobro_activo
        ? 'Vinieron a clase este mes pero todavia no registraron pago. Contactarlos hoy.'
        : 'El periodo de cobro va del 1 al 10 de cada mes. Quedan ' + d.dias_para_cobro + ' dias para que empiece abril.';
    }

    renderListaInforme('listaSinPagar', d.sin_pagar, 'sinPagar');
    renderListaInforme('listaSinVenir', d.sin_venir, 'sinVenir');
  } catch (err) {
    handleError(err, true);
  }
}

// ============================================================
// PLANES Y PRECIOS
// ============================================================
let planesData = [];

async function cargarPlanes() {
  try {
    const resp = await fetch(`${API_URL}/planes`, { headers: getAuthHeaders() });
    if (!resp.ok) return;
    planesData = await resp.json();
    renderTablaPlanes();
  } catch (err) {
    handleError(err, true);
  }
}

function renderTablaPlanes() {
  const el = document.getElementById('tablaPlanes');
  if (!el) return;
  const fmt = n => '$' + Number(n).toLocaleString('es-AR');
  el.innerHTML = `
    <div class="table-responsive">
      <table class="table table-sm table-striped mb-0">
        <thead>
          <tr>
            <th>Plan</th>
            <th class="text-center">Clases</th>
            <th class="text-end">Precio</th>
            <th class="text-end">Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${planesData.map(p => `
            <tr>
              <td>
                <div class="fw-500" style="font-size:13px">${p.nombre}</div>
                <div style="font-size:11px;color:var(--color-text-tertiary)">${p.codigo}</div>
              </td>
              <td class="text-center">${p.clases || '—'}</td>
              <td class="text-end">${p.precio > 0 ? fmt(p.precio) : '—'}</td>
              <td class="text-end">
                <button class="btn btn-sm btn-outline-secondary" onclick="editarPlan('${p.codigo}')">Editar</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

window.abrirNuevoPlan = function() {
  document.getElementById('planEditCodigo').value = '';
  document.getElementById('planCodigo').value = '';
  document.getElementById('planCodigo').disabled = false;
  document.getElementById('planNombre').value = '';
  document.getElementById('planClases').value = '0';
  document.getElementById('planPrecio').value = '0';
  document.getElementById('modalNuevoPlanTitulo').textContent = 'Nuevo plan';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modalNuevoPlan')).show();
}

window.editarPlan = function(codigo) {
  const plan = planesData.find(p => p.codigo === codigo);
  if (!plan) return;
  document.getElementById('planEditCodigo').value = plan.codigo;
  document.getElementById('planCodigo').value = plan.codigo;
  document.getElementById('planCodigo').disabled = true;
  document.getElementById('planNombre').value = plan.nombre;
  document.getElementById('planClases').value = plan.clases;
  document.getElementById('planPrecio').value = plan.precio;
  document.getElementById('modalNuevoPlanTitulo').textContent = 'Editar plan';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modalNuevoPlan')).show();
}

window.guardarPlan = async function() {
  const editCodigo = document.getElementById('planEditCodigo').value;
  const codigo  = document.getElementById('planCodigo').value.trim();
  const nombre  = document.getElementById('planNombre').value.trim();
  const clases  = parseInt(document.getElementById('planClases').value) || 0;
  const precio  = parseFloat(document.getElementById('planPrecio').value) || 0;

  if (!nombre) return Swal.fire('Campo requerido', 'El nombre es obligatorio.', 'warning');

  try {
    let resp;
    if (editCodigo) {
      resp = await fetch(`${API_URL}/planes/${editCodigo}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ nombre, clases, precio })
      });
    } else {
      if (!codigo) return Swal.fire('Campo requerido', 'El código es obligatorio.', 'warning');
      resp = await fetch(`${API_URL}/planes`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ codigo, nombre, clases, precio })
      });
    }
    const d = await resp.json();
    if (!resp.ok) return Swal.fire('Error', d.error || 'Error guardando plan', 'error');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalNuevoPlan')).hide();
    Swal.fire({ toast:true, position:'top-end', icon:'success', title:'Plan guardado', showConfirmButton:false, timer:2000 });
    await cargarPlanes();
  } catch (err) {
    Swal.fire('Error', 'No se pudo guardar el plan.', 'error');
  }
}

// ============================================================
// PERFIL COMPLETO DEL ALUMNO
// ============================================================
window.verPerfilAlumno = async function(documento) {
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalPerfilAlumno'));
  document.getElementById('perfilNombre').textContent = 'Cargando...';
  document.getElementById('perfilDoc').textContent = '';
  document.getElementById('perfilBody').innerHTML = '<div class="text-center text-muted py-4">Cargando...</div>';
  modal.show();

  try {
    const resp = await fetch(`${API_URL}/students/${documento}/perfil`, { headers: getAuthHeaders() });
    if (!resp.ok) throw new Error('Error');
    const d = await resp.json();

    document.getElementById('perfilNombre').textContent = d.alumno.nombre;
    document.getElementById('perfilDoc').textContent = `Doc: ${d.alumno.documento}`;

    const fmt = n => '$' + Number(n).toLocaleString('es-AR');
    const tendenciaIcon = d.tendencia === 'subiendo' ? '↑' : d.tendencia === 'bajando' ? '↓' : '→';
    const tendenciaColor = d.tendencia === 'subiendo' ? '#085041' : d.tendencia === 'bajando' ? '#791F1F' : '#633806';

    const wappLink = d.alumno.telefono
      ? `<a href="https://wa.me/${d.alumno.telefono.replace(/\D/g,'')}" target="_blank"
           class="btn btn-sm" style="background:#E1F5EE;border:0.5px solid #5DCAA5;color:#085041">
           WhatsApp
         </a>` : '';

    const barraClases = d.mes_actual.clases_abono > 0
      ? `<div style="height:6px;background:#F1EFE8;border-radius:3px;margin-top:6px;overflow:hidden">
           <div style="height:100%;width:${Math.min(100, Math.round(d.mes_actual.clases_usadas/d.mes_actual.clases_abono*100))}%;background:#1D9E75;border-radius:3px"></div>
         </div>` : '';

    const asistMeses = d.asistencias_por_mes.map(a =>
      `<span style="font-size:12px;color:var(--color-text-secondary)">${a.mes.slice(5)}: <b>${a.clases}</b></span>`
    ).join(' · ');

    const ultimosPagos = d.ultimos_pagos.map(p => `
      <div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:0.5px solid var(--color-border-tertiary)">
        <span style="color:var(--color-text-secondary)">${p.mes_servicio} · ${p.plan || 'personalizado'}</span>
        <span style="font-weight:500">${fmt(p.monto)}</span>
      </div>
    `).join('');

    document.getElementById('perfilBody').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          ${d.alumno.email ? `<div style="font-size:12px;color:var(--color-text-secondary)">${d.alumno.email}</div>` : ''}
          ${d.alumno.telefono ? `<div style="font-size:12px;color:var(--color-text-secondary)">${d.alumno.telefono}</div>` : ''}
        </div>
        ${wappLink}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
        <div style="background:${d.mes_actual.pago_ok?'#E1F5EE':'#FCEBEB'};border-radius:8px;padding:12px">
          <div style="font-size:11px;font-weight:500;color:${d.mes_actual.pago_ok?'#0F6E56':'#A32D2D'}">Pago del mes</div>
          <div style="font-size:20px;font-weight:500;color:${d.mes_actual.pago_ok?'#085041':'#791F1F'}">${d.mes_actual.pago_ok ? fmt(d.mes_actual.pago_total) : 'Pendiente'}</div>
          ${d.mes_actual.ultimo_pago ? `<div style="font-size:11px;color:${d.mes_actual.pago_ok?'#0F6E56':'#A32D2D'}">${d.mes_actual.ultimo_pago}</div>` : ''}
        </div>
        <div style="background:var(--color-background-secondary);border-radius:8px;padding:12px">
          <div style="font-size:11px;font-weight:500;color:var(--color-text-secondary)">Clases del mes</div>
          ${d.mes_actual.personalizado
            ? `<div style="font-size:20px;font-weight:500">${d.mes_actual.clases_usadas}</div>
               <div style="font-size:11px;color:var(--color-text-secondary)">Plan personalizado</div>`
            : d.mes_actual.clases_abono > 0
              ? `<div style="font-size:20px;font-weight:500">${d.mes_actual.clases_usadas} / ${d.mes_actual.clases_abono}</div>
                 <div style="font-size:11px;color:var(--color-text-secondary)">${d.mes_actual.restantes} restantes</div>${barraClases}`
              : `<div style="font-size:20px;font-weight:500">${d.mes_actual.clases_usadas}</div>
                 <div style="font-size:11px;color:var(--color-text-secondary)">Sin abono registrado</div>`
          }
        </div>
      </div>

      <div style="margin-bottom:16px">
        <div style="font-size:12px;font-weight:500;color:var(--color-text-secondary);margin-bottom:6px">
          Tendencia <span style="color:${tendenciaColor}">${tendenciaIcon} ${d.tendencia}</span>
        </div>
        <div style="display:flex;gap:12px">${asistMeses}</div>
      </div>

      ${d.ultimos_pagos.length ? `
        <div>
          <div style="font-size:12px;font-weight:500;color:var(--color-text-secondary);margin-bottom:6px">Ultimos pagos</div>
          ${ultimosPagos}
        </div>` : ''}
    `;

  } catch (err) {
    document.getElementById('perfilBody').innerHTML = '<div class="alert alert-danger">Error cargando perfil</div>';
  }
}

async function eliminarPago(id) {
  const confirm = await Swal.fire({
    title: "¿Eliminar pago?",
    text: "Esta acción no se puede deshacer.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Sí, eliminar",
    cancelButtonText: "Cancelar",
    confirmButtonColor: "#E24B4A"
  });
  if (!confirm.isConfirmed) return;
  try {
    const r = await fetch(`${API_URL}/payments/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders()
    });
    if (!r.ok) throw new Error("No se pudo eliminar el pago");
    await Swal.fire({ title: "Eliminado", icon: "success", timer: 1200, showConfirmButton: false });
    await cargarResumenMensual();
    await cargarPagos();
    if (typeof cargarMovimientosExt === "function") cargarMovimientosExt();
  } catch(e) {
    Swal.fire("Error", e.message, "error");
  }
}

// ── CHIPS MÉTODO DE PAGO Y ESTADO ──
window.seleccionarMetodo = function(btn) {
  document.querySelectorAll(".metodo-chip").forEach(b => {
    b.classList.remove("btn-primary");
    b.classList.add("btn-outline-secondary");
  });
  btn.classList.remove("btn-outline-secondary");
  btn.classList.add("btn-primary");
  document.getElementById("metodoPagoValue").value = btn.dataset.metodo;
};

window.seleccionarEstado = function(btn) {
  document.querySelectorAll(".estado-chip").forEach(b => {
    b.classList.remove("btn-success","btn-danger","btn-warning");
    b.classList.add("btn-outline-secondary");
  });
  const colorMap = { al_dia: "btn-success", debe: "btn-danger", le_debemos: "btn-warning" };
  btn.classList.remove("btn-outline-secondary","btn-outline-success","btn-outline-danger","btn-outline-warning");
  btn.classList.add(colorMap[btn.dataset.estado] || "btn-success");
  document.getElementById("estadoDeudaValue").value = btn.dataset.estado;
};

// ============================================================
// FERIADOS
// ============================================================

// ── HORARIO SEMANAL ──
const AG_HORAS_TODAS = ['09:00','10:00','11:00','12:00','13:00','17:00','18:00','19:00','20:00'];
let _horarioSemanal = null;

window.abrirHorarioSemanal = async function() {
  if (!_horarioSemanal) {
    const r = await fetch(`${API_URL}/stats/agenda-horario`, { headers: getAuthHeaders() });
    _horarioSemanal = await r.json();
    window._horarioSemanal = _horarioSemanal;
  }
  switchTabHorario('1', document.querySelector('#tabsHorario .nav-link'));
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modalHorarioSemanal')).show();
};

window.switchTabHorario = function(dia, btn) {
  document.querySelectorAll('#tabsHorario .nav-link').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const horasAbiertas = (_horarioSemanal && _horarioSemanal[dia]) || AG_HORAS_TODAS;
  const panel = document.getElementById('horarioDiaPanel');
  panel.innerHTML = AG_HORAS_TODAS.map(h => {
    const abierto = horasAbiertas.includes(h);
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #f0eeff;">
      <span style="font-size:14px;font-weight:600;">${h}hs</span>
      <button type="button" id="hs-${dia}-${h.replace(':','')}"
        data-dia="${dia}" data-hora="${h}" data-estado="${abierto?'abierto':'cerrado'}"
        onclick="toggleHoraBase(this)"
        style="min-width:100px;padding:5px 16px;border-radius:6px;border:none;font-size:12px;font-weight:700;cursor:pointer;
          background:${abierto?'#e6f7f1':'#fce8e8'};color:${abierto?'#0f6e56':'#a32d2d'};">
        ${abierto?'ABIERTO':'CERRADO'}
      </button>
    </div>`;
  }).join('');
  panel.dataset.dia = dia;
};

window.toggleHoraBase = function(btn) {
  const abierto = btn.dataset.estado === 'abierto';
  btn.dataset.estado = abierto ? 'cerrado' : 'abierto';
  btn.style.background = abierto ? '#fce8e8' : '#e6f7f1';
  btn.style.color = abierto ? '#a32d2d' : '#0f6e56';
  btn.textContent = abierto ? 'CERRADO' : 'ABIERTO';
};

window.guardarHorarioSemanal = async function() {
  if (!_horarioSemanal) _horarioSemanal = {};
  ['1','2','3','4','5'].forEach(dia => {
    const btns = document.querySelectorAll(`[data-dia="${dia}"][data-hora]`);
    if (!btns.length) return;
    _horarioSemanal[dia] = [...btns].filter(b => b.dataset.estado === 'abierto').map(b => b.dataset.hora);
  });
  await fetch(`${API_URL}/stats/agenda-horario`, {
    method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(_horarioSemanal)
  });
  window._horarioSemanal = _horarioSemanal;
  bootstrap.Modal.getInstance(document.getElementById('modalHorarioSemanal')).hide();
  if (typeof agRenderDia === 'function' && window._agFecha) agRenderDia(window._agFecha);
};

// ── CONFIG AGENDA SIDEBAR ──

window.toggleConfigAgenda = function() {
  const panel = document.getElementById('agConfigPanel');
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (!visible) {
    cargarListaBloques();
    renderHorasGrid();
    document.getElementById('agBloqueTipo').onchange = function() {
      document.getElementById('agBloqueHorasPanel').style.display = this.value === 'horas' ? 'block' : 'none';
    };
  }
};

function renderHorasGrid() {
  const grid = document.getElementById('agBloqueHorasGrid');
  if (!grid) return;
  grid.innerHTML = AG_HORAS_TODAS.map(h => `
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding:3px 6px;border-radius:5px;background:#f5f4ff;">
      <input type="checkbox" value="${h}" style="cursor:pointer;"> ${h}hs
    </label>`).join('');
}

window.guardarBloqueAgenda = async function() {
  const fecha  = document.getElementById('agBloqueeFecha').value;
  const motivo = document.getElementById('agBloqueMotivo').value.trim();
  const tipo   = document.getElementById('agBloqueTipo').value;
  if (!fecha || !motivo) return alert('Completá fecha y motivo.');

  if (tipo === 'horas') {
    const horasCerradas = [...document.querySelectorAll('#agBloqueHorasGrid input:checked')].map(i => i.value);
    if (!horasCerradas.length) return alert('Seleccioná al menos una hora a cerrar.');
    const horasAbiertas = AG_HORAS_TODAS.filter(h => !horasCerradas.includes(h));
    // Guardar como feriado tipo cierre con horas abiertas
    await fetch(`${API_URL}/admin/feriados`, {
      method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fecha, nombre: motivo, tipo: 'cierre', motivo })
    });
    await fetch(`${API_URL}/admin/feriados/${fecha}/horas`, {
      method: 'PUT', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ horas: horasAbiertas })
    });
  } else {
    await fetch(`${API_URL}/admin/feriados`, {
      method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fecha, nombre: motivo, tipo: 'cierre', motivo })
    });
  }

  document.getElementById('agBloqueeFecha').value = '';
  document.getElementById('agBloqueMotivo').value = '';
  cargarListaBloques();
  if (_agFecha === fecha) agRenderDia(fecha);
};

async function cargarListaBloques() {
  const cont = document.getElementById('agListaBloques');
  if (!cont) return;
  const hoy = hoyAR();
  const resp = await fetch(`${API_URL}/admin/feriados`, { headers: getAuthHeaders() });
  const lista = await resp.json();
  const proximos = lista.filter(f => f.fecha >= hoy).slice(0, 8);
  if (!proximos.length) { cont.innerHTML = '<div style="font-size:12px;color:var(--muted);">Sin cierres próximos.</div>'; return; }
  cont.innerHTML = proximos.map(f => {
    const d = new Date(f.fecha + 'T12:00:00-03:00');
    const label = d.toLocaleDateString('es-AR', { day:'numeric', month:'short' });
    const icono = f.tipo === 'cierre' ? '🔒' : '🗓️';
    return `<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid #f0eeff;font-size:12px;">
      <span>${icono}</span>
      <div style="flex:1;"><div style="font-weight:600;">${f.nombre}</div><div style="color:var(--muted);font-size:10px;">${label}</div></div>
      <button onclick="eliminarFeriado('${f.fecha}')" style="background:none;border:none;color:#a32d2d;font-size:13px;cursor:pointer;padding:0 4px;">✕</button>
    </div>`;
  }).join('');
}

window.seleccionarHorasFeriado = async function(fecha) {
  const horas = ['09:00','10:00','11:00','12:00','13:00','17:00','18:00','19:00','20:00'];
  const seleccionadas = new Set();

  const horasHtml = horas.map(h => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0eeff;">
      <span style="font-size:14px;font-weight:600;">${h}hs</span>
      <button type="button" id="btn-hora-${h.replace(':','')}"
        onclick="toggleHoraFeriado('${h}')"
        style="min-width:90px;padding:4px 14px;border-radius:6px;border:none;font-size:12px;font-weight:700;background:#fce8e8;color:#a32d2d;cursor:pointer;">
        CERRADO
      </button>
    </div>`).join('');

  await Swal.fire({
    title: 'Horas habilitadas este feriado',
    html: `<div style="text-align:left;">${horasHtml}</div>`,
    showCancelButton: true,
    confirmButtonText: 'Guardar',
    cancelButtonText: 'Cancelar',
    didOpen: () => {
      document.querySelector('.swal2-container').style.zIndex = '99999';
      window._feriadoHorasSet = new Set();
      window.toggleHoraFeriado = function(h) {
        const btn = document.getElementById(`btn-hora-${h.replace(':','')}`);
        if (window._feriadoHorasSet.has(h)) {
          window._feriadoHorasSet.delete(h);
          btn.style.background = '#fce8e8'; btn.style.color = '#a32d2d'; btn.textContent = 'CERRADO';
        } else {
          window._feriadoHorasSet.add(h);
          btn.style.background = '#e6f7f1'; btn.style.color = '#0f6e56'; btn.textContent = 'ABIERTO';
        }
      };
    },
    preConfirm: () => [...window._feriadoHorasSet]
  }).then(async result => {
    if (!result.isConfirmed) return;
    const horasSeleccionadas = result.value;
    await fetch(`${API_URL}/admin/feriados/${fecha}/horas`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ horas: horasSeleccionadas })
    });
    agRenderDia(fecha);
  });
};

window.habilitarFeriado = async function(fecha) {
  if (!confirm('¿Habilitar el estudio para este feriado?')) return;
  await fetch(`${API_URL}/admin/feriados/${fecha}`, { method: 'PUT', headers: getAuthHeaders() });
  agRenderDia(fecha);
};

window.cargarFeriados = async function() {
  const cont = document.getElementById('tablaFeriados');
  if (!cont) return;
  const resp = await fetch(`${API_URL}/admin/feriados`, { headers: getAuthHeaders() });
  const lista = await resp.json();
  if (!lista.length) { cont.innerHTML = '<div class="text-muted small py-2">No hay feriados cargados.</div>'; return; }
  cont.innerHTML = lista.map(f => {
    const fechaFmt = new Date(f.fecha + 'T12:00:00-03:00').toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0eeff;">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;">${f.nombre}</div>
        <div style="font-size:11px;color:var(--muted);">${fechaFmt}</div>
      </div>
      <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;background:${f.habilitado?'#e6f7f1':'#fff8e1'};color:${f.habilitado?'#0f6e56':'#7a4f00'};">${f.habilitado?'Habilitado':'Cerrado'}</span>
      <button onclick="toggleFeriado('${f.fecha}')" style="background:#f5f4ff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;color:var(--accent);">${f.habilitado?'Cerrar':'Habilitar'}</button>
      <button onclick="eliminarFeriado('${f.fecha}')" style="background:#fce8e8;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;color:#a32d2d;">✕</button>
    </div>`;
  }).join('');
};

window.toggleFeriado = async function(fecha) {
  await fetch(`${API_URL}/admin/feriados/${fecha}`, { method: 'PUT', headers: getAuthHeaders() });
  cargarFeriados();
};

window.eliminarFeriado = async function(fecha) {
  if (!confirm('¿Eliminar este feriado?')) return;
  await fetch(`${API_URL}/admin/feriados/${fecha}`, { method: 'DELETE', headers: getAuthHeaders() });
  cargarFeriados();
};

window.agregarFeriado = async function() {
  const fecha = document.getElementById('nuevoFeriadoFecha')?.value;
  const nombre = document.getElementById('nuevoFeriadoNombre')?.value?.trim();
  if (!fecha || !nombre) return alert('Completá fecha y nombre.');
  await fetch(`${API_URL}/admin/feriados`, {
    method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha, nombre })
  });
  document.getElementById('nuevoFeriadoFecha').value = '';
  document.getElementById('nuevoFeriadoNombre').value = '';
  cargarFeriados();
};
