import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeTelegramHtml,
  findUnsentItems,
  formatTelegramMessage,
  sendTelegramMessage,
} from "./send-telegram.mjs";

test("findUnsentItems returns only unseen items in chronological order", () => {
  const current = {
    items: [
      { id: "newer", publishedAt: "2026-08-25T02:00:00Z" },
      { id: "existing", publishedAt: "2026-08-25T01:00:00Z" },
      { id: "older", publishedAt: "2026-08-25T00:00:00Z" },
    ],
  };

  assert.deepEqual(findUnsentItems(["existing"], current).map((item) => item.id), ["older", "newer"]);
});

test("an empty send state selects the entire existing feed for initial backfill", () => {
  const current = {
    items: [
      { id: "first", publishedAt: "2026-01-01T00:00:00Z" },
      { id: "second", publishedAt: "2026-01-02T00:00:00Z" },
    ],
  };

  assert.deepEqual(findUnsentItems([], current).map((item) => item.id), ["first", "second"]);
});

test("formatTelegramMessage escapes article fields", () => {
  const message = formatTelegramMessage({
    type: "article",
    sourceLabel: "B <面>",
    title: 'A & "B"',
    url: "https://example.com/?a=1&b=2",
  });

  assert.equal(
    message,
    '<b>B &lt;面&gt;</b>\n<a href="https://example.com/?a=1&amp;b=2">A &amp; &quot;B&quot;</a>',
  );
});

test("formatTelegramMessage turns microblog HTML into safe text", () => {
  const message = formatTelegramMessage({
    type: "micro",
    sourceLabel: "微博",
    contentHtml: "<p>Hello &amp; <strong>world</strong></p>",
    url: "https://t.smallyu.net/#1",
  });

  assert.equal(
    message,
    '<b>微博</b>\nHello &amp; world\n\n<a href="https://t.smallyu.net/#1">查看原文</a>',
  );
  assert.ok(Array.from(message).length <= 4096);
});

test("escapeTelegramHtml handles Telegram HTML control characters", () => {
  assert.equal(escapeTelegramHtml('<>&"'), "&lt;&gt;&amp;&quot;");
});

test("long microblog messages are truncated without splitting HTML entities", () => {
  const message = formatTelegramMessage({
    type: "micro",
    sourceLabel: "微博",
    contentHtml: `<p>${"&amp;".repeat(4000)}</p>`,
    url: "https://t.smallyu.net/#long",
  });

  assert.match(message, /\.\.\.<\/a>|\.\.\.\n\n<a/);
  assert.doesNotMatch(message, /&(?:a|am|amp)$/);
});

test("sendTelegramMessage uses the Telegram Bot API JSON contract", async () => {
  let request;
  const result = await sendTelegramMessage({
    token: "test-token",
    chatId: "-100123",
    text: "hello",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 42 } }),
      };
    },
  });

  assert.equal(request.url, "https://api.telegram.org/bottest-token/sendMessage");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), {
    chat_id: "-100123",
    text: "hello",
    parse_mode: "HTML",
    link_preview_options: { is_disabled: false },
  });
  assert.equal(result.message_id, 42);
});
