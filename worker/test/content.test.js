import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteFile, getFile, latestDeployment, putFile } from "../src/content.js";
import { loadFeed, saveFeed } from "../src/feed.js";

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

// A published row plus a recorder for every statement the store runs, so a test
// can assert what an autosave did and — more importantly — did not touch.
function publishedEnv(row = {}) {
  const statements = [];
  const live = {
    id: 7,
    collection: "news",
    slug: "example",
    title: "Live headline",
    status: "published",
    published_at: "2026-07-01T00:00:00.000Z",
    updated_at: "live-version",
    body: "Published body",
    tags: "[]",
    draft_content: null,
    draft_saved_at: null,
    ...row
  };
  return {
    statements,
    CONTENT_DB: {
      prepare(sql) {
        return {
          bind(...args) {
            statements.push({ sql, args });
            return {
              async first() { return live; },
              async run() { return { meta: { changes: 1 } }; }
            };
          }
        };
      }
    }
  };
}

test("autosaving a published article parks the draft and leaves the live row alone", async () => {
  const env = publishedEnv();
  const result = await putFile(
    env,
    "content/news/example.md",
    "---\ntitle: \"Half-written edit\"\nstatus: \"draft\"\n---\n\nWork in progress",
    "live-version",
    { autosave: true }
  );

  assert.equal(result.parked, true);
  // The sha must not move, or the editor's next save would fail the conflict check.
  assert.equal(result.sha, "live-version");
  const writes = env.statements.filter((s) => /UPDATE content SET/.test(s.sql));
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /draft_content = \?/);
  assert.doesNotMatch(writes[0].sql, /status = \?/);
});

test("autosave cannot promote a draft to published", async () => {
  const env = publishedEnv({ status: "draft", published_at: null });
  await putFile(
    env,
    "content/news/example.md",
    "---\ntitle: \"Not ready\"\nstatus: \"published\"\n---\n\nBody",
    "live-version",
    { autosave: true }
  );

  const write = env.statements.find((s) => /UPDATE content SET\s+type = \?/.test(s.sql));
  assert.ok(write, "expected a normal row update for a draft");
  // status is the 12th bound column in the update statement.
  assert.equal(write.args[11], "draft");
});

test("a deliberate save clears any parked draft", async () => {
  const env = publishedEnv();
  await putFile(
    env,
    "content/news/example.md",
    "---\ntitle: \"Final\"\nstatus: \"published\"\n---\n\nFinished body",
    "live-version"
  );

  assert.ok(env.statements.some((s) => /UPDATE content SET\s+type = \?/.test(s.sql)));
  assert.ok(env.statements.some((s) => /draft_content = NULL/.test(s.sql)));
});

test("an ordinary save still succeeds before migration 0007 is applied", async () => {
  const env = publishedEnv();
  const base = env.CONTENT_DB.prepare.bind(env.CONTENT_DB);
  env.CONTENT_DB.prepare = (sql) => {
    if (/draft_content = NULL/.test(sql)) {
      return { bind: () => ({ async run() { throw new Error("D1_ERROR: no such column: draft_content"); } }) };
    }
    return base(sql);
  };

  const result = await putFile(
    env,
    "content/news/example.md",
    "---\ntitle: \"Final\"\nstatus: \"published\"\n---\n\nFinished body",
    "live-version"
  );
  assert.ok(result.sha);
});

test("autosave refuses rather than unpublishing when migration 0007 is missing", async () => {
  const env = publishedEnv();
  env.CONTENT_DB.prepare = (sql) => {
    if (/draft_content = \?/.test(sql)) {
      return { bind: () => ({ async run() { throw new Error("D1_ERROR: no such column: draft_content"); } }) };
    }
    return {
      bind: () => ({
        async first() { return { id: 7, updated_at: "live-version", published_at: null, status: "published" }; },
        async run() { throw new Error("the live row must not be written"); }
      })
    };
  };

  await assert.rejects(
    putFile(env, "content/news/example.md", "---\ntitle: \"WIP\"\nstatus: \"draft\"\n---\n\nWIP", "live-version", { autosave: true }),
    /migration 0007/
  );
});

test("opening an article surfaces parked work without applying it", async () => {
  const env = publishedEnv({
    draft_content: "---\ntitle: \"Recovered\"\n---\n\nRecovered body",
    draft_saved_at: "2026-07-02T09:00:00.000Z"
  });
  const got = await getFile(env, "content/news/example.md");

  assert.match(got.content, /Published body/);
  assert.equal(got.draft.savedAt, "2026-07-02T09:00:00.000Z");
  assert.match(got.draft.content, /Recovered body/);
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

test("an unreadable stored feed is reported instead of silently emptied", async () => {
  const env = { INCIDENTS: { async get() { return "{not json"; }, async put() { throw new Error("must not write"); } } };
  await assert.rejects(loadFeed(env), /could not be read/);
});

test("a missing feed key still starts an empty feed", async () => {
  const env = { INCIDENTS: { async get() { return null; } } };
  const feed = await loadFeed(env);
  assert.deepEqual(feed.incidents, []);
});

test("saving refuses a feed that would exceed the KV value limit", async () => {
  const env = { INCIDENTS: { async put() { throw new Error("must not write"); } } };
  const feed = { incidents: [{ id: "x", summary: "y".repeat(25 * 1024 * 1024) }] };
  await assert.rejects(saveFeed(env, feed), /25 MB limit/);
});
