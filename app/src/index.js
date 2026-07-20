require("dotenv").config();
const path = require("path");
const express = require("express");
// Hace que las rutas async que rechazan (throw dentro de un async handler) se reenvíen
// solas al middleware de errores de abajo, en vez de crashear el proceso completo — sin
// esto, Express 4 no captura promesas rechazadas en rutas async automáticamente.
require("express-async-errors");
const cors = require("cors");
const helmet = require("helmet");
const bootstrap = require("./bootstrap");

const authRoutes = require("./routes/auth");
const sociosRoutes = require("./routes/socios");
const transaccionesRoutes = require("./routes/transacciones");
const usuariosRoutes = require("./routes/usuarios");
const catalogosRoutes = require("./routes/catalogos");
const reportesRoutes = require("./routes/reportes");
const offlineRoutes = require("./routes/offline");
const descargasRoutes = require("./routes/descargas");
const cuadresRoutes = require("./routes/cuadres");

const app = express();

// Headers de seguridad (helmet). Se usan los de bajo riesgo que NO rompen nada de esta app:
// HSTS (fuerza HTTPS), X-Content-Type-Options (nosniff), X-Frame-Options, Referrer-Policy, y
// oculta X-Powered-By. El CSP se configura a propósito de forma PARCIAL: solo directivas
// defensivas que la app no usa (no permite incrustarla en un iframe, ni <object>/plugins, ni
// inyectar un <base>). No se activa el CSP completo de helmet porque bloquearía el `onclick`
// y el `style` inline que el frontend usa en todas partes (rompería todos los botones); un
// CSP completo requeriría sacar ese HTML inline primero (ver memoria de pendientes). Al vivir
// acá (en la app Node, no en el Caddy compartido), estos headers viajan con la app si se
// migra a otro VPS, sin reconfigurar nada.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        // default-src se desactiva a propósito: sin él, no se restringe de dónde vienen los
        // scripts/estilos, así el `onclick`/`style` inline del frontend sigue funcionando.
        // Solo se aplican las 3 directivas defensivas de abajo (que la app no usa igual).
        "default-src": helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
        "frame-ancestors": ["'none'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
      },
    },
  })
);

// CORS: restringido al dominio de producción cuando está configurado (DOMINIO en .env). Sin
// esa variable (ej. entornos de demo/desarrollo que no la definen) queda abierto, igual que
// antes. Esto no afecta las llamadas normales del propio sitio — son del mismo origen, y el
// navegador ni siquiera aplica CORS ahí — solo bloquea que OTRA página, desde el navegador de
// un usuario, llame a esta API en su nombre.
const dominioProduccion = process.env.DOMINIO;
const origenesPermitidos = dominioProduccion ? [`https://${dominioProduccion}`, `http://${dominioProduccion}`] : undefined;
app.use(cors(origenesPermitidos ? { origin: origenesPermitidos } : {}));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/socios", sociosRoutes);
app.use("/api/transacciones", transaccionesRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/catalogos", catalogosRoutes);
app.use("/api/reportes", reportesRoutes);
app.use("/api/offline", offlineRoutes);
app.use("/api/descargas", descargasRoutes);
app.use("/api/cuadres", cuadresRoutes);

app.get("/api/salud", (req, res) => res.json({ ok: true }));

// Frontend estático (login, pantalla bombero, panel admin)
app.use(express.static(path.join(__dirname, "..", "public")));

// Manejador de errores global: red de seguridad para cualquier error no capturado por un
// try/catch propio de la ruta (incluye los reenviados por express-async-errors). Debe ir
// después de todas las rutas y llevar 4 parámetros para que Express lo reconozca como
// manejador de errores.
app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.code === "22P02") {
    return res.status(400).json({ error: "Id inválido." });
  }
  if (err && err.code === "23503") {
    return res.status(400).json({ error: "La operación hace referencia a un registro que no existe." });
  }
  res.status(500).json({ error: "Error interno del servidor." });
});

const PUERTO = process.env.PORT || 3000;

bootstrap
  .iniciar()
  .then(() => {
    app.listen(PUERTO, () => console.log(`Servidor escuchando en puerto ${PUERTO}`));
  })
  .catch((err) => {
    console.error("Error al inicializar la base de datos:", err);
    process.exit(1);
  });
