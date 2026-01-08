// ✅ Variables globales
if (typeof mesActualMostrado === "undefined") { var mesActualMostrado = null; }

// ✅ API URL:
// - En local: http://localhost:3000/api
// - En Contabo (Nginx): /pilates/api  (mismo dominio, bajo /pilates)
const API_URL = (() => {
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1") return "http://localhost:3000/api";
  return "/api";
})();




// ===== FUNCIONES UTILES =====
function handleError(error) {
  console.error(error.message || error);
  Swal.fire("Error", error.message || "Ocurrió un error.", "error");
}

function getAuthHeaders() {
  const token = sessionStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  };
}

function toggleContainers(showApp) {
  document.getElementById("loginContainer").style.display = showApp ? "none" : "block";
  document.getElementById("appContainer").style.display = showApp ? "block" : "none";
}

// 🚩 Cargar alumnos en el select para pagos
async function cargarAlumnos() {
  try {
    const resp = await fetch(`${API_URL}/students`, {
      headers: getAuthHeaders()
    });
    if (!resp.ok) throw new Error("No se pudieron obtener los alumnos.");
    const alumnos = await resp.json();
    const select = document.getElementById('alumnoDocumento');
    select.innerHTML = '<option value="">Seleccioná un alumno</option>';
    alumnos.forEach(alumno => {
      select.innerHTML += `<option value="${alumno.documento}">${alumno.nombre} (${alumno.documento})</option>`;
    });
  } catch (error) {
    handleError(error);
  }
}

async function checkAuth() {
  const token = sessionStorage.getItem("token");
  if (!token) {
    toggleContainers(false);
    return false;
  }
  try {
    const response = await fetch(`${API_URL}/dashboard`, {
      method: "GET",
      headers: getAuthHeaders()
    });
    if (!response.ok) throw new Error("Token inválido");
    toggleContainers(true);
    return true;
  } catch (error) {
    sessionStorage.removeItem("token");
    toggleContainers(false);
    return false;
  }
}

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
    sessionStorage.setItem("token", data.token);
    Swal.fire("Bienvenido", "Inicio de sesión exitoso", "success").then(() => location.reload());
  } catch (error) {
    handleError(error);
  }
}

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

// ====== CARGA INICIAL =======
document.addEventListener("DOMContentLoaded", async () => {
  const tipoMovimientoSelect = document.getElementById("tipoMovimiento");
  const camposIngreso = document.getElementById("camposIngreso");
  const camposGasto = document.getElementById("camposGasto");
  const contenedorMonto = document.getElementById("contenedorMonto");
  const form = document.getElementById("movimientoForm");

  // Muestra el modal
  const btnNuevoAlumno = document.getElementById('btnNuevoAlumno');
  if (btnNuevoAlumno) {
    btnNuevoAlumno.addEventListener('click', () => {
      document.getElementById('modalNuevoAlumno').style.display = 'block';
    });
  }

  // Oculta el modal
  window.cerrarModalAlumno = function() {
    document.getElementById('modalNuevoAlumno').style.display = 'none';
  }

  // Evento para guardar nuevo alumno
  const formNuevoAlumno = document.getElementById('formNuevoAlumno');
  if (formNuevoAlumno) {
    formNuevoAlumno.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = document.getElementById('nombreAlumnoNuevo').value.trim();
      const documento = document.getElementById('documentoAlumnoNuevo').value.trim();
      const email = document.getElementById('emailAlumnoNuevo').value.trim();
      const telefono = document.getElementById('telefonoAlumnoNuevo').value.trim();

      if (!nombre || !documento) {
        return Swal.fire("Error", "Completá nombre y documento", "warning");
      }

      try {
        const resp = await fetch(`${API_URL}/students`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            nombre,
            documento,
            email,
            telefono
          })
        });
        if (!resp.ok) {
          const data = await resp.json();
          throw new Error(data.error || "No se pudo guardar el alumno.");
        }
        Swal.fire("Guardado", "Alumno registrado correctamente", "success");
        cerrarModalAlumno();
        await cargarAlumnos(); // Recarga la lista de alumnos
        // Opcional: selecciona el alumno recién cargado
        const select = document.getElementById('alumnoDocumento');
        select.value = documento;
      } catch (error) {
        handleError(error);
      }
    });
  }
