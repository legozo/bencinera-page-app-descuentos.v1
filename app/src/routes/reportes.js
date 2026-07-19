const express = require("express");
const db = require("../db");
const { requiereAuth, requiereRol } = require("../auth");

const router = express.Router();
router.use(requiereAuth, requiereRol("admin"));

/** Resumen general: litros y descuento total, agrupado por sucursal y por combustible. */
router.get("/resumen", async (req, res) => {
  const { desde, hasta, sucursal_id } = req.query;
  // Excluye siempre al socio interno de traspasos de combustible: sus litros sí cuentan para
  // el cuadre de caja (vía totalesTurno en cuadres.js), pero no son un descuento real a un
  // socio, así que no deben inflar estos totales/reportes.
  const condiciones = ["(s.es_interno IS NOT TRUE)"];
  const valores = [];

  if (desde) {
    valores.push(desde);
    condiciones.push(`t.creado_en >= $${valores.length}`);
  }
  if (hasta) {
    valores.push(hasta);
    // "hasta" es una fecha (sin hora); se compara contra el día siguiente para incluir
    // todo ese día completo, no solo hasta las 00:00 de esa fecha.
    condiciones.push(`t.creado_en < ($${valores.length}::date + interval '1 day')`);
  }
  if (sucursal_id) {
    valores.push(sucursal_id);
    condiciones.push(`t.sucursal_id = $${valores.length}`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  // Antes esto traía dos tablas separadas (por sucursal y por combustible), que mostraban
  // casi la misma info dos veces sin conectar de dónde salía cada total. Se fusionaron en
  // un solo desglose por sucursal + combustible, para poder ver de dónde viene cada litro/
  // descuento/total (ej. cuánto diesel vendió cada sucursal), con subtotales por sucursal.
  const [detalle, totales] = await Promise.all([
    db.query(
      `SELECT su.nombre AS sucursal, c.nombre AS combustible, COUNT(*)::int AS transacciones,
              SUM(t.litros) AS litros, SUM(t.descuento_total_clp) AS descuento_total,
              SUM(t.monto_total_clp) AS monto_total
       FROM transacciones t
       JOIN sucursales su ON su.id = t.sucursal_id
       JOIN combustibles c ON c.id = t.combustible_id
       LEFT JOIN socios s ON s.id = t.socio_id
       ${where}
       GROUP BY su.nombre, c.nombre
       ORDER BY su.nombre, c.nombre`,
      valores
    ),
    db.query(
      `SELECT COUNT(*)::int AS transacciones, COALESCE(SUM(t.litros),0) AS litros,
              COALESCE(SUM(t.descuento_total_clp),0) AS descuento_total,
              COALESCE(SUM(t.monto_total_clp),0) AS monto_total
       FROM transacciones t
       LEFT JOIN socios s ON s.id = t.socio_id
       ${where}`,
      valores
    ),
  ]);

  res.json({
    totales: totales.rows[0],
    detalle: detalle.rows,
  });
});

module.exports = router;
