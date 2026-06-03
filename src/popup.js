const DB_NAME = "csdn-to-obsidian";
const DB_VERSION = 1;
const DB_STORE = "handles";
const VAULT_HANDLE_KEY = "vault";

const state = {
  article: null,
  markdown: "",
  vaultHandle: null,
  settings: {
    folder: "CSDN",
    includeFrontmatter: true
  }
};

const elements = {
  pageState: document.getElementById("pageState"),
  articleTitle: document.getElementById("articleTitle"),
  articleMeta: document.getElementById("articleMeta"),
  vaultStatus: document.getElementById("vaultStatus"),
  chooseVaultButton: document.getElementById("chooseVaultButton"),
  clearVaultButton: document.getElementById("clearVaultButton"),
  folderInput: document.getElementById("folderInput"),
  frontmatterInput: document.getElementById("frontmatterInput"),
  refreshButton: document.getElementById("refreshButton"),
  copyButton: document.getElementById("copyButton"),
  downloadButton: document.getElementById("downloadButton"),
  saveVaultButton: document.getElementById("saveVaultButton"),
  preview: document.getElementById("preview")
};

const DEFAULT_SETTINGS = {
  folder: "CSDN",
  includeFrontmatter: true
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await loadSettings();
  state.vaultHandle = await readVaultHandle();
  bindEvents();
  updateVaultStatus();
  await refreshArticle();
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", refreshArticle);
  elements.chooseVaultButton.addEventListener("click", chooseVaultFolder);
  elements.clearVaultButton.addEventListener("click", clearVaultFolder);
  elements.copyButton.addEventListener("click", copyMarkdown);
  elements.downloadButton.addEventListener("click", downloadMarkdown);
  elements.saveVaultButton.addEventListener("click", saveToVault);

  elements.folderInput.addEventListener("input", updateSettingsFromForm);
  elements.frontmatterInput.addEventListener("change", updateSettingsFromForm);
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  state.settings = { ...DEFAULT_SETTINGS, ...stored };
  elements.folderInput.value = state.settings.folder;
  elements.frontmatterInput.checked = state.settings.includeFrontmatter;
}

async function saveSettings() {
  await chrome.storage.sync.set(state.settings);
}

function updateSettingsFromForm() {
  state.settings = {
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
  elements.chooseVaultButton.disabled = isBusy || !supportsLocalVaultWrite();
  elements.clearVaultButton.disabled = isBusy || !state.vaultHandle;
  elements.copyButton.disabled = isBusy || !state.markdown;
  elements.downloadButton.disabled = isBusy || !state.markdown;
  elements.saveVaultButton.disabled = isBusy || !state.markdown || !supportsLocalVaultWrite();
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

async function chooseVaultFolder() {
  if (!supportsLocalVaultWrite()) {
    setStatus("当前浏览器不支持直接写入本地文件夹");
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({
      id: "csdn-to-obsidian-vault",
      mode: "readwrite"
    });
    const hasPermission = await ensurePermission(handle, true);
    if (!hasPermission) {
      throw new Error("没有获得 Vault 写入权限");
    }
    await writeVaultHandle(handle);
    state.vaultHandle = handle;
    updateVaultStatus();
    setStatus("Vault 文件夹已选择");
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("已取消选择 Vault 文件夹");
      return;
    }
    setStatus(error.message || "无法选择 Vault 文件夹");
  } finally {
    setBusy(false);
  }
}

async function clearVaultFolder() {
  await deleteVaultHandle();
  state.vaultHandle = null;
  updateVaultStatus();
  setStatus("Vault 文件夹已清除");
  setBusy(false);
}

async function saveToVault() {
  if (!state.markdown) {
    return;
  }

  try {
    const root = state.vaultHandle || await readVaultHandle();
    if (!root) {
      setStatus("请先选择 Vault 文件夹");
      return;
    }
    const hasPermission = await ensurePermission(root, true);
    if (!hasPermission) {
      setStatus("请重新授权 Vault 写入权限");
      return;
    }

    state.vaultHandle = root;
    const folder = normalizeFolder(state.settings.folder);
    const targetDirectory = await getOrCreateDirectory(root, folder);
    const fileName = await getAvailableFileName(targetDirectory, sanitizeFileName(state.article.title), ".md");
    const fileHandle = await targetDirectory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Blob([state.markdown], { type: "text/markdown;charset=utf-8" }));
    await writable.close();

    const displayPath = folder ? `${folder}/${fileName}` : fileName;
    setStatus(`已保存到 ${displayPath}`);
    updateVaultStatus();
  } catch (error) {
    setStatus(error.message || "保存到 Vault 失败");
  } finally {
    setBusy(false);
  }
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

function supportsLocalVaultWrite() {
  return "showDirectoryPicker" in window && "indexedDB" in window;
}

function updateVaultStatus() {
  if (!supportsLocalVaultWrite()) {
    elements.vaultStatus.textContent = "当前浏览器不支持";
    elements.chooseVaultButton.disabled = true;
    elements.clearVaultButton.disabled = true;
    return;
  }
  elements.vaultStatus.textContent = state.vaultHandle?.name || "未选择";
  elements.clearVaultButton.disabled = !state.vaultHandle;
}

async function ensurePermission(handle, write) {
  const options = { mode: write ? "readwrite" : "read" };
  if ((await handle.queryPermission(options)) === "granted") {
    return true;
  }
  return (await handle.requestPermission(options)) === "granted";
}

async function getOrCreateDirectory(root, folder) {
  let directory = root;
  const parts = folder ? folder.split("/").filter(Boolean) : [];
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part, { create: true });
  }
  return directory;
}

async function getAvailableFileName(directory, baseName, extension) {
  let index = 1;
  let candidate = `${baseName}${extension}`;
  while (await fileExists(directory, candidate)) {
    index += 1;
    candidate = `${baseName} (${index})${extension}`;
  }
  return candidate;
}

async function fileExists(directory, fileName) {
  try {
    await directory.getFileHandle(fileName);
    return true;
  } catch (error) {
    if (error?.name === "NotFoundError") {
      return false;
    }
    throw error;
  }
}

function openVaultDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readVaultHandle() {
  if (!supportsLocalVaultWrite()) {
    return null;
  }
  return withVaultStore("readonly", (store) => promisifyRequest(store.get(VAULT_HANDLE_KEY)));
}

async function writeVaultHandle(handle) {
  return withVaultStore("readwrite", (store) => promisifyRequest(store.put(handle, VAULT_HANDLE_KEY)));
}

async function deleteVaultHandle() {
  return withVaultStore("readwrite", (store) => promisifyRequest(store.delete(VAULT_HANDLE_KEY)));
}

async function withVaultStore(mode, callback) {
  const db = await openVaultDb();
  try {
    const transaction = db.transaction(DB_STORE, mode);
    const store = transaction.objectStore(DB_STORE);
    const complete = promisifyTransaction(transaction);
    const result = await callback(store);
    await complete;
    return result;
  } finally {
    db.close();
  }
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
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
