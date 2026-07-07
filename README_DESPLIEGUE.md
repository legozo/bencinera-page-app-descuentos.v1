# Guía de despliegue — VPS Contabo

Pasos para levantar la app de descuentos en tu VPS de Contabo, usando tu dominio propio.
Todo corre con Docker, así que no necesitas instalar Node ni Postgres a mano en el servidor.

## 0. Antes de empezar

- Ten a mano: la IP de tu VPS, acceso SSH (usuario/clave o llave), y el dominio (o subdominio)
  que vas a usar, por ejemplo `descuentos.tuempresa.cl`.
- Este proyecto asume Ubuntu 22.04/24.04 o Debian. Si tu VPS usa otro sistema, los pasos de
  instalación de Docker cambian un poco (mira la doc oficial de Docker para tu distro).

## 1. Apuntar el dominio a la VPS

En el proveedor donde compraste el dominio, crea un registro **A** apuntando al dominio
(o subdominio) hacia la IP pública de tu VPS de Contabo. Ejemplo:

```
Tipo: A
Nombre: descuentos
Valor: <IP de tu VPS>
TTL: 300 (o el que venga por defecto)
```

Espera unos minutos a que propague (puedes verificar con `ping descuentos.tuempresa.cl` desde
tu computador). Caddy (el servidor web que vamos a usar) necesita que esto ya esté resuelto
antes de levantar los contenedores, porque genera el certificado HTTPS automáticamente.

## 2. Conectarte por SSH e instalar Docker

```bash
ssh root@<IP-de-tu-VPS>

# Instalar Docker y Docker Compose (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin

# Verificar
docker --version
docker compose version
```

## 3. Subir el proyecto al servidor

Desde tu computador (no desde la VPS), comprime la carpeta `gasolinera-app` y súbela con `scp`:

```bash
scp -r gasolinera-app root@<IP-de-tu-VPS>:/opt/gasolinera-app
```

(Si prefieres usar git en vez de scp, también funciona — solo necesitas que la carpeta
`gasolinera-app` completa termine en `/opt/gasolinera-app` en la VPS.)

## 4. Configurar variables de entorno

Ya en la VPS:

```bash
cd /opt/gasolinera-app
cp .env.example .env
nano .env
```

Completa:
- `DOMINIO`: el mismo dominio que apuntaste en el paso 1.
- `DB_PASSWORD`, `JWT_SECRET`, `ADMIN_PASSWORD`: usa claves largas y únicas (por ejemplo,
  genera cada una con `openssl rand -hex 24`).

## 5. Levantar la app

```bash
docker compose up -d --build
```

La primera vez, Caddy va a intentar generar un certificado HTTPS automático con Let's Encrypt
para tu dominio — por eso es importante que el DNS ya esté apuntando correctamente (paso 1).

Revisa que todo esté corriendo:

```bash
docker compose ps
docker compose logs -f app
```

En los logs del servicio `app` deberías ver el mensaje con el usuario admin creado
(usuario y clave que definiste en `.env` como `ADMIN_USER`/`ADMIN_PASSWORD`).

## 6. Probar

Abre `https://tu-dominio` en el navegador. Deberías ver la pantalla de login.
Entra con el usuario admin y ve a la pestaña "Bomberos" para crear las cuentas del personal
de cada sucursal, y a "Socios" para cargar (o importar manualmente) la base de socios.

## Mantenimiento básico

- **Ver logs**: `docker compose logs -f app` (o `db`, o `caddy`)
- **Reiniciar todo**: `docker compose restart`
- **Actualizar la app** (después de subir cambios de código): `docker compose up -d --build`
- **Respaldar la base de datos**:
  ```bash
  docker compose exec db pg_dump -U gasolinera gasolinera > respaldo_$(date +%F).sql
  ```
- **Restaurar un respaldo**:
  ```bash
  cat respaldo.sql | docker compose exec -T db psql -U gasolinera gasolinera
  ```

## Sobre la futura integración con OpenClaw

Cuando llegues a esa etapa, el Gateway de OpenClaw puede correr en esta misma VPS
(otro contenedor o proceso Node más) y llamar a esta API directamente por `localhost:3000`
o por el dominio público, usando un usuario con rol `admin` para autenticarse. No hace falta
tocar nada de lo que construimos ahora — la API ya está separada de la interfaz web.
