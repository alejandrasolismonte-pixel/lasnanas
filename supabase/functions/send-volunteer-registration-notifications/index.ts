/* Las Ñañas · worker privado para correos de inscripción, pago y membresía.
   No registra destinatarios, contenido de correo, tokens ni secretos. */
import { createClient } from "@supabase/supabase-js";

export type NotificationRow = {
  notification_id: string;
  application_id: string;
  notification_type: "admin_registration" | "volunteer_welcome" | "transfer_receipt_received" | "payment_confirmed" | "membership_activated";
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

export type ConfirmedPayment = {
  paymentId: string;
  amount: number;
  currency: "CLP" | "USD";
  reference: string;
  confirmedAt: string;
  startsAt: string;
  endsAt: string;
  settledAmount?: number | null;
  settledCurrency?: "CLP" | "USD" | "EUR" | null;
  sourceCurrency?: "CLP" | "USD" | "EUR" | null;
  transferRoute?: "domestic" | "international" | null;
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
  if (!["admin_registration", "volunteer_welcome", "transfer_receipt_received", "payment_confirmed", "membership_activated"].includes(row.notification_type) ||
      !ALLOWED_PLANS.has(row.plan_id) || !ALLOWED_BILLING.has(row.billing) ||
      !ALLOWED_CURRENCIES.has(row.currency) || !ALLOWED_STATUSES.has(row.application_status)) {
    throw new Error("invalid_notification_payload");
  }
  if (!EMAIL_PATTERN.test(row.volunteer_email) ||
      (["volunteer_welcome", "payment_confirmed", "membership_activated"].includes(row.notification_type) && (!row.recipient_email || row.recipient_email !== row.volunteer_email)) ||
      (["admin_registration", "transfer_receipt_received"].includes(row.notification_type) && row.recipient_email !== null)) {
    throw new Error("invalid_notification_recipient");
  }
  if (!/^[0-9a-f-]{36}$/i.test(row.idempotency_key) || Number.isNaN(Date.parse(row.application_created_at))) {
    throw new Error("invalid_notification_metadata");
  }
}

export function buildBrevoMessage(row: NotificationRow, config: RuntimeConfig, payment?: ConfirmedPayment) {
  validateNotification(row);
  const baseUrl = new URL(config.publicSiteUrl);
  if (baseUrl.protocol !== "https:") throw new Error("invalid_public_site_url");
  const volunteerUrl = new URL("pages/mi-voluntariado.html", baseUrl).href;
  const protocolUrl = new URL("pages/protocolo-acuerdos-voluntariado.html", baseUrl).href;
  const coordinationUrl = new URL("pages/coordinacion-voluntariado.html", baseUrl);
  coordinationUrl.searchParams.set("application", row.application_id);
  const periodicity = row.billing === "yearly" ? "Anual" : "Mensual";
  const plan = ({ "keyuwün": "Keyuwün", "kimün": "Kimün", "pülli": "Pülli" } as const)[row.plan_id];
  const status = ({ draft: "Borrador", submitted: "Enviada", in_review: "En revisión", needs_clarification: "Requiere información adicional", approved: "Aprobada", rejected: "Rechazada", withdrawn: "Retirada" } as Record<string, string>)[row.application_status];
  const createdAt = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(row.application_created_at));
  const firstName = cleanPlainText(row.first_name);
  const lastName = cleanPlainText(row.last_name);
  const isPaymentNotice = row.notification_type === "payment_confirmed" || row.notification_type === "membership_activated";
  if (isPaymentNotice && (!payment || !/^[0-9a-f-]{36}$/i.test(payment.paymentId) ||
      !Number.isSafeInteger(payment.amount) || payment.amount < 1 || payment.currency !== row.currency ||
      Number.isNaN(Date.parse(payment.confirmedAt)) || Number.isNaN(Date.parse(payment.startsAt)) ||
      Number.isNaN(Date.parse(payment.endsAt)) || Date.parse(payment.endsAt) <= Date.parse(payment.startsAt))) {
    throw new Error("invalid_confirmed_payment");
  }
  if (payment?.settledAmount != null && (!Number.isFinite(payment.settledAmount) || payment.settledAmount <= 0 ||
      !["CLP", "USD", "EUR"].includes(payment.settledCurrency ?? ""))) {
    throw new Error("invalid_settlement_details");
  }

  const commonRows = `
    <tr><th align="left">Plan</th><td>${escapeHtml(plan)}</td></tr>
    <tr><th align="left">Periodicidad</th><td>${periodicity}</td></tr>
    <tr><th align="left">Moneda</th><td>${escapeHtml(row.currency)}</td></tr>
    <tr><th align="left">Estado de la solicitud</th><td>${escapeHtml(status)}</td></tr>`;

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
      textContent: `Nueva inscripción de voluntariado\nNombre: ${firstName}\nApellido: ${lastName}\nCorreo: ${row.volunteer_email}\nPlan: ${plan}\nPeriodicidad: ${periodicity}\nMoneda: ${row.currency}\nFecha y hora: ${createdAt}\nEstado de la solicitud: ${status}\nPanel de coordinación: ${coordinationUrl.href}`,
      headers: { idempotencyKey: row.idempotency_key },
    };
  }

  if (row.notification_type === "transfer_receipt_received") {
    return {
      sender: { name: "Las Ñañas", email: config.senderEmail },
      to: [{ email: config.adminEmail, name: "Coordinación Las Ñañas" }],
      subject: "Nuevo comprobante de transferencia recibido",
      htmlContent: `<html lang="es"><body><h1>Nuevo comprobante de transferencia recibido</h1>
        <p>Una voluntaria terminó correctamente la carga de su comprobante de transferencia.</p>
        <table><tr><th align="left">Nombre</th><td>${escapeHtml(firstName)}</td></tr>
        <tr><th align="left">Apellido</th><td>${escapeHtml(lastName)}</td></tr>
        <tr><th align="left">Correo</th><td>${escapeHtml(row.volunteer_email)}</td></tr>
        ${commonRows}<tr><th align="left">Fecha de inscripción</th><td>${escapeHtml(createdAt)}</td></tr></table>
        <p>El comprobante fue recibido correctamente, pero el pago aún requiere validación manual.
        Esto no confirma que el dinero haya ingresado a la cuenta bancaria.</p>
        <p>La transferencia debe verificarse manualmente antes de activar la suscripción.</p>
        <p><a href="${escapeHtml(coordinationUrl.href)}">Revisar en administración</a></p>
        </body></html>`,
      textContent: `Nuevo comprobante de transferencia recibido\nNombre: ${firstName} ${lastName}\nCorreo: ${row.volunteer_email}\nPlan: ${plan}\nPeriodicidad: ${periodicity}\nMoneda: ${row.currency}\nEstado de la solicitud: ${status}\n\nEl comprobante fue recibido correctamente, pero el pago aún requiere validación manual. Esto no confirma que el dinero haya ingresado a la cuenta bancaria.\nLa transferencia debe verificarse manualmente antes de activar la suscripción.\n\nRevisar en administración: ${coordinationUrl.href}`,
      headers: { idempotencyKey: row.idempotency_key },
    };
  }

  if (row.notification_type === "payment_confirmed" && payment) {
    const amount = new Intl.NumberFormat("es-CL", { style: "currency", currency: payment.currency, maximumFractionDigits: 0 }).format(payment.amount);
    const date = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(payment.confirmedAt));
    const reference = cleanPlainText(payment.reference);
    const settled = payment.settledAmount != null && payment.settledCurrency
      ? new Intl.NumberFormat("es-CL", { style: "currency", currency: payment.settledCurrency, maximumFractionDigits: 2 }).format(payment.settledAmount)
      : null;
    return {
      sender: { name: "Las Ñañas", email: config.senderEmail },
      to: [{ email: row.recipient_email!, name: `${firstName} ${lastName}`.trim() }],
      subject: "Comprobante de pago confirmado · Las Ñañas",
      htmlContent: `<html lang="es"><body><h1>Comprobante de pago confirmado</h1>
        <p>Hola, ${escapeHtml(firstName)}. Confirmamos la recepción de tu aporte para Las Ñañas.</p>
        <table><tr><th align="left">Código de pago</th><td>${escapeHtml(payment.paymentId)}</td></tr>
        <tr><th align="left">Plan</th><td>${escapeHtml(plan)}</td></tr>
        <tr><th align="left">Periodicidad</th><td>${periodicity}</td></tr>
        <tr><th align="left">Importe del plan</th><td>${escapeHtml(amount)}</td></tr>
        ${settled ? `<tr><th align="left">Abono bancario verificado</th><td>${escapeHtml(settled)}</td></tr>` : ""}
        <tr><th align="left">Fecha de confirmación</th><td>${escapeHtml(date)}</td></tr>
        <tr><th align="left">Referencia</th><td>${escapeHtml(reference)}</td></tr></table>
        <p><a href="${escapeHtml(volunteerUrl)}">Consultar mi membresía</a></p></body></html>`,
      textContent: `Comprobante de pago confirmado\nHola, ${firstName}. Confirmamos la recepción de tu aporte para Las Ñañas.\nCódigo de pago: ${payment.paymentId}\nPlan: ${plan}\nPeriodicidad: ${periodicity}\nImporte del plan: ${amount}${settled ? `\nAbono bancario verificado: ${settled}` : ""}\nFecha de confirmación: ${date}\nReferencia: ${reference}\nMi membresía: ${volunteerUrl}`,
      headers: { idempotencyKey: row.idempotency_key },
    };
  }

  if (row.notification_type === "membership_activated" && payment) {
    const start = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(new Date(payment.startsAt));
    const end = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(new Date(payment.endsAt));
    return {
      sender: { name: "Las Ñañas", email: config.senderEmail },
      to: [{ email: row.recipient_email!, name: `${firstName} ${lastName}`.trim() }],
      subject: "Tu suscripción a Las Ñañas está activa",
      htmlContent: `<html lang="es"><body><h1>Tu suscripción está activa</h1>
        <p>Hola, ${escapeHtml(firstName)}. Tu membresía ${escapeHtml(plan)} está activa.</p>
        <p>Vigencia: ${escapeHtml(start)} al ${escapeHtml(end)}.</p>
        <p><a href="${escapeHtml(volunteerUrl)}">Abrir Mi voluntariado y descargar mi credencial</a></p>
        <p><a href="${escapeHtml(protocolUrl)}">Leer y guardar el documento de protocolo y acuerdos</a></p>
        </body></html>`,
      textContent: `Tu suscripción está activa\nHola, ${firstName}. Tu membresía ${plan} está activa.\nVigencia: ${start} al ${end}.\nMi voluntariado: ${volunteerUrl}\nDocumento de protocolo y acuerdos: ${protocolUrl}`,
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
    textContent: `Bienvenida a Las Ñañas, ${firstName}.\nTu inscripción fue guardada correctamente y será revisada por coordinación.\nPlan: ${plan}\nPeriodicidad: ${periodicity}\nMoneda: ${row.currency}\nEstado de la solicitud: ${status}\nMi voluntariado: ${volunteerUrl}`,
    headers: { idempotencyKey: row.idempotency_key },
  };
}

