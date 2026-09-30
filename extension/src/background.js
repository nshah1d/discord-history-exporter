// The toolbar button toggles the panel in the active tab. A Discord tab opened before the extension
// was loaded has no content script until it is reloaded, so the message is dropped there.
chrome.action.onClicked.addListener((tab) => {
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "ledger-toggle" }).catch(() => {});
  }
});
