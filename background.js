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
const MEDIA_CONTENT_TYPE = /^(video\/|application\/x-mpegurl|application\/dash\+xml|application\/vnd\.apple\.mpegurl)/i;
const STREAM_URL_PATTERN = /videoplayback|segment_|chunk_|playlist\.m3u8|manifest\.mpd/i;

// Cache: tabId -> Array<{ url, contentType, timestamp }>
const detectedMedia = new Map();

// Monitor network responses for video content
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

    // Skip very small segment files (< 100KB likely just a fragment)
    // Only store main video files and playlists
    if (isMedia) {
      if (!detectedMedia.has(details.tabId)) {
        detectedMedia.set(details.tabId, []);
      }
      const list = detectedMedia.get(details.tabId);
      // Avoid duplicates
      if (!list.some((item) => item.url === details.url)) {
        list.push({
          url: details.url,
          contentType,
          timestamp: Date.now(),
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

// Handle API fetch requests and media-related messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    sendResponse({ success: true, media });
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
});
