/* Las Ñañas · worker privado para correos de inscripción y bienvenida.
   No registra destinatarios, contenido de correo, tokens ni secretos. */
import { createClient } from "@supabase/supabase-js";

export type NotificationRow = {
  notification_id: string;
  application_id: string;
  notification_type: "admin_registration" | "volunteer_welcome";
  recipient_email: string | null;
  first_name: string;
  last_name: string;
  volunteer_email: string;
  plan_id: "keyuwün" | "kimün" | "pülli";
  billing: "monthly" | "yearly";
  currency: "CLP" | "USD";
  application_status: string;
  application_created_at: string;
  idempotency_key: string;
  attempt_number: number;
};

type RuntimeConfig = {
  brevoApiKey: string;
  senderEmail: string;
  adminEmail: string;
  publicSiteUrl: string;
};

const ALLOWED_PLANS = new Set(["keyuwün", "kimün", "pülli"]);
const ALLOWED_BILLING = new Set(["monthly", "yearly"]);
const ALLOWED_CURRENCIES = new Set(["CLP", "USD"]);
const ALLOWED_STATUSES = new Set(["draft", "submitted", "in_review", "needs_clarification", "approved", "rejected", "withdrawn"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const escapeHtml = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character] as string));

// CORREO SEGURO: elimina controles en texto plano y nombres de destinatario.
export const cleanPlainText = (value: unknown): string => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

export function validateNotification(row: NotificationRow): void {
  if (!ALLOWED_PLANS.has(row.plan_id) || !ALLOWED_BILLING.has(row.billing) ||
      !ALLOWED_CURRENCIES.has(row.currency) || !ALLOWED_STATUSES.has(row.application_status)) {
    throw new Error("invalid_notification_payload");
  }
  if (!EMAIL_PATTERN.test(row.volunteer_email) ||
      (row.notification_type === "volunteer_welcome" && (!row.recipient_email || row.recipient_email !== row.volunteer_email))) {
    throw new Error("invalid_notification_recipient");
  }
  if (!/^[0-9a-f-]{36}$/i.test(row.idempotency_key) || Number.isNaN(Date.parse(row.application_created_at))) {
    throw new Error("invalid_notification_metadata");
  }
}

export function buildBrevoMessage(row: NotificationRow, config: RuntimeConfig) {
  validateNotification(row);
  const baseUrl = new URL(config.publicSiteUrl);
  if (baseUrl.protocol !== "https:") throw new Error("invalid_public_site_url");
  const volunteerUrl = new URL("pages/mi-voluntariado.html", baseUrl).href;
  const coordinationUrl = new URL("pages/coordinacion-voluntariado.html", baseUrl);
  coordinationUrl.searchParams.set("application", row.application_id);
  const periodicity = row.billing === "yearly" ? "Anual" : "Mensual";
  const createdAt = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(row.application_created_at));
  const firstName = cleanPlainText(row.first_name);
  const lastName = cleanPlainText(row.last_name);

  const commonRows = `
    <tr><th align="left">Plan</th><td>${escapeHtml(row.plan_id)}</td></tr>
    <tr><th align="left">Periodicidad</th><td>${periodicity}</td></tr>
    <tr><th align="left">Moneda</th><td>${escapeHtml(row.currency)}</td></tr>
    <tr><th align="left">Estado</th><td>${escapeHtml(row.application_status)}</td></tr>`;

  if (row.notification_type === "admin_registration") {
    return {
      sender: { name: "Las Ñañas", email: config.senderEmail },
      to: [{ email: config.adminEmail, name: "Coordinación Las Ñañas" }],
      subject: "Nueva inscripción de voluntariado",
      htmlContent: `<html><body><h1>Nueva inscripción de voluntariado</h1><table>
        <tr><th align="left">Nombre</th><td>${escapeHtml(firstName)}</td></tr>
        <tr><th align="left">Apellido</th><td>${escapeHtml(lastName)}</td></tr>
        <tr><th align="left">Correo</th><td>${escapeHtml(row.volunteer_email)}</td></tr>
        ${commonRows}<tr><th align="left">Fecha y hora</th><td>${escapeHtml(createdAt)}</td></tr>
        </table><p><a href="${escapeHtml(coordinationUrl.href)}">Abrir panel de coordinación</a></p></body></html>`,
      textContent: `Nueva inscripción de voluntariado\nNombre: ${firstName}\nApellido: ${lastName}\nCorreo: ${row.volunteer_email}\nPlan: ${row.plan_id}\nPeriodicidad: ${periodicity}\nMoneda: ${row.currency}\nFecha y hora: ${createdAt}\nEstado: ${row.application_status}\nPanel: ${coordinationUrl.href}`,
      headers: { idempotencyKey: row.idempotency_key },
    };
  }

  return {
    sender: { name: "Las Ñañas", email: config.senderEmail },
    to: [{ email: row.recipient_email!, name: `${firstName} ${lastName}`.trim() }],
    subject: "Bienvenida a Las Ñañas",
    htmlContent: `<html><body><h1>Bienvenida a Las Ñañas, ${escapeHtml(firstName)}</h1>
      <p>Tu inscripción fue guardada correctamente y será revisada por coordinación.</p><table>${commonRows}</table>
      <p><a href="${escapeHtml(volunteerUrl)}">Ir a Mi voluntariado</a></p></body></html>`,
    textContent: `Bienvenida a Las Ñañas, ${firstName}.\nTu inscripción fue guardada correctamente y será revisada por coordinación.\nPlan: ${row.plan_id}\nPeriodicidad: ${periodicity}\nMoneda: ${row.currency}\nEstado: ${row.application_status}\nMi voluntariado: ${volunteerUrl}`,
    headers: { idempotencyKey: row.idempotency_key },
  };
}

