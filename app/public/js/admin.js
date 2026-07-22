requerirSesion("admin");

let catalogos = { sucursales: [], combustibles: [], tiposSocio: [] };
let ultimoHistorial = []; // guarda las filas cargadas para poder exportarlas
let ultimoReporte = null; // guarda el reporte cargado (totales + desgloses) para poder exportarlo
let ultimoReporteCuadres = null; // idem, para Reportes de cuadres

async function cargarCatalogos() {
  const [sucursales, combustibles, tiposSocio] = await Promise.all([
    Api.get("/catalogos/sucursales"),
    Api.get("/catalogos/combustibles"),
    Api.get("/catalogos/tipos-socio"),
  ]);
  catalogos = { sucursales, combustibles, tiposSocio };
}

function cambiarTab(nombre) {
  document.querySelectorAll(".sidebar-nav button[data-tab]").forEach((b) => b.classList.toggle("activo", b.dataset.tab === nombre));
  document.querySelectorAll(".tab-contenido").forEach((d) => d.classList.add("oculto"));
  document.getElementById(`tab-${nombre}`).classList.remove("oculto");
  const cargador = {
    reportes: cargarReportes, historial: cargarHistorial, socios: cargarSocios, bomberos: cargarBomberos,
    reglas: cargarReglas, precios: cargarPrecios,
    "cuadre-caja": cargarCuadreCaja, "historial-cuadres": cargarHistorialCuadres, "reportes-cuadres": cargarReportesCuadres,
    descargas: cargarDescargas,
  }[nombre];
  if (cargador) cargador();
}

/** Selector de sección (Socios/Caja) en mobile: muestra el sub-menú de esa sección y activa su primera pestaña. */
function cambiarSeccion(seccion) {
  document.querySelectorAll(".nav-selector-btn").forEach((b) => b.classList.toggle("activo", b.dataset.seccion === seccion));
  document.querySelectorAll(".nav-seccion").forEach((s) => s.classList.toggle("activa-movil", s.dataset.seccion === seccion));
  const primerBoton = document.querySelector(`.nav-seccion[data-seccion="${seccion}"] button[data-tab]`);
  if (primerBoton) cambiarTab(primerBoton.dataset.tab);
}

function fmt(n) { return Number(n || 0).toLocaleString("es-CL"); }

/**
 * Limpia en vivo un <input type="text" inputmode="decimal"> para que solo queden dígitos y
 * un único punto decimal (y convierte una coma a punto, por si el teclado del celular la
 * insertó). Se usa en vez de <input type="number"> para las lecturas de entrada/salida del
 * Cuadre de caja: en varios teclados/navegadores de Android, type="number" con decimales
 * dejaba el valor que lee JavaScript desincronizado del que se ve en pantalla — el admin
 * tecleaba una salida ya mayor a la entrada, pero seguía apareciendo el error de "la salida
 * no puede ser menor a la entrada" porque el valor real leído no era el que se veía tecleado.
 */
function sanearNumero(input) {
  let valor = input.value.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const primerPunto = valor.indexOf(".");
  if (primerPunto !== -1) {
    valor = valor.slice(0, primerPunto + 1) + valor.slice(primerPunto + 1).replace(/\./g, "");
  }
  if (valor !== input.value) input.value = valor;
}
// Diferencia = litros×precio - (efectivo+tarjeta+descuentos). Positiva = el combustible
// vendido vale más que lo recibido -> falta plata (alarma, rojo). Negativa = sobró plata
// respecto al combustible vendido -> no es una falta real (verde).
function colorDiferencia(v) { return v > 0 ? "var(--rojo)" : "var(--verde)"; }

/** Muestra un modal propio de sí/no (reemplaza confirm() nativo). Devuelve una Promise<boolean>.
 * El mensaje y el título se tratan como texto plano (se escapan): varios llamados interpolan
 * nombres guardados en la base, que no deben poder inyectar HTML. */
