# Editor visual del mapa territorial

## Uso para administración

1. Iniciar sesión con la cuenta administradora habitual.
2. Entrar al panel **Coordinación de voluntariado**.
3. Seleccionar **Editar mapa del territorio**.
4. Para mover puntos, presionar **Activar movimiento**, arrastrarlos con mouse o dedo y seleccionar **Guardar**.
5. Para cambiar un punto, seleccionarlo y editar su color/tipo, nombre o descripción.
6. Para crear uno, seleccionar **+ Pin naranja** o **+ Pin verde**, ubicarlo visualmente y completar sus datos.

El editor indica si se está ajustando la vista de celulares o la de escritorio/tablet. Las personas visitantes solo pueden consultar los pines; nunca reciben permiso para guardarlos.

- **Cancelar** descarta los movimientos no guardados.
- **Restaurar posiciones** recupera la distribución original en pantalla; hay que presionar **Guardar** para publicarla.
- **Quitar del mapa** oculta el pin sin borrarlo. Aparece en **Pines retirados**, desde donde puede recuperarse.
- Si se intenta salir con cambios pendientes, el navegador solicita confirmación.

## Activación técnica

Las migraciones deben aplicarse una sola vez y en este orden:

1. `supabase/migrations/202609110001_map_pin_editor.sql`: posiciones editables.
2. `supabase/migrations/202609120001_map_pin_content_editor.sql`: alta, edición, retiro y recuperación de pines.

Si la primera ya fue ejecutada, ahora solo corresponde ejecutar la segunda completa en el **SQL Editor** de Supabase. No se requieren nuevas cuentas, claves en el navegador ni cambios en el acceso administrativo actual.

Si la conexión o la migración todavía no están disponibles, la página pública utiliza automáticamente las posiciones incluidas en el HTML como respaldo.
