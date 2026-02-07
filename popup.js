const input = document.getElementById("word-input");
const searchBtn = document.getElementById("search-btn");
const resultDiv = document.getElementById("result");
const searchView = document.getElementById("search-view");
const vocabView = document.getElementById("vocab-view");
const tabBtns = document.querySelectorAll(".tab-btn");

searchBtn.addEventListener("click", () => search());
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") search();
});

// --- Tab switching ---

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.getAttribute("data-tab");
    tabBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    if (tab === "vocab") {
      searchView.style.display = "none";
      vocabView.style.display = "block";
      renderVocabularyList();
    } else {
      searchView.style.display = "block";
      vocabView.style.display = "none";
    }
  });
});

// --- Vocabulary storage helpers ---

async function getVocabulary() {
  const result = await chrome.storage.local.get({ vocabulary: [] });
  return result.vocabulary;
}

async function saveWordToVocabulary(word) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url || "";
  const timestamp = Date.now();
  const key = word.toLowerCase();

  const vocabulary = await getVocabulary();
  const existingIndex = vocabulary.findIndex((v) => v.word.toLowerCase() === key);
  if (existingIndex >= 0) {
    vocabulary[existingIndex].url = url;
    vocabulary[existingIndex].timestamp = timestamp;
  } else {
    vocabulary.push({ word, url, timestamp });
  }

  await chrome.storage.local.set({ vocabulary });
}

async function removeWordFromVocabulary(word) {
  const vocabulary = await getVocabulary();
  const filtered = vocabulary.filter((v) => v.word.toLowerCase() !== word.toLowerCase());
  await chrome.storage.local.set({ vocabulary: filtered });
}

async function isWordSaved(word) {
  const vocabulary = await getVocabulary();
  return vocabulary.some((v) => v.word.toLowerCase() === word.toLowerCase());
}

// --- Vocabulary list rendering ---

async function renderVocabularyList() {
  const vocabulary = await getVocabulary();

  if (vocabulary.length === 0) {
    vocabView.innerHTML = '<div class="vocab-empty">还没有收藏任何单词</div>';
    return;
  }

  // Sort by timestamp descending (newest first)
  const sorted = [...vocabulary].sort((a, b) => b.timestamp - a.timestamp);

  let html = `<div class="vocab-count">共 ${sorted.length} 个单词</div>`;
  for (const item of sorted) {
    const date = new Date(item.timestamp);
    const timeStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

    html += `<div class="vocab-item">`;
    html += `  <div class="vocab-info">`;
    html += `    <div class="vocab-word">${escapeHtml(item.word)}</div>`;
    html += `    <div class="vocab-meta">`;
    html += `      <span>${timeStr}</span>`;
    if (item.url) {
      let displayUrl;
      try {
        displayUrl = new URL(item.url).hostname;
      } catch {
        displayUrl = item.url;
      }
      html += `      <a class="vocab-url" href="${escapeHtml(item.url)}" target="_blank" title="${escapeHtml(item.url)}">${escapeHtml(displayUrl)}</a>`;
    }
    html += `    </div>`;
    html += `  </div>`;
    html += `  <button class="vocab-delete" data-word="${escapeHtml(item.word)}" title="删除">🗑️</button>`;
    html += `</div>`;
  }

  vocabView.innerHTML = html;
}

// --- Search ---

function isChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

async function search() {
  const word = input.value.trim();
  if (!word) return;

  resultDiv.innerHTML = '<div class="loading">查询中...</div>';

  try {
    const response = await chrome.runtime.sendMessage({ action: "fetchDict", word });
    if (!response || !response.success) {
      resultDiv.innerHTML = `<div class="error">未找到 "<strong>${escapeHtml(word)}</strong>" 的释义。</div>`;
      return;
    }

    const data = response.data;
    if (isChinese(word)) {
      renderChineseResult(data, word);
    } else {
      renderEnglishResult(data, word);
    }

    // Update save button states for already-saved words
    await updateSaveButtonStates();
  } catch {
    resultDiv.innerHTML = '<div class="error">网络错误，请重试。</div>';
  }
}

async function updateSaveButtonStates() {
  const buttons = resultDiv.querySelectorAll(".save-btn");
  for (const btn of buttons) {
    const word = btn.getAttribute("data-word");
    if (word && await isWordSaved(word)) {
      btn.textContent = "\u2705";
    }
  }
}

