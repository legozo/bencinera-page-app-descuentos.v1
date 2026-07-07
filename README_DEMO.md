# Modo prueba — VPS prestada, con otro docker-compose ya corriendo

Esta guía es para cuando el VPS no es tuyo, ya tiene otros contenedores corriendo, y solo
quieres mostrarle una prueba a la dueña (sin dominio ni HTTPS todavía).

## 1. Revisa qué está ocupado antes de tocar nada

```bash
docker ps
docker compose ls
```

Fíjate especialmente si el puerto **8080** (o el 80/443) ya está en uso. Si `docker ps`
muestra algo como `0.0.0.0:8080->...`, ese puerto está ocupado y debes elegir otro.

## 2. Subir el proyecto

```bash
scp -r gasolinera-app usuario@<IP-VPS>:/home/usuario/gasolinera-app
```

(usa la ruta y usuario que te haya dado el dueño del VPS — no necesitas `/opt` ni permisos
de root, cualquier carpeta donde puedas escribir sirve).

## 3. Configurar variables

```bash
cd gasolinera-app
cp .env.example .env
nano .env
```

Para esta prueba **no necesitas** completar `DOMINIO` (esa variable solo la usa
`docker-compose.yml`, no `docker-compose.demo.yml`). Sí completa `DB_PASSWORD`,
`JWT_SECRET`, `ADMIN_USER` y `ADMIN_PASSWORD`. Si el puerto 8080 ya está ocupado, agrega
al `.env`:

```
PUERTO_DEMO=8090
```

(o cualquier puerto libre que hayas confirmado en el paso 1).

## 4. Levantar solo lo tuyo, sin tocar lo que ya corre en esa VPS

```bash
docker compose -p gasolinera-demo -f docker-compose.demo.yml up -d --build
```

El flag `-p gasolinera-demo` le da un nombre de proyecto propio a tus contenedores, así no
se mezclan ni chocan con el docker-compose que ya estaba corriendo ahí. Esta variante no
usa Caddy ni los puertos 80/443, así que no puede interferir con lo existente.

## 5. Probar

Abre en el navegador:

```
http://<IP-DEL-VPS>:8080
```

(o el puerto que hayas puesto en `PUERTO_DEMO`). Ahí ya tienes tanto la pantalla del
bombero (`/bombero.html`) como el panel admin (`/admin.html`) — es la misma app completa,
solo que sin dominio ni HTTPS todavía, porque es una prueba interna.

## 6. Bajarlo cuando termines la prueba (sin afectar nada más)

```bash
docker compose -p gasolinera-demo -f docker-compose.demo.yml down
```

## Cuando decidan quedarse con esto en serio

Migrar de esta prueba a la versión final con dominio propio y HTTPS (`docker-compose.yml`,
ver `README_DESPLIEGUE.md`) es simple porque todo vive en Docker:

1. Respalda la base de datos de la prueba: `docker compose -p gasolinera-demo exec db pg_dump -U gasolinera gasolinera > respaldo.sql`
2. Copia la carpeta del proyecto al VPS/dominio definitivo.
3. Restaura el respaldo ahí.
4. Levanta con `docker-compose.yml` (el que sí incluye Caddy + HTTPS).

Cambiar solo el dominio más adelante (sin cambiar de VPS) es todavía más simple: editas
`DOMINIO` en `.env` y corres `docker compose up -d`; Caddy emite el certificado nuevo solo.
