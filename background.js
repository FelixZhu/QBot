console.log("QBot: service worker loaded");

// Create context menu items when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  // Remove old menus first to avoid duplicates
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "qbot-translate",
      title: 'Q 翻译 "%s"',
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "qbot-add-word",
      title: 'Q 加入单词本 "%s"',
      contexts: ["selection"],
    });
    console.log("QBot: context menus created");
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const text = info.selectionText ? info.selectionText.trim() : "";
  if (!text) return;

  if (info.menuItemId === "qbot-translate") {
    // Show loading state in content script first
    chrome.tabs.sendMessage(tab.id, {
      action: "showLoading",
      word: text,
    });

    // Translate in background (to bypass CORS)
    try {
      const result = await translateText(text);
      chrome.tabs.sendMessage(tab.id, {
        action: "showTranslation",
        original: text,
        translated: result.translated,
        detectedLang: result.detectedLang,
        targetLang: result.targetLang,
        url: info.pageUrl,
      });
    } catch (e) {
      console.error("QBot translate error:", e);
      chrome.tabs.sendMessage(tab.id, {
        action: "showTranslateError",
        word: text,
      });
    }
  }

  if (info.menuItemId === "qbot-add-word") {
    const url = info.pageUrl || "";
    const englishWord = isChinese(text) ? null : text;

    if (!englishWord) {
      // If Chinese text selected, translate to English first to get the English word
      try {
        const result = await translateText(text);
        await addToWordBook(result.translated, url);
        chrome.tabs.sendMessage(tab.id, {
          action: "showAddedToast",
          word: result.translated,
        });
      } catch (e) {
        console.error("QBot add word error:", e);
        chrome.tabs.sendMessage(tab.id, {
          action: "showAddedToast",
          word: text,
          error: true,
        });
      }
    } else {
      await addToWordBook(englishWord, url);
      chrome.tabs.sendMessage(tab.id, {
        action: "showAddedToast",
        word: englishWord,
      });
    }
  }
});

// Handle messages from content script (e.g. "add to word book" button in popup)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "addToWordBook") {
    addToWordBook(message.word, message.url).then(() => {
      sendResponse({ success: true });
    });
    return true; // keep channel open for async sendResponse
  }

  if (message.action === "getWordBook") {
    chrome.storage.local.get({ wordBook: [] }, (data) => {
      sendResponse({ wordBook: data.wordBook });
    });
    return true;
  }

  if (message.action === "removeFromWordBook") {
    chrome.storage.local.get({ wordBook: [] }, (data) => {
      const wordBook = data.wordBook.filter(
        (entry) => !(entry.word === message.word && entry.time === message.time)
      );
      chrome.storage.local.set({ wordBook }, () => {
        sendResponse({ success: true, wordBook });
      });
    });
    return true;
  }

  if (message.action === "clearWordBook") {
    chrome.storage.local.set({ wordBook: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// --- Translation ---

async function translateText(text) {
  const cn = isChinese(text);
  const targetLang = cn ? "en" : "zh-CN";
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error("Translation API error");

  const data = await response.json();
  const translated = data[0].map((seg) => seg[0]).join("");
  const detectedLang = data[2] || "unknown";

  return { translated, detectedLang, targetLang };
}

function isChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

// --- Word Book ---

async function addToWordBook(word, url) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ wordBook: [] }, (data) => {
      const wordBook = data.wordBook;
      const now = new Date();
      const time = formatDateTime(now);

      // Avoid exact duplicates (same word + same url)
      const exists = wordBook.some(
        (e) => e.word.toLowerCase() === word.toLowerCase() && e.url === url
      );
      if (!exists) {
        wordBook.unshift({ word, time, url });
      }

      chrome.storage.local.set({ wordBook }, resolve);
    });
  });
}

function formatDateTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
