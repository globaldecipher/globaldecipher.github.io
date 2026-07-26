import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteFile, latestDeployment, putFile } from "../src/content.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function staleEnv() {
  return {
    CONTENT_DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              async first() {
                if (sql.includes("SELECT id")) {
                  return { id: 1, updated_at: "new-version", published_at: null };
                }
                return { updated_at: "new-version" };
              }
            };
          }
        };
      }
    }
  };
}

test("rejects an article save when another editor has a newer version", async () => {
  await assert.rejects(
    putFile(
      staleEnv(),
      "content/news/example.md",
      "---\ntitle: \"Example\"\nstatus: \"draft\"\n---\n\nBody",
      "old-version"
    ),
    (error) => error.status === 409 && /changed after you opened/i.test(error.message)
  );
});

test("rejects a delete when another editor has a newer version", async () => {
  await assert.rejects(
    deleteFile(staleEnv(), "content/news/example.md", "old-version"),
    (error) => error.status === 409 && /changed after you opened/i.test(error.message)
  );
});

test("normalizes the latest Cloudflare Pages deployment for the admin", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    result: [{
      id: "dep-42",
      url: "https://theglobaldecipher.pages.dev",
      created_on: "2026-06-30T12:00:00Z",
      modified_on: "2026-06-30T12:01:00Z",
      latest_stage: { name: "deploy", status: "success", ended_on: "2026-06-30T12:01:00Z" },
      deployment_trigger: { metadata: { commit_message: "Deploy website\n\nbody", commit_hash: "abc123" } }
    }]
  }), {
    headers: { "content-type": "application/json" }
  });

  const result = await latestDeployment({
    CF_API_TOKEN: "test",
    CF_ACCOUNT_ID: "account",
    CF_PAGES_PROJECT: "theglobaldecipher"
  });

  assert.equal(result.available, true);
  assert.equal(result.run.conclusion, "success");
  assert.equal(result.run.url, "https://theglobaldecipher.pages.dev");
});
