import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_FEED_PATH = new URL("../data/feed.json", import.meta.url);
const DEFAULT_STATE_PATH = new URL("../data/telegram-state.json", import.meta.url);
const MAX_ATTEMPTS = 3;
const DEFAULT_SEND_INTERVAL_MS = 1100;

function asItems(feed) {
  return Array.isArray(feed?.items) ? feed.items : [];
}

export function findUnsentItems(sentItemIds, currentFeed) {
  const previousIds = new Set(sentItemIds);
  return asItems(currentFeed)
    .filter((item) => item?.id && !previousIds.has(item.id))
    .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
}

export function escapeTelegramHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, maxLength) {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters.slice(0, Math.max(0, maxLength - 3)).join("").trim()}...`;
}

export function formatTelegramMessage(item) {
  const source = escapeTelegramHtml(item.sourceLabel || "更新");
  const url = escapeTelegramHtml(item.url);

  if (item.type === "micro") {
    const body = escapeTelegramHtml(truncate(
      plainText(item.contentHtml || item.summaryHtml) || "新微博",
      3500,
    ));
    const footer = `\n\n<a href="${url}">查看原文</a>`;
    const prefix = `<b>${source}</b>\n`;
    return `${prefix}${body}${footer}`;
  }

  const title = escapeTelegramHtml(item.title || "新文章");
  return `<b>${source}</b>\n<a href="${url}">${truncate(title, 3500)}</a>`;
}

function retryDelay(error, attempt) {
  const retryAfter = Number(error?.parameters?.retry_after);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return attempt * 1000;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function sendTelegramMessage({ token, chatId, text, fetchImpl = fetch }) {
  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    let payload;

    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: false },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      payload = await response.json();
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) throw error;
      await sleep(retryDelay(null, attempt));
      continue;
    }

    if (response.ok && payload.ok) return payload.result;

    const canRetry = response.status === 429 || response.status >= 500;
    if (!canRetry || attempt === MAX_ATTEMPTS) {
      throw new Error(`Telegram API error ${response.status}: ${payload.description || "unknown error"}`);
    }

    await sleep(retryDelay(payload, attempt));
  }

  throw new Error("Telegram message delivery failed");
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function readState(statePath) {
  try {
    const state = await readJson(statePath);
    return {
      version: 1,
      sentItemIds: Array.isArray(state.sentItemIds) ? state.sentItemIds : [],
    };
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, sentItemIds: [] };
    throw error;
  }
}

async function writeState(statePath, state) {
  const resolvedPath = statePath instanceof URL ? fileURLToPath(statePath) : statePath;
  const temporaryPath = path.join(
    path.dirname(resolvedPath),
    `.${path.basename(resolvedPath)}.tmp`,
  );
  await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, resolvedPath);
}

export async function main({ env = process.env } = {}) {
  const currentPath = env.TELEGRAM_CURRENT_FEED || DEFAULT_FEED_PATH;
  const statePath = env.TELEGRAM_STATE_PATH || DEFAULT_STATE_PATH;
  const [state, currentFeed] = await Promise.all([
    readState(statePath),
    readJson(currentPath),
  ]);
  const newItems = findUnsentItems(state.sentItemIds, currentFeed);

  if (newItems.length === 0) {
    console.log("[telegram] no unsent items");
    return;
  }

  if (env.TELEGRAM_DRY_RUN === "1") {
    console.log(`[telegram] dry run: ${newItems.length} new item(s)`);
    for (const item of newItems) console.log(`\n${formatTelegramMessage(item)}`);
    return;
  }

  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHANNEL_ID;
  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID are required");
  }

  const configuredInterval = Number(
    env.TELEGRAM_SEND_INTERVAL_MS ?? DEFAULT_SEND_INTERVAL_MS,
  );
  const interval = Number.isFinite(configuredInterval)
    ? Math.max(0, configuredInterval)
    : DEFAULT_SEND_INTERVAL_MS;
  for (const [index, item] of newItems.entries()) {
    await sendTelegramMessage({ token, chatId, text: formatTelegramMessage(item) });
    state.sentItemIds.push(item.id);
    await writeState(statePath, state);
    console.log(`[telegram] sent ${item.id}`);
    if (index < newItems.length - 1 && interval > 0) await sleep(interval);
  }
}

const isEntryPoint = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
