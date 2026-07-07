/**
 * Utilidades para RUT chileno: normalización y cálculo/validación de dígito verificador.
 */

/** Quita puntos, guion y espacios; deja el cuerpo en mayúsculas (por si dv es K). */
function limpiarRut(rutCompleto) {
  return String(rutCompleto || "")
    .replace(/[.\s]/g, "")
    .replace("-", "")
    .toUpperCase();
}

/** Separa un RUT (con o sin dv) en { cuerpo, dv } donde dv puede venir incluido o no. */
function separarRut(rutCompleto) {
  const limpio = limpiarRut(rutCompleto);
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  return { cuerpo, dv };
}

/** Calcula el dígito verificador (módulo 11) para un cuerpo de RUT (solo números). */
function calcularDv(cuerpo) {
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

/**
 * Valida un RUT completo (con dv incluido, con o sin puntos/guion).
 * Devuelve { valido, cuerpo, dv } — cuerpo y dv normalizados si es válido.
 */
function validarRut(rutCompleto) {
  const { cuerpo, dv } = separarRut(rutCompleto);
  if (!cuerpo || !/^\d+$/.test(cuerpo) || cuerpo.length < 7 || cuerpo.length > 8) {
    return { valido: false };
  }
  const dvCalculado = calcularDv(cuerpo);
  if (dvCalculado !== dv) {
    return { valido: false };
  }
  return { valido: true, cuerpo, dv };
}

module.exports = { limpiarRut, separarRut, calcularDv, validarRut };
