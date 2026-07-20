/** Helper mínimo para llamar a la API y manejar el token guardado en memoria/localStorage. */
const Api = {
  base: "/api",

  guardarSesion(token, usuario) {
    localStorage.setItem("token", token);
    localStorage.setItem("usuario", JSON.stringify(usuario));
  },
  token() {
    return localStorage.getItem("token");
  },
  usuario() {
    const raw = localStorage.getItem("usuario");
    return raw ? JSON.parse(raw) : null;
  },
  cerrarSesion() {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    window.location.href = "/index.html";
  },

  async llamar(metodo, ruta, body) {
    let res;
    try {
      res = await fetch(this.base + ruta, {
        method: metodo,
        headers: {
          "Content-Type": "application/json",
          ...(this.token() ? { Authorization: "Bearer " + this.token() } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      // fetch solo lanza esto cuando no hay red o el servidor es inalcanzable, no cuando el
      // servidor respondió con un error 4xx/5xx (eso se maneja más abajo).
      const errorDeRed = new Error("Sin conexión con el servidor.");
      errorDeRed.esErrorDeRed = true;
      throw errorDeRed;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Solo forzamos el cierre de sesión (y la redirección a /index.html) si el 401 vino de
      // una petición que SÍ llevaba un token (sesión expirada/inválida). Si no había token
      // (ej. un intento de login con clave incorrecta), no hay sesión que cerrar — y forzar el
      // redirect aquí pisaba el mensaje de error con una recarga de la misma página de login.
      if (res.status === 401 && this.token()) {
        this.cerrarSesion();
      }
      throw new Error(data.error || "Error inesperado.");
    }
    return data;
  },

  get(ruta) { return this.llamar("GET", ruta); },
  post(ruta, body) { return this.llamar("POST", ruta, body); },
  put(ruta, body) { return this.llamar("PUT", ruta, body); },
  delete(ruta) { return this.llamar("DELETE", ruta); },
};

/**
 * Escapa un texto para poder insertarlo dentro de HTML armado con template strings, tanto en
 * el contenido como dentro de atributos con comillas. Aplicar SIEMPRE a cualquier dato de
 * texto libre que venga de la base (nombres, apellidos, direcciones, descripciones, nombres
 * de sucursal/máquina/combustible/tipo de socio): si no, un valor guardado con caracteres
 * especiales de HTML se ejecutaría como código en el navegador de quien lo vea (XSS).
 */
function escaparHtml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Redirige al login si no hay sesión activa. Llamar al inicio de cada página protegida. */
function requerirSesion(rolRequerido) {
  const usuario = Api.usuario();
  if (!Api.token() || !usuario) {
    window.location.href = "/index.html";
    return null;
  }
  if (rolRequerido && usuario.rol !== rolRequerido) {
    window.location.href = usuario.rol === "admin" ? "/admin.html" : "/bombero.html";
    return null;
  }
  return usuario;
}
