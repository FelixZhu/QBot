// Content script: receives lookup messages and displays definition popup

const POPUP_ID = "qbot-word-popup";

// Listen for messages from background script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "lookup" && message.word) {
    lookupWord(message.word);
  }

  if (message.action === "scanVideos") {
    const videos = scanPageForVideos();
    sendResponse({ success: true, videos });
  }

  if (message.action === "scrollToVideo") {
    scrollToNativeVideo(message.videoIndex);
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

// --- Video scanning ---

function scanPageForVideos() {
  const videos = [];

  // 1. HTML5 <video> elements
  const videoElements = document.querySelectorAll("video");
  videoElements.forEach((video, index) => {
    if (video.offsetWidth < 100 && video.offsetHeight < 60) return;
    if (video.offsetWidth === 0 || video.offsetHeight === 0) return;

    const src = video.currentSrc || video.src || "";
    const sourceEl = video.querySelector("source");
    const sourceSrc = sourceEl ? sourceEl.src : "";
    const finalSrc = src || sourceSrc;

    let title = video.getAttribute("title")
      || video.getAttribute("aria-label")
      || "";

    if (!title) {
      const closestTitle = video.closest("[title]");
      if (closestTitle && closestTitle !== video) title = closestTitle.getAttribute("title");
    }
    if (!title) {
      const figure = video.closest("figure");
      if (figure) {
        const caption = figure.querySelector("figcaption");
        if (caption) title = caption.textContent.trim();
      }
    }
    if (!title) {
      const parent = video.parentElement;
      if (parent) {
        const heading = parent.querySelector("h1, h2, h3, h4, h5, h6");
        if (heading) title = heading.textContent.trim();
      }
    }
    if (!title && finalSrc) {
      try {
        const urlPath = new URL(finalSrc, window.location.href).pathname;
        const fileName = urlPath.split("/").pop();
        if (fileName) title = decodeURIComponent(fileName);
      } catch { /* ignore */ }
    }

    const poster = video.poster || "";
    const duration = video.duration ? formatDuration(video.duration) : "";
    const dimensions = (video.videoWidth && video.videoHeight)
      ? `${video.videoWidth}x${video.videoHeight}`
      : (video.offsetWidth && video.offsetHeight)
        ? `${video.offsetWidth}x${video.offsetHeight}`
        : "";

    videos.push({
      type: "video",
      src: finalSrc,
      thumbnail: poster,
      title: title || "",
      duration,
      dimensions,
      nativeIndex: index,
    });
  });

  // 2. iframe embeds
  const iframes = document.querySelectorAll("iframe");
  iframes.forEach((iframe) => {
    const src = iframe.src || iframe.getAttribute("data-src") || "";
    if (!src) return;

    const videoInfo = parseIframeSrc(src);
    if (!videoInfo) return;

    if (iframe.offsetWidth < 100 && iframe.offsetHeight < 60) return;

    const title = iframe.getAttribute("title") || iframe.getAttribute("aria-label") || "";
    const dimensions = (iframe.offsetWidth && iframe.offsetHeight)
      ? `${iframe.offsetWidth}x${iframe.offsetHeight}`
      : "";

    videos.push({
      type: videoInfo.type,
      src: videoInfo.url,
      thumbnail: videoInfo.thumbnail,
      title: title || videoInfo.defaultTitle || "",
      duration: "",
      dimensions,
      nativeIndex: -1,
    });
  });

  // 3. <object> and <embed> elements
  const embeds = document.querySelectorAll("object[data], embed[src]");
  embeds.forEach((el) => {
    const src = el.getAttribute("data") || el.getAttribute("src") || "";
    if (!src) return;
    if (!looksLikeVideoUrl(src)) return;
    if (el.offsetWidth < 100 && el.offsetHeight < 60) return;

    videos.push({
      type: "embed",
      src: src,
      thumbnail: "",
      title: el.getAttribute("title") || "",
      duration: "",
      dimensions: (el.offsetWidth && el.offsetHeight) ? `${el.offsetWidth}x${el.offsetHeight}` : "",
      nativeIndex: -1,
    });
  });

  return videos;
}

function parseIframeSrc(src) {
  let url;
  try {
    url = new URL(src, window.location.href);
  } catch {
    return null;
  }

  const hostname = url.hostname;

  // YouTube
  if (hostname.includes("youtube.com") || hostname.includes("youtube-nocookie.com")) {
    const match = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (match) {
      const videoId = match[1];
      return {
        type: "iframe-youtube",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        defaultTitle: "YouTube 视频",
      };
    }
  }

  // Bilibili
  if (hostname.includes("bilibili.com")) {
    const bvid = url.searchParams.get("bvid");
    const aid = url.searchParams.get("aid");
    if (bvid) {
      return {
        type: "iframe-bilibili",
        url: `https://www.bilibili.com/video/${bvid}`,
        thumbnail: "",
        defaultTitle: "Bilibili 视频",
      };
    }
    if (aid) {
      return {
        type: "iframe-bilibili",
        url: `https://www.bilibili.com/video/av${aid}`,
        thumbnail: "",
        defaultTitle: "Bilibili 视频",
      };
    }
    return {
      type: "iframe-bilibili",
      url: src,
      thumbnail: "",
      defaultTitle: "Bilibili 视频",
    };
  }

  // Vimeo
  if (hostname.includes("player.vimeo.com")) {
    const match = url.pathname.match(/\/video\/(\d+)/);
    if (match) {
      return {
        type: "iframe-vimeo",
        url: `https://vimeo.com/${match[1]}`,
        thumbnail: "",
        defaultTitle: "Vimeo 视频",
      };
    }
  }

  // Dailymotion
  if (hostname.includes("dailymotion.com")) {
    const match = url.pathname.match(/\/embed\/video\/([a-zA-Z0-9]+)/);
    if (match) {
      return {
        type: "iframe-dailymotion",
        url: `https://www.dailymotion.com/video/${match[1]}`,
        thumbnail: `https://www.dailymotion.com/thumbnail/video/${match[1]}`,
        defaultTitle: "Dailymotion 视频",
      };
    }
  }

  // Generic: path contains video/player/embed keywords
  const pathLower = url.pathname.toLowerCase();
  if (pathLower.includes("video") || pathLower.includes("player") || pathLower.includes("embed")) {
    return {
      type: "iframe-other",
      url: src,
      thumbnail: "",
      defaultTitle: "嵌入视频",
    };
  }

  return null;
}

function looksLikeVideoUrl(src) {
  const lower = src.toLowerCase();
  return /\.(mp4|webm|ogg|m3u8|flv|mov|avi|mkv)(\?|#|$)/.test(lower)
    || lower.includes("video") || lower.includes("player");
}

function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function scrollToNativeVideo(nativeIndex) {
  const videoElements = document.querySelectorAll("video");
  const video = videoElements[nativeIndex];
  if (!video) return;

  video.scrollIntoView({ behavior: "smooth", block: "center" });

  const prevOutline = video.style.outline;
  video.style.outline = "3px solid #1a73e8";
  setTimeout(() => {
    video.style.outline = prevOutline;
  }, 2000);

  try {
    video.play();
  } catch {
    // Autoplay may be blocked
  }
}
