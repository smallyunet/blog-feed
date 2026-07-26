import fs from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import { marked } from "marked";

const root = new URL("../", import.meta.url);
const dataDir = new URL("data/", root);
const feedPath = new URL("data/feed.json", root);
const atomPath = new URL("atom.xml", root);

const articleSources = [
  {
    id: "blog",
    label: "博客",
    url: "https://smallyu.net/",
    atomUrl: "https://smallyu.net/atom.xml",
    localAtom: new URL("../../blog/docs/atom.xml", import.meta.url),
  },
  {
    id: "blog-b",
    label: "B 面",
    url: "https://b.smallyu.net/",
    atomUrl: "https://b.smallyu.net/atom.xml",
    localAtom: new URL("../../blog-b/docs/atom.xml", import.meta.url),
  },
  {
    id: "blog-crazy",
    label: "疯狂版",
    url: "https://crazy.smallyu.net/",
    atomUrl: "https://crazy.smallyu.net/atom.xml",
    localAtom: new URL("../../blog-crazy/docs/atom.xml", import.meta.url),
  },
  {
    id: "old-blog",
    label: "旧博客",
    url: "https://old-blog.smallyu.net/",
    rssUrl: "https://old-blog.smallyu.net/auto.xml",
    localRss: new URL("../../old-blog/auto.xml", import.meta.url),
  },
];

const microSource = {
  id: "micro",
  label: "微博",
  url: "https://t.smallyu.net/",
  remoteDataBase: "https://t.smallyu.net/data/",
  localDataBase: new URL("../../blog-micro/data/", import.meta.url),
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  cdataPropName: "#cdata",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: {
    enabled: true,
    maxTotalExpansions: 100000,
  },
});

marked.setOptions({
  breaks: false,
  gfm: true,
  headerIds: false,
  mangle: false,
});

async function readLocalText(fileUrl) {
  return fs.readFile(fileUrl, "utf8");
}

async function readRemoteText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "blog-feed-build" },
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