tipoMovimientoSelect.addEventListener("change", () => {
  const tipo = tipoMovimientoSelect.value;
  const alumnoDocumento = document.getElementById("alumnoDocumento");
  const subscriptionType = document.getElementById("subscriptionType");

  if (tipo === "ingreso") {
    camposIngreso.classList.remove("d-none");
    camposGasto.classList.add("d-none");
    updateAmount();
    // ✅ Activa required SOLO si es ingreso
    if (alumnoDocumento) alumnoDocumento.required = true;
    if (subscriptionType) subscriptionType.required = true;
  } else {
    camposIngreso.classList.add("d-none");
    camposGasto.classList.remove("d-none");
    contenedorMonto.classList.remove("d-none");
    // ✅ Quita required si es gasto
    if (alumnoDocumento) alumnoDocumento.required = false;
    if (subscriptionType) subscriptionType.required = false;
  }
});


  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const tipo = tipoMovimientoSelect.value;
    const fecha = document.getElementById("fecha").value;
    const monto = parseFloat(document.getElementById("monto").value);

    if (!fecha || isNaN(monto) || monto <= 0) {
      return Swal.fire("Error", "Fecha y monto válidos son obligatorios.", "warning");
    }

    let data = { fecha, monto };
    let endpoint = "";

    if (tipo === "ingreso") {
      const alumnoSelect = document.getElementById("alumnoDocumento");
      const documento = alumnoSelect.value;
      const nombreAlumno = alumnoSelect.options[alumnoSelect.selectedIndex].text.split(' (')[0];
      const subscriptionType = document.getElementById("subscriptionType").value;

      if (!documento || !subscriptionType) {
        return Swal.fire("Error", "Completá alumno y abono.", "warning");
      }

      data = {
        fullName: nombreAlumno,
        documento,
        subscriptionType,
        paymentDate: fecha,
        amount: monto
      };
      endpoint = "/payments";
    } else {
      const categoria = document.getElementById("expenseCategory").value.trim();
      const descripcion = document.getElementById("expenseDescription").value.trim();

      if (!categoria || !descripcion) {
        return Swal.fire("Error", "Completá categoría y descripción.", "warning");
      }

      data = {
        categoria,
        descripcion,
        fecha,
        monto
      };
      endpoint = "/gastos";
    }

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(data)
      });

      if (!response.ok) throw new Error("Error al guardar el movimiento.");
      Swal.fire("Guardado", "Movimiento registrado con éxito.", "success");

      form.reset();
      tipoMovimientoSelect.dispatchEvent(new Event("change"));
      await cargarResumenMensual();
      await cargarPagos();
    } catch (error) {
      handleError(error);
    }
  });

  const isAuthenticated = await checkAuth();
if (isAuthenticated) {
  await cargarAlumnos(); 
  await cargarResumenMensual();
  await cargarPagos();
  await mostrarGastosMensuales();

  // 🔹 NUEVO: cargar informe mes a mes
  await cargarSerieMensual(12);

  // 🔹 NUEVO: cambiar cantidad de meses
  document.getElementById("selectMesesSerie")?.addEventListener("change", async (e) => {
    await cargarSerieMensual(parseInt(e.target.value, 10));
  });
}


  document.getElementById("loginForm")?.addEventListener("submit", login);
  document.getElementById("logoutButton")?.addEventListener("click", () => {
    Swal.fire({
      title: "¿Cerrar sesión?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, cerrar sesión",
      cancelButtonText: "Cancelar"
    }).then(result => {
      if (result.isConfirmed) {
        sessionStorage.removeItem("token");
        Swal.fire({
          toast: true,
          position: "top-end",
          icon: "success",
          title: "Sesión cerrada correctamente",
          showConfirmButton: false,
          timer: 2500,
          timerProgressBar: true
        });
        setTimeout(() => location.reload(), 2600);
      }
    });
  });

  // ======= BUSQUEDA POR DOCUMENTO - HISTORIAL ======
  document.getElementById('btnBuscarHistorial').addEventListener('click', async () => {
    const documento = document.getElementById('inputDocumentoHistorial').value.trim();
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
      cuerpoTabla.innerHTML = pagos.map(p =>
        `<tr>
          <td>${new Date(p.paymentDate).toLocaleDateString("es-AR")}</td>
          <td>${p.subscriptionType}</td>
          <td class="text-end">$${parseFloat(p.amount).toLocaleString("es-AR")}</td> <!-- ✅ alineado derecha -->
          <td>${p.comentarios || ''}</td>
        </tr>`
      ).join('');
    } catch (error) {
      contenedor.style.display = "none";
      handleError(error);
    }
  });
});

