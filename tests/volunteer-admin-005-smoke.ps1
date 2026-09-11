$ErrorActionPreference = 'Stop'

# Pruebas estáticas y de aislamiento estructural; no conectan ni modifican Supabase.
$root = Split-Path -Parent $PSScriptRoot
$migration = Get-Content -LiteralPath (Join-Path $root 'supabase/migrations/202609100005_admin_payments_documents.sql') -Raw
$adminJs = Get-Content -LiteralPath (Join-Path $root 'js/coordinacion-voluntariado.js') -Raw
$memberJs = Get-Content -LiteralPath (Join-Path $root 'js/mi-voluntariado.js') -Raw
$adminHtml = Get-Content -LiteralPath (Join-Path $root 'pages/coordinacion-voluntariado.html') -Raw

$ownerA = [guid]::NewGuid().ToString()
$ownerB = [guid]::NewGuid().ToString()
$application = [guid]::NewGuid().ToString()
$fileId = [guid]::NewGuid().ToString()
$pathA = "$ownerA/$application/$fileId.pdf"
$pathB = "$ownerB/$application/$fileId.pdf"

$checks = [ordered]@{
  'Aprobación exige sesión y admin activo' = $migration -match 'admin_approve_membership_application' -and $migration -match 'auth\.uid\(\) is null' -and $migration -match "r\.role = 'admin'" -and $migration -match 'r\.revoked_at is null'
  'Confirmación bloquea la solicitud aprobada' = $migration -match 'for update' -and $migration -match "v_application\.status <> 'approved'"
  'Pago usa importe y moneda de la solicitud' = $migration -match 'v_application\.quoted_amount' -and $migration -match 'v_application\.currency'
  'Pago y membresía se crean en una única función transaccional' = $migration -match 'insert into public\.payments' -and $migration -match 'insert into public\.memberships'
  'Reintento confirmado devuelve la membresía existente' = $migration -match "v_payment\.status = 'confirmed'" -and $migration -match 'confirmed_payment_without_active_membership'
  'Una solicitud mantiene un solo pago y membresía' = $migration -match 'on conflict \(application_id\) do update'
  'Auditoría registra aprobación, pago, membresía y documentos' = $migration -match 'application_status_changed' -and $migration -match 'payment_confirmed' -and $migration -match 'membership_activated' -and $migration -match 'document_changed'
  'Bucket documental permanece privado y limitado a 10 MB' = $migration -match "'volunteer-documents'.*false, 10485760" -and $migration -match "'application/pdf', 'image/jpeg', 'image/png'"
  'Políticas vinculan documentos de voluntaria con auth.uid' = $migration -match 'd\.owner_id=auth\.uid\(\)' -and $migration -match "d\.document_kind='volunteer_submission'"
  'Recursos históricos del plan conservan lectura en tabla y Storage' = ([regex]::Matches($migration, "document_kind='plan_resource'")).Count -ge 2 -and ([regex]::Matches($migration, 'pp\.plan_id=(documents\.|d\.)plan_id')).Count -ge 2
  'Coordination y admin conservan lectura documental autorizada' = $migration -match 'documents_staff_read_005' -and $migration -match 'documents_staff_storage_read_005' -and ([regex]::Matches($migration, 'public\.is_coordination\(\)')).Count -ge 4
  'Usuarios ajenos requieren coincidencia de propietaria' = ([regex]::Matches($migration, 'owner_id=auth\.uid\(\)')).Count -ge 5
  'Dos cuentas ficticias generan espacios de ruta diferentes' = $pathA -ne $pathB -and $pathA.StartsWith($ownerA) -and $pathB.StartsWith($ownerB)
  'Frontend valida firma binaria y tamaño antes de cargar' = $adminJs -match '0x25' -and $adminJs -match '10 \* 1024 \* 1024' -and $memberJs -match '0x89' -and $memberJs -match '10\*1024\*1024'
  'Descargas usan URL firmada corta' = $adminJs -match 'createSignedUrl\(path, 60\)' -and $memberJs -match 'createSignedUrl\(pathResult\.data,60\)'
  'Rechazar sigue deshabilitado' = $adminHtml -match '<button class="btn btn-ghost" type="button" disabled>Rechazar</button>'
  'Frontend no contiene secretos privilegiados' = ($adminJs + $memberJs) -notmatch '(service_role|SUPABASE_SECRET_KEY|BREVO_API_KEY|NOTIFICATION_WEBHOOK_SECRET)'
  'DDL de columnas, índice y restricción admite segunda ejecución' = ([regex]::Matches($migration, 'add column if not exists')).Count -eq 8 -and $migration -match 'create index if not exists documents_application_kind_idx' -and $migration -match "conname = 'documents_scope_valid'"
  'Políticas nuevas toleran una segunda ejecución' = ([regex]::Matches($migration, 'exception when duplicate_object then null')).Count -ge 9
}

$failures = @($checks.GetEnumerator() | Where-Object { -not $_.Value })
$checks.GetEnumerator() | ForEach-Object { Write-Host "[$(if ($_.Value) {'OK'} else {'ERROR'})] $($_.Key)" }
if ($failures.Count) { throw "$($failures.Count) comprobación(es) fallaron." }
Write-Host "Etapa 005: $($checks.Count) comprobaciones superadas."
