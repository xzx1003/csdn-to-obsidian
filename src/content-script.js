(() => {
  if (window.__CSDN_OBSIDIAN_CLIPPER__) {
    return;
  }
  window.__CSDN_OBSIDIAN_CLIPPER__ = true;

  const CONTENT_SELECTORS = [
    "#content_views",
    "#article_content",
    "article",
    ".article_content",
    ".blog-content-box .article_content",
    ".markdown_views",
    ".htmledit_views"
  ];

  const NOISE_SELECTORS = [
    "script",
    "style",
    "noscript",
    "iframe",
    "button",
    ".hide-article-box",
    ".read_more_btn",
    ".btn-readmore",
    ".recommend-box",
    ".recommend-right",
    ".toolbox-list",
    ".csdn-side-toolbar",
    ".blog-footer-bottom",
    ".comment-box",
    ".passport-login-container",
    ".article-copyright",
    ".pre-numbering",
    ".code-toolbar",
    ".toolbar-item",
    ".hljs-button",
    "[contenteditable]"
  ];

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "CSDN_TO_OBSIDIAN_EXTRACT") {
      return false;
    }

    try {
      const article = extractArticle();
      sendResponse({ ok: true, article });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || "无法抽取正文" });
    }
    return true;
  });

  function extractArticle() {
    unfoldArticle();
    const contentElement = findArticleElement();
    if (!contentElement) {
      throw new Error("没有识别到 CSDN 正文区域");
    }

    const clone = contentElement.cloneNode(true);
    cleanNode(clone);

    const content = normalizeMarkdown(nodeToMarkdown(clone)).trim();
    if (content.length < 80) {
      throw new Error("正文过短，可能被登录墙、付费墙或页面结构拦截");
    }

    const title = pickTitle();
    return {
      title,
      author: pickAuthor(),
      publishedAt: pickPublishedAt(),
      url: location.href.split("#")[0],
      content,
      wordCount: content.replace(/\s+/g, "").length,
      imageCount: clone.querySelectorAll("img").length
    };
  }

  function unfoldArticle() {
    const readableTargets = document.querySelectorAll("#content_views, #article_content, .article_content");
    readableTargets.forEach((element) => {
      element.style.maxHeight = "none";
      element.style.height = "auto";
      element.style.overflow = "visible";
    });

    const buttons = Array.from(document.querySelectorAll("button, a, .btn-readmore, .read_more_btn"));
    buttons
      .filter((element) => /展开|阅读更多|阅读全文|继续阅读/.test(element.textContent || ""))
      .slice(0, 4)
      .forEach((element) => {
        try {
          element.click();
        } catch {
          // Some CSDN overlays are not real buttons; style changes above still help.
        }
      });

    document.querySelectorAll(".hide-article-box, .read_more_btn").forEach((element) => {
      element.remove();
    });
  }

  function findArticleElement() {
    const candidates = CONTENT_SELECTORS
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter(Boolean);

    const uniqueCandidates = [...new Set(candidates)];
    if (!uniqueCandidates.length) {
      return null;
    }

    return uniqueCandidates
      .map((element) => ({ element, score: scoreContentElement(element) }))
      .sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  function scoreContentElement(element) {
    const textLength = cleanText(element.textContent).length;
    const codeScore = element.querySelectorAll("pre, code").length * 120;
    const mediaScore = element.querySelectorAll("img, table").length * 80;
    const headingScore = element.querySelectorAll("h1, h2, h3").length * 60;
    const linkPenalty = element.querySelectorAll("a").length * 8;
    return textLength + codeScore + mediaScore + headingScore - linkPenalty;
  }

  function cleanNode(root) {
    root.querySelectorAll(NOISE_SELECTORS.join(",")).forEach((node) => node.remove());
    root.querySelectorAll("pre, code").forEach((node) => {
      const language = pickLanguage(node);
      if (language) {
        node.setAttribute("data-language", language);
      }
    });
    root.querySelectorAll("[style]").forEach((node) => {
      node.removeAttribute("style");
    });
    root.querySelectorAll("[class]").forEach((node) => {
      node.removeAttribute("class");
    });
    root.querySelectorAll("img").forEach((image) => {
      const src = pickImageSource(image);
      if (!src) {
        image.remove();
        return;
      }
      image.setAttribute("src", absoluteUrl(src));
      image.setAttribute("alt", cleanText(image.getAttribute("alt") || ""));
    });
    root.querySelectorAll("a[href]").forEach((link) => {
      const href = link.getAttribute("href");
      if (!href || /^(javascript:|#)/i.test(href)) {
        link.removeAttribute("href");
        return;
      }
      link.setAttribute("href", absoluteUrl(href));
    });
  }

  function pickTitle() {
    const selectors = [
      "h1.title-article",
      ".title-article",
      "article h1",
      "h1",
      "meta[property='og:title']",
      "title"
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const value = selector.startsWith("meta")
        ? node?.getAttribute("content")
        : node?.textContent;
      const cleaned = cleanText(value).replace(/\s*-CSDN博客\s*$/i, "");
      if (cleaned) {
        return cleaned;
      }
    }
    return "CSDN article";
  }

  function pickAuthor() {
    const selectors = [
      "meta[name='author']",
      ".follow-nickName",
      ".user-name",
      ".name",
      ".blogger-name",
      ".article-info-box a"
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const value = selector.startsWith("meta")
        ? node?.getAttribute("content")
        : node?.textContent;
      const cleaned = cleanText(value);
      if (cleaned) {
        return cleaned;
      }
    }
    return "";
  }

  function pickPublishedAt() {
    const metaSelectors = [
      "meta[property='article:published_time']",
      "meta[itemprop='datePublished']",
      "meta[name='publishdate']"
    ];

    for (const selector of metaSelectors) {
      const value = document.querySelector(selector)?.getAttribute("content");
      if (value) {
        return cleanText(value);
      }
    }

    const text = cleanText(document.querySelector(".bar-content, .article-info-box, time")?.textContent);
    const date = text.match(/\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/);
    return date ? date[0].replace(/[年月.]/g, "-").replace(/日/g, "") : "";
  }

  function nodeToMarkdown(node, context = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeInlineMarkdown(node.nodeValue || "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tagName = node.tagName.toLowerCase();
    if (isHidden(node)) {
      return "";
    }

    switch (tagName) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return block(`${"#".repeat(Number(tagName[1]))} ${inlineChildren(node).trim()}`);
      case "p":
        return block(inlineChildren(node).trim());
      case "br":
        return "\n";
      case "strong":
      case "b":
        return wrapInline("**", inlineChildren(node));
      case "em":
      case "i":
        return wrapInline("*", inlineChildren(node));
      case "s":
      case "del":
        return wrapInline("~~", inlineChildren(node));
      case "code":
        if (node.closest("pre")) {
          return node.textContent || "";
        }
        return inlineCode(node.textContent || "");
      case "pre":
        return codeBlock(node);
      case "a":
        return linkMarkdown(node);
      case "img":
        return imageMarkdown(node);
      case "ul":
        return listMarkdown(node, { ordered: false, depth: context.depth || 0 });
      case "ol":
        return listMarkdown(node, { ordered: true, depth: context.depth || 0 });
      case "li":
        return inlineChildren(node).trim();
      case "blockquote":
        return block(
          normalizeMarkdown(childrenMarkdown(node))
            .split("\n")
            .map((line) => line ? `> ${line}` : ">")
            .join("\n")
        );
      case "table":
        return tableMarkdown(node);
      case "hr":
        return block("---");
      default:
        return isBlockElement(tagName) ? block(childrenMarkdown(node)) : inlineChildren(node);
    }
  }

  function childrenMarkdown(node, context = {}) {
    return Array.from(node.childNodes)
      .map((child) => nodeToMarkdown(child, context))
      .join("");
  }

  function inlineChildren(node) {
    return Array.from(node.childNodes)
      .map((child) => nodeToMarkdown(child))
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  function listMarkdown(list, options) {
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === "li");
    const lines = items.map((item, index) => {
      const marker = options.ordered ? `${index + 1}.` : "-";
      const indent = "  ".repeat(options.depth);
      const childBlocks = Array.from(item.childNodes)
        .filter((child) => !["ul", "ol"].includes(child.tagName?.toLowerCase()))
        .map((child) => nodeToMarkdown(child))
        .join("")
        .trim();
      const nested = Array.from(item.children)
        .filter((child) => ["ul", "ol"].includes(child.tagName?.toLowerCase()))
        .map((child) => listMarkdown(child, {
          ordered: child.tagName.toLowerCase() === "ol",
          depth: options.depth + 1
        }))
        .join("");
      const body = childBlocks.replace(/\n+/g, "\n").replace(/\n/g, `\n${indent}  `);
      return `${indent}${marker} ${body}${nested ? `\n${nested.trimEnd()}` : ""}`;
    });
    return `\n${lines.join("\n")}\n\n`;
  }

  function tableMarkdown(table) {
    const rows = Array.from(table.querySelectorAll("tr"))
      .map((row) => Array.from(row.children)
        .filter((cell) => ["td", "th"].includes(cell.tagName.toLowerCase()))
        .map((cell) => cleanTableCell(inlineChildren(cell))))
      .filter((row) => row.length);

    if (!rows.length) {
      return "";
    }

    const columnCount = Math.max(...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) => {
      while (row.length < columnCount) row.push("");
      return row;
    });
    const header = normalizedRows[0];
    const separator = Array(columnCount).fill("---");
    const bodyRows = normalizedRows.slice(1);
    return block([header, separator, ...bodyRows]
      .map((row) => `| ${row.join(" | ")} |`)
      .join("\n"));
  }

  function codeBlock(pre) {
    const code = pre.querySelector("code") || pre;
    const language = pickLanguage(pre, code);
    const text = (code.textContent || "").replace(/\n+$/g, "");
    const fence = makeFence(text);
    return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
  }

  function pickLanguage(...nodes) {
    const storedLanguage = nodes
      .map((node) => node?.getAttribute?.("data-language"))
      .find(Boolean);
    if (storedLanguage) {
      return storedLanguage;
    }
    const classText = nodes
      .map((node) => node?.className || "")
      .join(" ");
    const match = classText.match(/(?:language|lang)-([\w-]+)/i) || classText.match(/\b(typescript|javascript|java|python|cpp|csharp|go|rust|shell|bash|sql|json|xml|html|css)\b/i);
    return match ? match[1].toLowerCase() : "";
  }

  function makeFence(text) {
    const longest = Math.max(2, ...Array.from(String(text).matchAll(/`+/g), (match) => match[0].length));
    return "`".repeat(longest + 1);
  }

  function linkMarkdown(link) {
    const text = inlineChildren(link).trim() || cleanText(link.getAttribute("href"));
    const href = link.getAttribute("href");
    if (!href) {
      return text;
    }
    return `[${escapeLinkText(text)}](${href.replace(/\)/g, "%29")})`;
  }

  function imageMarkdown(image) {
    const src = image.getAttribute("src");
    if (!src) {
      return "";
    }
    const alt = cleanText(image.getAttribute("alt"));
    return `\n\n![${escapeLinkText(alt)}](${src.replace(/\)/g, "%29")})\n\n`;
  }

  function pickImageSource(image) {
    return image.getAttribute("data-src")
      || image.getAttribute("data-original")
      || image.getAttribute("data-actualsrc")
      || image.getAttribute("data-original-src")
      || image.currentSrc
      || image.getAttribute("src");
  }

  function absoluteUrl(value) {
    try {
      return new URL(value, location.href).href;
    } catch {
      return value;
    }
  }

  function isHidden(node) {
    const hiddenAttr = node.getAttribute("hidden") !== null || node.getAttribute("aria-hidden") === "true";
    return hiddenAttr || getComputedStyle(node).display === "none" || getComputedStyle(node).visibility === "hidden";
  }

  function isBlockElement(tagName) {
    return /^(address|article|aside|div|dl|fieldset|figcaption|figure|footer|form|header|main|nav|section)$/i.test(tagName);
  }

  function block(value) {
    const trimmed = normalizeMarkdown(value).trim();
    return trimmed ? `\n\n${trimmed}\n\n` : "";
  }

  function wrapInline(wrapper, value) {
    const trimmed = value.trim();
    return trimmed ? `${wrapper}${trimmed}${wrapper}` : "";
  }

  function inlineCode(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) {
      return "";
    }
    const ticks = text.includes("`") ? "``" : "`";
    return `${ticks}${text}${ticks}`;
  }

  function escapeInlineMarkdown(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[\\*_{}[\]<>]/g, "\\$&");
  }

  function escapeLinkText(value) {
    return String(value || "").replace(/[[\]]/g, "\\$&");
  }

  function cleanTableCell(value) {
    return normalizeMarkdown(value)
      .replace(/\n+/g, "<br>")
      .replace(/\|/g, "\\|")
      .trim();
  }

  function normalizeMarkdown(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
})();
