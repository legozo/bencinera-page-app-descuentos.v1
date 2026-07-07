requerirSesion("admin");

let catalogos = { sucursales: [], combustibles: [], tiposSocio: [] };
let ultimoHistorial = []; // guarda las filas cargadas para poder exportarlas
let ultimoReporte = null; // guarda el reporte cargado (totales + desgloses) para poder exportarlo

async function cargarCatalogos() {
  const [sucursales, combustibles, tiposSocio] = await Promise.all([
    Api.get("/catalogos/sucursales"),
    Api.get("/catalogos/combustibles"),
    Api.get("/catalogos/tipos-socio"),
  ]);
  catalogos = { sucursales, combustibles, tiposSocio };
}

function cambiarTab(nombre) {
  document.querySelectorAll(".sidebar-nav button").forEach((b) => b.classList.toggle("activo", b.dataset.tab === nombre));
  document.querySelectorAll(".tab-contenido").forEach((d) => d.classList.add("oculto"));
  document.getElementById(`tab-${nombre}`).classList.remove("oculto");
  const cargador = { reportes: cargarReportes, historial: cargarHistorial, socios: cargarSocios, bomberos: cargarBomberos, reglas: cargarReglas, precios: cargarPrecios }[nombre];
  if (cargador) cargador();
}

function fmt(n) { return Number(n || 0).toLocaleString("es-CL"); }

/** Muestra un modal propio de sí/no (reemplaza confirm() nativo). Devuelve una Promise<boolean>. */
function confirmarAccion(mensaje, titulo = "Confirmar acción") {
  return new Promise((resolve) => {
    const cont = document.getElementById("modalContenedor");
    cont.innerHTML = `
      <div class="overlay-modal">
        <div class="modal">
          <h3>${titulo}</h3>
          <p>${mensaje}</p>
          <div class="modal-botones">
            <button class="secundario" id="modalCancelar">Cancelar</button>
            <button class="primario" id="modalAceptar">Confirmar</button>
          </div>
        </div>
      </div>`;
    const cerrar = (resultado) => { cont.innerHTML = ""; resolve(resultado); };
    document.getElementById("modalCancelar").onclick = () => cerrar(false);
    document.getElementById("modalAceptar").onclick = () => cerrar(true);
  });
}

/** Muestra un modal propio de aviso con un solo botón (reemplaza alert() nativo). */
function avisar(mensaje, titulo = "Aviso") {
  return new Promise((resolve) => {
    const cont = document.getElementById("modalContenedor");
    cont.innerHTML = `
      <div class="overlay-modal">
        <div class="modal">
          <h3>${titulo}</h3>
          <p>${mensaje}</p>
          <div class="modal-botones">
            <button class="primario" id="modalOk">Aceptar</button>
          </div>
        </div>
      </div>`;
    document.getElementById("modalOk").onclick = () => { cont.innerHTML = ""; resolve(); };
  });
}

/**
 * Muestra un modal con un campo de texto (reemplaza prompt() nativo). Devuelve una
 * Promise<string|null> — null si se cancela, o el valor (recortado) si se confirma.
 * opciones.password: true muestra el campo como clave (oculto). opciones.minLength: si se
 * define, no deja confirmar con menos caracteres que eso.
 */
function pedirTexto(mensaje, titulo = "Ingresa un valor", opciones = {}) {
  return new Promise((resolve) => {
    const cont = document.getElementById("modalContenedor");
    const tipo = opciones.password ? "password" : "text";
    cont.innerHTML = `
      <div class="overlay-modal">
        <div class="modal">
          <h3>${titulo}</h3>
          <p style="margin-bottom:10px;">${mensaje}</p>
          <input id="modalInputTexto" type="${tipo}" autofocus>
          <div id="modalInputError" class="mensaje-error oculto" style="margin-top:10px;"></div>
          <div class="modal-botones">
            <button class="secundario" id="modalCancelar">Cancelar</button>
            <button class="primario" id="modalAceptar">Confirmar</button>
          </div>
        </div>
      </div>`;
    const input = document.getElementById("modalInputTexto");
    const errorDiv = document.getElementById("modalInputError");
    const cerrar = (valor) => { cont.innerHTML = ""; resolve(valor); };
    const confirmar = () => {
      const valor = input.value.trim();
      if (opciones.minLength && valor.length < opciones.minLength) {
        errorDiv.textContent = `Debe tener al menos ${opciones.minLength} caracteres.`;
        errorDiv.classList.remove("oculto");
        return;
      }
      cerrar(valor);
    };
    document.getElementById("modalCancelar").onclick = () => cerrar(null);
    document.getElementById("modalAceptar").onclick = confirmar;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmar(); });
  });
}

/** Devuelve el HTML de un skeleton animado de N líneas, para mostrar mientras se carga algo. */
function skeletonLineas(n = 3) {
  return `<div>${Array.from({ length: n }, () => '<div class="skeleton skeleton-linea"></div>').join("")}</div>`;
}

