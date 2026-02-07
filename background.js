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

// Handle API fetch requests from content scripts (to avoid CORS issues)
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

    return true; // Keep the message channel open for async response
  }
});
