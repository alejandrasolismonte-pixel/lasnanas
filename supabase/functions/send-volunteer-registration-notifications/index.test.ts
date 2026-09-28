import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeAdminDispatch, buildBrevoMessage, buildInitialCredentialAttachment, cleanPlainText, escapeHtml, handler, loadConfirmedPayment, validateAvailableDocument, type ConfirmedPayment, type NotificationRow } from "./index.ts";

const base: NotificationRow = {
  notification_id: "10000000-0000-4000-8000-000000000001",
  application_id: "20000000-0000-4000-8000-000000000002",
  notification_type: "volunteer_welcome",
  recipient_email: "volunteer@example.test",
  first_name: "Ana",
  last_name: "Pérez",
  volunteer_email: "volunteer@example.test",
  plan_id: "keyuwün",
  billing: "monthly",
  currency: "CLP",
  application_status: "draft",
  application_created_at: "2026-09-10T12:00:00Z",
  idempotency_key: "30000000-0000-4000-8000-000000000003",
  attempt_number: 1,
};
const config = { brevoApiKey: "not-used", senderEmail: "sender@example.test", adminEmail: "admin@example.test", publicSiteUrl: "https://example.test/" };
const payment: ConfirmedPayment = {
  paymentId: "40000000-0000-4000-8000-000000000004", amount: 15000,
  currency: "CLP", reference: "TRANSFER-123", confirmedAt: "2026-09-26T16:00:00Z",
  startsAt: "2026-09-26T16:00:00Z", endsAt: "2026-10-26T16:00:00Z",
  settledAmount: 14980, settledCurrency: "CLP", sourceCurrency: "EUR", transferRoute: "international",
};

