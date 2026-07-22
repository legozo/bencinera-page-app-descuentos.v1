const jwt = require("jsonwebtoken");
const db = require("./db");

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

async function requiereAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No autenticado." });
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado." });
  }
  // El token dura 12h, pero desactivar (o eliminar) un usuario tiene que cortarle el acceso
  // de inmediato, no cuando el token expire — por eso se reconsulta su estado en cada
  // petición en vez de confiar solo en la firma.
  const { rows } = await db.query("SELECT activo, rol, sucursal_id FROM usuarios WHERE id = $1", [payload.id]);
  if (!rows[0] || !rows[0].activo) {
    return res.status(401).json({ error: "Tu cuenta fue desactivada. Habla con el administrador." });
  }
  // Rol y sucursal se toman frescos de la base, no del token: si a un bombero lo cambian de
  // sucursal a mitad de turno, sus ventas deben quedar en la sucursal nueva de inmediato —
  // con el valor del token quedaban en la antigua (y con sus precios) hasta por 12h.
  req.usuario = { ...payload, rol: rows[0].rol, sucursal_id: rows[0].sucursal_id };
  next();
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
