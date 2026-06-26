const COOKIE_NAME = "tgd_monitoring_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PENDING_TTL_SECONDS = 60 * 60 * 24;
const PRODUCT_KEY = "monitoring-desk";

const keys = {
  pending: (token) => `monitoring:pending:${token}`,
  session: (token) => `monitoring:session:${token}`,
  subscriber: (emailHash) => `monitoring:subscriber:${emailHash}`,
  subscription: (subscriptionId) => `monitoring:subscription:${subscriptionId}`,
  accessToken: (token) => `monitoring:access-token:${token}`
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

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
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
  return Boolean(env.LEMONSQUEEZY_API_KEY && env.LEMONSQUEEZY_STORE_ID && env.LEMONSQUEEZY_VARIANT_ID);
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
    access_token: accessToken,
    return_to: returnTo.startsWith("/") ? returnTo : "/monitoring/",
    paid: false,
    created_at: new Date().toISOString()
  };
  await env.INCIDENTS.put(keys.pending(accessToken), JSON.stringify(pending), { expirationTtl: PENDING_TTL_SECONDS });

  const returnUrl = `${origin}/api/monitoring/return?token=${encodeURIComponent(accessToken)}`;
  const checkout = await createLemonCheckout(env, {
    email,
    accessToken,
    emailHash,
    returnUrl
  });
  return redirect(checkout.url);
}

