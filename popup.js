const input = document.getElementById("word-input");
const searchBtn = document.getElementById("search-btn");
const resultDiv = document.getElementById("result");
const toolsView = document.getElementById("tools-view");
const searchView = document.getElementById("search-view");
const vocabView = document.getElementById("vocab-view");
const mediaView = document.getElementById("media-view");
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

    toolsView.style.display = "none";
    searchView.style.display = "none";
    vocabView.style.display = "none";
    mediaView.style.display = "none";

    if (tab === "tools") {
      toolsView.style.display = "block";
    } else if (tab === "vocab") {
      vocabView.style.display = "block";
      renderVocabularyList();
    } else if (tab === "media") {
      mediaView.style.display = "block";
      scanAndRenderMedia();
    } else {
      searchView.style.display = "block";
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

  let html = `<div class="vocab-header"><span class="vocab-count">共 ${sorted.length} 个单词</span><button class="vocab-expand-btn" id="vocab-expand-all">查看全部</button></div>`;
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

function playAudio(word, type) {
  const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`;
  const audio = new Audio(url);
  audio.play();
}

resultDiv.addEventListener("click", (e) => {
  const btn = e.target.closest(".speaker-btn");
  if (btn) {
    const word = btn.dataset.word;
    const type = btn.dataset.type;
    if (word && type) playAudio(word, type);
  }
});

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
    if (isChinese(word) && data.ce) {
      renderChineseResult(data, word);
    } else if (!isChinese(word) && data.ec && data.ec.word) {
      renderEnglishResult(data, word);
    } else if (data.fanyi) {
      renderTranslation(data, word);
    } else if (data.web_trans && data.web_trans["web-translation"]) {
      renderWebTranslation(data, word);
    } else {
      resultDiv.innerHTML = `<div class="error">未找到 "<strong>${escapeHtml(word)}</strong>" 的释义。</div>`;
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
  if (ukphone) phoneticParts.push(`UK /${escapeHtml(ukphone)}/ <button class="speaker-btn" data-word="${escapeHtml(returnWord)}" data-type="1" title="英式发音">&#128264;</button>`);
  if (usphone) phoneticParts.push(`US /${escapeHtml(usphone)}/ <button class="speaker-btn" data-word="${escapeHtml(returnWord)}" data-type="2" title="美式发音">&#128264;</button>`);
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
    html += `<div class="phonetic">${escapeHtml(phone)} <button class="speaker-btn" data-word="${escapeHtml(returnWord)}" data-type="1" title="发音">&#128264;</button></div>`;
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

function renderTranslation(data, word) {
  const fanyi = data.fanyi;
  const tran = fanyi.tran || "";
  const isCN = isChinese(word);
  const speakerType = isCN ? "1" : "2";

  let html = `<div class="word-title">翻译</div>`;
  html += `<div class="translation-src">${escapeHtml(word)} <button class="speaker-btn" data-word="${escapeHtml(word)}" data-type="${speakerType}" title="发音">&#128264;</button></div>`;
  html += `<div class="translation-tran">${escapeHtml(tran)}</div>`;

  resultDiv.innerHTML = html;
}

function renderWebTranslation(data, word) {
  const webTrans = data.web_trans["web-translation"];
  const tran = webTrans[0]?.trans?.[0]?.value || "";
  if (!tran) {
    resultDiv.innerHTML = `<div class="error">未找到 "<strong>${escapeHtml(word)}</strong>" 的释义。</div>`;
    return;
  }

  const isCN = isChinese(word);
  const speakerType = isCN ? "1" : "2";

  let html = `<div class="word-title">翻译</div>`;
  html += `<div class="translation-src">${escapeHtml(word)} <button class="speaker-btn" data-word="${escapeHtml(word)}" data-type="${speakerType}" title="发音">&#128264;</button></div>`;
  html += `<div class="translation-tran">${escapeHtml(tran)}</div>`;

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

  // Handle "查看全部" button click
  if (e.target && e.target.id === "vocab-expand-all") {
    chrome.tabs.create({ url: chrome.runtime.getURL("vocab.html") });
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
    return;
  }

  // Handle media download button click
  if (e.target && e.target.classList.contains("media-download-btn")) {
    e.stopPropagation();
    const url = e.target.getAttribute("data-download-url");
    const filename = e.target.getAttribute("data-download-name") || "video.mp4";
    if (!url) return;
    try {
      await chrome.runtime.sendMessage({ action: "downloadVideo", url, filename });
    } catch {
      // Silently fail
    }
    return;
  }

  // Handle media open button click
  if (e.target && e.target.classList.contains("media-open-btn")) {
    e.stopPropagation();
    const url = e.target.getAttribute("data-open-url");
    if (url) chrome.tabs.create({ url });
    return;
  }

  // Handle media item click (navigate to video)
  const mediaItem = e.target.closest(".media-item");
  if (mediaItem) {
    const type = mediaItem.getAttribute("data-media-type");
    const src = mediaItem.getAttribute("data-media-src");
    const nativeIndex = parseInt(mediaItem.getAttribute("data-native-index"), 10);

    if (type === "video" && nativeIndex >= 0) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: "scrollToVideo", videoIndex: nativeIndex });
        window.close();
      }
    } else if (src) {
      chrome.tabs.create({ url: src });
    }
    return;
  }
});

