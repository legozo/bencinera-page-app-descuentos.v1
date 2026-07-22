const express = require("express");
const db = require("../db");
const { requiereAuth, requiereRol } = require("../auth");

const router = express.Router();
router.use(requiereAuth, requiereRol("admin"));

/**
 * Turnos fijos de 12 horas: "tarde" (08:00-20:00 de la fecha elegida) y "mañana" (20:00 del
 * día anterior a 08:00 de la fecha elegida — el que "amanece" ese día). Siempre se calculan a
 * partir de la fecha+turno que elige el admin por calendario, nunca de "la hora actual" del
 * servidor — eso permite cerrar/editar cualquier turno pasado, no solo "el de ahora".
 */
function turnoInfo(fecha, turno) {
  const partes = String(fecha || "").split("-").map(Number);
  const [anio, mes, dia] = partes;
  if (!anio || !mes || !dia || !["manana", "tarde"].includes(turno)) return null;
  // new Date() normaliza fechas de calendario inválidas en vez de rechazarlas (ej. 30 de
  // febrero pasa a ser 2 de marzo); se compara contra lo que realmente se pidió para
  // detectar y rechazar ese caso en vez de calcular el turno de un día distinto sin avisar.
  const chequeo = new Date(anio, mes - 1, dia);
  if (chequeo.getFullYear() !== anio || chequeo.getMonth() !== mes - 1 || chequeo.getDate() !== dia) {
    return null;
  }
  if (turno === "tarde") {
    return {
      inicio: new Date(anio, mes - 1, dia, 8, 0, 0, 0),
      fin: new Date(anio, mes - 1, dia, 20, 0, 0, 0),
    };
  }
  return {
    inicio: new Date(anio, mes - 1, dia - 1, 20, 0, 0, 0),
    fin: new Date(anio, mes - 1, dia, 8, 0, 0, 0),
  };
}

const UNA_HORA_MS = 60 * 60 * 1000;
const QUINCE_MIN_MS = 15 * 60 * 1000;

/**
 * Efectivo (suma de descargas) y descuentos (suma de transacciones) dentro de una ventana
 * horaria. Ambas usan esa misma ventana corrida hacia adelante (no ampliada), por el mismo
 * motivo: un registro hecho justo al filo del cierre del turno (o unos minutos después) debe
 * seguir contando para el turno que se está cerrando, no para el siguiente. Las descargas se
 * corren 1 hora (el bombero suele contarlas recién al cerrar); los descuentos se corren solo
 * 15 minutos (una venta puede demorar un poco en sincronizarse, pero no horas). Como el turno
 * siguiente empieza justo en turno_fin, su ventana corrida arranca exactamente donde termina
 * la de este turno, así que nunca se pisan ni dejan un hueco (salvo el primerísimo turno que
 * se cierre alguna vez para una sucursal, que no tiene un turno anterior que capture ese borde).
 */
async function totalesTurno(executor, sucursalId, inicio, fin) {
  const inicioDescargas = new Date(inicio.getTime() + UNA_HORA_MS);
  const finDescargas = new Date(fin.getTime() + UNA_HORA_MS);
  const inicioDescuentos = new Date(inicio.getTime() + QUINCE_MIN_MS);
  const finDescuentos = new Date(fin.getTime() + QUINCE_MIN_MS);
  const [efectivoRes, descuentosRes] = await Promise.all([
    executor.query(
      "SELECT COALESCE(SUM(monto), 0) AS total FROM descargas WHERE sucursal_id = $1 AND creado_en >= $2 AND creado_en < $3",
      [sucursalId, inicioDescargas, finDescargas]
    ),
    executor.query(
      "SELECT COALESCE(SUM(descuento_total_clp), 0) AS total FROM transacciones WHERE sucursal_id = $1 AND creado_en >= $2 AND creado_en < $3",
      [sucursalId, inicioDescuentos, finDescuentos]
    ),
  ]);
  return {
    efectivo_total: Number(efectivoRes.rows[0].total),
    descuentos_total: Number(descuentosRes.rows[0].total),
  };
}

