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
