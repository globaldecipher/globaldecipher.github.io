const DEFAULT_SITE_URL = "https://theglobaldecipher.com";
const DEFAULT_JSON_LIMIT = 1024 * 1024;

export function baseSecurityHeaders(extra = {}) {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "cross-origin-opener-policy": "same-origin",
    "x-permitted-cross-domain-policies": "none",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "cache-control": "no-store",
    ...extra
  };
}

export function clientIdentifier(request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

export async function rateLimit(env, binding, key) {
  const limiter = env?.[binding];
  if (!limiter?.limit) return true;
  try {
    const result = await limiter.limit({ key: String(key || "unknown") });
    return result?.success === true;
  } catch (error) {
    console.error(JSON.stringify({
      message: "rate limiter unavailable",
      binding,
      error: error?.message || String(error)
    }));
    return true;
  }
}

export async function timingSafeSecretEqual(provided = "", expected = "") {
  if (!expected) return false;
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(provided))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(expected)))
  ]);
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
  }
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function readTextLimited(request, maxBytes = DEFAULT_JSON_LIMIT) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    const error = new Error("Request body is too large.");
    error.status = 413;
    throw error;
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel("Request body is too large.");
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function readJsonLimited(request, maxBytes = DEFAULT_JSON_LIMIT) {
  const text = await readTextLimited(request, maxBytes);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Invalid JSON.");
    error.status = 400;
    throw error;
  }
}

export function allowedAskOrigin(request, env) {
  const configured = String(env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
  const origin = request.headers.get("origin");
  const allowed = !origin
    || origin === configured
    || origin === "https://www.theglobaldecipher.com"
    || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    allowed,
    headers: baseSecurityHeaders({
      ...(allowed && origin ? { "access-control-allow-origin": origin } : {}),
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      "vary": "Origin"
    })
  };
}
