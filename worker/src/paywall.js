const COOKIE_NAME = "tgd_monitoring_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PENDING_TTL_SECONDS = 60 * 60 * 24;
const PRODUCT_KEY = "monitoring-desk";

const keys = {
  pending: (token) => `monitoring:pending:${token}`,
  session: (token) => `monitoring:session:${token}`,
  subscriber: (emailHash) => `monitoring:subscriber:${emailHash}`,
  subscription: (subscriptionId) => `monitoring:subscription:${subscriptionId}`,
  webhook: (eventId) => `monitoring:webhook:${eventId}`
};

export function monitoringCookieName() {
  return COOKIE_NAME;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

function redirect(location, headers = {}) {
  return new Response(null, { status: 303, headers: { location, ...headers } });
}

function cleanEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return hex(data);
}

async function sha256(value) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
}

async function hmacHex(secret, body, hash = "SHA-256") {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"]
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

function timingSafeEqual(a = "", b = "") {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function parseCookie(request) {
  const header = request.headers.get("cookie") || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1
          ? [part, ""]
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function sessionCookie(token) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

async function readFormOrJson(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return request.json().catch(() => ({}));
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await request.formData();
    return Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
  }
  return {};
}

function originFrom(request, env) {
  if (env.SITE_URL) return String(env.SITE_URL).replace(/\/+$/, "");
  const url = new URL(request.url);
  return url.origin;
}

function providerReady(env) {
  return Boolean(env.SAFEPAY_SECRET_KEY && env.SAFEPAY_PLAN_ID);
}

export async function getMonitoringSession(request, env) {
  const token = parseCookie(request)[COOKIE_NAME];
  if (!token || !env.INCIDENTS) return null;
  const session = await env.INCIDENTS.get(keys.session(token), "json");
  if (!session || !session.email_hash || Date.parse(session.expires_at || "") <= Date.now()) return null;
  const subscriber = await env.INCIDENTS.get(keys.subscriber(session.email_hash), "json");
  if (!isSubscriberActive(subscriber)) return null;
  return { ...session, subscriber };
}

export async function handleMonitoringMe(request, env) {
  const session = await getMonitoringSession(request, env);
  return json({ authenticated: Boolean(session), subscriber: session ? publicSubscriber(session.subscriber) : null });
}

export async function handleMonitoringLogout() {
  return redirect("/monitoring-access/?logged_out=1", { "set-cookie": clearSessionCookie() });
}

export async function handleMonitoringCheckout(request, env) {
  if (!providerReady(env)) {
    return json({ error: "Monitoring Desk checkout is not configured yet." }, 503);
  }

  const body = await readFormOrJson(request);
  const email = cleanEmail(body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Enter a valid email address." }, 400);
  }

  const origin = originFrom(request, env);
  const accessToken = randomToken();
  const emailHash = await sha256(email);
  const returnTo = String(body.return_to || "/monitoring/");
  const pending = {
    product: PRODUCT_KEY,
    email,
    email_hash: emailHash,
    return_to: returnTo.startsWith("/") ? returnTo : "/monitoring/",
    created_at: new Date().toISOString()
  };
  await env.INCIDENTS.put(keys.pending(accessToken), JSON.stringify(pending), { expirationTtl: PENDING_TTL_SECONDS });

  const returnUrl = `${origin}/api/monitoring/return?token=${encodeURIComponent(accessToken)}`;
  const cancelUrl = `${origin}/monitoring-access/?cancelled=1`;
  const checkout = await createSafepayCheckout(env, { returnUrl, cancelUrl });
  return redirect(checkout.url);
}

async function createSafepayCheckout(env, { returnUrl, cancelUrl }) {
  const environment = String(env.SAFEPAY_ENVIRONMENT || "sandbox").toLowerCase() === "production"
    ? "production"
    : "sandbox";
  const apiBase = String(
    env.SAFEPAY_API_BASE ||
      (environment === "production" ? "https://api.getsafepay.com" : "https://sandbox.api.getsafepay.com")
  ).replace(/\/+$/, "");
  const res = await fetch(`${apiBase}/client/passport/v1/token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-sfpy-merchant-secret": env.SAFEPAY_SECRET_KEY
    },
    body: "{}"
  });
  const data = await res.json().catch(() => ({}));
  const authToken = typeof data?.data === "string" ? data.data : "";
  if (!res.ok || !authToken) {
    const detail = data?.message || data?.status?.errors?.[0] || `HTTP ${res.status}`;
    throw new Error(`Safepay checkout token failed: ${detail}`);
  }

  const checkout = new URL(`${apiBase}/checkout/auth/login`);
  checkout.searchParams.set("plan_id", String(env.SAFEPAY_PLAN_ID));
  checkout.searchParams.set("auth_token", authToken);
  checkout.searchParams.set("env", environment);
  checkout.searchParams.set("redirect_url", returnUrl);
  checkout.searchParams.set("cancel_url", cancelUrl);
  return { url: checkout.toString() };
}

export async function handleMonitoringReturn(request, env) {
  const url = new URL(request.url);
  const accessToken = url.searchParams.get("token") || "";
  if (!accessToken) return redirect("/monitoring-access/?checkout=missing");

  const pending = await env.INCIDENTS.get(keys.pending(accessToken), "json");
  if (pending?.email_hash) {
    const subscriber = await env.INCIDENTS.get(keys.subscriber(pending.email_hash), "json");
    const pendingAt = Date.parse(pending.created_at || "");
    const eventAt = Date.parse(subscriber?.event_created_at || "");
    const receivedAt = Date.parse(subscriber?.event_received_at || "");
    const freshPayment =
      Number.isFinite(pendingAt) &&
      Number.isFinite(eventAt) &&
      Number.isFinite(receivedAt) &&
      eventAt >= pendingAt - 120000 &&
      receivedAt >= pendingAt;
    if (freshPayment && isSubscriberActive(subscriber)) {
      const sessionToken = await createSession(env, pending.email_hash);
      await env.INCIDENTS.delete(keys.pending(accessToken));
      return redirect(pending.return_to || "/monitoring/", { "set-cookie": sessionCookie(sessionToken) });
    }
  }

  return html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="4">
<title>Activating Monitoring Desk access</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fafaf7;color:#0d1b2a;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:560px;padding:32px;text-align:center}
a{color:#b91c2c}
</style>
</head>
<body>
<main>
<h1>Activating your Monitoring Desk access</h1>
<p>Safepay is confirming your subscription. This page will refresh automatically. If it does not open after a minute, return to the access page and contact the desk.</p>
<p><a href="/monitoring-access/">Return to Monitoring access</a></p>
</main>
</body>
</html>`);
}

async function createSession(env, emailHash) {
  const token = randomToken();
  const now = Date.now();
  await env.INCIDENTS.put(
    keys.session(token),
    JSON.stringify({
      email_hash: emailHash,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + SESSION_TTL_SECONDS * 1000).toISOString()
    }),
    { expirationTtl: SESSION_TTL_SECONDS }
  );
  return token;
}

export async function handleSafepayWebhook(request, env) {
  if (!env.SAFEPAY_WEBHOOK_SECRET) return json({ error: "Webhook secret is not configured." }, 500);
  const raw = await request.text();
  const sent = request.headers.get("x-sfpy-signature") || "";
  const expected = await hmacHex(env.SAFEPAY_WEBHOOK_SECRET, raw, "SHA-512");
  if (!timingSafeEqual(sent, expected)) return json({ error: "Invalid signature" }, 401);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const event = String(payload?.type || "").replaceAll("_", ".");
  if (!event.startsWith("subscription.")) return json({ ok: true, ignored: true });
  const attrs = payload?.data || {};
  const planId = String(attrs.plan_id || "");
  if (!planId || planId !== String(env.SAFEPAY_PLAN_ID)) return json({ ok: true, ignored: true });

  const eventId = String(payload?.token || "");
  if (eventId && await env.INCIDENTS.get(keys.webhook(eventId))) {
    return json({ ok: true, duplicate: true });
  }

  const subscriptionId = String(attrs.id || attrs.subscription_id || "");
  const email = cleanEmail(attrs.customer_email || attrs.email || "");
  const emailHash = email ? await sha256(email) : "";
  if (!emailHash || !subscriptionId) return json({ ok: true, ignored: true });
  const eventReceivedAt = new Date().toISOString();
  const eventCreatedAt = safepayTimestamp(payload.created_at) || eventReceivedAt;

  const subscriber = {
    product: PRODUCT_KEY,
    email,
    email_hash: emailHash,
    subscription_id: subscriptionId,
    plan_id: planId,
    transaction_id: attrs.transaction_id ? String(attrs.transaction_id) : "",
    status: attrs.status || event,
    active: isSafepaySubscriptionActive(event, attrs.status),
    renews_at: safepayTimestamp(attrs.current_period_end_date),
    ends_at: safepayTimestamp(attrs.ended_at || attrs.canceled_at || attrs.cancelled_at),
    event_created_at: eventCreatedAt,
    event_received_at: eventReceivedAt,
    updated_at: safepayTimestamp(attrs.updated_at) || eventReceivedAt,
    last_event: event
  };

  await env.INCIDENTS.put(keys.subscriber(emailHash), JSON.stringify(subscriber));
  if (subscriptionId) await env.INCIDENTS.put(keys.subscription(subscriptionId), emailHash);
  if (eventId) {
    await env.INCIDENTS.put(keys.webhook(eventId), eventReceivedAt, { expirationTtl: 60 * 60 * 24 * 7 });
  }

  return json({ ok: true });
}

function safepayTimestamp(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : "";
  }
  const seconds = Number(value.seconds);
  if (!Number.isFinite(seconds)) return "";
  const nanos = Number(value.nanos || 0);
  return new Date(seconds * 1000 + Math.floor(nanos / 1000000)).toISOString();
}

function isSafepaySubscriptionActive(event, status) {
  const normalizedEvent = String(event || "").replaceAll("_", ".").toLowerCase();
  const normalizedStatus = String(status || "").toLowerCase();
  if (["subscription.payment.failed", "subscription.canceled", "subscription.cancelled", "subscription.ended", "subscription.paused"].includes(normalizedEvent)) {
    return false;
  }
  return normalizedStatus === "active" || normalizedStatus === "trialing";
}

function isSubscriberActive(subscriber) {
  if (!subscriber) return false;
  return subscriber.active === true;
}

function publicSubscriber(subscriber) {
  return {
    email: subscriber.email || "",
    status: subscriber.status || "",
    renews_at: subscriber.renews_at || "",
    ends_at: subscriber.ends_at || ""
  };
}
