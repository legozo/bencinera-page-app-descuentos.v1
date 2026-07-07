/**
 * Utilidades de normalización de texto (nombres/apellidos).
 */

/**
 * Pone en mayúscula la primera letra de cada palabra y el resto en minúscula,
 * sin importar cómo lo haya escrito el usuario (todo minúscula, todo mayúscula,
 * mezclado). También recorta espacios extra al inicio/final y entre palabras.
 * Ej: "jose ignacio" -> "Jose Ignacio", "GOMEZ  RODRIGUEZ" -> "Gomez Rodriguez".
 */
function capitalizarNombre(texto) {
  return String(texto || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((palabra) => (palabra ? palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase() : palabra))
    .join(" ");
}

module.exports = { capitalizarNombre };
