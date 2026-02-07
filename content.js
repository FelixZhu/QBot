// Content script: receives lookup messages and displays definition popup

const POPUP_ID = "qbot-word-popup";
const API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/";

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "lookup" && message.word) {
    lookupWord(message.word);
  }
});

// Look up word via Free Dictionary API and show popup
async function lookupWord(word) {
  removePopup();

  const popup = createPopup();
  popup.innerHTML = renderLoading(word);
  document.body.appendChild(popup);
  positionPopup(popup);

  try {
    const response = await fetch(`${API_URL}${encodeURIComponent(word)}`);
    if (!response.ok) {
      popup.innerHTML = renderNotFound(word);
      return;
    }

    const data = await response.json();
    popup.innerHTML = renderDefinition(word, data);
  } catch {
    popup.innerHTML = renderError(word);
  }
}

// Create the popup container element
function createPopup() {
  const popup = document.createElement("div");
  popup.id = POPUP_ID;
  return popup;
}

// Position popup near the text selection
function positionPopup(popup) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  let top = rect.bottom + window.scrollY + 8;
  let left = rect.left + window.scrollX;

  // Ensure popup doesn't go off-screen right
  const popupWidth = 360;
  if (left + popupWidth > window.innerWidth + window.scrollX) {
    left = window.innerWidth + window.scrollX - popupWidth - 16;
  }
  if (left < window.scrollX) {
    left = window.scrollX + 16;
  }

  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
}

// Remove existing popup
function removePopup() {
  const existing = document.getElementById(POPUP_ID);
  if (existing) {
    existing.remove();
  }
}

// Close popup when clicking outside
document.addEventListener("mousedown", (e) => {
  const popup = document.getElementById(POPUP_ID);
  if (popup && !popup.contains(e.target)) {
    popup.remove();
  }
});

// Close popup on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    removePopup();
  }
});

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
        <span>Looking up...</span>
      </div>
    </div>
  `;
}

function renderNotFound(word) {
  return `
    <div class="qbot-header">
      <span class="qbot-word">${escapeHtml(word)}</span>
      <button class="qbot-close" id="qbot-close-btn">&times;</button>
    </div>
    <div class="qbot-body">
      <div class="qbot-not-found">No definition found for "<strong>${escapeHtml(word)}</strong>"</div>
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
      <div class="qbot-error">Network error. Please check your connection and try again.</div>
    </div>
  `;
}

function renderDefinition(word, data) {
  const entry = data[0];
  const phonetic = getPhonetic(entry);

  let html = `
    <div class="qbot-header">
      <div class="qbot-title-row">
        <span class="qbot-word">${escapeHtml(entry.word || word)}</span>
        ${phonetic ? `<span class="qbot-phonetic">${escapeHtml(phonetic)}</span>` : ""}
      </div>
      <button class="qbot-close" id="qbot-close-btn">&times;</button>
    </div>
    <div class="qbot-body">
  `;

  // Render each meaning (part of speech + definitions)
  const meanings = entry.meanings || [];
  for (const meaning of meanings) {
    html += `<div class="qbot-meaning">`;
    html += `<div class="qbot-pos">${escapeHtml(meaning.partOfSpeech)}</div>`;

    const definitions = (meaning.definitions || []).slice(0, 3);
    for (let i = 0; i < definitions.length; i++) {
      const def = definitions[i];
      html += `<div class="qbot-def">${i + 1}. ${escapeHtml(def.definition)}</div>`;
      if (def.example) {
        html += `<div class="qbot-example">"${escapeHtml(def.example)}"</div>`;
      }
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

// Extract the best phonetic text
function getPhonetic(entry) {
  if (entry.phonetic) return entry.phonetic;
  const phonetics = entry.phonetics || [];
  for (const p of phonetics) {
    if (p.text) return p.text;
  }
  return null;
}

// Escape HTML to prevent XSS
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Delegate close button click (works for dynamically rendered buttons)
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "qbot-close-btn") {
    removePopup();
  }
});
