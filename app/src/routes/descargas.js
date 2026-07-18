const express = require("express");
const db = require("../db");
const { requiereAuth, requiereRol } = require("../auth");

const router = express.Router();
router.use(requiereAuth, requiereRol("admin"));

/** Historial de descargas con filtros (el admin las digita a nombre del bombero). */
router.get("/", async (req, res) => {
  const { desde, hasta, sucursal_id, bombero_id } = req.query;
  const condiciones = [];
  const valores = [];

  if (desde) {
    valores.push(desde);
    condiciones.push(`d.creado_en >= $${valores.length}`);
  }
  if (hasta) {
    valores.push(hasta);
    condiciones.push(`d.creado_en < ($${valores.length}::date + interval '1 day')`);
  }
  if (sucursal_id) {
    valores.push(sucursal_id);
    condiciones.push(`d.sucursal_id = $${valores.length}`);
  }
  if (bombero_id) {
    valores.push(bombero_id);
    condiciones.push(`d.bombero_id = $${valores.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const { rows } = await db.query(
    `SELECT d.*, su.nombre AS sucursal_nombre, u.nombre AS bombero_nombre, u.apellido AS bombero_apellido
     FROM descargas d
     JOIN sucursales su ON su.id = d.sucursal_id
     JOIN usuarios u ON u.id = d.bombero_id
     ${where}
     ORDER BY d.creado_en DESC`,
    valores
  );
  res.json(rows);
});

/** Registrar una descarga nueva. */
router.post("/", async (req, res) => {
  const { sucursal_id, bombero_id, monto } = req.body || {};
  if (!sucursal_id || !bombero_id || !monto || Number.isNaN(Number(monto)) || Number(monto) <= 0) {
    return res.status(400).json({ error: "Sucursal, bombero y monto (mayor a 0) son obligatorios." });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO descargas (sucursal_id, bombero_id, monto) VALUES ($1, $2, $3) RETURNING *`,
      [sucursal_id, bombero_id, monto]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23503") {
      return res.status(400).json({ error: "La sucursal o el bombero no existen (puede que se haya eliminado mientras completabas el formulario)." });
    }
    console.error(err);
    res.status(500).json({ error: "Error al registrar la descarga." });
  }
});

module.exports = router;
