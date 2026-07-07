const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { generarToken } = require("../auth");

const router = express.Router();

router.post("/login", async (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) {
    return res.status(400).json({ error: "Usuario y clave son obligatorios." });
  }

  const { rows } = await db.query(
    "SELECT * FROM usuarios WHERE usuario = $1 AND activo = true",
    [usuario]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "Usuario o clave incorrectos." });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Usuario o clave incorrectos." });

  const token = generarToken(user);
  res.json({
    token,
    usuario: {
      id: user.id,
      nombre: user.nombre,
      apellido: user.apellido,
      usuario: user.usuario,
      rol: user.rol,
      sucursal_id: user.sucursal_id,
    },
  });
});

module.exports = router;
