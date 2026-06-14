const state = {
  items: [],
  sources: [],
  filter: "all",
  generatedAt: null,
  visibleCount: 0,
};

const pageSize = 80;

const els = {
  list: document.getElementById("feed-list"),
  meta: document.getElementById("feed-meta"),
  tabs: document.getElementById("filter-tabs"),
  loadMore: document.getElementById("load-more"),
  loadingTemplate: document.getElementById("loading-template"),
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Shanghai",
});

const fullDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai",
});

function formatDate(value) {
  if (!value) return "";
  return dateFormatter.format(new Date(value)).replaceAll("/", "-");
}

function formatFullDate(value) {
  if (!value) return "";
  const parts = Object.fromEntries(
    fullDateFormatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}年${parts.month}月${parts.day}日 ${parts.hour}时${parts.minute}分`;
}

function renderLoading() {
  els.list.innerHTML = "";
  els.list.append(els.loadingTemplate.content.cloneNode(true));
}

function renderError(message) {
  els.list.innerHTML = `<li class="list-group-item error-row">${message}</li>`;
}

function filteredItems() {
  if (state.filter === "all") return state.items;
  return state.items.filter((item) => item.source === state.filter);
}

function renderMeta(items) {
  const source = state.filter === "all"
    ? "全部"
    : state.sources.find((item) => item.id === state.filter)?.label || state.filter;
  const visibleCount = Math.min(state.visibleCount, items.length);
  const progress = items.length > visibleCount ? ` · 已显示 ${visibleCount} 条` : "";
  els.meta.textContent = `${source} · ${items.length} 条${progress} · ${formatFullDate(state.generatedAt)}`;
}

function articleItem(item) {
  return `
    <li class="list-group-item article-item" id="${escapeHtml(item.id)}">
      <time class="item-date" datetime="${escapeHtml(item.publishedAt)}">${formatDate(item.publishedAt)}</time>
      <div class="item-main">
        <a class="item-title" href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>
      </div>
      <div class="item-aside">
        <span class="source-badge">${escapeHtml(item.sourceLabel)}</span>
      </div>
    </li>
  `;
}

function microItem(item) {
  return `
    <li class="list-group-item micro-item" id="${escapeHtml(item.id)}">
      <time class="item-date" datetime="${escapeHtml(item.publishedAt)}">${formatDate(item.publishedAt)}</time>
      <div class="item-main">
        <div class="item-summary micro-content">${item.contentHtml || item.summaryHtml || ""}</div>
      </div>
      <div class="item-aside">
        <span class="source-badge">${escapeHtml(item.sourceLabel)}</span>
      </div>
    </li>
  `;
}

function updateLoadMore(items) {
  if (!els.loadMore) return;
  const hasMore = state.visibleCount < items.length;
  els.loadMore.hidden = !hasMore;
  if (hasMore) {
    const remaining = items.length - state.visibleCount;
    els.loadMore.textContent = `加载更多（剩余 ${remaining} 条）`;
  }
}

function render() {
  const items = filteredItems();
  if (state.visibleCount === 0) {
    state.visibleCount = Math.min(pageSize, items.length);
  } else {
    state.visibleCount = Math.min(state.visibleCount, items.length);
  }
  renderMeta(items);
  updateLoadMore(items);

  if (!items.length) {
    els.list.innerHTML = "<li class=\"list-group-item empty-row\">No items.</li>";
    return;
  }

  els.list.innerHTML = items
    .slice(0, state.visibleCount)
    .map((item) => item.type === "micro" ? microItem(item) : articleItem(item))
    .join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setFilter(filter) {
  state.filter = filter;
  state.visibleCount = 0;
  for (const button of els.tabs.querySelectorAll(".filter-tab")) {
    button.setAttribute("aria-selected", String(button.dataset.filter === filter));
  }
  render();
}

function initLoadMore() {
  if (!els.loadMore) return;
  els.loadMore.addEventListener("click", () => {
    const items = filteredItems();
    state.visibleCount = Math.min(state.visibleCount + pageSize, items.length);
    render();
  });
}

function initFilters() {
  els.tabs.addEventListener("click", (event) => {
    const button = event.target.closest(".filter-tab");
    if (!button) return;
    setFilter(button.dataset.filter || "all");
  });
}

function initMenuToggle() {
  const toggle = document.getElementById("menu-toggle");
  const menu = document.getElementById("nav-menu");
  if (!toggle || !menu) return;

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    menu.classList.toggle("open");
  });

  document.addEventListener("click", (event) => {
    if (!menu.classList.contains("open")) return;
    if (menu.contains(event.target) || event.target === toggle) return;
    toggle.setAttribute("aria-expanded", "false");
    menu.classList.remove("open");
  });
}

async function init() {
  renderLoading();
  initFilters();
  initLoadMore();
  initMenuToggle();

  try {
    const response = await fetch("./data/feed.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Failed to load feed.json: ${response.status}`);
    const payload = await response.json();
    state.items = payload.items || [];
    state.sources = payload.sources || [];
    state.generatedAt = payload.generatedAt;
    render();
  } catch (error) {
    els.meta.textContent = "Load failed";
    renderError("Failed to load feed data. Please run npm run build first.");
    console.error(error);
  }
}

init();