// ---------- Reportes ----------
// Por defecto muestra SOLO el día de hoy (no un acumulado histórico que crece para
// siempre) — para eso está el botón "Todo" si de verdad se quiere ver el total de
// toda la vida del negocio.
function fechaLocalISO(d) {
  // Igual que d.toISOString().slice(0,10) pero usando la fecha LOCAL del navegador,
  // no UTC (para no mostrar "ayer" o "mañana" según la hora del día).
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

async function cargarReportes() {
  const cont = document.getElementById("tab-reportes");
  const hoy = fechaLocalISO(new Date());
  cont.innerHTML = `
    <div class="tarjeta">
      <div class="grid-2">
        <div><label>Desde</label><input type="date" id="reporteDesde" value="${hoy}"></div>
        <div><label>Hasta</label><input type="date" id="reporteHasta" value="${hoy}"></div>
      </div>
      <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="secundario" onclick="filtroReporteRapido('hoy')">Hoy</button>
        <button class="secundario" onclick="filtroReporteRapido('semana')">Esta semana</button>
        <button class="secundario" onclick="filtroReporteRapido('mes')">Este mes</button>
        <button class="secundario" onclick="filtroReporteRapido('todo')">Todo (histórico)</button>
        <button class="primario" style="margin-top:0;" onclick="buscarReportes()">Filtrar</button>
        <button class="secundario" onclick="limpiarFiltrosReportes()">Limpiar filtros</button>
      </div>
    </div>
    <div id="resultadoReportes"></div>`;
  buscarReportes();
}

/** Vuelve al estado por defecto de la pestaña (el día de hoy), igual que al abrirla. */
function limpiarFiltrosReportes() {
  filtroReporteRapido("hoy");
}

function filtroReporteRapido(tipo) {
  const hoy = new Date();
  let desde = "";
  let hasta = "";

  if (tipo === "hoy") {
    desde = hasta = fechaLocalISO(hoy);
  } else if (tipo === "semana") {
    const inicioSemana = new Date(hoy);
    const diaSemana = inicioSemana.getDay(); // 0 = domingo
    const diff = diaSemana === 0 ? 6 : diaSemana - 1; // semana empieza el lunes
    inicioSemana.setDate(inicioSemana.getDate() - diff);
    desde = fechaLocalISO(inicioSemana);
    hasta = fechaLocalISO(hoy);
  } else if (tipo === "mes") {
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    desde = fechaLocalISO(inicioMes);
    hasta = fechaLocalISO(hoy);
  } else {
    desde = "";
    hasta = "";
  }

  document.getElementById("reporteDesde").value = desde;
  document.getElementById("reporteHasta").value = hasta;
  buscarReportes();
}

/** Agrupa las filas planas (sucursal + combustible) del backend en grupos por sucursal,
 * para poder mostrar/exportar un subtotal debajo de cada sucursal. */
function agruparDetallePorSucursal(detalle) {
  const grupos = [];
  let actual = null;
  for (const r of detalle) {
    if (!actual || actual.sucursal !== r.sucursal) {
      actual = { sucursal: r.sucursal, filas: [] };
      grupos.push(actual);
    }
    actual.filas.push(r);
  }
  return grupos;
}

function subtotalGrupo(filas) {
  return filas.reduce(
    (acc, r) => ({
      litros: acc.litros + Number(r.litros),
      descuento_total: acc.descuento_total + Number(r.descuento_total),
      monto_total: acc.monto_total + Number(r.monto_total),
    }),
    { litros: 0, descuento_total: 0, monto_total: 0 }
  );
}

async function buscarReportes() {
  const desde = document.getElementById("reporteDesde").value;
  const hasta = document.getElementById("reporteHasta").value;
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);

  const cont = document.getElementById("resultadoReportes");
  cont.innerHTML = `<div class="tarjeta">${skeletonLineas(4)}</div>`;
  const data = await Api.get(`/reportes/resumen?${params.toString()}`);

  const rangoTexto = desde || hasta
    ? `Período: ${desde || "el inicio"} a ${hasta || "hoy"}`
    : "Todo el histórico (desde que se instaló la app)";

  ultimoReporte = { ...data, rangoTexto };

  // Antes había dos tablas separadas (por sucursal y por combustible) que no conectaban
  // de dónde salía cada total. Ahora es una sola tabla: sucursal + combustible en cada
  // fila, con un subtotal por sucursal, para ver la trazabilidad completa.
  const grupos = agruparDetallePorSucursal(data.detalle);

  cont.innerHTML = `
    <div class="tarjeta">
      <p class="chico">${rangoTexto}</p>
      <h3>Totales</h3>
      <p>Transacciones: <strong>${data.totales.transacciones}</strong> —
         Litros: <strong>${fmt(data.totales.litros)}</strong> —
         Descuento otorgado: <strong>$${fmt(data.totales.descuento_total)}</strong> —
         Total cobrado: <strong>$${fmt(data.totales.monto_total)}</strong></p>
      <button class="secundario" style="margin-top:10px;" onclick="exportarReporteCSV()">Exportar a Excel</button>
    </div>
    <div class="tarjeta">
      <h3>Detalle por sucursal y combustible</h3>
      <table>
        <tr><th>Sucursal</th><th>Combustible</th><th>Litros</th><th>Descuento</th><th>Total cobrado</th></tr>
        ${grupos.map((g) => {
          const sub = subtotalGrupo(g.filas);
          const filasHtml = g.filas.map((r) => `<tr><td>${r.sucursal}</td><td>${r.combustible}</td><td>${fmt(r.litros)}</td><td>$${fmt(r.descuento_total)}</td><td>$${fmt(r.monto_total)}</td></tr>`).join("");
          const subtotalHtml = `<tr style="font-weight:600; background:#f4f5f7;"><td colspan="2">Subtotal ${g.sucursal}</td><td>${fmt(sub.litros)}</td><td>$${fmt(sub.descuento_total)}</td><td>$${fmt(sub.monto_total)}</td></tr>`;
          return filasHtml + subtotalHtml;
        }).join("") || '<tr><td colspan="5">Sin datos</td></tr>'}
      </table>
    </div>`;
}

/**
 * Exporta el reporte actualmente cargado (totales + detalle combinado por sucursal y
 * combustible, con subtotales) a un archivo CSV que Excel abre directo. Mismo formato
 * (BOM + ";") que exportarHistorialCSV, para que se abra bien en Excel en español.
 */
