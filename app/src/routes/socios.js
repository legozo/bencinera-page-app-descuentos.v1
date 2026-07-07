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
    `SELECT s.id, s.rut, s.dv, s.nombre, s.apellido, s.activo,
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

/** Listado con búsqueda simple (solo admin). */
router.get("/", requiereRol("admin"), async (req, res) => {
  const { q } = req.query;
  let rows;
  if (q) {
    const like = `%${q}%`;
    ({ rows } = await db.query(
      `SELECT s.*, ts.nombre AS tipo_socio_nombre
       FROM socios s JOIN tipos_socio ts ON ts.id = s.tipo_socio_id
       WHERE s.rut ILIKE $1 OR s.nombre ILIKE $1 OR s.apellido ILIKE $1
       ORDER BY s.nombre LIMIT 200`,
      [like]
    ));
  } else {
    ({ rows } = await db.query(
      `SELECT s.*, ts.nombre AS tipo_socio_nombre
       FROM socios s JOIN tipos_socio ts ON ts.id = s.tipo_socio_id
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

/** Editar socio (solo admin). */
router.put("/:id", requiereRol("admin"), async (req, res) => {
  const { nombre, apellido, tipo_socio_id, activo, telefono, email, direccion } = req.body || {};
  // Nota: antes esto usaba `apellido || null` (sin COALESCE), lo que borraba apellido/telefono/email
  // cada vez que solo se mandaba { activo } (ej. al activar/desactivar). Se corrigió a COALESCE
  // para que un campo no enviado conserve su valor actual.
  const nombreNormalizado = nombre ? capitalizarNombre(nombre) : nombre;
  const apellidoNormalizado = apellido ? capitalizarNombre(apellido) : apellido;
  const { rows } = await db.query(
    `UPDATE socios SET
       nombre = COALESCE($1, nombre),
       apellido = COALESCE($2, apellido),
       tipo_socio_id = COALESCE($3, tipo_socio_id),
       activo = COALESCE($4, activo),
       telefono = COALESCE($5, telefono),
       email = COALESCE($6, email),
       direccion = COALESCE($7, direccion)
     WHERE id = $8 RETURNING *`,
    [nombreNormalizado, apellidoNormalizado || null, tipo_socio_id, activo, telefono || null, email || null, direccion || null, req.params.id]
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
