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


test("article messages include AI marker, body word count and searchable tags", () => {
  assert.equal(formatTelegramMessage({
    type: "article", sourceLabel: "博客", title: "示例", url: "https://example.com/ai/",
    collection: "ai", contentHtml: "<h2>中文</h2><p>Hello world 123!</p>",
    tags: ["AI 文章库", "Web3", "钱包", "Web3", "AI tools", "#技术", "<>&"],
  }), '<b>博客 · AI</b>\n<a href="https://example.com/ai/">示例</a>\n\n约 5 字\n#Web3 #钱包 #AI_tools #技术');
});

test("ordinary articles count full body rather than summary and omit AI marker", () => {
  const message = formatTelegramMessage({
    type: "article", title: "普通文章", url: "https://example.com/",
    contentHtml: "<p>正文内容</p><script>ignored()</script><style>ignored</style>",
    summaryHtml: "摘要", tags: [],
  });
  assert.match(message, /约 4 字$/);
  assert.doesNotMatch(message, / · AI|#/);
});

test("missing article body does not invent a word count", () => {
  const message = formatTelegramMessage({title: "文章", url: "https://example.com/", tags: ["技术"]});
  assert.ok(message.endsWith("\n\n#技术"));
  assert.doesNotMatch(message, /字/);
});

test("long article titles and tags stay within Telegram's visible text limit", () => {
  const message = formatTelegramMessage({
    title: "&".repeat(5000), url: "https://example.com/", collection: "ai",
    text: "正文", tags: Array.from({length: 100}, (_, i) => `${i}${"长".repeat(100)}`),
  });
  assert.ok(message.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").length < 4096);
  assert.equal((message.match(/#/g) || []).length, 8);
  assert.doesNotMatch(message, /&(?:a|am)$/);
});


test("article word counts decode numeric HTML entities", () => {
  const message = formatTelegramMessage({
    title: "文章", url: "https://example.com/", contentHtml: "<p>买入&#x2F;卖出 &#20013;</p>",
  });
  assert.ok(message.endsWith("约 5 字"));
});


test("article messages use metadata retained in the compact feed", () => {
  const message = formatTelegramMessage({title: "文章", url: "https://example.com/", wordCount: 2400, tags: ["Web3"]});
  assert.ok(message.endsWith("约 2,400 字\n#Web3"));
});
