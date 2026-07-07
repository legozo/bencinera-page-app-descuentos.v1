/**
 * Copia en el navegador del mismo algoritmo de RUT chileno que usa el backend (rut.js),
 * para poder validar y buscar un socio en el cache local cuando no hay conexión.
 */
function limpiarRutCliente(rutCompleto) {
  return String(rutCompleto || "").replace(/[.\s]/g, "").replace("-", "").toUpperCase();
}

function calcularDvCliente(cuerpo) {
  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

function validarRutCliente(rutCompleto) {
  const limpio = limpiarRutCliente(rutCompleto);
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  if (!cuerpo || !/^\d+$/.test(cuerpo) || cuerpo.length < 7 || cuerpo.length > 8) {
    return { valido: false };
  }
  if (calcularDvCliente(cuerpo) !== dv) {
    return { valido: false };
  }
  return { valido: true, cuerpo, dv };
}