Deno.test("escapa HTML controlado por la persona", () => {
  assertEquals(escapeHtml('<script>"x"</script>'), "&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
  assertEquals(cleanPlainText("Ana\r\nBcc: otra@example.test"), "Ana Bcc: otra@example.test");
});

Deno.test("correo inicial confirma recepción sin anunciar activación anticipada", () => {
  const message = buildBrevoMessage(base, config);
  assertEquals(message.to[0].email, base.volunteer_email);
  assertEquals(message.headers.idempotencyKey, base.idempotency_key);
  assert(message.subject.includes("Recibimos tu inscripción"));
  assert(!message.subject.includes("Bienvenida"));
  assert(message.htmlContent.includes("Estamos cerca"));
  assert(message.htmlContent.includes("tu membresía quedará activa"));
  assert(message.htmlContent.includes("https://example.test/pages/mi-voluntariado.html"));
  assert(message.htmlContent.includes("assets/img/logo-web.png"));
  assert(!message.htmlContent.match(/password|contraseña|comprobante de pago/i));
});

Deno.test("aviso administrativo queda separado", () => {
  const message = buildBrevoMessage({ ...base, notification_type: "admin_registration", recipient_email: null }, config);
  assertEquals(message.to[0].email, config.adminEmail);
  assert(message.htmlContent.includes("coordinacion-voluntariado.html"));
  assertEquals(message.headers.idempotencyKey, base.idempotency_key);
});

Deno.test("rechaza URL pública que no sea HTTPS", () => {
  assertThrows(() => buildBrevoMessage(base, { ...config, publicSiteUrl: "http://example.test" }), Error, "invalid_public_site_url");
});

Deno.test("rechaza destinatario de bienvenida alterado", () => {
  assertThrows(() => buildBrevoMessage({ ...base, recipient_email: "other@example.test" }, config), Error, "invalid_notification_recipient");
});

Deno.test("el comprobante de pago solo usa datos de un pago confirmado y se envía a la titular", () => {
  const row = { ...base, notification_type: "payment_confirmed" as const, plan_id: "kimün" as const };
  const message = buildBrevoMessage(row, config, payment);
  assertEquals(message.to[0].email, base.volunteer_email);
  assert(message.htmlContent.includes("15.000"));
  assert(message.htmlContent.includes("Mi voluntariado"));
  assert(message.htmlContent.includes("Mis documentos"));
  assert(message.htmlContent.includes("mi-voluntariado.html?view=documents"));
  assert(message.htmlContent.includes("Entrar a mi panel"));
  assert(!message.htmlContent.includes(payment.reference));
  assertEquals(message.headers.idempotencyKey, base.idempotency_key);
  assertThrows(() => buildBrevoMessage(row, config), Error, "invalid_confirmed_payment");
});

Deno.test("la bienvenida tras activación dirige a Documentos y al panel", () => {
  const row = { ...base, notification_type: "membership_activated" as const };
  const message = buildBrevoMessage(row, config, payment);
  assertEquals(message.to[0].email, base.volunteer_email);
  assert(message.subject.includes("Bienvenida"));
  assert(message.htmlContent.includes("Gracias por acompañarnos en este camino"));
  assert(message.htmlContent.includes("protocolo"));
  assert(message.htmlContent.includes("credencial"));
  assert(message.htmlContent.includes("<strong>Mis documentos</strong>"));
  assert(message.htmlContent.includes("copia inicial de tu credencial sin fotografía"));
  assert(message.htmlContent.includes("view=profile"));
  assert(message.htmlContent.includes("assets/img/voluntariado/nana-bienvenida.png"));
  assert(message.htmlContent.includes("mi-voluntariado.html"));
  assert(message.htmlContent.includes("view=documents"));
  assert(message.htmlContent.includes("Entrar a mi panel"));
  assertThrows(() => buildBrevoMessage(row, config, { ...payment, endsAt: payment.startsAt }), Error, "invalid_confirmed_payment");
});

Deno.test("la credencial inicial adjunta es un PNG personalizado para los tres planes", async () => {
  const background = await Deno.readFile(new URL("../../../assets/img/voluntariado/credencial-voluntariado-fondo.png", import.meta.url));
  for (const plan_id of ["keyuwün", "kimün", "pülli"] as const) {
    const row = { ...base, notification_type: "membership_activated" as const, plan_id, first_name: "Ana María", last_name: "Pérez Ñancupil" };
    const attachment = await buildInitialCredentialAttachment(row, payment, background);
    assertEquals(attachment.name, "credencial-las-nanas-inicial.png");
    const png = Uint8Array.from(atob(attachment.content), (char) => char.charCodeAt(0));
    assertEquals([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert(png.length > 100_000 && png.length < 3_000_000);
    assertEquals(new DataView(png.buffer).getUint32(16), 1200);
    assertEquals(new DataView(png.buffer).getUint32(20), 751);
  }
  const longName = { ...base, notification_type: "membership_activated" as const, first_name: "W".repeat(60), last_name: "W".repeat(60) };
  assert((await buildInitialCredentialAttachment(longName, payment, background)).content.length > 100_000);
  await assertRejects(() => buildInitialCredentialAttachment(base, payment, background), Error, "invalid_credential_notification_type");
});

Deno.test("el aviso de pago a administración enlaza el expediente sin exponerlo a la voluntaria", () => {
  const row = { ...base, notification_type: "admin_payment_confirmed" as const, recipient_email: null };
  const message = buildBrevoMessage(row, config, payment);
  assertEquals(message.to[0].email, config.adminEmail);
  assert(message.htmlContent.includes(`coordinacion-voluntariado.html?application=${base.application_id}`));
  assertThrows(() => buildBrevoMessage({ ...row, recipient_email: base.volunteer_email }, config, payment), Error, "invalid_notification_recipient");
});

Deno.test("los nuevos avisos rechazan otro destinatario", () => {
  for (const notification_type of ["payment_confirmed", "membership_activated"] as const) {
    assertThrows(() => buildBrevoMessage({ ...base, notification_type, recipient_email: "other@example.test" }, config, payment), Error, "invalid_notification_recipient");
  }
});

Deno.test("el pago se vincula a la titular de la solicitud, no a un campo ausente de la cola", async () => {
  const ownerId = "50000000-0000-4000-8000-000000000005";
  const records: Record<string, Record<string, unknown>> = {
    membership_applications: { owner_id: ownerId, status: "approved" },
    payments: {
      id: payment.paymentId, owner_id: ownerId, application_id: base.application_id,
      amount: payment.amount, currency: payment.currency, provider_reference: payment.reference,
      confirmed_at: payment.confirmedAt, settled_amount: payment.settledAmount,
      settled_currency: payment.settledCurrency, source_currency: payment.sourceCurrency,
      transfer_route: payment.transferRoute,
    },
    memberships: {
      owner_id: ownerId, application_id: base.application_id, payment_id: payment.paymentId,
      active: true, starts_at: payment.startsAt, ends_at: payment.endsAt,
    },
  };
  const fakeClient = {
    from(table: string) {
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; },
        single() { return Promise.resolve({ data: records[table], error: null }); },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const row = { ...base, notification_type: "payment_confirmed" as const };
  assertEquals((await loadConfirmedPayment(fakeClient, row)).paymentId, payment.paymentId);
  records.membership_applications.owner_id = "60000000-0000-4000-8000-000000000006";
  await assertRejects(() => loadConfirmedPayment(fakeClient, row), Error, "confirmed_payment_unavailable");
  records.membership_applications.owner_id = ownerId;
  records.membership_applications.status = "submitted";
  await assertRejects(() => loadConfirmedPayment(fakeClient, row), Error, "confirmed_payment_unavailable");
  records.membership_applications.status = "approved";
  records.memberships.active = false;
  await assertRejects(() => loadConfirmedPayment(fakeClient, { ...row, notification_type: "membership_activated" }), Error, "active_membership_unavailable");
  records.memberships.active = true;
  records.memberships.starts_at = new Date(Date.now() - 60_000).toISOString();
  records.memberships.ends_at = new Date(Date.now() + 60_000).toISOString();
  assertEquals((await loadConfirmedPayment(fakeClient, { ...row, notification_type: "membership_activated" })).paymentId, payment.paymentId);
});

Deno.test("despacho inmediato exige token validado, rol admin vigente y solicitud concreta", async () => {
  let hasRole = true;
  const fakeClient = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "admin-id" } }, error: null }) },
    from(table: string) {
      assertEquals(table, "staff_roles");
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; },
        maybeSingle: () => Promise.resolve({ data: hasRole ? { user_id: "admin-id" } : null, error: null }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.signature";
  const makeRequest = (authorization = `Bearer ${token}`, body = { application_id: base.application_id }) =>
    new Request("https://example.test/functions/v1/send-volunteer-registration-notifications", {
      method: "POST", headers: { authorization }, body: JSON.stringify(body),
    });
  assertEquals(await authorizeAdminDispatch(fakeClient, makeRequest()), { applicationId: base.application_id });
  hasRole = false;
  await assertRejects(() => authorizeAdminDispatch(fakeClient, makeRequest()), Error, "admin_access_required");
  hasRole = true;
  await assertRejects(() => authorizeAdminDispatch(fakeClient, makeRequest("")), Error, "admin_auth_required");
  await assertRejects(() => authorizeAdminDispatch(fakeClient, makeRequest(`Bearer ${token}`, { application_id: "otro" })), Error, "invalid_application_id");
});