/**
 * Precio vigente de cada combustible al MOMENTO EN QUE TERMINA el turno (no al inicio) — el
 * mismo que va a usar calcularLecturas() al guardar. Usar turno_fin (no turno_inicio) hace
 * que un precio actualizado a mitad de un turno que sigue vigente hoy se refleje de inmediato
 * en ese cuadre, en vez de quedar pegado al precio de cuando arrancó el turno. Para un turno
 * histórico ya terminado hace tiempo, sigue siendo el precio correcto de esa época. Se manda
 * al frontend para que la vista previa en vivo coincida con lo que realmente se va a calcular.
 */
async function preciosVigentes(executor, sucursalId, fecha) {
  const { rows } = await executor.query(
    `SELECT DISTINCT ON (combustible_id) combustible_id, precio_clp_litro
     FROM precios_combustible
     WHERE sucursal_id = $1 AND vigente_desde <= $2
     ORDER BY combustible_id, vigente_desde DESC`,
    [sucursalId, fecha]
  );
  return rows;
}

/** true si el body trae un descuento manual (no vacío). En esta versión de prueba, el admin
 * puede teclear el total de descuentos en el cuadre igual que la tarjeta, en vez de que se
 * calcule solo desde las transacciones del turno — así se pueden ensayar cierres sin tener
 * que meter descuentos a la base de datos. Si el campo viene vacío/ausente, se usa el
 * auto-calculado de totalesTurno() (comportamiento original). */
function traeDescuentoManual(valor) {
  return valor !== undefined && valor !== null && valor !== "";
}

/** Arma el WHERE compartido por el historial y los reportes de cuadres (mismos filtros en ambos). */
function filtroCuadres(query) {
  const { desde, hasta, sucursal_id, turno } = query;
  const condiciones = [];
  const valores = [];
  if (desde) {
    valores.push(desde);
    condiciones.push(`c.turno_fin >= $${valores.length}`);
  }
  if (hasta) {
    valores.push(hasta);
    condiciones.push(`c.turno_fin < ($${valores.length}::date + interval '1 day')`);
  }
  if (sucursal_id) {
    valores.push(sucursal_id);
    condiciones.push(`c.sucursal_id = $${valores.length}`);
  }
  if (turno) {
    valores.push(turno);
    condiciones.push(`c.turno = $${valores.length}`);
  }
  return { where: condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "", valores };
}

/** Validaciones de forma comunes a crear y editar un cuadre (no negativas, salida>=entrada, etc). */
function validarLecturas(lecturas) {
  if (!Array.isArray(lecturas) || lecturas.length === 0) return "Debe incluir al menos una lectura.";
  const combinacionesVistas = new Set();
  for (const l of lecturas) {
    if (!l || typeof l !== "object") return "Cada lectura necesita máquina y combustible.";
    if (!l.maquina_id || !l.combustible_id) return "Cada lectura necesita máquina y combustible.";
    // Dos lecturas para la misma máquina+combustible contarían los litros doble; el índice
    // único de la base también lo rechaza, pero acá el error queda claro para el usuario.
    const combinacion = `${l.maquina_id}-${l.combustible_id}`;
    if (combinacionesVistas.has(combinacion)) return "Hay dos lecturas para la misma máquina y combustible.";
    combinacionesVistas.add(combinacion);
    if (l.lectura_entrada === undefined || l.lectura_entrada === null || l.lectura_salida === undefined || l.lectura_salida === null) {
      return "Todas las lecturas necesitan entrada y salida.";
    }
    if (!Number.isFinite(Number(l.lectura_entrada)) || !Number.isFinite(Number(l.lectura_salida))) {
      return "Entrada y salida deben ser números.";
    }
    if (Number(l.lectura_entrada) < 0 || Number(l.lectura_salida) < 0) return "Las lecturas no pueden ser negativas.";
    if (Number(l.lectura_salida) < Number(l.lectura_entrada)) return "La lectura de salida no puede ser menor a la entrada.";
  }
  return null;
}

