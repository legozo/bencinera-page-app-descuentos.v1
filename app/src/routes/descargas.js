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

/**
 * Antes de borrar, informa si esta descarga ya cayó dentro de la ventana horaria de un cuadre
 * cerrado (y si ese cuadre todavía se puede editar) para que el frontend arme la advertencia
 * correcta en el modal de confirmación.
 */
router.get("/:id/impacto", async (req, res) => {
  const descargaRes = await db.query("SELECT * FROM descargas WHERE id = $1", [req.params.id]);
  const descarga = descargaRes.rows[0];
  if (!descarga) return res.status(404).json({ error: "Descarga no encontrada." });

  // Misma ventana corrida 1 hora que usa totalesTurno() en cuadres.js al sumar descargas —
  // si no coincidiera, esta comprobación podría decir "no afecta ningún cuadre" para una
  // descarga que en realidad sí quedó sumada en el efectivo_total de un cuadre (o viceversa).
  const cuadreRes = await db.query(
    "SELECT * FROM cuadres_caja WHERE sucursal_id = $1 AND (turno_inicio + interval '1 hour') <= $2 AND (turno_fin + interval '1 hour') > $2",
    [descarga.sucursal_id, descarga.creado_en]
  );
  const cuadre = cuadreRes.rows[0];
  if (!cuadre) return res.json({ afecta_cuadre: false });

  const posteriorRes = await db.query(
    "SELECT EXISTS(SELECT 1 FROM cuadres_caja WHERE sucursal_id = $1 AND turno_fin > $2) AS hay",
    [cuadre.sucursal_id, cuadre.turno_fin]
  );
  res.json({
    afecta_cuadre: true,
    editable: !posteriorRes.rows[0].hay,
    turno: cuadre.turno,
    turno_inicio: cuadre.turno_inicio,
    turno_fin: cuadre.turno_fin,
  });
});

/** Eliminar una descarga (para corregir un error de digitación). No tiene registros
 * dependientes en otras tablas, así que se borra directo sin necesidad de manejar FK. */
router.delete("/:id", async (req, res) => {
  const { rowCount } = await db.query("DELETE FROM descargas WHERE id = $1", [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: "Descarga no encontrada." });
  res.json({ ok: true });
});

module.exports = router;
