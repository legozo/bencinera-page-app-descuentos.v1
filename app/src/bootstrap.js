/**
 * Se ejecuta al iniciar el contenedor: crea las tablas si no existen, carga los datos
 * semilla (sucursales, combustibles, tipos de socio, reglas de descuento) y crea el
 * usuario admin por defecto si todavía no existe ninguno.
 */
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const db = require("./db");

async function esperarDb(maxIntentos = 20) {
  for (let i = 0; i < maxIntentos; i++) {
    try {
      await db.query("SELECT 1");
      return;
    } catch (err) {
      console.log(`Esperando base de datos... intento ${i + 1}/${maxIntentos}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("No se pudo conectar a la base de datos.");
}

async function ejecutarArchivoSql(nombreArchivo) {
  const ruta = path.join(__dirname, "..", "..", "sql", nombreArchivo);
  const sql = fs.readFileSync(ruta, "utf8");
  await db.query(sql);
}

async function crearAdminPorDefecto() {
  const { rows } = await db.query("SELECT COUNT(*)::int AS total FROM usuarios WHERE rol = 'admin'");
  if (rows[0].total > 0) return;

  const usuarioDefault = process.env.ADMIN_USER || "admin";
  const claveDefault = process.env.ADMIN_PASSWORD || "cambiar123";
  const hash = await bcrypt.hash(claveDefault, 10);

  await db.query(
    `INSERT INTO usuarios (nombre, usuario, password_hash, rol, sucursal_id, activo)
     VALUES ($1, $2, $3, 'admin', NULL, true)`,
    ["Administrador", usuarioDefault, hash]
  );
  console.log(`Usuario admin creado -> usuario: "${usuarioDefault}" / clave: "${claveDefault}" (¡cámbiala luego de iniciar sesión!)`);
}

async function iniciar() {
  await esperarDb();
  await ejecutarArchivoSql("schema.sql");
  await ejecutarArchivoSql("seed.sql");
  await crearAdminPorDefecto();
  console.log("Base de datos lista.");
}

module.exports = { iniciar };
