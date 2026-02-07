// Create context menu item when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "lookup-word",
    title: 'Look up "%s"',
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
