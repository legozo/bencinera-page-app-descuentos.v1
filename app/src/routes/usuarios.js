const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { capitalizarNombre } = require("../texto");
const { requiereAuth, requiereRol } = require("../auth");
const { validarRut } = require("../rut");

const router = express.Router();
router.use(requiereAuth, requiereRol("admin"));

/** Listar bomberos/admins. */
router.get("/", async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.apellido, u.usuario, u.rut, u.dv, u.rol, u.activo, u.sucursal_id, u.creado_en, u.telefono, s.nombre AS sucursal_nombre
     FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id
     ORDER BY u.nombre`
  );
  res.json(rows);
});

/** Crear un bombero o admin nuevo. El RUT es opcional (mientras se completa el de usuarios viejos). */
router.post("/", async (req, res) => {
  const { nombre, apellido, usuario, password, rol, sucursal_id, telefono, rut } = req.body || {};
  if (!nombre || !usuario || !password || !rol) {
    return res.status(400).json({ error: "Nombre, usuario, clave y rol son obligatorios." });
  }
  // Mismo mínimo que exige el modal de "Cambiar clave" en el panel — la API no puede confiar
  // en que siempre se llegue por ahí.
  if (password.length < 4) {
    return res.status(400).json({ error: "La clave debe tener al menos 4 caracteres." });
  }
  if (!["admin", "bombero"].includes(rol)) {
    return res.status(400).json({ error: "Rol inválido." });
  }
  if (rol === "bombero" && !sucursal_id) {
    return res.status(400).json({ error: "Los bomberos deben tener una sucursal asignada." });
  }
  let rutCuerpo = null;
  let rutDv = null;
  if (rut) {
    const { valido, cuerpo, dv } = validarRut(rut);
    if (!valido) return res.status(400).json({ error: "RUT inválido." });
    rutCuerpo = cuerpo;
    rutDv = dv;
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const nombreNormalizado = capitalizarNombre(nombre);
    const apellidoNormalizado = apellido ? capitalizarNombre(apellido) : null;
    const { rows } = await db.query(
      `INSERT INTO usuarios (nombre, apellido, usuario, password_hash, rol, sucursal_id, telefono, rut, dv)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, nombre, apellido, usuario, rut, dv, rol, sucursal_id, activo, telefono`,
      [nombreNormalizado, apellidoNormalizado, usuario, hash, rol, sucursal_id || null, telefono || null, rutCuerpo, rutDv]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505" && err.constraint === "idx_usuarios_rut") {
      return res.status(409).json({ error: "Ya existe un usuario con ese RUT." });
    }
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ese nombre de usuario ya existe." });
    }
    console.error(err);
    res.status(500).json({ error: "Error al crear el usuario." });
  }
});

/** Editar (activar/desactivar, cambiar clave, cambiar sucursal, completar RUT). */
router.put("/:id", async (req, res) => {
  const { nombre, apellido, sucursal_id, activo, password, telefono, rut } = req.body || {};
  // Mismo espíritu que "no puedes eliminar tu propia cuenta" en DELETE: desactivarse a sí
  // mismo dejaría a un admin sin forma de volver a entrar y reactivarse.
  if (activo === false && Number(req.params.id) === req.usuario.id) {
    return res.status(400).json({ error: "No puedes desactivar tu propia cuenta." });
  }
  if (password && password.length < 4) {
    return res.status(400).json({ error: "La clave debe tener al menos 4 caracteres." });
  }

  // UPDATE dinámico: solo toca los campos que VIENEN en el body (mismo cambio que en
  // PUT /socios/:id — el COALESCE anterior impedía vaciar apellido/teléfono: al borrarlos
  // en el formulario y guardar, el valor viejo se conservaba en silencio).
  const sets = [];
  const valores = [];
  const set = (campo, valor) => {
    valores.push(valor);
    sets.push(`${campo} = $${valores.length}`);
  };
  if (nombre) set("nombre", capitalizarNombre(nombre));
  if (sucursal_id) set("sucursal_id", sucursal_id);
  if (activo === true || activo === false) set("activo", activo);
  if (password) set("password_hash", await bcrypt.hash(password, 10));
  if (apellido !== undefined) set("apellido", apellido ? capitalizarNombre(apellido) : null);
  if (telefono !== undefined) set("telefono", telefono || null);
  if (rut) {
    const { valido, cuerpo, dv } = validarRut(rut);
    if (!valido) return res.status(400).json({ error: "RUT inválido." });
    set("rut", cuerpo);
    set("dv", dv);
  }

  if (sets.length === 0) return res.status(400).json({ error: "No hay campos para actualizar." });

  try {
    valores.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE usuarios SET ${sets.join(", ")}
       WHERE id = $${valores.length}
       RETURNING id, nombre, apellido, usuario, rut, dv, rol, sucursal_id, activo, telefono`,
      valores
    );
    if (rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado." });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505" && err.constraint === "idx_usuarios_rut") {
      return res.status(409).json({ error: "Ya existe un usuario con ese RUT." });
    }
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el usuario." });
  }
});

/**
 * Eliminar usuario/bombero (solo admin). Si el usuario registró transacciones o cargó precios,
 * la base de datos rechaza el borrado (llave foránea) para no perder ese historial — se devuelve
 * un error claro sugiriendo desactivarlo en lugar de eliminarlo.
 */
router.delete("/:id", async (req, res) => {
  if (Number(req.params.id) === req.usuario.id) {
    return res.status(400).json({ error: "No puedes eliminar tu propia cuenta." });
  }
  try {
    const { rowCount } = await db.query("DELETE FROM usuarios WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Usuario no encontrado." });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(409).json({
        error: "No se puede eliminar: este usuario tiene transacciones u otros registros asociados. Desactívalo en su lugar.",
      });
    }
    console.error(err);
    res.status(500).json({ error: "Error al eliminar el usuario." });
  }
});

module.exports = router;