// --- Media content scanning and rendering ---

async function scanAndRenderMedia() {
  mediaView.innerHTML = '<div class="media-loading">正在扫描页面视频...</div>';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      mediaView.innerHTML = '<div class="media-error">无法访问当前标签页</div>';
      return;
    }

    if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:"))) {
      mediaView.innerHTML = '<div class="media-empty">此页面不支持扫描媒体内容</div>';
      return;
    }

    // Fetch from both sources in parallel
    const [domResult, networkResult] = await Promise.allSettled([
      chrome.tabs.sendMessage(tab.id, { action: "scanVideos" }),
      chrome.runtime.sendMessage({ action: "getDetectedMedia", tabId: tab.id }),
    ]);

    const domVideos = (domResult.status === "fulfilled" && domResult.value?.success)
      ? domResult.value.videos
      : [];

    const networkMedia = (networkResult.status === "fulfilled" && networkResult.value?.success)
      ? networkResult.value.media
      : [];

    // Merge: DOM videos first, then add network-detected URLs not already in DOM results
    const seenUrls = new Set(domVideos.map((v) => v.src).filter(Boolean));
    const mergedVideos = [...domVideos];

    for (const item of networkMedia) {
      if (item.url && !seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        let filename = "";
        try {
          filename = new URL(item.url).pathname.split("/").pop() || "";
        } catch { /* ignore */ }
        mergedVideos.push({
          type: "network",
          src: item.url,
          thumbnail: "",
          title: filename ? decodeURIComponent(filename) : "网络视频",
          duration: "",
          dimensions: "",
          nativeIndex: -1,
        });
      }
    }

    if (mergedVideos.length === 0) {
      mediaView.innerHTML = '<div class="media-empty">当前页面未发现视频内容</div>';
      return;
    }

    renderMediaList(mergedVideos);
  } catch {
    mediaView.innerHTML = '<div class="media-error">无法连接到页面，请刷新页面后重试</div>';
  }
}