/**
 * Valida que las máquinas pertenezcan a la sucursal y calcula litros/monto de cada lectura
 * (con el precio vigente a `fechaPrecio`, y en una sola consulta batch, no una por lectura).
 * `preciosOverride` (opcional, { combustible_id: precio }) permite que el admin ajuste el
 * precio de un combustible puntualmente PARA ESTE CUADRE, sin tocar el catálogo — el precio
 * real usado queda guardado en cada lectura (ver insertarLecturas) para que quede trazable.
 * No inserta nada — eso lo hace insertarLecturas() una vez que el cuadre ya tiene id.
 */
async function calcularLecturas(client, sucursalId, lecturas, fechaPrecio, preciosOverride = {}) {
  const maquinasValidas = await client.query("SELECT id FROM maquinas WHERE sucursal_id = $1", [sucursalId]);
  const idsValidos = new Set(maquinasValidas.rows.map((m) => m.id));
  if (lecturas.some((l) => !idsValidos.has(Number(l.maquina_id)))) {
    throw Object.assign(new Error("Una de las máquinas no pertenece a esta sucursal. Vuelve a cargar la página."), { status: 400 });
  }

  const combustibleIds = [...new Set(lecturas.map((l) => Number(l.combustible_id)))];
  const preciosRes = await client.query(
    `SELECT DISTINCT ON (combustible_id) combustible_id, precio_clp_litro
     FROM precios_combustible
     WHERE sucursal_id = $1 AND combustible_id = ANY($2::int[]) AND vigente_desde <= $3
     ORDER BY combustible_id, vigente_desde DESC`,
    [sucursalId, combustibleIds, fechaPrecio]
  );
  const indicePrecios = {};
  preciosRes.rows.forEach((p) => { indicePrecios[p.combustible_id] = Number(p.precio_clp_litro); });

  if (preciosOverride && typeof preciosOverride === "object" && !Array.isArray(preciosOverride)) {
    Object.entries(preciosOverride).forEach(([combustibleId, precio]) => {
      const precioNum = Math.round(Number(precio));
      if (Number.isFinite(precioNum) && precioNum >= 0) {
        indicePrecios[Number(combustibleId)] = precioNum;
      }
    });
  }

  let litrosPrecioTotal = 0;
  const lecturasCalculadas = lecturas.map((l) => {
    const precio = indicePrecios[Number(l.combustible_id)];
    if (precio === undefined) {
      throw Object.assign(new Error("Falta precio configurado para un combustible en esta sucursal."), { status: 400 });
    }
    const litros = Math.round((Number(l.lectura_salida) - Number(l.lectura_entrada)) * 10) / 10;
    const monto = Math.round(litros * precio * 100) / 100;
    litrosPrecioTotal += monto;
    return { ...l, litros, monto, precio };
  });

  return { litrosPrecioTotal, lecturasCalculadas };
}

/** Un solo INSERT multi-fila para todas las lecturas de un cuadre (no uno por lectura). */
async function insertarLecturas(client, cuadreId, lecturasCalculadas) {
  const valoresSql = [];
  const parametros = [];
  lecturasCalculadas.forEach((l, i) => {
    const base = i * 8;
    valoresSql.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
    parametros.push(cuadreId, l.maquina_id, l.combustible_id, l.lectura_entrada, l.lectura_salida, l.litros, l.monto, l.precio);
  });
  await client.query(
    `INSERT INTO cuadre_lecturas (cuadre_id, maquina_id, combustible_id, lectura_entrada, lectura_salida, litros, monto_clp, precio_clp_litro)
     VALUES ${valoresSql.join(", ")}`,
    parametros
  );
}

/**
 * Guarda los bomberos que estuvieron en turno en un cuadre (tabla cuadre_bomberos). `bomberos`
 * es un array de ids de usuario (opcional; puede venir vacío). Se validan contra la base: solo
 * se guardan los que realmente son bomberos de ESA sucursal — el frontend ya los filtra, pero
 * se revalida acá para no guardar un usuario que no corresponde. Duplicados se descartan.
 */