async function readText({ localUrl, remoteUrl }) {
  if (localUrl) {
    try {
      return await readLocalText(localUrl);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return readRemoteText(remoteUrl);
}

async function readJson({ localUrl, remoteUrl }) {
  return JSON.parse(await readText({ localUrl, remoteUrl }));
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function xmlText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return value["#cdata"] ?? value["#text"] ?? "";
  return "";
}

function entryLink(entry) {
  const links = asArray(entry.link);
  const alternate = links.find((link) => !link["@rel"] || link["@rel"] === "alternate") || links[0];
  return alternate?.["@href"] || xmlText(entry.id);
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(text, maxLength = 180) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function absoluteLegacyLinks(html) {
  return String(html || "")
    .replace(/href="\//g, `href="${microSource.url}`)
    .replace(/src="\//g, `src="${microSource.url}`);
}

function microHtml(markdown) {
  return absoluteLegacyLinks(marked.parse(markdown || ""));
}

function normalizeArticleEntry(source, entry) {
  const contentHtml = xmlText(entry.content);
  const summaryHtml = xmlText(entry.summary) || `<p>${escapeHtml(truncateText(stripHtml(contentHtml)))}</p>`;
  const publishedAt = xmlText(entry.published) || xmlText(entry.updated);
  const url = entryLink(entry);
  const tags = asArray(entry.category).map((category) => category?.["@term"]).filter(Boolean);

  return {
    id: `${source.id}:${xmlText(entry.id) || url}`,
    type: "article",
    source: source.id,
    sourceLabel: source.label,
    sourceUrl: source.url,
    title: xmlText(entry.title) || "Untitled",
    url,
    publishedAt,
    updatedAt: xmlText(entry.updated) || publishedAt,
    summaryHtml,
    contentHtml,
    text: stripHtml(contentHtml),
    tags,
  };
}

function normalizeRssEntry(source, entry) {
  const contentHtml = xmlText(entry.description);
  const publishedAt = new Date(xmlText(entry.pubDate)).toISOString();
  const url = xmlText(entry.link);

  return {
    id: `${source.id}:${xmlText(entry.guid) || url}`,
    type: "article",
    source: source.id,
    sourceLabel: source.label,
    sourceUrl: source.url,
    title: xmlText(entry.title) || "Untitled",
    url,
    publishedAt,
    updatedAt: publishedAt,
    summaryHtml: `<p>${escapeHtml(truncateText(stripHtml(contentHtml)))}</p>`,
    contentHtml,
    text: stripHtml(contentHtml),
    tags: [],
  };
}

async function loadArticleItems(source) {
  const xml = await readText({
    localUrl: source.localAtom || source.localRss,
    remoteUrl: source.atomUrl || source.rssUrl,
  });
  const parsed = xmlParser.parse(xml);
  if (parsed.feed) {
    return asArray(parsed.feed.entry).map((entry) => normalizeArticleEntry(source, entry));
  }
  if (parsed.rss?.channel) {
    return asArray(parsed.rss.channel.item).map((entry) => normalizeRssEntry(source, entry));
  }
  throw new Error(`Unsupported feed format for ${source.id}`);
}

async function loadMicroItems() {
  const manifest = await readJson({
    localUrl: new URL("manifest.json", microSource.localDataBase),
    remoteUrl: `${microSource.remoteDataBase}manifest.json`,
  });

  const years = asArray(manifest.years).map((item) => item.year).filter(Boolean);
  const commentsByYear = await Promise.all(
    years.map(async (year) => ({
      year,
      comments: await readJson({
        localUrl: new URL(`${year}.json`, microSource.localDataBase),
        remoteUrl: `${microSource.remoteDataBase}${year}.json`,
      }),
    })),
  );

  return commentsByYear.flatMap(({ year, comments }) => asArray(comments)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((comment, index) => {
    const contentHtml = microHtml(comment.body || "");
    const text = stripHtml(contentHtml);
    return {
      id: `micro:${comment.id}`,
      type: "micro",
      source: microSource.id,
      sourceLabel: microSource.label,
      sourceUrl: microSource.url,
      title: "",
      url: `${microSource.url}#${year}-${comments.length - index}`,
      publishedAt: comment.created_at,
      updatedAt: comment.updated_at || comment.created_at,
      summaryHtml: `<p>${escapeHtml(truncateText(text, 160))}</p>`,
      contentHtml,
      text,
      tags: [],
      year,
    };
  }));
}

function sortItems(items) {
  return items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

function articleCanonicalKey(item) {
  try {
    const url = new URL(item.url);
    return url.pathname.replace(/\/$/, "");
  } catch {
    return `${item.title.trim()}|${String(item.publishedAt).slice(0, 10)}`;
  }
}

function dedupeBlogArticles(items) {
  const preferred = new Map();
  const others = [];

  for (const item of items) {
    if (!["blog", "blog-b"].includes(item.source)) {
      others.push(item);
      continue;
    }

    const key = articleCanonicalKey(item);
    const existing = preferred.get(key);
    if (!existing || (existing.source === "blog-b" && item.source === "blog")) {
      preferred.set(key, item);
    }
  }

  return [...preferred.values(), ...others];
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function atomEntry(item) {
  const title = item.title || truncateText(item.text, 60) || "微博";
  return `  <entry>
    <title>${escapeHtml(title)}</title>
    <link href="${escapeHtml(item.url)}"/>
    <id>${escapeHtml(item.id)}</id>
    <published>${escapeHtml(item.publishedAt)}</published>
    <updated>${escapeHtml(item.updatedAt || item.publishedAt)}</updated>
    <category term="${escapeHtml(item.sourceLabel)}"/>
    <summary type="html"><![CDATA[${item.summaryHtml || ""}]]></summary>
    <content type="html"><![CDATA[${item.contentHtml || item.summaryHtml || ""}]]></content>
  </entry>`;
}

function buildAtom(items, generatedAt) {
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>smallyu feed</title>
  <subtitle>blog, blog-b, blog-crazy, old-blog, and microblog updates</subtitle>
  <link href="https://feed.smallyu.net/atom.xml" rel="self"/>
  <link href="https://feed.smallyu.net/"/>
  <updated>${generatedAt}</updated>
  <id>https://feed.smallyu.net/</id>
  <author><name>smallyu</name></author>
${items.map(atomEntry).join("\n")}
</feed>
`;
}

function feedListItem(item) {
  const base = {
    id: item.id,
    type: item.type,
    source: item.source,
    sourceLabel: item.sourceLabel,
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt,
    updatedAt: item.updatedAt,
  };

  if (item.type === "micro") {
    return {
      ...base,
      summaryHtml: item.summaryHtml,
      contentHtml: item.contentHtml,
      year: item.year,
    };
  }

  return base;
}

async function main() {
  const [articleGroups, microItems] = await Promise.all([
    Promise.all(articleSources.map(loadArticleItems)),
    loadMicroItems(),
  ]);

  const generatedAt = new Date().toISOString();
  const articleItems = dedupeBlogArticles(articleGroups.flat());
  const items = sortItems([...articleItems, ...microItems]);
  const payload = {
    title: "smallyu feed",
    description: "Aggregated updates from 博客, B 面, 疯狂版, 旧博客, and 微博.",
    generatedAt,
    sources: [...articleSources, microSource].map(({ id, label, url }) => ({ id, label, url })),
    count: items.length,
    items: items.map(feedListItem),
  };

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(feedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.writeFile(atomPath, buildAtom(items, generatedAt), "utf8");
  console.log(`[build-feed] ${items.length} items`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
