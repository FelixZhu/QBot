const API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const input = document.getElementById("word-input");
const searchBtn = document.getElementById("search-btn");
const resultDiv = document.getElementById("result");

searchBtn.addEventListener("click", () => search());
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") search();
});

async function search() {
  const word = input.value.trim();
  if (!word) return;

  resultDiv.innerHTML = '<div class="loading">Looking up...</div>';

  try {
    const response = await fetch(`${API_URL}${encodeURIComponent(word)}`);
    if (!response.ok) {
      resultDiv.innerHTML = `<div class="error">No definition found for "<strong>${escapeHtml(word)}</strong>".</div>`;
      return;
    }

    const data = await response.json();
    renderResult(data);
  } catch {
    resultDiv.innerHTML = '<div class="error">Network error. Please try again.</div>';
  }
}

function renderResult(data) {
  const entry = data[0];
  const phonetic = getPhonetic(entry);

  let html = `<div class="word-title">${escapeHtml(entry.word)}</div>`;
  if (phonetic) {
    html += `<div class="phonetic">${escapeHtml(phonetic)}</div>`;
  }

  for (const meaning of entry.meanings || []) {
    html += `<div class="pos">${escapeHtml(meaning.partOfSpeech)}</div>`;
    const defs = (meaning.definitions || []).slice(0, 3);
    for (let i = 0; i < defs.length; i++) {
      html += `<div class="def">${i + 1}. ${escapeHtml(defs[i].definition)}</div>`;
      if (defs[i].example) {
        html += `<div class="example">"${escapeHtml(defs[i].example)}"</div>`;
      }
    }
  }

  resultDiv.innerHTML = html;
}

function getPhonetic(entry) {
  if (entry.phonetic) return entry.phonetic;
  for (const p of entry.phonetics || []) {
    if (p.text) return p.text;
  }
  return null;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
