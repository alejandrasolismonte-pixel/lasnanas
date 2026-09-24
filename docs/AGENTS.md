## Regla obligatoria — Nuevas tablas Supabase

Cada vez que se cree una tabla nueva en Supabase:

1. Crear la tabla mediante una migración.
2. Definir los GRANT mínimos necesarios.
3. Activar RLS.
4. Crear las políticas RLS correspondientes.
5. Verificar permisos de anon, authenticated y service_role.
6. No dar acceso público ni permisos amplios por defecto.
7. Dejar CREATE TABLE + GRANT + RLS + POLICIES en la misma migración.

Proteger especialmente datos personales, voluntarias, Ñañas, pagos, comprobantes, documentos y administración.

Nunca crear una tabla nueva sin GRANT + RLS + políticas + verificación de permisos.