const express = require("express");
const db = require("../db");
const { capitalizarNombre } = require("../texto");
const { requiereAuth, requiereRol } = require("../auth");

const router = express.Router();
router.use(requiereAuth);

router.get("/sucursales", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM sucursales ORDER BY nombre");
  res.json(rows);
});

/** Crear una sucursal nueva (solo admin). */
router.post("/sucursales", requiereRol("admin"), async (req, res) => {
  const { nombre, direccion } = req.body || {};
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "El nombre de la sucursal es obligatorio." });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO sucursales (nombre, direccion) VALUES ($1, $2) RETURNING *`,
      [capitalizarNombre(nombre), direccion && direccion.trim() ? direccion.trim() : null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe una sucursal con ese nombre." });
    }
    console.error(err);
    res.status(500).json({ error: "Error al crear la sucursal." });
  }
});

router.get("/combustibles", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM combustibles ORDER BY nombre");
  res.json(rows);
});

router.get("/tipos-socio", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM tipos_socio ORDER BY nombre");
  res.json(rows);
});

/** Crear un tipo de socio nuevo (solo admin). */
router.post("/tipos-socio", requiereRol("admin"), async (req, res) => {
  const { nombre, descripcion } = req.body || {};
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "El nombre del tipo de socio es obligatorio." });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO tipos_socio (nombre, descripcion) VALUES ($1, $2) RETURNING *`,
      [capitalizarNombre(nombre), descripcion && descripcion.trim() ? descripcion.trim() : null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe un tipo de socio con ese nombre." });
    }
    console.error(err);
    res.status(500).json({ error: "Error al crear el tipo de socio." });
  }
});

/**
 * Regla de descuento vigente (la más reciente) por tipo de socio y combustible.
 * La tabla lleva historial completo; esto solo trae el valor actual de cada combinación.
 */
router.get("/reglas-descuento", requiereRol("admin"), async (req, res) => {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (r.tipo_socio_id, r.combustible_id)
            r.id, r.tipo_socio_id, ts.nombre AS tipo_socio_nombre,
            r.combustible_id, c.nombre AS combustible_nombre,
            r.descuento_clp_litro, r.vigente_desde
     FROM reglas_descuento r
     JOIN tipos_socio ts ON ts.id = r.tipo_socio_id
     JOIN combustibles c ON c.id = r.combustible_id
     ORDER BY r.tipo_socio_id, r.combustible_id, r.vigente_desde DESC`
  );
  res.json(rows);
});

/** Registra una regla nueva (agrega una fila con vigente_desde = ahora; no borra el historial). */
router.put("/reglas-descuento", requiereRol("admin"), async (req, res) => {
  const { tipo_socio_id, combustible_id, descuento_clp_litro } = req.body || {};
  if (!tipo_socio_id || !combustible_id || descuento_clp_litro === undefined) {
    return res.status(400).json({ error: "tipo_socio_id, combustible_id y descuento_clp_litro son obligatorios." });
  }
  const { rows } = await db.query(
    `INSERT INTO reglas_descuento (tipo_socio_id, combustible_id, descuento_clp_litro)
     VALUES ($1, $2, $3) RETURNING *`,
    [tipo_socio_id, combustible_id, descuento_clp_litro]
  );
  res.json(rows[0]);
});

/**
 * Precio vigente (el más reciente) por sucursal y combustible.
 * Si se pasa ?sucursal_id=, filtra solo esa sucursal (útil para el selector del bombero).
 */
router.get("/precios", requiereRol("admin"), async (req, res) => {
  const { sucursal_id } = req.query;
  const condicion = sucursal_id ? "WHERE p.sucursal_id = $1" : "";
  const valores = sucursal_id ? [sucursal_id] : [];
  const { rows } = await db.query(
    `SELECT DISTINCT ON (p.sucursal_id, p.combustible_id)
            p.id, p.sucursal_id, su.nombre AS sucursal_nombre,
            p.combustible_id, c.nombre AS combustible_nombre,
            p.precio_clp_litro, p.vigente_desde,
            (SELECT p2.precio_clp_litro FROM precios_combustible p2
             WHERE p2.sucursal_id = p.sucursal_id AND p2.combustible_id = p.combustible_id
               AND p2.vigente_desde < p.vigente_desde
             ORDER BY p2.vigente_desde DESC LIMIT 1) AS precio_anterior
     FROM precios_combustible p
     JOIN sucursales su ON su.id = p.sucursal_id
     JOIN combustibles c ON c.id = p.combustible_id
     ${condicion}
     ORDER BY p.sucursal_id, p.combustible_id, p.vigente_desde DESC`,
    valores
  );
  res.json(rows);
});

/**
 * Historial completo de precios para una combinación sucursal + combustible específica,
 * del más reciente al más antiguo, con el nombre de quién registró cada cambio.
 */
router.get("/precios/historial", requiereRol("admin"), async (req, res) => {
  const { sucursal_id, combustible_id } = req.query;
  if (!sucursal_id || !combustible_id) {
    return res.status(400).json({ error: "sucursal_id y combustible_id son obligatorios." });
  }
  const { rows } = await db.query(
    `SELECT p.id, p.precio_clp_litro, p.vigente_desde,
            u.nombre AS creado_por_nombre, u.apellido AS creado_por_apellido
     FROM precios_combustible p
     LEFT JOIN usuarios u ON u.id = p.creado_por
     WHERE p.sucursal_id = $1 AND p.combustible_id = $2
     ORDER BY p.vigente_desde DESC`,
    [sucursal_id, combustible_id]
  );
  res.json(rows);
});

/** Registra un precio nuevo (agrega una fila con vigente_desde = ahora; no borra el historial). */
router.post("/precios", requiereRol("admin"), async (req, res) => {
  const { sucursal_id, combustible_id, precio_clp_litro } = req.body || {};
  if (!sucursal_id || !combustible_id || precio_clp_litro === undefined || Number(precio_clp_litro) < 0) {
    return res.status(400).json({ error: "sucursal_id, combustible_id y precio_clp_litro (>= 0) son obligatorios." });
  }
  const { rows } = await db.query(
    `INSERT INTO precios_combustible (sucursal_id, combustible_id, precio_clp_litro, creado_por)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [sucursal_id, combustible_id, precio_clp_litro, req.usuario.id]
  );
  res.status(201).json(rows[0]);
});

module.exports = router;
