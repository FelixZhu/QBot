// Create context menu item when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "lookup-word",
    title: '查询 "%s"',
    contexts: ["selection"],
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "lookup-word" && info.selectionText) {
    const word = info.selectionText.trim();
    if (word) {
      chrome.tabs.sendMessage(tab.id, {
        action: "lookup",
        word: word,
      });
    }
  }
});

const API_BASE = "https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4&le=en";

// --- Video network request monitoring ---

const MEDIA_URL_PATTERN = /\.(mp4|webm|m3u8|mpd|ts|m4s|flv|ogg|mov|avi|mkv)(\?|#|$)/i;
const MEDIA_CONTENT_TYPE = /^(video\/|audio\/mp4|application\/x-mpegurl|application\/dash\+xml|application\/vnd\.apple\.mpegurl)/i;
const STREAM_URL_PATTERN = /videoplayback|segment_|chunk_|playlist\.m3u8|manifest\.mpd/i;

// Cache: tabId -> Array<{ url, contentType, timestamp, streamType, formatId, groupKey }>
const detectedMedia = new Map();

// --- Stream type classification ---

// Bilibili format ID ranges
// 30200-30299: audio (30216=64kbps, 30232=132kbps, 30280=192kbps)
// 30000-30199: video AVC (30016=360p, 30032=480p, 30064=720p, 30080=1080p)
// 100000+: video HEVC/AV1 (100024=720p, 100026=1080p, 100032=1080p+)
const BILIBILI_FORMAT_PATTERN = /\/(\d+)-(\d+)-(\d+)\.(mp4|m4s)/;

function classifyStream(url, contentType) {
  // Try Bilibili format ID
  const biliMatch = url.match(BILIBILI_FORMAT_PATTERN);
  if (biliMatch) {
    const formatId = parseInt(biliMatch[3], 10);
    if (formatId >= 30200 && formatId < 30300) {
      return { streamType: "audio", formatId };
    }
    if ((formatId >= 30000 && formatId < 30200) || formatId >= 100000) {
      return { streamType: "video", formatId };
    }
  }

  // YouTube: check itag or mime parameter in URL
  try {
    const urlObj = new URL(url);
    const mime = urlObj.searchParams.get("mime");
    if (mime) {
      if (mime.startsWith("video/")) return { streamType: "video", formatId: 0 };
      if (mime.startsWith("audio/")) return { streamType: "audio", formatId: 0 };
    }
    const itag = parseInt(urlObj.searchParams.get("itag"), 10);
    if (itag) {
      // Common YouTube audio itags
      const audioItags = [139, 140, 141, 171, 172, 249, 250, 251, 256, 258, 327];
      if (audioItags.includes(itag)) return { streamType: "audio", formatId: itag };
      return { streamType: "video", formatId: itag };
    }
  } catch { /* not a valid URL with params */ }

  // Fallback: check Content-Type header
  if (contentType) {
    if (/^audio\//i.test(contentType)) return { streamType: "audio", formatId: 0 };
    if (/^video\//i.test(contentType)) return { streamType: "video", formatId: 0 };
  }

  return { streamType: "unknown", formatId: 0 };
}

function getGroupKey(url) {
  // Bilibili: extract {cid}-{part} from filename like /35736913739-1-100026.mp4
  const biliMatch = url.match(BILIBILI_FORMAT_PATTERN);
  if (biliMatch) {
    return `bili:${biliMatch[1]}-${biliMatch[2]}`;
  }

  // YouTube: extract video id parameter
  try {
    const urlObj = new URL(url);
    const id = urlObj.searchParams.get("id");
    if (id && urlObj.hostname.includes("googlevideo.com")) {
      return `yt:${id}`;
    }
  } catch { /* ignore */ }

  // Generic: no pairing
  return null;
}

function pairStreams(mediaList) {
  // Group by groupKey
  const groups = new Map();
  const unpaired = [];

  for (const item of mediaList) {
    if (item.groupKey) {
      if (!groups.has(item.groupKey)) {
        groups.set(item.groupKey, []);
      }
      groups.get(item.groupKey).push(item);
    } else {
      unpaired.push(item);
    }
  }

  const paired = [];
  const remaining = [];

  for (const [groupKey, items] of groups) {
    const videos = items.filter((i) => i.streamType === "video");
    const audios = items.filter((i) => i.streamType === "audio");

    if (videos.length > 0 && audios.length > 0) {
      // Pick highest quality: highest formatId for video, highest for audio
      const bestVideo = videos.sort((a, b) => b.formatId - a.formatId)[0];
      const bestAudio = audios.sort((a, b) => b.formatId - a.formatId)[0];

      paired.push({
        groupKey,
        videoUrl: bestVideo.url,
        audioUrl: bestAudio.url,
        videoFormatId: bestVideo.formatId,
        audioFormatId: bestAudio.formatId,
        timestamp: Math.max(bestVideo.timestamp, bestAudio.timestamp),
      });
    } else {
      // Cannot pair, add all to remaining
      remaining.push(...items);
    }
  }

  remaining.push(...unpaired);
  return { paired, remaining };
}

// Monitor network responses for video/audio content
chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    if (details.tabId < 0) return;

    let isMedia = false;
    let contentType = "";

    // Check Content-Type header
    if (details.responseHeaders) {
      const ctHeader = details.responseHeaders.find(
        (h) => h.name.toLowerCase() === "content-type"
      );
      if (ctHeader && MEDIA_CONTENT_TYPE.test(ctHeader.value)) {
        isMedia = true;
        contentType = ctHeader.value;
      }
    }

    // Check URL pattern
    if (!isMedia && (MEDIA_URL_PATTERN.test(details.url) || STREAM_URL_PATTERN.test(details.url))) {
      isMedia = true;
    }

    if (isMedia) {
      if (!detectedMedia.has(details.tabId)) {
        detectedMedia.set(details.tabId, []);
      }
      const list = detectedMedia.get(details.tabId);
      // Avoid duplicates
      if (!list.some((item) => item.url === details.url)) {
        const { streamType, formatId } = classifyStream(details.url, contentType);
        const groupKey = getGroupKey(details.url);
        list.push({
          url: details.url,
          contentType,
          timestamp: Date.now(),
          streamType,
          formatId,
          groupKey,
        });
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  detectedMedia.delete(tabId);
});

// Clean up when tab navigates to a new page
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    detectedMedia.delete(tabId);
  }
});

