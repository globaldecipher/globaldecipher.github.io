import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";
import { safeMediaHeaders } from "../src/media.js";
import {
  allowedAskOrigin,
  baseSecurityHeaders,
  readJsonLimited,
  timingSafeSecretEqual
} from "../src/security.js";

const context = { waitUntil() {} };

test("compares secrets safely and fails closed when a secret is absent", async () => {
  assert.equal(await timingSafeSecretEqual("correct", "correct"), true);
  assert.equal(await timingSafeSecretEqual("incorrect", "correct"), false);
  assert.equal(await timingSafeSecretEqual("", ""), false);
});

test("rejects oversized and malformed JSON bodies", async () => {
  await assert.rejects(
    readJsonLimited(new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "20" },
      body: "{}"
    }), 10),
    (error) => error.status === 413
  );
  await assert.rejects(
    readJsonLimited(new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{broken"
    }), 100),
    (error) => error.status === 400
  );
});

test("security headers deny framing and sensitive browser capabilities", () => {
  const headers = baseSecurityHeaders();
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.match(headers["permissions-policy"], /camera=\(\)/);
});

test("the public assistant does not grant cross-origin access to unknown sites", () => {
  const request = new Request("https://theglobaldecipher.com/api/ask", {
    headers: { origin: "https://attacker.example" }
  });
  const result = allowedAskOrigin(request, { SITE_URL: "https://theglobaldecipher.com" });
  assert.equal(result.allowed, false);
  assert.equal(result.headers["access-control-allow-origin"], undefined);
});

test("legacy admin routes stay closed while the protected namespace authenticates", async () => {
  const env = { ADMIN_TOKEN: "correct-secret" };
  const oldRoute = await worker.fetch(
    new Request("https://theglobaldecipher.com/api/content?folder=news"),
    env,
    context
  );
  assert.equal(oldRoute.status, 404);

  const unauthorized = await worker.fetch(
    new Request("https://theglobaldecipher.com/api/admin/ping"),
    env,
    context
  );
  assert.equal(unauthorized.status, 401);

  const authorized = await worker.fetch(
    new Request("https://theglobaldecipher.com/api/admin/ping", {
      headers: { authorization: "Bearer correct-secret" }
    }),
    env,
    context
  );
  assert.equal(authorized.status, 200);
});

test("media headers force active or unknown uploads to download", () => {
  const unsafe = safeMediaHeaders({
    httpMetadata: { contentType: "image/svg+xml" },
    customMetadata: { originalName: "payload.svg" }
  }, "uploads/2026/07/payload.svg");
  assert.equal(unsafe["content-type"], "application/octet-stream");
  assert.match(unsafe["content-disposition"], /^attachment/);

  const chart = safeMediaHeaders({
    httpMetadata: { contentType: "image/svg+xml" }
  }, "generated/monthly/chart.svg");
  assert.equal(chart["content-type"], "image/svg+xml");
  assert.equal(chart["content-disposition"], "inline");
});
