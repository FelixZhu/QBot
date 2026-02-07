// Content script: receives lookup messages and displays definition popup

const POPUP_ID = "qbot-word-popup";

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "lookup" && message.word) {
    lookupWord(message.word);
  }
});

// Detect if text is primarily Chinese
function isChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

// --- Vocabulary storage helpers ---

async function saveWordToVocabulary(word) {
  const url = window.location.href;
  const timestamp = Date.now();
  const key = word.toLowerCase();

  const result = await chrome.storage.local.get({ vocabulary: [] });
  const vocabulary = result.vocabulary;

  const existingIndex = vocabulary.findIndex((v) => v.word.toLowerCase() === key);
  if (existingIndex >= 0) {
    vocabulary[existingIndex].url = url;
    vocabulary[existingIndex].timestamp = timestamp;
  } else {
    vocabulary.push({ word, url, timestamp });
  }

  await chrome.storage.local.set({ vocabulary });
}

async function isWordSaved(word) {
  const result = await chrome.storage.local.get({ vocabulary: [] });
  return result.vocabulary.some((v) => v.word.toLowerCase() === word.toLowerCase());
}

// Look up word via background script (avoids CORS issues)
async function lookupWord(word) {
  removePopup();

  const popup = createPopup();
  popup.innerHTML = renderLoading(word);
  document.body.appendChild(popup);
  positionPopup(popup);

  try {
    const response = await chrome.runtime.sendMessage({ action: "fetchDict", word });
    if (!response || !response.success) {
      popup.innerHTML = renderNotFound(word);
      return;
    }

    const data = response.data;
    if (isChinese(word) && data.ce) {
      popup.innerHTML = renderChineseResult(word, data);
    } else if (!isChinese(word) && data.ec && data.ec.word) {
      popup.innerHTML = renderEnglishResult(word, data);
    } else if (data.fanyi) {
      popup.innerHTML = renderTranslation(word, data);
    } else if (data.web_trans && data.web_trans["web-translation"]) {
      popup.innerHTML = renderWebTranslation(word, data);
    } else {
      popup.innerHTML = renderNotFound(word);
    }

    // Update save button states for already-saved words
    await updateSaveButtonStates(popup);
  } catch {
    popup.innerHTML = renderError(word);
  }
}

