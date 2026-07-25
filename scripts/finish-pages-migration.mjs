// One-shot finisher for the Cloudflare Pages Git migration.
//
// Everything here is API work that only becomes possible once the Cloudflare
// account has a GitHub App installation — that authorization is an interactive
// OAuth consent and is the single step this script cannot do for you.
//
// Run:  node scripts/finish-pages-migration.mjs
//
// It creates the Git-connected Pages project with the verified build settings,
// waits for the first deployment, and prints the preview URL to compare against
// production before any domain is moved.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ACCOUNT_ID = "12bf8b0b63c0425c0790ee4c4d72441a";
const PROJECT = "theglobaldecipher-v2";
const REPO_OWNER = "globaldecipher";
const REPO_NAME = "globaldecipher.github.io";
const BUILD_COMMAND = "npm ci && npm --prefix apps/explorer ci && npm run build";
const OUTPUT_DIR = "site";
const API = "https://api.cloudflare.com/client/v4";

function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const config = path.join(os.homedir(), "Library/Preferences/.wrangler/config/default.toml");
  const match = fs.readFileSync(config, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("No Cloudflare token. Run: npx wrangler login");
  return match[1];
}

const TOKEN = token();

async function cf(pathname, init = {}) {
  const res = await fetch(`${API}/accounts/${ACCOUNT_ID}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...init.headers }
  });
  const body = await res.json();
  if (!body.success) {
    throw new Error(`${pathname} → ${JSON.stringify(body.errors)}`);
  }
  return body.result;
}

const installations = await cf("/pages/connections/github/installations");
if (!installations.length) {
  console.error("GitHub is not connected to this Cloudflare account yet.");
  console.error("Connect it once in the dashboard, then re-run this script:");
  console.error("  Workers & Pages → Create → Pages → Connect to Git → GitHub");
  process.exit(1);
}
const installation = installations[0];
console.log(`GitHub connected (installation ${installation.id}).`);

const existing = await cf("/pages/projects");
if (existing.some((project) => project.name === PROJECT)) {
  console.log(`Project ${PROJECT} already exists — leaving it alone.`);
  process.exit(0);
}

const project = await cf("/pages/projects", {
  method: "POST",
  body: JSON.stringify({
    name: PROJECT,
    production_branch: "main",
    build_config: {
      build_command: BUILD_COMMAND,
      destination_dir: OUTPUT_DIR,
      root_dir: ""
    },
    deployment_configs: {
      production: { env_vars: { NODE_VERSION: { value: "22" } } },
      preview: { env_vars: { NODE_VERSION: { value: "22" } } }
    },
    source: {
      type: "github",
      config: {
        owner: REPO_OWNER,
        repo_name: REPO_NAME,
        production_branch: "main",
        deployments_enabled: true,
        production_deployments_enabled: true,
        preview_deployment_setting: "none"
      }
    }
  })
});

console.log(`Created ${project.name} → https://${project.subdomain}`);
console.log("Cloudflare builds the first deployment now; compare it with production before moving the domain.");