// ======= FUNCIONES DE TABLAS Y DASHBOARD ======
async function mostrarGastosMensuales() {
  try {
const res = await fetch(`${API_URL}/gastos/por-mes`, {
  headers: getAuthHeaders()
});


    if (!res.ok) throw new Error("No se pudieron obtener los gastos mensuales");

    const data = await res.json();
    const container = document.getElementById("tablaGastosMensuales");

 container.innerHTML = data.map(row => {
  const mes = row.mes ?? row.month ?? row.Month ?? row.periodo ?? row.period ?? row.mes_anio;
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
        <td class="text-end">$${parseFloat(gasto.monto).toLocaleString("es-AR")}</td> <!-- ✅ alineado derecha -->
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

async function cargarResumenMensual() {
  try {
    const response = await fetch(`${API_URL}/resumen/mensual`, {
      method: "GET",
      headers: getAuthHeaders()
    });

    if (!response.ok) throw new Error("No se pudo obtener el resumen mensual");

    const { totalIngresos, totalGastos, saldo } = await response.json();

    document.getElementById("totalIncomeAmount").textContent = totalIngresos.toLocaleString("es-AR", {
      style: "currency", currency: "ARS"
    });

    document.getElementById("totalGastosMes").textContent = totalGastos.toLocaleString("es-AR", {
      style: "currency", currency: "ARS"
    });

    document.getElementById("saldoMensual").textContent = saldo.toLocaleString("es-AR", {
      style: "currency", currency: "ARS"
    });
  } catch (error) {
    handleError(error);
  }
}

async function cargarPagos() {
  try {
    const response = await fetch(`${API_URL}/payments`, {
      method: "GET",
      headers: getAuthHeaders()
    });

    if (!response.ok) throw new Error("No se pudieron obtener los pagos");

    const data = await response.json();
    const tbody = document.getElementById("clientPaymentsTableBody");

    if (tbody && Array.isArray(data.payments)) {
      tbody.innerHTML = data.payments.map(p => `
        <tr>
          <td>${p.id}</td>
          <td>${p.fullName}</td>
          <td>${new Date(p.paymentDate).toLocaleDateString('es-AR')}</td>
          <td class="text-end">$${parseFloat(p.amount).toLocaleString('es-AR')}</td> <!-- ✅ alineado derecha -->
          <td>
            <button class="btn btn-sm btn-warning" onclick="editPayment(${p.id})">✏️</button>
            <button class="btn btn-sm btn-danger" onclick="deletePayment(${p.id})">🗑️</button>
          </td>
        </tr>`).join('');
    }
  } catch (error) {
    handleError(error);
  }
}

// ======= RESTO DE FUNCIONES CRUD (EDITAR/ELIMINAR PAGOS Y GASTOS) ======
async function deletePayment(id) {
  const confirm = await Swal.fire({
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

async function editPayment(id) {
 window.currentPaymentId = id; // ✅ guarda el ID del pago a editar
  try {
    const response = await fetch(`${API_URL}/payments/${id}`, {
      method: "GET",
      headers: getAuthHeaders()
    });

    if (!response.ok) throw new Error("No se pudo obtener el pago");

    const pago = await response.json();

    const { value: formValues } = await Swal.fire({
      title: "Editar Pago",
html: `
  <input id="swal-fullName" class="swal2-input" placeholder="Nombre" value="${pago.fullName}">

  <input id="swal-documento" class="swal2-input" placeholder="Documento" value="${pago.documento || ""}" readonly>

  <select id="swal-subscriptionType" class="swal2-input">
    <option value="36500" ${pago.subscriptionType == "36500" ? "selected" : ""}>4 clases - $36.500</option>
    <option value="42000" ${pago.subscriptionType == "42000" ? "selected" : ""}>6 clases - $42.000</option>
    <option value="48000" ${pago.subscriptionType == "48000" ? "selected" : ""}>8 clases - $48.000</option>
  </select>

  <input id="swal-amount" type="number" class="swal2-input" placeholder="Monto" value="${pago.amount}">

  <input id="swal-paymentDate" type="date" class="swal2-input"
    value="${new Date(pago.paymentDate).toISOString().split('T')[0]}">
`,

      
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: "Actualizar",
      preConfirm: () => {
        return {
          fullName: document.getElementById("swal-fullName").value.trim(),
          subscriptionType: document.getElementById("swal-subscriptionType").value,
          amount: parseFloat(document.getElementById("swal-amount").value),
          paymentDate: document.getElementById("swal-paymentDate").value
        };
      }
    });

    if (!formValues) return;

    const { fullName, subscriptionType, amount, paymentDate } = formValues;

    if (!fullName || !subscriptionType || !paymentDate || isNaN(amount)) {
      return Swal.fire("Error", "Todos los campos son obligatorios.", "warning");
    }

    const updateResponse = await fetch(`${API_URL}/payments/${id}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify({ fullName, subscriptionType, amount, paymentDate })
    });

    if (!updateResponse.ok) throw new Error("No se pudo actualizar el pago");

    Swal.fire("Actualizado", "El pago se actualizó correctamente.", "success");
    await cargarResumenMensual();
    await cargarPagos();
  } catch (error) {
    handleError(error);
  }
}

async function eliminarGasto(id, mes) {
  try {
    const confirm = await Swal.fire({
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

    const { value: formValues } = await Swal.fire({
      title: "Editar Gasto",
      html: `
        <input id="swal-fecha" class="swal2-input" type="date" value="${gasto.fecha.split("T")[0]}">
        <input id="swal-categoria" class="swal2-input" placeholder="Categoría" value="${gasto.categoria}">
        <input id="swal-descripcion" class="swal2-input" placeholder="Descripción" value="${gasto.descripcion}">
        <input id="swal-monto" class="swal2-input" type="number" placeholder="Monto" value="${gasto.monto}">
      `,
      focusConfirm: false,
      preConfirm: () => {
        return {
          fecha: document.getElementById("swal-fecha").value,
          categoria: document.getElementById("swal-categoria").value,
          descripcion: document.getElementById("swal-descripcion").value,
          monto: parseFloat(document.getElementById("swal-monto").value)
        };
      }
    });

    if (!formValues) return;

    const update = await fetch(`${API_URL}/gastos/${id}`, {
      method: "PUT",
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "application/json"
      },
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
// ======= SERIE MENSUAL (GRAFICO + TABLA) =======
let chartSerieMensual = null;

function formatARS(n) {
  return Number(n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

async function cargarSerieMensual(months = 12) {
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
  if (!canvas) return;

  if (typeof Chart === "undefined") {
    console.warn("Chart.js no está cargado. Revisá el script CDN en index.html.");
    return;
  }

  const labels = rows.map(r => r.mes);
  const ingresos = rows.map(r => Number(r.totalIngresos || 0));
  const gastos = rows.map(r => Number(r.totalGastos || 0));
  const saldo = rows.map(r => Number(r.saldo || 0));

  if (chartSerieMensual) chartSerieMensual.destroy();

  chartSerieMensual = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Ingresos", data: ingresos },
        { label: "Gastos", data: gastos },
        { label: "Saldo", data: saldo, type: "line" }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: {
        y: { ticks: { callback: (v) => formatARS(v) } }
      }
    }
  });
}
