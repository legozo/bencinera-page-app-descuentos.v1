const usuarioActual = requerirSesion("bombero");
if (usuarioActual) {
  document.getElementById("tituloUsuario").textContent = `Bencinera - ${usuarioActual.nombre}${usuarioActual.apellido ? " " + usuarioActual.apellido : ""}`;
}

let ultimaBusqueda = null; // guarda { es_socio, socio, reglas_descuento, rut, modo_offline }

/** Copia del mismo redondeo que usa el servidor (ver transacciones.js): el peso chileno ya
 * no usa monedas de $1 ni $5, así que el descuento y el monto a cobrar se redondean al
 * múltiplo de $10 más cercano. Se calcula igual acá para que esta vista previa (antes de
 * registrar) coincida exactamente con lo que el servidor va a guardar y cobrar. */
function redondearA10Cliente(valor) {
  return Math.round(valor / 10) * 10;
}

/** Misma limpieza en vivo que usa el Cuadre de caja en admin.js (ver sanearNumero allá):
 * en varios teclados/navegadores de Android, type="number" con decimales deja el valor que
 * lee JavaScript desincronizado del que se ve en pantalla — por eso el campo de litros usa
 * type="text" inputmode="decimal" y se limpia acá (solo dígitos y un único punto decimal). */
function sanearNumero(input) {
  let valor = input.value.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const primerPunto = valor.indexOf(".");
  if (primerPunto !== -1) {
    valor = valor.slice(0, primerPunto + 1) + valor.slice(primerPunto + 1).replace(/\./g, "");
  }
  if (valor !== input.value) input.value = valor;
}

// ---------- Estado de conexión y sincronización ----------
function renderizarEstado() {
  const div = document.getElementById("estadoConexion");
  const pendientes = Offline.contarPendientes();
  const errores = Offline.obtenerErrores();
  const conectado = navigator.onLine;

  let html = conectado
    ? `<span style="color:var(--verde);">● Conectado</span>`
    : `<span style="color:var(--rojo);">● Sin conexión — las ventas se guardan en este dispositivo</span>`;

  if (pendientes > 0) {
    html += ` — <strong>${pendientes}</strong> venta(s) pendiente(s) de sincronizar`;
  }
  if (errores.length > 0) {
    html += `<br><span style="color:var(--rojo);">${errores.length} venta(s) no se pudieron sincronizar (revisa con el administrador).
      <button class="secundario" style="padding:2px 8px; font-size:12px;" onclick="Offline.limpiarErrores(); renderizarEstado();">Ocultar</button></span>`;
  }
  div.innerHTML = html;
}

async function actualizarYSincronizar() {
  if (navigator.onLine) {
    await Offline.refrescarBundle();
    await Offline.sincronizarPendientes();
  }
  renderizarEstado();
}

window.addEventListener("online", actualizarYSincronizar);
window.addEventListener("offline", renderizarEstado);

// Al abrir la pantalla: intenta refrescar el cache y sincronizar pendientes si hay conexión.
actualizarYSincronizar();
// Reintenta cada 20 segundos (por si la conexión vuelve sin disparar el evento "online",
// algo que pasa seguido en redes celulares) y refresca el cache completo cada 2 minutos.
setInterval(() => Offline.sincronizarPendientes().then(renderizarEstado), 20000);
setInterval(() => Offline.refrescarBundle(), 120000);

// ---------- Consultar RUT ----------
async function buscarSocio() {
  const rut = document.getElementById("rut").value.trim();
  const errorDiv = document.getElementById("errorBusqueda");
  const resultadoDiv = document.getElementById("resultado");
  errorDiv.classList.add("oculto");
  resultadoDiv.classList.add("oculto");

  if (!rut) {
    errorDiv.textContent = "Ingresa un RUT.";
    errorDiv.classList.remove("oculto");
    return;
  }

  try {
    const data = await Api.get(`/socios/buscar/${encodeURIComponent(rut)}`);
    ultimaBusqueda = { ...data, rut };
    renderizarResultado(data);
  } catch (err) {
    if (err.esErrorDeRed) {
      const data = Offline.buscarSocioLocal(rut);
      if (data.error) {
        errorDiv.textContent = data.error;
        errorDiv.classList.remove("oculto");
        return;
      }
      ultimaBusqueda = { ...data, rut };
      renderizarResultado(data);
    } else {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove("oculto");
    }
  }
}

