-- El rol de Ñañas comparte la identidad de Supabase Auth, sin recibir permisos
-- del panel de voluntariado. Se confirma esta migración antes de usar el nuevo
-- valor del enum en la siguiente migración (restricción de PostgreSQL).
alter type public.volunteer_role add value if not exists 'nanas_manager';