function requireRuntimeConfig(): RuntimeConfig & { webhookSecret: string; supabaseUrl: string; supabaseSecretKey: string } {
  // SECRETOS: todos se leen solo en el runtime de Supabase; jamás desde el frontend.
  const brevoApiKey = Deno.env.get("BREVO_API_KEY")?.trim();
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL")?.trim();
  const adminEmail = Deno.env.get("ADMIN_NOTIFICATION_EMAIL")?.trim();
  const publicSiteUrl = Deno.env.get("PUBLIC_SITE_URL")?.trim();
  const webhookSecret = Deno.env.get("NOTIFICATION_WEBHOOK_SECRET")?.trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  // COMPATIBILIDAD: prioriza las claves actuales y conserva el respaldo legado administrado por Supabase.
  let supabaseSecretKey: string | undefined;
  const currentSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (currentSecretKeys) {
    try {
      const parsed = JSON.parse(currentSecretKeys) as Record<string, unknown>;
      if (typeof parsed.default === "string") supabaseSecretKey = parsed.default.trim();
    } catch {
      throw new Error("invalid_supabase_secret_keys");
    }
  }
  supabaseSecretKey ||= Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!brevoApiKey || !senderEmail || !adminEmail || !publicSiteUrl || !webhookSecret || !supabaseUrl || !supabaseSecretKey) {
    throw new Error("missing_server_configuration");
  }
  if (!EMAIL_PATTERN.test(senderEmail) || !EMAIL_PATTERN.test(adminEmail)) throw new Error("invalid_server_email_configuration");
  return { brevoApiKey, senderEmail, adminEmail, publicSiteUrl, webhookSecret, supabaseUrl, supabaseSecretKey };
}

async function secretsMatch(received: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [receivedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(receivedHash); const right = new Uint8Array(expectedHash);
  if (left.length !== right.length) return false;
  // COMPARACIÓN CONSTANTE: recorre todos los bytes, aunque encuentre una diferencia inicial.
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  let config: ReturnType<typeof requireRuntimeConfig>;
  try { config = requireRuntimeConfig(); } catch { return Response.json({ error: "server_not_configured" }, { status: 503 }); }
  if (!await secretsMatch(request.headers.get("x-notification-secret") ?? "", config.webhookSecret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const worker = crypto.randomUUID();
  const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("claim_volunteer_notifications", { p_worker: worker, p_limit: 10 });
  if (error) return Response.json({ error: "queue_unavailable" }, { status: 503 });

  let sent = 0; let failed = 0;
  for (const row of (data ?? []) as NotificationRow[]) {
    try {
      const message = buildBrevoMessage(row, config);
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "api-key": config.brevoApiKey },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        await supabase.rpc("mark_volunteer_notification_failed", { p_notification_id: row.notification_id, p_worker: worker, p_error_code: `brevo_http_${response.status}`, p_retryable: retryable });
        failed++; continue;
      }
      const result = await response.json() as { messageId?: string };
      const messageId = cleanPlainText(result.messageId).replace(/[^a-zA-Z0-9_.@<>:-]/g, "").slice(0, 255);
      if (!messageId) throw new Error("brevo_missing_message_id");
      const marked = await supabase.rpc("mark_volunteer_notification_sent", { p_notification_id: row.notification_id, p_worker: worker, p_brevo_message_id: messageId });
      if (marked.error) throw new Error("queue_ack_failed");
      sent++;
    } catch (caught) {
      const code = caught instanceof Error && /^[a-z0-9_:-]+$/i.test(caught.message) ? caught.message : "network_or_delivery_error";
      // REINTENTO: errores de datos/configuración son definitivos; red y confirmaciones ambiguas conservan idempotencia.
      const retryable = !code.startsWith("invalid_");
      await supabase.rpc("mark_volunteer_notification_failed", { p_notification_id: row.notification_id, p_worker: worker, p_error_code: code, p_retryable: retryable });
      failed++;
    }
  }
  return Response.json({ processed: sent + failed, sent, failed });
}

if (import.meta.main) Deno.serve(handler);
