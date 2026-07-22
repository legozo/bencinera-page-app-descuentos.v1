const express = require("express");
const db = require("../db");
const { validarRut } = require("../rut");
const { capitalizarNombre } = require("../texto");
const { requiereAuth, requiereRol } = require("../auth");

const router = express.Router();
router.use(requiereAuth);

/**
 * Buscar socio por RUT (usado por el bombero antes de registrar una transacción).
 * Devuelve si es socio, su tipo, y las reglas de descuento vigentes por combustible.
 */
router.get("/buscar/:rut", async (req, res) => {
  const { valido, cuerpo, dv } = validarRut(req.params.rut);
  if (!valido) {
    return res.status(400).json({ error: "RUT inválido (dígito verificador no coincide)." });
  }

  const { rows } = await db.query(
    `SELECT s.id, s.rut, s.dv, s.nombre, s.apellido, s.activo, s.es_interno,
            ts.id AS tipo_socio_id, ts.nombre AS tipo_socio_nombre
     FROM socios s
     JOIN tipos_socio ts ON ts.id = s.tipo_socio_id
     WHERE s.rut = $1`,
    [cuerpo]
  );

  if (rows.length === 0) {
    return res.json({ es_socio: false, rut: cuerpo, dv });
  }

  const socio = rows[0];
  if (!socio.activo) {
    return res.json({ es_socio: false, motivo: "socio_inactivo", rut: cuerpo, dv });
  }
  if (socio.es_interno) {
    // El socio interno de traspasos de combustible no existe para el bombero: se registra
    // solo desde el panel admin (POST /transacciones/traspaso), nunca por RUT en el pistolero.
    return res.json({ es_socio: false, rut: cuerpo, dv });
  }

  // El precio se busca para la sucursal del bombero que está consultando (cada sucursal
  // puede tener su propio precio vigente). Se toma el más reciente (mayor vigente_desde).
  const reglas = await db.query(
    `SELECT c.id AS combustible_id, c.nombre AS combustible, r.descuento_clp_litro,
            (SELECT p.precio_clp_litro FROM precios_combustible p
             WHERE p.combustible_id = c.id AND p.sucursal_id = $2
             ORDER BY p.vigente_desde DESC LIMIT 1) AS precio_clp_litro
     FROM reglas_descuento r
     JOIN combustibles c ON c.id = r.combustible_id
     WHERE r.tipo_socio_id = $1
     ORDER BY c.nombre`,
    [socio.tipo_socio_id, req.usuario.sucursal_id]
  );

  res.json({
    es_socio: true,
    socio: {
      id: socio.id,
      rut: socio.rut,
      dv: socio.dv,
      nombre: socio.nombre,
      apellido: socio.apellido,
      tipo_socio_id: socio.tipo_socio_id,
      tipo_socio_nombre: socio.tipo_socio_nombre,
    },
    reglas_descuento: reglas.rows,
  });
});

/**
 * Listado con búsqueda simple (solo admin). Excluye a propósito el socio interno de
 * traspasos de combustible: no debe aparecer en "Gestionar socios" para que nadie lo
 * edite/reasigne por accidente — solo se crea/modifica directo en la base de datos.
 */
router.get("/", requiereRol("admin"), async (req, res) => {
  const { q } = req.query;
  let rows;
  if (q) {
    const like = `%${q}%`;
    ({ rows } = await db.query(
      `SELECT s.*, ts.nombre AS tipo_socio_nombre
       FROM socios s JOIN tipos_socio ts ON ts.id = s.tipo_socio_id
       WHERE s.es_interno = false AND (s.rut ILIKE $1 OR s.nombre ILIKE $1 OR s.apellido ILIKE $1)
       ORDER BY s.nombre LIMIT 200`,
      [like]
    ));
  } else {
    ({ rows } = await db.query(
      `SELECT s.*, ts.nombre AS tipo_socio_nombre
       FROM socios s JOIN tipos_socio ts ON ts.id = s.tipo_socio_id
       WHERE s.es_interno = false
       ORDER BY s.nombre LIMIT 200`
    ));
  }
  res.json(rows);
});

