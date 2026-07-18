-- Datos iniciales

-- Estos 3 INSERT solo cargan datos de ejemplo la PRIMERA vez (tabla vacía), no en cada
-- reinicio del contenedor. Antes usaban "ON CONFLICT (nombre) DO NOTHING", pero eso deja de
-- proteger apenas alguien renombra la fila desde el panel admin (sucursales y tipos de socio
-- se pueden renombrar): al no calzar más el nombre, el siguiente reinicio volvía a insertar
-- una fila nueva con el nombre original, resucitando un duplicado "fantasma".
INSERT INTO sucursales (nombre, direccion)
SELECT * FROM (VALUES
    ('Sucursal 1', 'Por definir'),
    ('Sucursal 2', 'Por definir')
) AS v(nombre, direccion)
WHERE NOT EXISTS (SELECT 1 FROM sucursales);

INSERT INTO combustibles (nombre)
SELECT * FROM (VALUES ('93'), ('95'), ('97'), ('diesel')) AS v(nombre)
WHERE NOT EXISTS (SELECT 1 FROM combustibles);

INSERT INTO tipos_socio (nombre, descripcion)
SELECT * FROM (VALUES
    ('Tipo 1', 'Socio tipo 1'),
    ('Tipo 2', 'Socio tipo 2')
) AS v(nombre, descripcion)
WHERE NOT EXISTS (SELECT 1 FROM tipos_socio);

-- Reglas de descuento (CLP por litro)
-- Tipo 1: $60 en 93 y 95, $50 en diesel
-- Tipo 2: $20 en todos los combustibles
-- reglas_descuento lleva historial (igual que precios_combustible), así que este INSERT
-- solo agrega una fila si nunca se ha definido una regla para esa combinación; así reiniciar
-- el contenedor no duplica filas ni pisa un cambio que el admin ya haya hecho.
INSERT INTO reglas_descuento (tipo_socio_id, combustible_id, descuento_clp_litro, vigente_desde)
SELECT t.id, c.id, v.descuento, now()
FROM (VALUES
    ('Tipo 1', '93', 60),
    ('Tipo 1', '95', 60),
    ('Tipo 1', 'diesel', 50),
    ('Tipo 2', '93', 20),
    ('Tipo 2', '95', 20),
    ('Tipo 2', '97', 20),
    ('Tipo 2', 'diesel', 20)
) AS v(tipo_nombre, combustible_nombre, descuento)
JOIN tipos_socio t ON t.nombre = v.tipo_nombre
JOIN combustibles c ON c.nombre = v.combustible_nombre
WHERE NOT EXISTS (
    SELECT 1 FROM reglas_descuento r
    WHERE r.tipo_socio_id = t.id AND r.combustible_id = c.id
);

-- Precios iniciales por sucursal y combustible (SOLO VALORES DE EJEMPLO para poder probar
-- la app de inmediato). Ajusta los precios reales desde la pestaña "Precios" del panel admin
-- antes de usar la app en serio. Esta consulta solo inserta si nunca se ha definido un precio
-- para esa combinación sucursal+combustible, así que reiniciar el contenedor no crea duplicados
-- ni pisa un precio que el admin ya haya actualizado.
INSERT INTO precios_combustible (sucursal_id, combustible_id, precio_clp_litro, vigente_desde)
SELECT s.id, c.id, v.precio, now()
FROM (VALUES
    ('Sucursal 1', '93', 950),
    ('Sucursal 1', '95', 980),
    ('Sucursal 1', '97', 1020),
    ('Sucursal 1', 'diesel', 880),
    ('Sucursal 2', '93', 950),
    ('Sucursal 2', '95', 980),
    ('Sucursal 2', '97', 1020),
    ('Sucursal 2', 'diesel', 880)
) AS v(sucursal_nombre, combustible_nombre, precio)
JOIN sucursales s ON s.nombre = v.sucursal_nombre
JOIN combustibles c ON c.nombre = v.combustible_nombre
WHERE NOT EXISTS (
    SELECT 1 FROM precios_combustible p
    WHERE p.sucursal_id = s.id AND p.combustible_id = c.id
);

-- Usuario admin por defecto (usuario: admin / clave: cambiar123)
-- El hash se genera en scripts/hash.js si necesitas regenerarlo.
-- Este INSERT se hace desde el script de arranque (bootstrap.js) para poder hashear la clave dinámicamente.