function renderMediaList(videos) {
  let html = `<div class="media-count">发现 ${videos.length} 个视频</div>`;

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const title = video.title || `视频 ${i + 1}`;
    const type = video.type || "video";
    const nativeIndex = video.nativeIndex ?? -1;
    const isDownloadable = video.src && !video.src.startsWith("blob:") && isDirectVideoUrl(video.src);
    const isEmbedPlatform = type.startsWith("iframe-");

    let thumbHtml;
    if (video.thumbnail) {
      thumbHtml = `<img class="media-thumb" src="${escapeHtml(video.thumbnail)}" alt="">`;
    } else {
      thumbHtml = `<div class="media-thumb-placeholder">&#9654;</div>`;
    }

    const typeLabelMap = {
      "video": "VIDEO",
      "iframe-youtube": "YOUTUBE",
      "iframe-bilibili": "BILIBILI",
      "iframe-vimeo": "VIMEO",
      "iframe-dailymotion": "DAILYMOTION",
      "iframe-other": "EMBED",
      "embed": "EMBED",
      "network": "NETWORK",
    };
    const typeLabel = typeLabelMap[type] || type.toUpperCase();

    html += `<div class="media-item" data-native-index="${nativeIndex}" data-media-src="${escapeHtml(video.src || "")}" data-media-type="${escapeHtml(type)}">`;
    html += thumbHtml;
    html += `<div class="media-info">`;
    html += `<div class="media-title">${escapeHtml(title)}</div>`;
    html += `<div class="media-meta">`;
    html += `<span class="media-type-badge">${typeLabel}</span>`;
    if (video.duration) html += ` <span>${escapeHtml(video.duration)}</span>`;
    if (video.dimensions) html += ` <span>${escapeHtml(video.dimensions)}</span>`;
    html += `</div>`;

    // Download or Open button
    if (isDownloadable) {
      const filename = extractFilename(video.src, title);
      html += `<button class="media-download-btn" data-download-url="${escapeHtml(video.src)}" data-download-name="${escapeHtml(filename)}">⬇ 下载</button>`;
    } else if (isEmbedPlatform && video.src) {
      html += `<button class="media-open-btn" data-open-url="${escapeHtml(video.src)}">↗ 打开</button>`;
    }

    html += `</div></div>`;
  }

  mediaView.innerHTML = html;

  // Handle thumbnail load errors
  mediaView.querySelectorAll(".media-thumb").forEach((img) => {
    img.addEventListener("error", () => {
      const placeholder = document.createElement("div");
      placeholder.className = "media-thumb-placeholder";
      placeholder.innerHTML = "&#9654;";
      img.replaceWith(placeholder);
    });
  });
}

function isDirectVideoUrl(url) {
  if (!url) return false;
  try {
    const pathname = new URL(url, "https://example.com").pathname.toLowerCase();
    return /\.(mp4|webm|ogg|m3u8|mpd|flv|mov|avi|mkv|ts|m4s)(\?|$)/i.test(url)
      || pathname.includes("videoplayback");
  } catch {
    return false;
  }
}

function extractFilename(url, title) {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").pop();
    if (filename && /\.\w{2,5}$/.test(filename)) {
      return decodeURIComponent(filename);
    }
  } catch { /* ignore */ }
  // Fallback to title-based filename
  const safeName = (title || "video").replace(/[^\w\u4e00-\u9fff\s-]/g, "").trim().slice(0, 60);
  return `${safeName}.mp4`;
}

// --- Save page as PDF ---

const savePdfBtn = document.getElementById("save-pdf-btn");
const pdfStatus = document.getElementById("pdf-status");
const pdfProgressFill = document.getElementById("pdf-progress-fill");
const pdfStatusText = document.getElementById("pdf-status-text");

let isSavingPdf = false;