async function insertarBomberos(client, cuadreId, sucursalId, bomberos) {
  if (!Array.isArray(bomberos)) return;
  const ids = [...new Set(bomberos.map((b) => Number(b)).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return;
  const validos = await client.query(
    "SELECT id FROM usuarios WHERE id = ANY($1::int[]) AND rol = 'bombero' AND sucursal_id = $2",
    [ids, sucursalId]
  );
  const idsValidos = validos.rows.map((r) => r.id);
  if (idsValidos.length === 0) return;
  const valoresSql = idsValidos.map((_, i) => `($1, $${i + 2})`).join(", ");
  await client.query(`INSERT INTO cuadre_bomberos (cuadre_id, bombero_id) VALUES ${valoresSql}`, [cuadreId, ...idsValidos]);
}

/**
 * Trae el estado de un turno específico (fecha+turno elegidos por el admin en el calendario):
 * - si no existe todavía, arma el formulario de creación (lecturas con entrada precargada del
 *   cuadre anterior más cercano a esta fecha, no necesariamente el último en general).
 * - si ya existe, lo trae completo: editable si es el cuadre más reciente de la sucursal
 *   (nada depende todavía de su salida), solo lectura si no.
 */
router.get("/turno", async (req, res) => {
  const { sucursal_id, fecha, turno } = req.query;
  if (!sucursal_id || !fecha || !turno) {
    return res.status(400).json({ error: "sucursal_id, fecha y turno son obligatorios." });
  }
  const info = turnoInfo(fecha, turno);
  if (!info) return res.status(400).json({ error: "Fecha o turno inválidos." });
  const { inicio, fin } = info;
  // Ya no se bloquea consultar/cerrar un turno que todavía no termina — solo se informa al
  // frontend para que muestre una advertencia (el admin puede necesitar cerrar antes, ej. si
  // el turno se corta por otra razón operativa).
  const turnoNoTerminado = fin.getTime() > Date.now();

  const existente = await db.query(
    `SELECT c.*, u.nombre AS cerrado_por_nombre, u.apellido AS cerrado_por_apellido
     FROM cuadres_caja c JOIN usuarios u ON u.id = c.cerrado_por
     WHERE c.sucursal_id = $1 AND c.turno_inicio = $2`,
    [sucursal_id, inicio]
  );

  if (existente.rows[0]) {
    const cuadre = existente.rows[0];
    const [posteriorRes, lecturasRes, maquinasRes, combustiblesRes, ultimasLecturasRes, bomberosRes, precios] = await Promise.all([
      db.query("SELECT EXISTS(SELECT 1 FROM cuadres_caja WHERE sucursal_id = $1 AND turno_fin > $2) AS hay", [sucursal_id, cuadre.turno_fin]),
      db.query(
        `SELECT l.*, m.nombre AS maquina_nombre, co.nombre AS combustible_nombre
         FROM cuadre_lecturas l
         JOIN maquinas m ON m.id = l.maquina_id
         JOIN combustibles co ON co.id = l.combustible_id
         WHERE l.cuadre_id = $1
         ORDER BY m.nombre, co.nombre`,
        [cuadre.id]
      ),
      db.query("SELECT * FROM maquinas WHERE sucursal_id = $1 AND activa = true ORDER BY nombre", [sucursal_id]),
      db.query("SELECT * FROM combustibles ORDER BY nombre"),
      db.query(
        `SELECT DISTINCT ON (l.maquina_id, l.combustible_id) l.maquina_id, l.combustible_id, l.lectura_salida
         FROM cuadre_lecturas l
         JOIN cuadres_caja c ON c.id = l.cuadre_id
         WHERE c.sucursal_id = $1 AND c.turno_fin <= $2
         ORDER BY l.maquina_id, l.combustible_id, c.turno_fin DESC`,
        [sucursal_id, inicio]
      ),
      db.query("SELECT bombero_id FROM cuadre_bomberos WHERE cuadre_id = $1", [cuadre.id]),
      preciosVigentes(db, sucursal_id, fin),
    ]);
    const editable = !posteriorRes.rows[0].hay;

    let lecturas = lecturasRes.rows;
    if (editable) {
      // Completa con máquinas activas que todavía no tienen una lectura guardada en ESTE
      // cuadre (ej. una máquina que se agregó después de cerrarlo, o que quedó en blanco
      // porque no tuvo movimiento ese turno) — si no, sería imposible agregarle una lectura
      // al editar: el formulario solo mostraba las filas que ya existían en cuadre_lecturas.
      const indiceEntrada = {};
      ultimasLecturasRes.rows.forEach((r) => { indiceEntrada[`${r.maquina_id}-${r.combustible_id}`] = r.lectura_salida; });
      const yaGuardadas = new Set(lecturas.map((l) => `${l.maquina_id}-${l.combustible_id}`));
      const faltantes = [];
      maquinasRes.rows.forEach((m) => {
        combustiblesRes.rows.forEach((c) => {
          const clave = `${m.id}-${c.id}`;
          if (!yaGuardadas.has(clave)) {
            faltantes.push({
              maquina_id: m.id,
              maquina_nombre: m.nombre,
              combustible_id: c.id,
              combustible_nombre: c.nombre,
              lectura_entrada: indiceEntrada[clave] ?? null,
              lectura_salida: null,
            });
          }
        });
      });
      lecturas = [...lecturas, ...faltantes].sort((a, b) =>
        a.maquina_nombre.localeCompare(b.maquina_nombre) || a.combustible_nombre.localeCompare(b.combustible_nombre)
      );
    }

    return res.json({
      existe: true,
      editable,
      turno,
      turno_inicio: inicio,
      turno_fin: fin,
      turno_no_terminado: turnoNoTerminado,
      efectivo_total: Number(cuadre.efectivo_total),
      descuentos_total: Number(cuadre.descuentos_total),
      precios,
      cuadre,
      lecturas,
      bomberos: bomberosRes.rows.map((r) => r.bombero_id),
    });
  }

  const [maquinasRes, combustiblesRes, ultimasLecturasRes, totales, precios] = await Promise.all([
    db.query("SELECT * FROM maquinas WHERE sucursal_id = $1 AND activa = true ORDER BY nombre", [sucursal_id]),
    db.query("SELECT * FROM combustibles ORDER BY nombre"),
    db.query(
      `SELECT DISTINCT ON (l.maquina_id, l.combustible_id) l.maquina_id, l.combustible_id, l.lectura_salida
       FROM cuadre_lecturas l
       JOIN cuadres_caja c ON c.id = l.cuadre_id
       WHERE c.sucursal_id = $1 AND c.turno_fin <= $2
       ORDER BY l.maquina_id, l.combustible_id, c.turno_fin DESC`,
      [sucursal_id, inicio]
    ),
    totalesTurno(db, sucursal_id, inicio, fin),
    preciosVigentes(db, sucursal_id, fin),
  ]);

  const indiceLecturas = {};
  ultimasLecturasRes.rows.forEach((r) => { indiceLecturas[`${r.maquina_id}-${r.combustible_id}`] = r.lectura_salida; });

  const lecturas = [];
  maquinasRes.rows.forEach((m) => {
    combustiblesRes.rows.forEach((c) => {
      lecturas.push({
        maquina_id: m.id,
        maquina_nombre: m.nombre,
        combustible_id: c.id,
        combustible_nombre: c.nombre,
        lectura_entrada: indiceLecturas[`${m.id}-${c.id}`] ?? null,
      });
    });
  });

  res.json({ existe: false, turno, turno_inicio: inicio, turno_fin: fin, turno_no_terminado: turnoNoTerminado, lecturas, precios, ...totales });
});

/** Cierra un turno nuevo (fecha+turno elegidos, no tiene que ser "el de ahora"). */
router.post("/", async (req, res) => {
  const { sucursal_id, fecha, turno, tarjeta_total, descuentos_total, lecturas, precios_override, bomberos } = req.body || {};

  // Number.isFinite y no solo "< 0": rechaza también NaN (ej. tarjeta_total "abc", donde
  // NaN < 0 es false) e Infinity, que Postgres aceptaría guardar en NUMERIC y envenenarían
  // las sumas de todos los reportes de cuadres.
  if (!sucursal_id || !fecha || !turno || !Number.isFinite(Number(tarjeta_total)) || Number(tarjeta_total) < 0) {
    return res.status(400).json({ error: "Sucursal, fecha, turno y tarjeta_total (0 o mayor) son obligatorios." });
  }
  // Descuento manual (opcional): misma validación que tarjeta_total. Si no viene, se calcula solo.
  if (traeDescuentoManual(descuentos_total) && (!Number.isFinite(Number(descuentos_total)) || Number(descuentos_total) < 0)) {
    return res.status(400).json({ error: "descuentos_total debe ser un número (0 o mayor)." });
  }
  const info = turnoInfo(fecha, turno);
  if (!info) return res.status(400).json({ error: "Fecha o turno inválidos." });
  const { inicio: turnoInicio, fin: turnoFin } = info;
  // Cerrar antes de que el turno termine ya no está prohibido — el frontend advierte al
  // admin antes de confirmar, pero el servidor no lo bloquea.

  const errorLecturas = validarLecturas(lecturas);
  if (errorLecturas) return res.status(400).json({ error: errorLecturas });

  let client;
  try {
    client = await db.pool.connect();
    await client.query("BEGIN");

    const { litrosPrecioTotal, lecturasCalculadas } = await calcularLecturas(client, sucursal_id, lecturas, turnoFin, precios_override);
    const totales = await totalesTurno(client, sucursal_id, turnoInicio, turnoFin);
    const efectivoTotal = totales.efectivo_total;
    // Descuentos: el manual del body si vino, o el auto-calculado desde las transacciones.
    const descuentosTotal = traeDescuentoManual(descuentos_total) ? Number(descuentos_total) : totales.descuentos_total;
    const tarjetaTotal = Number(tarjeta_total);
    const diferencia = Math.round((litrosPrecioTotal - (efectivoTotal + tarjetaTotal + descuentosTotal)) * 100) / 100;

    const cuadreRes = await client.query(
      `INSERT INTO cuadres_caja
         (sucursal_id, turno, turno_inicio, turno_fin, tarjeta_total, efectivo_total, descuentos_total, diferencia, cerrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [sucursal_id, turno, turnoInicio, turnoFin, tarjetaTotal, efectivoTotal, descuentosTotal, diferencia, req.usuario.id]
    );
    const cuadre = cuadreRes.rows[0];
    await insertarLecturas(client, cuadre.id, lecturasCalculadas);
    await insertarBomberos(client, cuadre.id, sucursal_id, bomberos);

    await client.query("COMMIT");
    res.status(201).json({ ...cuadre, litros_precio_total: litrosPrecioTotal });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe un cuadre para ese turno." });
    }
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Error al cerrar el turno." });
  } finally {
    if (client) client.release();
  }
});

/**
 * Edita un cuadre existente — solo permitido si es el cuadre más reciente de su sucursal
 * (ningún turno posterior depende todavía de su lectura de salida). Recalcula todo con los
 * valores nuevos y deja registrado quién editó y cuándo (pisando el cerrado_por original).
 */
router.put("/:id", async (req, res) => {
  const { tarjeta_total, descuentos_total, lecturas, precios_override, bomberos } = req.body || {};
  // Mismo Number.isFinite que en POST /: rechaza NaN/Infinity, no solo negativos.
  if (!Number.isFinite(Number(tarjeta_total)) || Number(tarjeta_total) < 0) {
    return res.status(400).json({ error: "tarjeta_total (0 o mayor) es obligatorio." });
  }
  if (traeDescuentoManual(descuentos_total) && (!Number.isFinite(Number(descuentos_total)) || Number(descuentos_total) < 0)) {
    return res.status(400).json({ error: "descuentos_total debe ser un número (0 o mayor)." });
  }
  const errorLecturas = validarLecturas(lecturas);
  if (errorLecturas) return res.status(400).json({ error: errorLecturas });

  let client;
  try {
    const cuadreActualRes = await db.query("SELECT * FROM cuadres_caja WHERE id = $1", [req.params.id]);
    const cuadreActual = cuadreActualRes.rows[0];
    if (!cuadreActual) return res.status(404).json({ error: "Cuadre no encontrado." });

    client = await db.pool.connect();
    await client.query("BEGIN");

    // Se revalida "es el más reciente" recién acá, dentro de la transacción y justo antes de
    // tocar nada — si se hiciera antes de conectar, alguien podría cerrar el turno siguiente
    // en la ventana entre esa revisión y este UPDATE, dejando la cadena entrada/salida
    // desincronizada entre ambos cuadres.
    const posteriorRes = await client.query(
      "SELECT EXISTS(SELECT 1 FROM cuadres_caja WHERE sucursal_id = $1 AND turno_fin > $2) AS hay",
      [cuadreActual.sucursal_id, cuadreActual.turno_fin]
    );
    if (posteriorRes.rows[0].hay) {
      throw Object.assign(
        new Error("No se puede editar: ya existe un turno posterior que depende de este cuadre. Solo se puede editar el cuadre más reciente de la sucursal."),
        { status: 409 }
      );
    }

    const { litrosPrecioTotal, lecturasCalculadas } = await calcularLecturas(client, cuadreActual.sucursal_id, lecturas, cuadreActual.turno_fin, precios_override);
    const totales = await totalesTurno(client, cuadreActual.sucursal_id, cuadreActual.turno_inicio, cuadreActual.turno_fin);
    const efectivoTotal = totales.efectivo_total;
    const descuentosTotal = traeDescuentoManual(descuentos_total) ? Number(descuentos_total) : totales.descuentos_total;
    const tarjetaTotal = Number(tarjeta_total);
    const diferencia = Math.round((litrosPrecioTotal - (efectivoTotal + tarjetaTotal + descuentosTotal)) * 100) / 100;

    const cuadreRes = await client.query(
      `UPDATE cuadres_caja
       SET tarjeta_total = $1, efectivo_total = $2, descuentos_total = $3, diferencia = $4,
           cerrado_por = $5, editado_en = now()
       WHERE id = $6 RETURNING *`,
      [tarjetaTotal, efectivoTotal, descuentosTotal, diferencia, req.usuario.id, cuadreActual.id]
    );

    await client.query("DELETE FROM cuadre_lecturas WHERE cuadre_id = $1", [cuadreActual.id]);
    await insertarLecturas(client, cuadreActual.id, lecturasCalculadas);
    await client.query("DELETE FROM cuadre_bomberos WHERE cuadre_id = $1", [cuadreActual.id]);
    await insertarBomberos(client, cuadreActual.id, cuadreActual.sucursal_id, bomberos);

    await client.query("COMMIT");
    res.json({ ...cuadreRes.rows[0], litros_precio_total: litrosPrecioTotal });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    if (err.status === 400 || err.status === 409) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Error al editar el cuadre." });
  } finally {
    if (client) client.release();
  }
});

/** Historial de cuadres con filtros. */
router.get("/", async (req, res) => {
  const { where, valores } = filtroCuadres(req.query);

  const { rows } = await db.query(
    `SELECT c.*, s.nombre AS sucursal_nombre, u.nombre AS cerrado_por_nombre, u.apellido AS cerrado_por_apellido,
            COALESCE(SUM(l.litros), 0) AS litros_totales,
            COALESCE(SUM(l.monto_clp), 0) AS litros_precio_total,
            (SELECT COALESCE(json_agg(json_build_object('nombre', bu.nombre, 'apellido', bu.apellido) ORDER BY bu.nombre), '[]'::json)
             FROM cuadre_bomberos cb JOIN usuarios bu ON bu.id = cb.bombero_id
             WHERE cb.cuadre_id = c.id) AS bomberos_turno
     FROM cuadres_caja c
     JOIN sucursales s ON s.id = c.sucursal_id
     JOIN usuarios u ON u.id = c.cerrado_por
     LEFT JOIN cuadre_lecturas l ON l.cuadre_id = c.id
     ${where}
     GROUP BY c.id, s.nombre, u.nombre, u.apellido
     ORDER BY c.turno_fin DESC`,
    valores
  );
  res.json(rows);
});

/** Reportes agregados de cuadres: diferencia neta/absoluta y desglose por sucursal+combustible. */
router.get("/reportes", async (req, res) => {
  const { where, valores } = filtroCuadres(req.query);

  const [totalesRes, litrosRes, desgloseRes] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS turnos_cerrados,
              COALESCE(SUM(diferencia), 0) AS diferencia_neta,
              COALESCE(SUM(ABS(diferencia)), 0) AS diferencia_absoluta,
              COALESCE(SUM(tarjeta_total), 0) AS tarjeta_total,
              COALESCE(SUM(efectivo_total), 0) AS efectivo_total,
              COALESCE(SUM(descuentos_total), 0) AS descuentos_total
       FROM cuadres_caja c ${where}`,
      valores
    ),
    db.query(
      `SELECT COALESCE(SUM(l.litros), 0) AS litros_totales, COALESCE(SUM(l.monto_clp), 0) AS litros_precio_total
       FROM cuadre_lecturas l JOIN cuadres_caja c ON c.id = l.cuadre_id ${where}`,
      valores
    ),
    db.query(
      `SELECT s.nombre AS sucursal, co.nombre AS combustible,
              SUM(l.litros) AS litros, SUM(l.monto_clp) AS monto_total
       FROM cuadre_lecturas l
       JOIN cuadres_caja c ON c.id = l.cuadre_id
       JOIN sucursales s ON s.id = c.sucursal_id
       JOIN combustibles co ON co.id = l.combustible_id
       ${where}
       GROUP BY s.nombre, co.nombre
       ORDER BY s.nombre, co.nombre`,
      valores
    ),
  ]);

  const desglose = desgloseRes.rows.map((r) => ({
    ...r,
    precio_promedio: Number(r.litros) > 0 ? Math.round((Number(r.monto_total) / Number(r.litros)) * 100) / 100 : 0,
  }));

  res.json({
    ...totalesRes.rows[0],
    litros_totales: litrosRes.rows[0].litros_totales,
    litros_precio_total: litrosRes.rows[0].litros_precio_total,
    desglose,
  });
});

/**
 * Detalle de un cuadre puntual (para el modal de "Ver detalle" en Historial): sus lecturas
 * con el precio real que se usó en cada una, trazable aunque el catálogo haya cambiado
 * después. Va al final del archivo porque "/:id" debe registrarse después de las rutas
 * literales (/turno, /reportes) — si no, Express las confundiría con un id.
 */
router.get("/:id", async (req, res) => {
  try {
    const cuadreRes = await db.query(
      `SELECT c.*, s.nombre AS sucursal_nombre, u.nombre AS cerrado_por_nombre, u.apellido AS cerrado_por_apellido
       FROM cuadres_caja c
       JOIN sucursales s ON s.id = c.sucursal_id
       JOIN usuarios u ON u.id = c.cerrado_por
       WHERE c.id = $1`,
      [req.params.id]
    );
    const cuadre = cuadreRes.rows[0];
    if (!cuadre) return res.status(404).json({ error: "Cuadre no encontrado." });

    const [lecturasRes, bomberosRes] = await Promise.all([
      db.query(
        `SELECT l.*, m.nombre AS maquina_nombre, co.nombre AS combustible_nombre
         FROM cuadre_lecturas l
         JOIN maquinas m ON m.id = l.maquina_id
         JOIN combustibles co ON co.id = l.combustible_id
         WHERE l.cuadre_id = $1
         ORDER BY m.nombre, co.nombre`,
        [cuadre.id]
      ),
      db.query(
        `SELECT bu.nombre, bu.apellido
         FROM cuadre_bomberos cb JOIN usuarios bu ON bu.id = cb.bombero_id
         WHERE cb.cuadre_id = $1 ORDER BY bu.nombre`,
        [cuadre.id]
      ),
    ]);
    res.json({ cuadre, lecturas: lecturasRes.rows, bomberos: bomberosRes.rows });
  } catch (err) {
    if (err.code === "22P02") {
      return res.status(400).json({ error: "Id de cuadre inválido." });
    }
    console.error(err);
    res.status(500).json({ error: "Error al obtener el cuadre." });
  }
});

module.exports = router;
