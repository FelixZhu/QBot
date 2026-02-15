const wordListEl = document.getElementById("word-list");
const wordCountEl = document.getElementById("word-count");

async function getVocabulary() {
  const result = await chrome.storage.local.get({ vocabulary: [] });
  return result.vocabulary;
}

async function removeWord(word) {
  const vocabulary = await getVocabulary();
  const filtered = vocabulary.filter((v) => v.word.toLowerCase() !== word.toLowerCase());
  await chrome.storage.local.set({ vocabulary: filtered });
  render();
}

function isChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

function playAudio(word, type) {
  const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`;
  const audio = new Audio(url);
  audio.play();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function render() {
  const vocabulary = await getVocabulary();

  if (vocabulary.length === 0) {
    wordCountEl.textContent = "";
    wordListEl.innerHTML = '<div class="empty-state">还没有收藏任何单词</div>';
    return;
  }

  const sorted = [...vocabulary].sort((a, b) => b.timestamp - a.timestamp);
  wordCountEl.textContent = `共 ${sorted.length} 个单词`;

  let html = '<div class="word-list">';
  for (const item of sorted) {
    const date = new Date(item.timestamp);
    const timeStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

    const isCN = isChinese(item.word);
    const speakerType = isCN ? "1" : "2";

    html += `<div class="word-item">`;
    html += `  <div class="word-info">`;
    html += `    <div class="word-text">${escapeHtml(item.word)}</div>`;
    html += `    <div class="word-meta">`;
    html += `      <span>${timeStr}</span>`;
    if (item.url) {
      let displayUrl;
      try {
        displayUrl = new URL(item.url).hostname;
      } catch {
        displayUrl = item.url;
      }
      html += `<a class="word-url" href="${escapeHtml(item.url)}" target="_blank" title="${escapeHtml(item.url)}">${escapeHtml(displayUrl)}</a>`;
    }
    html += `    </div>`;
    html += `  </div>`;
    html += `  <div class="word-actions">`;
    html += `    <button class="speaker-btn" data-word="${escapeHtml(item.word)}" data-type="${speakerType}" title="发音">&#128264;</button>`;
    html += `    <button class="delete-btn" data-word="${escapeHtml(item.word)}" title="删除">🗑️</button>`;
    html += `  </div>`;
    html += `</div>`;
  }
  html += '</div>';

  wordListEl.innerHTML = html;
}

// Event delegation
wordListEl.addEventListener("click", async (e) => {
  const speakerBtn = e.target.closest(".speaker-btn");
  if (speakerBtn) {
    const word = speakerBtn.dataset.word;
    const type = speakerBtn.dataset.type;
    if (word && type) playAudio(word, type);
    return;
  }

  const deleteBtn = e.target.closest(".delete-btn");
  if (deleteBtn) {
    const word = deleteBtn.dataset.word;
    if (word) await removeWord(word);
  }
});

render();