function exportarReporteCSV() {
  if (!ultimoReporte) {
    avisar("No hay datos cargados para exportar. Filtra primero.");
    return;
  }

  const escaparCsv = (valor) => {
    const texto = String(valor ?? "");
    return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const filaCsv = (arr) => arr.map(escaparCsv).join(";");

  const { totales, detalle, rangoTexto } = ultimoReporte;
  const grupos = agruparDetallePorSucursal(detalle);

  const lineas = [];
  lineas.push(filaCsv([rangoTexto]));
  lineas.push("");
  lineas.push(filaCsv(["Totales"]));
  lineas.push(filaCsv(["Transacciones", "Litros", "Descuento total", "Total cobrado"]));
  lineas.push(filaCsv([totales.transacciones, totales.litros, totales.descuento_total, totales.monto_total]));
  lineas.push("");
  lineas.push(filaCsv(["Detalle por sucursal y combustible"]));
  lineas.push(filaCsv(["Sucursal", "Combustible", "Litros", "Descuento", "Total cobrado"]));
  grupos.forEach((g) => {
    g.filas.forEach((r) => lineas.push(filaCsv([r.sucursal, r.combustible, r.litros, r.descuento_total, r.monto_total])));
    const sub = subtotalGrupo(g.filas);
    lineas.push(filaCsv([`Subtotal ${g.sucursal}`, "", sub.litros, sub.descuento_total, sub.monto_total]));
  });

  const csv = lineas.join("\r\n");
  const bom = "﻿"; // para que Excel detecte UTF-8 y no rompa las tildes/ñ
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  const fecha = new Date().toISOString().slice(0, 10);
  enlace.href = url;
  enlace.download = `reporte_${fecha}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

// ---------- Historial ----------
let usuariosCacheHistorial = []; // lista de bomberos/admins para el filtro "Bombero"
let paginaHistorialActual = 1;
let totalHistorial = 0;
const POR_PAGINA_HISTORIAL = 500;

async function cargarHistorial() {
  const cont = document.getElementById("tab-historial");
  await cargarCatalogos();
  usuariosCacheHistorial = await Api.get("/usuarios");
  const opcionesSucursal = catalogos.sucursales.map((s) => `<option value="${s.id}">${s.nombre}</option>`).join("");
  const opcionesBombero = usuariosCacheHistorial.map((u) => `<option value="${u.id}">${u.nombre} ${u.apellido || ""}</option>`).join("");
  cont.innerHTML = `
    <div class="tarjeta">
      <div class="grid-2">
        <div><label>Desde</label><input type="date" id="filtroDesde"></div>
        <div><label>Hasta</label><input type="date" id="filtroHasta"></div>
        <div><label>RUT</label><input id="filtroRut" placeholder="Escribe el RUT (con o sin puntos/guion)"></div>
        <div><label>Sucursal</label><select id="filtroSucursal"><option value="">Todas</option>${opcionesSucursal}</select></div>
        <div><label>Bombero</label><select id="filtroBombero"><option value="">Todos</option>${opcionesBombero}</select></div>
        <div><label>Precio/L mínimo</label><input id="filtroPrecioMin" type="number" step="0.01" placeholder="$"></div>
        <div><label>Precio/L máximo</label><input id="filtroPrecioMax" type="number" step="0.01" placeholder="$"></div>
      </div>
      <button class="secundario" style="margin-top:10px;" onclick="buscarHistorial()">Filtrar</button>
      <button class="secundario" style="margin-top:10px;" onclick="limpiarFiltrosHistorial()">Limpiar filtros</button>
      <button class="secundario" style="margin-top:10px;" onclick="exportarHistorialCSV()">Exportar a Excel</button>
    </div>
    <div class="tarjeta"><div id="tablaHistorial">${skeletonLineas(6)}</div></div>`;
  buscarHistorial();
}

/** Deja todos los filtros de Historial en blanco (muestra todo el historial sin filtrar). */
function limpiarFiltrosHistorial() {
  document.getElementById("filtroDesde").value = "";
  document.getElementById("filtroHasta").value = "";
  document.getElementById("filtroRut").value = "";
  document.getElementById("filtroSucursal").value = "";
  document.getElementById("filtroBombero").value = "";
  document.getElementById("filtroPrecioMin").value = "";
  document.getElementById("filtroPrecioMax").value = "";
  buscarHistorial();
}

/** Lee los filtros actuales de Historial y arma los params comunes a buscarHistorial() y exportarHistorialCSV(). */
function paramsFiltrosHistorial() {
  const desde = document.getElementById("filtroDesde").value;
  const hasta = document.getElementById("filtroHasta").value;
  const rut = document.getElementById("filtroRut").value.trim();
  const sucursalId = document.getElementById("filtroSucursal").value;
  const bomberoId = document.getElementById("filtroBombero").value;
  const precioMin = document.getElementById("filtroPrecioMin").value;
  const precioMax = document.getElementById("filtroPrecioMax").value;
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  if (rut) params.set("rut", rut);
  if (sucursalId) params.set("sucursal_id", sucursalId);
  if (bomberoId) params.set("usuario_id", bomberoId);
  if (precioMin) params.set("precio_min", precioMin);
  if (precioMax) params.set("precio_max", precioMax);
  return params;
}

async function buscarHistorial(pagina = 1) {
  const params = paramsFiltrosHistorial();
  params.set("pagina", pagina);
  const data = await Api.get(`/transacciones?${params.toString()}`);
  const rows = data.filas;
  ultimoHistorial = rows;
  paginaHistorialActual = data.pagina;
  totalHistorial = data.total;
  document.getElementById("tablaHistorial").innerHTML = `
    <table>
      <tr><th>Fecha</th><th>Hora</th><th>Sucursal</th><th>Bombero</th><th>RUT</th><th>Nombre socio</th><th>Combustible</th><th>Litros</th><th>Precio/L</th><th>Descuento</th><th>Total cobrado</th></tr>
      ${rows.map((t) => {
        const fechaHora = new Date(t.creado_en);
        const rutMostrado = t.socio_dv ? `${t.rut_consultado}-${t.socio_dv}` : t.rut_consultado;
        return `
        <tr>
          <td data-etiqueta="Fecha">${fechaHora.toLocaleDateString("es-CL")}</td>
          <td data-etiqueta="Hora">${fechaHora.toLocaleTimeString("es-CL")}</td>
          <td data-etiqueta="Sucursal">${t.sucursal_nombre}</td>
          <td data-etiqueta="Bombero">${t.bombero_nombre} ${t.bombero_apellido || ""}</td>
          <td data-etiqueta="RUT">${rutMostrado}</td>
          <td data-etiqueta="Nombre socio">${t.socio_nombre ? `${t.socio_nombre} ${t.socio_apellido || ""}` : "(no socio)"}</td>
          <td data-etiqueta="Combustible">${t.combustible_nombre}</td>
          <td data-etiqueta="Litros">${fmt(t.litros)}</td>
          <td data-etiqueta="Precio/L">$${fmt(t.precio_litro_clp)}</td>
          <td data-etiqueta="Descuento">$${fmt(t.descuento_total_clp)}</td>
          <td data-etiqueta="Total cobrado">$${fmt(t.monto_total_clp)}</td>
        </tr>`;
      }).join("") || '<tr><td colspan="11">Sin registros</td></tr>'}
    </table>
    ${paginacionHistorialHTML()}`;
}

/** Genera la barra "Mostrando X-Y de Z resultados" + botones Anterior/Siguiente para Historial. */
function paginacionHistorialHTML() {
  const totalPaginas = Math.max(1, Math.ceil(totalHistorial / POR_PAGINA_HISTORIAL));
  const desde = totalHistorial === 0 ? 0 : (paginaHistorialActual - 1) * POR_PAGINA_HISTORIAL + 1;
  const hasta = Math.min(paginaHistorialActual * POR_PAGINA_HISTORIAL, totalHistorial);
  const esPrimera = paginaHistorialActual <= 1;
  const esUltima = paginaHistorialActual >= totalPaginas;
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; flex-wrap:wrap; gap:10px;">
      <div class="chico">Mostrando ${fmt(desde)}-${fmt(hasta)} de ${fmt(totalHistorial)} resultados</div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="secundario" ${esPrimera ? 'disabled style="opacity:.4; cursor:default;"' : ""} onclick="buscarHistorial(${paginaHistorialActual - 1})">Anterior</button>
        <span class="chico">Página ${paginaHistorialActual} de ${totalPaginas}</span>
        <button class="secundario" ${esUltima ? 'disabled style="opacity:.4; cursor:default;"' : ""} onclick="buscarHistorial(${paginaHistorialActual + 1})">Siguiente</button>
      </div>
    </div>`;
}

/**
 * Exporta lo que está actualmente cargado en la tabla de historial a un archivo CSV,
 * que Excel abre directo (doble click). Usa punto y coma como separador y BOM UTF-8
 * para que Excel en español reconozca bien las columnas y las tildes.
 */
async function exportarHistorialCSV() {
  if (totalHistorial === 0) {
    avisar("No hay datos cargados para exportar. Filtra primero.");
    return;
  }

  // Pide TODAS las filas que calcen con los filtros actuales (no solo la página que se
  // está viendo), usando exportar=1 para que el backend ignore el límite de 500 por página.
  const params = paramsFiltrosHistorial();
  params.set("exportar", "1");
  const data = await Api.get(`/transacciones?${params.toString()}`);
  const filasHistorial = data.filas;

  const encabezados = [
    "Fecha", "Hora", "Sucursal", "Bombero", "RUT", "Nombre socio",
    "Combustible", "Litros", "Precio por litro", "Descuento total", "Total cobrado",
  ];

  const escaparCsv = (valor) => {
    const texto = String(valor ?? "");
    return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };

  const filas = filasHistorial.map((t) => {
    const fechaHora = new Date(t.creado_en);
    const rutMostrado = t.socio_dv ? `${t.rut_consultado}-${t.socio_dv}` : t.rut_consultado;
    const nombreSocio = t.socio_nombre ? `${t.socio_nombre} ${t.socio_apellido || ""}`.trim() : "(no socio)";
    const nombreBombero = `${t.bombero_nombre} ${t.bombero_apellido || ""}`.trim();
    return [
      fechaHora.toLocaleDateString("es-CL"),
      fechaHora.toLocaleTimeString("es-CL"),
      t.sucursal_nombre,
      nombreBombero,
      rutMostrado,
      nombreSocio,
      t.combustible_nombre,
      t.litros,
      t.precio_litro_clp,
      t.descuento_total_clp,
      t.monto_total_clp,
    ].map(escaparCsv).join(";");
  });

  const csv = [encabezados.join(";"), ...filas].join("\r\n");
  const bom = "﻿"; // para que Excel detecte UTF-8 y no rompa las tildes/ñ
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  const fecha = new Date().toISOString().slice(0, 10);
  enlace.href = url;
  enlace.download = `historial_${fecha}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

// ---------- Socios ----------
async function cargarSocios() {
  const cont = document.getElementById("tab-socios");
  await cargarCatalogos();
  const opcionesTipo = catalogos.tiposSocio
    .map((t) => `<option value="${t.id}" data-descripcion="${(t.descripcion || "").replace(/"/g, "&quot;")}">${t.nombre}</option>`)
    .join("");
  cont.innerHTML = `
    <div class="tarjeta">
      <button class="secundario" onclick="toggleFormSocio()">+ Agregar socio</button>
      <div id="formSocio" class="oculto" style="border:1px solid var(--borde); border-radius:8px; padding:16px; margin-top:12px; background:#fafbfc;">
        <div class="grid-2">
          <div><label>RUT (con dígito verificador)</label><input id="nSocioRut" placeholder="12345678-9"></div>
          <div>
            <label>Tipo de socio</label>
            <select id="nSocioTipo" onchange="mostrarDescripcionTipoSocio()">${opcionesTipo}</select>
            <div id="descripcionTipoSocio" class="chico" style="margin-top:4px;"></div>
          </div>
          <div><label>Nombre</label><input id="nSocioNombre"></div>
          <div><label>Apellido</label><input id="nSocioApellido"></div>
          <div><label>Teléfono (opcional)</label><input id="nSocioTelefono" placeholder="+56 9 1234 5678"></div>
          <div><label>Dirección (opcional)</label><input id="nSocioDireccion" placeholder="Calle 123, comuna"></div>
        </div>
        <div style="margin-top:12px; display:flex; gap:8px;">
          <button class="primario" style="margin-top:0;" onclick="crearSocio()">Guardar</button>
          <button class="secundario" onclick="toggleFormSocio()">Cancelar</button>
        </div>
        <div id="errorSocio" class="mensaje-error oculto"></div>
      </div>
    </div>
    <div class="tarjeta">
      <label>Buscar</label>
      <input id="buscarSocioInput" placeholder="RUT o nombre" oninput="buscarSociosLista()">
      <div id="tablaSocios" style="margin-top:10px;">${skeletonLineas(5)}</div>
    </div>`;
  mostrarDescripcionTipoSocio();
  buscarSociosLista();
}

