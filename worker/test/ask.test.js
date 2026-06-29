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
    GEMINI_MODEL: "gemini-3.5-flash",
    GEMINI_FALLBACK_MODEL: "gemini-2.5-flash",
    GEMINI_RETRY_DELAY_MS: "1",
    SITE_URL: "https://theglobaldecipher.com"
  };
}

function geminiResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("uses Gemini 3.5 Flash when the primary request succeeds", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return geminiResponse(200, {
      candidates: [{ content: { parts: [{ text: "Primary answer [src-ttp-1]." }] } }]
    });
  };

  const response = await askDatabase(request(), env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.model, "gemini-3.5-flash");
  assert.equal(body.fallback, false);
  assert.match(body.answer, /Primary answer/);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /gemini-3\.5-flash/);
});

test("retries Gemini 3.5 Flash then falls back to Gemini 2.5 Flash on 503", async () => {
  const calls = [];
  const responses = [
    geminiResponse(503, { error: { status: "UNAVAILABLE", message: "No capacity" } }),
    geminiResponse(503, { error: { status: "UNAVAILABLE", message: "No capacity" } }),
    geminiResponse(200, {
      candidates: [{ content: { parts: [{ text: "Fallback answer [src-ttp-1]." }] } }]
    })
  ];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return responses.shift();
  };

  const response = await askDatabase(request(), env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.model, "gemini-2.5-flash");
  assert.equal(body.fallback, true);
  assert.match(body.answer, /Fallback answer/);
  assert.equal(calls.length, 3);
  assert.match(calls[0], /gemini-3\.5-flash/);
  assert.match(calls[1], /gemini-3\.5-flash/);
  assert.match(calls[2], /gemini-2\.5-flash/);
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