function renderizarResultado(data) {
  const resultadoDiv = document.getElementById("resultado");
  resultadoDiv.classList.remove("oculto");

  const avisoOffline = data.modo_offline
    ? `<div class="chico" style="color:var(--rojo); margin-bottom:8px;">⚠ Consultado desde el cache local (sin conexión) — puede no reflejar cambios recientes.</div>`
    : "";

  if (!data.es_socio) {
    resultadoDiv.innerHTML = `
      ${avisoOffline}
      <div class="resultado-no-socio">
        <strong>No es socio registrado.</strong><br>
        <span class="chico">RUT ${escaparHtml(data.rut)} no tiene descuentos asociados.</span>
      </div>`;
    return;
  }

  const s = data.socio;
  const opciones = data.reglas_descuento
    .map((r) => {
      const sinPrecio = r.precio_clp_litro === null || r.precio_clp_litro === undefined;
      const etiquetaPrecio = sinPrecio ? "precio no configurado" : `$${r.precio_clp_litro}/L`;
      return `<option value="${r.combustible_id}" data-descuento="${r.descuento_clp_litro}" data-precio="${sinPrecio ? "" : r.precio_clp_litro}">${escaparHtml(r.combustible)} — ${etiquetaPrecio}, descuento $${r.descuento_clp_litro}/L</option>`;
    })
    .join("");

  resultadoDiv.innerHTML = `
    ${avisoOffline}
    <div class="resultado-socio">
      <strong>${escaparHtml(`${s.nombre} ${s.apellido || ""}`)}</strong><br>
      <span class="chico">Socio ${escaparHtml(s.tipo_socio_nombre)} — RUT ${escaparHtml(s.rut)}-${escaparHtml(s.dv)}</span>
    </div>
    <label for="combustible">Tipo de combustible</label>
    <select id="combustible" onchange="recalcular()">${opciones}</select>
    <label for="litros">Litros cargados</label>
    <input id="litros" type="text" inputmode="decimal" autocomplete="off" oninput="sanearNumero(this); recalcular();" placeholder="0.00">
    <div id="calculo" class="chico" style="margin-top:10px;"></div>
    <button class="primario" style="width:100%;" onclick="registrarTransaccion()">Registrar</button>
    <div id="errorRegistro" class="mensaje-error oculto"></div>
  `;
  recalcular();
}

function recalcular() {
  const select = document.getElementById("combustible");
  const litrosInput = document.getElementById("litros");
  const calculoDiv = document.getElementById("calculo");
  if (!select || !litrosInput) return;

  const precioTexto = select.selectedOptions[0]?.dataset.precio;
  const sinPrecio = !precioTexto;
  const descuento = Number(select.selectedOptions[0]?.dataset.descuento || 0);
  const precio = Number(precioTexto || 0);
  // "|| 0" DESPUÉS de Number(): un "." solo (posible ahora que el campo es de texto) da NaN
  // y debe tratarse como 0, no colarse en el cálculo.
  const litros = Number(litrosInput.value) || 0;

  if (sinPrecio) {
    calculoDiv.innerHTML = `<span style="color:var(--rojo);">Este combustible no tiene precio configurado en tu sucursal. Avisa al administrador antes de registrar la venta.</span>`;
    return;
  }

  const descuentoTotal = redondearA10Cliente(descuento * litros);
  const montoTotal = redondearA10Cliente((precio - descuento) * litros);
  calculoDiv.innerHTML = `
    Precio litro: $${precio.toLocaleString("es-CL")} — Descuento litro: $${descuento.toLocaleString("es-CL")}<br>
    Descuento total: $${descuentoTotal.toLocaleString("es-CL")}<br>
    A cobrar: <span class="monto-final">$${montoTotal.toLocaleString("es-CL")}</span>`;
}

async function registrarTransaccion() {
  const select = document.getElementById("combustible");
  const litrosInput = document.getElementById("litros");
  const errorDiv = document.getElementById("errorRegistro");
  errorDiv.classList.add("oculto");

  const litros = Number(litrosInput.value);
  if (!litros || litros <= 0) {
    errorDiv.textContent = "Ingresa una cantidad de litros válida.";
    errorDiv.classList.remove("oculto");
    return;
  }

  const combustibleId = Number(select.value);

  try {
    const resultado = await Api.post("/transacciones", {
      rut: ultimaBusqueda.rut,
      combustible_id: combustibleId,
      litros,
    });
    alert(`Registrado.\nA cobrar: $${resultado.monto_total.toLocaleString("es-CL")}\n(Descuento incluido: $${resultado.descuento_total.toLocaleString("es-CL")})`);
    limpiarPantallaVenta();
  } catch (err) {
    if (err.esErrorDeRed) {
      // Sin conexión: se guarda localmente con la hora real de ahora, y se sincroniza solo después.
      Offline.agregarPendiente({ rut: ultimaBusqueda.rut, combustible_id: combustibleId, litros });
      renderizarEstado();
      alert("Sin conexión: la venta quedó guardada en este dispositivo y se subirá sola apenas vuelva internet.");
      limpiarPantallaVenta();
    } else {
      errorDiv.textContent = err.message;
      errorDiv.classList.remove("oculto");
    }
  }
}

function limpiarPantallaVenta() {
  document.getElementById("rut").value = "";
  document.getElementById("resultado").classList.add("oculto");
  document.getElementById("rut").focus();
}

document.getElementById("rut").addEventListener("keydown", (e) => {
  if (e.key === "Enter") buscarSocio();
});
