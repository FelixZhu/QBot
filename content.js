// Content script: displays translation popup and handles word book actions

const POPUP_ID = "qbot-word-popup";
const TOAST_ID = "qbot-toast";

// State for current translation (used by "add to word book" button)
let currentTranslation = null;

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message) => {
  switch (message.action) {
    case "showLoading":
      showPopupWithContent(renderLoading(message.word));
      break;
    case "showTranslation":
      currentTranslation = message;
      showPopupWithContent(renderTranslation(message));
      break;
    case "showTranslateError":
      showPopupWithContent(renderError(message.word));
      break;
    case "showAddedToast":
      showToast(message.word, message.error);
      break;
  }
});

// --- Popup management ---

function showPopupWithContent(html) {
  removePopup();
  const popup = document.createElement("div");
  popup.id = POPUP_ID;
  popup.innerHTML = html;
  document.body.appendChild(popup);
  positionPopup(popup);
}

function positionPopup(popup) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  let top = rect.bottom + window.scrollY + 8;
  let left = rect.left + window.scrollX;

  const popupWidth = 380;
  if (left + popupWidth > window.innerWidth + window.scrollX) {
    left = window.innerWidth + window.scrollX - popupWidth - 16;
  }
  if (left < window.scrollX) {
    left = window.scrollX + 16;
  }

  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
}

function removePopup() {
  const existing = document.getElementById(POPUP_ID);
  if (existing) existing.remove();
  currentTranslation = null;
}

// Close popup on outside click
document.addEventListener("mousedown", (e) => {
  const popup = document.getElementById(POPUP_ID);
  if (popup && !popup.contains(e.target)) {
    removePopup();
  }
});

// Close popup on Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") removePopup();
});

// Delegate button clicks inside popup
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "qbot-close-btn") {
    removePopup();
  }
  if (e.target && e.target.id === "qbot-add-word-btn") {
    addWordFromPopup();
  }
});

// --- Add to word book from translation popup ---

function addWordFromPopup() {
  if (!currentTranslation) return;

  const { original, translated, targetLang } = currentTranslation;
  // Always save the English word
  const englishWord = targetLang === "en" ? translated : original;
  const url = currentTranslation.url || window.location.href;

  const btn = document.getElementById("qbot-add-word-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Adding...";
  }

  chrome.runtime.sendMessage(
    { action: "addToWordBook", word: englishWord, url },
    () => {
      if (btn) {
        btn.textContent = "Added!";
        btn.classList.add("qbot-btn-done");
      }
    }
  );
}

// --- Toast notification ---

function showToast(word, isError) {
  removeToast();
  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  if (isError) {
    toast.className = "qbot-toast-error";
    toast.textContent = `Failed to add "${word}"`;
  } else {
    toast.textContent = `"${word}" added to word book`;
  }
  document.body.appendChild(toast);

  // Auto-remove after 2 seconds
  setTimeout(() => removeToast(), 2000);
}

function removeToast() {
  const existing = document.getElementById(TOAST_ID);
  if (existing) existing.remove();
}

// --- Render functions ---

function renderLoading(word) {
  return `
    <div class="qbot-header">
      <span class="qbot-word">${escapeHtml(word)}</span>
      <button class="qbot-close" id="qbot-close-btn">&times;</button>
    </div>
    <div class="qbot-body">
      <div class="qbot-loading">
        <div class="qbot-spinner"></div>
        <span>Translating...</span>
      </div>
    </div>
  `;
}

function renderError(word) {
  return `
    <div class="qbot-header">
      <span class="qbot-word">${escapeHtml(word)}</span>
      <button class="qbot-close" id="qbot-close-btn">&times;</button>
    </div>
    <div class="qbot-body">
      <div class="qbot-error">Translation failed. Please check your connection and try again.</div>
    </div>
  `;
}

function renderTranslation(data) {
  const { original, translated, detectedLang, targetLang } = data;

  const langLabel =
    targetLang === "en" ? "Chinese → English" : `${getLangName(detectedLang)} → Chinese`;

  return `
    <div class="qbot-header">
      <div class="qbot-title-row">
        <span class="qbot-word">${escapeHtml(original)}</span>
        <span class="qbot-lang-badge">${escapeHtml(langLabel)}</span>
      </div>
      <div class="qbot-header-actions">
        <button class="qbot-add-btn" id="qbot-add-word-btn" title="Add to word book">Q 加入单词本</button>
        <button class="qbot-close" id="qbot-close-btn">&times;</button>
      </div>
    </div>
    <div class="qbot-body">
      <div class="qbot-translation">${escapeHtml(translated)}</div>
    </div>
  `;
}

function getLangName(code) {
  const names = {
    en: "English",
    zh: "Chinese",
    "zh-CN": "Chinese",
    "zh-TW": "Chinese",
    ja: "Japanese",
    ko: "Korean",
    fr: "French",
    de: "German",
    es: "Spanish",
    ru: "Russian",
    pt: "Portuguese",
    it: "Italian",
    ar: "Arabic",
    th: "Thai",
    vi: "Vietnamese",
  };
  return names[code] || code;
}

// Escape HTML to prevent XSS
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
