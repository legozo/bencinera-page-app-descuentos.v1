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
