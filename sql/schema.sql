-- Esquema de base de datos: app de descuentos para bencinera
-- PostgreSQL

CREATE TABLE IF NOT EXISTS sucursales (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    direccion VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    apellido VARCHAR(100),
    usuario VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(200) NOT NULL,
    rol VARCHAR(20) NOT NULL CHECK (rol IN ('admin', 'bombero')),
    sucursal_id INTEGER REFERENCES sucursales(id),
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_en TIMESTAMP NOT NULL DEFAULT now(),
    telefono VARCHAR(30)
);

-- Red de seguridad por si esta tabla ya existía de una instalación anterior a este cambio
-- (antes "usuarios" solo tenía un campo "nombre" único, sin apellido separado, ni teléfono).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS apellido VARCHAR(100);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefono VARCHAR(30);

CREATE TABLE IF NOT EXISTS tipos_socio (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    descripcion VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS combustibles (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(30) NOT NULL UNIQUE
);

-- Igual que precios_combustible: no se sobrescribe, cada cambio agrega una fila nueva con
-- su fecha de vigencia. Esto permite reconstruir qué descuento aplicaba en una fecha pasada
-- (necesario para sincronizar ventas registradas sin conexión).
CREATE TABLE IF NOT EXISTS reglas_descuento (
    id SERIAL PRIMARY KEY,
    tipo_socio_id INTEGER NOT NULL REFERENCES tipos_socio(id),
    combustible_id INTEGER NOT NULL REFERENCES combustibles(id),
    descuento_clp_litro NUMERIC(10, 2) NOT NULL,
    vigente_desde TIMESTAMP NOT NULL DEFAULT now()
);

-- Red de seguridad: instalaciones anteriores a este cambio tenían esta tabla sin historial
-- (con una restricción UNIQUE que impedía guardar más de una fila por combinación). La quitamos
-- para poder llevar historial, y agregamos vigente_desde si no existía.
ALTER TABLE reglas_descuento DROP CONSTRAINT IF EXISTS reglas_descuento_tipo_socio_id_combustible_id_key;
ALTER TABLE reglas_descuento ADD COLUMN IF NOT EXISTS vigente_desde TIMESTAMP NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_reglas_lookup
    ON reglas_descuento (tipo_socio_id, combustible_id, vigente_desde DESC);

CREATE TABLE IF NOT EXISTS socios (
    id SERIAL PRIMARY KEY,
    rut VARCHAR(9) NOT NULL UNIQUE, -- sin puntos ni guion ni dv, ej: 12345678
    dv CHAR(1) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    apellido VARCHAR(100),
    tipo_socio_id INTEGER NOT NULL REFERENCES tipos_socio(id),
    activo BOOLEAN NOT NULL DEFAULT true,
    fecha_registro DATE NOT NULL DEFAULT CURRENT_DATE,
    telefono VARCHAR(30),
    email VARCHAR(120),
    direccion VARCHAR(200)
);

-- Red de seguridad por si esta tabla ya existía de una instalación anterior a este cambio.
ALTER TABLE socios ADD COLUMN IF NOT EXISTS direccion VARCHAR(200);

CREATE INDEX IF NOT EXISTS idx_socios_rut ON socios(rut);

-- Precio del litro por sucursal y combustible. No se sobrescribe: cada cambio de precio
-- agrega una fila nueva con su fecha de vigencia, así queda historial de precios y cada
-- transacción antigua conserva el precio que realmente aplicó ese día.
CREATE TABLE IF NOT EXISTS precios_combustible (
    id SERIAL PRIMARY KEY,
    sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
    combustible_id INTEGER NOT NULL REFERENCES combustibles(id),
    precio_clp_litro NUMERIC(10, 2) NOT NULL,
    vigente_desde TIMESTAMP NOT NULL DEFAULT now(),
    creado_por INTEGER REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_precios_lookup
    ON precios_combustible (sucursal_id, combustible_id, vigente_desde DESC);

CREATE TABLE IF NOT EXISTS transacciones (
    id SERIAL PRIMARY KEY,
    socio_id INTEGER REFERENCES socios(id),
    rut_consultado VARCHAR(9) NOT NULL,
    sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id), -- bombero que registro
    combustible_id INTEGER NOT NULL REFERENCES combustibles(id),
    litros NUMERIC(10, 3) NOT NULL,
    precio_litro_clp NUMERIC(10, 2) NOT NULL,   -- precio vigente al momento de la venta
    descuento_clp_litro NUMERIC(10, 2) NOT NULL,
    descuento_total_clp NUMERIC(12, 2) NOT NULL,
    monto_total_clp NUMERIC(12, 2) NOT NULL,    -- (precio_litro_clp - descuento_clp_litro) * litros
    creado_en TIMESTAMP NOT NULL DEFAULT now(), -- para ventas sincronizadas, es la hora real de la venta (no la de sync)
    id_local VARCHAR(64) UNIQUE                 -- generado por el celular/PC del bombero al guardar offline; evita duplicar si se reintenta el sync
);

-- Red de seguridad por si esta tabla ya existía de una instalación anterior a este cambio.
ALTER TABLE transacciones ADD COLUMN IF NOT EXISTS precio_litro_clp NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE transacciones ADD COLUMN IF NOT EXISTS monto_total_clp NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE transacciones ADD COLUMN IF NOT EXISTS id_local VARCHAR(64) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_transacciones_fecha ON transacciones(creado_en);
CREATE INDEX IF NOT EXISTS idx_transacciones_sucursal ON transacciones(sucursal_id);

-- Retiros de efectivo que hace un bombero durante el día (entrega la plata acumulada a
-- alguien más, ej. cada $100.000). El efectivo total del cuadre de caja diario se calcula
-- sumando las descargas del día, no se cuenta a mano por separado.
-- creado_en usa timestamptz (con zona horaria) a propósito: es lo único que permite que
-- fechas/horas viajen sin ambigüedad entre el navegador, la API y Postgres. Un timestamp
-- sin zona horaria pierde el offset UTC al guardar y lo reinterpreta como hora local al
-- leer, sumando el desfase (4 horas en Chile) en cada ida y vuelta.
CREATE TABLE IF NOT EXISTS descargas (
    id SERIAL PRIMARY KEY,
    sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
    bombero_id INTEGER NOT NULL REFERENCES usuarios(id),
    monto NUMERIC(12, 2) NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_descargas_fecha ON descargas(creado_en);
CREATE INDEX IF NOT EXISTS idx_descargas_sucursal ON descargas(sucursal_id);

-- Máquinas/surtidores por sucursal. Un surtidor con dos caras (A/B) se modela como dos
-- máquinas independientes (más simple que una jerarquía surtidor->cara).
CREATE TABLE IF NOT EXISTS maquinas (
    id SERIAL PRIMARY KEY,
    sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
    nombre VARCHAR(50) NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (sucursal_id, nombre)
);

-- Cuadre de caja: un registro por sucursal y por turno (mañana 20:00-08:00, tarde
-- 08:00-20:00). tarjeta_total se ingresa a mano (viene del reporte físico de la máquina de
-- tarjetas); efectivo_total y descuentos_total se calculan solos a partir de descargas y
-- transacciones dentro de la ventana turno_inicio/turno_fin, y quedan guardados como
-- snapshot al momento del cierre (no se recalculan después).
CREATE TABLE IF NOT EXISTS cuadres_caja (
    id SERIAL PRIMARY KEY,
    sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
    turno VARCHAR(10) NOT NULL CHECK (turno IN ('manana', 'tarde')),
    turno_inicio TIMESTAMPTZ NOT NULL,
    turno_fin TIMESTAMPTZ NOT NULL,
    tarjeta_total NUMERIC(12, 2) NOT NULL,
    efectivo_total NUMERIC(12, 2) NOT NULL,
    descuentos_total NUMERIC(12, 2) NOT NULL,
    diferencia NUMERIC(12, 2) NOT NULL,
    cerrado_por INTEGER NOT NULL REFERENCES usuarios(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    editado_en TIMESTAMPTZ,
    UNIQUE (sucursal_id, turno_inicio)
);

-- Red de seguridad por si esta tabla ya existía de una instalación anterior a este cambio.
ALTER TABLE cuadres_caja ADD COLUMN IF NOT EXISTS editado_en TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cuadres_sucursal ON cuadres_caja(sucursal_id, turno_fin DESC);

-- Lectura de entrada/salida (contador acumulado del surtidor, nunca baja) por máquina y
-- combustible, dentro de un cuadre. litros y monto_clp quedan calculados y guardados al
-- momento del cierre (monto_clp usa el precio vigente en turno_inicio, no turno_fin — ver
-- el comentario en calcularLecturas() de cuadres.js para el motivo).
CREATE TABLE IF NOT EXISTS cuadre_lecturas (
    id SERIAL PRIMARY KEY,
    cuadre_id INTEGER NOT NULL REFERENCES cuadres_caja(id) ON DELETE CASCADE,
    maquina_id INTEGER NOT NULL REFERENCES maquinas(id),
    combustible_id INTEGER NOT NULL REFERENCES combustibles(id),
    lectura_entrada NUMERIC(12, 1) NOT NULL,
    lectura_salida NUMERIC(12, 1) NOT NULL,
    litros NUMERIC(12, 1) NOT NULL,
    monto_clp NUMERIC(12, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cuadre_lecturas_cuadre ON cuadre_lecturas(cuadre_id);
CREATE INDEX IF NOT EXISTS idx_cuadre_lecturas_maquina ON cuadre_lecturas(maquina_id, combustible_id);
