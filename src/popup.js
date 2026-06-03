const state = {
  article: null,
  markdown: "",
  settings: {
    vault: "",
    folder: "CSDN",
    includeFrontmatter: true
  }
};

const elements = {
  pageState: document.getElementById("pageState"),
  articleTitle: document.getElementById("articleTitle"),
  articleMeta: document.getElementById("articleMeta"),
  vaultInput: document.getElementById("vaultInput"),
  folderInput: document.getElementById("folderInput"),
  frontmatterInput: document.getElementById("frontmatterInput"),
  refreshButton: document.getElementById("refreshButton"),
  copyButton: document.getElementById("copyButton"),
  downloadButton: document.getElementById("downloadButton"),
  obsidianButton: document.getElementById("obsidianButton"),
  preview: document.getElementById("preview")
};

const DEFAULT_SETTINGS = {
  vault: "",
  folder: "CSDN",
  includeFrontmatter: true
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await loadSettings();
  bindEvents();
  await refreshArticle();
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", refreshArticle);
  elements.copyButton.addEventListener("click", copyMarkdown);
  elements.downloadButton.addEventListener("click", downloadMarkdown);
  elements.obsidianButton.addEventListener("click", openInObsidian);

  elements.vaultInput.addEventListener("input", updateSettingsFromForm);
  elements.folderInput.addEventListener("input", updateSettingsFromForm);
  elements.frontmatterInput.addEventListener("change", updateSettingsFromForm);
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  state.settings = { ...DEFAULT_SETTINGS, ...stored };
  elements.vaultInput.value = state.settings.vault;
  elements.folderInput.value = state.settings.folder;
  elements.frontmatterInput.checked = state.settings.includeFrontmatter;
}

async function saveSettings() {
  await chrome.storage.sync.set(state.settings);
}

function updateSettingsFromForm() {
  state.settings = {
    vault: elements.vaultInput.value.trim(),
    folder: normalizeFolder(elements.folderInput.value),
    includeFrontmatter: elements.frontmatterInput.checked
  };
  saveSettings();
  if (state.article) {
    state.markdown = buildMarkdown(state.article, state.settings);
    renderArticle();
  }
}

async function refreshArticle() {
  setBusy(true, "正在抓取 CSDN 正文");
  try {
    const tab = await getActiveTab();
    assertSupportedUrl(tab.url);
    const article = await extractFromTab(tab);
    state.article = article;
    state.markdown = buildMarkdown(article, state.settings);
    renderArticle();
    setStatus("已生成 Markdown");
  } catch (error) {
    state.article = null;
    state.markdown = "";
    renderArticle();
    setStatus(error.message || "抓取失败");
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy, message) {
  elements.refreshButton.disabled = isBusy;
  elements.copyButton.disabled = isBusy || !state.markdown;
  elements.downloadButton.disabled = isBusy || !state.markdown;
  elements.obsidianButton.disabled = isBusy || !state.markdown;
  if (message) {
    setStatus(message);
  }
}

function setStatus(message) {
  elements.pageState.textContent = message;
}

function renderArticle() {
  if (!state.article) {
    elements.articleTitle.textContent = "没有可导出的 CSDN 正文";
    elements.articleMeta.textContent = "请在 CSDN 文章页打开扩展";
    elements.preview.textContent = "";
    setBusy(false);
    return;
  }

  const { title, author, wordCount, imageCount } = state.article;
  elements.articleTitle.textContent = title;
  elements.articleMeta.textContent = [
    author ? `作者：${author}` : "",
    `${wordCount} 字`,
    `${imageCount} 张图`
  ].filter(Boolean).join(" · ");
  elements.preview.textContent = state.markdown.slice(0, 2200);
  setBusy(false);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("没有找到当前标签页");
  }
  return tab;
}

function assertSupportedUrl(url) {
  if (!/^https?:\/\/([^/]+\.)?csdn\.net\//i.test(url || "")) {
    throw new Error("当前页面不是 CSDN 页面");
  }
}

async function extractFromTab(tab) {
  try {
    return await sendExtractMessage(tab.id);
  } catch (firstError) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/content-script.js"]
    });
    try {
      return await sendExtractMessage(tab.id);
    } catch {
      throw firstError;
    }
  }
}

function sendExtractMessage(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "CSDN_TO_OBSIDIAN_EXTRACT" }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "内容脚本没有返回结果"));
        return;
      }
      resolve(response.article);
    });
  });
}

async function copyMarkdown() {
  await navigator.clipboard.writeText(state.markdown);
  setStatus("Markdown 已复制");
}

function downloadMarkdown() {
  const filename = `${sanitizeFileName(state.article.title)}.md`;
  const blob = new Blob([state.markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename,
    saveAs: true
  }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message);
      return;
    }
    setStatus("Markdown 文件已下载");
  });
}

async function openInObsidian() {
  await navigator.clipboard.writeText(state.markdown);
  const folder = normalizeFolder(state.settings.folder);
  const fileBase = sanitizeFileName(state.article.title);
  const file = folder ? `${folder}/${fileBase}` : fileBase;
  const params = new URLSearchParams({
    file,
    clipboard: "true",
    overwrite: "false"
  });
  if (state.settings.vault) {
    params.set("vault", state.settings.vault);
  }
  await chrome.tabs.create({ url: `obsidian://new?${params.toString()}` });
  setStatus("已调用 Obsidian URI");
}

function buildMarkdown(article, settings) {
  const parts = [];
  if (settings.includeFrontmatter) {
    parts.push(buildFrontmatter(article));
  }
  parts.push(`# ${article.title}`);
  parts.push("");
  if (article.author || article.publishedAt || article.url) {
    if (article.author) parts.push(`- 作者：${article.author}`);
    if (article.publishedAt) parts.push(`- 发布时间：${article.publishedAt}`);
    if (article.url) parts.push(`- 原文：${article.url}`);
    parts.push("");
  }
  parts.push(article.content.trim());
  parts.push("");
  return parts.join("\n");
}

function buildFrontmatter(article) {
  const fields = [
    "---",
    `title: ${yamlString(article.title)}`,
    article.author ? `author: ${yamlString(article.author)}` : "",
    article.publishedAt ? `created: ${yamlString(article.publishedAt)}` : "",
    article.url ? `source: ${yamlString(article.url)}` : "",
    "tags:",
    "  - csdn",
    "clipped_at: " + yamlString(new Date().toISOString()),
    "---"
  ].filter(Boolean);
  return fields.join("\n");
}

function yamlString(value) {
  return JSON.stringify(String(value || ""));
}

function normalizeFolder(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => sanitizeFileName(part).trim())
    .filter(Boolean)
    .join("/");
}

function sanitizeFileName(value) {
  return String(value || "untitled")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "untitled";
}
