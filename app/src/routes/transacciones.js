const express = require("express");
const db = require("../db");
const { validarRut } = require("../rut");
const { requiereAuth, requiereRol } = require("../auth");

const router = express.Router();
router.use(requiereAuth);

/**
 * Lógica central para registrar una venta, compartida entre el registro en línea (POST /)
 * y la sincronización de ventas guardadas offline (POST /sync). Siempre vuelve a calcular
 * el precio y el descuento en el servidor a partir del historial — nunca confía en un monto
 * que venga del cliente — usando el precio/descuento vigente EN LA FECHA indicada (que para
 * una venta en línea es "ahora", y para una venta sincronizada es la hora real en que ocurrió).
 */
async function registrarVenta({ sucursalId, usuarioId, rut, combustibleId, litros, timestamp, idLocal, permitirInterno = false }) {
  const litrosNum = Number(litros);
  if (!combustibleId || !litrosNum || litrosNum <= 0) {
    return { ok: false, status: 400, error: "Combustible y litros (mayor a 0) son obligatorios." };
  }

  const { valido, cuerpo } = validarRut(rut);
  if (!valido) return { ok: false, status: 400, error: "RUT inválido." };

  if (!sucursalId) {
    return { ok: false, status: 400, error: "Tu usuario no tiene una sucursal asignada." };
  }

  const fecha = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(fecha.getTime())) {
    return { ok: false, status: 400, error: "Fecha/hora inválida." };
  }

  if (idLocal) {
    const existente = await db.query("SELECT * FROM transacciones WHERE id_local = $1", [idLocal]);
    if (existente.rows[0]) {
      // Ya se había sincronizado antes (reintento): no es un error, solo se informa como tal.
      return { ok: true, duplicado: true, transaccion: existente.rows[0] };
    }
  }

  const precioRes = await db.query(
    `SELECT precio_clp_litro FROM precios_combustible
     WHERE sucursal_id = $1 AND combustible_id = $2 AND vigente_desde <= $3
     ORDER BY vigente_desde DESC LIMIT 1`,
    [sucursalId, combustibleId, fecha]
  );
  if (!precioRes.rows[0]) {
    return {
      ok: false,
      status: 400,
      error: "No hay un precio configurado para este combustible en tu sucursal (a esa fecha). Pide al administrador que lo configure en la pestaña Precios.",
    };
  }
  const precioLitro = Number(precioRes.rows[0].precio_clp_litro);

  const socioRes = await db.query("SELECT * FROM socios WHERE rut = $1 AND activo = true", [cuerpo]);
  let socio = socioRes.rows[0];
  if (socio && socio.es_interno && !permitirInterno) {
    // El socio interno de traspasos de combustible solo se puede usar desde POST /traspaso
    // (admin). Si alguien intenta esa RUT desde el flujo normal de venta, se trata como si
    // no fuera socio (sin descuento) en vez de aplicar el 100% por error.
    socio = undefined;
  }

  let descuentoPorLitro = 0;
  if (socio && socio.es_interno) {
    // Traspaso interno: el descuento siempre es el 100% del precio vigente en ese momento,
    // no un monto fijo en reglas_descuento — así nunca queda desactualizado cuando cambia el
    // precio del combustible.
    descuentoPorLitro = precioLitro;
  } else if (socio) {
    const reglaRes = await db.query(
      `SELECT descuento_clp_litro FROM reglas_descuento
       WHERE tipo_socio_id = $1 AND combustible_id = $2 AND vigente_desde <= $3
       ORDER BY vigente_desde DESC LIMIT 1`,
      [socio.tipo_socio_id, combustibleId, fecha]
    );
    descuentoPorLitro = reglaRes.rows[0] ? Number(reglaRes.rows[0].descuento_clp_litro) : 0;
  }

  const descuentoTotal = Math.round(descuentoPorLitro * litrosNum * 100) / 100;
  const montoTotal = Math.round((precioLitro - descuentoPorLitro) * litrosNum * 100) / 100;

  const { rows } = await db.query(
    `INSERT INTO transacciones
       (socio_id, rut_consultado, sucursal_id, usuario_id, combustible_id, litros,
        precio_litro_clp, descuento_clp_litro, descuento_total_clp, monto_total_clp, creado_en, id_local)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      socio ? socio.id : null,
      cuerpo,
      sucursalId,
      usuarioId,
      combustibleId,
      litrosNum,
      precioLitro,
      descuentoPorLitro,
      descuentoTotal,
      montoTotal,
      fecha,
      idLocal || null,
    ]
  );

  return {
    ok: true,
    transaccion: rows[0],
    es_socio: !!socio,
    precio_litro: precioLitro,
    descuento_por_litro: descuentoPorLitro,
    descuento_total: descuentoTotal,
    monto_total: montoTotal,
  };
}

/** Registrar una transacción en línea (el caso normal, con conexión). */
router.post("/", requiereRol("bombero", "admin"), async (req, res) => {
  const { rut, combustible_id, litros } = req.body || {};
  const resultado = await registrarVenta({
    sucursalId: req.usuario.sucursal_id,
    usuarioId: req.usuario.id,
    rut,
    combustibleId: combustible_id,
    litros,
  });
  if (!resultado.ok) return res.status(resultado.status).json({ error: resultado.error });
  res.status(201).json(resultado);
});

/**
 * Registrar un traspaso de combustible (movimiento entre estanques o hacia otra sucursal,
 * no una venta real): usa internamente el único socio marcado es_interno, con 100% de
 * descuento, para que el litraje quede reflejado en el cuadre de caja sin figurar como un
 * descuento real a un socio. Solo admin — el bombero nunca ve ni puede usar este socio.
 */
router.post("/traspaso", requiereRol("admin"), async (req, res) => {
  const { sucursal_id, combustible_id, litros } = req.body || {};
  if (!sucursal_id) {
    return res.status(400).json({ error: "Sucursal es obligatoria." });
  }
  const internoRes = await db.query("SELECT rut, dv FROM socios WHERE es_interno = true LIMIT 1");
  if (!internoRes.rows[0]) {
    return res.status(500).json({
      error: "No existe el socio interno para traspasos. Debe crearse directo en la base de datos.",
    });
  }
  const resultado = await registrarVenta({
    sucursalId: sucursal_id,
    usuarioId: req.usuario.id,
    rut: `${internoRes.rows[0].rut}-${internoRes.rows[0].dv}`,
    combustibleId: combustible_id,
    litros,
    permitirInterno: true,
  });
  if (!resultado.ok) return res.status(resultado.status).json({ error: resultado.error });
  res.status(201).json(resultado);
});

/**
 * Sincronizar ventas guardadas sin conexión. Cada item trae la hora REAL en que ocurrió la
 * venta (timestamp_local, generado por el dispositivo del bombero) y un id_local único para
 * poder reintentar sin duplicar si la sincronización se corta a medias.
 */
router.post("/sync", requiereRol("bombero", "admin"), async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items debe ser una lista con al menos un elemento." });
  }
  if (items.length > 500) {
    return res.status(400).json({ error: "Demasiados elementos en un solo lote (máximo 500)." });
  }

  const resultados = [];
  for (const item of items) {
    const { id_local, rut, combustible_id, litros, timestamp_local } = item || {};
    if (!id_local) {
      resultados.push({ id_local: id_local || null, ok: false, error: "Falta id_local." });
      continue;
    }
    try {
      const resultado = await registrarVenta({
        sucursalId: req.usuario.sucursal_id,
        usuarioId: req.usuario.id,
        rut,
        combustibleId: combustible_id,
        litros,
        timestamp: timestamp_local,
        idLocal: id_local,
      });
      resultados.push({ id_local, ...resultado });
    } catch (err) {
      console.error("Error sincronizando item offline:", err);
      resultados.push({ id_local, ok: false, error: "Error inesperado al sincronizar." });
    }
  }

  res.json({ resultados });
});

/** Historial con filtros (solo admin). */
router.get("/", requiereRol("admin"), async (req, res) => {
  const { desde, hasta, sucursal_id, usuario_id, combustible_id, rut, precio_min, precio_max, pagina, exportar } = req.query;
  const condiciones = [];
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
  if (usuario_id) {
    valores.push(usuario_id);
    condiciones.push(`t.usuario_id = $${valores.length}`);
  }
  if (combustible_id) {
    valores.push(combustible_id);
    condiciones.push(`t.combustible_id = $${valores.length}`);
  }
  if (rut) {
    // rut_consultado se guarda sin puntos/guion/dv, así que se limpia lo que escriba el
    // admin (puede tener puntos, guion y/o dígito verificador) antes de buscar por coincidencia parcial.
    const rutLimpio = String(rut).replace(/[.\s]/g, "").split("-")[0].replace(/[^0-9]/g, "");
    if (rutLimpio) {
      valores.push(`%${rutLimpio}%`);
      condiciones.push(`t.rut_consultado ILIKE $${valores.length}`);
    }
  }
  if (precio_min) {
    valores.push(precio_min);
    condiciones.push(`t.precio_litro_clp >= $${valores.length}`);
  }
  if (precio_max) {
    valores.push(precio_max);
    condiciones.push(`t.precio_litro_clp <= $${valores.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const porPagina = 500;
  const paginaActual = Math.max(1, parseInt(pagina, 10) || 1);
  const offset = (paginaActual - 1) * porPagina;
  // "exportar=1" pide TODAS las filas que calcen con los filtros, sin límite de página
  // (se usa solo para el botón "Exportar a Excel", que necesita el set completo).
  const exportarTodo = exportar === "1";
  const limiteSQL = exportarTodo ? "" : `LIMIT ${porPagina} OFFSET ${offset}`;

  const [resultadoFilas, resultadoConteo, resultadoSuma] = await Promise.all([
    db.query(
      `SELECT t.*, s.nombre AS socio_nombre, s.apellido AS socio_apellido, s.dv AS socio_dv,
              c.nombre AS combustible_nombre, su.nombre AS sucursal_nombre,
              u.nombre AS bombero_nombre, u.apellido AS bombero_apellido
       FROM transacciones t
       LEFT JOIN socios s ON s.id = t.socio_id
       JOIN combustibles c ON c.id = t.combustible_id
       JOIN sucursales su ON su.id = t.sucursal_id
       JOIN usuarios u ON u.id = t.usuario_id
       ${where}
       ORDER BY t.creado_en DESC
       ${limiteSQL}`,
      valores
    ),
    db.query(
      `SELECT COUNT(*)::int AS total FROM transacciones t ${where}`,
      valores
    ),
    // Suma sobre TODAS las filas que calzan con el filtro (no solo la página actual), para
    // que "Total del período" sea correcto aunque el resultado tenga más de una página.
    db.query(
      `SELECT COALESCE(SUM(descuento_total_clp), 0) AS suma_descuentos FROM transacciones t ${where}`,
      valores
    ),
  ]);

  res.json({
    filas: resultadoFilas.rows,
    total: resultadoConteo.rows[0].total,
    suma_descuentos: resultadoSuma.rows[0].suma_descuentos,
    pagina: paginaActual,
    por_pagina: porPagina,
  });
});

module.exports = router;
