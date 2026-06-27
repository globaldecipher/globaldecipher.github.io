import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

const ROOT = process.cwd();
const WORKER_DIR = path.join(ROOT, "worker");
const WRANGLER_TOML = path.join(WORKER_DIR, "wrangler.toml");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function ask(label, { required = true, defaultValue = "" } = {}) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  while (true) {
    const value = (await rl.question(`${label}${suffix}: `)).trim() || defaultValue;
    if (value || !required) return value;
    console.log("This value is required.");
  }
}

async function askSecret(label, options = {}) {
  // Keep this simple and avoid echo suppression quirks across terminals. The
  // value is sent directly to wrangler/gh and is not written to project files.
  return ask(label, options);
}

function run(command, args, { cwd = ROOT, input = "" } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function setWranglerVar(name, value) {
  let text = fs.readFileSync(WRANGLER_TOML, "utf8");
  const line = `${name} = ${JSON.stringify(value)}`;
  const re = new RegExp(`^${name}\\s*=.*$`, "m");
  if (re.test(text)) text = text.replace(re, line);
  else text = text.replace(/\[vars\]\n/, `[vars]\n${line}\n`);
  fs.writeFileSync(WRANGLER_TOML, text);
}

function putWorkerSecret(name, value) {
  console.log(`Setting Worker secret ${name}...`);
  run("npx", ["--yes", "wrangler@4", "secret", "put", name], {
    cwd: WORKER_DIR,
    input: `${value}\n`
  });
}

function maybeSetGitHubSecret(name, value) {
  const gh = spawnSync("gh", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (gh.status !== 0) {
    console.log("GitHub CLI is not available. Add CONTENT_DUMP_TOKEN manually in GitHub Actions secrets.");
    return;
  }
  console.log(`Setting GitHub Actions secret ${name}...`);
  run("gh", ["secret", "set", name, "--body", value], { cwd: ROOT });
}

try {
  console.log("TGD Monitoring Desk paywall setup");
  console.log("Only /monitoring/ is paid. Do not paste bank details here.");

  section("Safepay plan");
  const planId = await ask("Safepay plan ID", {
    defaultValue: "plan_06e4e6c9-c108-456e-a746-777036fc7553"
  });
  const environment = await ask("Safepay environment: sandbox or production", {
    defaultValue: "sandbox"
  });
  const normalizedEnvironment = environment.toLowerCase() === "production" ? "production" : "sandbox";
  setWranglerVar("SAFEPAY_PLAN_ID", planId);
  setWranglerVar("SAFEPAY_ENVIRONMENT", normalizedEnvironment);
  setWranglerVar(
    "SAFEPAY_API_BASE",
    normalizedEnvironment === "production"
      ? "https://api.getsafepay.com"
      : "https://sandbox.api.getsafepay.com"
  );

  section("Private keys");
  const apiKey = await askSecret("Safepay secret key");
  const webhookSecret = await askSecret("Safepay endpoint shared secret");
  const generatedToken = randomBytes(32).toString("hex");
  const contentDumpToken = await askSecret("Private CONTENT_DUMP_TOKEN", { defaultValue: generatedToken });

  putWorkerSecret("SAFEPAY_SECRET_KEY", apiKey);
  putWorkerSecret("SAFEPAY_WEBHOOK_SECRET", webhookSecret);
  putWorkerSecret("CONTENT_DUMP_TOKEN", contentDumpToken);

  section("GitHub Actions");
  const setGh = (await ask("Set CONTENT_DUMP_TOKEN in GitHub Actions with gh? yes/no", { defaultValue: "yes" })).toLowerCase();
  if (setGh.startsWith("y")) maybeSetGitHubSecret("CONTENT_DUMP_TOKEN", contentDumpToken);
  else console.log("Manual step: add CONTENT_DUMP_TOKEN to GitHub repo Settings > Secrets and variables > Actions.");

  section("Deploy");
  const deployNow = (await ask("Deploy Worker now? yes/no", { defaultValue: "yes" })).toLowerCase();
  if (deployNow.startsWith("y")) {
    console.log("Deploying Worker...");
    run("npx", ["--yes", "wrangler@4", "deploy"], { cwd: WORKER_DIR });
  }

  console.log("\nDone. In Safepay Developer > Endpoints, use this webhook URL:");
  console.log("https://theglobaldecipher.com/api/safepay/webhook");
  console.log("Enable all subscription events and use the endpoint shared secret entered above.");
  console.log("\nNext: commit/push the code changes so Cloudflare Pages rebuilds the site.");
} catch (error) {
  console.error(`\nSetup stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