/** Muestra u oculta el mini formulario para crear un socio nuevo (y limpia los campos al cerrarlo). */
function toggleFormSocio() {
  const div = document.getElementById("formSocio");
  div.classList.toggle("oculto");
  if (div.classList.contains("oculto")) {
    document.getElementById("nSocioRut").value = "";
    document.getElementById("nSocioNombre").value = "";
    document.getElementById("nSocioApellido").value = "";
    document.getElementById("nSocioTelefono").value = "";
    document.getElementById("nSocioDireccion").value = "";
    document.getElementById("errorSocio").classList.add("oculto");
  } else {
    mostrarDescripcionTipoSocio();
  }
}

/** Muestra debajo del selector la descripción (si tiene) del tipo de socio elegido. */
function mostrarDescripcionTipoSocio() {
  const select = document.getElementById("nSocioTipo");
  const div = document.getElementById("descripcionTipoSocio");
  if (!select || !div) return;
  div.textContent = select.selectedOptions[0]?.dataset.descripcion || "";
}

async function buscarSociosLista() {
  const q = document.getElementById("buscarSocioInput").value.trim();
  const rows = await Api.get(`/socios${q ? "?q=" + encodeURIComponent(q) : ""}`);
  document.getElementById("tablaSocios").innerHTML = `
    <table>
      <tr><th>RUT</th><th>Nombre</th><th>Tipo</th><th>Activo</th><th>Registro</th><th></th><th></th></tr>
      ${rows.map((s) => `
        <tr>
          <td data-etiqueta="RUT">${s.rut}-${s.dv}</td>
          <td data-etiqueta="Nombre">${s.nombre} ${s.apellido || ""}</td>
          <td data-etiqueta="Tipo">${s.tipo_socio_nombre}</td>
          <td data-etiqueta="Activo">${s.activo ? "Sí" : "No"}</td>
          <td data-etiqueta="Registro">${new Date(s.fecha_registro).toLocaleDateString("es-CL")}</td>
          <td><button class="secundario" onclick="toggleActivoSocio(${s.id}, ${!s.activo})">${s.activo ? "Desactivar" : "Activar"}</button></td>
          <td><button class="secundario" style="color:#c0392b; border-color:#c0392b;" onclick="eliminarSocio(${s.id}, '${(s.nombre + " " + (s.apellido || "")).replace(/'/g, "\\'").trim()}')">Eliminar</button></td>
        </tr>`).join("") || '<tr><td colspan="7">Sin resultados</td></tr>'}
    </table>`;
}

