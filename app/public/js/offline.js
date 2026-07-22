/**
 * Soporte para trabajar sin conexión en la pantalla del bombero.
 *
 * Idea general:
 * - Mientras hay internet, se descarga y guarda en el navegador (localStorage) un "bundle"
 *   con los socios activos, las reglas de descuento vigentes y los precios vigentes de la
 *   sucursal. Se refresca solo, cada cierto tiempo y apenas vuelve la conexión.
 * - Si falla la consulta de RUT por falta de red, se busca en ese bundle local.
 * - Si falla el registro de una venta por falta de red, se guarda en una "cola de pendientes"
 *   en el navegador (con la hora real de la venta y un id único), y se sigue atendiendo.
 * - Apenas vuelve la conexión, la cola se sincroniza sola contra /api/transacciones/sync.
 *   El servidor reconstruye el precio y el descuento que aplicaban EN ESE MOMENTO (no el
 *   actual), así que el monto final es igual de confiable que si hubiera tenido conexión.
 */

const Offline = {
  KEY_BUNDLE: "bencinera_bundle",
  KEY_COLA: "bencinera_cola_pendiente",
  KEY_ERRORES: "bencinera_errores_sync",

  // ---------- Bundle (socios, reglas, precios) ----------
  guardarBundle(bundle) {
    localStorage.setItem(this.KEY_BUNDLE, JSON.stringify(bundle));
  },
  obtenerBundle() {
    const raw = localStorage.getItem(this.KEY_BUNDLE);
    return raw ? JSON.parse(raw) : null;
  },

  async refrescarBundle() {
    try {
      const bundle = await Api.get("/offline/bundle");
      this.guardarBundle(bundle);
      return true;
    } catch (err) {
      return false; // sin conexión (o error de servidor): se sigue usando el cache que había
    }
  },

  /** Busca un RUT en el bundle guardado localmente, con la misma forma de respuesta que el
   *  endpoint en línea /socios/buscar/:rut, para que el resto del código no tenga que saber
   *  si el dato vino de la red o del cache. */
  buscarSocioLocal(rutTexto) {
    const bundle = this.obtenerBundle();
    const { valido, cuerpo, dv } = validarRutCliente(rutTexto);
    if (!valido) return { error: "RUT inválido (dígito verificador no coincide)." };
    if (!bundle) return { error: "No hay datos guardados localmente todavía (nunca hubo conexión en este dispositivo)." };

    // El filtro !s.es_interno es una segunda capa por si el dispositivo tiene guardado un
    // bundle descargado antes de que el servidor empezara a excluir el socio interno de
    // traspasos de combustible del bundle (GET /offline/bundle).
    const socio = bundle.socios.find((s) => s.rut === cuerpo && !s.es_interno);
    if (!socio) return { es_socio: false, rut: cuerpo, dv, modo_offline: true };

    const tipoSocio = bundle.tipos_socio.find((t) => t.id === socio.tipo_socio_id);
    const reglas = bundle.reglas_descuento
      .filter((r) => r.tipo_socio_id === socio.tipo_socio_id)
      .map((r) => {
        const combustible = bundle.combustibles.find((c) => c.id === r.combustible_id);
        const precio = bundle.precios.find((p) => p.combustible_id === r.combustible_id);
        return {
          combustible_id: r.combustible_id,
          combustible: combustible ? combustible.nombre : "?",
          descuento_clp_litro: r.descuento_clp_litro,
          precio_clp_litro: precio ? precio.precio_clp_litro : null,
        };
      });

    return {
      es_socio: true,
      modo_offline: true,
      socio: {
        id: socio.id,
        rut: socio.rut,
        dv: socio.dv,
        nombre: socio.nombre,
        apellido: socio.apellido,
        tipo_socio_id: socio.tipo_socio_id,
        tipo_socio_nombre: tipoSocio ? tipoSocio.nombre : "?",
      },
      reglas_descuento: reglas,
    };
  },

  // ---------- Cola de pendientes ----------
  obtenerCola() {
    const raw = localStorage.getItem(this.KEY_COLA);
    return raw ? JSON.parse(raw) : [];
  },
  guardarCola(cola) {
    localStorage.setItem(this.KEY_COLA, JSON.stringify(cola));
  },
  agregarPendiente({ rut, combustible_id, litros }) {
    const cola = this.obtenerCola();
    const item = {
      id_local: (crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      rut,
      combustible_id,
      litros,
      timestamp_local: new Date().toISOString(),
    };
    cola.push(item);
    this.guardarCola(cola);
    return item;
  },
  contarPendientes() {
    return this.obtenerCola().length;
  },

  // ---------- Errores de sincronización (para mostrarle al bombero) ----------
  obtenerErrores() {
    const raw = localStorage.getItem(this.KEY_ERRORES);
    return raw ? JSON.parse(raw) : [];
  },
  agregarError(item, mensaje) {
    const errores = this.obtenerErrores();
    errores.push({ ...item, error: mensaje });
    localStorage.setItem(this.KEY_ERRORES, JSON.stringify(errores));
  },
  limpiarErrores() {
    localStorage.removeItem(this.KEY_ERRORES);
  },

  // ---------- Sincronización ----------
  sincronizando: false,

  async sincronizarPendientes() {
    if (this.sincronizando) return;
    const cola = this.obtenerCola();
    if (cola.length === 0) return;
    if (!navigator.onLine) return;

    this.sincronizando = true;
    try {
      // En lotes: el servidor rechaza más de 500 items por petición (400), y ese error no es
      // de red — mandar la cola entera de una vez dejaba una cola muy grande reintentando
      // para siempre sin sincronizar nada. El avance se persiste lote a lote, así un corte
      // de red a mitad de camino conserva lo ya sincronizado.
      const LOTE_MAX = 500;
      for (let i = 0; i < cola.length; i += LOTE_MAX) {
        const lote = cola.slice(i, i + LOTE_MAX);
        const respuesta = await Api.post("/transacciones/sync", { items: lote });
        const resultados = respuesta.resultados || [];
        const idsAResolver = new Set();
        for (const r of resultados) {
          if (r.ok) {
            idsAResolver.add(r.id_local);
          } else {
            // Error real (no de red, porque ya estamos en línea para haber llegado hasta acá):
            // se saca de la cola activa para no reintentarlo por siempre, y se guarda para avisarle al bombero.
            idsAResolver.add(r.id_local);
            const original = lote.find((c) => c.id_local === r.id_local);
            this.agregarError(original || { id_local: r.id_local }, r.error || "Error desconocido.");
          }
        }
        // Se relee la cola desde localStorage (no el snapshot `cola`): una venta agregada
        // mientras se sincronizaba no debe perderse al guardar la cola filtrada.
        this.guardarCola(this.obtenerCola().filter((c) => !idsAResolver.has(c.id_local)));
      }
    } catch (err) {
      // Error de red al intentar sincronizar: se deja la cola intacta para reintentar después.
    } finally {
      this.sincronizando = false;
    }
  },
};
