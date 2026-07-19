require("dotenv").config();
const path = require("path");
const express = require("express");
// Hace que las rutas async que rechazan (throw dentro de un async handler) se reenvíen
// solas al middleware de errores de abajo, en vez de crashear el proceso completo — sin
// esto, Express 4 no captura promesas rechazadas en rutas async automáticamente.
require("express-async-errors");
const cors = require("cors");
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
app.use(cors());
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
