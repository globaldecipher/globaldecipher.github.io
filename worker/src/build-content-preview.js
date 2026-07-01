// CI-only content reader. Wrangler exposes this Worker on a loopback port
// during the Pages build while its D1 binding connects directly to Cloudflare.
// It avoids routing build traffic through the public hostname and its WAF.
import { dumpCollection } from "./content.js";

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), { headers });
    }
    if (request.method !== "GET" || url.pathname !== "/api/content/dump") {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers });
    }
    try {
      const folder = url.searchParams.get("folder") || "";
      return new Response(JSON.stringify({ items: await dumpCollection(env, folder) }), { headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400, headers });
    }
  }
};
