const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
const TELEGRAM_TIMEOUT_MS = 10_000;
const TELEGRAM_MESSAGE_LIMIT = 4096;
const MAX_DELIVERY_ATTEMPTS = 3;

export class TelegramError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function clean(value, maximum = 20_000) {
  return String(value == null ? "" : value).replace(/\r/g, "").trim().slice(0, maximum);
}

function channelUsername(env) {
  const configured = clean(env.TELEGRAM_CHANNEL_USERNAME || "@theglobaldecipher", 100);
  return configured.startsWith("@") ? configured : `@${configured}`;
}

export function isTelegramMirrorEligible(post) {
  return Boolean(post?.x_post_id && post?.raw_text);
}

export function telegramMirrorText(post) {
  const link = clean(post?.post_url, 500);
  const suffix = `\n\nOriginal X post:\n${link}`;
  const available = Math.max(0, TELEGRAM_MESSAGE_LIMIT - suffix.length);
  const source = clean(post?.raw_text, 20_000);
  const body = source.length <= available
    ? source
    : `${source.slice(0, Math.max(0, available - 1)).trimEnd()}…`;
  return `${body}${suffix}`.slice(0, TELEGRAM_MESSAGE_LIMIT);
}

export function telegramSendPayload(post, chatId, replyToMessageId = null) {
  const payload = {
    chat_id: chatId,
    text: telegramMirrorText(post),
    link_preview_options: {
      is_disabled: false,
      prefer_large_media: true
    }
  };
  const replyId = Number(replyToMessageId);
  if (Number.isInteger(replyId) && replyId > 0) {
    payload.reply_parameters = {
      message_id: replyId,
      allow_sending_without_reply: true
    };
  }
  return payload;
}

async function telegramRequest(env, method, payload) {
  const token = clean(env.TELEGRAM_BOT_TOKEN, 512);
  if (!token) throw new TelegramError("TELEGRAM_BOT_TOKEN is not configured.", 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${TELEGRAM_API_ORIGIN}/bot${token}/${method}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new TelegramError("Telegram request timed out.", 504);
    throw new TelegramError("Telegram could not be reached.", 502);
  } finally {
    clearTimeout(timeout);
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok || data?.ok !== true) {
    const description = clean(data?.description, 300);
    throw new TelegramError(
      description ? `Telegram rejected the message: ${description}` : `Telegram request failed (${response.status}).`,
      response.status === 400 || response.status === 403 ? 409 : 502
    );
  }
  return data.result || {};
}

async function telegramEnabled(env) {
  const row = await env.CONTENT_DB.prepare(
    "SELECT value FROM sync_state WHERE key = 'telegram_enabled'"
  ).first();
  return row?.value === "true";
}

