require("dotenv").config();
const path = require("path");
const express = require("express");
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
