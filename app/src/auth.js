const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "cambia-este-secreto";

function generarToken(usuario) {
  return jwt.sign(
    {
      id: usuario.id,
      usuario: usuario.usuario,
      rol: usuario.rol,
      sucursal_id: usuario.sucursal_id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
    },
    SECRET,
    { expiresIn: "12h" }
  );
}

function requiereAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No autenticado." });
  try {
    req.usuario = jwt.verify(token, SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado." });
  }
}

function requiereRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: "No tienes permiso para esta acción." });
    }
    next();
  };
}

module.exports = { generarToken, requiereAuth, requiereRol, SECRET };
