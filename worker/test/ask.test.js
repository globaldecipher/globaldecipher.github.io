import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { askDatabase } from "../src/ask.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function request() {
  return new Request("https://theglobaldecipher.com/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      question: "What is TTP?",
      entityId: "ttp",
      context: {
        entities: [{
          id: "ttp",
          name: "Tehrik-e-Taliban Pakistan",
          summary: "A TGD profile summary.",
          sources: [{ id: "src-ttp-1", title: "TGD source" }]
        }]
      },
      history: []
    })
  });
}

function env() {
  return {
    GEMINI_API_KEY: "test-key",
    GEMINI_MODEL: "gemini-3.1-flash-lite",
    GEMINI_FALLBACK_MODEL: "gemini-2.5-flash",
    GEMINI_REQUEST_TIMEOUT_MS: "50",
    ASK_TOTAL_TIMEOUT_MS: "500",
    SITE_URL: "https://theglobaldecipher.com"
  };
}

function geminiResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("uses Gemini 3.1 Flash-Lite with low thinking when the primary request succeeds", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return geminiResponse(200, {
      candidates: [{ content: { parts: [{ text: "Primary answer [src-ttp-1]." }] } }]
    });
  };

  const response = await askDatabase(request(), env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.model, "gemini-3.1-flash-lite");
  assert.equal(body.fallback, false);
  assert.match(body.answer, /Primary answer/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /gemini-3\.1-flash-lite/);
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, "low");
  assert.equal(calls[0].body.generationConfig.maxOutputTokens, 600);
});

test("falls back immediately on quota errors without retrying the primary model", async () => {
  const calls = [];
  const responses = [
    geminiResponse(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exhausted" } }),
    geminiResponse(200, {
      candidates: [{ content: { parts: [{ text: "Fallback answer [src-ttp-1]." }] } }]
    })
  ];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return responses.shift();
  };

  const response = await askDatabase(request(), env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.model, "gemini-2.5-flash");
  assert.equal(body.fallback, true);
  assert.match(body.answer, /Fallback answer/);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /gemini-3\.1-flash-lite/);
  assert.match(calls[1].url, /gemini-2\.5-flash/);
  assert.equal(calls[1].body.generationConfig.thinkingConfig, undefined);
});

test("does not retry or fall back when Google rejects the API key", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return geminiResponse(403, {
      error: { status: "PERMISSION_DENIED", message: "API key not valid." }
    });
  };

  const response = await askDatabase(request(), env());
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.error, "The research assistant is temporarily unavailable.");
  assert.equal(calls, 1);
});

test("aborts a slow primary call and uses the fallback within the total deadline", async () => {
  const calls = [];
  const testEnv = {
    ...env(),
    GEMINI_REQUEST_TIMEOUT_MS: "10",
    ASK_TOTAL_TIMEOUT_MS: "500"
  };
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("gemini-3.1-flash-lite")) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
    return geminiResponse(200, {
      candidates: [{ content: { parts: [{ text: "Fast fallback [src-ttp-1]." }] } }]
    });
  };

  const started = Date.now();
  const response = await askDatabase(request(), testEnv);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.model, "gemini-2.5-flash");
  assert.equal(body.fallback, true);
  assert.deepEqual(calls.map((url) => new URL(url).pathname.split("/").pop()), [
    "gemini-3.1-flash-lite:generateContent",
    "gemini-2.5-flash:generateContent"
  ]);
  assert.ok(Date.now() - started < 100);
});

test("returns a timeout error when the total model deadline is exhausted", async () => {
  const testEnv = {
    ...env(),
    GEMINI_REQUEST_TIMEOUT_MS: "10",
    ASK_TOTAL_TIMEOUT_MS: "18"
  };
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });

  const started = Date.now();
  const response = await askDatabase(request(), testEnv);
  const body = await response.json();

  assert.equal(response.status, 504);
  assert.match(body.error, /15-second limit/);
  assert.ok(Date.now() - started < 80);
});