async function crearSocio() {
  const errorDiv = document.getElementById("errorSocio");
  errorDiv.classList.add("oculto");
  try {
    await Api.post("/socios", {
      rut: document.getElementById("nSocioRut").value.trim(),
      tipo_socio_id: Number(document.getElementById("nSocioTipo").value),
      nombre: document.getElementById("nSocioNombre").value.trim(),
      apellido: document.getElementById("nSocioApellido").value.trim(),
      telefono: document.getElementById("nSocioTelefono").value.trim(),
      direccion: document.getElementById("nSocioDireccion").value.trim(),
    });
    toggleFormSocio(); // colapsa el formulario y limpia los campos
    buscarSociosLista();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("oculto");
  }
}

async function toggleActivoSocio(id, nuevoEstado) {
  await Api.put(`/socios/${id}`, { activo: nuevoEstado });
  buscarSociosLista();
}

async function eliminarSocio(id, nombre) {
  const confirmado = await confirmarAccion(`¿Eliminar definitivamente a ${nombre}? Esta acción no se puede deshacer.`, "Eliminar socio");
  if (!confirmado) return;
  try {
    await Api.delete(`/socios/${id}`);
    buscarSociosLista();
  } catch (err) {
    avisar(err.message, "Error");
  }
}

// ---------- Bomberos ----------
async function cargarBomberos() {
  const cont = document.getElementById("tab-bomberos");
  await cargarCatalogos();
  const opcionesSucursal = catalogos.sucursales.map((s) => `<option value="${s.id}">${s.nombre}</option>`).join("");
  cont.innerHTML = `
    <div class="tarjeta">
      <button class="secundario" onclick="toggleFormUsuario()">+ Agregar usuario</button>
      <div id="formUsuario" class="oculto" style="border:1px solid var(--borde); border-radius:8px; padding:16px; margin-top:12px; background:#fafbfc;">
        <div class="grid-2">
          <div><label>Nombre</label><input id="nUserNombre"></div>
          <div><label>Apellido</label><input id="nUserApellido"></div>
          <div><label>Usuario (login)</label><input id="nUserLogin"></div>
          <div><label>Clave</label><input id="nUserClave" type="password"></div>
          <div><label>Rol</label>
            <select id="nUserRol" onchange="document.getElementById('bloqueSucursal').classList.toggle('oculto', this.value==='admin')">
              <option value="bombero">Bombero</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <div id="bloqueSucursal"><label>Sucursal</label><select id="nUserSucursal">${opcionesSucursal}</select></div>
          <div><label>Teléfono (opcional)</label><input id="nUserTelefono" placeholder="+56 9 1234 5678"></div>
        </div>
        <div style="margin-top:12px; display:flex; gap:8px;">
          <button class="primario" style="margin-top:0;" onclick="crearUsuario()">Guardar</button>
          <button class="secundario" onclick="toggleFormUsuario()">Cancelar</button>
        </div>
        <div id="errorUsuario" class="mensaje-error oculto"></div>
      </div>
    </div>
    <div class="tarjeta"><div id="tablaUsuarios">${skeletonLineas(5)}</div></div>`;
  listarUsuarios();
}

