"use strict";

const keyInput = document.querySelector("#key");
const status = document.querySelector("#status");

async function scanBridge(key) {
  for (let port = 18160; port <= 18199; port += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(350),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.provider === "gemini_web") return { port, body };
    } catch {}
  }
  throw new Error("未发现正在运行的 Langbai v1.6.0");
}

async function load() {
  const saved = await chrome.storage.local.get({ pairingKey: "", bridgePort: 0 });
  keyInput.value = saved.pairingKey || "";
  if (saved.pairingKey) {
    try {
      const found = await scanBridge(saved.pairingKey);
      await chrome.storage.local.set({ bridgePort: found.port });
      status.dataset.state = "ok";
      status.textContent = `已连接 127.0.0.1:${found.port}`;
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error.message;
    }
  }
}

document.querySelector("#save").addEventListener("click", async () => {
  const pairingKey = keyInput.value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(pairingKey)) {
    status.dataset.state = "error";
    status.textContent = "配对密钥应为 64 位十六进制文本";
    return;
  }
  status.dataset.state = "";
  status.textContent = "正在检测…";
  try {
    const found = await scanBridge(pairingKey);
    await chrome.storage.local.set({ pairingKey, bridgePort: found.port, enabled: true });
    status.dataset.state = "ok";
    status.textContent = `配对成功 · 127.0.0.1:${found.port}`;
    const tabs = await chrome.tabs.query({ url: "https://gemini.google.com/*" });
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: "langbai-wake" }).catch(() => {});
  } catch (error) {
    status.dataset.state = "error";
    status.textContent = error.message;
  }
});

document.querySelector("#open").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://gemini.google.com/app" });
});

void load();