Deno.test("preflight del panel permite solo el origen público configurado", async () => {
  const values: Record<string, string> = {
    BREVO_API_KEY: "test-key", BREVO_SENDER_EMAIL: "sender@example.test",
    ADMIN_NOTIFICATION_EMAIL: "admin@example.test", PUBLIC_SITE_URL: "https://example.test/",
    SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-role-key",
    SUPABASE_SECRET_KEYS: "",
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, Deno.env.get(key)]));
  try {
    for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
    const request = (origin: string) => new Request("https://example.supabase.co/functions/v1/send-volunteer-registration-notifications", {
      method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" },
    });
    const allowed = await handler(request("https://example.test"));
    assertEquals(allowed.status, 204);
    assertEquals(allowed.headers.get("access-control-allow-origin"), "https://example.test");
    assert(allowed.headers.get("access-control-allow-headers")?.includes("authorization"));
    const blocked = await handler(request("https://other.test"));
    assertEquals(blocked.status, 403);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});

Deno.test("el aviso de documento enlaza el panel privado y conserva destinataria e idempotencia", () => {
  const row = { ...base, notification_type: "document_available" as const };
  const message = buildBrevoMessage(row, config);
  assertEquals(message.to[0].email, base.volunteer_email);
  assertEquals(message.headers.idempotencyKey, base.idempotency_key);
  assert(message.htmlContent.includes("mi-voluntariado.html?view=documents"));
  assert(message.textContent.includes("Mis documentos"));
  assertEquals(message.attachment, undefined);
  assert(!message.htmlContent.includes("storage/v1"));
  assertThrows(() => buildBrevoMessage({ ...row, recipient_email: "other@example.test" }, config), Error, "invalid_notification_recipient");
});