function confirmarAccion(mensaje, titulo = "Confirmar acción") {
  return new Promise((resolve) => {
    const cont = document.getElementById("modalContenedor");
    cont.innerHTML = `
      <div class="overlay-modal">
        <div class="modal">
          <h3>${escaparHtml(titulo)}</h3>
          <p>${escaparHtml(mensaje)}</p>
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

/** Muestra un modal propio de aviso con un solo botón (reemplaza alert() nativo). Mensaje y
 * título se escapan igual que en confirmarAccion (pueden traer nombres/descripciones de la base). */
function avisar(mensaje, titulo = "Aviso") {
  return new Promise((resolve) => {
    const cont = document.getElementById("modalContenedor");
    cont.innerHTML = `
      <div class="overlay-modal">
        <div class="modal">
          <h3>${escaparHtml(titulo)}</h3>
          <p>${escaparHtml(mensaje)}</p>
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
          <h3>${escaparHtml(titulo)}</h3>
          <p style="margin-bottom:10px;">${escaparHtml(mensaje)}</p>
          <input id="modalInputTexto" type="${tipo}" value="${escaparHtml(opciones.valorInicial || "")}" autofocus>
          <div id="modalInputError" class="mensaje-error oculto" style="margin-top:10px;"></div>
          <div class="modal-botones">
            <button class="secundario" id="modalCancelar">Cancelar</button>
            <button class="primario" id="modalAceptar">Confirmar</button>
          </div>
        </div>
      </div>`;
    const input = document.getElementById("modalInputTexto");
    if (opciones.valorInicial) input.select();
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
  await cargarCatalogos();
  const hoy = fechaLocalISO(new Date());
  const opcionesSucursal = catalogos.sucursales.map((s) => `<option value="${s.id}">${escaparHtml(s.nombre)}</option>`).join("");
  cont.innerHTML = `
    <div class="tarjeta">
      <div class="grid-2">
        <div><label>Desde</label><input type="date" id="reporteDesde" value="${hoy}"></div>
        <div><label>Hasta</label><input type="date" id="reporteHasta" value="${hoy}"></div>
        <div><label>Sucursal</label><select id="reporteSucursal"><option value="">Todas</option>${opcionesSucursal}</select></div>
      </div>
      <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="secundario" onclick="filtroReporteRapido('hoy')">Hoy</button>
        <button class="secundario" onclick="filtroReporteRapido('semana')">Esta semana</button>
        <button class="secundario" onclick="filtroReporteRapido('mes')">Este mes</button>
        <button class="secundario" onclick="filtroReporteRapido('todo')">Todo (histórico)</button>
        <button class="primario" style="margin-top:0;" onclick="buscarReportes()">Filtrar</button>
        <button class="limpiar-filtros" onclick="limpiarFiltrosReportes()">✕ Limpiar filtros</button>
        <button class="exportar" onclick="exportarReporteCSV()">📥 Exportar a Excel</button>
      </div>
    </div>
    <div id="resultadoReportes"></div>`;
  buscarReportes();
}

/** Vuelve al estado por defecto de la pestaña (el día de hoy), igual que al abrirla. */
function limpiarFiltrosReportes() {
  document.getElementById("reporteSucursal").value = "";
  filtroReporteRapido("hoy");
}

/** "hoy"/"semana" (empieza lunes)/"mes"/cualquier otra cosa = todo. Usado por los filtros rápidos de Reportes (socios y cuadres). */
function rangoRapido(tipo) {
  const hoy = new Date();
  if (tipo === "hoy") {
    return { desde: fechaLocalISO(hoy), hasta: fechaLocalISO(hoy) };
  }
  if (tipo === "semana") {
    const inicioSemana = new Date(hoy);
    const diaSemana = inicioSemana.getDay(); // 0 = domingo
    const diff = diaSemana === 0 ? 6 : diaSemana - 1; // semana empieza el lunes
    inicioSemana.setDate(inicioSemana.getDate() - diff);
    return { desde: fechaLocalISO(inicioSemana), hasta: fechaLocalISO(hoy) };
  }
  if (tipo === "mes") {
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    return { desde: fechaLocalISO(inicioMes), hasta: fechaLocalISO(hoy) };
  }
  return { desde: "", hasta: "" };
}

function filtroReporteRapido(tipo) {
  const { desde, hasta } = rangoRapido(tipo);
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

/** Suma los litros del detalle (que viene por sucursal + combustible) agrupados solo por combustible. */
function litrosPorCombustible(detalle) {
  const indice = {};
  detalle.forEach((r) => { indice[r.combustible] = (indice[r.combustible] || 0) + Number(r.litros); });
  return Object.entries(indice).sort((a, b) => a[0].localeCompare(b[0]));
}

/** Igual que litrosPorCombustible() pero sumando el monto total — usado en el desglose de
 * Reportes de cuadres (litros/monto_total), que reutiliza la misma forma de fila. */
function montoPorCombustible(detalle) {
  const indice = {};
  detalle.forEach((r) => { indice[r.combustible] = (indice[r.combustible] || 0) + Number(r.monto_total); });
  return Object.entries(indice).sort((a, b) => a[0].localeCompare(b[0]));
}

/** Igual que litrosPorCombustible() pero sumando el descuento otorgado — si el filtro de
 * sucursal está en "Todas", el detalle trae ambas y acá quedan sumadas en un solo total. */
function descuentoPorCombustible(detalle) {
  const indice = {};
  detalle.forEach((r) => { indice[r.combustible] = (indice[r.combustible] || 0) + Number(r.descuento_total); });
  return Object.entries(indice).sort((a, b) => a[0].localeCompare(b[0]));
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
  const sucursalId = document.getElementById("reporteSucursal").value;
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  if (sucursalId) params.set("sucursal_id", sucursalId);

  const cont = document.getElementById("resultadoReportes");
  cont.innerHTML = `<div class="tarjeta">${skeletonLineas(4)}</div>`;
  const data = await Api.get(`/reportes/resumen?${params.toString()}`);

  const rangoTexto = desde || hasta
    ? `Período: ${desde || "el inicio"} a ${hasta || "hoy"}`
    : "Todo el histórico (desde que se instaló la app)";
  const sucursal = sucursalId ? catalogos.sucursales.find((s) => s.id === Number(sucursalId)) : null;
  const sucursalTexto = sucursal ? sucursal.nombre : "Todas";

  ultimoReporte = { ...data, rangoTexto, sucursalTexto };

  // Antes había dos tablas separadas (por sucursal y por combustible) que no conectaban
  // de dónde salía cada total. Ahora es una sola tabla: sucursal + combustible en cada
  // fila, con un subtotal por sucursal, para ver la trazabilidad completa.
  const grupos = agruparDetallePorSucursal(data.detalle);
  const litrosCombustible = litrosPorCombustible(data.detalle);
  const descuentoCombustible = descuentoPorCombustible(data.detalle);
  const litrosCombustibleHtml = litrosCombustible.length
    ? `<div class="grid-2">${litrosCombustible.map(([c, l]) => `<div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">${escaparHtml(c)}</div><div style="font-size:17px; font-weight:600;">${fmt(l)} L</div></div>`).join("")}</div>`
    : `<p class="chico">Sin datos</p>`;
  const descuentoCombustibleHtml = descuentoCombustible.length
    ? `<div class="grid-2">${descuentoCombustible.map(([c, d]) => `<div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">${escaparHtml(c)}</div><div style="font-size:17px; font-weight:600;">$${fmt(d)}</div></div>`).join("")}</div>`
    : `<p class="chico">Sin datos</p>`;

  cont.innerHTML = `
    <div class="tarjeta">
      <p class="chico">${rangoTexto} · Sucursal: ${escaparHtml(sucursalTexto)}</p>
      <h3>Totales</h3>
      <div class="grid-2" style="margin-top:10px;">
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">Transacciones</div><div style="font-size:17px; font-weight:600;">${fmt(data.totales.transacciones)}</div></div>
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">Litros totales</div><div style="font-size:17px; font-weight:600;">${fmt(data.totales.litros)} L</div></div>
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">Descuento otorgado</div><div style="font-size:17px; font-weight:600;">$${fmt(data.totales.descuento_total)}</div></div>
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">Total cobrado</div><div style="font-size:17px; font-weight:600;">$${fmt(data.totales.monto_total)}</div></div>
      </div>
      <h3 style="margin-top:16px;">Litros por combustible</h3>
      ${litrosCombustibleHtml}
      <h3 style="margin-top:16px;">Descuento por combustible</h3>
      ${descuentoCombustibleHtml}
    </div>
    <div class="tarjeta">
      <h3>Detalle por sucursal y combustible</h3>
      <table>
        <tr><th>Sucursal</th><th>Combustible</th><th>Litros</th><th>Descuento</th><th>Total cobrado</th></tr>
        ${grupos.map((g) => {
          const sub = subtotalGrupo(g.filas);
          const filasHtml = g.filas.map((r) => `<tr><td>${escaparHtml(r.sucursal)}</td><td>${escaparHtml(r.combustible)}</td><td>${fmt(r.litros)}</td><td>$${fmt(r.descuento_total)}</td><td>$${fmt(r.monto_total)}</td></tr>`).join("");
          const subtotalHtml = `<tr style="font-weight:600; background:#f4f5f7;"><td colspan="2">Subtotal ${escaparHtml(g.sucursal)}</td><td>${fmt(sub.litros)}</td><td>$${fmt(sub.descuento_total)}</td><td>$${fmt(sub.monto_total)}</td></tr>`;
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

  const { totales, detalle, rangoTexto, sucursalTexto } = ultimoReporte;
  const grupos = agruparDetallePorSucursal(detalle);
  const litrosCombustible = litrosPorCombustible(detalle);
  const descuentoCombustible = descuentoPorCombustible(detalle);

  const lineas = [];
  lineas.push(filaCsv([rangoTexto]));
  lineas.push(filaCsv(["Sucursal", sucursalTexto]));
  lineas.push("");
  lineas.push(filaCsv(["Totales"]));
  lineas.push(filaCsv(["Transacciones", "Litros totales", "Descuento total", "Total cobrado"]));
  lineas.push(filaCsv([totales.transacciones, totales.litros, totales.descuento_total, totales.monto_total]));
  lineas.push("");
  lineas.push(filaCsv(["Litros por combustible"]));
  lineas.push(filaCsv(["Combustible", "Litros"]));
  litrosCombustible.forEach(([c, l]) => lineas.push(filaCsv([c, l])));
  lineas.push("");
  lineas.push(filaCsv(["Descuento por combustible"]));
  lineas.push(filaCsv(["Combustible", "Descuento"]));
  descuentoCombustible.forEach(([c, d]) => lineas.push(filaCsv([c, d])));
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
let sumaDescuentosHistorial = 0; // suma de TODAS las filas que calzan con el filtro, no solo la página actual
const POR_PAGINA_HISTORIAL = 500;

let preciosCacheTraspaso = []; // filas de /catalogos/precios, para mostrar el precio vigente en el dropdown de combustible del traspaso

async function cargarHistorial() {
  const cont = document.getElementById("tab-historial");
  await cargarCatalogos();
  usuariosCacheHistorial = await Api.get("/usuarios");
  preciosCacheTraspaso = await Api.get("/catalogos/precios");
  const opcionesSucursal = catalogos.sucursales.map((s) => `<option value="${s.id}">${escaparHtml(s.nombre)}</option>`).join("");
  const opcionesBombero = usuariosCacheHistorial.map((u) => `<option value="${u.id}">${escaparHtml(`${u.nombre} ${u.apellido || ""}`)}</option>`).join("");
  const primeraSucursal = catalogos.sucursales[0] ? catalogos.sucursales[0].id : null;
  const opcionesCombustibleTraspaso = opcionesCombustibleConPrecio(primeraSucursal);
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
      <button class="primario" style="margin-top:10px;" onclick="buscarHistorial()">Filtrar</button>
      <button class="limpiar-filtros" style="margin-top:10px;" onclick="limpiarFiltrosHistorial()">✕ Limpiar filtros</button>
      <button class="exportar" style="margin-top:10px;" onclick="exportarHistorialCSV()">📥 Exportar a Excel</button>
    </div>
    <div class="tarjeta">
      <button class="secundario" onclick="toggleFormTraspaso()">+ Registrar traspaso de combustible</button>
      <div id="formTraspaso" class="oculto" style="border:1px solid var(--borde); border-radius:8px; padding:16px; margin-top:12px; background:#fafbfc;">
        <p class="chico" style="margin-top:0;">Para cuando se mueve combustible entre estanques o hacia otra sucursal (no es una venta): queda en el historial con 100% de descuento para que el litraje cuadre en el cuadre de caja, pero no se suma en Reportes Descuentos.</p>
        <div class="grid-2">
          <div><label>Sucursal</label><select id="tSucursal" onchange="actualizarCombustiblesTraspaso()">${opcionesSucursal}</select></div>
          <div><label>Combustible</label><select id="tCombustible">${opcionesCombustibleTraspaso}</select></div>
          <div style="grid-column:1 / -1;"><label>Litros</label><input id="tLitros" type="number" step="0.001" min="0.001" placeholder="0"></div>
        </div>
        <div style="margin-top:12px; display:flex; gap:8px;">
          <button class="primario" style="margin-top:0;" onclick="registrarTraspaso()">Guardar</button>
          <button class="secundario" onclick="toggleFormTraspaso()">Cancelar</button>
        </div>
        <div id="errorTraspaso" class="mensaje-error oculto"></div>
      </div>
    </div>
    <div class="tarjeta"><div id="tablaHistorial">${skeletonLineas(6)}</div></div>`;
  buscarHistorial();
}

/** Arma las <option> de combustible para el form de traspaso, con el precio vigente de la sucursal indicada. */
function opcionesCombustibleConPrecio(sucursalId) {
  return catalogos.combustibles.map((c) => {
    const precio = preciosCacheTraspaso.find((p) => p.combustible_id === c.id && p.sucursal_id === Number(sucursalId));
    const etiquetaPrecio = precio ? `$${fmt(precio.precio_clp_litro)}/L` : "sin precio configurado";
    return `<option value="${c.id}">${escaparHtml(c.nombre)} — ${etiquetaPrecio}</option>`;
  }).join("");
}

/** Se llama al cambiar la sucursal del form de traspaso, para refrescar el precio mostrado junto a cada combustible
 *  sin perder el combustible que ya estaba elegido (el precio cambia, pero el combustible sigue siendo el mismo). */
function actualizarCombustiblesTraspaso() {
  const sucursalId = document.getElementById("tSucursal").value;
  const select = document.getElementById("tCombustible");
  const elegidoPrevio = select.value;
  select.innerHTML = opcionesCombustibleConPrecio(sucursalId);
  if (catalogos.combustibles.some((c) => String(c.id) === elegidoPrevio)) {
    select.value = elegidoPrevio;
  }
}

/** Muestra u oculta el mini formulario para registrar un traspaso de combustible (y limpia los campos al cerrarlo). */
function toggleFormTraspaso() {
  const div = document.getElementById("formTraspaso");
  div.classList.toggle("oculto");
  if (div.classList.contains("oculto")) {
    document.getElementById("tLitros").value = "";
    document.getElementById("errorTraspaso").classList.add("oculto");
  }
}

async function registrarTraspaso() {
  const errorDiv = document.getElementById("errorTraspaso");
  errorDiv.classList.add("oculto");
  const datos = {
    sucursal_id: Number(document.getElementById("tSucursal").value),
    combustible_id: Number(document.getElementById("tCombustible").value),
    litros: document.getElementById("tLitros").value,
  };
  try {
    await Api.post("/transacciones/traspaso", datos);
    toggleFormTraspaso();
    buscarHistorial();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("oculto");
  }
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
  sumaDescuentosHistorial = Number(data.suma_descuentos);
  document.getElementById("tablaHistorial").innerHTML = `
    <p class="chico">Total del período: <strong>$${fmt(sumaDescuentosHistorial)}</strong> en descuentos (${fmt(totalHistorial)} registros; el total no suma los traspasos internos)</p>
    <table>
      <tr><th>Fecha</th><th>Hora</th><th>Sucursal</th><th>Bombero</th><th>RUT</th><th>Nombre socio</th><th>Combustible</th><th>Litros</th><th>Precio/L</th><th>Descuento</th><th>Total cobrado</th></tr>
      ${rows.map((t) => {
        const fechaHora = new Date(t.creado_en);
        const rutMostrado = t.socio_dv ? `${t.rut_consultado}-${t.socio_dv}` : t.rut_consultado;
        return `
        <tr>
          <td data-etiqueta="Fecha">${fechaHora.toLocaleDateString("es-CL")}</td>
          <td data-etiqueta="Hora">${fechaHora.toLocaleTimeString("es-CL")}</td>
          <td data-etiqueta="Sucursal">${escaparHtml(t.sucursal_nombre)}</td>
          <td data-etiqueta="Bombero">${escaparHtml(`${t.bombero_nombre} ${t.bombero_apellido || ""}`)}</td>
          <td data-etiqueta="RUT">${escaparHtml(rutMostrado)}</td>
          <td data-etiqueta="Nombre socio">${t.socio_nombre ? escaparHtml(`${t.socio_nombre} ${t.socio_apellido || ""}`) : "(no socio)"}</td>
          <td data-etiqueta="Combustible">${escaparHtml(t.combustible_nombre)}</td>
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

/** Arma pares [etiqueta, valor] con los filtros de Historial actualmente aplicados (con nombre,
 * no solo el id, para sucursal/bombero), para dejarlos documentados en el CSV exportado. */
function resumenFiltrosHistorial() {
  const desde = document.getElementById("filtroDesde").value;
  const hasta = document.getElementById("filtroHasta").value;
  const rut = document.getElementById("filtroRut").value.trim();
  const sucursalId = document.getElementById("filtroSucursal").value;
  const bomberoId = document.getElementById("filtroBombero").value;
  const precioMin = document.getElementById("filtroPrecioMin").value;
  const precioMax = document.getElementById("filtroPrecioMax").value;

  const sucursal = sucursalId ? catalogos.sucursales.find((s) => s.id === Number(sucursalId)) : null;
  const bombero = bomberoId ? usuariosCacheHistorial.find((u) => u.id === Number(bomberoId)) : null;
  const periodo = desde || hasta
    ? `${desde || "el inicio"} a ${hasta || "hoy"}`
    : "Todo el histórico (desde que se instaló la app)";

  return [
    ["Período", periodo],
    ["RUT", rut || "(todos)"],
    ["Sucursal", sucursal ? sucursal.nombre : "(todas)"],
    ["Bombero", bombero ? `${bombero.nombre} ${bombero.apellido || ""}`.trim() : "(todos)"],
    ["Precio/L mínimo", precioMin || "(sin filtro)"],
    ["Precio/L máximo", precioMax || "(sin filtro)"],
  ];
}

/**
 * Exporta lo que está actualmente cargado en la tabla de historial a un archivo CSV,
 * que Excel abre directo (doble click). Usa punto y coma como separador y BOM UTF-8
 * para que Excel en español reconozca bien las columnas y las tildes. Antes de la tabla
 * deja documentados los filtros con los que se generó, para no perder ese contexto una
 * vez que el archivo se guarda o se comparte.
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

  const lineasFiltros = resumenFiltrosHistorial().map(([etiqueta, valor]) => [etiqueta, valor].map(escaparCsv).join(";"));
  const lineaTotal = ["Total del período", `$${fmt(data.suma_descuentos)} en descuentos (${filasHistorial.length} registros; el total no suma los traspasos internos)`].map(escaparCsv).join(";");

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

  const csv = [...lineasFiltros, lineaTotal, "", encabezados.join(";"), ...filas].join("\r\n");
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
let ultimosSocios = []; // guarda la última lista cargada para poder prellenar el formulario al editar
let socioEditandoId = null; // id del socio en edición, o null si el formulario está en modo "agregar"

async function cargarSocios() {
  const cont = document.getElementById("tab-socios");
  await cargarCatalogos();
  const opcionesTipo = catalogos.tiposSocio
    .map((t) => `<option value="${t.id}" data-descripcion="${escaparHtml(t.descripcion || "")}">${escaparHtml(t.nombre)}</option>`)
    .join("");
  cont.innerHTML = `
    <div class="tarjeta">
      <button class="secundario" onclick="toggleFormSocio()">+ Agregar socio</button>
      <div id="formSocio" class="oculto" style="border:1px solid var(--borde); border-radius:8px; padding:16px; margin-top:12px; background:#fafbfc;">
        <h3 id="formSocioTitulo" style="margin-top:0;">Agregar socio nuevo</h3>
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
    document.getElementById("nSocioRut").disabled = false;
    document.getElementById("nSocioNombre").value = "";
    document.getElementById("nSocioApellido").value = "";
    document.getElementById("nSocioTelefono").value = "";
    document.getElementById("nSocioDireccion").value = "";
    document.getElementById("errorSocio").classList.add("oculto");
    document.getElementById("formSocioTitulo").textContent = "Agregar socio nuevo";
    socioEditandoId = null;
  } else {
    mostrarDescripcionTipoSocio();
  }
}

/** Abre el formulario prellenado con los datos de un socio existente, para editarlo (el RUT no se puede cambiar). */
function editarSocio(id) {
  const s = ultimosSocios.find((x) => x.id === id);
  if (!s) return;
  socioEditandoId = id;
  document.getElementById("formSocio").classList.remove("oculto");
  document.getElementById("formSocioTitulo").textContent = "Editar socio";
  document.getElementById("nSocioRut").value = `${s.rut}-${s.dv}`;
  document.getElementById("nSocioRut").disabled = true;
  document.getElementById("nSocioTipo").value = s.tipo_socio_id;
  document.getElementById("nSocioNombre").value = s.nombre;
  document.getElementById("nSocioApellido").value = s.apellido || "";
  document.getElementById("nSocioTelefono").value = s.telefono || "";
  document.getElementById("nSocioDireccion").value = s.direccion || "";
  document.getElementById("errorSocio").classList.add("oculto");
  mostrarDescripcionTipoSocio();
  document.getElementById("formSocio").scrollIntoView({ behavior: "smooth", block: "start" });
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
  ultimosSocios = rows;
  document.getElementById("tablaSocios").innerHTML = `
    <table>
      <tr><th>RUT</th><th>Nombre</th><th>Teléfono</th><th>Dirección</th><th>Tipo</th><th>Activo</th><th>Registro</th><th></th><th></th><th></th></tr>
      ${rows.map((s) => `
        <tr>
          <td data-etiqueta="RUT">${escaparHtml(s.rut)}-${escaparHtml(s.dv)}</td>
          <td data-etiqueta="Nombre">${escaparHtml(`${s.nombre} ${s.apellido || ""}`)}</td>
          <td data-etiqueta="Teléfono">${escaparHtml(s.telefono || "-")}</td>
          <td data-etiqueta="Dirección">${escaparHtml(s.direccion || "-")}</td>
          <td data-etiqueta="Tipo">${escaparHtml(s.tipo_socio_nombre)}</td>
          <td data-etiqueta="Activo">${s.activo ? "Sí" : "No"}</td>
          <td data-etiqueta="Registro">${new Date(s.fecha_registro).toLocaleDateString("es-CL")}</td>
          <td><button class="secundario" onclick="editarSocio(${s.id})">Editar</button></td>
          <td><button class="secundario" onclick="toggleActivoSocio(${s.id}, ${!s.activo})">${s.activo ? "Desactivar" : "Activar"}</button></td>
          <td><button class="secundario" style="color:#c0392b; border-color:#c0392b;" onclick="eliminarSocio(${s.id})">Eliminar</button></td>
        </tr>`).join("") || '<tr><td colspan="10">Sin resultados</td></tr>'}
    </table>`;
}

async function crearSocio() {
  const errorDiv = document.getElementById("errorSocio");
  errorDiv.classList.add("oculto");
  const datos = {
    rut: document.getElementById("nSocioRut").value.trim(),
    tipo_socio_id: Number(document.getElementById("nSocioTipo").value),
    nombre: document.getElementById("nSocioNombre").value.trim(),
    apellido: document.getElementById("nSocioApellido").value.trim(),
    telefono: document.getElementById("nSocioTelefono").value.trim(),
    direccion: document.getElementById("nSocioDireccion").value.trim(),
  };
  try {
    if (socioEditandoId) {
      await Api.put(`/socios/${socioEditandoId}`, datos);
    } else {
      await Api.post("/socios", datos);
    }
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

/** El nombre se busca por id en la lista ya cargada, en vez de viajar interpolado dentro del
 * atributo onclick del botón (donde un nombre con comillas rompía el HTML). */
async function eliminarSocio(id) {
  const s = ultimosSocios.find((x) => x.id === id);
  const nombre = s ? `${s.nombre} ${s.apellido || ""}`.trim() : "este socio";
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
let ultimosUsuarios = []; // guarda la última lista cargada para poder prellenar el formulario al editar
let usuarioEditandoId = null; // id del usuario en edición, o null si el formulario está en modo "agregar"

async function cargarBomberos() {
  const cont = document.getElementById("tab-bomberos");
  await cargarCatalogos();
  const opcionesSucursal = catalogos.sucursales.map((s) => `<option value="${s.id}">${escaparHtml(s.nombre)}</option>`).join("");
  cont.innerHTML = `
    <div class="tarjeta">
      <button class="secundario" onclick="toggleFormUsuario()">+ Agregar usuario</button>
      <div id="formUsuario" class="oculto" style="border:1px solid var(--borde); border-radius:8px; padding:16px; margin-top:12px; background:#fafbfc;">
        <h3 id="formUsuarioTitulo" style="margin-top:0;">Agregar usuario nuevo</h3>
        <div class="grid-2">
          <div><label>Nombre</label><input id="nUserNombre"></div>
          <div><label>Apellido</label><input id="nUserApellido"></div>
          <div><label>Usuario (login)</label><input id="nUserLogin"></div>
          <div><label>RUT (opcional)</label><input id="nUserRut" placeholder="12345678-9"></div>
          <div><label id="nUserClaveLabel">Clave</label><input id="nUserClave" type="password"></div>
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
    document.getElementById("nUserLogin").disabled = false;
    document.getElementById("nUserRut").value = "";
    document.getElementById("nUserClave").value = "";
    document.getElementById("nUserClave").disabled = false;
    document.getElementById("nUserClaveLabel").textContent = "Clave";
    document.getElementById("nUserRol").value = "bombero";
    document.getElementById("nUserRol").disabled = false;
    document.getElementById("bloqueSucursal").classList.remove("oculto");
    document.getElementById("nUserTelefono").value = "";
    document.getElementById("errorUsuario").classList.add("oculto");
    document.getElementById("formUsuarioTitulo").textContent = "Agregar usuario nuevo";
    usuarioEditandoId = null;
  }
}

/**
 * Abre el formulario prellenado con los datos de un usuario existente, para editarlo. El
 * "Usuario (login)" y el "Rol" no se pueden cambiar (el backend no lo permite); la clave se
 * deja para el botón "Cambiar clave" de la tabla, no se toca desde este formulario.
 */
function editarUsuario(id) {
  const u = ultimosUsuarios.find((x) => x.id === id);
  if (!u) return;
  usuarioEditandoId = id;
  document.getElementById("formUsuario").classList.remove("oculto");
  document.getElementById("formUsuarioTitulo").textContent = "Editar usuario";
  document.getElementById("nUserNombre").value = u.nombre;
  document.getElementById("nUserApellido").value = u.apellido || "";
  document.getElementById("nUserLogin").value = u.usuario;
  document.getElementById("nUserLogin").disabled = true;
  document.getElementById("nUserRut").value = u.rut ? `${u.rut}-${u.dv}` : "";
  document.getElementById("nUserClave").value = "";
  document.getElementById("nUserClave").disabled = true;
  document.getElementById("nUserClaveLabel").textContent = "Clave (usa \"Cambiar clave\" en la tabla)";
  document.getElementById("nUserRol").value = u.rol;
  document.getElementById("nUserRol").disabled = true;
  document.getElementById("bloqueSucursal").classList.toggle("oculto", u.rol === "admin");
  document.getElementById("nUserSucursal").value = u.sucursal_id || "";
  document.getElementById("nUserTelefono").value = u.telefono || "";
  document.getElementById("errorUsuario").classList.add("oculto");
  document.getElementById("formUsuario").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function listarUsuarios() {
  const rows = await Api.get("/usuarios");
  ultimosUsuarios = rows;
  document.getElementById("tablaUsuarios").innerHTML = `
    <table>
      <tr><th>Nombre</th><th>Usuario</th><th>RUT</th><th>Teléfono</th><th>Rol</th><th>Sucursal</th><th>Activo</th><th>Creado</th><th></th><th></th><th></th><th></th></tr>
      ${rows.map((u) => `
        <tr>
          <td data-etiqueta="Nombre">${escaparHtml(`${u.nombre} ${u.apellido || ""}`)}</td>
          <td data-etiqueta="Usuario">${escaparHtml(u.usuario)}</td>
          <td data-etiqueta="RUT">${u.rut ? escaparHtml(`${u.rut}-${u.dv}`) : "-"}</td>
          <td data-etiqueta="Teléfono">${escaparHtml(u.telefono || "-")}</td>
          <td data-etiqueta="Rol">${escaparHtml(u.rol)}</td>
          <td data-etiqueta="Sucursal">${escaparHtml(u.sucursal_nombre || "-")}</td>
          <td data-etiqueta="Activo">${u.activo ? "Sí" : "No"}</td>
          <td data-etiqueta="Creado">${new Date(u.creado_en).toLocaleDateString("es-CL")}</td>
          <td><button class="secundario" onclick="editarUsuario(${u.id})">Editar</button></td>
          <td><button class="secundario" onclick="cambiarClaveUsuario(${u.id})">Cambiar clave</button></td>
          <td><button class="secundario" onclick="toggleActivoUsuario(${u.id}, ${!u.activo})">${u.activo ? "Desactivar" : "Activar"}</button></td>
          <td><button class="secundario" style="color:#c0392b; border-color:#c0392b;" onclick="eliminarUsuario(${u.id})">Eliminar</button></td>
        </tr>`).join("")}
    </table>`;
}

/** Pide una clave nueva (con confirmación de mínimo 4 caracteres) y la guarda para ese usuario.
 * El nombre se busca por id (no viaja por el onclick, donde un nombre con comillas rompía el HTML). */
async function cambiarClaveUsuario(id) {
  const u = ultimosUsuarios.find((x) => x.id === id);
  const nombre = u ? `${u.nombre} ${u.apellido || ""}`.trim() : "este usuario";
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
  const rutInput = document.getElementById("nUserRut").value.trim();
  const datos = {
    nombre: document.getElementById("nUserNombre").value.trim(),
    apellido: document.getElementById("nUserApellido").value.trim(),
    sucursal_id: rol === "bombero" ? Number(document.getElementById("nUserSucursal").value) : null,
    telefono: document.getElementById("nUserTelefono").value.trim(),
    rut: rutInput || undefined,
  };
  if (!usuarioEditandoId) {
    datos.usuario = document.getElementById("nUserLogin").value.trim();
    datos.password = document.getElementById("nUserClave").value;
    datos.rol = rol;
  }
  try {
    if (usuarioEditandoId) {
      await Api.put(`/usuarios/${usuarioEditandoId}`, datos);
    } else {
      await Api.post("/usuarios", datos);
    }
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

async function eliminarUsuario(id) {
  const u = ultimosUsuarios.find((x) => x.id === id);
  const nombre = u ? `${u.nombre} ${u.apellido || ""}`.trim() : "este usuario";
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

  const encabezados = catalogos.combustibles.map((c) => `<th>${escaparHtml(c.nombre)}</th>`).join("");
  const filas = catalogos.tiposSocio.map((t) => {
    const celdas = catalogos.combustibles.map((c) => {
      const r = indice[`${t.id}-${c.id}`];
      const valor = r ? r.descuento_clp_litro : "0";
      return `<td>
        <div style="display:flex; gap:6px; align-items:center;">
          <input id="regla-${t.id}-${c.id}" type="number" step="1" value="${valor}" style="width:80px;">
          <button class="secundario" onclick="guardarReglaCelda(${t.id}, ${c.id})">✓</button>
        </div>
      </td>`;
    }).join("");
    return `<tr><td style="font-weight:600;">${escaparHtml(t.nombre)} <span style="color:var(--dorado); cursor:pointer; margin-left:4px;" onclick="verDescripcionTipoSocio(${t.id})" title="Ver descripción">ⓘ</span> <span style="color:var(--dorado); cursor:pointer; margin-left:2px;" onclick="editarNombreTipoSocio(${t.id})" title="Editar nombre">✏️</span> <span style="color:var(--rojo); cursor:pointer; margin-left:2px;" onclick="eliminarTipoSocio(${t.id})" title="Eliminar">🗑️</span></td>${celdas}</tr>`;
  }).join("");

  document.getElementById("matrizReglas").innerHTML = `
    <table>
      <tr><th></th>${encabezados}</tr>
      ${filas}
    </table>`;
}

/** Muestra en un modal la descripción del tipo de socio (accesible con click o tap, sirve igual en mobile que en PC). */
async function verDescripcionTipoSocio(tipoSocioId) {
  const tipo = catalogos.tiposSocio.find((t) => t.id === tipoSocioId);
  if (!tipo) return;
  await avisar(tipo.descripcion || "Sin descripción.", tipo.nombre);
}

/** Pide un nombre nuevo (prellenado con el actual) y lo guarda para ese tipo de socio. */
async function editarNombreTipoSocio(tipoSocioId) {
  const tipo = catalogos.tiposSocio.find((t) => t.id === tipoSocioId);
  if (!tipo) return;
  const nuevoNombre = await pedirTexto("Nuevo nombre para el tipo de socio:", "Editar tipo de socio", { valorInicial: tipo.nombre });
  if (nuevoNombre === null || nuevoNombre === tipo.nombre) return; // canceló o no cambió nada
  try {
    await Api.put(`/catalogos/tipos-socio/${tipoSocioId}`, { nombre: nuevoNombre });
    await cargarCatalogos(); // recarga catalogos.tiposSocio con el nombre nuevo
    await refrescarMatrizReglas();
  } catch (err) {
    await avisar(err.message, "Error");
  }
}

/** Elimina un tipo de socio, solo si no tiene socios ni reglas de descuento asociadas (lo rechaza la base de datos). */
async function eliminarTipoSocio(tipoSocioId) {
  const tipo = catalogos.tiposSocio.find((t) => t.id === tipoSocioId);
  if (!tipo) return;
  const confirmado = await confirmarAccion(`¿Eliminar definitivamente el tipo de socio "${tipo.nombre}"? Esta acción no se puede deshacer.`, "Eliminar tipo de socio");
  if (!confirmado) return;
  try {
    await Api.delete(`/catalogos/tipos-socio/${tipoSocioId}`);
    await cargarCatalogos();
    await refrescarMatrizReglas();
  } catch (err) {
    await avisar(err.message, "Error");
  }
}

async function guardarReglaCelda(tipoSocioId, combustibleId) {
  const valor = Math.round(Number(document.getElementById(`regla-${tipoSocioId}-${combustibleId}`).value));
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

/** Pide un nombre nuevo (prellenado con el actual) y lo guarda para esa sucursal. */
async function editarNombreSucursal(sucursalId) {
  const sucursal = catalogos.sucursales.find((s) => s.id === sucursalId);
  if (!sucursal) return;
  const nuevoNombre = await pedirTexto("Nuevo nombre para la sucursal:", "Editar sucursal", { valorInicial: sucursal.nombre });
  if (nuevoNombre === null || nuevoNombre === sucursal.nombre) return; // canceló o no cambió nada
  try {
    await Api.put(`/catalogos/sucursales/${sucursalId}`, { nombre: nuevoNombre });
    await cargarCatalogos(); // recarga catalogos.sucursales con el nombre nuevo
    await refrescarMatrizPrecios();
  } catch (err) {
    await avisar(err.message, "Error");
  }
}

/** Elimina una sucursal, solo si no tiene precios, transacciones ni usuarios asociados (lo rechaza la base de datos). */
async function eliminarSucursal(sucursalId) {
  const sucursal = catalogos.sucursales.find((s) => s.id === sucursalId);
  if (!sucursal) return;
  const confirmado = await confirmarAccion(`¿Eliminar definitivamente la sucursal "${sucursal.nombre}"? Esta acción no se puede deshacer.`, "Eliminar sucursal");
  if (!confirmado) return;
  try {
    await Api.delete(`/catalogos/sucursales/${sucursalId}`);
    await cargarCatalogos();
    await refrescarMatrizPrecios();
  } catch (err) {
    await avisar(err.message, "Error");
  }
}

async function refrescarMatrizPrecios() {
  const rows = await Api.get("/catalogos/precios");
  const indice = {};
  rows.forEach((p) => { indice[`${p.combustible_id}-${p.sucursal_id}`] = p; });

  const encabezados = catalogos.sucursales.map((s) => `<th>${escaparHtml(s.nombre)} <span style="color:var(--dorado); cursor:pointer; font-weight:normal;" onclick="editarNombreSucursal(${s.id})" title="Editar nombre">✏️</span> <span style="color:var(--rojo); cursor:pointer; font-weight:normal;" onclick="eliminarSucursal(${s.id})" title="Eliminar">🗑️</span></th>`).join("");
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
             · <a style="color:var(--dorado); cursor:pointer;" onclick="verHistorialPrecio(${s.id}, ${c.id})">Ver historial</a></div>`
        : `<div class="chico" style="margin-top:2px;">Sin precio</div>`;
      return `<td>
        <div style="display:flex; gap:6px; align-items:center;">
          <input id="precio-${c.id}-${s.id}" type="number" step="1" value="${valor}" placeholder="$" style="width:90px;">
          <button class="secundario" onclick="guardarPrecioCelda(${s.id}, ${c.id})">✓</button>
        </div>
        ${pie}
      </td>`;
    }).join("");
    return `<tr><td style="font-weight:600;">${escaparHtml(c.nombre)}</td>${celdas}</tr>`;
  }).join("");

  document.getElementById("matrizPrecios").innerHTML = `
    <table>
      <tr><th></th>${encabezados}</tr>
      ${filas}
    </table>`;
}

/** Muestra en un modal el historial de precios (últimos 25 cambios) de una combinación
 * sucursal + combustible. Los nombres se buscan por id en los catálogos ya cargados, en vez
 * de viajar interpolados por el onclick (donde una comilla en el nombre rompía el HTML). */
async function verHistorialPrecio(sucursalId, combustibleId) {
  const sucursal = catalogos.sucursales.find((s) => s.id === sucursalId);
  const combustible = catalogos.combustibles.find((c) => c.id === combustibleId);
  const rows = await Api.get(`/catalogos/precios/historial?sucursal_id=${sucursalId}&combustible_id=${combustibleId}`);
  const cont = document.getElementById("modalContenedor");
  cont.innerHTML = `
    <div class="overlay-modal">
      <div class="modal" style="max-width:460px; max-height:80vh; display:flex; flex-direction:column;">
        <h3 style="flex-shrink:0;">Historial de precios</h3>
        <p class="chico" style="margin:0 0 14px; flex-shrink:0;">${escaparHtml(combustible ? combustible.nombre : "?")} · ${escaparHtml(sucursal ? sucursal.nombre : "?")} · muestra los últimos ${rows.length === 25 ? "25" : rows.length} cambios</p>
        <div style="overflow:auto; max-width:100%; flex:1; min-height:0;">
          <table style="min-width:0; width:100%;">
            <tr><th>Fecha</th><th>Precio</th><th>Cambiado por</th></tr>
            ${rows.map((r) => `
              <tr>
                <td>${new Date(r.vigente_desde).toLocaleDateString("es-CL")}</td>
                <td>$${fmt(r.precio_clp_litro)}</td>
                <td>${r.creado_por_nombre ? escaparHtml(`${r.creado_por_nombre} ${r.creado_por_apellido || ""}`.trim()) : "-"}</td>
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
  const valor = Math.round(Number(document.getElementById(`precio-${combustibleId}-${sucursalId}`).value));
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

// ---------- Cuadre de caja ----------
let maquinasCacheCuadre = [];
let preciosCacheCuadre = [];
let bomberosCacheCuadre = []; // lista de usuarios (para el selector de "bomberos en turno" del cuadre)
let lecturasCuadre = []; // [{maquina_id, maquina_nombre, combustible_id, combustible_nombre, lectura_entrada, lectura_salida_guardada?}]
let cuadreInfo = null; // respuesta de GET /cuadres/turno: {existe, editable, turno, turno_inicio, turno_fin, efectivo_total, descuentos_total, cuadre?, bomberos?}
let cuadrePendienteToken = 0; // descarta respuestas viejas si el admin cambia sucursal/fecha/turno rápido

const NOMBRE_TURNO = { manana: "Mañana (20:00 - 08:00)", tarde: "Tarde (08:00 - 20:00)" };

// ---------- Borrador de Cuadre de caja (localStorage) ----------
// Guarda en el navegador (no en el servidor) lo que el admin va tecleando en un cuadre
// todavía no cerrado, para que sobreviva a un F5 o a cerrar y volver a abrir la pestaña —
// no solo a cambiar de pestaña dentro de la misma carga de página (eso ya sobrevivía solo,
// porque el <div> de la pestaña no se destruye, solo se oculta). Solo guarda UN borrador a
// la vez (el del turno que se esté editando); cambiar a otro sucursal/fecha/turno sin haber
// cerrado el anterior simplemente lo reemplaza.
const CLAVE_BORRADOR_CUADRE = "bencinera_cuadre_borrador";
// true solo después de que el admin haya tecleado/marcado algo en el cuadre actual. Los
// precios y la tarjeta vienen PRECARGADOS, así que "el formulario tiene valores" no sirve
// para saber si hay algo que conservar: sin este flag, con solo abrir la pestaña y cambiar
// de app ya quedaba guardado un borrador fantasma (visibilitychange/pagehide), y la próxima
// visita saltaba a ese turno en vez del sugerido.
let cuadreTocado = false;

/** Lee del DOM lo tecleado y lo guarda, salvo que el cuadre sea de solo lectura (nada que
 * conservar) o esté completamente vacío (evita dejar un borrador fantasma sin datos).
 * Todo el acceso a localStorage va en try/catch: en algunos navegadores de celular (ej.
 * Safari iOS en navegación privada) setItem lanza una excepción, y sin capturarla rompía en
 * silencio la cadena del oninput y no se guardaba nada. */
function guardarBorradorCuadre() {
  // Todas las llamadas directas a esta función vienen de oninput/onchange del propio
  // formulario (interacción real del admin); los listeners de visibilidad de abajo son los
  // únicos que la llaman condicionada a este flag.
  cuadreTocado = true;
  try {
    if (!cuadreInfo || (cuadreInfo.existe && !cuadreInfo.editable)) return;
    const sucursalId = document.getElementById("cuadreSucursal")?.value;
    const fecha = document.getElementById("cuadreFecha")?.value;
    const turno = document.getElementById("cuadreTurno")?.value;
    if (!sucursalId || !fecha || !turno) return;
    const valores = capturarValoresCuadre();
    const vacio = Object.keys(valores.lecturas).length === 0 && Object.keys(valores.precios).length === 0 && !valores.tarjeta;
    if (vacio) {
      borrarBorradorCuadre();
      return;
    }
    localStorage.setItem(CLAVE_BORRADOR_CUADRE, JSON.stringify({ sucursalId, fecha, turno, valores }));
  } catch (err) {
    // Sin localStorage disponible (modo privado, cuota llena) no se puede conservar el
    // borrador — no es un error que deba interrumpir el llenado del cuadre.
  }
}

/** Devuelve el borrador guardado completo (con su sucursal/fecha/turno), o null si no hay
 * ninguno o quedó corrupto. Se usa al abrir la pestaña, para saber a qué turno saltar. */
function leerBorradorCuadreGuardado() {
  try {
    const raw = localStorage.getItem(CLAVE_BORRADOR_CUADRE);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/** Devuelve los valores del borrador SOLO si coincide con el sucursal/fecha/turno que se
 * está por mostrar (si el admin cambió a otro turno distinto, no tiene sentido aplicarlo). */
function leerBorradorCuadre(sucursalId, fecha, turno) {
  const borrador = leerBorradorCuadreGuardado();
  if (!borrador) return null;
  if (String(borrador.sucursalId) === String(sucursalId) && borrador.fecha === fecha && borrador.turno === turno) {
    return borrador.valores;
  }
  return null;
}

function borrarBorradorCuadre() {
  try {
    localStorage.removeItem(CLAVE_BORRADOR_CUADRE);
  } catch (err) {
    // ídem guardarBorradorCuadre: si no hay localStorage no hay nada que borrar.
  }
}

// Red de seguridad para celulares: además de guardar en cada tecla (oninput), se vuelve a
// guardar el borrador cuando la página pasa a segundo plano o está por descartarse. En el
// teléfono es común que el sistema congele o cierre la pestaña al cambiar de app, bloquear
// la pantalla o volver al inicio, y estos eventos disparan de forma mucho más confiable que
// esperar un último oninput. guardarBorradorCuadre ya no hace nada si no se está en un cuadre
// editable, así que es seguro llamarlo siempre.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && cuadreTocado) guardarBorradorCuadre();
});
window.addEventListener("pagehide", () => {
  if (cuadreTocado) guardarBorradorCuadre();
});

/** El último turno de 12h que ya terminó a esta hora — sugerencia inicial para no tener que
 * pensar cuál es, aunque se puede elegir cualquier otra fecha/turno igual. */
function sugerenciaTurnoCuadre() {
  const ahora = new Date();
  const hora = ahora.getHours();
  if (hora >= 8 && hora < 20) return { fecha: fechaLocalISO(ahora), turno: "manana" };
  if (hora >= 20) return { fecha: fechaLocalISO(ahora), turno: "tarde" };
  const ayer = new Date(ahora);
  ayer.setDate(ayer.getDate() - 1);
  return { fecha: fechaLocalISO(ayer), turno: "tarde" };
}

async function cargarCuadreCaja() {
  const cont = document.getElementById("tab-cuadre-caja");
  await cargarCatalogos();
  bomberosCacheCuadre = await Api.get("/usuarios"); // para el selector de "bomberos en turno"
  const opcionesSucursal = catalogos.sucursales.map((s) => `<option value="${s.id}">${escaparHtml(s.nombre)}</option>`).join("");
  // Si hay un borrador guardado (cuadre sin cerrar, tecleado antes de un F5 o de salir de la
  // pestaña), se abre directo en ESE sucursal/fecha/turno en vez de en la sugerencia de "el
  // último turno que ya terminó" — si no, el borrador nunca se llegaría a aplicar porque
  // cargarTurnoCuadre() solo lo restaura cuando coincide con lo seleccionado.
  const borrador = leerBorradorCuadreGuardado();
  const sugerencia = borrador ? { fecha: borrador.fecha, turno: borrador.turno } : sugerenciaTurnoCuadre();
  cont.innerHTML = `
    <div class="tarjeta">
      <div class="grid-2">
        <div><label>Sucursal</label><select id="cuadreSucursal" onchange="cargarTurnoCuadre()">${opcionesSucursal}</select></div>
        <div><label>Fecha</label><input type="date" id="cuadreFecha" value="${sugerencia.fecha}" onchange="cargarTurnoCuadre()"></div>
      </div>
      <div style="margin-top:10px;">
        <label>Turno</label>
        <select id="cuadreTurno" onchange="cargarTurnoCuadre()">
          <option value="tarde" ${sugerencia.turno === "tarde" ? "selected" : ""}>Tarde (08:00 - 20:00)</option>
          <option value="manana" ${sugerencia.turno === "manana" ? "selected" : ""}>Mañana (20:00 - 08:00)</option>
        </select>
        <div class="chico" style="margin-top:4px;">Sugerido: el último turno que ya terminó. Puedes elegir otra fecha/turno si necesitas cerrar o revisar uno distinto.</div>
      </div>
    </div>
    <div id="cuadreContenido">${skeletonLineas(6)}</div>`;
  if (borrador && catalogos.sucursales.some((s) => String(s.id) === String(borrador.sucursalId))) {
    document.getElementById("cuadreSucursal").value = borrador.sucursalId;
  }
  await cargarTurnoCuadre();
}

/** Lee lo que el admin ya tecleó en el formulario, para no perderlo si se refresca (ej. al crear/editar una máquina). */
function capturarValoresCuadre() {
  const valoresLecturas = {};
  lecturasCuadre.forEach((l, i) => {
    const entradaEl = document.getElementById(`entrada-${i}`);
    const salidaEl = document.getElementById(`salida-${i}`);
    if (!entradaEl || !salidaEl) return;
    if (entradaEl.value !== "" || salidaEl.value !== "") {
      valoresLecturas[`${l.maquina_id}-${l.combustible_id}`] = { entrada: entradaEl.value, salida: salidaEl.value };
    }
  });
  const valoresPrecios = {};
  catalogos.combustibles.forEach((c) => {
    const precioEl = document.getElementById(`precioOverride-${c.id}`);
    if (precioEl && precioEl.value !== "") valoresPrecios[c.id] = precioEl.value;
  });
  const tarjetaEl = document.getElementById("cuadreTarjeta");
  const descuentosEl = document.getElementById("cuadreDescuentos");
  return {
    lecturas: valoresLecturas,
    precios: valoresPrecios,
    tarjeta: tarjetaEl ? tarjetaEl.value : "",
    descuentos: descuentosEl ? descuentosEl.value : "",
    bomberos: leerBomberosCuadre(),
  };
}

/**
 * Carga el estado del turno elegido (sucursal + fecha + turno): si ya existe un cuadre lo
 * trae para editar (si es el más reciente de la sucursal) o solo consulta (si no); si no
 * existe, arma el formulario de creación. preservar=true mantiene lo que el admin ya tecleó
 * EN ESTA MISMA carga de página (usado al crear/editar/eliminar una máquina desde este mismo
 * formulario); si no viene ese flag, se intenta restaurar en su lugar el borrador guardado en
 * el navegador (ver leerBorradorCuadre) — así se recupera lo tecleado también después de un
 * F5 o de haber cerrado y vuelto a abrir la pestaña, no solo dentro de la misma carga. Usa un
 * token para descartar la respuesta si llega una petición más nueva antes.
 */
async function cargarTurnoCuadre(preservar) {
  const miToken = ++cuadrePendienteToken;
  const sucursalId = document.getElementById("cuadreSucursal").value;
  const fecha = document.getElementById("cuadreFecha").value;
  const turno = document.getElementById("cuadreTurno").value;
  const valoresPrevios = preservar ? capturarValoresCuadre() : leerBorradorCuadre(sucursalId, fecha, turno);
  const cont = document.getElementById("cuadreContenido");
  cont.innerHTML = skeletonLineas(6);

  let info, maquinas;
  try {
    [info, maquinas] = await Promise.all([
      Api.get(`/cuadres/turno?sucursal_id=${sucursalId}&fecha=${fecha}&turno=${turno}`),
      Api.get(`/catalogos/maquinas?sucursal_id=${sucursalId}`),
    ]);
  } catch (err) {
    if (miToken !== cuadrePendienteToken) return;
    cont.innerHTML = `<div class="tarjeta"><p class="mensaje-error" style="margin-top:0;">${escaparHtml(err.message)}</p></div>`;
    return;
  }
  if (miToken !== cuadrePendienteToken) return; // llegó una petición más nueva antes que esta, se descarta

  maquinasCacheCuadre = maquinas;
  // El precio viene del mismo /cuadres/turno (vigente a la fecha del turno, no "el actual"),
  // para que la vista previa en vivo coincida con lo que realmente se va a calcular al
  // guardar — importante ahora que se puede cerrar/editar un turno de una fecha pasada.
  preciosCacheCuadre = info.precios;
  cuadreInfo = info;

  lecturasCuadre = info.lecturas.map((l) => ({
    maquina_id: l.maquina_id,
    maquina_nombre: l.maquina_nombre,
    combustible_id: l.combustible_id,
    combustible_nombre: l.combustible_nombre,
    lectura_entrada: l.lectura_entrada,
    lectura_salida_guardada: info.existe ? l.lectura_salida : undefined,
    precio_guardado: info.existe ? l.precio_clp_litro : undefined,
  }));

  renderFormularioCuadre(valoresPrevios);
  // Se parte "sin tocar" en cada carga de turno, salvo que se hayan restaurado valores (un
  // borrador previo o lo preservado al editar máquinas): en ese caso lo mostrado ya es
  // trabajo del admin y la red de seguridad de visibilidad debe seguir guardándolo.
  cuadreTocado = !!valoresPrevios;
}

function renderListaMaquinas() {
  return `
    <table>
      <tr><th>Máquina</th><th>Activa</th><th></th><th></th><th></th></tr>
      ${maquinasCacheCuadre.map((m) => `
        <tr>
          <td>${escaparHtml(m.nombre)}</td>
          <td>${m.activa ? "Sí" : "No"}</td>
          <td><span style="color:var(--dorado); cursor:pointer;" onclick="editarNombreMaquina(${m.id})" title="Editar nombre">✏️</span></td>
          <td><button class="secundario" onclick="toggleActivaMaquina(${m.id}, ${!m.activa})">${m.activa ? "Desactivar" : "Activar"}</button></td>
          <td><span style="color:var(--rojo); cursor:pointer;" onclick="eliminarMaquina(${m.id})" title="Eliminar">🗑️</span></td>
        </tr>`).join("") || '<tr><td colspan="5">Sin máquinas registradas en esta sucursal.</td></tr>'}
    </table>`;
}

function renderFormularioCuadre(valoresPrevios) {
  const cont = document.getElementById("cuadreContenido");
  const soloLectura = cuadreInfo.existe && !cuadreInfo.editable;
  const editando = cuadreInfo.existe && cuadreInfo.editable;

  const filasLecturas = lecturasCuadre.map((l, i) => {
    const guardado = valoresPrevios && valoresPrevios.lecturas[`${l.maquina_id}-${l.combustible_id}`];
    const valorEntrada = guardado ? guardado.entrada : (l.lectura_entrada ?? "");
    const valorSalida = guardado ? guardado.salida : (l.lectura_salida_guardada ?? "");
    const disabled = soloLectura ? "disabled" : "";
    const nuevaMaquina = i > 0 && l.maquina_id !== lecturasCuadre[i - 1].maquina_id;
    // grupo-inicio/grupo-fin delimitan, en la vista de tarjetas de móvil, todas las filas de
    // una misma máquina para que se vean como una sola tarjeta (separada de la siguiente
    // máquina), en vez de una tarjeta suelta por cada combustible.
    const inicioGrupo = i === 0 || nuevaMaquina;
    const finGrupo = i === lecturasCuadre.length - 1 || l.maquina_id !== lecturasCuadre[i + 1].maquina_id;
    const clasesFila = [nuevaMaquina && "nueva-maquina", inicioGrupo && "grupo-inicio", finGrupo && "grupo-fin"].filter(Boolean).join(" ");
    return `
    <tr id="filaDatos-${i}" class="${clasesFila}" data-fin-grupo="${finGrupo}">
      <td data-etiqueta="Máquina">${escaparHtml(l.maquina_nombre)}</td>
      <td data-etiqueta="Combustible">${escaparHtml(l.combustible_nombre)}</td>
      <td data-etiqueta="Entrada"><input type="text" inputmode="decimal" autocomplete="off" id="entrada-${i}" value="${valorEntrada}" placeholder="${l.lectura_entrada === null && !guardado ? "sin dato previo" : ""}" oninput="sanearNumero(this); recalcularCuadre(); guardarBorradorCuadre();" style="width:160px; font-size:18px;" ${disabled}></td>
      <td data-etiqueta="Salida"><input type="text" inputmode="decimal" autocomplete="off" id="salida-${i}" value="${valorSalida}" oninput="sanearNumero(this); recalcularCuadre(); guardarBorradorCuadre();" style="width:160px; font-size:18px;" ${disabled}></td>
      <td data-etiqueta="Litros" id="litros-${i}">-</td>
      <td data-etiqueta="Monto" id="monto-${i}">-</td>
    </tr>
    <tr id="filaError-${i}" class="oculto" data-fin-grupo="${finGrupo}"><td colspan="6" id="filaErrorTexto-${i}" style="padding:0 8px 8px; color:var(--rojo); font-size:12px;"></td></tr>`;
  }).join("");

  const valorTarjeta = valoresPrevios ? valoresPrevios.tarjeta : (cuadreInfo.existe ? cuadreInfo.cuadre.tarjeta_total : "");
  // Híbrido: el campo de descuentos se precarga con el auto-calculado (cuadre nuevo) o con el
  // guardado (cuadre existente) — ambos ya vienen en cuadreInfo.descuentos_total desde el
  // backend — pero queda editable para poder ajustarlo/probar sin depender de transacciones.
  const valorDescuentos = valoresPrevios ? valoresPrevios.descuentos : cuadreInfo.descuentos_total;

  // Bomberos en turno: los de la sucursal del cuadre, con los ya asignados marcados. Vienen
  // del borrador (si se estaba llenando) o de cuadreInfo.bomberos (cuadre ya guardado). Es un
  // dato opcional: si la sucursal no tiene bomberos cargados, se muestra un aviso.
  const sucursalIdCuadre = Number(document.getElementById("cuadreSucursal").value);
  const bomberosSucursal = bomberosCacheCuadre.filter((u) => u.rol === "bombero" && u.sucursal_id === sucursalIdCuadre);
  const bomberosSeleccionados = (valoresPrevios && valoresPrevios.bomberos ? valoresPrevios.bomberos : (cuadreInfo.bomberos || [])).map(Number);
  // Menú desplegable (<details>): el resumen muestra los bomberos elegidos (o un texto guía),
  // y al abrirlo se marcan con casillas. Ocupa una sola línea cerrado.
  const nombresSeleccionados = bomberosSucursal.filter((u) => bomberosSeleccionados.includes(u.id)).map((u) => `${u.nombre} ${u.apellido || ""}`.trim());
  const resumenBomberos = nombresSeleccionados.length ? escaparHtml(nombresSeleccionados.join(", ")) : "Elegir bomberos…";
  const bomberosHtml = bomberosSucursal.length
    ? `<details id="cuadreBomberosMenu" style="border:0.5px solid var(--borde); border-radius:8px;">
         <summary id="cuadreBomberosResumen" style="padding:10px 12px; cursor:pointer; ${soloLectura ? "pointer-events:none; opacity:.6;" : ""}">${resumenBomberos}</summary>
         <div style="border-top:1px solid var(--borde); padding:6px 12px;">
           ${bomberosSucursal.map((u) => `
             <label style="display:flex; align-items:center; gap:8px; padding:5px 0; cursor:pointer;">
               <input type="checkbox" class="cuadre-bombero-chk" value="${u.id}" ${bomberosSeleccionados.includes(u.id) ? "checked" : ""} ${soloLectura ? "disabled" : ""} onchange="actualizarResumenBomberos(); guardarBorradorCuadre();" style="width:auto;">
               ${escaparHtml(`${u.nombre} ${u.apellido || ""}`.trim())}
             </label>`).join("")}
         </div>
       </details>`
    : `<p class="chico" style="margin:0;">No hay bomberos cargados en esta sucursal. Puedes agregarlos en la pestaña Usuarios.</p>`;

  let avisoEstado = "";
  if (cuadreInfo.existe) {
    const c = cuadreInfo.cuadre;
    const cerradoPor = escaparHtml(`${c.cerrado_por_nombre} ${c.cerrado_por_apellido || ""}`.trim());
    let texto = `Cerrado por ${cerradoPor} el ${new Date(c.creado_en).toLocaleString("es-CL")}.`;
    if (c.editado_en) {
      texto += ` <span style="color:var(--dorado); font-weight:600;">✏️ Editado</span> (última edición: ${new Date(c.editado_en).toLocaleString("es-CL")}).`;
    }
    if (soloLectura) {
      texto += ` Ya existe un turno posterior que depende de este cuadre, así que quedó solo para consulta — no se puede editar.`;
    }
    avisoEstado = `<div class="tarjeta"><p class="chico" style="margin:0;">${texto}</p></div>`;
  }

  let avisoNoTerminado = "";
  if (cuadreInfo.turno_no_terminado) {
    const finTexto = new Date(cuadreInfo.turno_fin).toLocaleString("es-CL");
    avisoNoTerminado = `<div class="tarjeta" style="background:#fff8e1; border:1px solid var(--dorado);"><p class="chico" style="margin:0;">⚠️ Este turno todavía no termina (termina el ${finTexto}). Si cierras ahora, puede que falten movimientos por registrar.</p></div>`;
  }

  cont.innerHTML = `
    ${avisoEstado}
    ${avisoNoTerminado}
    <div class="tarjeta">
      <button class="secundario" onclick="toggleFormMaquina()">+ Agregar máquina</button>
      <div id="formMaquina" class="oculto" style="margin-top:12px;">
        <div style="border:1px solid var(--borde); border-radius:8px; padding:16px; background:#fafbfc; display:flex; gap:10px; align-items:flex-end;">
          <div style="flex:1;"><label>Nombre</label><input id="nMaquinaNombre" placeholder="ej. Máquina II-A"></div>
          <button class="primario" style="margin-top:0;" onclick="crearMaquina()">Guardar</button>
        </div>
        <div id="errorMaquina" class="mensaje-error oculto"></div>
        <div style="margin-top:12px;">${renderListaMaquinas()}</div>
      </div>
    </div>

    <div class="tarjeta">
      <h3>Precios</h3>
      <p class="chico">Precargados con el precio vigente. Se pueden ajustar acá — el cambio aplica solo a este cuadre, no al catálogo de precios.</p>
      <div class="grid-2">
        ${catalogos.combustibles.map((c) => {
          const guardado = valoresPrevios && valoresPrevios.precios[c.id];
          const vigente = preciosCacheCuadre.find((pr) => pr.combustible_id === c.id);
          const lecturaGuardada = lecturasCuadre.find((l) => l.combustible_id === c.id && l.precio_guardado !== undefined);
          const valorInicial = guardado ?? (lecturaGuardada ? lecturaGuardada.precio_guardado : (vigente ? vigente.precio_clp_litro : ""));
          return `<div style="background:var(--gris); border-radius:8px; padding:10px 12px;">
            <label style="margin:0;">${escaparHtml(c.nombre)}</label>
            <input type="number" step="1" min="0" id="precioOverride-${c.id}" value="${valorInicial}" placeholder="Sin precio" oninput="recalcularCuadre(); guardarBorradorCuadre();" ${soloLectura ? "disabled" : ""}>
          </div>`;
        }).join("")}
      </div>
    </div>

    <div class="tarjeta">
      <h3>Lecturas por máquina</h3>
      <p class="chico">Deja una fila vacía (entrada y salida) si esa máquina/combustible no tuvo movimiento este turno.</p>
      <table class="responsivo-movil">
        <tr><th>Máquina</th><th>Combustible</th><th>Entrada</th><th>Salida</th><th>Litros</th><th>Monto</th></tr>
        ${filasLecturas}
      </table>
    </div>

    <div class="tarjeta">
      <h3>Bomberos en turno</h3>
      <p class="chico">Abre el menú y marca el o los bomberos que atendieron este turno (opcional). Aparecerá en el Historial de cuadres.</p>
      <div>${bomberosHtml}</div>
    </div>

    <div class="tarjeta">
      <h3>Resumen del turno</h3>
      <div class="grid-2" style="margin-bottom:10px;">
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">Precio × litro</div><div id="statLitrosPrecio" style="font-size:17px; font-weight:600;">$0</div></div>
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">Efectivo (descargas)</div><div style="font-size:17px; font-weight:600;">$${fmt(cuadreInfo.efectivo_total)}</div></div>
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;">
          <label style="margin:0;">Descuentos (app)</label>
          <input type="number" step="1" min="0" id="cuadreDescuentos" value="${valorDescuentos}" oninput="recalcularCuadre(); guardarBorradorCuadre();" placeholder="$" ${soloLectura ? "disabled" : ""}>
          <div class="chico" style="margin-top:4px;">Precargado con el total calculado de las transacciones del turno. Se puede ajustar a mano para este cuadre.</div>
        </div>
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;">
          <label style="margin:0;">Tarjeta (informado por la máquina de tarjetas)</label>
          <input type="number" step="1" min="0" id="cuadreTarjeta" value="${valorTarjeta}" oninput="recalcularCuadre(); guardarBorradorCuadre();" placeholder="$" ${soloLectura ? "disabled" : ""}>
        </div>
      </div>
      <div id="cuadreDiferencia" style="font-size:16px; margin-bottom:14px;"></div>
      ${soloLectura ? "" : `<button class="primario" onclick="${editando ? "guardarEdicionCuadre()" : "cerrarTurno()"}">${editando ? "Guardar cambios" : "Cerrar turno"}</button>`}
      <div id="errorCuadre" class="mensaje-error oculto"></div>
    </div>`;
  recalcularCuadre();
}

/** Muestra u oculta el mini formulario para crear una máquina nueva. */
function toggleFormMaquina() {
  const div = document.getElementById("formMaquina");
  div.classList.toggle("oculto");
  if (!div.classList.contains("oculto")) {
    document.getElementById("nMaquinaNombre").value = "";
    document.getElementById("errorMaquina").classList.add("oculto");
  }
}

async function crearMaquina() {
  const sucursalId = Number(document.getElementById("cuadreSucursal").value);
  const nombre = document.getElementById("nMaquinaNombre").value.trim();
  const errorDiv = document.getElementById("errorMaquina");
  errorDiv.classList.add("oculto");
  try {
    await Api.post("/catalogos/maquinas", { sucursal_id: sucursalId, nombre });
    toggleFormMaquina();
    await cargarTurnoCuadre(true); // preserva lo que ya se había tecleado en las lecturas
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("oculto");
  }
}

async function editarNombreMaquina(id) {
  const m = maquinasCacheCuadre.find((x) => x.id === id);
  if (!m) return;
  const nuevoNombre = await pedirTexto("Nuevo nombre para la máquina:", "Editar máquina", { valorInicial: m.nombre });
  if (nuevoNombre === null || nuevoNombre === m.nombre) return;
  try {
    await Api.put(`/catalogos/maquinas/${id}`, { nombre: nuevoNombre });
    await cargarTurnoCuadre(true);
  } catch (err) {
    await avisar(err.message, "Error");
  }
}

/** Activa o desactiva una máquina (una desactivada deja de aparecer para nuevos cuadres, sin perder su historial). */
async function toggleActivaMaquina(id, nuevoEstado) {
  try {
    await Api.put(`/catalogos/maquinas/${id}`, { activa: nuevoEstado });
    await cargarTurnoCuadre(true);
  } catch (err) {
    await avisar(err.message, "Error");
  }
}

/** Si ya tiene lecturas de cuadres, el servidor rechaza el borrado — se ofrece desactivar en su lugar. */
async function eliminarMaquina(id) {
  const m = maquinasCacheCuadre.find((x) => x.id === id);
  if (!m) return;
  const confirmado = await confirmarAccion(`¿Eliminar definitivamente la máquina "${m.nombre}"? Esta acción no se puede deshacer.`, "Eliminar máquina");
  if (!confirmado) return;
  try {
    await Api.delete(`/catalogos/maquinas/${id}`);
    await cargarTurnoCuadre(true);
  } catch (err) {
    if (err.message && err.message.includes("Desactívala")) {
      const desactivar = await confirmarAccion(`${err.message}\n\n¿Quieres desactivarla ahora? Dejará de aparecer para nuevos cuadres, sin perder su historial.`, "Desactivar máquina");
      if (desactivar) {
        try {
          await Api.put(`/catalogos/maquinas/${id}`, { activa: false });
          await cargarTurnoCuadre(true);
        } catch (err2) {
          await avisar(err2.message, "Error");
        }
      }
      return;
    }
    await avisar(err.message, "Error");
  }
}

/** Recalcula litros/montos en vivo a medida que se llenan las lecturas, y marca en rojo salida < entrada. */
function recalcularCuadre() {
  let litrosPrecioTotal = 0;

  // En móvil, la fila de datos y su fila de error (si aparece) comparten una sola "tarjeta"
  // por máquina — data-fin-grupo marca cuál par es el último de su grupo. El borde/margen de
  // cierre de esa tarjeta tiene que estar SIEMPRE en la última fila realmente visible: en la
  // de datos cuando no hay error, o en la de error cuando sí se muestra (si no, quedan dos
  // "cierres" seguidos y la tarjeta se ve partida en dos apenas hay un typo en la última lectura).
  const sincronizarCierreGrupo = (filaDatos, filaError, hayError) => {
    if (filaDatos.dataset.finGrupo !== "true") return;
    filaDatos.classList.toggle("grupo-fin", !hayError);
    filaError.classList.toggle("grupo-fin", hayError);
  };

  const marcarError = (i, litrosCell, montoCell, filaDatos, filaError, mensaje) => {
    litrosCell.textContent = "Inválido";
    litrosCell.style.color = "var(--rojo)";
    montoCell.textContent = "-";
    document.getElementById(`filaErrorTexto-${i}`).textContent = mensaje;
    filaError.classList.remove("oculto");
    sincronizarCierreGrupo(filaDatos, filaError, true);
  };

  lecturasCuadre.forEach((l, i) => {
    const entradaInput = document.getElementById(`entrada-${i}`);
    const salidaInput = document.getElementById(`salida-${i}`);
    const litrosCell = document.getElementById(`litros-${i}`);
    const montoCell = document.getElementById(`monto-${i}`);
    const filaDatos = document.getElementById(`filaDatos-${i}`);
    const filaError = document.getElementById(`filaError-${i}`);

    // "." solo (sin dígitos) puede pasar momentáneamente al escribir en el nuevo input de
    // texto (ya no lo evita el navegador como con type="number"); se trata igual que vacío.
    if (entradaInput.value === "" || entradaInput.value === "." || salidaInput.value === "" || salidaInput.value === ".") {
      litrosCell.textContent = "-";
      litrosCell.style.color = "";
      montoCell.textContent = "-";
      filaError.classList.add("oculto");
      sincronizarCierreGrupo(filaDatos, filaError, false);
      return;
    }
    const entrada = Number(entradaInput.value);
    const salida = Number(salidaInput.value);
    if (entrada < 0 || salida < 0) {
      marcarError(i, litrosCell, montoCell, filaDatos, filaError, "Las lecturas no pueden ser negativas.");
      return;
    }
    if (salida < entrada) {
      marcarError(i, litrosCell, montoCell, filaDatos, filaError, "La salida no puede ser menor a la entrada.");
      return;
    }
    // El precio se lee del input editable de la tarjeta "Precios" (precargado con el
    // vigente, pero el admin lo puede ajustar puntualmente para este cuadre).
    const precioInput = document.getElementById(`precioOverride-${l.combustible_id}`);
    // Redondeado a entero igual que el servidor (que siempre trata este valor como un
    // override, ver calcularLecturas() en cuadres.js), para que la vista previa no muestre
    // un monto distinto al que realmente se va a guardar si se tipea un precio con decimales.
    const precio = precioInput ? Math.round(Number(precioInput.value)) : NaN;
    if (!precioInput || precioInput.value === "" || Number.isNaN(precio) || precio < 0) {
      marcarError(i, litrosCell, montoCell, filaDatos, filaError, "No hay un precio configurado para este combustible en esta sucursal.");
      return;
    }
    filaError.classList.add("oculto");
    sincronizarCierreGrupo(filaDatos, filaError, false);
    const litros = Math.round((salida - entrada) * 10) / 10;
    litrosCell.textContent = fmt(litros);
    litrosCell.style.color = "";

    // Redondeado por línea igual que el servidor, para que la vista previa coincida
    // exactamente con lo que va a quedar guardado.
    const monto = Math.round(litros * precio * 100) / 100;
    montoCell.textContent = "$" + fmt(monto);
    litrosPrecioTotal += monto;
  });

  const tarjeta = Number(document.getElementById("cuadreTarjeta").value) || 0;
  // Descuentos ahora es un input editable (precargado con el auto-calculado), no un valor fijo.
  const descuentos = Number(document.getElementById("cuadreDescuentos").value) || 0;
  const diferencia = Math.round((litrosPrecioTotal - (cuadreInfo.efectivo_total + tarjeta + descuentos)) * 100) / 100;

  document.getElementById("statLitrosPrecio").textContent = "$" + fmt(litrosPrecioTotal);
  document.getElementById("cuadreDiferencia").innerHTML =
    `Diferencia: <strong style="color:${colorDiferencia(diferencia)};">$${fmt(diferencia)}</strong>`;
}

/** Valida y arma el array de lecturas leyendo el DOM en vivo (no depende de un flag que haya
 * quedado de un recalcularCuadre() anterior). Devuelve {lecturas} o {error}. */
function validarYArmarLecturasCuadre() {
  const filasTocadas = lecturasCuadre
    .map((l, i) => ({
      maquina_id: l.maquina_id,
      combustible_id: l.combustible_id,
      lectura_entrada: document.getElementById(`entrada-${i}`).value,
      lectura_salida: document.getElementById(`salida-${i}`).value,
    }))
    .filter((l) => l.lectura_entrada !== "" || l.lectura_salida !== "");

  const incompleta = filasTocadas.find((l) => l.lectura_entrada === "" || l.lectura_salida === "");
  if (incompleta) return { error: "Hay una lectura con solo uno de los dos valores — completa entrada y salida, o deja ambos vacíos." };

  const lecturas = filasTocadas.map((l) => ({ ...l, lectura_entrada: Number(l.lectura_entrada), lectura_salida: Number(l.lectura_salida) }));

  if (lecturas.some((l) => l.lectura_entrada < 0 || l.lectura_salida < 0)) {
    return { error: "Corrige las lecturas marcadas en rojo: no pueden ser negativas." };
  }
  if (lecturas.some((l) => l.lectura_salida < l.lectura_entrada)) {
    return { error: "Corrige las lecturas marcadas en rojo: la salida no puede ser menor a la entrada." };
  }
  if (lecturas.some((l) => {
    const precioEl = document.getElementById(`precioOverride-${l.combustible_id}`);
    return !precioEl || precioEl.value === "" || Number(precioEl.value) < 0;
  })) {
    return { error: "Corrige las lecturas marcadas en rojo: hay un combustible sin precio configurado en esta sucursal." };
  }
  if (lecturas.length === 0) {
    return { error: "Ingresa al menos una lectura (entrada y salida) antes de continuar." };
  }
  return { lecturas };
}

/** Lee los precios editables de la tarjeta "Precios" (precargados con el vigente, ajustables
 * puntualmente para este cuadre) para mandarlos junto con las lecturas al guardar. */
function leerPreciosOverrideCuadre() {
  const precios = {};
  catalogos.combustibles.forEach((c) => {
    const el = document.getElementById(`precioOverride-${c.id}`);
    if (el && el.value !== "") precios[c.id] = Number(el.value);
  });
  return precios;
}

/** Valida el monto de tarjeta ingresado; si es válido lo devuelve como número, si no muestra el error y devuelve null. */
function leerTarjetaCuadre(errorDiv) {
  const tarjetaInput = document.getElementById("cuadreTarjeta");
  if (tarjetaInput.value === "" || Number(tarjetaInput.value) < 0) {
    errorDiv.textContent = "Ingresa el monto de tarjeta informado por la máquina de tarjetas (0 o mayor).";
    errorDiv.classList.remove("oculto");
    return null;
  }
  return Number(tarjetaInput.value);
}

/** Igual que leerTarjetaCuadre pero para el monto de descuentos (editable en esta versión). */
function leerDescuentosCuadre(errorDiv) {
  const descuentosInput = document.getElementById("cuadreDescuentos");
  if (descuentosInput.value === "" || Number(descuentosInput.value) < 0) {
    errorDiv.textContent = "Ingresa el monto de descuentos (0 o mayor).";
    errorDiv.classList.remove("oculto");
    return null;
  }
  return Number(descuentosInput.value);
}

/** Devuelve los ids de los bomberos en turno marcados en el menú desplegable (array,
 * posiblemente vacío — es opcional). */
function leerBomberosCuadre() {
  return [...document.querySelectorAll(".cuadre-bombero-chk:checked")].map((el) => Number(el.value));
}

/** Actualiza el texto del resumen del menú desplegable de bomberos con los nombres marcados
 * (o el texto guía si no hay ninguno), para que se vea a quién se eligió sin abrirlo. */
function actualizarResumenBomberos() {
  const resumen = document.getElementById("cuadreBomberosResumen");
  if (!resumen) return;
  const nombres = [...document.querySelectorAll(".cuadre-bombero-chk:checked")].map((el) => el.parentNode.textContent.trim());
  resumen.textContent = nombres.length ? nombres.join(", ") : "Elegir bomberos…";
}

async function cerrarTurno() {
  const errorDiv = document.getElementById("errorCuadre");
  errorDiv.classList.add("oculto");

  const { lecturas, error } = validarYArmarLecturasCuadre();
  if (error) {
    errorDiv.textContent = error;
    errorDiv.classList.remove("oculto");
    return;
  }
  const tarjetaTotal = leerTarjetaCuadre(errorDiv);
  if (tarjetaTotal === null) return;
  const descuentosTotal = leerDescuentosCuadre(errorDiv);
  if (descuentosTotal === null) return;

  const fecha = document.getElementById("cuadreFecha").value;
  let mensajeConfirmacion = `¿Cerrar el turno ${NOMBRE_TURNO[cuadreInfo.turno]} del ${fecha}? Esta acción no se puede deshacer.`;
  if (cuadreInfo.turno_no_terminado) {
    const finTexto = new Date(cuadreInfo.turno_fin).toLocaleString("es-CL");
    mensajeConfirmacion = `⚠️ Este turno todavía no termina (termina el ${finTexto}). ` + mensajeConfirmacion;
  }
  const confirmado = await confirmarAccion(mensajeConfirmacion, "Cerrar turno");
  if (!confirmado) return;

  try {
    await Api.post("/cuadres", {
      sucursal_id: Number(document.getElementById("cuadreSucursal").value),
      fecha,
      turno: cuadreInfo.turno,
      tarjeta_total: tarjetaTotal,
      descuentos_total: descuentosTotal,
      lecturas,
      precios_override: leerPreciosOverrideCuadre(),
      bomberos: leerBomberosCuadre(),
    });
    borrarBorradorCuadre(); // ya quedó guardado en el servidor, el borrador local ya no aplica
    await avisar("Turno cerrado correctamente.", "Listo");
    await cargarTurnoCuadre();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("oculto");
  }
}

/** Guarda cambios sobre un cuadre ya cerrado (solo disponible si es el más reciente de la
 * sucursal). Recalcula todo en el servidor y queda marcado como editado. */
async function guardarEdicionCuadre() {
  const errorDiv = document.getElementById("errorCuadre");
  errorDiv.classList.add("oculto");

  const { lecturas, error } = validarYArmarLecturasCuadre();
  if (error) {
    errorDiv.textContent = error;
    errorDiv.classList.remove("oculto");
    return;
  }
  const tarjetaTotal = leerTarjetaCuadre(errorDiv);
  if (tarjetaTotal === null) return;
  const descuentosTotal = leerDescuentosCuadre(errorDiv);
  if (descuentosTotal === null) return;

  const confirmado = await confirmarAccion("¿Guardar los cambios de este cuadre? Va a quedar marcado como editado.", "Guardar cambios");
  if (!confirmado) return;

  try {
    await Api.put(`/cuadres/${cuadreInfo.cuadre.id}`, { tarjeta_total: tarjetaTotal, descuentos_total: descuentosTotal, lecturas, precios_override: leerPreciosOverrideCuadre(), bomberos: leerBomberosCuadre() });
    borrarBorradorCuadre(); // ya quedó guardado en el servidor, el borrador local ya no aplica
    await avisar("Cambios guardados.", "Listo");
    await cargarTurnoCuadre();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("oculto");
  }
}

// ---------- Historial de cuadres ----------
let ultimoHistorialCuadres = []; // guarda las filas cargadas para poder exportarlas

async function cargarHistorialCuadres() {
  const cont = document.getElementById("tab-historial-cuadres");
  await cargarCatalogos();
  const opcionesSucursal = catalogos.sucursales.map((s) => `<option value="${s.id}">${escaparHtml(s.nombre)}</option>`).join("");
  cont.innerHTML = `
    <div class="tarjeta">
      <div class="grid-2">
        <div><label>Desde</label><input type="date" id="hcDesde"></div>
        <div><label>Hasta</label><input type="date" id="hcHasta"></div>
        <div><label>Sucursal</label><select id="hcSucursal"><option value="">Todas</option>${opcionesSucursal}</select></div>
      </div>
      <button class="primario" style="margin-top:10px;" onclick="buscarHistorialCuadres()">Filtrar</button>
      <button class="limpiar-filtros" style="margin-top:10px;" onclick="limpiarFiltrosHistorialCuadres()">✕ Limpiar filtros</button>
      <button class="exportar" style="margin-top:10px;" onclick="exportarHistorialCuadresCSV()">📥 Exportar a Excel</button>
    </div>
    <div class="tarjeta"><div id="tablaHistorialCuadres">${skeletonLineas(6)}</div></div>`;
  buscarHistorialCuadres();
}

function limpiarFiltrosHistorialCuadres() {
  document.getElementById("hcDesde").value = "";
  document.getElementById("hcHasta").value = "";
  document.getElementById("hcSucursal").value = "";
  buscarHistorialCuadres();
}

async function buscarHistorialCuadres() {
  const desde = document.getElementById("hcDesde").value;
  const hasta = document.getElementById("hcHasta").value;
  const sucursalId = document.getElementById("hcSucursal").value;
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  if (sucursalId) params.set("sucursal_id", sucursalId);

  const cont = document.getElementById("tablaHistorialCuadres");
  cont.innerHTML = skeletonLineas(6);
  const rows = await Api.get(`/cuadres?${params.toString()}`);
  ultimoHistorialCuadres = rows;

  cont.innerHTML = `
    <table>
      <tr><th>Fecha</th><th>Turno</th><th>Sucursal</th><th>Litros</th><th>Litros × precio</th><th>Tarjeta</th><th>Efectivo</th><th>Descuentos</th><th>Suma (T+E+D)</th><th>Diferencia</th><th>Bomberos en turno</th><th>Cerrado por</th><th></th></tr>
      ${rows.map((c) => {
        const suma = Number(c.tarjeta_total) + Number(c.efectivo_total) + Number(c.descuentos_total);
        const diferencia = Number(c.diferencia);
        const bomberos = Array.isArray(c.bomberos_turno) ? c.bomberos_turno : [];
        const bomberosTexto = bomberos.length ? bomberos.map((b) => escaparHtml(`${b.nombre} ${b.apellido || ""}`.trim())).join(", ") : "-";
        return `<tr>
          <td>${new Date(c.turno_fin).toLocaleDateString("es-CL")}</td>
          <td>${NOMBRE_TURNO[c.turno] || escaparHtml(c.turno)}</td>
          <td>${escaparHtml(c.sucursal_nombre)}</td>
          <td>${fmt(c.litros_totales)}</td>
          <td>$${fmt(c.litros_precio_total)}</td>
          <td>$${fmt(c.tarjeta_total)}</td>
          <td>$${fmt(c.efectivo_total)}</td>
          <td>$${fmt(c.descuentos_total)}</td>
          <td>$${fmt(suma)}</td>
          <td style="color:${colorDiferencia(diferencia)};">$${fmt(diferencia)}</td>
          <td>${bomberosTexto}</td>
          <td>${escaparHtml(`${c.cerrado_por_nombre} ${c.cerrado_por_apellido || ""}`)}${c.editado_en ? ' <span style="color:var(--dorado); font-weight:600;" title="Editado el ' + new Date(c.editado_en).toLocaleString("es-CL") + '">✏️ Editado</span>' : ""}</td>
          <td><a style="color:var(--dorado); cursor:pointer;" onclick="verDetalleCuadre(${c.id})">Ver detalle</a></td>
        </tr>`;
      }).join("") || '<tr><td colspan="13">Sin registros</td></tr>'}
    </table>
    <p class="chico" style="margin-top:8px;">Suma (T+E+D) = Tarjeta + Efectivo + Descuentos. Diferencia = Litros × precio − Suma.</p>`;
}

/** Muestra en un modal las lecturas de un cuadre (máquina, combustible, litros, precio usado
 * y monto), con el precio real guardado en ese momento aunque el catálogo haya cambiado después. */
async function verDetalleCuadre(cuadreId) {
  const { cuadre, lecturas, bomberos } = await Api.get(`/cuadres/${cuadreId}`);
  const cont = document.getElementById("modalContenedor");
  const bomberosTurno = Array.isArray(bomberos) ? bomberos : [];
  const bomberosTexto = bomberosTurno.length
    ? bomberosTurno.map((b) => escaparHtml(`${b.nombre} ${b.apellido || ""}`.trim())).join(", ")
    : "—";
  cont.innerHTML = `
    <div class="overlay-modal">
      <div class="modal" style="max-width:520px; max-height:80vh; display:flex; flex-direction:column;">
        <h3 style="flex-shrink:0;">Detalle del cuadre</h3>
        <p class="chico" style="margin:0 0 6px; flex-shrink:0;">${escaparHtml(cuadre.sucursal_nombre)} · ${NOMBRE_TURNO[cuadre.turno] || escaparHtml(cuadre.turno)} · ${new Date(cuadre.turno_fin).toLocaleDateString("es-CL")}</p>
        <p class="chico" style="margin:0 0 14px; flex-shrink:0;"><strong>Bomberos en turno:</strong> ${bomberosTexto}</p>
        <div style="overflow:auto; max-width:100%; flex:1; min-height:0;">
          <table style="min-width:0; width:100%;">
            <tr><th>Máquina</th><th>Combustible</th><th>Litros</th><th>Precio/L</th><th>Monto</th></tr>
            ${lecturas.map((l) => `
              <tr>
                <td>${escaparHtml(l.maquina_nombre)}</td>
                <td>${escaparHtml(l.combustible_nombre)}</td>
                <td>${fmt(l.litros)}</td>
                <td>$${fmt(l.precio_clp_litro)}</td>
                <td>$${fmt(l.monto_clp)}</td>
              </tr>`).join("") || '<tr><td colspan="5">Sin lecturas</td></tr>'}
          </table>
        </div>
        <div class="modal-botones" style="flex-shrink:0;">
          <button class="primario" onclick="document.getElementById('modalContenedor').innerHTML=''">Cerrar</button>
        </div>
      </div>
    </div>`;
}

/** Arma pares [etiqueta, valor] con los filtros de Historial de cuadres actualmente aplicados. */
function resumenFiltrosHistorialCuadres() {
  const desde = document.getElementById("hcDesde").value;
  const hasta = document.getElementById("hcHasta").value;
  const sucursalId = document.getElementById("hcSucursal").value;
  const sucursal = sucursalId ? catalogos.sucursales.find((s) => s.id === Number(sucursalId)) : null;
  const periodo = desde || hasta
    ? `${desde || "el inicio"} a ${hasta || "hoy"}`
    : "Todo el histórico (desde que se instaló la app)";
  return [
    ["Período", periodo],
    ["Sucursal", sucursal ? sucursal.nombre : "(todas)"],
  ];
}

/** Exporta el historial de cuadres actualmente cargado a CSV, mismo formato (BOM + ";" +
 * filtros documentados arriba) que exportarHistorialCSV() en Historial de socios. */
function exportarHistorialCuadresCSV() {
  if (ultimoHistorialCuadres.length === 0) {
    avisar("No hay datos cargados para exportar. Filtra primero.");
    return;
  }

  const encabezados = [
    "Fecha", "Turno", "Sucursal", "Litros", "Litros por precio", "Tarjeta", "Efectivo",
    "Descuentos", "Suma (T+E+D)", "Diferencia", "Bomberos en turno", "Cerrado por", "Editado",
  ];

  const escaparCsv = (valor) => {
    const texto = String(valor ?? "");
    return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };

  const lineasFiltros = resumenFiltrosHistorialCuadres().map(([etiqueta, valor]) => [etiqueta, valor].map(escaparCsv).join(";"));

  const filas = ultimoHistorialCuadres.map((c) => {
    const suma = Number(c.tarjeta_total) + Number(c.efectivo_total) + Number(c.descuentos_total);
    const cerradoPor = `${c.cerrado_por_nombre} ${c.cerrado_por_apellido || ""}`.trim();
    const bomberos = Array.isArray(c.bomberos_turno) ? c.bomberos_turno : [];
    const bomberosTexto = bomberos.map((b) => `${b.nombre} ${b.apellido || ""}`.trim()).join(", ");
    return [
      new Date(c.turno_fin).toLocaleDateString("es-CL"),
      NOMBRE_TURNO[c.turno] || c.turno,
      c.sucursal_nombre,
      c.litros_totales,
      c.litros_precio_total,
      c.tarjeta_total,
      c.efectivo_total,
      c.descuentos_total,
      suma,
      c.diferencia,
      bomberosTexto,
      cerradoPor,
      c.editado_en ? `Sí (${new Date(c.editado_en).toLocaleString("es-CL")})` : "No",
    ].map(escaparCsv).join(";");
  });

  const csv = [...lineasFiltros, "", encabezados.join(";"), ...filas].join("\r\n");
  const bom = "﻿"; // para que Excel detecte UTF-8 y no rompa las tildes/ñ
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  const fecha = new Date().toISOString().slice(0, 10);
  enlace.href = url;
  enlace.download = `historial_cuadres_${fecha}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

// ---------- Reportes de cuadres ----------
async function cargarReportesCuadres() {
  const cont = document.getElementById("tab-reportes-cuadres");
  await cargarCatalogos();
  const hoy = fechaLocalISO(new Date());
  const opcionesSucursal = catalogos.sucursales.map((s) => `<option value="${s.id}">${escaparHtml(s.nombre)}</option>`).join("");
  cont.innerHTML = `
    <div class="tarjeta">
      <div class="grid-2">
        <div><label>Desde</label><input type="date" id="rcDesde" value="${hoy}"></div>
        <div><label>Hasta</label><input type="date" id="rcHasta" value="${hoy}"></div>
        <div><label>Sucursal</label><select id="rcSucursal"><option value="">Todas</option>${opcionesSucursal}</select></div>
      </div>
      <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="secundario" onclick="filtroReporteCuadresRapido('hoy')">Hoy</button>
        <button class="secundario" onclick="filtroReporteCuadresRapido('semana')">Esta semana</button>
        <button class="secundario" onclick="filtroReporteCuadresRapido('mes')">Este mes</button>
        <button class="secundario" onclick="filtroReporteCuadresRapido('todo')">Todo (histórico)</button>
        <button class="primario" style="margin-top:0;" onclick="buscarReportesCuadres()">Filtrar</button>
        <button class="limpiar-filtros" onclick="limpiarFiltrosReportesCuadres()">✕ Limpiar filtros</button>
        <button class="exportar" onclick="exportarReporteCuadresCSV()">📥 Exportar a Excel</button>
      </div>
    </div>
    <div id="resultadoReportesCuadres"></div>`;
  buscarReportesCuadres();
}

function limpiarFiltrosReportesCuadres() {
  document.getElementById("rcSucursal").value = "";
  filtroReporteCuadresRapido("hoy");
}

function filtroReporteCuadresRapido(tipo) {
  const { desde, hasta } = rangoRapido(tipo);
  document.getElementById("rcDesde").value = desde;
  document.getElementById("rcHasta").value = hasta;
  buscarReportesCuadres();
}

async function buscarReportesCuadres() {
  const desde = document.getElementById("rcDesde").value;
  const hasta = document.getElementById("rcHasta").value;
  const sucursalId = document.getElementById("rcSucursal").value;
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  if (sucursalId) params.set("sucursal_id", sucursalId);

  const cont = document.getElementById("resultadoReportesCuadres");
  cont.innerHTML = `<div class="tarjeta">${skeletonLineas(4)}</div>`;
  const data = await Api.get(`/cuadres/reportes?${params.toString()}`);

  const rangoTexto = desde || hasta ? `Período: ${desde || "el inicio"} a ${hasta || "hoy"}` : "Todo el histórico";
  const sucursal = sucursalId ? catalogos.sucursales.find((s) => s.id === Number(sucursalId)) : null;
  const sucursalTexto = sucursal ? sucursal.nombre : "Todas";
  const diferenciaNeta = Number(data.diferencia_neta);
  // Misma "Suma (T+E+D)" que muestra cada fila del Historial de cuadres, pero acumulada
  // sobre todos los turnos del período (el backend ya manda los tres totales por separado).
  const sumaTED = Number(data.tarjeta_total) + Number(data.efectivo_total) + Number(data.descuentos_total);
  ultimoReporteCuadres = { ...data, rangoTexto, sucursalTexto };
  const litrosCombustible = litrosPorCombustible(data.desglose);
  const montoCombustible = montoPorCombustible(data.desglose);
  const litrosCombustibleHtml = litrosCombustible.length
    ? `<div class="grid-2">${litrosCombustible.map(([c, l]) => `<div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">${escaparHtml(c)}</div><div style="font-size:17px; font-weight:600;">${fmt(l)} L</div></div>`).join("")}</div>`
    : `<p class="chico">Sin datos</p>`;
  const montoCombustibleHtml = montoCombustible.length
    ? `<div class="grid-2">${montoCombustible.map(([c, m]) => `<div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">${escaparHtml(c)}</div><div style="font-size:17px; font-weight:600;">$${fmt(m)}</div></div>`).join("")}</div>`
    : `<p class="chico">Sin datos</p>`;

  cont.innerHTML = `
    <div class="tarjeta">
      <p class="chico">${rangoTexto} · Sucursal: ${escaparHtml(sucursalTexto)}</p>
      <h3>Totales</h3>
      <div class="grid-2" style="margin-top:10px;">
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">Turnos cerrados</div><div style="font-size:17px; font-weight:600;">${data.turnos_cerrados}</div></div>
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">Litros totales</div><div style="font-size:17px; font-weight:600;">${fmt(data.litros_totales)} L</div></div>
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">Tarjeta</div><div style="font-size:17px; font-weight:600;">$${fmt(data.tarjeta_total)}</div></div>
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">Efectivo</div><div style="font-size:17px; font-weight:600;">$${fmt(data.efectivo_total)}</div></div>
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">Descuentos</div><div style="font-size:17px; font-weight:600;">$${fmt(data.descuentos_total)}</div></div>
      </div>
      <div style="border:2px solid var(--dorado); border-radius:8px; padding:12px 14px; margin-top:12px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <span class="chico">Precio × litro (esperado)</span>
          <span style="font-size:17px; font-weight:600;">$${fmt(data.litros_precio_total)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; margin:6px 0; color:var(--dorado);">
          <span aria-hidden="true">↓</span>
          <div style="flex:1; border-top:1px dashed var(--borde);"></div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <span class="chico">Suma T+E+D (real)</span>
          <span style="font-size:17px; font-weight:600; color:${colorDiferencia(diferenciaNeta)};">$${fmt(sumaTED)}</span>
        </div>
      </div>
      <div class="grid-2" style="margin-top:12px;">
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">Diferencia neta (con signo)</div><div style="font-size:17px; font-weight:600; color:${colorDiferencia(diferenciaNeta)};">$${fmt(diferenciaNeta)}</div></div>
        <div style="background:var(--gris); border-radius:8px; padding:10px 12px;"><div class="chico">Diferencia absoluta acumulada</div><div style="font-size:17px; font-weight:600;">$${fmt(data.diferencia_absoluta)}</div></div>
      </div>
      <p class="chico" style="margin-top:10px;">La neta es el impacto real en la caja del período. La absoluta suma el error de cada turno sin cancelar positivos con negativos. Precio × litro es el valor esperado según catálogo; Tarjeta + Efectivo + Descuentos es lo que realmente cuadró.</p>
      <h3 style="margin-top:16px;">Litros por combustible</h3>
      ${litrosCombustibleHtml}
      <h3 style="margin-top:16px;">Total por combustible</h3>
      ${montoCombustibleHtml}
    </div>
    <div class="tarjeta">
      <h3>Por sucursal y combustible</h3>
      <table>
        <tr><th>Sucursal</th><th>Combustible</th><th>Litros</th><th>Monto total</th><th>Precio promedio $/L</th></tr>
        ${data.desglose.map((d) => `<tr><td>${escaparHtml(d.sucursal)}</td><td>${escaparHtml(d.combustible)}</td><td>${fmt(d.litros)}</td><td>$${fmt(d.monto_total)}</td><td>$${fmt(d.precio_promedio)}</td></tr>`).join("") || '<tr><td colspan="5">Sin datos</td></tr>'}
      </table>
      <p class="chico" style="margin-top:8px;">El precio promedio es monto total ÷ litros — ponderado automáticamente si el período cruza un cambio de precio.</p>
    </div>`;
}

/**
 * Exporta el reporte de cuadres actualmente cargado a un CSV que Excel abre directo, mismo
 * formato (BOM + ";" + filtros documentados + secciones) que exportarReporteCSV() en
 * Reportes Descuentos.
 */
function exportarReporteCuadresCSV() {
  if (!ultimoReporteCuadres) {
    avisar("No hay datos cargados para exportar. Filtra primero.");
    return;
  }

  const escaparCsv = (valor) => {
    const texto = String(valor ?? "");
    return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const filaCsv = (arr) => arr.map(escaparCsv).join(";");

  const { turnos_cerrados, diferencia_neta, diferencia_absoluta, litros_precio_total, tarjeta_total, efectivo_total, descuentos_total, litros_totales, desglose, rangoTexto, sucursalTexto } = ultimoReporteCuadres;
  const litrosCombustible = litrosPorCombustible(desglose);
  const montoCombustible = montoPorCombustible(desglose);

  const lineas = [];
  lineas.push(filaCsv([rangoTexto]));
  lineas.push(filaCsv(["Sucursal", sucursalTexto]));
  lineas.push("");
  lineas.push(filaCsv(["Totales"]));
  lineas.push(filaCsv(["Turnos cerrados", "Litros totales", "Diferencia neta", "Diferencia absoluta", "Precio x litro", "Tarjeta", "Efectivo", "Descuentos", "Suma (T+E+D)"]));
  lineas.push(filaCsv([turnos_cerrados, litros_totales, diferencia_neta, diferencia_absoluta, litros_precio_total, tarjeta_total, efectivo_total, descuentos_total, Number(tarjeta_total) + Number(efectivo_total) + Number(descuentos_total)]));
  lineas.push("");
  lineas.push(filaCsv(["Litros por combustible"]));
  lineas.push(filaCsv(["Combustible", "Litros"]));
  litrosCombustible.forEach(([c, l]) => lineas.push(filaCsv([c, l])));
  lineas.push("");
  lineas.push(filaCsv(["Total por combustible"]));
  lineas.push(filaCsv(["Combustible", "Total"]));
  montoCombustible.forEach(([c, m]) => lineas.push(filaCsv([c, m])));
  lineas.push("");
  lineas.push(filaCsv(["Por sucursal y combustible"]));
  lineas.push(filaCsv(["Sucursal", "Combustible", "Litros", "Monto total", "Precio promedio $/L"]));
  desglose.forEach((d) => lineas.push(filaCsv([d.sucursal, d.combustible, d.litros, d.monto_total, d.precio_promedio])));

  const csv = lineas.join("\r\n");
  const bom = "﻿"; // para que Excel detecte UTF-8 y no rompa las tildes/ñ
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  const fecha = new Date().toISOString().slice(0, 10);
  enlace.href = url;
  enlace.download = `reporte_cuadres_${fecha}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

// ---------- Descargas ----------
let bomberosCacheDescargas = [];
let ultimoHistorialDescargas = []; // guarda las filas cargadas para poder exportarlas

async function cargarDescargas() {
  const cont = document.getElementById("tab-descargas");
  const [, usuarios] = await Promise.all([cargarCatalogos(), Api.get("/usuarios")]);
  bomberosCacheDescargas = usuarios;
  const opcionesSucursal = catalogos.sucursales.map((s) => `<option value="${s.id}">${escaparHtml(s.nombre)}</option>`).join("");
  cont.innerHTML = `
    <div class="tarjeta">
      <button class="secundario" onclick="toggleFormDescarga()">+ Registrar descarga</button>
      <div id="formDescarga" class="oculto" style="border:1px solid var(--borde); border-radius:8px; padding:16px; margin-top:12px; background:#fafbfc;">
        <div class="grid-2">
          <div><label>Sucursal</label><select id="nDescargaSucursal" onchange="actualizarBomberosDescarga()">${opcionesSucursal}</select></div>
          <div><label>Bombero</label><select id="nDescargaBombero"></select></div>
          <div><label>Monto</label><input id="nDescargaMonto" type="number" step="1" placeholder="100000"></div>
        </div>
        <div style="margin-top:12px; display:flex; gap:8px;">
          <button class="primario" style="margin-top:0;" onclick="crearDescarga()">Guardar</button>
          <button class="secundario" onclick="toggleFormDescarga()">Cancelar</button>
        </div>
        <div id="errorDescarga" class="mensaje-error oculto"></div>
      </div>
    </div>
    <div class="tarjeta">
      <h3>Historial</h3>
      <div class="grid-2">
        <div><label>Desde</label><input type="date" id="descargaDesde"></div>
        <div><label>Hasta</label><input type="date" id="descargaHasta"></div>
        <div><label>Sucursal</label><select id="descargaFiltroSucursal" onchange="actualizarBomberosFiltroDescargas()"><option value="">Todas</option>${opcionesSucursal}</select></div>
        <div><label>Bombero</label><select id="descargaFiltroBombero"><option value="">Todos</option></select></div>
      </div>
      <button class="primario" style="margin-top:10px;" onclick="buscarDescargas()">Filtrar</button>
      <button class="limpiar-filtros" style="margin-top:10px;" onclick="limpiarFiltrosDescargas()">✕ Limpiar filtros</button>
      <button class="exportar" style="margin-top:10px;" onclick="exportarDescargasCSV()">📥 Exportar a Excel</button>
      <div id="tablaDescargas" style="margin-top:10px;">${skeletonLineas(5)}</div>
    </div>`;
  actualizarBomberosDescarga();
  actualizarBomberosFiltroDescargas();
  buscarDescargas();
}

/** Muestra u oculta el mini formulario para registrar una descarga nueva. */
function toggleFormDescarga() {
  const div = document.getElementById("formDescarga");
  div.classList.toggle("oculto");
  if (div.classList.contains("oculto")) {
    document.getElementById("nDescargaMonto").value = "";
    document.getElementById("errorDescarga").classList.add("oculto");
  } else {
    actualizarBomberosDescarga();
  }
}

/** Filtra el selector de bombero del formulario según la sucursal elegida (solo bomberos de esa sucursal). */
function actualizarBomberosDescarga() {
  const sucursalId = Number(document.getElementById("nDescargaSucursal").value);
  const select = document.getElementById("nDescargaBombero");
  const bomberos = bomberosCacheDescargas.filter((u) => u.rol === "bombero" && u.sucursal_id === sucursalId);
  select.innerHTML = bomberos.map((u) => `<option value="${u.id}">${escaparHtml(`${u.nombre} ${u.apellido || ""}`)}</option>`).join("") || '<option value="">Sin bomberos en esta sucursal</option>';
}

/** Igual que actualizarBomberosDescarga() pero para el filtro del historial (incluye "Todos"). */
function actualizarBomberosFiltroDescargas() {
  const sucursalId = document.getElementById("descargaFiltroSucursal").value;
  const select = document.getElementById("descargaFiltroBombero");
  const bomberos = sucursalId
    ? bomberosCacheDescargas.filter((u) => u.rol === "bombero" && u.sucursal_id === Number(sucursalId))
    : bomberosCacheDescargas.filter((u) => u.rol === "bombero");
  select.innerHTML = '<option value="">Todos</option>' + bomberos.map((u) => `<option value="${u.id}">${escaparHtml(`${u.nombre} ${u.apellido || ""}`)}</option>`).join("");
}

async function crearDescarga() {
  const errorDiv = document.getElementById("errorDescarga");
  errorDiv.classList.add("oculto");
  const bomberoId = document.getElementById("nDescargaBombero").value;
  if (!bomberoId) {
    errorDiv.textContent = "Selecciona un bombero.";
    errorDiv.classList.remove("oculto");
    return;
  }
  try {
    await Api.post("/descargas", {
      sucursal_id: Number(document.getElementById("nDescargaSucursal").value),
      bombero_id: Number(bomberoId),
      monto: Number(document.getElementById("nDescargaMonto").value),
    });
    toggleFormDescarga();
    buscarDescargas();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("oculto");
  }
}

function limpiarFiltrosDescargas() {
  document.getElementById("descargaDesde").value = "";
  document.getElementById("descargaHasta").value = "";
  document.getElementById("descargaFiltroSucursal").value = "";
  actualizarBomberosFiltroDescargas();
  buscarDescargas();
}

async function buscarDescargas() {
  const desde = document.getElementById("descargaDesde").value;
  const hasta = document.getElementById("descargaHasta").value;
  const sucursalId = document.getElementById("descargaFiltroSucursal").value;
  const bomberoId = document.getElementById("descargaFiltroBombero").value;
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  if (sucursalId) params.set("sucursal_id", sucursalId);
  if (bomberoId) params.set("bombero_id", bomberoId);

  const cont = document.getElementById("tablaDescargas");
  cont.innerHTML = skeletonLineas(4);
  const rows = await Api.get(`/descargas?${params.toString()}`);
  ultimoHistorialDescargas = rows;
  const total = rows.reduce((acc, d) => acc + Number(d.monto), 0);

  cont.innerHTML = `
    <p class="chico">Total del período: <strong>$${fmt(total)}</strong> (${rows.length} descargas)</p>
    <table>
      <tr><th>Fecha</th><th>Hora</th><th>Sucursal</th><th>Bombero</th><th>Monto</th><th></th></tr>
      ${rows.map((d) => {
        const fechaHora = new Date(d.creado_en);
        const fechaHoraTexto = `${fechaHora.toLocaleDateString("es-CL")} ${fechaHora.toLocaleTimeString("es-CL")}`;
        return `<tr>
          <td>${fechaHora.toLocaleDateString("es-CL")}</td>
          <td>${fechaHora.toLocaleTimeString("es-CL")}</td>
          <td>${escaparHtml(d.sucursal_nombre)}</td>
          <td>${escaparHtml(`${d.bombero_nombre} ${d.bombero_apellido || ""}`)}</td>
          <td>$${fmt(d.monto)}</td>
          <td><span style="color:var(--rojo); cursor:pointer;" onclick="eliminarDescarga(${d.id}, '${fechaHoraTexto}', ${d.monto})" title="Eliminar">🗑️</span></td>
        </tr>`;
      }).join("") || '<tr><td colspan="6">Sin registros</td></tr>'}
    </table>`;
}

/** Arma pares [etiqueta, valor] con los filtros de Descargas actualmente aplicados. */
function resumenFiltrosDescargas() {
  const desde = document.getElementById("descargaDesde").value;
  const hasta = document.getElementById("descargaHasta").value;
  const sucursalId = document.getElementById("descargaFiltroSucursal").value;
  const bomberoId = document.getElementById("descargaFiltroBombero").value;
  const sucursal = sucursalId ? catalogos.sucursales.find((s) => s.id === Number(sucursalId)) : null;
  const bombero = bomberoId ? bomberosCacheDescargas.find((u) => u.id === Number(bomberoId)) : null;
  const periodo = desde || hasta
    ? `${desde || "el inicio"} a ${hasta || "hoy"}`
    : "Todo el histórico (desde que se instaló la app)";
  return [
    ["Período", periodo],
    ["Sucursal", sucursal ? sucursal.nombre : "(todas)"],
    ["Bombero", bombero ? `${bombero.nombre} ${bombero.apellido || ""}`.trim() : "(todos)"],
  ];
}

/** Exporta el historial de descargas actualmente cargado a CSV, mismo formato (BOM + ";" +
 * filtros documentados arriba) que exportarHistorialCSV() en Historial de socios. */
function exportarDescargasCSV() {
  if (ultimoHistorialDescargas.length === 0) {
    avisar("No hay datos cargados para exportar. Filtra primero.");
    return;
  }

  const encabezados = ["Fecha", "Hora", "Sucursal", "Bombero", "Monto"];

  const escaparCsv = (valor) => {
    const texto = String(valor ?? "");
    return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };

  const lineasFiltros = resumenFiltrosDescargas().map(([etiqueta, valor]) => [etiqueta, valor].map(escaparCsv).join(";"));
  const totalDescargas = ultimoHistorialDescargas.reduce((acc, d) => acc + Number(d.monto), 0);
  const lineaTotal = ["Total del período", `$${fmt(totalDescargas)} (${ultimoHistorialDescargas.length} descargas)`].map(escaparCsv).join(";");

  const filas = ultimoHistorialDescargas.map((d) => {
    const fechaHora = new Date(d.creado_en);
    const nombreBombero = `${d.bombero_nombre} ${d.bombero_apellido || ""}`.trim();
    return [
      fechaHora.toLocaleDateString("es-CL"),
      fechaHora.toLocaleTimeString("es-CL"),
      d.sucursal_nombre,
      nombreBombero,
      d.monto,
    ].map(escaparCsv).join(";");
  });

  const csv = [...lineasFiltros, lineaTotal, "", encabezados.join(";"), ...filas].join("\r\n");
  const bom = "﻿"; // para que Excel detecte UTF-8 y no rompa las tildes/ñ
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  const fecha = new Date().toISOString().slice(0, 10);
  enlace.href = url;
  enlace.download = `descargas_${fecha}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

/** Elimina una descarga (ej. error de digitación). Si ya cayó dentro de la ventana de un
 * cuadre cerrado, advierte antes de confirmar en vez de bloquear el borrado. */
async function eliminarDescarga(id, fechaHoraTexto, monto) {
  let impacto;
  try {
    impacto = await Api.get(`/descargas/${id}/impacto`);
  } catch (err) {
    await avisar(err.message, "Error");
    return;
  }

  let mensaje = `¿Eliminar la descarga de $${fmt(monto)} del ${fechaHoraTexto}?`;
  if (impacto.afecta_cuadre) {
    const turnoTexto = `${NOMBRE_TURNO[impacto.turno]} del ${new Date(impacto.turno_inicio).toLocaleDateString("es-CL")}`;
    mensaje += impacto.editable
      ? ` ⚠️ Esta descarga ya forma parte del cuadre del turno ${turnoTexto}. Si la eliminas, edita ese cuadre después para que su total quede correcto.`
      : ` ⚠️ Esta descarga ya forma parte de un cuadre cerrado (turno ${turnoTexto}) que ya no se puede editar. Al eliminarla, el total de ese cuadre quedará desactualizado y no hay forma de corregirlo desde el sistema.`;
  }

  const confirmado = await confirmarAccion(mensaje, "Eliminar descarga");
  if (!confirmado) return;

  try {
    await Api.delete(`/descargas/${id}`);
    buscarDescargas();
  } catch (err) {
    await avisar(err.message, "Error");
  }
}

// Iniciar en la pestaña de reportes
cargarReportes();
