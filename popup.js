// --- Tab switching ---

const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");

    // Load word book when switching to that tab
    if (tab.dataset.tab === "wordbook") {
      loadWordBook();
    }
  });
});

// --- Translate tab ---

const TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single";
const input = document.getElementById("word-input");
const searchBtn = document.getElementById("search-btn");
const resultDiv = document.getElementById("translate-result");

searchBtn.addEventListener("click", () => translate());
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") translate();
});

async function translate() {
  const text = input.value.trim();
  if (!text) return;

  resultDiv.innerHTML = '<div class="loading">Translating...</div>';

  const isCN = /[\u4e00-\u9fff]/.test(text);
  const targetLang = isCN ? "en" : "zh-CN";

  try {
    const url =
      TRANSLATE_URL +
      `?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("API error");

    const data = await response.json();
    const translated = data[0].map((seg) => seg[0]).join("");
    const detectedLang = data[2] || "unknown";

    const langLabel =
      targetLang === "en"
        ? "Chinese → English"
        : `${getLangName(detectedLang)} → Chinese`;

    resultDiv.innerHTML = `
      <div class="result-word">${escapeHtml(text)}</div>
      <div class="result-lang">${escapeHtml(langLabel)}</div>
      <div class="result-translation">${escapeHtml(translated)}</div>
    `;
  } catch {
    resultDiv.innerHTML = '<div class="error">Translation failed. Please try again.</div>';
  }
}

// --- Word Book tab ---

const wordbookList = document.getElementById("wordbook-list");
const wordbookCount = document.getElementById("wordbook-count");
const exportBtn = document.getElementById("export-btn");
const clearBtn = document.getElementById("clear-btn");

let cachedWordBook = [];

function loadWordBook() {
  chrome.runtime.sendMessage({ action: "getWordBook" }, (response) => {
    cachedWordBook = response.wordBook || [];
    renderWordBook(cachedWordBook);
  });
}

function renderWordBook(wordBook) {
  wordbookCount.textContent = `${wordBook.length} word${wordBook.length !== 1 ? "s" : ""}`;

  if (wordBook.length === 0) {
    wordbookList.innerHTML =
      '<div class="wordbook-empty">No words yet. Use right-click "Q 加入单词本" to add words.</div>';
    return;
  }

  let html = "";
  for (const entry of wordBook) {
    const domain = getDomain(entry.url);
    html += `
      <div class="word-item">
        <div class="word-info">
          <div class="word-text">${escapeHtml(entry.word)}</div>
          <div class="word-meta">
            ${escapeHtml(entry.time)}
            ${domain ? ` &middot; <a href="${escapeHtml(entry.url)}" target="_blank">${escapeHtml(domain)}</a>` : ""}
          </div>
        </div>
        <button class="word-delete" data-word="${escapeAttr(entry.word)}" data-time="${escapeAttr(entry.time)}" title="Remove">&times;</button>
      </div>
    `;
  }
  wordbookList.innerHTML = html;
}

// Delete individual word
wordbookList.addEventListener("click", (e) => {
  const btn = e.target.closest(".word-delete");
  if (!btn) return;

  const word = btn.dataset.word;
  const time = btn.dataset.time;

  chrome.runtime.sendMessage(
    { action: "removeFromWordBook", word, time },
    (response) => {
      cachedWordBook = response.wordBook || [];
      renderWordBook(cachedWordBook);
    }
  );
});

// Export CSV
exportBtn.addEventListener("click", () => {
  if (cachedWordBook.length === 0) return;

  const BOM = "\uFEFF";
  let csv = BOM + "word,time,url\n";
  for (const entry of cachedWordBook) {
    csv += `${csvField(entry.word)},${csvField(entry.time)},${csvField(entry.url)}\n`;
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `qbot-wordbook-${formatDate(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// Clear all
clearBtn.addEventListener("click", () => {
  if (cachedWordBook.length === 0) return;
  if (!confirm("Are you sure you want to clear all words?")) return;

  chrome.runtime.sendMessage({ action: "clearWordBook" }, () => {
    cachedWordBook = [];
    renderWordBook([]);
  });
});

// --- Helpers ---

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function csvField(value) {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function getLangName(code) {
  const names = {
    en: "English", zh: "Chinese", "zh-CN": "Chinese", "zh-TW": "Chinese",
    ja: "Japanese", ko: "Korean", fr: "French", de: "German",
    es: "Spanish", ru: "Russian", pt: "Portuguese", it: "Italian",
  };
  return names[code] || code;
}
