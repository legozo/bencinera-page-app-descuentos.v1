const express = require("express");
const db = require("../db");
const { requiereAuth, requiereRol } = require("../auth");

const router = express.Router();
router.use(requiereAuth, requiereRol("bombero", "admin"));

/**
 * Paquete de datos para que la pantalla del bombero funcione sin conexión: socios activos,
 * catálogos, y las reglas de descuento y precios VIGENTES (no todo el historial, solo lo
 * necesario para seguir atendiendo durante un corte). El bombero lo descarga mientras hay
 * internet y lo guarda en su navegador; se refresca automáticamente cada vez que hay conexión.
 */
router.get("/bundle", async (req, res) => {
  if (!req.usuario.sucursal_id) {
    return res.status(400).json({ error: "Tu usuario no tiene una sucursal asignada." });
  }

  const [socios, tiposSocio, combustibles, reglas, precios] = await Promise.all([
    db.query(
      `SELECT id, rut, dv, nombre, apellido, tipo_socio_id
       FROM socios WHERE activo = true`
    ),
    db.query("SELECT id, nombre FROM tipos_socio"),
    db.query("SELECT id, nombre FROM combustibles"),
    db.query(
      `SELECT DISTINCT ON (tipo_socio_id, combustible_id)
              tipo_socio_id, combustible_id, descuento_clp_litro
       FROM reglas_descuento
       ORDER BY tipo_socio_id, combustible_id, vigente_desde DESC`
    ),
    db.query(
      `SELECT DISTINCT ON (combustible_id)
              combustible_id, precio_clp_litro
       FROM precios_combustible
       WHERE sucursal_id = $1
       ORDER BY combustible_id, vigente_desde DESC`,
      [req.usuario.sucursal_id]
    ),
  ]);

  res.json({
    generado_en: new Date().toISOString(),
    sucursal_id: req.usuario.sucursal_id,
    socios: socios.rows,
    tipos_socio: tiposSocio.rows,
    combustibles: combustibles.rows,
    reglas_descuento: reglas.rows,
    precios: precios.rows,
  });
});

module.exports = router;
