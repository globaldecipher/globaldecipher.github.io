import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTelegramMirrorEligible,
  telegramMirrorText,
  telegramSendPayload
} from "../src/telegram.js";

const rootPost = {
  x_post_id: "2073403718540972192",
  parent_post_id: null,
  raw_text: "BREAKING: Original TGD wording stays unchanged.",
  post_url: "https://x.com/Global_Decipher/status/2073403718540972192"
};

test("original posts and TGD replies enter the same Telegram mirror branch", () => {
  assert.equal(isTelegramMirrorEligible(rootPost), true);
  assert.equal(isTelegramMirrorEligible({ ...rootPost, parent_post_id: "2073403718540972000" }), true);
  assert.equal(isTelegramMirrorEligible({ ...rootPost, raw_text: "" }), false);
});

test("Telegram text preserves the fetched wording and adds the original X link", () => {
  assert.equal(
    telegramMirrorText(rootPost),
    "BREAKING: Original TGD wording stays unchanged.\n\nOriginal X post:\nhttps://x.com/Global_Decipher/status/2073403718540972192"
  );
});

test("Telegram mirror safely fits the Bot API message limit", () => {
  const text = telegramMirrorText({ ...rootPost, raw_text: "A".repeat(6000) });
  assert.equal(text.length, 4096);
  assert.match(text, /Original X post:/);
  assert.match(text, /2073403718540972192$/);
});

test("Telegram replies use the mirrored parent message without changing the post text", () => {
  const reply = {
    ...rootPost,
    x_post_id: "2073403718540972193",
    parent_post_id: rootPost.x_post_id,
    raw_text: "Thread reply from the TGD account.",
    post_url: "https://x.com/Global_Decipher/status/2073403718540972193"
  };
  const payload = telegramSendPayload(reply, "@theglobaldecipher", "55");
  assert.equal(payload.text.startsWith(reply.raw_text), true);
  assert.deepEqual(payload.reply_parameters, {
    message_id: 55,
    allow_sending_without_reply: true
  });
});
