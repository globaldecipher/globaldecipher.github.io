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

test("normalizes the latest GitHub deployment for the admin", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    workflow_runs: [{
      id: 42,
      status: "completed",
      conclusion: "success",
      event: "workflow_dispatch",
      display_title: "Deploy website",
      html_url: "https://github.com/example/actions/runs/42",
      run_started_at: "2026-06-30T12:00:00Z",
      updated_at: "2026-06-30T12:01:00Z",
      head_sha: "abc123"
    }]
  }), {
    headers: { "content-type": "application/json" }
  });

  const result = await latestDeployment({
    GITHUB_TOKEN: "test",
    GITHUB_REPO: "globaldecipher/globaldecipher.github.io",
    GITHUB_BRANCH: "main"
  });

  assert.equal(result.available, true);
  assert.equal(result.run.conclusion, "success");
  assert.equal(result.run.url, "https://github.com/example/actions/runs/42");
});