Deno.test("el worker exige autorización actual del documento antes de enviar el aviso", async () => {
  const row = { ...base, notification_type: "document_available" as const };
  const worker = "60000000-0000-4000-8000-000000000006";
  let allowed = true, failure = false;
  const client = {
    rpc(name: string, args: Record<string, string>) {
      assertEquals(name, "authorize_volunteer_document_notification");
      assertEquals(args, { p_notification_id: row.notification_id, p_worker: worker });
      return Promise.resolve({ data: allowed, error: failure ? { message: "unavailable" } : null });
    },
  } as unknown as SupabaseClient;
  await validateAvailableDocument(client, row, worker);
  allowed = false;
  await assertRejects(() => validateAvailableDocument(client, row, worker), Error, "invalid_document_notification");
  failure = true;
  await assertRejects(() => validateAvailableDocument(client, row, worker), Error, "document_notification_unavailable");
});

for (const specificDocument of [true, false]) {
  Deno.test(`despacho de documentos usa la cola y no repite un correo ya enviado (${specificDocument ? "documento" : "activación"})`, async () => {
    const documentId = "50000000-0000-4000-8000-000000000005";
    const row = { ...base, notification_type: "document_available" as const, application_status: "approved" as const };
    const values: Record<string, string> = {
      BREVO_API_KEY: "test-key", BREVO_SENDER_EMAIL: "sender@example.test",
      ADMIN_NOTIFICATION_EMAIL: "admin@example.test", PUBLIC_SITE_URL: "https://example.test/",
      SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-role-key",
      SUPABASE_SECRET_KEYS: "",
    };
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, Deno.env.get(key)]));
    const originalFetch = globalThis.fetch;
    const claims: Record<string, unknown>[] = [];
    const operations: string[] = [];
    let delivered = false, mailCount = 0;
    const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    try {
      for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
      globalThis.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (url.origin === "https://api.brevo.com") {
          assertEquals(url.pathname, "/v3/smtp/email");
          assertEquals(body.to[0].email, row.volunteer_email);
          assertEquals(body.headers.idempotencyKey, row.idempotency_key);
          mailCount++;
          return jsonResponse({ messageId: "test-document-mail" });
        }
        assertEquals(url.origin, "https://example.supabase.co");
        if (url.pathname === "/auth/v1/user") return jsonResponse({ id: "admin-id" });
        if (url.pathname === "/rest/v1/staff_roles") return jsonResponse([{ user_id: "admin-id" }]);
        const operation = url.pathname.replace("/rest/v1/rpc/", "");
        operations.push(operation);
        if (operation === "ensure_activation_notifications") return jsonResponse(0);
        if (operation === "claim_volunteer_notifications_for_application") return jsonResponse([]);
        if (operation === "claim_volunteer_document_notifications") {
          claims.push(body);
          return jsonResponse(delivered ? [] : [row]);
        }
        if (operation === "authorize_volunteer_document_notification") return jsonResponse(true);
        if (operation === "mark_volunteer_notification_sent") {
          delivered = true;
          return jsonResponse(null);
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      };
      const request = (id: string | null = documentId) => new Request("https://example.supabase.co/functions/v1/send-volunteer-registration-notifications", {
        method: "POST", headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.signature" },
        body: JSON.stringify({ application_id: base.application_id, ...(specificDocument ? { document_id: id } : {}) }),
      });
      const first = await handler(request());
      assertEquals(first.status, 200);
      assertEquals(await first.json(), { processed: 1, sent: 1, failed: 0 });
      const repeated = await handler(request());
      assertEquals(await repeated.json(), { processed: 0, sent: 0, failed: 0 });
      assertEquals(mailCount, 1);
      assertEquals(claims[0].p_application_id, base.application_id);
      assertEquals(claims[0].p_document_id, specificDocument ? documentId : null);
      assertEquals(claims[0].p_limit, specificDocument ? 1 : 10);
      assertEquals(operations.includes("ensure_activation_notifications"), !specificDocument);
      if (specificDocument) {
        assertEquals((await handler(request(null))).status, 400);
        assertEquals(mailCount, 1);
      }
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      }
    }
  });
}
