$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$migration = Get-Content (Join-Path $root 'supabase\migrations\202609100003_volunteer_admin_notifications.sql') -Raw -Encoding utf8
$worker = Get-Content (Join-Path $root 'supabase\functions\send-volunteer-registration-notifications\index.ts') -Raw -Encoding utf8
$workerTest = Get-Content (Join-Path $root 'supabase\functions\send-volunteer-registration-notifications\index.test.ts') -Raw -Encoding utf8

function Has([string]$source,[string]$expected,[string]$label) {
  if (-not $source.Contains($expected)) { throw "FAILED: $label" }
  Write-Output "OK: $label"
}

# COLA: comprueba las barreras críticas sin conectarse ni aplicar la migración.
Has $migration 'create table private.volunteer_notification_queue' 'private queue exists'
Has $migration "notification_type in ('admin_registration', 'volunteer_welcome')" 'notification types are separate'
Has $migration 'unique (application_id, notification_type)' 'one row per application and notification type'
Has $migration 'enable row level security' 'queue enables RLS'
Has $migration 'force row level security' 'queue forces RLS'
Has $migration 'revoke all on private.volunteer_notification_queue from public, anon, authenticated' 'browser has no queue privileges'
Has $migration 'after insert on public.membership_applications' 'database insert is the source event'
Has $migration 'new.email_confirmed_at is not null' 'confirmation transition queues welcome'
Has $migration 'u.email_confirmed_at is not null' 'claim rechecks confirmed email'
Has $migration 'for update skip locked' 'workers cannot claim the same row concurrently'
Has $migration "first_attempt_at > now() - interval '25 minutes'" 'automatic retries stay inside provider idempotency window'
Has $migration 'grant execute on function public.claim_volunteer_notifications(uuid, integer) to service_role' 'only server worker can claim'

# WORKER: prohíbe incorporar secretos o datos privados en el código y correo.
Has $worker 'Deno.env.get("BREVO_API_KEY")' 'Brevo key comes from function secrets'
Has $worker 'Deno.env.get("BREVO_SENDER_EMAIL")' 'sender comes from function secrets'
Has $worker 'Deno.env.get("ADMIN_NOTIFICATION_EMAIL")' 'admin recipient comes from function secrets'
Has $worker 'headers: { idempotencyKey: row.idempotency_key }' 'stable Brevo idempotency key is used'
Has $worker 'https://api.brevo.com/v3/smtp/email' 'official Brevo transactional endpoint is used'
Has $worker 'notification_type === "admin_registration"' 'admin email is rendered separately'
Has $worker 'notification_type === "volunteer_welcome"' 'welcome recipient is validated separately'
Has $workerTest 'rechaza destinatario de bienvenida alterado' 'recipient tampering has a unit test'

if ($worker -match '(?i)(xkeysib-|sb_secret_|service_role\s*=|BREVO_API_KEY\s*=\s*["''][^"'']+)') {
  throw 'FAILED: possible embedded secret in worker'
}
Write-Output 'OK: no embedded secret pattern found in worker'
Write-Output 'Result: notification static smoke checks passed.'