// --- Render functions ---

function renderEnglishResult(data, word) {
  const ec = data.ec;
  if (!ec || !ec.word) {
    resultDiv.innerHTML = `<div class="error">未找到 "<strong>${escapeHtml(word)}</strong>" 的释义。</div>`;
    return;
  }

  const wordInfo = ec.word;
  const usphone = wordInfo.usphone;
  const ukphone = wordInfo.ukphone;
  const trs = wordInfo.trs || [];
  const returnWord = wordInfo["return-phrase"] || word;

  let html = `<div class="word-title-row"><span class="word-title">${escapeHtml(returnWord)}</span><button class="save-btn" data-word="${escapeHtml(returnWord)}">➕</button></div>`;

  let phoneticParts = [];
  if (ukphone) phoneticParts.push(`UK /${escapeHtml(ukphone)}/`);
  if (usphone) phoneticParts.push(`US /${escapeHtml(usphone)}/`);
  if (phoneticParts.length) {
    html += `<div class="phonetic">${phoneticParts.join("  ")}</div>`;
  }

  for (const tr of trs) {
    const pos = tr.pos || "";
    const tran = tr.tran || "";
    if (pos) html += `<div class="pos">${escapeHtml(pos)}</div>`;
    if (tran) html += `<div class="def">${escapeHtml(tran)}</div>`;
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
      html += `<div class="section-title">例句</div>`;
      for (const ex of examples) {
        html += `<div class="example">${escapeHtml(ex.en)}</div>`;
        html += `<div class="example-cn">${escapeHtml(ex.cn)}</div>`;
      }
    }
  }

  resultDiv.innerHTML = html;
}

function renderChineseResult(data, word) {
  const ce = data.ce;
  const simple = data.simple;

  if (!ce && !simple) {
    resultDiv.innerHTML = `<div class="error">未找到 "<strong>${escapeHtml(word)}</strong>" 的释义。</div>`;
    return;
  }

  const phone = simple?.word?.[0]?.["phone"] || "";
  const returnWord = simple?.word?.[0]?.["return-phrase"] || word;

  let html = `<div class="word-title">${escapeHtml(returnWord)}</div>`;
  if (phone) {
    html += `<div class="phonetic">${escapeHtml(phone)}</div>`;
  }

  if (ce && ce.word) {
    const trs = ce.word.trs || [];
    for (const tr of trs) {
      const text = tr["#text"] || "";
      const tran = tr["#tran"] || "";
      if (text) {
        // Extract English words for save button
        const englishWords = text.match(/[a-zA-Z]+(?:\s+[a-zA-Z]+)*/g);
        const saveWord = englishWords ? englishWords[0] : text;

        html += `<div class="def"><strong>${escapeHtml(text)}</strong><button class="save-btn save-inline" data-word="${escapeHtml(saveWord)}">➕</button></div>`;
        if (tran) html += `<div class="def-detail">${escapeHtml(tran)}</div>`;
      }
    }
  }

  // Bilingual example sentences
  const sents = data.blng_sents_part;
  if (sents && sents["sentence-pair"]) {
    const pairs = sents["sentence-pair"].slice(0, 2);
    if (pairs.length > 0) {
      html += `<div class="section-title">例句</div>`;
      for (const pair of pairs) {
        html += `<div class="example">${escapeHtml(pair["sentence-translation"] || "")}</div>`;
        html += `<div class="example-cn">${escapeHtml(pair.sentence || "")}</div>`;
      }
    }
  }

  resultDiv.innerHTML = html;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Event delegation for save and delete buttons ---

document.addEventListener("click", async (e) => {
  // Handle save button click
  if (e.target && e.target.classList.contains("save-btn")) {
    const word = e.target.getAttribute("data-word");
    if (!word) return;
    try {
      await saveWordToVocabulary(word);
      e.target.textContent = "\u2705";
    } catch {
      // Silently fail
    }
    return;
  }

  // Handle vocab delete button click
  if (e.target && e.target.classList.contains("vocab-delete")) {
    const word = e.target.getAttribute("data-word");
    if (!word) return;
    try {
      await removeWordFromVocabulary(word);
      renderVocabularyList();
    } catch {
      // Silently fail
    }
  }
});
