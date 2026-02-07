const input = document.getElementById("word-input");
const searchBtn = document.getElementById("search-btn");
const resultDiv = document.getElementById("result");

searchBtn.addEventListener("click", () => search());
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") search();
});

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
  } catch {
    resultDiv.innerHTML = '<div class="error">网络错误，请重试。</div>';
  }
}

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

  let html = `<div class="word-title">${escapeHtml(returnWord)}</div>`;

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
        html += `<div class="def"><strong>${escapeHtml(text)}</strong></div>`;
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