// --- Offscreen document management ---

let offscreenCreated = false;

async function ensureOffscreen() {
  if (offscreenCreated) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Merge video and audio streams using ffmpeg.wasm",
    });
    offscreenCreated = true;
  } catch (err) {
    // Document may already exist
    if (!err.message?.includes("already exists")) throw err;
    offscreenCreated = true;
  }
}

// Handle API fetch requests and media-related messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages meant for offscreen document
  if (message.action === "mergeVideoAudio") return false;

  if (message.action === "fetchDict" && message.word) {
    const isCN = /[\u4e00-\u9fff]/.test(message.word);
    const direction = isCN ? "zh-CN2en" : "en2zh-CN";
    const url = `${API_BASE}&t=${direction}&q=${encodeURIComponent(message.word)}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data) => sendResponse({ success: true, data }))
      .catch(() => sendResponse({ success: false, error: "fetch_error" }));

    return true;
  }

  if (message.action === "getDetectedMedia") {
    const tabId = message.tabId;
    const media = detectedMedia.get(tabId) || [];
    const { paired, remaining } = pairStreams(media);
    sendResponse({ success: true, media: remaining, paired });
    return false;
  }

  if (message.action === "downloadVideo") {
    const { url, filename } = message;
    chrome.downloads.download(
      {
        url,
        filename: filename || "video.mp4",
        saveAs: true,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId });
        }
      }
    );
    return true;
  }

  if (message.action === "mergeAndDownload") {
    const { videoUrl, audioUrl, filename } = message;
    handleMergeAndDownload(videoUrl, audioUrl, filename)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Full-page PDF capture: runs entirely in background so popup can close
  if (message.action === "savePageAsPdf") {
    console.log("[QBot] savePageAsPdf message received, tabId:", message.tabId);
    // Keep service worker alive for the entire capture duration
    startKeepAlive();
    // Immediately tell popup "started" so it can show status
    sendResponse({ started: true });
    // Run capture asynchronously
    handleSavePageAsPdf(message.tabId)
      .then(() => {
        chrome.notifications.create("qbot-pdf-done", {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "QBot - 网页保存",
          message: "PDF 已生成，请在下载中查看。",
        });
      })
      .catch((err) => {
        console.error("[QBot] PDF capture failed:", err);
        chrome.notifications.create("qbot-pdf-error", {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "QBot - 网页保存失败",
          message: err.message || "截图过程出错，请刷新页面后重试。",
        });
      })
      .finally(() => {
        stopKeepAlive();
      });
    // return false — sendResponse was already called synchronously above.
    // The keepAlive interval prevents SW termination during the async task.
    return false;
  }
});

// --- Full-page PDF capture ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Keep service worker alive during long-running tasks.
// MV3 service workers can be terminated after 30s of inactivity.
// We use chrome.runtime.sendMessage to self to keep the event loop busy,
// combined with setInterval pings.
let keepAliveInterval = null;
function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      // No-op callback — just keeps the service worker alive
    });
  }, 20000); // Ping every 20s (Chrome kills after 30s idle)
  console.log("[QBot] keepAlive started");
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    console.log("[QBot] keepAlive stopped");
  }
}

async function handleSavePageAsPdf(tabId) {
  console.log("[QBot] handleSavePageAsPdf called, tabId:", tabId);

  // Get the tab's windowId for captureVisibleTab
  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;
  console.log("[QBot] tab info:", tab.url, "windowId:", windowId);

  // Ensure content script is injected (may not be if tab was opened before extension install/update)
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    console.log("[QBot] content script injected/ensured");
  } catch (injectErr) {
    console.warn("[QBot] content script injection skipped:", injectErr.message);
    // May fail on chrome:// pages or if already injected — continue anyway
  }

  // Small delay to let content script initialize
  await sleep(200);

  // Step 1: Get page dimensions from content script
  let pageInfo;
  try {
    pageInfo = await chrome.tabs.sendMessage(tabId, { action: "getPageInfo" });
  } catch (msgErr) {
    console.error("[QBot] sendMessage getPageInfo failed:", msgErr);
    throw new Error("无法连接到页面，请刷新页面后重试");
  }
  if (!pageInfo || !pageInfo.success) {
    throw new Error("无法获取页面信息，请刷新页面重试");
  }
  console.log("[QBot] pageInfo:", JSON.stringify(pageInfo));

  const { totalHeight, viewportHeight, viewportWidth, devicePixelRatio, title } = pageInfo;
  const steps = Math.ceil(totalHeight / viewportHeight);
  const screenshots = [];

  console.log("[QBot] totalHeight:", totalHeight, "viewportHeight:", viewportHeight, "steps:", steps);

  // Step 2: Scroll step-by-step and capture each viewport
  for (let i = 0; i < steps; i++) {
    const scrollY = i * viewportHeight;
    console.log(`[QBot] step ${i + 1}/${steps}, scrollY: ${scrollY}`);
    // On the last step, the browser clamps scroll to max scrollable position.
    // The actual scroll position may be less than scrollY, causing overlap with
    // the previous capture. We record the actual scroll position to crop correctly.
    let actualScrollY = scrollY;
    try {
      const scrollResult = await chrome.tabs.sendMessage(tabId, { action: "scrollToPosition", scrollY });
      if (scrollResult && scrollResult.actualScrollY !== undefined) {
        actualScrollY = scrollResult.actualScrollY;
      }
    } catch (scrollErr) {
      console.warn("[QBot] scroll message failed, using fallback:", scrollErr.message);
    }
    // Wait for rendering (lazy images, animations, etc.)
    await sleep(400);
    // Capture visible tab using the correct windowId
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    console.log(`[QBot] captured step ${i + 1}, dataUrl length: ${dataUrl.length}`);
    screenshots.push({
      dataUrl,
      requestedScrollY: scrollY,
      actualScrollY,
      isLast: i === steps - 1,
    });
  }

  // Step 3: Restore scroll position
  await chrome.tabs.sendMessage(tabId, { action: "scrollToPosition", scrollY: 0 });

  // Step 4: Convert screenshots to JPEG using OffscreenCanvas (service worker compatible)
  const pdfPages = [];
  for (let i = 0; i < screenshots.length; i++) {
    const s = screenshots[i];
    const resp = await fetch(s.dataUrl);
    const imageBitmap = await createImageBitmap(await resp.blob());

    const capturedWidth = imageBitmap.width;
    const capturedHeight = imageBitmap.height;

    // Calculate the vertical crop region for this screenshot.
    // For the first screenshot, we use the full image.
    // For subsequent screenshots, if the actual scroll is less than requested
    // (browser clamped), we need to skip the overlap at the top.
    let cropTop = 0;
    let canvasHeight = capturedHeight;

    if (i > 0) {
      // Expected: actualScrollY = i * viewportHeight, so each capture is a fresh viewport.
      // If actualScrollY < requestedScrollY, the bottom part of previous capture overlaps.
      const overlap = s.requestedScrollY - s.actualScrollY;
      if (overlap > 0) {
        cropTop = Math.round(overlap * devicePixelRatio);
        canvasHeight = capturedHeight - cropTop;
      }
    }

    if (canvasHeight <= 0) {
      imageBitmap.close();
      continue; // Skip completely overlapping captures
    }

    const canvas = new OffscreenCanvas(capturedWidth, canvasHeight);
    const ctx = canvas.getContext("2d");
    // drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh) — crop from cropTop
    ctx.drawImage(imageBitmap, 0, cropTop, capturedWidth, canvasHeight, 0, 0, capturedWidth, canvasHeight);
    imageBitmap.close();

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    const jpegBytes = new Uint8Array(await blob.arrayBuffer());
    pdfPages.push({
      jpegBytes,
      width: capturedWidth,
      height: canvasHeight,
    });
  }

  if (pdfPages.length === 0) {
    throw new Error("未能捕获任何页面内容");
  }

  // Step 5: Build PDF binary
  const pdfPageWidth = 595.28; // A4 width in points
  const pdfBytes = buildPdfBinary(pdfPages, pdfPageWidth);

  // Step 6: Create blob URL and trigger download
  const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
  const pdfUrl = URL.createObjectURL(pdfBlob);
  const safeName = (title || "webpage").replace(/[^\w\u4e00-\u9fff\s-]/g, "").trim().slice(0, 80);
  const filename = `${safeName}.pdf`;

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: pdfUrl, filename, saveAs: true },
      (downloadId) => {
        // Clean up blob URL after a delay
        setTimeout(() => URL.revokeObjectURL(pdfUrl), 30000);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve({ success: true, downloadId });
        }
      }
    );
  });
}

function buildPdfBinary(pages, baseWidth) {
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

  // Obj 2: Pages
  // Each page has 3 objects (image, content stream, page), so page obj IDs are: 5, 8, 11, ...
  const computedPageIds = pages.map((_, i) => 3 + i * 3 + 2);
  startObj();
  const kidsStr = computedPageIds.map((id) => `${id} 0 R`).join(" ");
  writeStr(`<< /Type /Pages /Kids [${kidsStr}] /Count ${pages.length} >>\n`);
  endObj();

  // For each page: image XObject, content stream, page object
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const pageHeight = baseWidth * (p.height / p.width);

    // Image XObject (JPEG stream)
    const imgId = startObj();
    writeStr(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpegBytes.length} >>\n`);
    writeStr("stream\n");
    writeBytes(p.jpegBytes);
    writeStr("\nendstream\n");
    endObj();

    // Content stream (draw image full-page)
    const contentStr = `q ${baseWidth.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm /Img${i} Do Q`;
    const contentId = startObj();
    writeStr(`<< /Length ${contentStr.length} >>\n`);
    writeStr("stream\n");
    writeStr(contentStr);
    writeStr("\nendstream\n");
    endObj();

    // Page object
    startObj();
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

async function handleMergeAndDownload(videoUrl, audioUrl, filename) {
  await ensureOffscreen();

  // Send merge request to offscreen document
  const result = await chrome.runtime.sendMessage({
    action: "mergeVideoAudio",
    videoUrl,
    audioUrl,
  });

  if (!result || !result.success) {
    throw new Error(result?.error || "Merge failed");
  }

  // Download the merged blob
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: result.blobUrl,
        filename: filename || "merged_video.mp4",
        saveAs: true,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve({ success: true, downloadId });
        }
      }
    );
  });
}