savePdfBtn.addEventListener("click", async () => {
  if (isSavingPdf) return;
  isSavingPdf = true;
  savePdfBtn.disabled = true;
  pdfStatus.style.display = "block";
  pdfProgressFill.style.width = "0%";
  pdfStatusText.textContent = "正在准备页面信息...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error("无法访问当前标签页");
    }

    if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:"))) {
      throw new Error("此页面不支持保存为 PDF");
    }

    // Step 1: Get page dimensions from content script
    pdfStatusText.textContent = "正在获取页面尺寸...";
    const pageInfo = await chrome.tabs.sendMessage(tab.id, { action: "getPageInfo" });
    if (!pageInfo || !pageInfo.success) {
      throw new Error("无法获取页面信息，请刷新页面重试");
    }

    const { totalHeight, viewportHeight, viewportWidth, devicePixelRatio, title } = pageInfo;
    const steps = Math.ceil(totalHeight / viewportHeight);
    const screenshots = [];

    pdfStatusText.textContent = `正在截图 (0/${steps})...`;

    // Step 2: Scroll step-by-step and capture each viewport
    for (let i = 0; i < steps; i++) {
      const scrollY = i * viewportHeight;
      // Tell content script to scroll to position
      await chrome.tabs.sendMessage(tab.id, { action: "scrollToPosition", scrollY });
      // Wait for rendering
      await sleep(350);
      // Capture visible tab
      const dataUrl = await chrome.runtime.sendMessage({ action: "captureTab" });
      if (!dataUrl || !dataUrl.success) {
        throw new Error("截图失败");
      }
      screenshots.push({
        dataUrl: dataUrl.data,
        scrollY,
        // The last step may be a partial viewport
        isLast: i === steps - 1,
      });

      const progress = Math.round(((i + 1) / steps) * 80);
      pdfProgressFill.style.width = `${progress}%`;
      pdfStatusText.textContent = `正在截图 (${i + 1}/${steps})...`;
    }

    // Step 3: Restore scroll position
    await chrome.tabs.sendMessage(tab.id, { action: "scrollToPosition", scrollY: 0 });

    // Step 4: Stitch into PDF using canvas
    pdfStatusText.textContent = "正在生成 PDF...";
    pdfProgressFill.style.width = "85%";

    await generatePdfFromScreenshots(screenshots, {
      totalHeight,
      viewportHeight,
      viewportWidth,
      devicePixelRatio,
      title: title || "webpage",
    });

    pdfProgressFill.style.width = "100%";
    pdfStatusText.textContent = "✅ PDF 保存成功！";

  } catch (err) {
    pdfStatusText.textContent = `❌ ${err.message || "保存失败，请重试"}`;
  } finally {
    isSavingPdf = false;
    savePdfBtn.disabled = false;
    setTimeout(() => {
      pdfStatus.style.display = "none";
    }, 3000);
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generatePdfFromScreenshots(screenshots, info) {
  const { totalHeight, viewportHeight, viewportWidth, devicePixelRatio, title } = info;

  // Load all images
  const images = [];
  for (const s of screenshots) {
    const img = await loadImage(s.dataUrl);
    images.push({ img, scrollY: s.scrollY, isLast: s.isLast });
  }

  // Create a full-page canvas to stitch all screenshots
  const canvasWidth = viewportWidth * devicePixelRatio;
  const canvasFullHeight = totalHeight * devicePixelRatio;

  // We'll generate the PDF page by page to avoid huge canvas
  // Each screenshot = one "page" worth of content
  // Use the first image to determine actual captured dimensions
  const capturedWidth = images[0].img.width;
  const capturedHeight = images[0].img.height;

  // PDF dimensions in points (72 dpi); use A4-like ratio based on viewport
  const pdfPageWidth = 595.28; // A4 width in points
  const pdfPageHeight = pdfPageWidth * (capturedHeight / capturedWidth);

  // Build a simple PDF manually (no library needed)
  const pdfPages = [];

  for (let i = 0; i < images.length; i++) {
    const { img, isLast } = images[i];

    // For the last page, we may need to crop
    const canvas = document.createElement("canvas");
    canvas.width = capturedWidth;

    if (isLast) {
      // Calculate the remaining height
      const remainPx = totalHeight - (screenshots[i].scrollY);
      const remainCanvas = remainPx * devicePixelRatio;
      canvas.height = Math.min(remainCanvas, capturedHeight);
    } else {
      canvas.height = capturedHeight;
    }

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, capturedWidth, canvas.height, 0, 0, capturedWidth, canvas.height);

    const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    pdfPages.push({
      dataUrl: jpegDataUrl,
      width: canvas.width,
      height: canvas.height,
    });
  }

  // Generate PDF binary using minimal PDF builder
  const pdfBytes = buildPdf(pdfPages, pdfPageWidth, title);

  // Trigger download
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const safeName = (title || "webpage").replace(/[^\w\u4e00-\u9fff\s-]/g, "").trim().slice(0, 80);
  const filename = `${safeName}.pdf`;

  await chrome.runtime.sendMessage({ action: "downloadPdf", url, filename });

  // Clean up the object URL after a delay
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Build a minimal valid PDF from an array of JPEG page images.
 * Each page is sized proportionally to the image aspect ratio.
 */
function buildPdf(pages, baseWidth, title) {
  let objCount = 0;
  const offsets = [];
  let body = "";

  function addObj(content) {
    objCount++;
    offsets.push(body.length);
    body += `${objCount} 0 obj\n${content}\nendobj\n`;
    return objCount;
  }

  // Extract raw JPEG bytes from data URLs
  const jpegDataList = pages.map((p) => {
    const base64 = p.dataUrl.split(",")[1];
    return base64ToBytes(base64);
  });

  // Object 1: Catalog (will reference Pages object)
  const catalogId = addObj("<< /Type /Catalog /Pages 2 0 R >>");

  // Object 2: Pages - placeholder, we'll fix content later
  const pagesObjIndex = offsets.length;
  addObj("PLACEHOLDER");

  // For each page, create: Image XObject, Page object
  const pageObjIds = [];
  const imageObjIds = [];

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const jpegBytes = jpegDataList[i];
    const pageHeight = baseWidth * (p.height / p.width);

    // Image XObject (stream)
    const imgObjId = addObj(
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
    );
    // We need to inject raw bytes into the stream - handle below
    imageObjIds.push(imgObjId);

    // Page content stream (draw image full-page)
    const contentStream = `q ${baseWidth} 0 0 ${pageHeight} 0 0 cm /Img${i} Do Q`;
    const contentObjId = addObj(
      `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`
    );

    // Page object
    const pageObjId = addObj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${baseWidth} ${pageHeight}] /Contents ${contentObjId} 0 R /Resources << /XObject << /Img${i} ${imgObjId} 0 R >> >> >>`
    );
    pageObjIds.push(pageObjId);
  }

  // Now fix the Pages object
  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  const pagesContent = `<< /Type /Pages /Kids [${kidsStr}] /Count ${pages.length} >>`;

  // Rebuild body with correct Pages object
  // This is a simplified approach - rebuild from scratch with proper binary streams

  return buildPdfBinary(pages, jpegDataList, baseWidth, title);
}

function buildPdfBinary(pages, jpegDataList, baseWidth, title) {
  const encoder = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const offsets = [];
  let objNum = 0;

  function writeStr(s) {
    const bytes = encoder.encode(s);
    chunks.push(bytes);
    offset += bytes.length;
  }

  function writeBytes(b) {
    chunks.push(b);
    offset += b.length;
  }

  function startObj() {
    objNum++;
    offsets.push(offset);
    writeStr(`${objNum} 0 obj\n`);
    return objNum;
  }

  function endObj() {
    writeStr("endobj\n");
  }

  // Header
  writeStr("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  // Obj 1: Catalog
  const catalogId = startObj();
  writeStr("<< /Type /Catalog /Pages 2 0 R >>\n");
  endObj();

  // Obj 2: Pages (placeholder - need to know page obj IDs first)
  // We'll calculate IDs: for each page we have 3 objects (image, content, page)
  // So page objects are at positions: 3 + i*3 + 2 = 5, 8, 11, ...
  const pageObjIds = pages.map((_, i) => 3 + i * 3 + 2 + 1); // +1 because 1-indexed
  // Actually let's just compute: obj3=img0, obj4=content0, obj5=page0, obj6=img1, obj7=content1, obj8=page1, ...
  const firstPageObjId = 5; // 3(img) + 4(content) + 5(page)
  const computedPageIds = pages.map((_, i) => 3 + i * 3 + 2);

  const pagesId = startObj();
  const kidsStr = computedPageIds.map((id) => `${id} 0 R`).join(" ");
  writeStr(`<< /Type /Pages /Kids [${kidsStr}] /Count ${pages.length} >>\n`);
  endObj();

  // For each page: image stream obj, content stream obj, page obj
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const jpegBytes = jpegDataList[i];
    const pageHeight = baseWidth * (p.height / p.width);

    // Image XObject
    const imgId = startObj();
    writeStr(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\n`);
    writeStr("stream\n");
    writeBytes(jpegBytes);
    writeStr("\nendstream\n");
    endObj();

    // Content stream
    const contentStr = `q ${baseWidth.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm /Img${i} Do Q`;
    const contentId = startObj();
    writeStr(`<< /Length ${contentStr.length} >>\n`);
    writeStr("stream\n");
    writeStr(contentStr);
    writeStr("\nendstream\n");
    endObj();

    // Page
    const pageId = startObj();
    writeStr(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${baseWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Contents ${contentId} 0 R /Resources << /XObject << /Img${i} ${imgId} 0 R >> >> >>\n`);
    endObj();
  }

  // Cross-reference table
  const xrefOffset = offset;
  writeStr("xref\n");
  writeStr(`0 ${objNum + 1}\n`);
  writeStr("0000000000 65535 f \n");
  for (const off of offsets) {
    writeStr(`${String(off).padStart(10, "0")} 00000 n \n`);
  }

  // Trailer
  writeStr("trailer\n");
  writeStr(`<< /Size ${objNum + 1} /Root ${catalogId} 0 R >>\n`);
  writeStr("startxref\n");
  writeStr(`${xrefOffset}\n`);
  writeStr("%%EOF\n");

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return result;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