/** Muestra u oculta el mini formulario para crear un usuario nuevo (y limpia los campos al cerrarlo). */
function toggleFormUsuario() {
  const div = document.getElementById("formUsuario");
  div.classList.toggle("oculto");
  if (div.classList.contains("oculto")) {
    document.getElementById("nUserNombre").value = "";
    document.getElementById("nUserApellido").value = "";
    document.getElementById("nUserLogin").value = "";
    document.getElementById("nUserClave").value = "";
    document.getElementById("nUserTelefono").value = "";
    document.getElementById("errorUsuario").classList.add("oculto");
  }
}

async function listarUsuarios() {
  const rows = await Api.get("/usuarios");
  document.getElementById("tablaUsuarios").innerHTML = `
    <table>
      <tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Sucursal</th><th>Activo</th><th>Creado</th><th></th><th></th><th></th></tr>
      ${rows.map((u) => `
        <tr>
          <td data-etiqueta="Nombre">${u.nombre} ${u.apellido || ""}</td>
          <td data-etiqueta="Usuario">${u.usuario}</td>
          <td data-etiqueta="Rol">${u.rol}</td>
          <td data-etiqueta="Sucursal">${u.sucursal_nombre || "-"}</td>
          <td data-etiqueta="Activo">${u.activo ? "Sí" : "No"}</td>
          <td data-etiqueta="Creado">${new Date(u.creado_en).toLocaleDateString("es-CL")}</td>
          <td><button class="secundario" onclick="cambiarClaveUsuario(${u.id}, '${(u.nombre + " " + (u.apellido || "")).replace(/'/g, "\\'").trim()}')">Cambiar clave</button></td>
          <td><button class="secundario" onclick="toggleActivoUsuario(${u.id}, ${!u.activo})">${u.activo ? "Desactivar" : "Activar"}</button></td>
          <td><button class="secundario" style="color:#c0392b; border-color:#c0392b;" onclick="eliminarUsuario(${u.id}, '${(u.nombre + " " + (u.apellido || "")).replace(/'/g, "\\'").trim()}')">Eliminar</button></td>
        </tr>`).join("")}
    </table>`;
}

/** Pide una clave nueva (con confirmación de mínimo 4 caracteres) y la guarda para ese usuario. */
async function cambiarClaveUsuario(id, nombre) {
  const nuevaClave = await pedirTexto(`Nueva clave para ${nombre}:`, "Cambiar clave", { password: true, minLength: 4 });
  if (nuevaClave === null) return; // canceló
  try {
    await Api.put(`/usuarios/${id}`, { password: nuevaClave });
    await avisar("Clave actualizada.", "Listo");
  } catch (err) {
    await avisar(err.message, "Error");
  }
}

async function crearUsuario() {
  const errorDiv = document.getElementById("errorUsuario");
  errorDiv.classList.add("oculto");
  const rol = document.getElementById("nUserRol").value;
  try {
    await Api.post("/usuarios", {
      nombre: document.getElementById("nUserNombre").value.trim(),
      apellido: document.getElementById("nUserApellido").value.trim(),
      usuario: document.getElementById("nUserLogin").value.trim(),
      password: document.getElementById("nUserClave").value,
      rol,
      sucursal_id: rol === "bombero" ? Number(document.getElementById("nUserSucursal").value) : null,
      telefono: document.getElementById("nUserTelefono").value.trim(),
    });
    toggleFormUsuario(); // colapsa el formulario y limpia los campos
    listarUsuarios();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("oculto");
  }
}

async function toggleActivoUsuario(id, nuevoEstado) {
  await Api.put(`/usuarios/${id}`, { activo: nuevoEstado });
  listarUsuarios();
}

async function eliminarUsuario(id, nombre) {
  const confirmado = await confirmarAccion(`¿Eliminar definitivamente a ${nombre}? Esta acción no se puede deshacer.`, "Eliminar usuario");
  if (!confirmado) return;
  try {
    await Api.delete(`/usuarios/${id}`);
    listarUsuarios();
  } catch (err) {
    avisar(err.message, "Error");
  }
}

/**
 * Muestra un mensajito de confirmación discreto dentro de la tarjeta (ej. "✓ Guardado")
 * que desaparece solo, en vez de usar alert() del navegador (que en celular tapa toda
 * la pantalla con un modal nativo bastante intrusivo).
 */
function mostrarConfirmacion(elementId, mensaje) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = mensaje;
  clearTimeout(el._timeoutConfirmacion);
  el._timeoutConfirmacion = setTimeout(() => { el.textContent = ""; }, 2000);
}

// ---------- Reglas de descuento ----------
// Antes era una fila por cada combinación tipo de socio + combustible (6 filas sueltas
// con solo 2 tipos y 3 combustibles). Ahora es una matriz: tipos de socio como filas,
// combustibles como columnas, editable celda por celda — mucho más fácil de escanear.
async function cargarReglas() {
  const cont = document.getElementById("tab-reglas");
  await cargarCatalogos();
  cont.innerHTML = `
    <div class="tarjeta">
      <h3>Descuento por tipo de socio y combustible ($/litro)</h3>
      <button class="secundario" onclick="toggleFormTipoSocio()">+ Agregar tipo de socio</button>
      <div id="formTipoSocio" class="oculto" style="border:1px solid var(--borde); border-radius:8px; padding:16px; margin-top:12px; background:#fafbfc;">
        <div class="grid-2">
          <div><label>Nombre</label><input id="nTipoSocioNombre"></div>
          <div><label>Descripción (opcional)</label><input id="nTipoSocioDescripcion"></div>
        </div>
        <div style="margin-top:12px; display:flex; gap:8px;">
          <button class="primario" style="margin-top:0;" onclick="crearTipoSocio()">Guardar</button>
          <button class="secundario" onclick="toggleFormTipoSocio()">Cancelar</button>
        </div>
        <div id="errorTipoSocio" class="mensaje-error oculto"></div>
      </div>
      <div id="confirmReglas" class="chico" style="color:var(--verde); font-weight:600; min-height:18px; margin-top:10px;"></div>
      <div id="matrizReglas">${skeletonLineas(4)}</div>
    </div>`;
  await refrescarMatrizReglas();
}