export async function setTelegramEnabled(env, enabled) {
  if (enabled && !clean(env.TELEGRAM_BOT_TOKEN, 512)) {
    throw new TelegramError("Add the TELEGRAM_BOT_TOKEN Worker secret before enabling Telegram.", 409);
  }
  await env.CONTENT_DB.prepare(`
    INSERT INTO sync_state(key, value, updated_at)
    VALUES ('telegram_enabled', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).bind(enabled ? "true" : "false").run();
  return { ok: true, enabled: Boolean(enabled) };
}

export async function sendTelegramTest(env) {
  const result = await telegramRequest(env, "sendMessage", {
    chat_id: channelUsername(env),
    text: "TGD Alert Bot is connected. New original @Global_Decipher posts will be mirrored here from the existing X-to-Map feed.",
    link_preview_options: { is_disabled: true }
  });
  return {
    ok: true,
    channel: channelUsername(env),
    message_id: result.message_id == null ? null : String(result.message_id),
    sent_at: new Date().toISOString()
  };
}

async function queueFetchedPosts(env, posts) {
  const eligible = (posts || []).filter(isTelegramMirrorEligible);
  if (!eligible.length) return 0;
  await env.CONTENT_DB.batch(eligible.map((post) => env.CONTENT_DB.prepare(`
    INSERT INTO telegram_deliveries(x_post_id, status, created_at, updated_at)
    VALUES (?, 'pending', datetime('now'), datetime('now'))
    ON CONFLICT(x_post_id) DO NOTHING
  `).bind(post.x_post_id)));
  return eligible.length;
}

async function pendingDeliveries(env) {
  const rows = await env.CONTENT_DB.prepare(`
    SELECT td.*, xp.raw_text, xp.post_url, xp.parent_post_id
    FROM telegram_deliveries td
    JOIN x_posts xp ON xp.x_post_id = td.x_post_id
    WHERE td.status IN ('pending', 'failed')
      AND td.attempts < ?
      AND (td.last_attempt_at IS NULL OR td.last_attempt_at <= datetime('now', '-1 minute'))
    ORDER BY td.created_at, td.x_post_id
    LIMIT 10
  `).bind(MAX_DELIVERY_ATTEMPTS).all();
  return rows.results || [];
}

async function deliverOne(env, delivery) {
  let replyToMessageId = null;
  if (delivery.parent_post_id) {
    const parent = await env.CONTENT_DB.prepare(`
      SELECT status, telegram_message_id
      FROM telegram_deliveries
      WHERE x_post_id = ?
    `).bind(delivery.parent_post_id).first();
    // If the parent is part of this mirror queue, wait for it so the Telegram
    // message can preserve the X thread. A parent from before mirroring was
    // enabled has no delivery row, so the reply is sent as a standalone post.
    if (parent && parent.status !== "sent") return { skipped: 1 };
    replyToMessageId = parent?.telegram_message_id || null;
  }
  const claimed = await env.CONTENT_DB.prepare(`
    UPDATE telegram_deliveries
    SET status = 'sending',
        attempts = attempts + 1,
        last_attempt_at = datetime('now'),
        last_error = NULL,
        updated_at = datetime('now')
    WHERE x_post_id = ?
      AND status IN ('pending', 'failed')
      AND attempts < ?
  `).bind(delivery.x_post_id, MAX_DELIVERY_ATTEMPTS).run();
  if (Number(claimed.meta?.changes || 0) !== 1) return { skipped: 1 };
  try {
    const message = await telegramRequest(
      env,
      "sendMessage",
      telegramSendPayload(delivery, channelUsername(env), replyToMessageId)
    );
    await env.CONTENT_DB.prepare(`
      UPDATE telegram_deliveries
      SET status = 'sent',
          telegram_message_id = ?,
          telegram_chat_id = ?,
          sent_at = datetime('now'),
          updated_at = datetime('now')
      WHERE x_post_id = ?
    `).bind(
      message.message_id == null ? null : String(message.message_id),
      message.chat?.id == null ? channelUsername(env) : String(message.chat.id),
      delivery.x_post_id
    ).run();
    return { sent: 1, x_post_id: delivery.x_post_id };
  } catch (error) {
    await env.CONTENT_DB.prepare(`
      UPDATE telegram_deliveries
      SET status = 'failed',
          last_error = ?,
          updated_at = datetime('now')
      WHERE x_post_id = ?
    `).bind(clean(error?.message || error, 500), delivery.x_post_id).run();
    return { failed: 1, x_post_id: delivery.x_post_id, error: clean(error?.message || error, 500) };
  }
}

export async function mirrorFetchedPostsToTelegram(env, fetchedPosts = []) {
  if (!(await telegramEnabled(env))) {
    return { enabled: false, queued: 0, sent: 0, failed: 0, skipped: 0 };
  }
  const queued = await queueFetchedPosts(env, fetchedPosts);
  const pending = await pendingDeliveries(env);
  const summary = { enabled: true, queued, sent: 0, failed: 0, skipped: 0 };
  for (const delivery of pending) {
    const result = await deliverOne(env, delivery);
    summary.sent += result.sent || 0;
    summary.failed += result.failed || 0;
    summary.skipped += result.skipped || 0;
  }
  return summary;
}

export async function telegramStatus(env) {
  const [setting, latest, failures, deliveries] = await Promise.all([
    env.CONTENT_DB.prepare(
      "SELECT value, updated_at FROM sync_state WHERE key = 'telegram_enabled'"
    ).first(),
    env.CONTENT_DB.prepare(`
      SELECT td.*, xp.post_url
      FROM telegram_deliveries td
      LEFT JOIN x_posts xp ON xp.x_post_id = td.x_post_id
      ORDER BY td.updated_at DESC
      LIMIT 1
    `).first(),
    env.CONTENT_DB.prepare(
      "SELECT COUNT(*) AS count FROM telegram_deliveries WHERE status = 'failed'"
    ).first(),
    env.CONTENT_DB.prepare(`
      SELECT td.x_post_id, td.status, td.attempts, td.last_error, td.sent_at,
             td.updated_at, td.telegram_message_id, xp.post_url
      FROM telegram_deliveries td
      LEFT JOIN x_posts xp ON xp.x_post_id = td.x_post_id
      ORDER BY td.updated_at DESC
      LIMIT 12
    `).all()
  ]);
  return {
    telegram_enabled: setting?.value === "true",
    telegram_configured: Boolean(clean(env.TELEGRAM_BOT_TOKEN, 512)),
    telegram_channel: channelUsername(env),
    telegram_last_delivery: latest || null,
    telegram_failed_deliveries: Number(failures?.count || 0),
    telegram_deliveries: deliveries.results || []
  };
}
