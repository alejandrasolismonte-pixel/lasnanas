// PostgreSQL real en memoria. No usa el proyecto remoto, sus claves ni sus eventos.
// PGlite es exclusivo de este verificador: no se incorpora al sitio ni a sus funciones.
import { PGlite } from 'npm:@electric-sql/pglite@0.5.8';

const database = new PGlite();
try {
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role', true), '')
    $$;
    create type public.volunteer_role as enum ('admin', 'coordination', 'volunteer');
    create table public.staff_roles (
      user_id uuid not null, role public.volunteer_role not null, revoked_at timestamptz
    );
    create table public.membership_applications (submitted_at timestamptz);
  `);
  for (const path of [
    '../supabase/migrations/202609270004_private_site_activity.sql',
    '../supabase/migrations/202609280002_site_activity_email_reports.sql',
  ]) {
    await database.exec(await Deno.readTextFile(new URL(path, import.meta.url)));
    console.log('Migración validada:', path.split('/').at(-1));
  }
  const fixtures = await Deno.readTextFile(new URL('./site-activity-email-database.sql', import.meta.url));
  const results = await database.exec(fixtures);
  for (const result of results) {
    for (const row of result.rows) {
      if ('test_result' in row) console.log(row.test_result);
    }
  }
  const [{ rows }] = await database.exec(`
    select not enabled and activated_at is null and scan_date is null as restored
    from public.site_activity_email_settings;
  `);
  if (rows.length !== 1 || rows[0].restored !== true) throw new Error('fixtures_rollback_failed');
  console.log('Pruebas SQL completas; fixtures revertidos. Sin conexiones ni correos externos.');
} finally {
  await database.close();
}