/** Muestra u oculta el mini formulario para crear un tipo de socio nuevo (y limpia los campos al cerrarlo). */
function toggleFormTipoSocio() {
  const div = document.getElementById("formTipoSocio");
  div.classList.toggle("oculto");
  if (div.classList.contains("oculto")) {
    document.getElementById("nTipoSocioNombre").value = "";
    document.getElementById("nTipoSocioDescripcion").value = "";
    document.getElementById("errorTipoSocio").classList.add("oculto");
  }
}

async function crearTipoSocio() {
  const errorDiv = document.getElementById("errorTipoSocio");
  errorDiv.classList.add("oculto");
  const nombre = document.getElementById("nTipoSocioNombre").value.trim();
  if (!nombre) {
    errorDiv.textContent = "El nombre es obligatorio.";
    errorDiv.classList.remove("oculto");
    return;
  }
  try {
    await Api.post("/catalogos/tipos-socio", {
      nombre,
      descripcion: document.getElementById("nTipoSocioDescripcion").value.trim(),
    });
    toggleFormTipoSocio(); // colapsa el formulario y limpia los campos
    await cargarCatalogos(); // recarga catalogos.tiposSocio con el nuevo tipo
    await refrescarMatrizReglas();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("oculto");
  }
}

async function refrescarMatrizReglas() {
  const rows = await Api.get("/catalogos/reglas-descuento");
  const indice = {};
  rows.forEach((r) => { indice[`${r.tipo_socio_id}-${r.combustible_id}`] = r; });

  const encabezados = catalogos.combustibles.map((c) => `<th>${c.nombre}</th>`).join("");
  const filas = catalogos.tiposSocio.map((t) => {
    const celdas = catalogos.combustibles.map((c) => {
      const r = indice[`${t.id}-${c.id}`];
      const valor = r ? r.descuento_clp_litro : "0";
      return `<td>
        <div style="display:flex; gap:6px; align-items:center;">
          <input id="regla-${t.id}-${c.id}" type="number" step="0.01" value="${valor}" style="width:80px;">
          <button class="secundario" onclick="guardarReglaCelda(${t.id}, ${c.id})">✓</button>
        </div>
      </td>`;
    }).join("");
    return `<tr><td style="font-weight:600;">${t.nombre}</td>${celdas}</tr>`;
  }).join("");

  document.getElementById("matrizReglas").innerHTML = `
    <table>
      <tr><th></th>${encabezados}</tr>
      ${filas}
    </table>`;
}

async function guardarReglaCelda(tipoSocioId, combustibleId) {
  const valor = Number(document.getElementById(`regla-${tipoSocioId}-${combustibleId}`).value);
  const tipoSocio = catalogos.tiposSocio.find((t) => t.id === tipoSocioId);
  const combustible = catalogos.combustibles.find((c) => c.id === combustibleId);
  const confirmado = await confirmarAccion(
    `¿Confirmas el nuevo descuento de $${valor.toLocaleString("es-CL")}/L para ${tipoSocio ? tipoSocio.nombre : "este tipo de socio"} + ${combustible ? combustible.nombre : "este combustible"}?`,
    "Guardar descuento"
  );
  if (!confirmado) {
    await refrescarMatrizReglas(); // restaura el valor anterior en la celda (se canceló)
    return;
  }
  await Api.put("/catalogos/reglas-descuento", {
    tipo_socio_id: tipoSocioId,
    combustible_id: combustibleId,
    descuento_clp_litro: valor,
  });
  mostrarConfirmacion("confirmReglas", "✓ Guardado");
  await refrescarMatrizReglas();
}

// ---------- Precios ----------
// Mismo cambio que en Reglas: matriz combustible x sucursal en vez de una tabla plana
// más un formulario aparte para "precio nuevo" (la matriz ya cubre crear y editar, ya
// que muestra todas las combinaciones aunque todavía no tengan un precio cargado).
async function cargarPrecios() {
  const cont = document.getElementById("tab-precios");
  await cargarCatalogos();
  cont.innerHTML = `
    <div class="tarjeta">
      <h3>Precio por combustible y sucursal ($/litro)</h3>
      <p class="chico">Al guardar un precio nuevo no se pisa el anterior: queda un historial completo
      (cada transacción registrada conserva el precio que aplicaba ese día).</p>
      <button class="secundario" onclick="toggleFormSucursal()">+ Agregar sucursal</button>
      <div id="formSucursal" class="oculto" style="border:1px solid var(--borde); border-radius:8px; padding:16px; margin-top:12px; background:#fafbfc;">
        <div class="grid-2">
          <div><label>Nombre</label><input id="nSucursalNombre"></div>
          <div><label>Dirección (opcional)</label><input id="nSucursalDireccion"></div>
        </div>
        <div style="margin-top:12px; display:flex; gap:8px;">
          <button class="primario" style="margin-top:0;" onclick="crearSucursal()">Guardar</button>
          <button class="secundario" onclick="toggleFormSucursal()">Cancelar</button>
        </div>
        <div id="errorSucursal" class="mensaje-error oculto"></div>
      </div>
      <div id="confirmPrecios" class="chico" style="color:var(--verde); font-weight:600; min-height:18px; margin-top:10px;"></div>
      <div id="matrizPrecios">${skeletonLineas(4)}</div>
    </div>`;
  await refrescarMatrizPrecios();
}