async function createLemonCheckout(env, { email, accessToken, emailHash, returnUrl }) {
  const payload = {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          email,
          custom: {
            product: PRODUCT_KEY,
            access_token: accessToken,
            email_hash: emailHash
          }
        },
        checkout_options: {
          embed: false
        },
        product_options: {
          name: "TGD Monitoring Desk",
          description: "Monthly subscriber access to The Global Decipher Monitoring Desk.",
          redirect_url: returnUrl,
          receipt_button_text: "Open Monitoring Desk",
          receipt_link_url: returnUrl
        }
      },
      relationships: {
        store: { data: { type: "stores", id: String(env.LEMONSQUEEZY_STORE_ID) } },
        variant: { data: { type: "variants", id: String(env.LEMONSQUEEZY_VARIANT_ID) } }
      }
    }
  };

  const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
    method: "POST",
    headers: {
      accept: "application/vnd.api+json",
      "content-type": "application/vnd.api+json",
      authorization: `Bearer ${env.LEMONSQUEEZY_API_KEY}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  const url = data?.data?.attributes?.url;
  if (!res.ok || !url) {
    throw new Error(data?.errors?.[0]?.detail || `Lemon Squeezy checkout failed: HTTP ${res.status}`);
  }
  return { url };
}

export async function handleMonitoringReturn(request, env) {
  const url = new URL(request.url);
  const accessToken = url.searchParams.get("token") || "";
  if (!accessToken) return redirect("/monitoring-access/?checkout=missing");

  const emailHash = await env.INCIDENTS.get(keys.accessToken(accessToken));
  if (emailHash) {
    const subscriber = await env.INCIDENTS.get(keys.subscriber(emailHash), "json");
    if (isSubscriberActive(subscriber)) {
      const sessionToken = await createSession(env, emailHash);
      return redirect("/monitoring/", { "set-cookie": sessionCookie(sessionToken) });
    }
  }

  const pending = await env.INCIDENTS.get(keys.pending(accessToken), "json");
  if (pending?.paid && pending.email_hash) {
    const subscriber = await env.INCIDENTS.get(keys.subscriber(pending.email_hash), "json");
    if (isSubscriberActive(subscriber)) {
      const sessionToken = await createSession(env, pending.email_hash);
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
<p>Payment is being confirmed. This page will refresh automatically. If it does not open after a minute, use the receipt link from Lemon Squeezy or contact the desk.</p>
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

export async function handleLemonWebhook(request, env, ctx) {
  if (!env.LEMONSQUEEZY_WEBHOOK_SECRET) return json({ error: "Webhook secret is not configured." }, 500);
  const raw = await request.text();
  const sent = request.headers.get("x-signature") || request.headers.get("X-Signature") || "";
  const expected = await hmacHex(env.LEMONSQUEEZY_WEBHOOK_SECRET, raw);
  if (!timingSafeEqual(sent, expected)) return json({ error: "Invalid signature" }, 401);

  const payload = JSON.parse(raw);
  const event = payload?.meta?.event_name || "";
  const custom = payload?.meta?.custom_data || payload?.data?.attributes?.custom_data || {};
  if (custom.product && custom.product !== PRODUCT_KEY) return json({ ok: true, ignored: true });

  const attrs = payload?.data?.attributes || {};
  const subscriptionId = String(payload?.data?.id || attrs.subscription_id || attrs.first_subscription_item?.subscription_id || "");
  let email = cleanEmail(attrs.user_email || attrs.customer_email || attrs.email || custom.email || "");
  let emailHash = custom.email_hash || (email ? await sha256(email) : "");
  if (!emailHash && subscriptionId) emailHash = (await env.INCIDENTS.get(keys.subscription(subscriptionId))) || "";
  const existing = emailHash ? await env.INCIDENTS.get(keys.subscriber(emailHash), "json") : null;
  if (!email && existing?.email) email = existing.email;
  const accessToken = custom.access_token || existing?.access_token || "";
  if (!emailHash) return json({ ok: true, ignored: true });

  const subscriber = {
    product: PRODUCT_KEY,
    email,
    email_hash: emailHash,
    subscription_id: subscriptionId,
    customer_id: attrs.customer_id ? String(attrs.customer_id) : "",
    order_id: attrs.order_id ? String(attrs.order_id) : "",
    status: attrs.status || event,
    active: isActiveStatus(attrs),
    renews_at: attrs.renews_at || "",
    ends_at: attrs.ends_at || "",
    trial_ends_at: attrs.trial_ends_at || "",
    access_token: accessToken,
    updated_at: new Date().toISOString(),
    last_event: event
  };

  await env.INCIDENTS.put(keys.subscriber(emailHash), JSON.stringify(subscriber));
  if (subscriptionId) await env.INCIDENTS.put(keys.subscription(subscriptionId), emailHash);
  if (accessToken) {
    await env.INCIDENTS.put(keys.accessToken(accessToken), emailHash);
    const pending = await env.INCIDENTS.get(keys.pending(accessToken), "json");
    if (pending) {
      pending.paid = subscriber.active;
      pending.subscription_id = subscriptionId;
      pending.status = subscriber.status;
      pending.updated_at = subscriber.updated_at;
      await env.INCIDENTS.put(keys.pending(accessToken), JSON.stringify(pending), { expirationTtl: PENDING_TTL_SECONDS });
    }
  }

  ctx.waitUntil?.(expireSessionsForInactiveSubscriber(env, subscriber));
  return json({ ok: true });
}

function isActiveStatus(attrs = {}) {
  const status = String(attrs.status || "").toLowerCase();
  if (status === "active" || status === "on_trial") return true;
  if (status === "cancelled" && Date.parse(attrs.ends_at || "") > Date.now()) return true;
  return false;
}

function isSubscriberActive(subscriber) {
  if (!subscriber) return false;
  if (subscriber.active === true) return true;
  return isActiveStatus(subscriber);
}

function publicSubscriber(subscriber) {
  return {
    email: subscriber.email || "",
    status: subscriber.status || "",
    renews_at: subscriber.renews_at || "",
    ends_at: subscriber.ends_at || ""
  };
}

async function expireSessionsForInactiveSubscriber(env, subscriber) {
  if (isSubscriberActive(subscriber)) return;
  // KV cannot list by value efficiently; short-lived sessions will expire on
  // their own. We still remove the reusable receipt/access token immediately.
  if (subscriber.access_token) await env.INCIDENTS.delete(keys.accessToken(subscriber.access_token));
}
