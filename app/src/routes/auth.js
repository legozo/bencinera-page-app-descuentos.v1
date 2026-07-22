const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { generarToken } = require("../auth");
const { validarRut } = require("../rut");

const router = express.Router();

// Límite de intentos fallidos de login, en memoria (se reinicia si el contenedor se
// reinicia — suficiente para este tamaño de app, no justifica sumar Redis u otra
// dependencia). La clave combina usuario+IP: bloquea a quien intenta adivinar la clave de
// UNA cuenta puntual, sin afectar a otros usuarios que compartan la misma IP (ej. la misma
// sucursal).
const intentosLogin = new Map(); // clave -> { fallos, bloqueadoHasta }
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

function registrarIntentoFallido(clave) {
  const registro = intentosLogin.get(clave) || { fallos: 0, bloqueadoHasta: 0 };
  registro.fallos += 1;
  registro.ultimoIntento = Date.now();
  if (registro.fallos >= MAX_INTENTOS) {
    registro.bloqueadoHasta = Date.now() + BLOQUEO_MS;
    registro.fallos = 0;
  }
  intentosLogin.set(clave, registro);
}

/** Poda las entradas que ya no aportan (bloqueo vencido y sin intentos recientes) para que
 * el Map no crezca sin tope con cada combinación usuario+IP que alguna vez falló un login. */
function limpiarIntentosViejos() {
  const ahora = Date.now();
  for (const [clave, registro] of intentosLogin) {
    const bloqueoVencido = (registro.bloqueadoHasta || 0) < ahora;
    const sinActividadReciente = ahora - (registro.ultimoIntento || 0) > BLOQUEO_MS;
    if (bloqueoVencido && sinActividadReciente) intentosLogin.delete(clave);
  }
}

/** Acepta como identificador el "usuario" de login O el RUT (con o sin puntos/guion) —
 * útil mientras conviven usuarios con y sin RUT cargado. Si lo tecleado no tiene forma de
 * RUT válido, esa mitad del OR simplemente no calza con nadie. */
router.post("/login", async (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) {
    return res.status(400).json({ error: "Usuario y clave son obligatorios." });
  }

  limpiarIntentosViejos();
  const clave = `${usuario}|${req.ip}`;
  const registro = intentosLogin.get(clave);
  if (registro && registro.bloqueadoHasta > Date.now()) {
    const minutos = Math.ceil((registro.bloqueadoHasta - Date.now()) / 60000);
    return res.status(429).json({ error: `Demasiados intentos fallidos. Intenta de nuevo en ${minutos} minuto(s).` });
  }

  const { valido, cuerpo, dv } = validarRut(usuario);
  const { rows } = await db.query(
    "SELECT * FROM usuarios WHERE activo = true AND (usuario = $1 OR (rut = $2 AND dv = $3))",
    [usuario, valido ? cuerpo : null, valido ? dv : null]
  );
  const user = rows[0];
  if (!user) {
    registrarIntentoFallido(clave);
    return res.status(401).json({ error: "Usuario o clave incorrectos." });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    registrarIntentoFallido(clave);
    return res.status(401).json({ error: "Usuario o clave incorrectos." });
  }
  intentosLogin.delete(clave);

  const token = generarToken(user);
  res.json({
    token,
    usuario: {
      id: user.id,
      nombre: user.nombre,
      apellido: user.apellido,
      usuario: user.usuario,
      rol: user.rol,
      sucursal_id: user.sucursal_id,
    },
  });
});

module.exports = router;
