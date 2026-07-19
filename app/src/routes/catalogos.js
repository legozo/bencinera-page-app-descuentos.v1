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

/** Cambiar el nombre de una sucursal existente (solo admin). */
router.put("/sucursales/:id", requiereRol("admin"), async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "El nombre de la sucursal es obligatorio." });
  }
  try {
    const { rows } = await db.query(
      `UPDATE sucursales SET nombre = $1 WHERE id = $2 RETURNING *`,
      [capitalizarNombre(nombre), req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Sucursal no encontrada." });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe una sucursal con ese nombre." });
    }
    console.error(err);
    res.status(500).json({ error: "Error al actualizar la sucursal." });
  }
});

/**
 * Eliminar sucursal (solo admin). Si ya tiene precios, transacciones o usuarios asignados,
 * la base de datos rechaza el borrado (llave foránea) para no perder ese historial.
 */
router.delete("/sucursales/:id", requiereRol("admin"), async (req, res) => {
  try {
    const { rowCount } = await db.query("DELETE FROM sucursales WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Sucursal no encontrada." });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(409).json({
        error: "No se puede eliminar: esta sucursal ya tiene precios, transacciones o usuarios registrados.",
      });
    }
    console.error(err);
    res.status(500).json({ error: "Error al eliminar la sucursal." });
  }
});

/** Listado de máquinas/surtidores, opcionalmente filtrado por sucursal. */
router.get("/maquinas", async (req, res) => {
  const { sucursal_id } = req.query;
  const condicion = sucursal_id ? "WHERE m.sucursal_id = $1" : "";
  const valores = sucursal_id ? [sucursal_id] : [];
  const { rows } = await db.query(
    `SELECT m.*, s.nombre AS sucursal_nombre FROM maquinas m
     JOIN sucursales s ON s.id = m.sucursal_id
     ${condicion}
     ORDER BY s.nombre, m.nombre`,
    valores
  );
  res.json(rows);
});

/** Crear una máquina nueva (solo admin). Sin capitalizarNombre a propósito: los nombres
 * suelen ser códigos como "Máquina II-A", que el capitalizador por palabra dejaría mal
 * (ej. "Ii-a"). */
router.post("/maquinas", requiereRol("admin"), async (req, res) => {
  const { sucursal_id, nombre } = req.body || {};
  if (!sucursal_id || !nombre || !nombre.trim()) {
    return res.status(400).json({ error: "Sucursal y nombre son obligatorios." });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO maquinas (sucursal_id, nombre) VALUES ($1, $2) RETURNING *`,
      [sucursal_id, nombre.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe una máquina con ese nombre en esa sucursal." });
    }
    console.error(err);
    res.status(500).json({ error: "Error al crear la máquina." });
  }
});

/** Cambiar el nombre y/o activar-desactivar una máquina existente (solo admin). */
router.put("/maquinas/:id", requiereRol("admin"), async (req, res) => {
  const { nombre, activa } = req.body || {};
  if (nombre !== undefined && (typeof nombre !== "string" || !nombre.trim())) {
    return res.status(400).json({ error: "El nombre de la máquina no puede quedar vacío." });
  }
  try {
    const { rows } = await db.query(
      `UPDATE maquinas SET nombre = COALESCE($1, nombre), activa = COALESCE($2, activa) WHERE id = $3 RETURNING *`,
      [nombre ? nombre.trim() : null, activa, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Máquina no encontrada." });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe una máquina con ese nombre en esa sucursal." });
    }
    console.error(err);
    res.status(500).json({ error: "Error al actualizar la máquina." });
  }
});

/**
 * Eliminar máquina (solo admin). Si ya tiene lecturas de cuadres registradas, la base de
 * datos rechaza el borrado (llave foránea) — en ese caso hay que desactivarla en vez de
 * eliminarla (PUT con { activa: false }), igual que con socios y usuarios.
 */
router.delete("/maquinas/:id", requiereRol("admin"), async (req, res) => {
  try {
    const { rowCount } = await db.query("DELETE FROM maquinas WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Máquina no encontrada." });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(409).json({
        error: "No se puede eliminar: esta máquina ya tiene lecturas de cuadres de caja registradas. Desactívala en su lugar.",
      });
    }
    console.error(err);
    res.status(500).json({ error: "Error al eliminar la máquina." });
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

/** Cambiar el nombre de un tipo de socio existente (solo admin). */
router.put("/tipos-socio/:id", requiereRol("admin"), async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "El nombre del tipo de socio es obligatorio." });
  }
  try {
    const { rows } = await db.query(
      `UPDATE tipos_socio SET nombre = $1 WHERE id = $2 RETURNING *`,
      [capitalizarNombre(nombre), req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Tipo de socio no encontrado." });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe un tipo de socio con ese nombre." });
    }
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el tipo de socio." });
  }
});

/**
 * Eliminar tipo de socio (solo admin). Si ya tiene socios asignados o reglas de descuento
 * registradas, la base de datos rechaza el borrado (llave foránea) para no perder ese historial.
 */
router.delete("/tipos-socio/:id", requiereRol("admin"), async (req, res) => {
  try {
    const { rowCount } = await db.query("DELETE FROM tipos_socio WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Tipo de socio no encontrado." });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(409).json({
        error: "No se puede eliminar: este tipo de socio ya tiene socios o reglas de descuento registradas.",
      });
    }
    console.error(err);
    res.status(500).json({ error: "Error al eliminar el tipo de socio." });
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
  // El peso chileno no tiene centavos en uso: se redondea a entero (la columna ya no acepta decimales).
  const descuentoEntero = Math.round(Number(descuento_clp_litro));
  if (!Number.isFinite(descuentoEntero) || descuentoEntero < 0) {
    return res.status(400).json({ error: "descuento_clp_litro debe ser un número (0 o mayor)." });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO reglas_descuento (tipo_socio_id, combustible_id, descuento_clp_litro)
       VALUES ($1, $2, $3) RETURNING *`,
      [tipo_socio_id, combustible_id, descuentoEntero]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23503") {
      return res.status(400).json({ error: "El tipo de socio o el combustible no existen." });
    }
    console.error(err);
    res.status(500).json({ error: "Error al guardar la regla de descuento." });
  }
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
  // El peso chileno no tiene centavos en uso: se redondea a entero (la columna ya no acepta decimales).
  const precioEntero = Math.round(Number(precio_clp_litro));
  if (!Number.isFinite(precioEntero) || precioEntero < 0) {
    return res.status(400).json({ error: "precio_clp_litro debe ser un número (0 o mayor)." });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO precios_combustible (sucursal_id, combustible_id, precio_clp_litro, creado_por)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [sucursal_id, combustible_id, precioEntero, req.usuario.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23503") {
      return res.status(400).json({ error: "La sucursal o el combustible no existen." });
    }
    console.error(err);
    res.status(500).json({ error: "Error al guardar el precio." });
  }
});

module.exports = router;
