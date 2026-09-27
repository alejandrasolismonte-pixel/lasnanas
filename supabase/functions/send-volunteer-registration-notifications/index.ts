/* Las Ñañas · worker privado para correos de inscripción, pago y membresía.
   No registra destinatarios, contenido de correo, tokens ni secretos. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encodeCredentialAttachment, renderInitialCredentialPng } from "./credential-image.ts";

export type NotificationRow = {
  notification_id: string;
  application_id: string;
  notification_type: "admin_registration" | "volunteer_welcome" | "transfer_receipt_received" | "payment_confirmed" | "membership_activated" | "admin_payment_confirmed";
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
// deno-lint-ignore no-control-regex
export const cleanPlainText = (value: unknown): string => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

export function validateNotification(row: NotificationRow): void {
  if (!["admin_registration", "volunteer_welcome", "transfer_receipt_received", "payment_confirmed", "membership_activated", "admin_payment_confirmed"].includes(row.notification_type) ||
      !ALLOWED_PLANS.has(row.plan_id) || !ALLOWED_BILLING.has(row.billing) ||
      !ALLOWED_CURRENCIES.has(row.currency) || !ALLOWED_STATUSES.has(row.application_status)) {
    throw new Error("invalid_notification_payload");
  }
  if (!EMAIL_PATTERN.test(row.volunteer_email) ||
      (["volunteer_welcome", "payment_confirmed", "membership_activated"].includes(row.notification_type) && (!row.recipient_email || row.recipient_email !== row.volunteer_email)) ||
      (["admin_registration", "transfer_receipt_received", "admin_payment_confirmed"].includes(row.notification_type) && row.recipient_email !== null)) {
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
  const documentsUrl = new URL("pages/mi-voluntariado.html?view=documents", baseUrl).href;
  const profileUrl = new URL("pages/mi-voluntariado.html?view=profile", baseUrl).href;
  const logoUrl = new URL("assets/img/logo-web.png", baseUrl).href;
  const welcomeImageUrl = new URL("assets/img/voluntariado/nana-bienvenida.png", baseUrl).href;
  const brand = `<p><img src="${escapeHtml(logoUrl)}" alt="Las Ñañas" width="180" style="max-width:180px;height:auto"></p>`;
  const coordinationUrl = new URL("pages/coordinacion-voluntariado.html", baseUrl);
  coordinationUrl.searchParams.set("application", row.application_id);
  const periodicity = row.billing === "yearly" ? "Anual" : "Mensual";
  const plan = ({ "keyuwün": "Keyuwün", "kimün": "Kimün", "pülli": "Pülli" } as const)[row.plan_id];
  const status = ({ draft: "Borrador", submitted: "Enviada", in_review: "En revisión", needs_clarification: "Requiere información adicional", approved: "Aprobada", rejected: "Rechazada", withdrawn: "Retirada" } as Record<string, string>)[row.application_status];
  const createdAt = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(row.application_created_at));
  const firstName = cleanPlainText(row.first_name);
  const lastName = cleanPlainText(row.last_name);
  const isPaymentNotice = ["payment_confirmed", "membership_activated", "admin_payment_confirmed"].includes(row.notification_type);
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
    return {
      sender: { name: "Las Ñañas", email: config.senderEmail },
      to: [{ email: row.recipient_email!, name: `${firstName} ${lastName}`.trim() }],
      subject: "Comprobante de pago confirmado · Las Ñañas",
      htmlContent: `<html lang="es"><body>${brand}<h1>Pago confirmado</h1>
        <p>Hola, ${escapeHtml(firstName)}. Confirmamos tu aporte al plan ${escapeHtml(plan)} por ${escapeHtml(amount)}.</p>
        <p>En <strong>Mi voluntariado → Mis documentos</strong> puedes descargar el comprobante con la fecha, referencia e importe verificado.</p>
        <p><a href="${escapeHtml(documentsUrl)}">Descargar mi comprobante</a></p>
        <p><a href="${escapeHtml(volunteerUrl)}">Entrar a mi panel</a></p></body></html>`,
      textContent: `Pago confirmado\nHola, ${firstName}. Confirmamos tu aporte al plan ${plan} por ${amount}.\nDescarga el comprobante en Mi voluntariado, sección Mis documentos: ${documentsUrl}\nEntrar a mi panel: ${volunteerUrl}`,
      headers: { idempotencyKey: row.idempotency_key },
    };
  }

  if (row.notification_type === "admin_payment_confirmed" && payment) {
    return {
      sender: { name: "Las Ñañas", email: config.senderEmail },
      to: [{ email: config.adminEmail, name: "Coordinación Las Ñañas" }],
      subject: "Pago confirmado · Voluntariado Las Ñañas",
      htmlContent: `<html lang="es"><body>${brand}<h1>Pago confirmado</h1>
        <p>La suscripción de ${escapeHtml(firstName)} ${escapeHtml(lastName)} (${escapeHtml(plan)}) fue activada.</p>
        <p><a href="${escapeHtml(coordinationUrl.href)}">Abrir expediente en administración</a></p></body></html>`,
      textContent: `Pago confirmado\nLa suscripción de ${firstName} ${lastName} (${plan}) fue activada.\nAbrir expediente en administración: ${coordinationUrl.href}`,
      headers: { idempotencyKey: row.idempotency_key },
    };
  }

  if (row.notification_type === "membership_activated" && payment) {
    const start = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(new Date(payment.startsAt));
    const end = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(new Date(payment.endsAt));
    return {
      sender: { name: "Las Ñañas", email: config.senderEmail },
      to: [{ email: row.recipient_email!, name: `${firstName} ${lastName}`.trim() }],
      subject: "Bienvenida a Las Ñañas · Tu membresía está activa",
      htmlContent: `<html lang="es"><body>${brand}<h1>Bienvenida a Las Ñañas, ${escapeHtml(firstName)}</h1>
        <p>Gracias por acompañarnos en este camino. Coordinación aprobó tu solicitud, confirmó tu pago y activó tu membresía ${escapeHtml(plan)}.</p>
        <p>Vigencia: ${escapeHtml(start)} al ${escapeHtml(end)}.</p>
        <p>Adjuntamos una copia inicial de tu credencial sin fotografía. En <strong>Mi perfil</strong> carga tu foto y guarda los cambios; después descarga tu credencial actualizada en <strong>Mis documentos</strong>.</p>
        <p>Tu comprobante de pago y el protocolo también están en <strong>Mis documentos</strong>.</p>
        <p><img src="${escapeHtml(welcomeImageUrl)}" alt="Una ñaña te da la bienvenida" width="260" style="max-width:260px;height:auto"></p>
        <p><a href="${escapeHtml(profileUrl)}">Cargar mi fotografía en Mi perfil</a></p>
        <p><a href="${escapeHtml(documentsUrl)}">Abrir Mis documentos</a></p>
        <p><a href="${escapeHtml(volunteerUrl)}">Entrar a mi panel</a></p>
        </body></html>`,
      textContent: `Bienvenida a Las Ñañas, ${firstName}. Gracias por acompañarnos en este camino. Coordinación aprobó tu solicitud, confirmó tu pago y activó tu membresía ${plan} del ${start} al ${end}.\nAdjuntamos una copia inicial de tu credencial sin fotografía. Carga tu foto en Mi perfil y guarda los cambios: ${profileUrl}\nDescarga tu credencial actualizada, tu comprobante de pago y el protocolo en Mis documentos: ${documentsUrl}\nEntrar a mi panel: ${volunteerUrl}`,
      headers: { idempotencyKey: row.idempotency_key },
    };
  }

  return {
    sender: { name: "Las Ñañas", email: config.senderEmail },
    to: [{ email: row.recipient_email!, name: `${firstName} ${lastName}`.trim() }],
    subject: "Recibimos tu inscripción · Las Ñañas",
    htmlContent: `<html lang="es"><body>${brand}<h1>Recibimos tu inscripción, ${escapeHtml(firstName)}</h1>
      <p>Tu inscripción al plan ${escapeHtml(plan)} fue guardada. Estamos cerca de completar tu incorporación: coordinación revisará tu solicitud y, cuando apruebe y active tu cuenta tras confirmar el pago, tu membresía quedará activa.</p>
      <p><a href="${escapeHtml(volunteerUrl)}">Entrar a mi panel de voluntariado</a></p></body></html>`,
    textContent: `Recibimos tu inscripción, ${firstName}.\nTu inscripción al plan ${plan} fue guardada. Estamos cerca de completar tu incorporación: coordinación revisará tu solicitud y, cuando apruebe y active tu cuenta tras confirmar el pago, tu membresía quedará activa.\nEntrar a mi panel: ${volunteerUrl}`,
    headers: { idempotencyKey: row.idempotency_key },
  };
}

export async function loadConfirmedPayment(client: SupabaseClient, row: NotificationRow): Promise<ConfirmedPayment> {
  const { data: application, error: applicationError } = await client.from("membership_applications")
    .select("owner_id,status").eq("id", row.application_id).is("deleted_at", null).single();
  const { data: payment, error: paymentError } = await client.from("payments")
    .select("id,owner_id,application_id,status,amount,currency,provider_reference,confirmed_at,settled_amount,settled_currency,source_currency,transfer_route")
    .eq("application_id", row.application_id).eq("status", "confirmed").single();
  if (applicationError || !application || application.status !== "approved" ||
      paymentError || !payment || payment.owner_id !== application.owner_id ||
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

let credentialBackground: Promise<Uint8Array> | undefined;
async function loadCredentialBackground(config: RuntimeConfig): Promise<Uint8Array> {
  credentialBackground ??= (async () => {
    const url = new URL("assets/img/voluntariado/credencial-voluntariado-fondo.png", config.publicSiteUrl);
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("credential_template_unavailable");
    const size = Number(response.headers.get("content-length") || "0");
    if (size > 3_000_000) throw new Error("invalid_credential_background");
    return new Uint8Array(await response.arrayBuffer());
  })();
  try { return await credentialBackground; }
  catch (error) { credentialBackground = undefined; throw error; }
}

export async function buildInitialCredentialAttachment(row: NotificationRow, payment: ConfirmedPayment, background: Uint8Array) {
  validateNotification(row);
  if (row.notification_type !== "membership_activated") throw new Error("invalid_credential_notification_type");
  const png = await renderInitialCredentialPng(background, {
    name: `${cleanPlainText(row.first_name)} ${cleanPlainText(row.last_name)}`.trim(),
    planId: row.plan_id,
    expiresAt: payment.endsAt,
  });
  return encodeCredentialAttachment(png);
}

function requireRuntimeConfig(): RuntimeConfig & { webhookSecret?: string; supabaseUrl: string; supabaseSecretKey: string } {
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
  if (!brevoApiKey || !senderEmail || !adminEmail || !publicSiteUrl || !supabaseUrl || !supabaseSecretKey) {
    throw new Error("missing_server_configuration");
  }
  if (!EMAIL_PATTERN.test(senderEmail) || !EMAIL_PATTERN.test(adminEmail)) throw new Error("invalid_server_email_configuration");
  try {
    if (new URL(publicSiteUrl).protocol !== "https:") throw new Error("invalid_public_site_url");
  } catch { throw new Error("invalid_public_site_url"); }
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

export async function authorizeAdminDispatch(client: SupabaseClient, request: Request): Promise<string> {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
  if (!bearer || bearer[1].length > 4096) throw new Error("admin_auth_required");
  const { data: { user }, error: authError } = await client.auth.getUser(bearer[1]);
  if (authError || !user) throw new Error("admin_auth_required");
  const { data: role, error: roleError } = await client.from("staff_roles")
    .select("user_id").eq("user_id", user.id).eq("role", "admin").is("revoked_at", null).maybeSingle();
  if (roleError) {
    console.error("notification_admin_role_unavailable", roleError.code ?? "unknown");
    throw new Error("admin_role_unavailable");
  }
  if (!role) throw new Error("admin_access_required");
  const rawBody = await request.text();
  if (rawBody.length > 512) throw new Error("invalid_application_id");
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { throw new Error("invalid_application_id"); }
  const applicationId = typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).application_id : undefined;
  if (typeof applicationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId)) {
    throw new Error("invalid_application_id");
  }
  return applicationId;
}

export async function handler(request: Request): Promise<Response> {
  let config: ReturnType<typeof requireRuntimeConfig>;
  try { config = requireRuntimeConfig(); } catch { return Response.json({ error: "server_not_configured" }, { status: 503 }); }
  const origin = request.headers.get("origin");
  const allowedOrigin = new URL(config.publicSiteUrl).origin;
  if (origin && origin !== allowedOrigin) return Response.json({ error: "forbidden_origin" }, { status: 403 });
  const corsHeaders = new Headers();
  if (origin) {
    corsHeaders.set("access-control-allow-origin", allowedOrigin);
    corsHeaders.set("access-control-allow-methods", "POST, OPTIONS");
    corsHeaders.set("access-control-allow-headers", "authorization, apikey, x-client-info, content-type");
    corsHeaders.set("vary", "Origin");
  }
  const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: corsHeaders });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return new Response("Método no permitido", { status: 405, headers: corsHeaders });
  const worker = crypto.randomUUID();
  const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let applicationId: string | undefined;
  const webhookHeader = request.headers.get("x-notification-secret");
  if (webhookHeader !== null) {
    if (!config.webhookSecret || !await secretsMatch(webhookHeader, config.webhookSecret)) {
      return json({ error: "unauthorized" }, 401);
    }
  } else {
    try {
      applicationId = await authorizeAdminDispatch(supabase, request);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "admin_auth_required";
      const status = code === "invalid_application_id" ? 400
        : code === "admin_access_required" ? 403
        : code === "admin_role_unavailable" ? 503 : 401;
      return json({ error: code }, status);
    }
  }
  if (applicationId) {
    const ensured = await supabase.rpc("ensure_activation_notifications", { p_application_id: applicationId });
    if (ensured.error) {
      console.error("notification_queue_ensure_unavailable", ensured.error.code ?? "unknown");
      return json({ error: "queue_unavailable" }, 503);
    }
  }
  const { data, error } = applicationId
    ? await supabase.rpc("claim_volunteer_notifications_for_application", {
      p_worker: worker, p_application_id: applicationId, p_limit: 10,
    })
    : await supabase.rpc("claim_volunteer_notifications", { p_worker: worker, p_limit: 10 });
  if (error) {
    console.error("notification_queue_claim_unavailable", error.code ?? "unknown");
    return json({ error: "queue_unavailable" }, 503);
  }

  let sent = 0; let failed = 0;
  for (const row of (data ?? []) as NotificationRow[]) {
    try {
      const payment = ["payment_confirmed", "membership_activated", "admin_payment_confirmed"].includes(row.notification_type)
        ? await loadConfirmedPayment(supabase, row) : undefined;
      const message = buildBrevoMessage(row, config, payment);
      if (row.notification_type === "membership_activated" && payment) {
        message.attachment = [await buildInitialCredentialAttachment(row, payment, await loadCredentialBackground(config))];
      }
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
  return json({ processed: sent + failed, sent, failed });
}

if (import.meta.main) Deno.serve(handler);
