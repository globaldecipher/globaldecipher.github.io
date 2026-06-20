// Telegram channel polling -> incident objects.
// Ported from .github/scripts/update-incidents-from-telegram.mjs.
// Diagnostics that only made sense inside GitHub Actions are dropped.

import {
  clean,
  slug,
  numberField,
  findDistrict,
  normalProvince,
  pakistanDateFromSeconds,
  isoFromSeconds,
  loadTelegramState
} from "./feed.js";

const INCIDENT_PATTERN = /attack|blast|explosion|ied|quadcopter|drone|killed|injured|operation|ibo|ambush|firing|militant|terrorist/i;

function parseFields(text) {
  const fields = {};
  for (const line of clean(text).split("\n")) {
    const match = line.match(/^\s*([^:]+)\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    fields[match[1].toLowerCase().replace(/[^a-z0-9]+/g, "_")] = match[2].trim();
  }
  return fields;
}

function incidentLike(text, fields) {
  if (fields.district || fields.summary || fields.type || fields.category) return true;
  return INCIDENT_PATTERN.test(text);
}

function getMessage(update) {
  return update.channel_post || update.edited_channel_post || update.message || update.edited_message || null;
}

function sourceUrl(message) {
  const username = message.chat?.username;
  if (!username || !message.message_id) return "";
  return `https://t.me/${username}/${message.message_id}`;
}

function buildIncident(update) {
  const message = getMessage(update);
  const text = message?.text || message?.caption || "";
  const fields = parseFields(text);
  if (!incidentLike(text, fields)) return null;

  const messageSeconds = Number(message.date) || Math.floor(Date.now() / 1000);
  const location = findDistrict(text, fields);
  const date = pakistanDateFromSeconds(messageSeconds);
  const category = fields.type || fields.category || "Security incident";
  const summary = fields.summary || clean(text).split("\n").filter((line) => !/^\s*[^:]+\s*:/.test(line)).join(" ") || clean(text);
  const fatalities = numberField(fields.killed || fields.fatalities);
  const injuries = numberField(fields.injured || fields.injuries);
  const severity = fields.severity || (fatalities > 0 || injuries >= 3 ? "High" : "Medium");

  return {
    id: `${date}-telegram-${message.chat.id}-${message.message_id}-${slug(location.district || "incident")}`,
    date,
    reported_at: isoFromSeconds(messageSeconds),
    time_label: "From Telegram feed",
    title: fields.title || `${category} reported in ${location.district}`,
    district: location.district,
    province: fields.province ? normalProvince(fields.province) : location.province,
    country: "Pakistan",
    lat: location.lat,
    lng: location.lng,
    category,
    actor: fields.actor || "Unidentified",
    status: fields.status || "Initial report",
    severity,
    fatalities,
    injuries,
    summary,
    source: "TGD Telegram",
    source_url: fields.source || sourceUrl(message),
    verified: false
  };
}

async function telegramRaw(token, method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.json();
}

function isWebhookConflict(description = "") {
  return /webhook is active/i.test(String(description));
}

// Channels delivered via webhook can't be polled with getUpdates; clear it first.
async function getUpdatesWithWebhookRecovery(token, body) {
  const firstAttempt = await telegramRaw(token, "getUpdates", body);
  if (firstAttempt.ok) return firstAttempt.result;
  if (!isWebhookConflict(firstAttempt.description)) {
    throw new Error(`Telegram getUpdates failed: ${firstAttempt.description || "unknown error"}`);
  }
  const deleted = await telegramRaw(token, "deleteWebhook", { drop_pending_updates: false });
  if (!deleted.ok) throw new Error(`Telegram deleteWebhook failed: ${deleted.description || "unknown error"}`);
  const retry = await telegramRaw(token, "getUpdates", body);
  if (!retry.ok) throw new Error(`Telegram getUpdates failed after deleteWebhook: ${retry.description || "unknown error"}`);
  return retry.result;
}

// Poll the channel and return { added, lastUpdateId }.
// `existingIds` is a Set of ids already in the feed (for dedupe).
export async function pollTelegram(env, existingIds) {
  const token = env.TELEGRAM_BOT_TOKEN || "";
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) {
    return { added: [], lastUpdateId: 0, skipped: "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not configured" };
  }

  const state = await loadTelegramState(env);
  const startId = Number(state.last_update_id || 0);
  const offset = startId + 1;

  const updates = await getUpdatesWithWebhookRecovery(token, {
    offset,
    timeout: 0,
    allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"]
  });

  let lastUpdateId = startId;
  const seen = new Set(existingIds);
  const added = [];

  for (const update of updates) {
    lastUpdateId = Math.max(lastUpdateId, Number(update.update_id || 0));
    const message = getMessage(update);
    if (!message) continue;
    if (String(message.chat?.id) !== chatId) continue;

    const incident = buildIncident(update);
    if (!incident) continue;
    if (seen.has(incident.id)) continue;

    seen.add(incident.id);
    added.push(incident);
  }

  return { added, lastUpdateId };
}