async function loadConfirmedPayment(client: ReturnType<typeof createClient>, row: NotificationRow): Promise<ConfirmedPayment> {
  const { data: payment, error: paymentError } = await client.from("payments")
    .select("id,owner_id,application_id,status,amount,currency,provider_reference,confirmed_at,settled_amount,settled_currency,source_currency,transfer_route")
    .eq("application_id", row.application_id).eq("status", "confirmed").single();
  if (paymentError || !payment || payment.owner_id !== row.owner_id ||
      payment.application_id !== row.application_id) throw new Error("confirmed_payment_unavailable");
  const { data: membership, error: membershipError } = await client.from("memberships")
    .select("owner_id,application_id,payment_id,active,starts_at,ends_at")
    .eq("application_id", row.application_id).eq("payment_id", payment.id).single();
  if (membershipError || !membership || membership.owner_id !== payment.owner_id ||
      membership.application_id !== payment.application_id ||
      (row.notification_type === "membership_activated" &&
        (!membership.active || Date.parse(membership.starts_at) > Date.now() || Date.parse(membership.ends_at) <= Date.now()))) {
    throw new Error("active_membership_unavailable");
  }
  return {
    paymentId: payment.id, amount: payment.amount, currency: payment.currency,
    reference: payment.provider_reference ?? "Sin referencia bancaria", confirmedAt: payment.confirmed_at,
    startsAt: membership.starts_at, endsAt: membership.ends_at,
    settledAmount: payment.settled_amount, settledCurrency: payment.settled_currency,
    sourceCurrency: payment.source_currency, transferRoute: payment.transfer_route,
  } as ConfirmedPayment;
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
  if (request.method !== "POST") return new Response("Método no permitido", { status: 405 });
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
      const payment = row.notification_type === "payment_confirmed" || row.notification_type === "membership_activated"
        ? await loadConfirmedPayment(supabase, row) : undefined;
      const message = buildBrevoMessage(row, config, payment);
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