// Check saved status and update all save buttons in the popup
async function updateSaveButtonStates(popup) {
  const buttons = popup.querySelectorAll(".qbot-save-btn");
  for (const btn of buttons) {
    const word = btn.getAttribute("data-word");
    if (word && await isWordSaved(word)) {
      btn.textContent = "\u2705";
    }
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

// Press T to translate selected text
document.addEventListener("keydown", (e) => {
  if (e.key === "t" || e.key === "T") {
    // Skip if user is typing in an input/textarea/contenteditable
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;

    const selection = window.getSelection().toString().trim();
    if (selection) {
      lookupWord(selection);
    }
  }
});

// --- Audio playback ---

function playAudio(word, type) {
  const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`;
  const audio = new Audio(url);
  audio.play();
}

// Delegate speaker button clicks
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".qbot-speaker");
  if (btn) {
    const word = btn.dataset.word;
    const type = btn.dataset.type;
    if (word && type) playAudio(word, type);
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
        <span>查询中...</span>
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
      <div class="qbot-not-found">未找到 "<strong>${escapeHtml(word)}</strong>" 的释义</div>
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
      <div class="qbot-error">网络错误，请检查网络连接后重试。</div>
    </div>
  `;
}

// Render English word lookup result (English -> Chinese)
function renderEnglishResult(word, data) {
  const ec = data.ec;
  if (!ec || !ec.word) return renderNotFound(word);

  const wordInfo = ec.word;
  const usphone = wordInfo.usphone;
  const ukphone = wordInfo.ukphone;
  const trs = wordInfo.trs || [];
  const returnWord = wordInfo["return-phrase"] || word;

  let phoneticHtml = "";
  if (ukphone) phoneticHtml += `<span class="qbot-phonetic">UK /${escapeHtml(ukphone)}/ <button class="qbot-speaker" data-word="${escapeHtml(returnWord)}" data-type="1" title="英式发音">&#128264;</button></span>`;
  if (usphone) phoneticHtml += `<span class="qbot-phonetic">US /${escapeHtml(usphone)}/ <button class="qbot-speaker" data-word="${escapeHtml(returnWord)}" data-type="2" title="美式发音">&#128264;</button></span>`;

  let html = `
    <div class="qbot-header">
      <div class="qbot-title-row">
        <span class="qbot-word">${escapeHtml(returnWord)}</span>
      </div>
      <button class="qbot-save-btn" data-word="${escapeHtml(returnWord)}">➕</button>
      <button class="qbot-close" id="qbot-close-btn">&times;</button>
    </div>
    <div class="qbot-body">
  `;

  if (phoneticHtml) {
    html += `<div class="qbot-phonetics">${phoneticHtml}</div>`;
  }

  // EC definitions (English-Chinese)
  for (const tr of trs) {
    const pos = tr.pos || "";
    const tran = tr.tran || "";
    if (pos || tran) {
      html += `<div class="qbot-meaning">`;
      if (pos) html += `<span class="qbot-pos">${escapeHtml(pos)}</span>`;
      html += `<div class="qbot-def">${escapeHtml(tran)}</div>`;
      html += `</div>`;
    }
  }

  // Collins example sentences
  const collins = data.collins;
  if (collins && collins.collins_entries) {
    const examples = [];
    for (const ce of collins.collins_entries) {
      for (const entry of (ce.entries?.entry || [])) {
        for (const te of (entry.tran_entry || [])) {
          for (const sent of (te.exam_sents?.sent || [])) {
            if (sent.eng_sent && sent.chn_sent) {
              examples.push({ en: sent.eng_sent, cn: sent.chn_sent });
            }
            if (examples.length >= 2) break;
          }
          if (examples.length >= 2) break;
        }
        if (examples.length >= 2) break;
      }
      if (examples.length >= 2) break;
    }
    if (examples.length > 0) {
      html += `<div class="qbot-section-title">例句</div>`;
      for (const ex of examples) {
        html += `<div class="qbot-example">${escapeHtml(ex.en)}</div>`;
        html += `<div class="qbot-example-cn">${escapeHtml(ex.cn)}</div>`;
      }
    }
  }

  html += `</div>`;
  return html;
}

// Render Chinese word lookup result (Chinese -> English)
function renderChineseResult(word, data) {
  const ce = data.ce;
  const simple = data.simple;

  if (!ce && !simple) return renderNotFound(word);

  const phone = simple?.word?.[0]?.["phone"] || "";
  const returnWord = simple?.word?.[0]?.["return-phrase"] || word;

  let html = `
    <div class="qbot-header">
      <div class="qbot-title-row">
        <span class="qbot-word">${escapeHtml(returnWord)}</span>
      </div>
      <button class="qbot-close" id="qbot-close-btn">&times;</button>
    </div>
    <div class="qbot-body">
  `;

  if (phone) {
    html += `<div class="qbot-phonetics"><span class="qbot-phonetic">${escapeHtml(phone)} <button class="qbot-speaker" data-word="${escapeHtml(returnWord)}" data-type="1" title="发音">&#128264;</button></span></div>`;
  }

  // CE translations with inline save buttons for English words
  if (ce && ce.word) {
    const trs = ce.word.trs || [];
    for (const tr of trs) {
      const text = tr["#text"] || "";
      const tran = tr["#tran"] || "";
      if (text) {
        // Extract English words from the translation text for the save button
        const englishWords = text.match(/[a-zA-Z]+(?:\s+[a-zA-Z]+)*/g);
        const saveWord = englishWords ? englishWords[0] : text;

        html += `<div class="qbot-meaning">`;
        html += `<div class="qbot-def"><strong>${escapeHtml(text)}</strong>`;
        html += `<button class="qbot-save-btn qbot-save-inline" data-word="${escapeHtml(saveWord)}">➕</button>`;
        html += `</div>`;
        if (tran) {
          html += `<div class="qbot-def-detail">${escapeHtml(tran)}</div>`;
        }
        html += `</div>`;
      }
    }
  }

  // Bilingual example sentences
  const sents = data.blng_sents_part;
  if (sents && sents["sentence-pair"]) {
    const pairs = sents["sentence-pair"].slice(0, 2);
    if (pairs.length > 0) {
      html += `<div class="qbot-section-title">例句</div>`;
      for (const pair of pairs) {
        html += `<div class="qbot-example">${escapeHtml(pair["sentence-translation"] || "")}</div>`;
        html += `<div class="qbot-example-cn">${escapeHtml(pair.sentence || "")}</div>`;
      }
    }
  }

  html += `</div>`;
  return html;
}

// Render sentence translation result (using fanyi field)
function renderTranslation(word, data) {
  const fanyi = data.fanyi;
  const tran = fanyi.tran || "";
  const isCN = isChinese(word);
  const speakerType = isCN ? "1" : "2";

  let html = `
    <div class="qbot-header">
      <div class="qbot-title-row">
        <span class="qbot-word">翻译</span>
      </div>
      <button class="qbot-close" id="qbot-close-btn">&times;</button>
    </div>
    <div class="qbot-body">
      <div class="qbot-translation-src">${escapeHtml(word)} <button class="qbot-speaker" data-word="${escapeHtml(word)}" data-type="${speakerType}" title="发音">&#128264;</button></div>
      <div class="qbot-translation-tran">${escapeHtml(tran)}</div>
    </div>
  `;
  return html;
}

// Render translation from web_trans (fallback for short phrases)
function renderWebTranslation(word, data) {
  const webTrans = data.web_trans["web-translation"];
  const tran = webTrans[0]?.trans?.[0]?.value || "";
  if (!tran) return renderNotFound(word);

  const isCN = isChinese(word);
  const speakerType = isCN ? "1" : "2";

  let html = `
    <div class="qbot-header">
      <div class="qbot-title-row">
        <span class="qbot-word">翻译</span>
      </div>
      <button class="qbot-close" id="qbot-close-btn">&times;</button>
    </div>
    <div class="qbot-body">
      <div class="qbot-translation-src">${escapeHtml(word)} <button class="qbot-speaker" data-word="${escapeHtml(word)}" data-type="${speakerType}" title="发音">&#128264;</button></div>
      <div class="qbot-translation-tran">${escapeHtml(tran)}</div>
    </div>
  `;
  return html;
}

// Escape HTML to prevent XSS
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Delegate close button and save button clicks
document.addEventListener("click", async (e) => {
  if (e.target && e.target.id === "qbot-close-btn") {
    removePopup();
    return;
  }

  // Handle save button click
  if (e.target && e.target.classList.contains("qbot-save-btn")) {
    const word = e.target.getAttribute("data-word");
    if (!word) return;

    try {
      await saveWordToVocabulary(word);
      e.target.textContent = "\u2705";
    } catch {
      // Silently fail
    }
  }
});
