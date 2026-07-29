"use strict";

const DEFAULT_STATE = Object.freeze({
  pairingKey: "",
  bridgePort: 0,
  enabled: true,
  profileId: "",
});

chrome.runtime.onInstalled.addListener(async () => {
  const state = await chrome.storage.local.get(DEFAULT_STATE);
  if (!state.profileId) {
    state.profileId = crypto.randomUUID();
  }
  await chrome.storage.local.set(state);
  chrome.alarms.create("langbai-keepalive", { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== "langbai-keepalive") return;
  const tabs = await chrome.tabs.query({ url: "https://gemini.google.com/*" });
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, { type: "langbai-wake" }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "langbai-state") return false;
  chrome.storage.local.get(DEFAULT_STATE).then(sendResponse);
  return true;
});
