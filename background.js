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

  // Capture current visible tab as PNG screenshot
  if (message.action === "captureTab") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, data: dataUrl });
      }
    });
    return true;
  }

  // Download generated PDF from blob URL
  if (message.action === "downloadPdf") {
    const { url, filename } = message;
    chrome.downloads.download(
      {
        url,
        filename: filename || "webpage.pdf",
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
});

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