/** Muestra u oculta el mini formulario para crear una sucursal nueva (y limpia los campos al cerrarlo). */
function toggleFormSucursal() {
  const div = document.getElementById("formSucursal");
  div.classList.toggle("oculto");
  if (div.classList.contains("oculto")) {
    document.getElementById("nSucursalNombre").value = "";
    document.getElementById("nSucursalDireccion").value = "";
    document.getElementById("errorSucursal").classList.add("oculto");
  }
}

async function crearSucursal() {
  const errorDiv = document.getElementById("errorSucursal");
  errorDiv.classList.add("oculto");
  const nombre = document.getElementById("nSucursalNombre").value.trim();
  if (!nombre) {
    errorDiv.textContent = "El nombre es obligatorio.";
    errorDiv.classList.remove("oculto");
    return;
  }
  try {
    await Api.post("/catalogos/sucursales", {
      nombre,
      direccion: document.getElementById("nSucursalDireccion").value.trim(),
    });
    toggleFormSucursal(); // colapsa el formulario y limpia los campos
    await cargarCatalogos(); // recarga catalogos.sucursales con la nueva
    await refrescarMatrizPrecios();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("oculto");
  }
}

async function refrescarMatrizPrecios() {
  const rows = await Api.get("/catalogos/precios");
  const indice = {};
  rows.forEach((p) => { indice[`${p.combustible_id}-${p.sucursal_id}`] = p; });

  const encabezados = catalogos.sucursales.map((s) => `<th>${s.nombre}</th>`).join("");
  const filas = catalogos.combustibles.map((c) => {
    const celdas = catalogos.sucursales.map((s) => {
      const p = indice[`${c.id}-${s.id}`];
      const valor = p ? p.precio_clp_litro : "";
      let tendencia = "";
      if (p && p.precio_anterior != null) {
        if (Number(p.precio_clp_litro) > Number(p.precio_anterior)) tendencia = '<span style="color:var(--rojo);">▲</span> ';
        else if (Number(p.precio_clp_litro) < Number(p.precio_anterior)) tendencia = '<span style="color:var(--verde);">▼</span> ';
      }
      const pie = p
        ? `<div class="chico" style="margin-top:2px;">${tendencia}act. ${new Date(p.vigente_desde).toLocaleDateString("es-CL")}
             · <a style="color:var(--dorado); cursor:pointer;" onclick="verHistorialPrecio(${s.id}, ${c.id}, '${s.nombre.replace(/'/g, "\\'")}', '${c.nombre.replace(/'/g, "\\'")}')">Ver historial</a></div>`
        : `<div class="chico" style="margin-top:2px;">Sin precio</div>`;
      return `<td>
        <div style="display:flex; gap:6px; align-items:center;">
          <input id="precio-${c.id}-${s.id}" type="number" step="0.01" value="${valor}" placeholder="$" style="width:90px;">
          <button class="secundario" onclick="guardarPrecioCelda(${s.id}, ${c.id})">✓</button>
        </div>
        ${pie}
      </td>`;
    }).join("");
    return `<tr><td style="font-weight:600;">${c.nombre}</td>${celdas}</tr>`;
  }).join("");

  document.getElementById("matrizPrecios").innerHTML = `
    <table>
      <tr><th></th>${encabezados}</tr>
      ${filas}
    </table>`;
}

/** Muestra en un modal el historial completo de precios de una combinación sucursal + combustible. */
async function verHistorialPrecio(sucursalId, combustibleId, sucursalNombre, combustibleNombre) {
  const rows = await Api.get(`/catalogos/precios/historial?sucursal_id=${sucursalId}&combustible_id=${combustibleId}`);
  const cont = document.getElementById("modalContenedor");
  cont.innerHTML = `
    <div class="overlay-modal">
      <div class="modal" style="max-width:460px; max-height:80vh; display:flex; flex-direction:column;">
        <h3 style="flex-shrink:0;">Historial de precios</h3>
        <p class="chico" style="margin:0 0 14px; flex-shrink:0;">${combustibleNombre} · ${sucursalNombre}</p>
        <div style="overflow:auto; max-width:100%; flex:1; min-height:0;">
          <table style="min-width:0; width:100%;">
            <tr><th>Fecha</th><th>Precio</th><th>Cambiado por</th></tr>
            ${rows.map((r) => `
              <tr>
                <td>${new Date(r.vigente_desde).toLocaleDateString("es-CL")}</td>
                <td>$${fmt(r.precio_clp_litro)}</td>
                <td>${r.creado_por_nombre ? `${r.creado_por_nombre} ${r.creado_por_apellido || ""}`.trim() : "-"}</td>
              </tr>`).join("") || '<tr><td colspan="3">Sin historial</td></tr>'}
          </table>
        </div>
        <div class="modal-botones" style="flex-shrink:0;">
          <button class="primario" onclick="document.getElementById('modalContenedor').innerHTML=''">Cerrar</button>
        </div>
      </div>
    </div>`;
}

async function guardarPrecioCelda(sucursalId, combustibleId) {
  const valor = Number(document.getElementById(`precio-${combustibleId}-${sucursalId}`).value);
  if (!valor || valor < 0) {
    avisar("Ingresa un precio válido.");
    return;
  }
  const sucursal = catalogos.sucursales.find((s) => s.id === sucursalId);
  const combustible = catalogos.combustibles.find((c) => c.id === combustibleId);
  const confirmado = await confirmarAccion(
    `¿Confirmas el nuevo precio de $${valor.toLocaleString("es-CL")}/L para ${combustible ? combustible.nombre : "este combustible"} en ${sucursal ? sucursal.nombre : "esta sucursal"}?`,
    "Guardar precio"
  );
  if (!confirmado) {
    await refrescarMatrizPrecios(); // restaura el valor anterior en la celda (se canceló)
    return;
  }
  await Api.post("/catalogos/precios", {
    sucursal_id: sucursalId,
    combustible_id: combustibleId,
    precio_clp_litro: valor,
  });
  mostrarConfirmacion("confirmPrecios", "✓ Guardado");
  await refrescarMatrizPrecios();
}

// Iniciar en la pestaña de reportes
cargarReportes();