/** Crear socio (solo admin). */
router.post("/", requiereRol("admin"), async (req, res) => {
  const { rut, nombre, apellido, tipo_socio_id, telefono, email, direccion } = req.body || {};
  const { valido, cuerpo, dv } = validarRut(rut);
  if (!valido) return res.status(400).json({ error: "RUT inválido." });
  if (!nombre || !tipo_socio_id) {
    return res.status(400).json({ error: "Nombre y tipo de socio son obligatorios." });
  }

  // Normaliza nombre/apellido a "Primera Letra Mayúscula" sin importar cómo lo haya
  // escrito el bombero/admin (todo minúscula, todo mayúscula, mezclado).
  const nombreNormalizado = capitalizarNombre(nombre);
  const apellidoNormalizado = apellido ? capitalizarNombre(apellido) : null;

  try {
    const { rows } = await db.query(
      `INSERT INTO socios (rut, dv, nombre, apellido, tipo_socio_id, telefono, email, direccion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [cuerpo, dv, nombreNormalizado, apellidoNormalizado, tipo_socio_id, telefono || null, email || null, direccion || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe un socio con ese RUT." });
    }
    console.error(err);
    res.status(500).json({ error: "Error al crear el socio." });
  }
});

/** Editar socio (solo admin). El socio interno de traspasos no se puede tocar desde acá. */
router.put("/:id", requiereRol("admin"), async (req, res) => {
  const proteccion = await db.query("SELECT es_interno FROM socios WHERE id = $1", [req.params.id]);
  if (proteccion.rows[0]?.es_interno) {
    return res.status(403).json({ error: "Este socio es de uso interno para traspasos de combustible y no se puede modificar desde el panel." });
  }
  const { nombre, apellido, tipo_socio_id, activo, telefono, email, direccion } = req.body || {};

  // UPDATE dinámico: solo toca los campos que VIENEN en el body. Antes se usaba COALESCE con
  // `valor || null`, que no distinguía "campo no enviado" (conservar) de "campo enviado vacío"
  // (borrar) — al borrar el teléfono/dirección en el formulario y guardar, el valor viejo se
  // conservaba en silencio. Ahora un campo opcional enviado como "" queda NULL de verdad.
  const sets = [];
  const valores = [];
  const set = (campo, valor) => {
    valores.push(valor);
    sets.push(`${campo} = $${valores.length}`);
  };
  // Obligatorios: solo se actualizan si traen contenido (un "" no puede vaciarlos).
  if (nombre) set("nombre", capitalizarNombre(nombre));
  if (tipo_socio_id) set("tipo_socio_id", tipo_socio_id);
  if (activo === true || activo === false) set("activo", activo);
  // Opcionales: si vienen (aunque sea vacíos) se actualizan; "" los deja en NULL.
  if (apellido !== undefined) set("apellido", apellido ? capitalizarNombre(apellido) : null);
  if (telefono !== undefined) set("telefono", telefono || null);
  if (email !== undefined) set("email", email || null);
  if (direccion !== undefined) set("direccion", direccion || null);

  if (sets.length === 0) return res.status(400).json({ error: "No hay campos para actualizar." });
  valores.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE socios SET ${sets.join(", ")} WHERE id = $${valores.length} RETURNING *`,
    valores
  );
  if (rows.length === 0) return res.status(404).json({ error: "Socio no encontrado." });
  res.json(rows[0]);
});

/**
 * Eliminar socio (solo admin). Si el socio tiene transacciones registradas, la base de datos
 * rechaza el borrado (llave foránea) para no perder el historial de ventas — en ese caso se
 * devuelve un error claro sugiriendo desactivarlo en lugar de eliminarlo.
 */
router.delete("/:id", requiereRol("admin"), async (req, res) => {
  const proteccion = await db.query("SELECT es_interno FROM socios WHERE id = $1", [req.params.id]);
  if (proteccion.rows[0]?.es_interno) {
    return res.status(403).json({ error: "Este socio es de uso interno para traspasos de combustible y no se puede eliminar desde el panel." });
  }
  try {
    const { rowCount } = await db.query("DELETE FROM socios WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Socio no encontrado." });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(409).json({
        error: "No se puede eliminar: este socio tiene transacciones registradas. Desactívalo en su lugar.",
      });
    }
    console.error(err);
    res.status(500).json({ error: "Error al eliminar el socio." });
  }
});

module.exports = router;
