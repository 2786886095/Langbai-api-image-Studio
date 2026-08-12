#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const host = "127.0.0.1";
const appPort = Number(process.env.AIGEN_QA_APP_PORT) || 8765;
const debugPort = Number(process.env.AIGEN_QA_DEBUG_PORT) || (19000 + (process.pid % 20000));
const appUrl = `http://${host}:${appPort}/index.html`;
const edgeProfile = path.join(path.dirname(projectRoot), `aigen-edge-qa-${process.pid}`);
const expectedAppVersion = fs.readFileSync(path.join(projectRoot, "app.js"), "utf8")
  .match(/const APP_VERSION = "([^"]+)";/)?.[1] || "";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8",
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function assertQa(condition, message, details = undefined) {
  if (!condition) {
    const err = new Error(message);
    err.details = details;
    throw err;
  }
}

function logStep(message) {
  console.log(`\n[qa] ${message}`);
}

function findEdgeExecutable() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const found = candidates.find(file => fs.existsSync(file));
  if (!found) throw new Error("Edge/Chrome executable was not found.");
  return found;
}

async function removeDirWithRetry(dir, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      if (!fs.existsSync(dir)) return;
    } catch {
      // Windows may keep browser profile files locked for a moment after process kill.
    }
    await sleep(150 * (i + 1));
  }
}

function createStaticServer() {
  return http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://${host}:${appPort}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/index.html";
      const filePath = path.resolve(projectRoot, `.${pathname}`);
      if (!filePath.startsWith(projectRoot)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err?.stack || err));
    }
  });
}

async function waitForJson(url, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return await resp.json();
    } catch {
      // keep waiting
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.seq = 1;
    this.pending = new Map();
    this.runtimeIssues = [];
    ws.addEventListener("message", event => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const item = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) item.reject(new Error(JSON.stringify(msg.error)));
        else item.resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") {
        this.runtimeIssues.push({
          type: "exception",
          text: msg.params?.exceptionDetails?.text || "",
          description: msg.params?.exceptionDetails?.exception?.description || "",
        });
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
        this.runtimeIssues.push({
          type: "console.error",
          text: (msg.params.args || []).map(arg => arg.value || arg.description || "").join(" "),
        });
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(ws);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.seq++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, awaitPromise = false) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }

  close() {
    this.ws.close();
  }

  assertNoRuntimeIssues() {
    assertQa(this.runtimeIssues.length === 0, "The app should not emit unhandled runtime exceptions or console.error entries.", this.runtimeIssues);
  }
}

async function setupBrowserPage() {
  const version = await waitForJson(`http://${host}:${debugPort}/json/version`);
  if (!version.webSocketDebuggerUrl) throw new Error("DevTools endpoint is unavailable.");
  const targets = await waitForJson(`http://${host}:${debugPort}/json`);
  const target = targets.find(item => item.type === "page" && item.url.includes(`${host}:${appPort}`))
    || targets.find(item => item.type === "page");
  if (!target) throw new Error("No page target found.");
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Network.setBypassServiceWorker", { bypass: true });
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  return cdp;
}

async function loadFresh(
  cdp,
  query = "qa",
  viewport = { width: 1365, height: 768, mobile: false },
  { preserveWorkspaceDraft = false } = {},
) {
  if (!preserveWorkspaceDraft) {
    await cdp.eval(`(() => {
      try { localStorage.removeItem("ai_image_gen_workspace_draft_v1"); } catch {}
      return true;
    })()`).catch(() => {});
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  });
  const targetUrl = `${appUrl}?${query}=${Date.now()}&qaDisableWorkspaceDraft=${preserveWorkspaceDraft ? "0" : "1"}`;
  await cdp.send("Page.navigate", { url: targetUrl });
  let lastState = null;
  for (let i = 0; i < 200; i++) {
    lastState = await cdp.eval(`(() => ({
      url: location.href,
      readyState: document.readyState,
      appReady: window.__AI_GEN_APP_READY === true,
      hasGenerateButton: !!document.getElementById("generateBtn"),
      title: document.title,
      bodyLength: document.body?.textContent?.length || 0,
      startupErrors: window.__AI_GEN_STARTUP_ERRORS || [],
    }))()`).catch(err => ({ transientNavigationError: String(err?.message || err) }));
    // External font requests can legitimately keep document.readyState at
    // "interactive" after the application has fully initialized. Product
    // readiness is the explicit app flag plus required controls, not the
    // browser's unrelated load event for optional network assets.
    if (lastState?.readyState !== "loading" && lastState.appReady && lastState.hasGenerateButton) {
      await sleep(150);
      return;
    }
    await sleep(100);
  }
  throw new Error(`App did not become ready: ${JSON.stringify({
    ...lastState,
    runtimeIssues: cdp.runtimeIssues.slice(-8),
  })}`);
}

async function testCustomSelects(cdp) {
  logStep("Custom dropdown lists (replacing native <select> popups) open, select, and close correctly");
  await loadFresh(cdp, "custom-selects");

  const apiProviderFlow = await cdp.eval(`(async () => {
    document.getElementById("configSection").open = true;
    await new Promise(r => setTimeout(r, 80));
    const trigger = document.getElementById("apiProviderTrigger");
    const list = document.getElementById("apiProviderCustomList");
    const initiallyHidden = list.classList.contains("hidden");
    trigger.click();
    await new Promise(r => setTimeout(r, 80));
    const openNow = !list.classList.contains("hidden");
    const options = [...list.querySelectorAll(".custom-select-option")].map(o => o.textContent);
    const officialOption = [...list.querySelectorAll(".custom-select-option")].find(o => o.textContent.includes("官方"));
    const hit = document.elementFromPoint(
      officialOption.getBoundingClientRect().x + 5,
      officialOption.getBoundingClientRect().y + 5
    );
    const hitOk = officialOption.contains(hit) || hit === officialOption;
    officialOption.click();
    await new Promise(r => setTimeout(r, 80));
    return {
      initiallyHidden,
      openNow,
      options,
      hitOk,
      closedAfterPick: list.classList.contains("hidden"),
      nativeValue: document.getElementById("apiProvider").value,
      triggerLabel: trigger.querySelector(".custom-select-value").textContent,
      endpointAutoFilled: document.getElementById("apiEndpoint").value,
    };
  })()`, true);
  assertQa(apiProviderFlow.initiallyHidden, "API type dropdown list should start closed.", apiProviderFlow);
  assertQa(apiProviderFlow.openNow, "Clicking the API type trigger should open the dropdown list.", apiProviderFlow);
  assertQa(
    apiProviderFlow.options.length === 3 && !apiProviderFlow.options.some(option => /Codex/i.test(option)),
    "Plain browser provider dropdown should list Official, GrsAI and Custom only; the local ChatGPT gateway belongs to packaged Windows/Android apps.",
    apiProviderFlow,
  );
  assertQa(apiProviderFlow.hitOk, "The rendered option button should be the actual real hit-test target (not obscured by anything).", apiProviderFlow);
  assertQa(apiProviderFlow.closedAfterPick, "Picking an option should close the dropdown list.", apiProviderFlow);
  assertQa(apiProviderFlow.nativeValue === "official", "Picking an option should update the underlying native select's value.", apiProviderFlow);
  assertQa(apiProviderFlow.triggerLabel.includes("官方"), "The trigger button should display the newly picked option's label.", apiProviderFlow);
  assertQa(apiProviderFlow.endpointAutoFilled.includes("openai.com"), "Switching provider via the custom dropdown should still drive downstream logic (endpoint auto-fill).", apiProviderFlow);

  const outsideClickAndEscape = await cdp.eval(`(async () => {
    const trigger = document.getElementById("desktopProxyModeTrigger");
    // desktopProxyMode lives in the settings modal; open settings first.
    document.getElementById("settingsBtn").click();
    await new Promise(r => setTimeout(r, 80));
    trigger.click();
    await new Promise(r => setTimeout(r, 80));
    const openAfterClick = !document.getElementById("desktopProxyModeCustomList").classList.contains("hidden");
    document.body.click();
    await new Promise(r => setTimeout(r, 80));
    const closedAfterOutsideClick = document.getElementById("desktopProxyModeCustomList").classList.contains("hidden");
    trigger.click();
    await new Promise(r => setTimeout(r, 80));
    const openAgain = !document.getElementById("desktopProxyModeCustomList").classList.contains("hidden");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    const closedAfterEscape = document.getElementById("desktopProxyModeCustomList").classList.contains("hidden");
    return { openAfterClick, closedAfterOutsideClick, openAgain, closedAfterEscape };
  })()`, true);
  assertQa(outsideClickAndEscape.openAfterClick, "Proxy mode dropdown in Settings should open on click.", outsideClickAndEscape);
  assertQa(outsideClickAndEscape.closedAfterOutsideClick, "Clicking outside an open dropdown should close it.", outsideClickAndEscape);
  assertQa(outsideClickAndEscape.openAgain, "Proxy mode dropdown should be able to reopen after closing.", outsideClickAndEscape);
  assertQa(outsideClickAndEscape.closedAfterEscape, "Pressing Escape should close an open dropdown.", outsideClickAndEscape);
}

async function testApiConfig(cdp) {
  logStep("API config save, restore, delete, and mobile scroll");
  await loadFresh(cdp, "api-config");
  cdp.assertNoRuntimeIssues();
  const firstScreen = await cdp.eval(`(() => {
    localStorage.clear();
    const quick = document.getElementById("apiQuickCard").getBoundingClientRect();
    const config = document.getElementById("configSection").getBoundingClientRect();
    const prompt = document.getElementById("globalPromptField").getBoundingClientRect();
    return {
      configOpen: document.getElementById("configSection").open,
      quickBeforeConfig: quick.top < config.top,
      promptStartsInViewport: prompt.top < window.innerHeight,
    };
  })()`, true);
  assertQa(!firstScreen.configOpen, "API configuration should be collapsed by default.", firstScreen);
  assertQa(firstScreen.quickBeforeConfig, "API status card should appear before the detailed API form.", firstScreen);
  assertQa(firstScreen.promptStartsInViewport, "The first screen should expose the prompt area without opening API details.", firstScreen);

  const saveResult = await cdp.eval(`(async () => {
    localStorage.clear();
    const answerAskDialog = async (value) => {
      const start = Date.now();
      let overlay = null;
      while (Date.now() - start < 2000) {
        overlay = document.querySelector(".ask-dialog-overlay");
        if (overlay) break;
        await new Promise(r => setTimeout(r, 20));
      }
      if (!overlay) return false;
      const input = overlay.querySelector(".ask-dialog-input");
      if (input && value !== false) input.value = value === true ? "" : value;
      overlay.querySelector(value === false ? ".ask-dialog-cancel" : ".ask-dialog-ok").click();
      return true;
    };
    document.getElementById("openApiConfig").click();
    await new Promise(r => setTimeout(r, 50));
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "custom");
    set("apiEndpoint", "https://www.huanapi.com/v1/images/edits");
    set("apiKey", "sk-qa-1234567890");
    set("model", "gpt-image-2");
    set("proxyEndpoint", "http://127.0.0.1:8787/proxy");
    document.getElementById("saveConfig").click();
    await answerAskDialog("qa-api");
    await new Promise(r => setTimeout(r, 80));
    document.getElementById("setDefaultApi").click();
    await new Promise(r => setTimeout(r, 50));
    return {
      configOpen: document.getElementById("configSection").open,
      selected: document.getElementById("savedApis").value,
      apis: JSON.parse(localStorage.getItem("ai_image_gen_apis") || "[]"),
      active: JSON.parse(localStorage.getItem("ai_image_gen_config") || "{}"),
      defaultId: localStorage.getItem("ai_image_gen_default_api_id"),
      quick: document.getElementById("apiQuickTitle").textContent,
    };
  })()`, true);
  assertQa(saveResult.configOpen, "API config should remain open after saving.", saveResult);
  assertQa(saveResult.apis.length === 1, "Saved API list should contain one record.", saveResult);
  assertQa(saveResult.active.endpoint.includes("huanapi"), "Active API config should be persisted.", saveResult);
  assertQa(saveResult.defaultId && saveResult.defaultId === saveResult.active.id, "Set-default API button should persist the active API id.", saveResult);
  assertQa(saveResult.quick.includes("已接入"), "API quick card should show connected state.", saveResult);

  await cdp.eval("location.reload()");
  // Fixed sleeps flake here: with the CDP cache disabled, re-parsing app.js can take
  // longer than any constant we pick. Poll until init has restored the saved endpoint.
  for (let i = 0; i < 60; i++) {
    const restored = await cdp.eval(
      `document.readyState === "complete" && !!document.getElementById("generateBtn") && document.getElementById("apiEndpoint").value !== ""`
    ).catch(() => false);
    if (restored) break;
    await sleep(100);
  }
  const reloadDelete = await cdp.eval(`(async () => {
    const before = {
      endpoint: document.getElementById("apiEndpoint").value,
      key: document.getElementById("apiKey").value,
      model: document.getElementById("model").value,
      proxy: document.getElementById("proxyEndpoint").value,
      provider: document.getElementById("apiProvider").value,
      selected: document.getElementById("savedApis").value,
      configOpen: document.getElementById("configSection").open,
    };
    const answerAskDialog = async (value) => {
      const start = Date.now();
      let overlay = null;
      while (Date.now() - start < 2000) {
        overlay = document.querySelector(".ask-dialog-overlay");
        if (overlay) break;
        await new Promise(r => setTimeout(r, 20));
      }
      if (!overlay) return false;
      overlay.querySelector(value === false ? ".ask-dialog-cancel" : ".ask-dialog-ok").click();
      return true;
    };
    document.getElementById("openApiConfig").click();
    await new Promise(r => setTimeout(r, 50));
    const activeId = JSON.parse(localStorage.getItem("ai_image_gen_config") || "{}").id || "";
    document.getElementById("savedApis").value = activeId;
    document.getElementById("deleteSavedApi").click();
    await answerAskDialog(true);
    await new Promise(r => setTimeout(r, 50));
    return {
      before,
      after: {
        endpoint: document.getElementById("apiEndpoint").value,
        key: document.getElementById("apiKey").value,
        apis: JSON.parse(localStorage.getItem("ai_image_gen_apis") || "[]"),
        active: localStorage.getItem("ai_image_gen_config"),
      },
    };
  })()`, true);
  assertQa(reloadDelete.before.endpoint.includes("huanapi"), "Saved API should restore after reload.", reloadDelete);
  assertQa(reloadDelete.before.provider === "custom" && reloadDelete.before.selected === saveResult.active.id, "Reopening API settings must retain the currently selected saved profile instead of showing the default/manual entry.", reloadDelete);
  assertQa(reloadDelete.after.endpoint === "" && reloadDelete.after.key === "", "Deleting active API should clear fields.", reloadDelete);
  assertQa(reloadDelete.after.apis.length === 0 && reloadDelete.after.active === null, "Deleting active API should clear storage.", reloadDelete);

  const autoPersistDraft = await cdp.eval(`(async () => {
    localStorage.clear();
    const set = (id, value) => {
      const element = document.getElementById(id);
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "official");
    set("apiEndpoint", "https://api.openai.com/v1/images/generations");
    set("apiKey", "sk-active-draft-key");
    set("model", "gpt-image-2");
    set("proxyEndpoint", "http://127.0.0.1:8787/active");
    await new Promise(resolve => setTimeout(resolve, 360));
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  })()`, true);
  assertQa(autoPersistDraft.apiProvider === "official" && autoPersistDraft.endpoint.includes("api.openai.com") && autoPersistDraft.apiKey === "sk-active-draft-key", "Changing the active API fields must persist a usable active configuration without requiring another click on Save config.", autoPersistDraft);

  await cdp.eval("location.reload()");
  for (let i = 0; i < 60; i++) {
    const restored = await cdp.eval(`document.getElementById("apiProvider")?.value === "official" && document.getElementById("apiKey")?.value === "sk-active-draft-key"`).catch(() => false);
    if (restored) break;
    await sleep(100);
  }
  const autoPersistReload = await cdp.eval(`(() => ({
    provider: document.getElementById("apiProvider").value,
    endpoint: document.getElementById("apiEndpoint").value,
    key: document.getElementById("apiKey").value,
    model: document.getElementById("model").value,
    proxy: document.getElementById("proxyEndpoint").value,
  }))()`);
  assertQa(autoPersistReload.provider === "official" && autoPersistReload.endpoint.includes("api.openai.com") && autoPersistReload.key === "sk-active-draft-key" && autoPersistReload.model === "gpt-image-2" && autoPersistReload.proxy.endsWith("/active"), "Restarting must restore the actively edited provider rather than replacing it with the default API.", autoPersistReload);

  const legacyIdentity = await cdp.eval(`(async () => {
    localStorage.clear();
    const endpoint = "https://same-endpoint.example/v1/images/generations";
    localStorage.setItem("ai_image_gen_apis", JSON.stringify([
      { name: "account-a", endpoint, apiProvider: "custom", apiKey: "", hasSecureKey: true, model: "gpt-image-2" },
      { name: "account-b", endpoint, apiProvider: "custom", apiKey: "", hasSecureKey: true, model: "gpt-image-2" }
    ]));
    localStorage.setItem("ai_image_gen_default_api_id", "1");
    const migrated = loadAllApis();
    const idsFirstRead = migrated.map(api => api.id);
    const idsSecondRead = loadAllApis().map(api => api.id);
    const defaultApi = getDefaultApiConfig();
    const migratedDefaultId = localStorage.getItem("ai_image_gen_default_api_id");
    localStorage.setItem("ai_image_gen_config", JSON.stringify(migrated[0]));
    await applyConfig(migrated[0]);
    renderSavedApis();
    document.getElementById("savedApis").value = migrated[1].id;
    document.getElementById("deleteSavedApi").click();
    const start = Date.now();
    let overlay = null;
    while (Date.now() - start < 1000) {
      overlay = document.querySelector(".ask-dialog-overlay");
      if (overlay) break;
      await new Promise(r => setTimeout(r, 20));
    }
    overlay?.querySelector(".ask-dialog-ok")?.click();
    await new Promise(r => setTimeout(r, 80));
    return {
      idsFirstRead,
      idsSecondRead,
      migratedDefaultId,
      expectedDefaultId: defaultApi?.id || "",
      activeId: JSON.parse(localStorage.getItem("ai_image_gen_config") || "{}").id || "",
      expectedActiveId: migrated[0].id,
      endpointAfterDelete: document.getElementById("apiEndpoint").value,
      remainingIds: loadAllApis().map(api => api.id),
    };
  })()`, true);
  assertQa(legacyIdentity.idsFirstRead.every(Boolean) && JSON.stringify(legacyIdentity.idsFirstRead) === JSON.stringify(legacyIdentity.idsSecondRead), "Legacy API profiles must receive stable persisted ids on first load.", legacyIdentity);
  assertQa(legacyIdentity.migratedDefaultId === legacyIdentity.expectedDefaultId, "A legacy numeric default selection must migrate to the stable API id.", legacyIdentity);
  assertQa(legacyIdentity.activeId === legacyIdentity.expectedActiveId && legacyIdentity.endpointAfterDelete.includes("same-endpoint.example"), "Deleting another redacted profile on the same endpoint must not clear the active profile.", legacyIdentity);
  assertQa(legacyIdentity.remainingIds.length === 1 && legacyIdentity.remainingIds[0] === legacyIdentity.expectedActiveId, "Only the selected non-active profile should be deleted.", legacyIdentity);

  const duplicateIdentityRepair = await cdp.eval(`(() => {
    localStorage.clear();
    const sharedId = "legacy-shared-secret-slot";
    const grsai = {
      id: sharedId, name: "GrsAI old", apiProvider: "grsai",
      endpoint: "https://grsai.dakka.com.cn/v1/api/generate", apiKey: "", hasSecureKey: true,
      model: "gpt-image-2-vip"
    };
    const official = {
      id: sharedId, name: "Official active", apiProvider: "official",
      endpoint: "https://api.openai.com/v1/images/generations", apiKey: "", hasSecureKey: true,
      model: "gpt-image-2"
    };
    localStorage.setItem(STORAGE_APIS, JSON.stringify([grsai, official]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(official));
    localStorage.setItem(DEFAULT_API_KEY, sharedId);
    apiProfileRepairNotice = null;
    const first = loadAllApis();
    const second = loadAllApis();
    return {
      first: first.map(item => ({ id: item.id, provider: item.apiProvider, hasSecureKey: item.hasSecureKey })),
      secondIds: second.map(item => item.id),
      notice: apiProfileRepairNotice,
      stored: JSON.parse(localStorage.getItem(STORAGE_APIS) || "[]"),
      defaultId: localStorage.getItem(DEFAULT_API_KEY),
    };
  })()`, true);
  const repairedOfficial = duplicateIdentityRepair.first.find(item => item.provider === "official");
  const repairedGrsai = duplicateIdentityRepair.first.find(item => item.provider === "grsai");
  assertQa(new Set(duplicateIdentityRepair.first.map(item => item.id)).size === 2 && JSON.stringify(duplicateIdentityRepair.first.map(item => item.id)) === JSON.stringify(duplicateIdentityRepair.secondIds), "Duplicate legacy API ids must be split once and remain stable on every later read.", duplicateIdentityRepair);
  assertQa(repairedOfficial.id === "legacy-shared-secret-slot" && repairedOfficial.hasSecureKey === true && duplicateIdentityRepair.defaultId === repairedOfficial.id, "The currently active profile must keep the old secure-storage slot and default id during duplicate-id repair.", duplicateIdentityRepair);
  assertQa(repairedGrsai.id !== repairedOfficial.id && repairedGrsai.hasSecureKey === false && duplicateIdentityRepair.notice?.length === 1, "Conflicting inactive profiles must receive new ids and stop reading an ambiguous secure key until the user re-enters it.", duplicateIdentityRepair);

  const sanitizedSlotRepair = await cdp.eval(`(() => {
    localStorage.clear();
    const first = {
      id: "legacy:slot", name: "Sanitized GrsAI", apiProvider: "grsai",
      endpoint: "https://grsai.dakka.com.cn/v1/api/generate", apiKey: "", hasSecureKey: true,
      model: "gpt-image-2-vip"
    };
    const active = {
      id: "legacy?slot", name: "Sanitized Official", apiProvider: "official",
      endpoint: "https://api.openai.com/v1/images/generations", apiKey: "", hasSecureKey: true,
      model: "gpt-image-2"
    };
    localStorage.setItem(STORAGE_APIS, JSON.stringify([first, active]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
    apiProfileRepairNotice = null;
    const repaired = loadAllApis();
    return {
      repaired: repaired.map(item => ({ id: item.id, provider: item.apiProvider, hasSecureKey: item.hasSecureKey })),
      secretSlots: repaired.map(item => secureApiKeyName(item.id)),
      notice: apiProfileRepairNotice,
    };
  })()`, true);
  const activeSanitizedProfile = sanitizedSlotRepair.repaired.find(item => item.provider === "official");
  assertQa(new Set(sanitizedSlotRepair.secretSlots).size === 2, "Different legacy ids that sanitize or truncate to the same secure-storage name must be split into unique secret slots.", sanitizedSlotRepair);
  assertQa(activeSanitizedProfile.id === "legacy?slot" && activeSanitizedProfile.hasSecureKey === true && sanitizedSlotRepair.notice?.length === 1, "The active profile must keep an ambiguous sanitized secret slot while the inactive profile is safely detached from it.", sanitizedSlotRepair);

  const isolatedProfiles = await cdp.eval(`(async () => {
    localStorage.clear();
    localStorage.setItem(USD_CNY_RATE_KEY, JSON.stringify({ rate: 6.77, rateDate: "2026-07-24", fetchedAt: Date.now(), source: "ECB/Frankfurter" }));
    renderSavedApis();
    const answerAskDialog = async (value) => {
      const start = Date.now();
      let overlay = null;
      while (Date.now() - start < 2000) {
        overlay = document.querySelector(".ask-dialog-overlay");
        if (overlay) break;
        await new Promise(r => setTimeout(r, 20));
      }
      if (!overlay) return false;
      const input = overlay.querySelector(".ask-dialog-input");
      if (input) input.value = value;
      overlay.querySelector(".ask-dialog-ok").click();
      return true;
    };
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    set("apiProvider", "grsai");
    set("apiKey", "sk-grsai-isolated-key");
    set("model", "gpt-image-2-vip");
    set("proxyEndpoint", "http://127.0.0.1:8787/grsai");
    document.getElementById("saveConfig").click();
    await answerAskDialog("同名完整配置");
    await new Promise(r => setTimeout(r, 100));

    set("apiProvider", "official");
    const detachedAfterProviderSwitch = {
      selected: document.getElementById("savedApis").value,
      key: document.getElementById("apiKey").value,
    };
    set("apiKey", "sk-official-isolated-key");
    set("model", "gpt-image-2");
    set("proxyEndpoint", "http://127.0.0.1:8787/official");
    setProviderSegmentValue("officialQuality", "high");
    setProviderSegmentValue("officialOutputFormat", "webp");
    document.getElementById("saveConfig").click();
    await answerAskDialog("同名完整配置");
    await new Promise(r => setTimeout(r, 100));

    set("apiProvider", "grsai");
    set("apiKey", "sk-grsai-second-account");
    set("model", "gpt-image-2-vip");
    document.getElementById("saveConfig").click();
    await answerAskDialog("同名完整配置");
    await new Promise(r => setTimeout(r, 100));

    const apis = loadAllApis();
    const grsaiIndex = apis.findIndex(api => api.apiProvider === "grsai");
    const officialIndex = apis.findIndex(api => api.apiProvider === "official");
    const selectProfile = async index => {
      document.getElementById("savedApis").value = apis[index]?.id || "";
      document.getElementById("savedApis").dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(r => setTimeout(r, 80));
      return {
        provider: document.getElementById("apiProvider").value,
        endpoint: document.getElementById("apiEndpoint").value,
        key: document.getElementById("apiKey").value,
        model: document.getElementById("model").value,
        proxy: document.getElementById("proxyEndpoint").value,
        quality: getOfficialImageOptions().quality,
        outputFormat: getOfficialImageOptions().outputFormat,
      };
    };
    const restoredGrsai = await selectProfile(grsaiIndex);
    const restoredOfficial = await selectProfile(officialIndex);
    return { detachedAfterProviderSwitch, apis, grsaiIndex, officialIndex, restoredGrsai, restoredOfficial };
  })()`, true);
  assertQa(isolatedProfiles.detachedAfterProviderSwitch.selected === "" && isolatedProfiles.detachedAfterProviderSwitch.key === "", "Switching provider from a saved profile must start a new draft and must not carry the previous profile's API key.", isolatedProfiles);
  assertQa(isolatedProfiles.apis.length === 3 && isolatedProfiles.grsaiIndex >= 0 && isolatedProfiles.officialIndex >= 0 && new Set(isolatedProfiles.apis.map(api => api.id)).size === 3 && isolatedProfiles.apis.filter(api => api.apiProvider === "grsai").length === 2 && isolatedProfiles.apis.every(api => api.name === "同名完整配置"), "Manual save must always create a distinct profile, including two accounts with the same name, provider, and endpoint; only an explicitly selected profile may be updated.", isolatedProfiles);
  assertQa(isolatedProfiles.restoredGrsai.provider === "grsai" && isolatedProfiles.restoredGrsai.endpoint.includes("grsai.dakka.com.cn") && isolatedProfiles.restoredGrsai.key === "sk-grsai-isolated-key" && isolatedProfiles.restoredGrsai.model === "gpt-image-2-vip" && isolatedProfiles.restoredGrsai.proxy.endsWith("/grsai"), "The GrsAI profile must restore its own provider, endpoint, key, model, and browser proxy.", isolatedProfiles);
  assertQa(isolatedProfiles.restoredOfficial.provider === "official" && isolatedProfiles.restoredOfficial.endpoint.includes("api.openai.com") && isolatedProfiles.restoredOfficial.key === "sk-official-isolated-key" && isolatedProfiles.restoredOfficial.model === "gpt-image-2" && isolatedProfiles.restoredOfficial.proxy.endsWith("/official") && isolatedProfiles.restoredOfficial.quality === "high" && isolatedProfiles.restoredOfficial.outputFormat === "webp", "The official profile must restore its own key and all official-specific options without borrowing GrsAI values.", isolatedProfiles);

  const modelChoice = await cdp.eval(`(async () => {
    document.getElementById("configSection").open = true;
    await new Promise(r => setTimeout(r, 50));
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "grsai");
    set("apiEndpoint", "https://grsai.dakka.com.cn/v1/api/generate");
    set("apiKey", "sk-qa-models");
    document.getElementById("quickDetectModels").click();
    await new Promise(r => setTimeout(r, 80));
    const modelInput = document.getElementById("model");
    const list = document.getElementById("modelChoicesCustomList");
    const hasAffordance = modelInput.classList.contains("has-model-choices");
    modelInput.click();
    await new Promise(r => setTimeout(r, 80));
    const options = [...list.querySelectorAll(".custom-select-option")]; // placeholder option is filtered out by initModelCombobox, so these are all real models
    const first = options[0];
    const hit = document.elementFromPoint(
      first.getBoundingClientRect().left + 5,
      first.getBoundingClientRect().top + first.getBoundingClientRect().height / 2
    );
    first?.click();
    await new Promise(r => setTimeout(r, 30));
    return {
      count: options.length,
      hasAffordance,
      hitIsOption: hit === first || first.contains(hit),
      closedAfterPick: list.classList.contains("hidden"),
      selected: document.getElementById("model").value,
    };
  })()`, true);
  assertQa(modelChoice.hasAffordance && modelChoice.count > 3, "Detected models should be clickable directly from the #model input itself (combobox pattern), not a separate dropdown control.", modelChoice);
  assertQa(modelChoice.hitIsOption, "The first model option should be genuinely hit-testable, not obscured or clipped.", modelChoice);
  assertQa(modelChoice.closedAfterPick, "Picking a model should close the dropdown.", modelChoice);
  assertQa(modelChoice.selected.length > 0, "Clicking a model choice should fill the model input.", modelChoice);

  await loadFresh(cdp, "api-mobile", { width: 430, height: 560, mobile: true });
  const mobile = await cdp.eval(`(async () => {
    document.getElementById("openApiConfig").click();
    await new Promise(r => setTimeout(r, 80));
    const body = document.querySelector("#configSection .config-body");
    const save = document.getElementById("saveConfig");
    save.scrollIntoView({ block: "end" });
    await new Promise(r => setTimeout(r, 80));
    const rect = save.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      body: {
        overflowY: getComputedStyle(body).overflowY,
        maxHeight: getComputedStyle(body).maxHeight,
      },
      saveVisible: rect.top >= 0 && rect.bottom <= innerHeight,
      saveClickable: save === hit || save.contains(hit),
    };
  })()`, true);
  assertQa(mobile.body.overflowY !== "auto" && mobile.body.maxHeight === "none", "API config body must not use an inner scroll container — that clipped the save button and made it render as a sliver overlapping the content below it.", mobile);
  assertQa(mobile.saveVisible && mobile.saveClickable, "API save button should be reachable and clickable via normal page scrolling, not hidden behind other content.", mobile);
}

async function testReferencesAndAutoFill(cdp) {
  logStep("Reference image sorting, single file picker click, and auto-fill template");
  await loadFresh(cdp, "refs");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const clickCounts = {};
    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      const key = this.id || [...this.classList].join(".");
      clickCounts[key] = (clickCounts[key] || 0) + 1;
    };
    document.getElementById("uploadZone").click();
    document.getElementById("importTxt").click();
    document.querySelector('[data-mode="comic"]').click();
    await new Promise(r => setTimeout(r, 80));
    document.querySelector(".panel-img-btn").click();
    HTMLInputElement.prototype.click = originalClick;

    async function makeImageFile(name, color) {
      const canvas = document.createElement("canvas");
      canvas.width = 3;
      canvas.height = 3;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 3, 3);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      return new File([blob], name, { type: "image/png" });
    }
    const dt = new DataTransfer();
    dt.items.add(await makeImageFile("ref-10.png", "#f33"));
    dt.items.add(await makeImageFile("ref-2.png", "#3f3"));
    dt.items.add(await makeImageFile("ref-1.png", "#33f"));
    const input = document.getElementById("refImage");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (referenceImages.length === 3) break;
      await new Promise(r => setTimeout(r, 80));
    }
    window.confirm = () => true;
    document.getElementById("autoFillTemplate").value = "panel-output";
    document.getElementById("autoFillPanels").click();
    await new Promise(r => setTimeout(r, 80));
    return {
      clickCounts,
      sortedNames: referenceImages.map(ref => ref.fileName),
      prompts: [...document.querySelectorAll("#panelTbody textarea")].map(el => el.value),
      panelCount: document.querySelectorAll("#panelTbody tr").length,
    };
  })()`, true);
  assertQa(result.clickCounts.refImage === 1, "Global reference picker should open once per click.", result);
  assertQa(result.clickCounts.txtFileInput === 1, "txt import picker should open once per click.", result);
  assertQa(result.clickCounts["panel-img-input"] === 1, "Panel reference picker should open once per click.", result);
  assertQa(JSON.stringify(result.sortedNames) === JSON.stringify(["ref-1.png", "ref-2.png", "ref-10.png"]), "Global references should be sorted naturally by name.", result);
  assertQa(result.panelCount === 1, "Comic mode should keep its explicitly created panel count when auto-fill runs.", result);
  assertQa(JSON.stringify(result.prompts) === JSON.stringify(["输出分镜1的图片"]), "The remaining comic auto-fill template should fill the panel number correctly.", result);
}

async function testUploadDebounceWindow(cdp) {
  logStep("openFileInputOnce()'s debounce must block a genuine same-instant double-fire but not a user's realistic impatient re-click a few hundred ms later -- turnaround mode's bulk upload zone gets clicked repeatedly in normal use, and users reported clicking it sometimes 'does nothing'");
  await loadFresh(cdp, "upload-debounce");
  const result = await cdp.eval(`(async () => {
    let clicks = 0;
    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this === document.getElementById("turnaroundBulkInput")) clicks++;
    };
    document.querySelector('[data-mode="turnaround"]').click();
    await new Promise(r => setTimeout(r, 50));

    const zone = document.getElementById("turnaroundUploadZone");
    zone.click();
    zone.click(); // near-instant second click -- simulates a single physical click firing twice
    await new Promise(r => setTimeout(r, 20));
    const afterRapidDouble = clicks;

    await new Promise(r => setTimeout(r, 500)); // outlast the debounce window
    zone.click(); // a realistic "nothing seemed to happen, let me click again" retry
    await new Promise(r => setTimeout(r, 20));
    const afterRealisticRetry = clicks;

    HTMLInputElement.prototype.click = originalClick;
    return { afterRapidDouble, afterRealisticRetry };
  })()`, true);

  assertQa(result.afterRapidDouble === 1, "Two clicks fired in near-instant succession (simulating a duplicated click event from a single physical click) must only open the file picker once.", result);
  assertQa(result.afterRealisticRetry === 2, "A click roughly half a second after the first (a realistic 'nothing seemed to happen, let me click again' retry) must open the file picker again, not get silently swallowed by the debounce window.", result);
}

async function testComicProjectRestorePreservesReferencesAndFailures(cdp) {
  logStep("Restoring a comic project keeps every panel and parameter but intentionally does not restore reference images");
  await loadFresh(cdp, "restore-refs-and-fails-comic");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      // Rows carrying a reference image go through the OpenAI-compatible adapter's
      // /v1/images/edits (multipart FormData), not /v1/images/generations (plain JSON) --
      // every row here has its own reference, so this is always the edits/FormData path.
      if (String(url).includes("/v1/images/generations") || String(url).includes("/v1/images/edits")) {
        const prompt = opts.body instanceof FormData ? opts.body.get("prompt") : JSON.parse(opts.body || "{}").prompt;
        if (String(prompt || "").includes("panel two prompt")) {
          return new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(url, opts);
    };
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "custom");
    set("apiEndpoint", "http://mock.local");
    set("apiKey", "sk-test");
    set("model", "gpt-image-2");
    document.querySelector('[data-mode="comic"]').click();
    await new Promise(r => setTimeout(r, 50));
    set("prompt", "GLOBAL");
    set("panelCount", "2");
    document.getElementById("createPanels").click();
    await new Promise(r => setTimeout(r, 80));

    async function makeImageFile(name, color) {
      const canvas = document.createElement("canvas");
      canvas.width = 4; canvas.height = 4;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color; ctx.fillRect(0, 0, 4, 4);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      return new File([blob], name, { type: "image/png" });
    }
    async function attachRef(row, file) {
      const input = row.querySelector(".panel-img-input");
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(r => setTimeout(r, 80));
    }

    const rows = [...document.querySelectorAll("#panelTbody tr")];
    rows[0].querySelector("textarea").value = "panel one prompt";
    rows[0].querySelector("textarea").dispatchEvent(new Event("input", { bubbles: true }));
    rows[1].querySelector("textarea").value = "panel two prompt";
    rows[1].querySelector("textarea").dispatchEvent(new Event("input", { bubbles: true }));
    await attachRef(rows[0], await makeImageFile("ref-one.png", "#f33"));
    await attachRef(rows[1], await makeImageFile("ref-two.png", "#3f3"));
    const ref1DataUrl = rows[0]._panelReference?.dataUrl;
    const ref2DataUrl = rows[1]._panelReference?.dataUrl;

    document.getElementById("generateBtn").click();
    const start = Date.now();
    while (Date.now() - start < 6000) {
      const history = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
      const panels = history[0]?.panels || [];
      if (panels.length === 2 && panels.every(panel => ["success", "failed"].includes(panel.status))) break;
      await new Promise(r => setTimeout(r, 80));
    }

    const history = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
    const item = history[0] || {};
    const savedPanelsOmitRefs = Array.isArray(item.panels) && item.panels.every(p => !p.references || p.references.length === 0);
    const savedStatuses = (item.panels || []).map(p => p.status);

    document.getElementById("resultGrid").innerHTML = "";
    document.getElementById("panelTbody").innerHTML = "";
    document.querySelector('[data-mode="single"]').click();
    await new Promise(r => setTimeout(r, 50));
    document.getElementById("historyBtn").click();
    await new Promise(r => setTimeout(r, 100));
    document.querySelector(".history-project-card .history-actions .btn")?.click();
    await new Promise(r => setTimeout(r, 200));

    const restoredRows = [...document.querySelectorAll("#panelTbody tr")];
    return {
      savedPanelsOmitRefs,
      savedStatuses,
      restoredRowCount: restoredRows.length,
      restoredPrompts: restoredRows.map(r => r.querySelector("textarea").value),
      restoredRef1Matches: restoredRows[0]?._panelReference?.dataUrl === ref1DataUrl,
      restoredRef2Matches: restoredRows[1]?._panelReference?.dataUrl === ref2DataUrl,
      restoredThumbsVisible: restoredRows.map(r => !r.querySelector(".panel-img-preview")?.classList.contains("hidden")),
    };
  })()`, true);

  assertQa(result.savedPanelsOmitRefs, "Project history must not persist large reference-image data URLs; restore is parameter-only by product requirement.", result);
  assertQa(JSON.stringify(result.savedStatuses) === JSON.stringify(["success", "failed"]), "A partially-failed comic batch must still save a project record covering every panel and tagging each one's status -- not silently drop the failed panel from history.", result);
  assertQa(result.restoredRowCount === 2, "Restoring the project must recreate both panel rows, including the one that failed to generate.", result);
  assertQa(JSON.stringify(result.restoredPrompts) === JSON.stringify(["panel one prompt", "panel two prompt"]), "Restoring must refill each row's own prompt text, for both the successful and the failed panel.", result);
  assertQa(!result.restoredRef1Matches && !result.restoredRef2Matches, "Restoring a project must not silently reattach old reference images.", result);
  assertQa(result.restoredThumbsVisible.every(value => value === false), "Reference thumbnails must remain empty after parameter-only restore.", result);
}

async function testTurnaroundProjectRestorePreservesReferencesAndFailures(cdp) {
  logStep("Restoring a turnaround project keeps every row and turnaround but intentionally does not restore reference images");
  await loadFresh(cdp, "restore-refs-and-fails-turnaround");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      // Every turnaround row carries its own reference image, so this always goes through the
      // OpenAI-compatible adapter's /v1/images/edits (multipart FormData), not the plain-JSON
      // /v1/images/generations endpoint.
      if (String(url).includes("/v1/images/generations") || String(url).includes("/v1/images/edits")) {
        const prompt = opts.body instanceof FormData ? opts.body.get("prompt") : JSON.parse(opts.body || "{}").prompt;
        if (String(prompt || "").includes("row two text")) {
          return new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(url, opts);
    };
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "custom");
    set("apiEndpoint", "http://mock.local");
    set("apiKey", "sk-test");
    set("model", "gpt-image-2");
    document.querySelector('[data-mode="turnaround"]').click();
    await new Promise(r => setTimeout(r, 50));
    set("prompt", "GLOBAL");

    async function makeImageFile(name, color) {
      const canvas = document.createElement("canvas");
      canvas.width = 4; canvas.height = 4;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color; ctx.fillRect(0, 0, 4, 4);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      return new File([blob], name, { type: "image/png" });
    }
    const dt = new DataTransfer();
    dt.items.add(await makeImageFile("cap-1.png", "#f33"));
    dt.items.add(await makeImageFile("cap-2.png", "#3f3"));
    const bulkInput = document.getElementById("turnaroundBulkInput");
    bulkInput.files = dt.files;
    bulkInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));

    const rows = [...document.querySelectorAll(".turnaround-row")];
    rows[0].querySelector(".turnaround-prompt").value = "row one text";
    rows[0].querySelector(".turnaround-prompt").dispatchEvent(new Event("input", { bubbles: true }));
    rows[1].querySelector(".turnaround-prompt").value = "row two text";
    rows[1].querySelector(".turnaround-prompt").dispatchEvent(new Event("input", { bubbles: true }));
    const ref1DataUrl = rows[0]._turnaroundReference?.dataUrl;
    const ref2DataUrl = rows[1]._turnaroundReference?.dataUrl;

    document.getElementById("generateBtn").click();
    const start = Date.now();
    while (Date.now() - start < 6000) {
      const history = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
      const panels = history[0]?.panels || [];
      if (panels.length === 2 && panels.every(panel => ["success", "failed"].includes(panel.status))) break;
      await new Promise(r => setTimeout(r, 80));
    }

    const history = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
    const item = history[0] || {};
    const savedPanelsOmitRefs = Array.isArray(item.panels) && item.panels.every(p => !p.references || p.references.length === 0);
    const savedStatuses = (item.panels || []).map(p => p.status);

    document.getElementById("resultGrid").innerHTML = "";
    document.getElementById("turnaroundTbody").innerHTML = "";
    document.querySelector('[data-mode="single"]').click();
    await new Promise(r => setTimeout(r, 50));
    document.getElementById("historyBtn").click();
    await new Promise(r => setTimeout(r, 100));
    document.querySelector(".history-project-card .history-actions .btn")?.click();
    await new Promise(r => setTimeout(r, 200));

    const restoredRows = [...document.querySelectorAll(".turnaround-row")];
    return {
      savedPanelsOmitRefs,
      savedStatuses,
      restoredRowCount: restoredRows.length,
      restoredTexts: restoredRows.map(r => r.querySelector(".turnaround-prompt").value),
      restoredRef1Matches: restoredRows[0]?._turnaroundReference?.dataUrl === ref1DataUrl,
      restoredRef2Matches: restoredRows[1]?._turnaroundReference?.dataUrl === ref2DataUrl,
      restoredThumbsVisible: restoredRows.map(r => !r.querySelector(".panel-img-preview")?.classList.contains("hidden")),
    };
  })()`, true);

  assertQa(result.savedPanelsOmitRefs, "Turnaround project history must not persist reference-image bytes.", result);
  assertQa(JSON.stringify(result.savedStatuses) === JSON.stringify(["success", "failed"]), "A partially-failed turnaround batch must still save a project record covering every row and tagging each one's status.", result);
  assertQa(result.restoredRowCount === 2, "Restoring the project must recreate both turnaround rows, including the one that failed to generate.", result);
  assertQa(JSON.stringify(result.restoredTexts) === JSON.stringify(["row one text", "row two text"]), "Restoring must refill each row's own turnaround text, for both the successful and the failed row.", result);
  assertQa(!result.restoredRef1Matches && !result.restoredRef2Matches, "Restoring a turnaround project must not reattach old reference images.", result);
  assertQa(result.restoredThumbsVisible.every(value => value === false), "Restored turnaround rows must show empty image slots until the user chooses references again.", result);
}

async function testInterruptedProjectCheckpointResume(cdp) {
  logStep("Interrupted comic checkpoints preserve completed panels, expose missing panels for retry, and never restore reference bytes silently");
  await loadFresh(cdp, "interrupted-project-checkpoint");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const projectId = "checkpoint-project";
    const tiny = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==";
    initializeProjectCheckpoint({
      id: projectId,
      type: "comic-project",
      mode: "comic",
      title: "Checkpoint project",
      createdAt: new Date().toISOString(),
      globalPrompt: "global style",
      model: "gpt-image-2",
      endpoint: "http://127.0.0.1:10100/v1/images/generations",
      size: "1024x1536",
      retryCount: 2,
      totalPanels: 3,
      panels: [1, 2, 3].map(id => ({
        panelId: String(id), panelPrompt: "panel-" + id, prompt: "panel-" + id,
        size: "1024x1536", retryCount: 2, references: [], hadReferences: id === 2, status: "pending",
      })),
    });
    const blob = dataUrlToBlob(tiny);
    const record = {
      id: "checkpoint-image-1", createdAt: new Date().toISOString(), mode: "comic", panelId: "1",
      prompt: "panel-1", panelPrompt: "panel-1", fullPrompt: "global style\\n\\npanel-1",
      model: "gpt-image-2", endpoint: "http://127.0.0.1:10100", size: "1024x1536",
      imageUrl: tiny, originalUrl: tiny, retryCount: 2, provider: "opencodex-local-image",
      requested: { model: "gpt-image-2", size: "1024x1536" },
      actual: { width: 1, height: 1, dimensionStatus: "mismatch", mimeType: "image/png", bytes: blob.size },
      audit: { requestId: "req-checkpoint", promptSha256: "a".repeat(64), referenceSha256: [], requestFingerprint: "b".repeat(64), outputSha256: "c".repeat(64) },
      review: "pending", _cachePromise: Promise.resolve(blob), _cacheKey: "checkpoint-image-1", _actualMetaPromise: Promise.resolve(),
    };
    await updateProjectCheckpoint(projectId, "1", { status: "success", record });
    await updateProjectCheckpoint(projectId, "2", { status: "failed", error: "HTTP 502: socket closed" });
    await finalizeProjectCheckpoint(projectId, 1, 1);
    const stored = loadHistory().find(item => item.id === projectId);
    restoreHistoryItem(stored);
    await new Promise(resolve => setTimeout(resolve, 100));
    const cards = [...document.querySelectorAll("#resultGrid .result-item")];
    return {
      projectStatus: stored.status,
      images: stored.images.length,
      imagePrompt: stored.images[0]?.prompt,
      imageFullPrompt: stored.images[0]?.fullPrompt || "",
      panelStatuses: stored.panels.map(panel => panel.status),
      cardStatuses: cards.map(card => card.dataset.status),
      failedPanels: cards.filter(card => card.dataset.status === "failed").map(card => card._retryContext?.panelId),
      panel2ReferencesMissing: cards.find(card => card._retryContext?.panelId === "2")?._retryContext?.referencesMissing === true,
    };
  })()`, true);

  assertQa(result.projectStatus === "partial" && result.images === 1 && result.panelStatuses.join(",") === "success,failed,pending", "Checkpoint history must retain per-panel success, failure, and pending states after interruption.", result);
  assertQa(result.imagePrompt === "panel-1" && result.imageFullPrompt === "", "Checkpoint image records must keep only the panel prompt, never the combined global prompt body.", result);
  assertQa(result.cardStatuses.filter(status => status === "success").length === 1 && result.failedPanels.join(",") === "2,3", "Restoring an interrupted project must show completed bytes and retry cards for every missing panel.", result);
  assertQa(result.panel2ReferencesMissing, "A missing panel that originally used references must require the user to import them again instead of silently degrading to text-only generation.", result);
}

async function testHistoryRestoreAndExport(cdp) {
  logStep("Comic generation history as project, restore, and ZIP export");
  await loadFresh(cdp, "history");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const originalFetch = window.fetch.bind(window);
    window.__apiCalls = [];
    window.fetch = async (url, opts = {}) => {
      if (String(url).includes("/v1/images/generations")) {
        let body = {};
        try { body = JSON.parse(opts.body || "{}"); } catch {}
        window.__apiCalls.push({ url: String(url), prompt: body.prompt, size: body.size });
        return new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(url, opts);
    };
    window.__downloads = [];
    window.__downloadBlobs = [];
    const originalCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      const url = originalCreate(blob);
      window.__downloadBlobs.push({ blob, url, size: blob.size, type: blob.type });
      return url;
    };
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    window.__revokedUrls = [];
    URL.revokeObjectURL = url => {
      window.__revokedUrls.push({ url, at: Date.now() });
      return originalRevoke(url);
    };
    HTMLAnchorElement.prototype.click = function () {
      window.__downloads.push({ download: this.download, href: this.href });
    };
    async function listZipEntries(blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let eocd = -1;
      for (let i = bytes.length - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
          eocd = i;
          break;
        }
      }
      if (eocd < 0) throw new Error("ZIP end record not found");
      const count = view.getUint16(eocd + 10, true);
      let offset = view.getUint32(eocd + 16, true);
      const decoder = new TextDecoder();
      const names = [];
      for (let i = 0; i < count; i++) {
        if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Bad ZIP central directory");
        const nameLen = view.getUint16(offset + 28, true);
        const extraLen = view.getUint16(offset + 30, true);
        const commentLen = view.getUint16(offset + 32, true);
        names.push(decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLen)));
        offset += 46 + nameLen + extraLen + commentLen;
      }
      return names;
    }
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "custom");
    set("apiEndpoint", "http://mock.local");
    set("apiKey", "sk-test");
    set("model", "gpt-image-2");
    document.querySelector('[data-mode="comic"]').click();
    await new Promise(r => setTimeout(r, 50));
    set("prompt", "GLOBAL STYLE");
    set("panelCount", "3");
    document.getElementById("createPanels").click();
    await new Promise(r => setTimeout(r, 80));
    [...document.querySelectorAll("#panelTbody tr")].forEach((row, index) => {
      const input = row.querySelector("textarea");
      input.value = "panel " + (index + 1) + " only";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const retry = row.querySelector(".panel-retry-count");
      if (retry && index === 1) {
        retry.value = "2";
        retry.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    document.getElementById("generateBtn").click();
    const start = Date.now();
    while (Date.now() - start < 5000) {
      const history = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
      if (history.length === 1 && document.querySelectorAll(".result-item img").length === 3) break;
      await new Promise(r => setTimeout(r, 80));
    }
    const history = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
    const item = history[0] || {};
    document.getElementById("historyBtn").click();
    await new Promise(r => setTimeout(r, 100));
    const historyUi = {
      projectCards: document.querySelectorAll(".history-project-card").length,
      detailsOpen: document.querySelector(".history-project-details")?.open || false,
    };
    document.querySelector(".history-project-card .history-actions .btn")?.click();
    await new Promise(r => setTimeout(r, 250));
    const restored = {
      globalPrompt: document.getElementById("prompt").value,
      panelPrompts: [...document.querySelectorAll("#panelTbody textarea")].map(el => el.value),
      resultPrompts: [...document.querySelectorAll(".result-item")].map(card => card._retryContext?.prompt || ""),
      resultPanelPrompts: [...document.querySelectorAll(".result-item")].map(card => card._retryContext?.panelPrompt || ""),
      resultImages: document.querySelectorAll(".result-item img").length,
    };
    document.getElementById("zipFileName").value = "qa-history-export";
    document.getElementById("downloadZip").click();
    const exportStart = Date.now();
    while (Date.now() - exportStart < 5000) {
      if (window.__downloadBlobs.some(item => item.type === "application/zip") && !document.getElementById("downloadZip").disabled) break;
      await new Promise(r => setTimeout(r, 80));
    }
    const zipBlobs = () => window.__downloadBlobs.filter(item => item.type === "application/zip");
    const blobRec = zipBlobs()[0];
    let zipText = "";
    if (blobRec) zipText = new TextDecoder().decode(await blobRec.blob.arrayBuffer());
    const zipEntries = blobRec ? await listZipEntries(blobRec.blob) : [];
    document.getElementById("zipFileName").value = "qa-header-export";
    document.getElementById("exportBtn").click();
    const headerExportStart = Date.now();
    while (Date.now() - headerExportStart < 5000) {
      if (zipBlobs().length >= 2 && !document.getElementById("downloadZip").disabled) break;
      await new Promise(r => setTimeout(r, 80));
    }
    const headerCurrentBlob = zipBlobs()[1];
    const headerCurrentEntries = headerCurrentBlob ? await listZipEntries(headerCurrentBlob.blob) : [];
    document.getElementById("resultGrid").innerHTML = "";
    document.getElementById("resultGrid").classList.add("hidden");
    document.getElementById("emptyState").classList.remove("hidden");
    document.getElementById("resultToolbar").classList.add("hidden");
    document.getElementById("historyModal").classList.add("hidden");
    document.body.style.overflow = "";
    document.getElementById("exportBtn").click();
    await new Promise(r => setTimeout(r, 120));
    const historyOpenedFromExport = !document.getElementById("historyModal").classList.contains("hidden");
    const historyProjectButtons = [...document.querySelectorAll(".history-project-card .history-actions .btn")]
      .map(btn => btn.textContent.trim());
    const projectExportButton = [...document.querySelectorAll(".history-project-card .history-actions .btn")]
      .find(btn => /导出|匯出|Export|書き出し|내보내기/.test(btn.textContent)) ||
      document.querySelectorAll(".history-project-card .history-actions .btn")[1];
    projectExportButton?.click();
    const projectExportStart = Date.now();
    while (Date.now() - projectExportStart < 5000) {
      if (zipBlobs().length >= 3) break;
      await new Promise(r => setTimeout(r, 80));
    }
    const projectBlob = zipBlobs()[2];
    const projectEntries = projectBlob ? await listZipEntries(projectBlob.blob) : [];
    const projectDownload = window.__downloads[window.__downloads.length - 1] || null;
    const directBefore = { downloads: window.__downloads.length, revokes: window.__revokedUrls.length };
    triggerDownload(new Blob(["direct"], { type: "text/plain" }), "direct.txt");
    await new Promise(r => setTimeout(r, 50));
    const directDownload = {
      clicked: window.__downloads.slice(directBefore.downloads).some(item => item.download === "direct.txt"),
      immediateRevokes: window.__revokedUrls.length - directBefore.revokes,
    };
    return {
      apiCalls: window.__apiCalls,
      history: {
        length: history.length,
        type: item.type,
        globalPrompt: item.globalPrompt,
        prompt: item.prompt,
        images: item.images?.length,
        panels: item.panels?.length,
        imagePrompts: item.images?.map(image => image.prompt),
        imageFullPrompts: item.images?.map(image => image.fullPrompt),
        panelFullPrompts: item.panels?.map(panel => panel.fullPrompt),
        retryCounts: item.images?.map(image => image.retryCount),
      },
      historyUi,
      restored,
      export: {
        downloads: window.__downloads,
        blob: blobRec ? { size: blobRec.size, type: blobRec.type } : null,
        entries: zipEntries,
        zipHasPrompts: zipText.includes("prompts.txt"),
        zipHasProject: zipText.includes("project.json"),
        zipHasPanel1: zipText.includes("panel-1.png"),
        zipHasGlobal: zipText.includes("GLOBAL STYLE"),
        zipHasPanelOnly: zipText.includes("panel 1 only"),
        zipHasCombinedPromptInPanel: zipText.includes("GLOBAL STYLE\\\\n\\\\npanel 1 only"),
      },
      headerExportCurrent: {
        download: window.__downloads.find(item => item.download === "qa-header-export.zip") || null,
        blob: headerCurrentBlob ? { size: headerCurrentBlob.size, type: headerCurrentBlob.type } : null,
        entries: headerCurrentEntries,
      },
      headerExportHistory: {
        opened: historyOpenedFromExport,
        projectCards: document.querySelectorAll(".history-project-card").length,
        projectButtons: historyProjectButtons,
        projectExport: projectBlob ? { download: projectDownload?.download || "", size: projectBlob.size, type: projectBlob.type, entries: projectEntries } : null,
      },
      directDownload,
      buttonDisabled: document.getElementById("generateBtn").disabled,
    };
  })()`, true);
  assertQa(result.apiCalls.length === 3, "Comic generation should call the API once per panel.", result);
  assertQa(result.history.length === 1 && result.history.type === "comic-project", "Comic history should be stored as one project record.", result);
  assertQa(result.history.images === 3 && result.history.panels === 3, "Project record should contain all images and panel prompts.", result);
  assertQa(JSON.stringify(result.history.imagePrompts) === JSON.stringify(["panel 1 only", "panel 2 only", "panel 3 only"]), "Image-level history prompts should be panel-only.", result);
  assertQa(result.history.imageFullPrompts.every(text => text == null) && result.history.panelFullPrompts.every(text => text == null), "Project history should not store combined full prompts on image or panel records.", result);
  assertQa(JSON.stringify(result.history.retryCounts) === JSON.stringify([3, 2, 3]), "Panel retry override should be stored in history.", result);
  assertQa(result.historyUi.projectCards === 1 && result.historyUi.detailsOpen === false, "History UI should show one collapsed project card.", result);
  assertQa(JSON.stringify(result.restored.panelPrompts) === JSON.stringify(["panel 1 only", "panel 2 only", "panel 3 only"]), "Restored editor should keep panel prompts panel-only.", result);
  assertQa(result.restored.resultImages === 3, "Restored project should repopulate result images.", result);
  assertQa(result.export.downloads[0]?.download === "qa-history-export.zip", "ZIP export should create the requested file name.", result);
  assertQa(result.export.blob?.type === "application/zip" && result.export.blob.size > 500, "ZIP export should produce a non-empty ZIP blob.", result);
  assertQa(result.export.zipHasPrompts && result.export.zipHasProject && result.export.zipHasPanel1, "ZIP should contain images, prompts, and project JSON.", result);
  assertQa(result.export.entries.includes("comic-project/panel-1.png") && result.export.entries.includes("comic-project/project.json"), "ZIP should expose valid central-directory entries.", result);
  assertQa(result.export.zipHasGlobal && result.export.zipHasPanelOnly && !result.export.zipHasCombinedPromptInPanel, "ZIP prompt export should separate global and panel prompts.", result);
  assertQa(result.headerExportCurrent.download?.download === "qa-header-export.zip", "Header export should download current result images.", result);
  assertQa(result.headerExportCurrent.blob?.type === "application/zip" && result.headerExportCurrent.entries.includes("comic-project/prompts.txt"), "Header export should produce a valid ZIP for current results.", result);
  assertQa(result.headerExportHistory.opened && result.headerExportHistory.projectCards === 1, "Header export should open history when current results are empty.", result);
  assertQa(result.headerExportHistory.projectButtons.some(text => text.includes("导出") || text.includes("Export")), "History project cards should expose project export after header export.", result);
  assertQa(result.headerExportHistory.projectExport?.type === "application/zip" && result.headerExportHistory.projectExport.entries.some(name => name.endsWith("/project.json")), "History project export button should create a valid project ZIP.", result);
  assertQa(result.directDownload.clicked && result.directDownload.immediateRevokes === 0, "Browser download should not revoke its object URL immediately.", result);
  assertQa(result.buttonDisabled === false, "Generate button should reset after generation.", result);
}

async function testExportedProjectFolderRoundTrip(cdp) {
  logStep("Project exports include reference images and an exported folder restores prompts, dimensions, references, and result images");
  await loadFresh(cdp, "exported-folder-roundtrip");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    await clearHistoryBlobStore().catch(() => {});
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const pngBytes = base64ToBytes(png);
    const ref = { fileName: "global-reference.png", dataUrl: "data:image/png;base64," + png, width: 1, height: 1 };
    referenceImages = [ref];
    renderThumbGrid();
    switchMode("comic");
    dom.panelTbody.innerHTML = "";
    panelCounter = 0;
    const row = addPanelRow();
    row.querySelector("textarea").value = "restored panel prompt";
    row.querySelector(".panel-size-w").value = "1024";
    row.querySelector(".panel-size-h").value = "1536";
    const card = document.createElement("div");
    card.className = "result-item";
    dom.resultGrid.innerHTML = "";
    dom.resultGrid.appendChild(card);
    replacePlaceholder(card, "1", { data: [{ b64_json: png, mime_type: "image/png" }] }, "GLOBAL\\n\\nrestored panel prompt", {
      skipHistory: true,
      recordPrompt: "restored panel prompt",
      fullPrompt: "GLOBAL\\n\\nrestored panel prompt",
      size: "1024x1536",
      retryContext: {
        mode: "comic", panelId: "1", globalPrompt: "GLOBAL", panelPrompt: "restored panel prompt",
        prompt: "GLOBAL\\n\\nrestored panel prompt", fullPrompt: "GLOBAL\\n\\nrestored panel prompt",
        size: "1024x1536", references: [ref], retryCount: 2,
      },
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    const images = getCurrentResultImages();
    const meta = buildCurrentProjectExportMeta(images, { title: "roundtrip", globalPrompt: "GLOBAL" });
    const zip = await buildImagesZip(images, { ...meta, folder: "roundtrip" });
    const zipText = new TextDecoder().decode(await zip.arrayBuffer());
    const zipFile = new File([zip], "roundtrip.zip", { type: "application/zip" });
    const zipFiles = await extractProjectZipFiles(zipFile);
    const zipFilePaths = zipFiles.map(file => file.webkitRelativePath || file.name);
    const manifest = {
      schema: 3,
      format: "langbai-project-folder",
      title: "roundtrip",
      mode: "comic",
      createdAt: new Date().toISOString(),
      model: "gpt-image-2",
      globalPrompt: "GLOBAL",
      size: "1024x1536",
      retryCount: 2,
      references: [{ id: "ref-1", filename: PROJECT_EXPORT_REFERENCE_DIR + "/" + PROJECT_EXPORT_REFERENCE_DIR + "-001-global-reference.png", fileName: "global-reference.png", width: 1, height: 1, scopes: ["global"] }],
      globalReferenceIds: ["ref-1"],
      panels: [{ panelId: "1", panelPrompt: "restored panel prompt", prompt: "restored panel prompt", size: "1024x1536", retryCount: 2, referenceIds: [] }],
      images: [{ filename: "panel-1.png", panelId: "1", prompt: "restored panel prompt", panelPrompt: "restored panel prompt", size: "1024x1536", retryCount: 2, referenceIds: ["ref-1"] }],
    };
    const fileWithPath = (name, bytes, type, relative) => {
      const file = new File([bytes], name, { type });
      Object.defineProperty(file, "webkitRelativePath", { value: relative });
      return file;
    };
    await restoreExportedProjectFromFiles([
      fileWithPath("project.json", JSON.stringify(manifest), "application/json", "roundtrip/project.json"),
      fileWithPath("panel-1.png", pngBytes, "image/png", "roundtrip/panel-1.png"),
      fileWithPath(PROJECT_EXPORT_REFERENCE_DIR + "-001-global-reference.png", pngBytes, "image/png", "roundtrip/" + PROJECT_EXPORT_REFERENCE_DIR + "/" + PROJECT_EXPORT_REFERENCE_DIR + "-001-global-reference.png"),
    ]);
    await new Promise(resolve => setTimeout(resolve, 100));
    const folderRoundTrip = {
      refs: referenceImages.length,
      cards: document.querySelectorAll(".result-item img").length,
      retryRefs: document.querySelector(".result-item")?._retryContext?.references?.length || 0,
    };
    await restoreExportedProjectFromZip(zipFile);
    await new Promise(resolve => setTimeout(resolve, 100));
    let damagedZipRejected = false;
    try { await extractProjectZipFiles(new File([new Uint8Array([1, 2, 3, 4])], "damaged.zip", { type: "application/zip" })); }
    catch { damagedZipRejected = true; }
    let deflateRoundTrip = null;
    if (typeof CompressionStream === "function" && typeof DecompressionStream === "function") {
      const raw = new TextEncoder().encode("project-zip-deflate");
      const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
      const restored = await inflateProjectZipEntry(compressed);
      deflateRoundTrip = new TextDecoder().decode(restored) === "project-zip-deflate";
    }
    return {
      zipHasReference: zipText.includes(PROJECT_EXPORT_REFERENCE_DIR + "/" + PROJECT_EXPORT_REFERENCE_DIR + "-001-global-reference.png"),
      references: referenceImages.map(item => item.fileName),
      panelPrompt: document.querySelector("#panelTbody textarea")?.value || "",
      panelSize: (document.querySelector("#panelTbody .panel-size-w")?.value || "") + "x" + (document.querySelector("#panelTbody .panel-size-h")?.value || ""),
      resultImages: document.querySelectorAll(".result-item img").length,
      retryReferenceCount: document.querySelector(".result-item")?._retryContext?.references?.length || 0,
      importedHistoryProject: loadHistory().find(item => String(item.id || "").startsWith("imported_"))?.type || "",
      referenceDirectory: PROJECT_EXPORT_REFERENCE_DIR,
      folderRoundTrip,
      zipRoundTrip: {
        extractedProject: zipFilePaths.some(path => /(^|\\/)project\.json$/i.test(path)),
        extractedReference: zipFilePaths.some(path => path.includes(PROJECT_EXPORT_REFERENCE_DIR + "/")),
        refs: referenceImages.length,
        cards: document.querySelectorAll(".result-item img").length,
        retryRefs: document.querySelector(".result-item")?._retryContext?.references?.length || 0,
      },
      damagedZipRejected,
      deflateRoundTrip,
    };
  })()`, true);
  assertQa(result.zipHasReference, "ZIP export must contain global reference images in the named reference folder.", result);
  assertQa(result.references.includes("global-reference.png"), "Folder restore must reattach exported global reference images.", result);
  assertQa(result.panelPrompt === "restored panel prompt" && result.panelSize === "1024x1536", "Folder restore must restore panel prompts and per-panel dimensions.", result);
  assertQa(result.folderRoundTrip.cards === 1 && result.folderRoundTrip.retryRefs === 1, "Folder restore must restore output cards and their reference-aware retry context.", result);
  assertQa(result.importedHistoryProject === "comic-project", "Restored comic folders should be added to history as one project without embedding reference bytes.", result);
  assertQa(result.folderRoundTrip.refs === 1 && result.folderRoundTrip.cards === 1, "Folder restore must remain functional alongside ZIP restore.", result);
  assertQa(result.zipRoundTrip.extractedProject && result.zipRoundTrip.extractedReference && result.zipRoundTrip.refs === 1 && result.zipRoundTrip.cards === 1 && result.zipRoundTrip.retryRefs === 1, "Project ZIP restore must restore its manifest, references, and result image through the same project recovery path.", result);
  assertQa(result.damagedZipRejected, "Damaged project ZIP files must be rejected before they can change the workspace.", result);
  assertQa(result.deflateRoundTrip === null || result.deflateRoundTrip === true, "When the browser exposes Deflate streams, project ZIP restore must correctly inflate a raw Deflate entry.", result);
}

async function testHistoryImageCacheFallback(cdp) {
  logStep("History previews, lightbox, and ZIP export fall back to the original image URL when IndexedDB bytes are missing");
  await loadFresh(cdp, "history-image-fallback");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const originalUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    localStorage.setItem("ai_image_gen_history_v1", JSON.stringify([{
      id: "fallback-single", type: "single", mode: "single", createdAt: new Date().toISOString(),
      imageUrl: "idb://missing-history-blob", originalUrl, prompt: "fallback image", panelId: "1"
    }]));
    renderHistory();
    await new Promise(r => setTimeout(r, 80));
    const previewSrc = document.querySelector(".history-card img")?.src || "";
    await openLightbox("idb://missing-history-blob", originalUrl);
    await new Promise(r => setTimeout(r, 30));
    const lightboxSrc = document.querySelector(".lightbox img")?.src || "";
    document.querySelector(".lightbox")?.click();
    document.querySelector(".history-card .history-actions .btn")?.click();
    const restoreStart = Date.now();
    while (Date.now() - restoreStart < 2000) {
      const card = document.querySelector(".result-item");
      if (card?._zipBlob?.size > 0 && card.querySelector("img")?.src.startsWith("blob:")) break;
      await new Promise(r => setTimeout(r, 30));
    }
    const restoredCard = document.querySelector(".result-item");
    const restored = {
      src: restoredCard?.querySelector("img")?.src || "",
      blobSize: restoredCard?._zipBlob?.size || 0,
    };
    const blob = await imageUrlToBlobWithFallback("idb://missing-history-blob", originalUrl);
    const zip = await buildImagesZip([{
      url: "idb://missing-history-blob", originalUrl, panelId: "1", prompt: "fallback image"
    }], { folder: "fallback", mode: "single" });
    return { previewSrc, lightboxSrc, restored, blob: { size: blob.size, type: blob.type }, zip: { size: zip.size, type: zip.type } };
  })()`, true);
  assertQa(result.previewSrc.startsWith("data:image/png;base64,"), "A missing IndexedDB preview must use the preserved original URL.", result);
  assertQa(result.lightboxSrc.startsWith("data:image/png;base64,"), "The lightbox must use the original URL when its IndexedDB blob is gone.", result);
  assertQa(result.restored.src.startsWith("blob:") && result.restored.blobSize > 0, "Restoring a history item must carry its original URL into the result card when IndexedDB bytes are missing.", result);
  assertQa(result.blob.type === "image/png" && result.blob.size > 0, "Image-byte loading must fall back to the original URL.", result);
  assertQa(result.zip.type === "application/zip" && result.zip.size > 200, "Project ZIP export must still work after history image cache eviction.", result);
}

async function testGeneratedImagePersistentCache(cdp) {
  logStep("Every successful image is persisted immediately in the app cache even when history is disabled, retention cleanup removes only expired entries, and history reuses cache:// bytes");
  await loadFresh(cdp, "generated-image-cache");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    await generatedCacheCleanupQueue.catch(() => {});
    await clearGeneratedCacheStore();
    saveSettings({ historyEnabled: false, cacheRetentionDays: 7 });
    dom.resultGrid.innerHTML = "";
    dom.resultGrid.classList.remove("hidden");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const card = addResultPlaceholder("cache-1", "cache test", { mode: "single", prompt: "cache test" });
    const record = replacePlaceholder(card, "cache-1", { data: [{ b64_json: png }] }, "cache test", { mode: "single" });
    const generatedBlob = await record._cachePromise;
    const persistedBlob = await getGeneratedCacheBlob(record._cacheKey);
    const historyWhileDisabled = loadHistory().length;

    const now = Date.now();
    await putGeneratedCacheBlob("qa-expired", generatedBlob, now - 8 * 86400000);
    await putGeneratedCacheBlob("qa-fresh", generatedBlob, now - 6 * 86400000);
    await putGeneratedCacheBlob(record._cacheKey, generatedBlob, now - 30 * 86400000);
    await putGeneratedCacheBlob("qa-checkpoint-live", generatedBlob, now - 30 * 86400000);
    saveHistory([{
      id: "checkpoint-live",
      type: "project",
      mode: "comic",
      createdAt: new Date().toISOString(),
      images: [{ imageUrl: "cache://qa-checkpoint-live" }],
      panels: [{ id: "1", status: "running", cachedImageUrl: "cache://qa-checkpoint-live" }],
    }]);
    const removed = await cleanupGeneratedImageCache({ now, force: true });
    const expired = await getGeneratedCacheBlob("qa-expired");
    const fresh = await getGeneratedCacheBlob("qa-fresh");
    const currentLive = await getGeneratedCacheBlob(record._cacheKey);
    const checkpointLive = await getGeneratedCacheBlob("qa-checkpoint-live");

    saveSettings({ historyEnabled: true });
    const historyCard = addResultPlaceholder("cache-2", "history cache test", { mode: "single", prompt: "history cache test" });
    const historyRecord = replacePlaceholder(historyCard, "cache-2", { data: [{ b64_json: png }] }, "history cache test", { mode: "single" });
    await historyRecord._cachePromise;
    const waitStart = Date.now();
    let savedHistoryRecord = null;
    while (!savedHistoryRecord && Date.now() - waitStart < 2000) {
      savedHistoryRecord = loadHistory().find(item => item.id === historyRecord.id) || null;
      if (!savedHistoryRecord) await new Promise(r => setTimeout(r, 20));
    }
    const historyUrl = savedHistoryRecord?.imageUrl || "";

    document.getElementById("cacheRetentionDays").value = "14";
    document.getElementById("cacheRetentionDays").dispatchEvent(new Event("change", { bubbles: true }));
    await generatedCacheCleanupQueue;
    const savedRetention = loadSettings().cacheRetentionDays;
    const cleared = await clearGeneratedCacheStore();
    return {
      generatedSize: generatedBlob?.size || 0,
      persistedSize: persistedBlob?.size || 0,
      historyWhileDisabled,
      removed,
      expiredExists: !!expired,
      freshExists: !!fresh,
      currentLiveExists: !!currentLive,
      checkpointLiveExists: !!checkpointLive,
      historyUrl,
      savedRetention,
      cleared,
      controls: {
        days: !!document.getElementById("cacheRetentionDays"),
        clear: !!document.getElementById("clearGeneratedCache"),
        status: !!document.getElementById("generatedCacheStatus"),
      },
    };
  })()`, true);
  assertQa(result.generatedSize > 0 && result.persistedSize === result.generatedSize, "A successful generated image must be written to persistent app cache immediately.", result);
  assertQa(result.historyWhileDisabled === 0, "The image cache must remain independent from the optional history feature.", result);
  assertQa(result.removed >= 1 && !result.expiredExists && result.freshExists, "Retention cleanup must delete expired cache entries while retaining newer images.", result);
  assertQa(result.currentLiveExists && result.checkpointLiveExists, "Retention cleanup must protect cache keys referenced by current cards, history and resumable checkpoints even when they are old.", result);
  assertQa(result.historyUrl.startsWith("cache://"), "New history records should reuse the generated cache instead of duplicating image bytes in the legacy history store.", result);
  assertQa(result.savedRetention === 14 && Object.values(result.controls).every(Boolean), "Cache retention controls must save their value and remain present in Settings.", result);
}

async function testHistoryPruneConcurrency(cdp) {
  logStep("Concurrent history saves serialize IndexedDB pruning and always use the newest history snapshot");
  await loadFresh(cdp, "history-prune-concurrency");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const originalPrune = pruneHistoryBlobStore;
    const snapshots = [];
    pruneHistoryBlobStore = async list => {
      snapshots.push(list.map(item => item.id));
      await new Promise(r => setTimeout(r, 30));
    };
    const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
    const oldItem = { id: "old", type: "single", mode: "single", imageUrl, createdAt: "2026-01-01T00:00:00Z" };
    const newItem = { id: "new", type: "single", mode: "single", imageUrl, createdAt: "2026-01-02T00:00:00Z" };
    saveHistory([oldItem]);
    saveHistory([newItem, oldItem]);
    await historyBlobPruneQueue;
    pruneHistoryBlobStore = originalPrune;
    return { snapshots, stored: loadHistory().map(item => item.id) };
  })()`, true);
  assertQa(result.snapshots.length === 2 && result.snapshots.every(ids => ids.includes("new") && ids.includes("old")), "Every queued prune must read the latest history instead of deleting blobs from a newer save.", result);
  assertQa(JSON.stringify(result.stored) === JSON.stringify(["new", "old"]), "Concurrent history saves must retain both records.", result);
}

async function testRetryReplacesHistoryEntry(cdp) {
  logStep("Retrying a generated image updates its history entry in place instead of leaving a stale duplicate");
  await loadFresh(cdp, "retry-history");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const originalFetch = window.fetch.bind(window);
    window.__calls = [];
    window.fetch = async (url, opts = {}) => {
      if (String(url).includes("/v1/images/generations")) {
        let body = {};
        try { body = JSON.parse(opts.body || "{}"); } catch {}
        window.__calls.push(body.prompt);
        return new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(url, opts);
    };
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "custom");
    set("apiEndpoint", "http://mock.local");
    set("apiKey", "sk-test");
    set("model", "gpt-image-2");

    // --- 单图模式：生成一张，重试它，历史记录数量应该还是 1（不是 2） ---
    document.querySelector('[data-mode="single"]').click();
    await new Promise(r => setTimeout(r, 50));
    set("prompt", "single retry test");
    document.getElementById("generateBtn").click();
    let start = Date.now();
    while (Date.now() - start < 4000) {
      if (JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]").length === 1) break;
      await new Promise(r => setTimeout(r, 80));
    }
    const historyAfterFirstGen = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
    const firstRecordId = historyAfterFirstGen[0]?.id;
    [...document.querySelectorAll(".result-item .card-action")].find(b => b.querySelector(".ui-icon-retry"))?.click();
    start = Date.now();
    while (Date.now() - start < 4000) {
      const h = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
      if (h.length && h[0]?.id !== firstRecordId) break;
      await new Promise(r => setTimeout(r, 80));
    }
    const historyAfterSingleRetry = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");

    // --- 漫画模式：生成 2 个分镜，重试第一个，项目历史记录应该还是 1 条、还是 2 张图 ---
    document.querySelector('[data-mode="comic"]').click();
    await new Promise(r => setTimeout(r, 50));
    localStorage.setItem("ai_image_gen_history_v1", JSON.stringify(historyAfterSingleRetry));
    set("prompt", "GLOBAL");
    set("panelCount", "2");
    document.getElementById("createPanels").click();
    await new Promise(r => setTimeout(r, 80));
    [...document.querySelectorAll("#panelTbody tr")].forEach((row, index) => {
      const input = row.querySelector("textarea");
      input.value = "comic panel " + (index + 1);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    document.getElementById("generateBtn").click();
    start = Date.now();
    while (Date.now() - start < 5000) {
      const h = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
      if (h.length === 2 && document.querySelectorAll(".result-item img").length === 2) break;
      await new Promise(r => setTimeout(r, 80));
    }
    const historyAfterComicGen = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
    const comicProject = historyAfterComicGen.find(item => item.type === "comic-project");
    const panel1ImageIdBefore = comicProject?.images?.find(img => String(img.panelId) === "1")?.prompt;

    const firstCard = document.querySelectorAll(".result-item")[0];
    [...firstCard.querySelectorAll(".card-action")].find(b => b.querySelector(".ui-icon-retry"))?.click();
    start = Date.now();
    while (Date.now() - start < 4000) {
      const h = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
      const proj = h.find(item => item.type === "comic-project");
      if (proj && proj.images?.length === 2 && window.__calls.length >= 3) break;
      await new Promise(r => setTimeout(r, 80));
    }
    const historyAfterComicRetry = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
    const comicProjectAfterRetry = historyAfterComicRetry.find(item => item.type === "comic-project");

    return {
      historyCountAfterFirstGen: historyAfterFirstGen.length,
      firstRecordId,
      historyCountAfterSingleRetry: historyAfterSingleRetry.length,
      secondRecordId: historyAfterSingleRetry[0]?.id,
      historyProjectCountAfterComicGen: historyAfterComicGen.filter(i => i.type === "comic-project").length,
      comicImageCountAfterGen: comicProject?.images?.length,
      historyProjectCountAfterComicRetry: historyAfterComicRetry.filter(i => i.type === "comic-project").length,
      comicImageCountAfterRetry: comicProjectAfterRetry?.images?.length,
      comicProjectIdUnchanged: comicProject?.id === comicProjectAfterRetry?.id,
      totalApiCalls: window.__calls.length,
    };
  })()`, true);
  assertQa(result.historyCountAfterFirstGen === 1, "A fresh single-image generation should create exactly one history entry.", result);
  assertQa(result.historyCountAfterSingleRetry === 1, "Retrying a single-image result should not add a second history entry.", result);
  assertQa(result.secondRecordId && result.secondRecordId !== result.firstRecordId, "Retrying should replace the history entry with a fresh one (new id), not silently keep the stale one.", result);
  assertQa(result.historyProjectCountAfterComicGen === 1 && result.comicImageCountAfterGen === 2, "A fresh 2-panel comic generation should save one project with 2 images.", result);
  assertQa(result.historyProjectCountAfterComicRetry === 1 && result.comicImageCountAfterRetry === 2, "Retrying one comic panel should not duplicate the project or add a 3rd image — the old panel image must be replaced in place.", result);
  assertQa(result.comicProjectIdUnchanged, "Retrying a comic panel should update the same project record, not create a new one.", result);
}

async function testSequentialToggleSharedAcrossModes(cdp) {
  logStep("Concurrent/sequential generation toggle must be visible and usable in both single-image and comic mode");
  await loadFresh(cdp, "sequential-toggle");
  const result = await cdp.eval(`(async () => {
    const isHidden = id => document.getElementById(id).classList.contains("hidden");
    document.querySelector('[data-mode="single"]').click();
    await new Promise(r => setTimeout(r, 50));
    const singleHidden = isHidden("sequentialToggle");
    const nestedInNImagesField = document.getElementById("nImagesField").contains(document.getElementById("sequentialToggle"));

    document.querySelector('[data-mode="comic"]').click();
    await new Promise(r => setTimeout(r, 50));
    const comicHidden = isHidden("sequentialToggle");

    const checkbox = document.getElementById("sequentialMode");
    checkbox.checked = false;
    checkbox.click();
    const checkedAfterClick = checkbox.checked;

    const comicTab = document.querySelector('[data-mode="comic"]');
    comicTab.focus();
    comicTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    const keyboardMode = document.querySelector(".mode-tab.active")?.dataset.mode;
    const selectedStates = [...document.querySelectorAll(".mode-tab")].map(tab => ({
      mode: tab.dataset.mode,
      selected: tab.getAttribute("aria-selected"),
      tabIndex: tab.tabIndex,
    }));

    return { singleHidden, comicHidden, nestedInNImagesField, checkedAfterClick, keyboardMode, selectedStates };
  })()`, true);
  assertQa(result.singleHidden === false, "Sequential/concurrent toggle should be visible in single-image mode.", result);
  assertQa(result.comicHidden === false, "Sequential/concurrent toggle should also be visible in comic mode (it used to be trapped inside the single-image-only field, so comic batches had no visible way to control it).", result);
  assertQa(result.nestedInNImagesField === false, "The toggle should live in the shared config area, not nested inside the single-image-only image-count field.", result);
  assertQa(result.checkedAfterClick === true, "Clicking the toggle should still work after being relocated.", result);
  assertQa(result.keyboardMode === "turnaround" && result.selectedStates.filter(tab => tab.selected === "true" && tab.tabIndex === 0).length === 1, "Mode tabs must expose one selected tab and support arrow-key switching as a Windows input fallback.", result);
}

async function testColdStartupProfilesAndCoreControls(cdp) {
  logStep("Cold startup restores every API provider before core controls are exercised");
  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const match = location.search.match(/[?&]cold-start-(official|grsai|opencodex|custom|corrupt)=/);
      if (!match) return;
      localStorage.clear();
      const provider = match[1];
      if (provider === "corrupt") {
        localStorage.setItem("ai_image_gen_config", "{broken-json");
        localStorage.setItem("ai_image_gen_history_v1", "{broken-history");
        localStorage.setItem("ai_image_gen_settings", "{broken-settings");
        localStorage.setItem("ai_image_gen_apis", JSON.stringify([{
          id: "preserved-profile", name: "Preserved profile", apiProvider: "custom",
          endpoint: "https://example.invalid/v1/images/generations", model: "custom-image-model"
        }]));
        return;
      }
      const presets = {
        official: { endpoint: "https://api.openai.com/v1/images/generations", model: "gpt-image-2" },
        grsai: { endpoint: "https://grsai.dakka.com.cn/v1/api/generate", model: "gpt-image-2" },
        opencodex: { endpoint: "http://127.0.0.1:10100/v1/images/generations", model: "gpt-image-2" },
        custom: { endpoint: "https://example.invalid/v1/images/generations", model: "custom-image-model" },
      };
      const config = {
        id: "cold-start-" + provider,
        name: "Cold start " + provider,
        apiProvider: provider,
        endpoint: presets[provider].endpoint,
        apiKey: provider === "opencodex" ? "opencodex-local-only" : "sk-test-only",
        model: presets[provider].model,
      };
      localStorage.setItem("ai_image_gen_config", JSON.stringify(config));
      localStorage.setItem("ai_image_gen_apis", JSON.stringify([config]));
      localStorage.setItem("ai_image_gen_default_api_id", config.id);
    })();`,
  });

  try {
    for (const provider of ["official", "grsai", "opencodex", "custom", "corrupt"]) {
      await loadFresh(cdp, `cold-start-${provider}`);
      const result = await cdp.eval(`(async () => {
        const click = id => document.getElementById(id)?.click();
        click("settingsBtn");
        const settingsOpened = !document.getElementById("settingsModal").classList.contains("hidden");
        click("closeSettings");

        document.querySelector('.mode-tab[data-mode="comic"]')?.click();
        const comicOpened = document.querySelector('.mode-tab[data-mode="comic"]')?.classList.contains("active")
          && !document.getElementById("comicPanelSection").classList.contains("hidden");

        click("languageMenuButton");
        const languageOpened = !document.getElementById("languageMenu").classList.contains("hidden");
        document.querySelector('.language-option[data-lang="en"]')?.click();
        const languageChanged = document.getElementById("languageSelect").value === "en";

        const themeBefore = document.documentElement.getAttribute("data-theme");
        click("themeToggle");
        const themeChanged = document.documentElement.getAttribute("data-theme") !== themeBefore;

        click("historyBtn");
        const historyOpened = !document.getElementById("historyModal").classList.contains("hidden");
        click("closeHistory");
        click("exportBtn");
        await new Promise(resolve => setTimeout(resolve, 30));
        const exportResponded = document.getElementById("status").textContent.trim().length > 0;
        showStorageRecoveryIssues();

        return {
          ready: window.__AI_GEN_APP_READY === true,
          provider: document.getElementById("apiProvider").value,
          settingsOpened, comicOpened, languageOpened, languageChanged,
          themeChanged, historyOpened, exportResponded,
          savedApisRaw: localStorage.getItem("ai_image_gen_apis"),
          activeConfigRaw: localStorage.getItem("ai_image_gen_config"),
          historyRaw: localStorage.getItem("ai_image_gen_history_v1"),
          settingsRaw: localStorage.getItem("ai_image_gen_settings"),
          recoveryKeys: Object.keys(localStorage).filter(key => key.startsWith("ai_image_gen_recovery:")),
          recoveryState: window.__AI_GEN_STORAGE_RECOVERY || null,
          startupErrors: window.__AI_GEN_STARTUP_ERRORS || [],
        };
      })()`, true);
      assertQa(
        result.ready && result.settingsOpened && result.comicOpened && result.languageOpened
          && result.languageChanged && result.themeChanged && result.historyOpened && result.exportResponded,
        `Cold startup controls failed for ${provider}.`,
        result,
      );
      if (provider === "official") {
        assertQa(result.provider === "official", "The official API profile must restore during cold startup.", result);
      }
      if (provider === "corrupt") {
        assertQa(
          result.savedApisRaw?.includes("preserved-profile")
            && result.activeConfigRaw === "{broken-json"
            && result.historyRaw === "{broken-history"
            && result.settingsRaw === "{broken-settings"
            && result.recoveryKeys.length >= 3
            && result.recoveryState?.readOnlyKeys?.length >= 3,
          "Corrupt API, history and settings JSON must be backed up, preserved at the source key, and held read-only instead of silently becoming empty data.",
          result,
        );
      }
    }
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
    await cdp.eval(`localStorage.clear()`);
    await loadFresh(cdp, "cold-start-clean");
  }
}

async function testSaveComicFolder(cdp) {
  logStep("Project folder exports use the entered name, otherwise distinguish comic/turnaround projects, and always append a collision-safe local timestamp");
  await loadFresh(cdp, "save-folder");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const calls = [];
    window.FlutterDownload = {
      postMessage(raw) {
        const payload = JSON.parse(raw);
        calls.push(payload);
        let body;
        if (payload.action === "nativeFetch") {
          body = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ data: [{ b64_json: png }] }) };
        } else if (payload.action === "chooseDir") {
          body = "content://tree/mock-images";
        } else if (payload.action === "saveFile") {
          if (window.__failSaveFileName && payload.fileName === window.__failSaveFileName) {
            setTimeout(() => window.AiGenAndroidBridge.reject(payload.id, "simulated disk write failure"), 0);
            return;
          }
          body = "content://tree/mock-images/" + (payload.folder || "") + "/" + payload.fileName;
        } else {
          body = { ok: true };
        }
        setTimeout(() => window.AiGenAndroidBridge.resolve(payload.id, body), 0);
      }
    };
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "custom");
    set("apiEndpoint", "http://mock.local");
    set("apiKey", "sk-test");
    set("model", "gpt-image-2");

    const singleHidden = document.getElementById("saveComicFolder").classList.contains("hidden");

    document.querySelector('[data-mode="comic"]').click();
    await new Promise(r => setTimeout(r, 50));
    const comicHidden = document.getElementById("saveComicFolder").classList.contains("hidden");
    const projectNamePlaceholder = document.getElementById("zipFileName").placeholder;

    set("prompt", "GLOBAL");
    referenceImages = [{ fileName: "folder-export-reference.png", dataUrl: "data:image/png;base64," + png, width: 1, height: 1 }];
    renderThumbGrid();
    set("panelCount", "2");
    document.getElementById("createPanels").click();
    await new Promise(r => setTimeout(r, 80));
    [...document.querySelectorAll("#panelTbody tr")].forEach((row, index) => {
      const input = row.querySelector("textarea");
      input.value = "comic panel " + (index + 1);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    document.getElementById("generateBtn").click();
    let start = Date.now();
    while (Date.now() - start < 5000) {
      if (document.querySelectorAll(".result-item img").length === 2) break;
      await new Promise(r => setTimeout(r, 80));
    }

    const saveFolderOnce = async () => {
      const before = calls.filter(c => c.action === "saveFile").length;
      document.getElementById("saveComicFolder").click();
      const started = Date.now();
      while (Date.now() - started < 4000) {
        const saved = calls.filter(c => c.action === "saveFile");
        if (saved.length >= before + 2 && !document.getElementById("saveComicFolder").disabled) {
          return saved.slice(before);
        }
        await new Promise(r => setTimeout(r, 40));
      }
      return calls.filter(c => c.action === "saveFile").slice(before);
    };

    set("zipFileName", "海边:故事");
    const namedComicCalls = await saveFolderOnce();

    set("zipFileName", "");
    const unnamedComicCalls = await saveFolderOnce();

    document.querySelector('[data-mode="turnaround"]').click();
    await new Promise(r => setTimeout(r, 50));
    const turnaroundNamePlaceholder = document.getElementById("zipFileName").placeholder;
    const unnamedTurnaroundCalls = await saveFolderOnce();

    window.__failSaveFileName = "turnaround-2.png";
    const failedWriteCalls = await saveFolderOnce();
    window.__failSaveFileName = "";
    const failureStatus = document.getElementById("status").textContent;

    const saveCalls = [...namedComicCalls, ...unnamedComicCalls, ...unnamedTurnaroundCalls];
    const rootFolders = calls => [...new Set(calls.map(c => c.folder).filter(folder => !String(folder).endsWith("/" + PROJECT_EXPORT_REFERENCE_DIR)))];
    return {
      singleHidden,
      comicHidden,
      saveCallCount: saveCalls.length,
      namedComicFolders: rootFolders(namedComicCalls),
      unnamedComicFolders: rootFolders(unnamedComicCalls),
      unnamedTurnaroundFolders: rootFolders(unnamedTurnaroundCalls),
      fileNames: [...new Set(saveCalls.map(c => c.fileName))],
      kinds: [...new Set(saveCalls.map(c => c.kind))],
      allHaveBase64: saveCalls.every(c => typeof c.base64 === "string" && c.base64.length > 0),
      referenceFolders: [...new Set(saveCalls.filter(c => String(c.fileName).includes("reference")).map(c => c.folder))],
      referenceDirectory: PROJECT_EXPORT_REFERENCE_DIR,
      projectNamePlaceholder,
      turnaroundNamePlaceholder,
      failedWriteFileNames: failedWriteCalls.map(c => c.fileName),
      failureStatus,
    };
  })()`, true);

  assertQa(result.singleHidden === true, "Save-to-folder button should stay hidden in single-image mode.", result);
  assertQa(result.comicHidden === false, "Save-to-folder button should become visible when switching to comic mode.", result);
  assertQa(result.saveCallCount === 15 && result.fileNames.includes("project.json") && result.fileNames.includes("contact-sheet.html"), "Each 2-image project export should save both images, its reference image, and the resumable manifest/contact sheet.", result);
  assertQa(result.referenceFolders.every(folder => String(folder).includes("/" + result.referenceDirectory)), "Folder export must place each reference image in the named reference subfolder.", result);
  assertQa(result.namedComicFolders.length === 1 && /^海边-故事_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(result.namedComicFolders[0]), "An entered project name must become the folder name, with invalid filename characters sanitized and a timestamp appended.", result);
  assertQa(result.unnamedComicFolders.length === 1 && /^漫画项目_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(result.unnamedComicFolders[0]), "An unnamed comic export must use the localized comic-project prefix plus timestamp.", result);
  assertQa(result.unnamedTurnaroundFolders.length === 1 && /^三视图项目_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(result.unnamedTurnaroundFolders[0]), "An unnamed turnaround export must use a different localized turnaround-project prefix plus timestamp.", result);
  assertQa(new Set([result.namedComicFolders[0], result.unnamedComicFolders[0], result.unnamedTurnaroundFolders[0]]).size === 3, "Named, unnamed comic, and unnamed turnaround exports must never collapse into the same folder name.", result);
  assertQa(/项目.*文件夹/.test(result.projectNamePlaceholder) && /项目.*文件夹/.test(result.turnaroundNamePlaceholder), "Comic and turnaround modes should explain that the name field controls both the project and folder name.", result);
  assertQa(result.kinds.length === 1 && result.kinds[0] === "images", "Folder save should use the 'images' download-directory kind, matching the existing image-dir picker.", result);
  assertQa(result.allHaveBase64, "Every saveFile call should carry the actual image bytes as base64.", result);
  assertQa(result.fileNames.length === 7 && result.fileNames.includes("panel-1.png") && result.fileNames.includes("turnaround-1.png") && result.fileNames.some(name => String(name).includes("reference")), "Comic panels, turnaround images, references, manifests, and contact sheets should retain distinct filenames inside their project folder.", result);
  assertQa(
    result.failedWriteFileNames.includes("turnaround-1.png")
      && result.failedWriteFileNames.includes("turnaround-2.png")
      && !result.failedWriteFileNames.includes("project.json")
      && !result.failedWriteFileNames.includes("contact-sheet.html")
      && /导出失败|Export failed/.test(result.failureStatus),
    "A failed image write must stop the folder export and must never create manifests or report a partial folder as successful.",
    result,
  );
}

async function testStrictExportCompleteness(cdp) {
  logStep("ZIP and folder source collection retry transient reads and reject incomplete image sets");
  await loadFresh(cdp, "strict-export-completeness");
  const result = await cdp.eval(`(async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const pngBlob = new Blob([base64ToBytes(png)], { type: "image/png" });
    const originalLoader = imageUrlToBlobWithFallback;
    let transientAttempts = 0;
    let persistentAttempts = 0;
    let zipSize = 0;
    let persistentError = "";
    try {
      imageUrlToBlobWithFallback = async url => {
        if (url === "https://qa.invalid/transient.png") {
          transientAttempts++;
          if (transientAttempts < 3) throw new Error("temporary read failure");
        }
        return pngBlob;
      };
      const zip = await buildImagesZip([
        { panelId: "1", url: "https://qa.invalid/transient.png", prompt: "one" },
        { panelId: "2", url: "data:image/png;base64," + png, blob: pngBlob, prompt: "two" },
      ], { folder: "qa-export" });
      zipSize = zip.size;

      imageUrlToBlobWithFallback = async () => {
        persistentAttempts++;
        throw new Error("persistent read failure");
      };
      try {
        await buildImagesZip([
          { panelId: "1", url: "https://qa.invalid/persistent.png", prompt: "one" },
          { panelId: "2", url: "data:image/png;base64," + png, blob: pngBlob, prompt: "two" },
        ], { folder: "qa-export" });
      } catch (error) {
        persistentError = String(error?.message || error);
      }
    } finally {
      imageUrlToBlobWithFallback = originalLoader;
    }
    return { transientAttempts, persistentAttempts, zipSize, persistentError };
  })()`, true);

  assertQa(result.transientAttempts === 3 && result.zipSize > 0, "A transient image read should be retried and the complete ZIP should still be produced.", result);
  assertQa(result.persistentAttempts === 3 && /导出已中止/.test(result.persistentError) && /1\/2/.test(result.persistentError), "A persistent image read failure must abort the ZIP instead of producing an incomplete archive.", result);
}

async function testRetryClearReloadAndI18n(cdp) {
  logStep("Structured retry policy, clear while generating, reload failed image, and i18n layout");
  await loadFresh(cdp, "misc");
  const retry = await cdp.eval(`(async () => {
    let attempts400 = 0;
    const retryRounds = [];
    let threw400 = false;
    try {
      await retryTransient(async () => {
        attempts400++;
        throw new Error("HTTP 400: invalid_parameters");
      }, { maxRetries: 3, baseDelay: 1 });
    } catch { threw400 = true; }
    const terminalProbe = async message => {
      let attempts = 0;
      let threw = false;
      try {
        await retryTransient(async () => {
          attempts++;
          throw new Error(message);
        }, { maxRetries: 3, baseDelay: 1 });
      } catch { threw = true; }
      return { attempts, threw };
    };
    const transientProbe = async message => {
      let attempts = 0;
      const value = await retryTransient(async () => {
        attempts++;
        if (attempts < 3) throw new Error(message);
        return "ok";
      }, {
        maxRetries: 3,
        baseDelay: 1,
        onRetry: info => retryRounds.push({ status: message.match(/HTTP (\\d+)/)?.[1] || "connection", retryIndex: info.retryIndex })
      });
      return { attempts, value };
    };
    const probe504 = await terminalProbe("HTTP 504: Gateway Time-out");
    const probe502 = await transientProbe("HTTP 502: Bad Gateway");
    const probe503 = await transientProbe("HTTP 503: Service Unavailable");
    const probe429 = await transientProbe("HTTP 429: Too Many Requests");
    const probeConnClosed = await transientProbe("HttpException: Connection closed before full header was received");
    let attemptsSuccessImmediately = 0;
    const okImmediate = await retryTransient(async () => {
      attemptsSuccessImmediately++;
      return "image";
    }, {
      maxRetries: 3,
      baseDelay: 1,
      onRetry: info => retryRounds.push({ unexpected: true, retryIndex: info.retryIndex })
    });
    let attempts500 = 0;
    let threw500 = false;
    try {
      await retryTransient(async () => {
        attempts500++;
        throw new Error("HTTP 500: no retry");
      }, { maxRetries: 3, baseDelay: 1 });
    } catch {
      threw500 = true;
    }
    const originalFetch = window.fetch.bind(window);
    let callAttempts = 0;
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "custom");
    set("apiEndpoint", "http://mock.local");
    set("apiKey", "sk-test");
    set("model", "gpt-image-2");
    window.fetch = async (url, opts = {}) => {
      if (String(url).includes("/v1/images/generations")) {
        callAttempts++;
        if (callAttempts < 3) {
          return new Response(JSON.stringify({ error: "busy" }), {
            status: 502,
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return originalFetch(url, opts);
    };
    const data = await callImageAPI("retry status prompt", "1024x1024", 1, "图片 1", { maxRetries: 3 });
    window.fetch = originalFetch;
    return {
      attempts400,
      threw400,
      attempts504: probe504.attempts,
      threw504: probe504.threw,
      attempts502: probe502.attempts,
      ok502: probe502.value,
      attempts503: probe503.attempts,
      ok503: probe503.value,
      attempts429: probe429.attempts,
      ok429: probe429.value,
      attemptsConnClosed: probeConnClosed.attempts,
      okConnClosed: probeConnClosed.value,
      retryRounds,
      attemptsSuccessImmediately,
      okImmediate,
      attempts500,
      threw500,
      callAttempts,
      callImageReturned: !!data?.data?.[0]?.b64_json,
      statusText: document.getElementById("status")?.textContent || "",
    };
  })()`, true);
  assertQa(retry.attempts400 === 1 && retry.threw400, "Parameter-class HTTP 400 errors must not be submitted again unchanged.", retry);
  assertQa(retry.attempts504 === 1 && retry.threw504, "HTTP 504 with an unknown submission outcome must not duplicate the POST.", retry);
  assertQa(retry.attempts502 === 3 && retry.ok502 === "ok", "HTTP 502 should use a bounded backoff and stop on success.", retry);
  assertQa(retry.attempts503 === 3 && retry.ok503 === "ok", "HTTP 503 should use a bounded backoff and stop on success.", retry);
  assertQa(retry.attempts429 === 3 && retry.ok429 === "ok", "HTTP 429 should use a bounded backoff and stop on success.", retry);
  assertQa(retry.attemptsConnClosed === 3 && retry.okConnClosed === "ok", "Transient upstream disconnects should use a bounded retry.", retry);
  assertQa(retry.retryRounds.length === 8 && retry.retryRounds.every(item => item.retryIndex === 1 || item.retryIndex === 2), "Retry status should report two rounds for every transient family.", retry);
  assertQa(retry.attemptsSuccessImmediately === 1 && retry.okImmediate === "image", "Successful image responses should stop retry immediately.", retry);
  assertQa(retry.attempts500 === 1 && retry.threw500, "Unclassified HTTP 500 must not be retried blindly.", retry);
  assertQa(retry.callAttempts === 3 && retry.callImageReturned, "Image API should stop retrying as soon as a successful image payload returns.", retry);
  assertQa(/1\/3|2\/3/.test(retry.statusText), "Retry status should show the current retry round and total retry rounds.", retry);

  const editRequiredRetry = await cdp.eval(`(async () => {
    const originalCallImageAPI = callImageAPI;
    const calls = [];
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    callImageAPI = async prompt => {
      calls.push(prompt);
      return { data: [{ b64_json: png }] };
    };
    const policyError = Object.assign(new Error("HTTP 400: We are so sorry, but the prompt may violate our content policies. If you think we got it wrong, please retry or edit your prompt."), { status: 400 });

    async function exercise({ id, mode, prompt, panelPrompt = "", globalPrompt = "", edited }) {
      switchMode(mode);
      const card = addResultPlaceholder(id, prompt, {
        mode,
        prompt,
        panelPrompt,
        globalPrompt,
        size: "1024x1024",
        apiSnapshot: captureApiRequestSnapshot(),
      });
      markPlaceholderFailed(card, id, policyError, card._retryContext);
      const retryButton = card.querySelector(".retry-now");
      const before = {
        category: card.dataset.errorCategory,
        enabled: !retryButton.disabled,
        includedInBulk: getRetryEligibleFailedCards().includes(card),
      };
      retryButton.click();
      await new Promise(resolve => setTimeout(resolve, 30));
      const dialog = document.querySelector(".ask-dialog-overlay");
      const dialogOpened = !!dialog;
      const input = dialog?.querySelector(".ask-dialog-input");
      if (input) input.value = edited;
      dialog?.querySelector(".ask-dialog-ok")?.click();
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && card.dataset.status !== "success") {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return { ...before, dialogOpened, finalStatus: card.dataset.status };
    }

    try {
      const single = await exercise({
        id: "policy-single",
        mode: "single",
        prompt: "original single prompt",
        edited: "edited single prompt",
      });
      const comic = await exercise({
        id: "policy-comic",
        mode: "comic",
        prompt: "GLOBAL POLICY TEXT\\n\\noriginal panel prompt",
        panelPrompt: "original panel prompt",
        globalPrompt: "GLOBAL POLICY TEXT",
        edited: "edited comic panel prompt",
      });
      return { single, comic, calls };
    } finally {
      callImageAPI = originalCallImageAPI;
      switchMode("single");
    }
  })()`, true);
  assertQa(editRequiredRetry.single.category === "moderation_blocked" && editRequiredRetry.comic.category === "moderation_blocked",
    "The provider's 'content policies' HTTP 400 wording must be classified as moderation, not invalid parameters.", editRequiredRetry);
  assertQa(editRequiredRetry.single.enabled && editRequiredRetry.comic.enabled && editRequiredRetry.single.dialogOpened && editRequiredRetry.comic.dialogOpened,
    "An edit-required failure's visible retry button must stay enabled and open the edit dialog in both single and comic modes.", editRequiredRetry);
  assertQa(editRequiredRetry.single.includedInBulk && editRequiredRetry.comic.includedInBulk,
    "Edit-required cards must remain available to an explicit retry-all command while their single-card retry still opens the edit dialog.", editRequiredRetry);
  assertQa(editRequiredRetry.single.finalStatus === "success" && editRequiredRetry.comic.finalStatus === "success",
    "Confirming the edited prompt must actually submit and replace both failed cards.", editRequiredRetry);
  assertQa(JSON.stringify(editRequiredRetry.calls) === JSON.stringify(["edited single prompt", "edited comic panel prompt"]),
    "Manual moderation retry must send the edited prompt; comic retry must omit the old global text that caused the policy failure.", editRequiredRetry);

  const clear = await cdp.eval(`(async () => {
    localStorage.clear();
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, opts = {}) => {
      if (String(url).includes("/v1/images/generations")) {
        return new Promise((resolve, reject) => {
          opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      return originalFetch(url, opts);
    };
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "custom");
    set("apiEndpoint", "http://mock.local");
    set("apiKey", "sk-test");
    set("prompt", "slow image");
    document.getElementById("generateBtn").click();
    await new Promise(r => setTimeout(r, 120));
    const during = {
      disabled: document.getElementById("generateBtn").disabled,
      isCancelState: document.getElementById("generateBtn").classList.contains("is-cancel"),
      toolbarHidden: document.getElementById("resultToolbar").classList.contains("hidden"),
    };

    // Clicking the button itself while it reads "取消生成" should cancel generation directly --
    // this is the whole point of turning it into a cancel button instead of just disabling it.
    document.getElementById("generateBtn").click();
    await new Promise(r => setTimeout(r, 120));
    const afterSelfCancel = {
      disabled: document.getElementById("generateBtn").disabled,
      isCancelState: document.getElementById("generateBtn").classList.contains("is-cancel"),
    };

    // Start again and verify the separate "clear results" path still also cancels generation.
    document.getElementById("generateBtn").click();
    await new Promise(r => setTimeout(r, 120));
    document.getElementById("clearResults").click();
    await new Promise(r => setTimeout(r, 120));
    return {
      during,
      afterSelfCancel,
      after: {
        disabled: document.getElementById("generateBtn").disabled,
        gridHidden: document.getElementById("resultGrid").classList.contains("hidden"),
        toolbarHidden: document.getElementById("resultToolbar").classList.contains("hidden"),
        progressHidden: document.getElementById("progressWrap").classList.contains("hidden"),
      },
    };
  })()`, true);
  assertQa(!clear.during.disabled && clear.during.isCancelState, "The generate button must stay enabled during generation and switch into a 'cancel generation' state -- it should not just disable itself with no way to interrupt.", clear);
  assertQa(!clear.afterSelfCancel.disabled && !clear.afterSelfCancel.isCancelState, "Clicking the generate button while it reads 'cancel generation' must cancel the in-progress generation and restore the button to its normal state.", clear);
  assertQa(!clear.after.disabled && clear.after.gridHidden && clear.after.toolbarHidden && clear.after.progressHidden, "Clear results should abort generation and reset UI.", clear);

  const reload = await cdp.eval(`(async () => {
    document.getElementById("resultGrid").classList.remove("hidden");
    document.getElementById("emptyState").classList.add("hidden");
    document.getElementById("resultToolbar").classList.remove("hidden");
    const originalFetch = window.fetch.bind(window);
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    let fetchCalls = 0;
    let directByteFetches = 0;
    const proxyTargets = [];
    document.getElementById("proxyEndpoint").value = "http://127.0.0.1:8787/proxy?token=qa";
    window.fetch = async (url, opts = {}) => {
      if (String(url).includes("127.0.0.1:8787/proxy")) {
        fetchCalls++;
        const payload = JSON.parse(opts.body || "{}");
        proxyTargets.push(payload.url || "");
        if (fetchCalls === 1) throw new TypeError("initial preview cache failed");
        const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
        return new Response(bytes, { status: 200, headers: { "Content-Type": "image/png" } });
      }
      if (String(url).includes("mock-preview-image.png")) directByteFetches++;
      return originalFetch(url, opts);
    };
    const card = document.createElement("div");
    card.className = "result-item";
    document.getElementById("resultGrid").appendChild(card);
    replacePlaceholder(card, 1, { data: [{ url: "https://example.test/mock-preview-image.png" }] }, "panel only", {
      skipHistory: true,
      retryContext: { mode: "comic", globalPrompt: "global", panelPrompt: "panel only", prompt: "global\\n\\npanel only" },
    });
    const img = card.querySelector("img");
    const button = card.querySelector(".result-media-reload");
    await new Promise(r => setTimeout(r, 80));
    img.dispatchEvent(new Event("error"));
    const before = img.src;
    button.click();
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (img.src.startsWith("blob:") && card._zipBlob?.size > 0) break;
      await new Promise(r => setTimeout(r, 60));
    }
    const media = card.querySelector(".result-media");
    const result = {
      before,
      after: img.src,
      fetchCalls,
      directByteFetches,
      proxyTargets,
      blobPreview: img.src.startsWith("blob:"),
      zipBlobSize: card._zipBlob?.size || 0,
      errorState: media.classList.contains("is-error"),
      loadingState: media.classList.contains("is-loading"),
    };
    window.fetch = originalFetch;
    document.getElementById("proxyEndpoint").value = "";
    return result;
  })()`, true);
  assertQa(reload.before !== reload.after && reload.blobPreview && reload.zipBlobSize > 0, "Failed image reload should fetch image bytes and switch preview to a local blob URL.", reload);
  assertQa(reload.fetchCalls >= 2 && !reload.errorState, "Reload should recover from direct preview failure using the same byte-fetch path as download.", reload);
  assertQa(reload.directByteFetches === 0 && reload.proxyTargets.length >= 2 && reload.proxyTargets.every(url => url.includes("mock-preview-image.png")), "Browser image-byte reload must use the configured CORS proxy instead of retrying a blocked direct fetch.", reload);

  const nativePreviewChunks = await cdp.eval(`(async () => {
    const previousBridge = window.FlutterDownload;
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const source = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    const calls = [];
    let abortChunk = false;
    window.FlutterDownload = {
      postMessage(raw) {
        const payload = JSON.parse(raw);
        calls.push(payload);
        queueMicrotask(() => {
          if (payload.action === "nativeFetch") {
            window.AiGenAndroidBridge.resolve(payload.id, {
              status: 200,
              headers: { "content-type": "image/png" },
              transferId: "qa-image-transfer",
              byteLength: source.length,
              chunkSize: 7,
            });
            return;
          }
          if (payload.action === "nativeFetchBlobChunk") {
            if (abortChunk) return;
            const end = Math.min(source.length, payload.offset + payload.length);
            let binary = "";
            for (const byte of source.slice(payload.offset, end)) binary += String.fromCharCode(byte);
            window.AiGenAndroidBridge.resolve(payload.id, {
              base64: btoa(binary),
              nextOffset: end,
              done: end >= source.length,
            });
            return;
          }
          if (payload.action === "nativeFetchBlobRelease") {
            window.AiGenAndroidBridge.resolve(payload.id, true);
          }
        });
      }
    };
    try {
      const result = await nativeDownload.nativeFetchBlob("https://img.test/large-preview.png");
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      await new Promise(resolve => setTimeout(resolve, 0));
      abortChunk = true;
      const controller = new AbortController();
      const abortedRead = nativeDownload.nativeFetchBlob(
        "https://img.test/abort-preview.png",
        {},
        { signal: controller.signal, timeoutMs: 5000 },
      ).then(() => false, error => error?.name === "AbortError");
      setTimeout(() => controller.abort(), 20);
      const chunkAbortObserved = await abortedRead;
      await new Promise(resolve => setTimeout(resolve, 0));
      return {
        byteLength: bytes.length,
        matches: bytes.length === source.length && bytes.every((value, index) => value === source[index]),
        type: result.blob.type,
        actions: calls.map(call => call.action),
        responseType: calls.find(call => call.action === "nativeFetch")?.responseType || "",
        maxRequestedChunk: Math.max(0, ...calls.filter(call => call.action === "nativeFetchBlobChunk").map(call => call.length || 0)),
        chunkAbortObserved,
        abortReleased: calls.filter(call => call.action === "nativeFetchBlobRelease").length >= 2,
      };
    } finally {
      if (previousBridge === undefined) delete window.FlutterDownload;
      else window.FlutterDownload = previousBridge;
    }
  })()`, true);
  assertQa(nativePreviewChunks.matches && nativePreviewChunks.type === "image/png", "Native preview reload should reconstruct the exact image bytes from bounded bridge chunks.", nativePreviewChunks);
  assertQa(nativePreviewChunks.responseType === "chunkedBase64" && nativePreviewChunks.actions.filter(action => action === "nativeFetchBlobChunk").length > 1, "Native preview reload must request multiple bounded chunks instead of one oversized Base64 bridge message.", nativePreviewChunks);
  assertQa(nativePreviewChunks.actions.at(-1) === "nativeFetchBlobRelease" && nativePreviewChunks.maxRequestedChunk <= 192 * 1024, "Native preview chunks must be released and remain within the bridge-safe size.", nativePreviewChunks);
  assertQa(nativePreviewChunks.chunkAbortObserved && nativePreviewChunks.abortReleased, "AbortSignal must interrupt a pending native blob chunk and still release its transfer.", nativePreviewChunks);

  const resultGrid = await cdp.eval(`(async () => {
    localStorage.clear();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "custom");
    set("apiEndpoint", "http://mock.local");
    set("apiKey", "sk-test");
    set("model", "gpt-image-2");
    const grid = document.getElementById("resultGrid");
    grid.innerHTML = "";
    grid.classList.remove("hidden");
    document.getElementById("emptyState").classList.add("hidden");
    document.getElementById("resultToolbar").classList.remove("hidden");

    const cards = [];
    for (let i = 1; i <= 24; i++) {
      const panelPrompt = "panel prompt " + i;
      const fullPrompt = "GLOBAL\\n\\n" + panelPrompt;
      const card = addResultPlaceholder(i, fullPrompt, {
        mode: "comic",
        globalPrompt: "GLOBAL",
        panelPrompt,
        prompt: fullPrompt,
        size: "1024x1024",
        retryCount: 3,
      });
      cards.push(card);
      if (i <= 4) {
        markPlaceholderFailed(card, i, "HTTP 502: mocked failure reason for panel " + i, {
          mode: "comic",
          globalPrompt: "GLOBAL",
          panelPrompt,
          prompt: fullPrompt,
          size: "1024x1024",
          retryCount: 3,
        });
      } else {
        replacePlaceholder(card, i, { data: [{ b64_json: png }] }, fullPrompt, {
          skipHistory: true,
          recordPrompt: panelPrompt,
          fullPrompt,
          retryContext: {
            mode: "comic",
            globalPrompt: "GLOBAL",
            panelPrompt,
            prompt: fullPrompt,
            size: "1024x1024",
            retryCount: 3,
          },
        });
      }
    }
    await new Promise(r => setTimeout(r, 120));

    const visibleCards = [...grid.querySelectorAll(".result-item")];
    const rows = new Map();
    for (const card of visibleCards) {
      const top = Math.round(card.getBoundingClientRect().top);
      rows.set(top, (rows.get(top) || 0) + 1);
    }
    const mediaHeights = [...grid.querySelectorAll(".result-media")].map(el => Math.round(el.getBoundingClientRect().height));
    const before = {
      cardCount: visibleCards.length,
      maxPerRow: Math.max(...rows.values()),
      scrollable: grid.scrollHeight > grid.clientHeight + 24,
      metrics: {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        gridClientHeight: grid.clientHeight,
        gridScrollHeight: grid.scrollHeight,
        panelHeight: document.querySelector(".result-panel").getBoundingClientRect().height,
        mainHeight: document.querySelector(".main-layout").getBoundingClientRect().height,
        bodyScrollHeight: document.body.scrollHeight,
        bodyClientHeight: document.documentElement.clientHeight,
        resultGridDisplay: getComputedStyle(grid).display,
        resultPanelDisplay: getComputedStyle(document.querySelector(".result-panel")).display,
      },
      failToolsHidden: document.getElementById("retryFailedTools").classList.contains("hidden"),
      failedCount: document.querySelectorAll(".result-item.is-failed").length,
      firstReason: document.querySelector(".result-error-message")?.textContent || "",
      minMediaHeight: Math.min(...mediaHeights),
    };

    const originalFetch = window.fetch.bind(window);
    window.__batchRetryCalls = [];
    window.fetch = async (url, opts = {}) => {
      if (String(url).includes("/v1/images/generations")) {
        // Stagger responses so the retry-all progress bar has more than one instant to
        // report on — with every call resolving on the same microtask tick there would
        // be no way to observe an intermediate "done < total" state at all.
        await new Promise(r => setTimeout(r, 120 * (window.__batchRetryCalls.length + 1)));
        let body = {};
        try { body = JSON.parse(opts.body || "{}"); } catch {}
        window.__batchRetryCalls.push({ prompt: body.prompt, size: body.size });
        return new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(url, opts);
    };
    set("failedRetryCount", "2");
    document.getElementById("retryFailedAll").click();
    const progressWrap = document.getElementById("progressWrap");
    const progressText = document.getElementById("progressText");
    const progressSamples = [];
    const start = Date.now();
    while (Date.now() - start < 5000) {
      progressSamples.push({ hidden: progressWrap.classList.contains("hidden"), text: progressText.textContent });
      // Retries now run concurrently: all four cards clear .is-failed and fire their
      // API calls almost simultaneously, well before their DOM is re-rendered. Wait
      // for the replacement <img> nodes too, or we snapshot mid-flight.
      if (document.querySelectorAll(".result-item.is-failed").length === 0
        && window.__batchRetryCalls.length === 4
        && document.querySelectorAll(".result-item img").length === 24) break;
      await new Promise(r => setTimeout(r, 40));
    }
    const progressVisibleDuringRetry = progressSamples.some(s => !s.hidden);
    const progressReachedTotal = progressSamples.some(s => s.text.includes("4/4"));
    await new Promise(r => setTimeout(r, 4000)); // outlast the 300ms stable window plus 3s hide delay
    const progressHiddenAfterDelay = progressWrap.classList.contains("hidden");
    const after = {
      failedCount: document.querySelectorAll(".result-item.is-failed").length,
      imageCount: document.querySelectorAll(".result-item img").length,
      retryToolsHidden: document.getElementById("retryFailedTools").classList.contains("hidden"),
      retryCounts: cards.slice(0, 4).map(card => card._retryContext?.retryCount),
      calls: window.__batchRetryCalls,
      progressVisibleDuringRetry,
      progressReachedTotal,
      progressHiddenAfterDelay,
    };
    return { before, after };
  })()`, true);
  assertQa(resultGrid.before.cardCount === 24, "Result grid should render all batch cards.", resultGrid);
  assertQa(resultGrid.before.maxPerRow <= 3, "Result grid should show no more than three cards per row.", resultGrid);
  assertQa(resultGrid.before.scrollable, "Large result batches should scroll inside the result grid.", resultGrid);
  assertQa(!resultGrid.before.failToolsHidden && resultGrid.before.failedCount === 4, "Failed-result toolbar should appear when failures exist.", resultGrid);
  assertQa(resultGrid.before.firstReason.includes("mocked failure reason") && resultGrid.before.minMediaHeight >= 170, "Failed cards should show their reason inside a stable media area.", resultGrid);
  assertQa(resultGrid.after.failedCount === 0 && resultGrid.after.imageCount === 24 && resultGrid.after.retryToolsHidden, "Retry all failed should replace failed cards and hide the failed toolbar.", resultGrid);
  assertQa(resultGrid.after.calls.length === 4 && resultGrid.after.retryCounts.every(count => count === 0), "Retry-all should make one API submission per queue round instead of multiplying the toolbar's additional-round count inside each request.", resultGrid);
  assertQa(resultGrid.after.progressVisibleDuringRetry, "Retry-all-failed must show the progress bar while it runs — otherwise a long retry batch (native call timeouts are now up to 15 minutes) looks frozen with no feedback.", resultGrid);
  assertQa(resultGrid.after.progressReachedTotal, "Retry-all-failed's progress bar must reach done === total (\"4/4\") once every card has settled.", resultGrid);
  assertQa(resultGrid.after.progressHiddenAfterDelay, "The progress bar should hide itself again a few seconds after retry-all-failed finishes, not stay on screen forever.", resultGrid);

  const i18n = [];
  for (const viewport of [
    { name: "desktop", width: 1365, height: 768, mobile: false },
    { name: "mobile", width: 430, height: 760, mobile: true },
  ]) {
    await loadFresh(cdp, `i18n-${viewport.name}`, viewport);
    const item = await cdp.eval(`(async () => {
      const languages = ["zh-CN", "zh-Hant", "en", "ja", "ko"];
      const results = [];
      for (const lang of languages) {
        const select = document.getElementById("languageSelect");
        select.value = lang;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise(r => setTimeout(r, 80));
        const sizeDetails = document.querySelector(".size-presets-more");
        if (sizeDetails) sizeDetails.open = true;
        const sourceSizeLabels = [
          "更多常用尺寸", "官方 2K 方图", "官方 2K 横图", "官方 4K 横图", "官方 4K 竖图",
          "横屏 16:9", "竖屏 9:16", "2K 竖屏", "QHD 横屏", "QHD 竖屏",
          "横版 4:3", "竖版 3:4", "横版 5:4", "竖版 4:5", "桌面 16:10", "竖版 10:16",
        ];
        const renderedSizeLabels = [
          sizeDetails?.querySelector("summary")?.textContent?.trim() || "",
          ...[...document.querySelectorAll(".size-presets-more small")].map(node => node.textContent.trim()),
        ];
        const text = document.body.innerText;
        const nodes = [...document.querySelectorAll("button,.btn,.btn-sm,.btn-xs,.mode-tab,.language-select")]
          .filter(el => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          });
        const overflows = nodes.map(el => ({
          id: el.id,
          cls: String(el.className),
          text: (el.innerText || el.value || "").trim(),
          overflowX: el.scrollWidth - el.clientWidth,
          overflowY: el.scrollHeight - el.clientHeight,
        })).filter(row => row.overflowX > 3 || row.overflowY > 8);
        const langStyle = getComputedStyle(select);
        const exportButton = document.getElementById("exportBtn");
        const exportRect = exportButton.getBoundingClientRect();
        const exportStyle = getComputedStyle(exportButton);
        showStatus("全部 3 个分镜生成完成！", "success");
        const expectedRuntimeStatus = {
          "zh-CN": "全部 3 个分镜生成完成！",
          "zh-Hant": "全部 3 個分鏡生成完成！",
          en: "All 3 panels generated!",
          ja: "全 3 コマを生成しました！",
          ko: "컷 3개를 모두 생성했습니다!",
        }[lang];
        results.push({
          lang,
          header: document.querySelector(".header h1")?.innerText,
          badWords: ["undefined", "null", "NaN", "????"].filter(word => text.includes(word)),
          hasJaChinesePanel: lang === "ja" && text.includes("分镜"),
          untranslatedSizeLabels: ["en", "ja", "ko"].includes(lang)
            ? renderedSizeLabels.filter(label => sourceSizeLabels.includes(label))
            : [],
          overflows,
          languageCenter: langStyle.textAlign === "center" && langStyle.textAlignLast === "center",
          exportVisible: exportStyle.display !== "none" && exportStyle.visibility !== "hidden" && exportRect.width > 0 && exportRect.height > 0,
          statusOk: document.getElementById("status")?.textContent === expectedRuntimeStatus,
        });
      }
      const menuButton = document.getElementById("languageMenuButton");
      const menu = document.getElementById("languageMenu");
      const themeBefore = document.documentElement.getAttribute("data-theme");
      document.getElementById("themeToggle").click();
      await new Promise(r => setTimeout(r, 50));
      const themeAfter = document.documentElement.getAttribute("data-theme");
      menuButton.click();
      await new Promise(r => setTimeout(r, 80));
      const opened = !menu.classList.contains("hidden") && menuButton.getAttribute("aria-expanded") === "true";
      menu.querySelector('[data-lang="en"]').click();
      await new Promise(r => setTimeout(r, 80));
      const changed = document.documentElement.lang === "en" && document.getElementById("languageCurrent").textContent.includes("EN");
      return { results, menu: { opened, changed }, theme: { before: themeBefore, after: themeAfter } };
    })()`, true);
    i18n.push({ viewport: viewport.name, item: item.results, menu: item.menu, theme: item.theme });
  }
  const flat = i18n.flatMap(group => group.item.map(item => ({ viewport: group.viewport, ...item })));
  const bad = flat.filter(item => item.badWords.length || item.hasJaChinesePanel || item.untranslatedSizeLabels.length || item.overflows.length || !item.languageCenter || !item.exportVisible || !item.statusOk);
  assertQa(bad.length === 0, "All supported languages should render without bad tokens, Japanese Chinese residue, or control overflow.", bad);
  const menuBad = i18n.filter(group => !group.menu.opened || !group.menu.changed);
  assertQa(menuBad.length === 0, "Language menu button should open and apply a selected language.", menuBad);
  const themeBad = i18n.filter(group => group.theme.before === group.theme.after);
  assertQa(themeBad.length === 0, "Theme toggle should switch between dark and light themes.", themeBad);
}

async function testEveryFailureRemainsManuallyRetryable(cdp) {
  logStep("Every failure category remains available to single-card and retry-all manual actions");
  await loadFresh(cdp, "all-failures-manually-retryable");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    applyLanguage("zh-CN");
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    document.getElementById("apiProvider").value = "custom";
    set("apiEndpoint", "https://api.example.test/v1/images/generations");
    set("apiKey", "sk-test");
    set("model", "gpt-image-2");
    set("failedRetryCount", "0");
    const grid = document.getElementById("resultGrid");
    grid.innerHTML = "";
    grid.classList.remove("hidden");
    document.getElementById("resultToolbar").classList.remove("hidden");
    const failures = [
      "HTTP 504: 504 Gateway Time-out",
      "HTTP 401: [invalid_api_key] Incorrect API key provided",
      "HTTP 400: unsupported parameter quality",
      "HTTP 400: prompt may violate our content policies",
      "Gemini 网页界面能力不可用。missing temporary_chat_required",
      "HTTP 404: image task not found",
    ];
    const cards = failures.map((message, index) => {
      const id = index + 1;
      const prompt = "manual retry contract " + id;
      const card = addResultPlaceholder(id, prompt, {
        mode: "comic", panelPrompt: prompt, prompt, size: "1024x1536", retryCount: 0,
      });
      markPlaceholderFailed(card, id, message, card._retryContext);
      return card;
    });
    // Simulate a project restored from an older release that persisted a block.
    cards[0].dataset.retryBlocked = "true";
    updateFailedRetryTools();
    const button = document.getElementById("retryFailedAll");
    const before = {
      failed: getFailedResultCards().length,
      eligible: getRetryEligibleFailedCards().length,
      disabled: button.disabled,
      text: button.textContent.trim(),
      retryButtonsEnabled: cards.every(card => !card.querySelector(".retry-now").disabled),
      categories: cards.map(card => card.dataset.errorCategory),
    };

    const originalCallImageAPI = callImageAPI;
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==";
    let calls = 0;
    callImageAPI = async () => {
      calls++;
      return { data: [{ b64_json: png }] };
    };
    button.click();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && retryAllFailedRun) await new Promise(resolve => setTimeout(resolve, 20));
    const after = {
      calls,
      runFinished: !retryAllFailedRun,
      successCards: cards.filter(card => card.dataset.status === "success").length,
      remainingFailed: getFailedResultCards().length,
    };
    callImageAPI = originalCallImageAPI;
    return { before, after };
  })()`, true);
  assertQa(result.before.failed === 6 && result.before.eligible === 6 && !result.before.disabled && result.before.retryButtonsEnabled,
    "504, authentication, parameter, moderation, provider-UI and missing-task failures must all keep manual retry controls enabled.", result);
  assertQa(result.before.text.includes("(6)") && !result.before.text.includes("0/"),
    "Retry-all must report every failed card as eligible, including legacy cards previously marked retryBlocked.", result);
  assertQa(result.after.calls === 6 && result.after.runFinished && result.after.successCards === 6 && result.after.remainingFailed === 0,
    "One explicit retry-all click must submit every failed card exactly once and stop each card immediately after an image succeeds.", result);
}

async function testRetryAllFailedRepeatsEachCardUntilSuccessOrLimit(cdp) {
  logStep("Retry-all applies every configured round to moderation and unknown-outcome failures, requeues fairly, and stops immediately after success");
  await loadFresh(cdp, "retry-all-repeat-until-limit");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiEndpoint", "https://api.example.test/v1/images/generations");
    set("apiKey", "sk-test");
    set("model", "gpt-image-2");
    set("failedRetryCount", "2");
    document.getElementById("apiProvider").value = "custom";

    const grid = document.getElementById("resultGrid");
    grid.innerHTML = "";
    grid.classList.remove("hidden");
    document.getElementById("resultToolbar").classList.remove("hidden");
    ["moderation eventually succeeds", "504 always fails"].forEach((prompt, index) => {
      const panelId = index + 1;
      const card = addResultPlaceholder(panelId, prompt, {
        mode: "comic", panelPrompt: prompt, prompt, size: "1024x1024", retryCount: 0,
      });
      markPlaceholderFailed(card, panelId, index === 0
        ? "HTTP 400: prompt may violate our content policies"
        : "HTTP 504: 504 Gateway Time-out", {
        mode: "comic", panelPrompt: prompt, prompt, size: "1024x1024", retryCount: 0,
      });
    });

    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==";
    const originalCallImageAPI = callImageAPI;
    const calls = { success: 0, failure: 0 };
    const rounds = { success: [], failure: [] };
    callImageAPI = async prompt => {
      const successCard = String(prompt || "").includes("moderation eventually succeeds");
      const key = successCard ? "success" : "failure";
      const panelId = successCard ? "1" : "2";
      calls[key]++;
      rounds[key].push(document.querySelector(".result-item[data-panel-id='" + panelId + "']")?.dataset.retryAttempt || "");
      await sleep(20);
      if (successCard && calls.success === 3) {
        return { data: [{ b64_json: png }] };
      }
      throw new Error(successCard
        ? "HTTP 400: prompt may violate our content policies"
        : "HTTP 504: 504 Gateway Time-out");
    };

    document.getElementById("retryFailedAll").click();
    const start = Date.now();
    while (Date.now() - start < 15000 && retryAllFailedRun) await sleep(20);
    const final = {
      calls,
      rounds,
      images: document.querySelectorAll(".result-item img").length,
      failed: document.querySelectorAll(".result-item.is-failed").length,
      successAttempt: document.querySelector(".result-item[data-panel-id='1']")?.dataset.retryAttempt,
      failureAttempt: document.querySelector(".result-item[data-panel-id='2']")?.dataset.retryAttempt,
      failureMessage: document.querySelector(".result-item[data-panel-id='2']")?.dataset.errorMessage || "",
      status: document.getElementById("status").textContent,
    };
    callImageAPI = originalCallImageAPI;
    return final;
  })()`, true);

  assertQa(result.calls.success === 3 && result.calls.failure === 3, "Two additional attempts must mean three explicit submissions even for moderation and unknown-outcome 504 failures.", result);
  assertQa(result.rounds.success.join(",") === "1,2,3" && result.rounds.failure.join(",") === "1,2,3", "Every policy-failure submission must expose the current retry-all round on its own card.", result);
  assertQa(result.images === 1 && result.failed === 1 && result.successAttempt === "3" && result.failureAttempt === "3", "A successful card must leave the queue immediately while a card that exhausts all rounds remains failed.", result);
  assertQa(/504/.test(result.failureMessage), "The exhausted card must preserve its final HTTP 504 failure reason.", result);
}

async function testRetryAllFailedManualSupplementButton(cdp) {
  logStep("Retry-all supplement restarts exhausted failures from round one and also collects previously untracked failures");
  await loadFresh(cdp, "retry-all-manual-supplement");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiEndpoint", "https://api.example.test/v1/images/generations");
    set("apiKey", "sk-test");
    set("model", "gpt-image-2");
    set("failedRetryCount", "0");
    document.getElementById("apiProvider").value = "custom";
    const grid = document.getElementById("resultGrid");
    grid.innerHTML = "";
    grid.classList.remove("hidden");
    document.getElementById("resultToolbar").classList.remove("hidden");

    const exhausted = addResultPlaceholder(1, "exhausted failure", {
      mode: "comic", panelPrompt: "exhausted failure", prompt: "exhausted failure", size: "1024x1024", retryCount: 0,
    });
    markPlaceholderFailed(exhausted, 1, "HTTP 400: prompt may violate our content policies", exhausted._retryContext);
    const holding = addResultPlaceholder(2, "keep retry run open", {
      mode: "comic", panelPrompt: "keep retry run open", prompt: "keep retry run open", size: "1024x1024", retryCount: 0,
    });
    markPlaceholderFailed(holding, 2, "initial failure", holding._retryContext);
    const originalCallImageAPI = callImageAPI;
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==";
    const calls = { exhausted: 0, holding: 0, missed: 0 };
    callImageAPI = async (prompt, _size, _count, _label, options = {}) => {
      if (String(prompt).includes("exhausted failure")) {
        calls.exhausted++;
        if (calls.exhausted === 1) throw new Error("HTTP 400: prompt may violate our content policies");
        return { data: [{ b64_json: png }] };
      }
      if (String(prompt).includes("manually discovered failure")) {
        calls.missed++;
        return { data: [{ b64_json: png }] };
      }
      calls.holding++;
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    };

    const retryButton = document.getElementById("retryFailedAll");
    const supplement = document.getElementById("enqueueRemainingFailed");
    retryButton.click();
    const exhaustedDeadline = Date.now() + 2000;
    while (Date.now() < exhaustedDeadline && !(calls.exhausted === 1 && calls.holding === 1 && retryAllFailedRun?.failed === 1)) await sleep(10);

    // Simulate an exceptional UI path that did not call updateFailedRetryTools;
    // the manual scanner must collect it alongside the exhausted known card.
    const missed = addResultPlaceholder(3, "manually discovered failure", {
      mode: "comic", panelPrompt: "manually discovered failure", prompt: "manually discovered failure", size: "1024x1024", retryCount: 0,
    });
    missed.classList.add("is-failed");
    missed.dataset.failed = "true";
    missed.dataset.status = "failed";
    missed.dataset.errorMessage = "missed failure";
    const before = {
      visible: !supplement.classList.contains("hidden"),
      enabled: !supplement.disabled,
      tracked: retryAllFailedRun?.cards.length || 0,
      supplementable: getSupplementableFailedCards(retryAllFailedRun).length,
      failed: retryAllFailedRun?.failed,
      exhaustedAttempts: retryAllFailedRun?.attempts.get(exhausted),
    };
    supplement.click();
    const start = Date.now();
    while (Date.now() - start < 3000 && !(exhausted.dataset.status === "success" && missed.dataset.status === "success")) await sleep(10);
    const after = {
      calls,
      tracked: retryAllFailedRun?.cards.length || 0,
      uniqueTracked: new Set(retryAllFailedRun?.cards || []).size,
      exhaustedStatus: exhausted.dataset.status,
      missedStatus: missed.dataset.status,
      exhaustedRestartAttempt: retryAllFailedRun?.attempts.get(exhausted),
      failed: retryAllFailedRun?.failed,
      status: document.getElementById("status").textContent,
    };
    retryButton.click();
    while (retryAllFailedRun) await sleep(10);
    callImageAPI = originalCallImageAPI;
    return { before, after };
  })()`, true);

  assertQa(result.before.visible && result.before.enabled && result.before.tracked === 2 && result.before.supplementable === 2 && result.before.failed === 1 && result.before.exhaustedAttempts === 1,
    "The supplement button must expose both an exhausted known card and an untracked failed card while another request keeps the run active.", result);
  assertQa(result.after.calls.exhausted === 2 && result.after.calls.missed === 1 && result.after.calls.holding === 1,
    "Clicking supplement must resubmit the exhausted card and the newly discovered card without duplicating the active request.", result);
  assertQa(result.after.tracked === 3 && result.after.uniqueTracked === 3 && result.after.exhaustedRestartAttempt === 1,
    "Restarting an exhausted card must reset its attempt counter to round one without adding a duplicate card entry.", result);
  assertQa(result.after.exhaustedStatus === "success" && result.after.missedStatus === "success" && result.after.failed === 0,
    "Successful supplemented cards must leave the failed set and repair the run's aggregate failure count.", result);
}

async function testRetryAllFailedShowsQueuedCardsBeyondConcurrency(cdp) {
  logStep("Retry-all-failed marks cards beyond the provider concurrency limit as queued, keeps their positions current, and restores them on cancellation");
  await loadFresh(cdp, "retry-all-queued-state");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiEndpoint", "https://api.example.test/v1/images/generations");
    set("apiKey", "sk-test");
    set("model", "gpt-image-2");
    document.getElementById("apiProvider").value = "custom";

    const grid = document.getElementById("resultGrid");
    grid.innerHTML = "";
    grid.classList.remove("hidden");
    document.getElementById("resultToolbar").classList.remove("hidden");
    for (let i = 1; i <= 12; i++) {
      const prompt = "queued retry prompt " + i;
      const card = addResultPlaceholder(i, prompt, {
        mode: "comic", panelPrompt: prompt, prompt, size: "1024x1024", retryCount: 0,
      });
      markPlaceholderFailed(card, i, "HTTP 502: failure " + i, {
        mode: "comic", panelPrompt: prompt, prompt, size: "1024x1024", retryCount: 0,
      });
    }

    const originalFetch = window.fetch.bind(window);
    let calls = 0;
    window.fetch = async (url, opts = {}) => {
      if (!String(url).includes("/v1/images/generations")) return originalFetch(url, opts);
      calls++;
      return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (opts.signal?.aborted) abort();
        else opts.signal?.addEventListener("abort", abort, { once: true });
      });
    };

    const button = document.getElementById("retryFailedAll");
    button.click();
    const start = Date.now();
    while (Date.now() - start < 2000 && calls < 10) await sleep(20);
    const queuedCards = Array.from(document.querySelectorAll(".result-item.is-retry-queued"));
    const during = {
      calls,
      loading: document.querySelectorAll(".result-item[data-status='loading']").length,
      queued: queuedCards.length,
      positions: queuedCards.map(card => card.dataset.queuePosition),
      labels: queuedCards.map(card => card.querySelector(".retry-queue-position")?.textContent || ""),
      unsentHintCount: queuedCards.filter(card => card.textContent.includes(cleanText("retryQueuedHint"))).length,
      failedReasons: queuedCards.map(card => card.title),
    };

    button.click();
    const cancelStart = Date.now();
    while (Date.now() - cancelStart < 2500 && retryAllFailedRun) await sleep(20);
    const afterCancel = {
      failed: document.querySelectorAll(".result-item.is-failed").length,
      queued: document.querySelectorAll(".result-item.is-retry-queued").length,
      failure11: document.querySelector(".result-item[data-panel-id='11']")?.dataset.errorMessage || "",
      failure12: document.querySelector(".result-item[data-panel-id='12']")?.dataset.errorMessage || "",
    };
    window.fetch = originalFetch;
    return { during, afterCancel };
  })()`, true);

  assertQa(result.during.calls === 10 && result.during.loading === 10 && result.during.queued === 2, "Retry-all must start only the provider concurrency limit and visibly mark every remaining card as queued.", result);
  assertQa(result.during.positions.join(",") === "1,2" && result.during.labels.every((label, index) => label.includes(String(index + 1))), "Queued retry cards must show stable, sequential queue positions.", result);
  assertQa(result.during.unsentHintCount === 2 && result.during.failedReasons.every(reason => /HTTP 502/.test(reason)), "Queued cards must say that no request has been sent yet while preserving the original failure reason.", result);
  assertQa(result.afterCancel.failed === 12 && result.afterCancel.queued === 0 && /failure 11/.test(result.afterCancel.failure11) && /failure 12/.test(result.afterCancel.failure12), "Cancelling retry-all must restore queued cards and their original failure reasons.", result);
}

async function testRetryAllFailedCanCancelAndRestart(cdp) {
  logStep("Retry-all-failed stays visible, cancels hung requests, releases its lock, and can immediately start a fresh retry round");
  await loadFresh(cdp, "retry-all-cancel-restart");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiEndpoint", "https://api.example.test/v1/images/generations");
    set("apiKey", "sk-test");
    set("model", "gpt-image-2");
    document.getElementById("apiProvider").value = "custom";

    const grid = document.getElementById("resultGrid");
    grid.innerHTML = "";
    grid.classList.remove("hidden");
    document.getElementById("resultToolbar").classList.remove("hidden");
    for (let i = 1; i <= 2; i++) {
      const prompt = "retry prompt " + i;
      const card = addResultPlaceholder(i, prompt, {
        mode: "comic",
        panelPrompt: prompt,
        prompt,
        size: "1024x1024",
        retryCount: 0,
      });
      markPlaceholderFailed(card, i, "HTTP 502: initial failure", {
        mode: "comic",
        panelPrompt: prompt,
        prompt,
        size: "1024x1024",
        retryCount: 0,
      });
    }

    const originalFetch = window.fetch.bind(window);
    let hangingCalls = 0;
    window.fetch = async (url, opts = {}) => {
      if (!String(url).includes("/v1/images/generations")) return originalFetch(url, opts);
      hangingCalls++;
      return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (opts.signal?.aborted) abort();
        else opts.signal?.addEventListener("abort", abort, { once: true });
      });
    };

    const button = document.getElementById("retryFailedAll");
    const tools = document.getElementById("retryFailedTools");
    button.click();
    const start = Date.now();
    while (Date.now() - start < 2000 && hangingCalls < 2) await sleep(20);
    const latePrompt = "late retry prompt";
    const lateCard = addResultPlaceholder(3, latePrompt, {
      mode: "comic", panelPrompt: latePrompt, prompt: latePrompt, size: "1024x1024", retryCount: 0,
    });
    markPlaceholderFailed(lateCard, 3, "HTTP 502: late failure", {
      mode: "comic", panelPrompt: latePrompt, prompt: latePrompt, size: "1024x1024", retryCount: 0,
    });
    const lateStart = Date.now();
    while (Date.now() - lateStart < 2000 && hangingCalls < 3) await sleep(20);
    const during = {
      calls: hangingCalls,
      toolsVisible: !tools.classList.contains("hidden"),
      buttonEnabled: !button.disabled,
      buttonText: button.textContent,
      loadingCards: document.querySelectorAll(".result-item[data-status='loading']").length,
      trackedCards: retryAllFailedRun?.cards?.length || 0,
      status: document.getElementById("status").textContent,
    };

    button.click();
    const cancelStart = Date.now();
    while (Date.now() - cancelStart < 2000) {
      if (document.querySelectorAll(".result-item.is-failed").length === 3 && !button.disabled) break;
      await sleep(20);
    }
    const afterCancel = {
      failedCards: document.querySelectorAll(".result-item.is-failed").length,
      toolsVisible: !tools.classList.contains("hidden"),
      buttonEnabled: !button.disabled,
      buttonText: button.textContent,
      status: document.getElementById("status").textContent,
    };

    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==";
    let restartCalls = 0;
    window.fetch = async (url, opts = {}) => {
      if (!String(url).includes("/v1/images/generations")) return originalFetch(url, opts);
      restartCalls++;
      return new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    button.click();
    const restartStart = Date.now();
    while (Date.now() - restartStart < 3000) {
      if (document.querySelectorAll(".result-item img").length === 3 && !retryAllFailedRun) break;
      await sleep(20);
    }
    const afterRestart = {
      calls: restartCalls,
      images: document.querySelectorAll(".result-item img").length,
      failedCards: document.querySelectorAll(".result-item.is-failed").length,
      toolsHidden: tools.classList.contains("hidden"),
    };

    const cardToHangThenClear = document.querySelector(".result-item");
    markPlaceholderFailed(cardToHangThenClear, 1, "HTTP 502: fail before clear", cardToHangThenClear._retryContext);
    let clearAbortObserved = false;
    window.fetch = async (url, opts = {}) => {
      if (!String(url).includes("/v1/images/generations")) return originalFetch(url, opts);
      return new Promise((resolve, reject) => {
        opts.signal?.addEventListener("abort", () => {
          clearAbortObserved = true;
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    };
    button.click();
    await sleep(80);
    document.getElementById("clearResults").click();
    await sleep(120);

    grid.classList.remove("hidden");
    document.getElementById("resultToolbar").classList.remove("hidden");
    const freshCard = addResultPlaceholder(3, "fresh prompt", {
      mode: "comic", panelPrompt: "fresh prompt", prompt: "fresh prompt", size: "1024x1024", retryCount: 0,
    });
    markPlaceholderFailed(freshCard, 3, "HTTP 502: fresh failure", {
      mode: "comic", panelPrompt: "fresh prompt", prompt: "fresh prompt", size: "1024x1024", retryCount: 0,
    });
    const afterClear = {
      clearAbortObserved,
      toolsVisible: !tools.classList.contains("hidden"),
      buttonEnabled: !button.disabled,
      buttonText: button.textContent,
    };
    window.fetch = originalFetch;
    return { during, afterCancel, afterRestart, afterClear };
  })()`, true);

  assertQa(result.during.calls === 3 && result.during.loadingCards === 3 && result.during.trackedCards === 3, "A failure that appears while retry-all is running must join the active dynamic queue instead of being stranded behind the global lock.", result);
  assertQa(result.during.status.includes("3"), "Retry-all status must update its total when a newly failed card joins the active queue.", result);
  assertQa(result.during.toolsVisible && result.during.buttonEnabled && /取消|cancel/i.test(result.during.buttonText), "While retry requests are pending, the toolbar must stay visible and turn into an enabled cancel control.", result);
  assertQa(result.afterCancel.failedCards === 3 && result.afterCancel.toolsVisible && result.afterCancel.buttonEnabled, "Cancelling hung retries must restore initial and newly queued failed cards and release the global retry lock.", result);
  assertQa(/全部失败重试|retry all failed/i.test(result.afterCancel.buttonText) && /可再次|again/i.test(result.afterCancel.status), "After cancellation, the control and status should clearly say retrying is available again.", result);
  assertQa(result.afterRestart.calls === 3 && result.afterRestart.images === 3 && result.afterRestart.failedCards === 0 && result.afterRestart.toolsHidden, "A fresh retry-all round after cancellation must run normally and replace every failed card.", result);
  assertQa(result.afterClear.clearAbortObserved && result.afterClear.toolsVisible && result.afterClear.buttonEnabled && /全部失败重试|retry all failed/i.test(result.afterClear.buttonText), "Clearing results during a hung retry-all round must abort it, release the old lock, and leave future failed cards retryable.", result);
}

async function testCardRetryAttemptDisplayAndStop(cdp) {
  logStep("Each result card shows its own automatic-retry attempt count (not just a global status message that gets overwritten by concurrent cards) and offers a per-card 'stop retry' button that cancels just that one card without touching sibling cards");
  await loadFresh(cdp, "card-retry-stop");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const originalFetch = window.fetch.bind(window);
    let panelACalls = 0;
    let panelBCalls = 0;
    window.fetch = (url, opts = {}) => {
      if (!String(url).includes("/v1/images/generations")) return originalFetch(url, opts);
      let body = {};
      try { body = JSON.parse(opts.body || "{}"); } catch {}
      if (String(body.prompt || "").includes("panel A prompt")) {
        panelACalls++;
        if (panelACalls === 1) {
          return Promise.resolve(new Response(JSON.stringify({ error: "gateway" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          }));
        }
        // Second attempt hangs until the per-card stop button aborts it.
        return new Promise((resolve, reject) => {
          opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      panelBCalls++;
      return Promise.resolve(new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    };
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "custom");
    set("apiEndpoint", "http://mock.local");
    set("apiKey", "sk-test");
    document.querySelector('[data-mode="comic"]').click();
    await new Promise(r => setTimeout(r, 50));
    set("prompt", "");
    set("panelCount", "2");
    document.getElementById("createPanels").click();
    await new Promise(r => setTimeout(r, 80));
    const rows = [...document.querySelectorAll("#panelTbody tr")];
    const fillPanel = (row, text) => {
      const ta = row.querySelector("textarea");
      ta.value = text;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    };
    fillPanel(rows[0], "panel A prompt");
    fillPanel(rows[1], "panel B prompt");

    document.getElementById("generateBtn").click();

    let cardA = null;
    let attemptLabelText = "";
    let stopBtnVisibleDuringRetry = false;
    let start = Date.now();
    while (Date.now() - start < 4000) {
      cardA = [...document.querySelectorAll(".result-item")].find(c => c.dataset.panelId === "1");
      const label = cardA?.querySelector(".retry-attempt-label");
      if (label && !label.classList.contains("hidden") && label.textContent.trim()) {
        attemptLabelText = label.textContent;
        stopBtnVisibleDuringRetry = !cardA.querySelector(".stop-card-retry")?.classList.contains("hidden");
        break;
      }
      await new Promise(r => setTimeout(r, 40));
    }

    // Don't stop yet -- wait for the actual retry request to be dispatched (after the retry
    // backoff delay elapses) so this proves stopping cancels a genuinely in-flight/hanging
    // request, not just a request that was still waiting in its backoff window.
    start = Date.now();
    while (Date.now() - start < 4000 && panelACalls < 2) {
      await new Promise(r => setTimeout(r, 40));
    }
    const panelACallsBeforeStop = panelACalls;

    cardA.querySelector(".stop-card-retry").click();

    start = Date.now();
    while (Date.now() - start < 4000) {
      if (cardA.classList.contains("is-failed")) break;
      await new Promise(r => setTimeout(r, 40));
    }
    const cardAFailedMessage = cardA.dataset.errorMessage || "";

    let cardB = null;
    start = Date.now();
    while (Date.now() - start < 4000) {
      cardB = [...document.querySelectorAll(".result-item")].find(c => c.dataset.panelId === "2");
      if (cardB?.querySelector("img")) break;
      await new Promise(r => setTimeout(r, 40));
    }

    return {
      attemptLabelText,
      stopBtnVisibleDuringRetry,
      cardAFailed: cardA.classList.contains("is-failed"),
      cardAFailedMessage,
      panelACallsBeforeStop,
      panelACalls,
      panelBCalls,
      cardBHasImage: !!cardB?.querySelector("img"),
    };
  })()`, true);

  assertQa(/1\s*\/\s*3/.test(result.attemptLabelText), "The card itself should show which automatic-retry attempt it's on (e.g. '第 1/3 次自动重试'), not just rely on a global status line that gets overwritten by other concurrently-retrying cards.", result);
  assertQa(result.stopBtnVisibleDuringRetry, "The cancel button must still be visible once the card is auto-retrying (it's visible from the moment the card starts loading, see testCancelDuringFirstAttempt -- this just confirms auto-retry doesn't hide it).", result);
  assertQa(result.cardAFailed && /已手动取消/.test(result.cardAFailedMessage), "Clicking the per-card cancel button should cancel that card's in-flight request and mark it as manually cancelled.", result);
  assertQa(result.panelACallsBeforeStop === 2, "Panel A's second (retry) request must actually be dispatched before we stop it -- otherwise this only proves stopping during the backoff wait, not cancelling a genuinely in-flight request.", result);
  assertQa(result.panelACalls === 2, "Stopping the card must not trigger yet another request -- exactly the initial transient failure plus the one retry that got cancelled, nothing more.", result);
  assertQa(result.cardBHasImage && result.panelBCalls === 1, "Stopping panel A's retry must not affect panel B, which should complete normally on its own single request.", result);
}

async function testCancelDuringFirstAttempt(cdp) {
  logStep("A single image's cancel button must work during its very first (normal, non-retry) generation attempt, not just once it's already failed and auto-retrying -- the user explicitly clarified that a single image should be cancellable on its own, in addition to the existing 'cancel all' button");
  await loadFresh(cdp, "cancel-first-attempt");
  const result = await cdp.eval(`(async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const originalFetch = window.fetch.bind(window);
    // Single mode sends the same prompt for every image in the batch, so requests can't be
    // told apart by content -- distinguish by call order instead: the first request hangs
    // (simulating a slow first attempt), every request after that succeeds immediately.
    let hangingCallMade = false;
    let hangingCalls = 0;
    let succeedingCalls = 0;
    window.fetch = (url, opts = {}) => {
      if (!String(url).includes("/v1/images/generations")) return originalFetch(url, opts);
      if (!hangingCallMade) {
        hangingCallMade = true;
        hangingCalls++;
        return new Promise((resolve, reject) => {
          opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      succeedingCalls++;
      return Promise.resolve(new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    };
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "custom");
    set("apiEndpoint", "http://mock.local");
    set("apiKey", "sk-test");
    set("nImages", "2");
    set("prompt", "two images, same prompt");

    document.getElementById("generateBtn").click();
    let start = Date.now();
    let hangingCard = null;
    let succeedingCard = null;
    while (Date.now() - start < 3000) {
      const cards = [...document.querySelectorAll(".result-item")];
      hangingCard = cards.find(c => c.dataset.status === "loading");
      succeedingCard = cards.find(c => c !== hangingCard && c.querySelector("img"));
      if (cards.length === 2 && hangingCard && succeedingCard) break;
      await new Promise(r => setTimeout(r, 40));
    }

    // The cancel button must already be visible right away -- no failure or retry has
    // happened yet, this is still the hanging card's very first attempt.
    const cancelBtnVisibleImmediately = !hangingCard.querySelector(".stop-card-retry")?.classList.contains("hidden");
    const retryLabelHiddenBeforeCancel = hangingCard.querySelector(".retry-attempt-label")?.classList.contains("hidden");

    hangingCard.querySelector(".stop-card-retry").click();
    start = Date.now();
    while (Date.now() - start < 3000) {
      if (hangingCard.classList.contains("is-failed")) break;
      await new Promise(r => setTimeout(r, 40));
    }

    start = Date.now();
    while (Date.now() - start < 3000) {
      if (succeedingCard?.querySelector("img")) break;
      await new Promise(r => setTimeout(r, 40));
    }

    return {
      cancelBtnVisibleImmediately,
      retryLabelHiddenBeforeCancel,
      hangingCardFailed: hangingCard.classList.contains("is-failed"),
      hangingCardMessage: hangingCard.dataset.errorMessage || "",
      hangingCalls,
      succeedingCardHasImage: !!succeedingCard?.querySelector("img"),
      succeedingCalls,
    };
  })()`, true);

  assertQa(result.cancelBtnVisibleImmediately, "The per-card cancel button must be visible immediately when a card starts loading -- it must not wait for a failed/retrying state to appear, since the whole point is being able to cancel a single image's very first attempt.", result);
  assertQa(result.retryLabelHiddenBeforeCancel, "The retry-attempt-label must stay hidden when a card is cancelled during its first attempt -- it never failed once, so there was never a retry to report.", result);
  assertQa(result.hangingCardFailed && /已手动取消/.test(result.hangingCardMessage), "Cancelling an image during its first attempt must mark it as manually cancelled, the same outcome as cancelling during a retry.", result);
  assertQa(result.hangingCalls === 1, "The cancelled image should only have been requested once (its first attempt, which got cancelled) -- cancelling a first attempt must not trigger a retry.", result);
  assertQa(result.succeedingCardHasImage && result.succeedingCalls === 1, "Cancelling one image must not affect the other, which should complete normally on its own.", result);
}

async function testUpdateControls(cdp) {
  logStep("Settings update controls and platform package selection");
  await loadFresh(cdp, "updates");
  const result = await cdp.eval(`(async () => {
    const originalFetch = window.fetch;
    const originalOpen = window.open;
    let releaseTag = "v9.9.9";
    let openedUrls = [];
    const releaseAssets = [
      { name: "AI-Image-Generator-android.apk", browser_download_url: "https://example.test/android.apk" },
      { name: "AI-Image-Generator-Setup.exe", browser_download_url: "https://example.test/Setup.exe" }
    ];
    window.open = (url) => {
      openedUrls.push(String(url));
      return { closed: false };
    };
    window.fetch = async (url, options) => {
      if (String(url).includes("/releases/latest")) {
        return new Response(JSON.stringify({
          tag_name: releaseTag,
          body: "## Test release\\n- Update panel renders notes",
          assets: releaseAssets
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return originalFetch(url, options);
    };
    document.getElementById("settingsBtn").click();
    await new Promise(r => setTimeout(r, 80));
    document.getElementById("checkUpdates").click();
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (/9\\.9\\.9/.test(document.getElementById("latestVersionLabel")?.textContent || "")) break;
      await new Promise(r => setTimeout(r, 50));
    }
    const selected = window.AiGenUpdate.selectUpdateAsset({
      assets: [
        { name: "AI-Image-Generator-android.apk", browser_download_url: "https://example.test/android.apk" },
        { name: "AI-Image-Generator-Setup.exe", browser_download_url: "https://example.test/Setup.exe" }
      ]
    }, "windows");
    const newerState = {
      latest: document.getElementById("latestVersionLabel")?.textContent || "",
      status: document.getElementById("updateStatus")?.textContent || "",
    };
    releaseTag = "v" + window.AiGenUpdate.APP_VERSION;
    document.getElementById("checkUpdates").click();
    const sameStart = Date.now();
    while (Date.now() - sameStart < 3000) {
      if (/最新版|up to date|最新です|최신/.test(document.getElementById("updateStatus")?.textContent || "")) break;
      await new Promise(r => setTimeout(r, 50));
    }
    const sameVersionResult = await window.AiGenUpdate.downloadLatestUpdate(true);
    window.fetch = originalFetch;
    window.open = originalOpen;
    return {
      modalOpen: !document.getElementById("settingsModal").classList.contains("hidden"),
      latest: document.getElementById("latestVersionLabel")?.textContent || "",
      status: document.getElementById("updateStatus")?.textContent || "",
      asset: document.getElementById("updateAssetLabel")?.textContent || "",
      notes: document.getElementById("updateNotes")?.value || "",
      appVersion: window.AiGenUpdate.APP_VERSION,
      newerState,
      selectedName: selected?.name || "",
      checkDisabled: document.getElementById("checkUpdates").disabled,
      installDisabled: document.getElementById("installUpdate").disabled,
      sameVersionResult,
      openedUrls,
    };
  })()`, true);
  assertQa(result.modalOpen, "Settings modal should open from the header button.", result);
  assertQa(result.newerState.latest.includes("9.9.9") && /9\.9\.9/.test(result.newerState.status), "Check update button should update latest version and status.", result);
  assertQa(result.latest.includes(result.appVersion) && /最新版|up to date|最新です|최신/.test(result.status), "Same-version update check should show the app is current.", result);
  assertQa(result.selectedName.includes("Setup.exe"), "Windows update selection should prefer the installer exe asset.", result);
  assertQa(result.asset.includes("Setup.exe") && result.notes.includes("Test release"), "Update panel should show the selected package name and release notes.", result);
  assertQa(!result.checkDisabled, "Update check button should be re-enabled after checking.", result);
  assertQa(result.installDisabled, "Install button should be disabled after a same-version update check.", result);
  assertQa(result.sameVersionResult?.skipped === true && result.openedUrls.length === 0, "Downloading the current version should be blocked and should not open an update URL.", result);
}

function startupUpdateMockScript(tagName) {
  return `
    localStorage.removeItem("ai_image_update_check_state_v1");
    window.__openExternalCalls = [];
    window.__origFetch = window.fetch;
    window.fetch = function(url, options) {
      if (String(url).includes("/releases/latest")) {
        return Promise.resolve(new Response(JSON.stringify({
          tag_name: ${JSON.stringify(tagName)},
          html_url: "https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/${tagName}",
          body: "## Mock release for testing",
          assets: [
            { name: "AI-Image-Generator-Setup.exe", browser_download_url: "https://example.test/Setup.exe" },
            { name: "SHA256SUMS.txt", browser_download_url: "https://example.test/SHA256SUMS.txt" }
          ]
        }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (String(url).includes("SHA256SUMS.txt")) {
        return Promise.resolve(new Response(
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  AI-Image-Generator-Setup.exe\\n",
          { status: 200, headers: { "content-type": "text/plain" } }
        ));
      }
      return window.__origFetch(url, options);
    };
    window.open = function(url) { window.__openExternalCalls.push(String(url)); return { closed: false }; };
  `;
}

async function testStartupUpdatePrompt(cdp) {
  logStep("Startup update check should prompt once and respect the user's choice");

  // Case 1: newer version available -> dialog should appear, confirming it should trigger the update flow.
  const newerScript = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: startupUpdateMockScript("v9.9.9") });
  await loadFresh(cdp, "startup-update-newer");
  await sleep(1800);
  const newerCase = await cdp.eval(`(async () => {
    const overlay = document.querySelector(".ask-dialog-overlay");
    const message = overlay?.querySelector(".ask-dialog-message")?.textContent || "";
    const dialogPresent = !!overlay;
    document.querySelector(".ask-dialog-ok")?.click();
    await new Promise(r => setTimeout(r, 300));
    return {
      dialogPresent,
      message,
      dialogGoneAfterConfirm: !document.querySelector(".ask-dialog-overlay"),
      openedUrls: window.__openExternalCalls,
    };
  })()`, true);
  await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: newerScript.identifier });
  assertQa(newerCase.dialogPresent, "A newer version should trigger an update prompt shortly after launch.", newerCase);
  assertQa(newerCase.message.includes("9.9.9"), "The startup update prompt should mention the new version number.", newerCase);
  assertQa(newerCase.dialogGoneAfterConfirm, "Confirming the startup update prompt should close it.", newerCase);
  assertQa(newerCase.openedUrls.some(u => u.includes("Setup.exe")), "Confirming the startup update prompt should proceed with the update/download flow.", newerCase);

  // Case 2: already on the latest version -> no prompt should ever appear.
  const currentVersion = await cdp.eval(`window.AiGenUpdate.APP_VERSION`, false);
  const sameScript = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: startupUpdateMockScript(`v${currentVersion}`) });
  await loadFresh(cdp, "startup-update-current");
  await sleep(1800);
  const sameVersionCase = await cdp.eval(`({ dialogPresent: !!document.querySelector(".ask-dialog-overlay") })`, false);
  await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: sameScript.identifier });
  assertQa(!sameVersionCase.dialogPresent, "Already being on the latest version should never show a startup update prompt.", sameVersionCase);
}

async function testDragDropHintReflectsPlatform(cdp) {
  logStep("The windowed Windows WebView2 host and browser/PWA both advertise native drag-and-drop support");

  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.FlutterDownload = { postMessage() {} }; window.__AI_GEN_WINDOWS_WINDOWED_WEBVIEW = true;`,
  });
  await cdp.send("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  try {
    await loadFresh(cdp, "dragdrop-native-windows");
    const nativeWindowsText = await cdp.eval(`document.querySelector(".image-upload .upload-zone > span:last-child")?.textContent || ""`, false);
    assertQa(/拖/.test(nativeWindowsText), "The windowed Windows WebView2 host should advertise its native drag-and-drop support.", { nativeWindowsText });
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: "" });
  }

  await loadFresh(cdp, "dragdrop-browser");
  const browserText = await cdp.eval(`document.querySelector(".image-upload .upload-zone > span:last-child")?.textContent || ""`, false);
  assertQa(/拖/.test(browserText), "Browser/PWA build (real Chromium, real drag-and-drop support) should still advertise drag-and-drop.", { browserText });
}

async function testUploadZoneHintTargetsCorrectSpan(cdp) {
  logStep("setText()'s hint-text calls for upload zones must land on the actual hint <span>, not the nested icon <span> — a bare 'span:last-child' selector matches whichever span comes first in document order that is the last child of ITS OWN parent, which is the icon span (the only child of .upload-icon), not the intended hint text; writing a long sentence into that ~18px icon silently balloons the whole upload zone to over 1000px tall by wrapping one character per line");
  await loadFresh(cdp, "upload-zone-hint-target");
  const result = await cdp.eval(`(async () => {
    document.querySelector('[data-mode="turnaround"]').click();
    await new Promise(r => setTimeout(r, 80));
    function measure(zoneSelector) {
      const zone = document.querySelector(zoneSelector);
      const icon = zone.querySelector(".upload-icon");
      const hint = [...zone.children].find(el => el !== icon);
      return {
        zoneHeight: zone.getBoundingClientRect().height,
        iconOwnText: icon.querySelector(".ui-icon")?.textContent || "",
        hintText: hint ? hint.textContent : null,
      };
    }
    return {
      globalRef: measure("#uploadZone"),
      turnaround: measure("#turnaroundUploadZone"),
    };
  })()`, true);

  assertQa(result.globalRef.zoneHeight < 200, `Global reference upload zone must stay compact (measured ${result.globalRef.zoneHeight}px) — a runaway height means the hint text landed on the wrong element again.`, result);
  assertQa(result.globalRef.iconOwnText === "", "The global reference upload zone's icon span must never contain the hint sentence.", result);
  assertQa(/点击|拖拽|Click|Drag|クリック|ドラッグ|클릭|드래그/.test(result.globalRef.hintText || ""), "The global reference upload zone's actual hint span must contain real hint text.", result);

  assertQa(result.turnaround.zoneHeight < 200, `Turnaround mode's bulk-upload zone must stay compact (measured ${result.turnaround.zoneHeight}px) — a runaway height means the hint text landed on the wrong element again.`, result);
  assertQa(result.turnaround.iconOwnText === "", "The turnaround upload zone's icon span must never contain the hint sentence.", result);
  assertQa(/点击|拖拽|Click|Drag|クリック|ドラッグ|클릭|드래그/.test(result.turnaround.hintText || ""), "The turnaround upload zone's actual hint span must contain real hint text.", result);
}

async function testManualWheelScrollFallback(cdp) {
  logStep("Legacy texture-based Windows shells keep an isolated nested-scroll fallback; the windowed host bypasses it");

  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.FlutterDownload = { postMessage() {} };`,
  });
  await cdp.send("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  try {
    await loadFresh(cdp, "wheel-native-windows");
    const result = await cdp.eval(`(async () => {
      document.getElementById("settingsBtn").click();
      await new Promise(r => setTimeout(r, 100));
      const card = document.querySelector("#settingsModal .modal-card");
      const inputPanel = document.querySelector(".input-panel");
      card.style.maxHeight = "200px";
      inputPanel.scrollTop = 0;
      card.scrollTop = 0;
      const before = card.scrollTop;
      const inner = card.querySelector(".settings-section") || card;
      inner.dispatchEvent(new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 50));
      const afterInner = card.scrollTop;
      card.scrollTop = 0;
      inputPanel.scrollTop = 0;
      inputPanel.dispatchEvent(new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 50));
      const afterBackgroundTarget = {
        card: card.scrollTop,
        inputPanel: inputPanel.scrollTop,
      };
      card.scrollTop = 0;
      inputPanel.scrollTop = 0;
      document.body.dispatchEvent(new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 50));
      const afterBodyTarget = {
        card: card.scrollTop,
        inputPanel: inputPanel.scrollTop,
      };
      card.scrollTop = 0;
      inputPanel.scrollTop = 0;
      inner.dispatchEvent(new WheelEvent("wheel", { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 50));
      const afterLineDelta = card.scrollTop;
      closeModal(document.getElementById("settingsModal"));
      await new Promise(r => setTimeout(r, 30));
      inputPanel.scrollTop = 0;
      const askPromise = askConfirm("short dialog");
      await new Promise(r => setTimeout(r, 60));
      const askOverflowDuring = document.body.style.overflow;
      const askDispatchResult = inputPanel.dispatchEvent(new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 30));
      const askInputScroll = inputPanel.scrollTop;
      document.querySelector(".ask-dialog-ok")?.click();
      await askPromise;
      await new Promise(r => setTimeout(r, 30));
      const askOverflowAfter = document.body.style.overflow;
      inputPanel.scrollTop = 0;
      openLightbox("data:image/png;base64,iVBORw0KGgo=");
      await new Promise(r => setTimeout(r, 30));
      const lightboxOverflowDuring = document.body.style.overflow;
      const lightboxDispatchResult = inputPanel.dispatchEvent(new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 30));
      const lightboxInputScroll = inputPanel.scrollTop;
      document.querySelector(".lightbox")?.click();
      await new Promise(r => setTimeout(r, 30));
      const lightboxOverflowAfter = document.body.style.overflow;
      return {
        before,
        after: afterInner,
        afterBackgroundTarget,
        afterBodyTarget,
        afterLineDelta,
        ask: {
          overflowDuring: askOverflowDuring,
          dispatchPrevented: askDispatchResult === false,
          inputPanelScroll: askInputScroll,
          overflowAfter: askOverflowAfter,
        },
        lightbox: {
          overflowDuring: lightboxOverflowDuring,
          dispatchPrevented: lightboxDispatchResult === false,
          inputPanelScroll: lightboxInputScroll,
          overflowAfter: lightboxOverflowAfter,
        },
      };
    })()`, true);
    assertQa(result.after > result.before, "A wheel event over a nested scroll container in the native Windows exe should move that container's scrollTop via the JS fallback.", result);
    assertQa(result.afterBackgroundTarget.card > 0 && result.afterBackgroundTarget.inputPanel === 0, "When a modal is open, a misrouted wheel event targeting the background panel should scroll the modal card, not the main input panel.", result);
    assertQa(result.afterBodyTarget.card > 0 && result.afterBodyTarget.inputPanel === 0, "When a modal is open, a wheel event targeting body/document should still be redirected to the modal card.", result);
    assertQa(result.afterLineDelta > 0, "Wheel deltaMode=line should be normalized so line-based wheels can still scroll the modal.", result);
    assertQa(result.ask.overflowDuring === "hidden" && result.ask.dispatchPrevented && result.ask.inputPanelScroll === 0 && result.ask.overflowAfter === "", "A non-scrollable ask dialog should lock body scroll and block misrouted wheel events from scrolling the main panel.", result);
    assertQa(result.lightbox.overflowDuring === "hidden" && result.lightbox.dispatchPrevented && result.lightbox.inputPanelScroll === 0 && result.lightbox.overflowAfter === "", "The lightbox overlay should lock body scroll and block misrouted wheel events from scrolling the main panel.", result);
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: "" });
  }

  await loadFresh(cdp, "wheel-browser");
  const browserResult = await cdp.eval(`(async () => {
    document.getElementById("settingsBtn").click();
    await new Promise(r => setTimeout(r, 100));
    const card = document.querySelector("#settingsModal .modal-card");
    card.style.maxHeight = "200px";
    card.scrollTop = 0;
    const before = card.scrollTop;
    const inner = card.querySelector(".settings-section") || card;
    inner.dispatchEvent(new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 50));
    return { before, after: card.scrollTop };
  })()`, true);
  assertQa(browserResult.after === browserResult.before, "The JS wheel fallback should not be installed in the browser/PWA build — a synthetic (untrusted) wheel event shouldn't move scrollTop there since real Chromium ignores untrusted wheel events for its own native scroll and our fallback should be gated off.", browserResult);
}

async function testModelChoicesWheelScroll(cdp) {
  logStep("Detected-models picker is now the same custom-select dropdown as the other lists; scrolling its open popup should scroll the popup, not the outer .input-panel");
  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.FlutterDownload = { postMessage() {} };`,
  });
  await cdp.send("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  try {
    await loadFresh(cdp, "model-choices-wheel");
    const result = await cdp.eval(`(async () => {
      document.getElementById("configSection").open = true;
      setModelChoices(Array.from({ length: 40 }, (_, i) => "model-" + i));
      await new Promise(r => setTimeout(r, 50));
      document.getElementById("model").click();
      await new Promise(r => setTimeout(r, 80));
      const list = document.getElementById("modelChoicesCustomList");
      list.scrollIntoView({ block: "center" });
      await new Promise(r => setTimeout(r, 50));
      const inputPanel = document.querySelector(".input-panel");
      const hasOverflow = list.scrollHeight > list.clientHeight;
      list.scrollTop = 0;
      inputPanel.scrollTop = 0;
      const before = { list: list.scrollTop, inputPanel: inputPanel.scrollTop };
      const firstOption = list.querySelector(".custom-select-option");
      firstOption.dispatchEvent(new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 50));
      const afterCorrectTarget = { list: list.scrollTop, inputPanel: inputPanel.scrollTop };

      // webview_windows forwards wheel events without reliable cursor->target hit-testing
      // (upstream #313): the event's clientX/clientY can be right while event.target is
      // wrong. Simulate that by dispatching on .input-panel itself but with coordinates
      // that visually sit inside the open dropdown list, and verify elementFromPoint-based
      // recovery still finds and scrolls the popup instead of trusting the misrouted target.
      list.scrollTop = 0;
      inputPanel.scrollTop = 0;
      const rect = firstOption.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      inputPanel.dispatchEvent(new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      await new Promise(r => setTimeout(r, 50));
      const afterMisroutedTarget = { list: list.scrollTop, inputPanel: inputPanel.scrollTop };

      // Worse case: webview_windows' wheel event carries NEITHER a correct target NOR correct
      // clientX/clientY (both are unreliable, not just one). Two independent layers can each
      // recover from this: (1) the open dropdown is tracked as a "blocking overlay", so even a
      // wrongly-resolved scroll target outside it falls back to the overlay's own primary
      // scroller, and (2) a prior real mousemove over the dropdown is tracked independently of
      // the wheel event and used as a coordinate source of last resort. Either one alone already
      // fixes this scenario; this asserts the combination still does.
      list.scrollTop = 0;
      inputPanel.scrollTop = 0;
      const inputPanelRect = inputPanel.getBoundingClientRect();
      firstOption.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: cx, clientY: cy }));
      await new Promise(r => setTimeout(r, 20));
      inputPanel.dispatchEvent(new WheelEvent("wheel", {
        deltaY: 240, bubbles: true, cancelable: true,
        clientX: inputPanelRect.left + 5, clientY: inputPanelRect.top + 5,
      }));
      await new Promise(r => setTimeout(r, 50));
      const afterBothWrong = { list: list.scrollTop, inputPanel: inputPanel.scrollTop };

      // Regression guard: when a flex column (.custom-select-list) has more items than fit in
      // its max-height, flexbox will shrink every item below its own content size unless each
      // item has flex-shrink:0 — the container ends up scrolling a list of squished, overlapping
      // rows instead of full-size rows. Assert every option's rendered box is tall enough to
      // actually contain its own content (offsetHeight >= scrollHeight, i.e. nothing clipped).
      const allOptions = [...list.querySelectorAll(".custom-select-option")];
      const squished = allOptions.filter(o => o.offsetHeight < o.scrollHeight).length;

      return {
        hasOverflow,
        before,
        afterCorrectTarget,
        afterMisroutedTarget,
        afterBothWrong,
        optionCount: allOptions.length,
        squished,
      };
    })()`, true);
    assertQa(result.hasOverflow, "Test setup sanity check: 40 detected models should overflow the 240px-tall dropdown popup so this test actually exercises nested scrolling.", result);
    assertQa(result.afterCorrectTarget.list > result.before.list, "A wheel event over the open model dropdown should scroll the dropdown itself.", result);
    assertQa(result.afterCorrectTarget.inputPanel === result.before.inputPanel, "A wheel event over the open model dropdown should NOT scroll the outer .input-panel — this is the 'hovering over model selection moves the global scrollbar instead' bug.", result);
    assertQa(result.afterMisroutedTarget.list > 0, "Even if webview_windows reports a wrong event.target (e.g. .input-panel) while the cursor's clientX/clientY are actually over the open dropdown, elementFromPoint-based recovery should still scroll it.", result);
    assertQa(result.afterMisroutedTarget.inputPanel === 0, "The misrouted-target case should still not move the outer .input-panel once coordinate-based recovery kicks in.", result);
    assertQa(result.afterBothWrong.list > 0, "Even when BOTH event.target and the wheel event's own clientX/clientY are wrong, overlay-fallback and/or mousemove-tracked position recovery should still scroll the open dropdown.", result);
    assertQa(result.afterBothWrong.inputPanel === 0, "The both-signals-wrong case should still not move the outer .input-panel once recovery kicks in.", result);
    assertQa(result.squished === 0, `${result.squished}/${result.optionCount} dropdown option rows were flex-shrunk below their own content height, causing overlapping/garbled text — every row needs flex-shrink:0.`, result);
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: "" });
  }
}

async function testModelComboboxBehavior(cdp) {
  logStep("The #model input is itself the dropdown trigger (combobox pattern): click opens the detected-models list, typing a custom name closes it, clicking outside closes it, and it must not open at all when nothing has been detected yet");
  await loadFresh(cdp, "model-combobox");
  const result = await cdp.eval(`(async () => {
    const input = document.getElementById("model");
    const list = document.getElementById("modelChoicesCustomList");

    // Before any detection: clicking the plain input must not pop an empty list open.
    input.click();
    await new Promise(r => setTimeout(r, 30));
    const openBeforeDetection = !list.classList.contains("hidden");
    const affordanceBeforeDetection = input.classList.contains("has-model-choices");

    setModelChoices(["model-a", "model-b", "model-c"]);
    await new Promise(r => setTimeout(r, 30));
    const affordanceAfterDetection = input.classList.contains("has-model-choices");

    input.click();
    await new Promise(r => setTimeout(r, 30));
    const openAfterClick = !list.classList.contains("hidden");
    const optionCount = list.querySelectorAll(".custom-select-option").length;

    // Typing a custom model name while the list is open should close it (free text entry stays fully usable).
    input.value = "my-custom-model";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    const closedAfterTyping = list.classList.contains("hidden");
    const valuePreservedAfterTyping = input.value;

    // Re-open, then click elsewhere: should close via the same outside-click handling as the other dropdowns.
    input.click();
    await new Promise(r => setTimeout(r, 30));
    const openBeforeOutsideClick = !list.classList.contains("hidden");
    document.body.click();
    await new Promise(r => setTimeout(r, 30));
    const closedAfterOutsideClick = list.classList.contains("hidden");

    return {
      openBeforeDetection, affordanceBeforeDetection,
      affordanceAfterDetection, openAfterClick, optionCount,
      closedAfterTyping, valuePreservedAfterTyping,
      openBeforeOutsideClick, closedAfterOutsideClick,
    };
  })()`, true);
  assertQa(!result.openBeforeDetection, "Clicking #model before any models are detected must not open an empty dropdown.", result);
  assertQa(!result.affordanceBeforeDetection, "The dropdown-arrow affordance on #model must not show before there is anything to pick from.", result);
  assertQa(result.affordanceAfterDetection, "The dropdown-arrow affordance should appear on #model once models are detected.", result);
  assertQa(result.openAfterClick && result.optionCount === 3, "Clicking #model after detection should open the list populated with the detected models, with no separate dropdown control needed.", result);
  assertQa(result.closedAfterTyping, "Typing a custom model name should close the open dropdown instead of leaving it stuck open over the text being typed.", result);
  assertQa(result.valuePreservedAfterTyping === "my-custom-model", "Typing a custom model name must still work normally — the combobox popup must never block manual free-text entry.", result);
  assertQa(result.openBeforeOutsideClick && result.closedAfterOutsideClick, "Clicking outside the model field should close its open dropdown, same as every other custom-select.", result);
}

async function testTurnaroundMode(cdp) {
  logStep("Turnaround mode: bulk-add sorts by filename, each row generates its own request carrying exactly one reference image (the whole point of the feature, avoiding the HTTP 413 from bundling many references into one request), results save as a single project, and per-row retry/restore both work correctly");
  await loadFresh(cdp, "turnaround-mode");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const originalFetch = window.fetch.bind(window);
    const calls = [];
    window.fetch = async (url, opts = {}) => {
      if (String(url).includes("/v1/api/generate")) {
        let body = {};
        try { body = JSON.parse(opts.body || "{}"); } catch {}
        calls.push({ prompt: body.prompt, size: body.size || body.aspectRatio, imagesCount: (body.images || []).length });
        return new Response(JSON.stringify({ status: "succeeded", data: [{ url: "data:image/png;base64," + png }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(url, opts);
    };

    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiProvider", "grsai");
    set("apiEndpoint", "https://grsai.dakka.com.cn/v1/api/generate");
    set("apiKey", "sk-qa-turnaround");
    set("model", "gpt-image-2");
    document.querySelector('[data-mode="turnaround"]').click();
    await new Promise(r => setTimeout(r, 50));
    const globalSizeFieldHiddenInTurnaround = document.getElementById("globalSizeField").classList.contains("hidden");
    const globalPromptFieldHiddenInTurnaround = document.getElementById("globalPromptField").classList.contains("hidden");
    const skillsHiddenInTurnaround = document.getElementById("activeSkillsSection").classList.contains("hidden");
    set("prompt", "GLOBAL STYLE");

    async function makeImageFile(name, color) {
      const canvas = document.createElement("canvas");
      canvas.width = 4; canvas.height = 4;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color; ctx.fillRect(0, 0, 4, 4);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      return new File([blob], name, { type: "image/png" });
    }
    // Deliberately out-of-order filenames with a two-digit number, to prove natural/numeric
    // sort (1, 2, 10) rather than upload order or lexical string order (1, 10, 2).
    const dt = new DataTransfer();
    dt.items.add(await makeImageFile("cap-2.png", "#3f3"));
    dt.items.add(await makeImageFile("cap-10.png", "#33f"));
    dt.items.add(await makeImageFile("cap-1.png", "#f33"));
    const input = document.getElementById("turnaroundBulkInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));

    const rowsBeforeGenerate = [...document.querySelectorAll(".turnaround-row")];
    const sortedFileNames = rowsBeforeGenerate.map(r => r.querySelector(".turnaround-img-thumb").title);
    const noEmptyRowBeforeUpload = rowsBeforeGenerate.length === 3; // no leftover auto-created blank row ahead of the bulk-added ones
    rowsBeforeGenerate.forEach((row, i) => {
      const ta = row.querySelector(".turnaround-prompt");
      ta.value = "target character " + (i + 1);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });

    document.getElementById("generateBtn").click();
    let start = Date.now();
    while (Date.now() - start < 6000) {
      const h = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
      if (h.length === 1 && (h[0]?.images || []).length === 3 && document.querySelectorAll(".result-item img").length === 3) break;
      await new Promise(r => setTimeout(r, 80));
    }

    const history = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
    const item = history[0] || {};
    const initialGenerationCalls = calls.length; // snapshot before the retry step below adds a 4th call

    // Retry a single row in isolation: only that row's request should fire again.
    const callsBeforeRetry = calls.length;
    const retryBtn = [...document.querySelectorAll(".result-item .card-action")].find(b => b.querySelector(".ui-icon-retry"));
    retryBtn?.click();
    start = Date.now();
    while (Date.now() - start < 4000) {
      if (calls.length > callsBeforeRetry) break;
      await new Promise(r => setTimeout(r, 80));
    }
    await new Promise(r => setTimeout(r, 200));

    // Restore from history and confirm it repopulates turnaround mode with the right rows.
    document.getElementById("resultGrid").innerHTML = "";
    document.getElementById("resultGrid").classList.add("hidden");
    document.getElementById("emptyState").classList.remove("hidden");
    document.getElementById("turnaroundTbody").innerHTML = "";
    document.querySelector('[data-mode="single"]').click();
    await new Promise(r => setTimeout(r, 50));
    const globalSizeFieldVisibleInSingle = !document.getElementById("globalSizeField").classList.contains("hidden");
    document.getElementById("historyBtn").click();
    await new Promise(r => setTimeout(r, 100));
    const projectCardsBeforeRestore = document.querySelectorAll(".history-project-card").length;
    document.querySelector(".history-project-card .history-actions .btn")?.click();
    await new Promise(r => setTimeout(r, 250));

    return {
      sortedFileNames,
      noEmptyRowBeforeUpload,
      globalSizeFieldHiddenInTurnaround,
      globalPromptFieldHiddenInTurnaround,
      skillsHiddenInTurnaround,
      globalSizeFieldVisibleInSingle,
      allRequestsHadExactlyOneImage: calls.every(c => c.imagesCount === 1),
      totalGenerationCalls: initialGenerationCalls,
      hardPromptApplied: calls.slice(0, initialGenerationCalls).every(c => c.prompt.includes("exactly three separate full-body views") && c.prompt.includes("pure blank white background") && c.prompt.includes("Do not include any text") && !c.prompt.includes("GLOBAL STYLE")),
      fixedWideSize: calls.slice(0, initialGenerationCalls).every(c => c.size === "1536x864"),
      historyLength: history.length,
      historyType: item.type,
      historyMode: item.mode,
      historyImageCount: (item.images || []).length,
      retryFiredExactlyOneMoreCall: calls.length === callsBeforeRetry + 1,
      projectCardsBeforeRestore,
      restoredActiveTabMode: document.querySelector(".mode-tab.active")?.dataset.mode,
      restoredRowCount: document.querySelectorAll(".turnaround-row").length,
      restoredTurnaroundTexts: [...document.querySelectorAll(".turnaround-prompt")].map(el => el.value).sort(),
    };
  })()`, true);

  assertQa(result.noEmptyRowBeforeUpload, "Switching into turnaround mode must not leave a stray auto-created empty row ahead of bulk-uploaded images.", result);
  assertQa(result.globalSizeFieldHiddenInTurnaround, "The global resolution picker must be hidden in turnaround mode because the workflow owns a fixed 16:9 output policy.", result);
  assertQa(result.globalPromptFieldHiddenInTurnaround && result.skillsHiddenInTurnaround, "Turnaround mode must hide the unrelated global prompt and skill controls.", result);
  assertQa(result.globalSizeFieldVisibleInSingle, "The global resolution picker must still be visible in single mode (only turnaround mode hides it).", result);
  assertQa(JSON.stringify(result.sortedFileNames) === JSON.stringify(["cap-1.png", "cap-2.png", "cap-10.png"]),
    "Bulk-adding images with out-of-order but numeric filenames should create rows sorted in natural filename order (1, 2, 10), not upload order or lexical string order.", result);
  assertQa(result.totalGenerationCalls === 3, "Bulk-generating 3 turnaround rows should fire exactly 3 separate generation requests, one per row.", result);
  assertQa(result.allRequestsHadExactlyOneImage, "Every turnaround-mode generation request must carry exactly one reference image — this is the entire point of the feature (avoiding the HTTP 413 from bundling many reference images into a single request).", result);
  assertQa(result.hardPromptApplied, "Every turnaround request must carry the strict three-view, white-background, no-text template and must ignore the normal global prompt.", result);
  assertQa(result.fixedWideSize, "Turnaround generation must request the fixed 16:9 output size rather than copying each source image's dimensions.", result);
  assertQa(result.historyLength === 1 && result.historyType === "turnaround-project" && result.historyMode === "turnaround",
    "Turnaround-mode results must be saved as a single combined 'turnaround-project' history entry, not three separate single-image records (a prior bug in saveGenerationProject() silently forced every project's type/mode back to comic regardless of what was passed in).", result);
  assertQa(result.historyImageCount === 3, "The saved turnaround project should contain all 3 generated images.", result);
  assertQa(result.retryFiredExactlyOneMoreCall, "Retrying a single turnaround result card should fire exactly one more generation call, not regenerate every row.", result);
  assertQa(result.projectCardsBeforeRestore >= 1, "The turnaround project should show up as a project card in the history list (isHistoryProject() must recognize mode: turnaround).", result);
  assertQa(result.restoredActiveTabMode === "turnaround", "Restoring a turnaround-project history entry should switch the app into turnaround mode, not comic mode.", result);
  assertQa(result.restoredRowCount === 3, "Restoring a turnaround-project history entry should repopulate all 3 rows.", result);
  assertQa(JSON.stringify(result.restoredTurnaroundTexts) === JSON.stringify(["target character 1", "target character 2", "target character 3"]),
    "Restoring a turnaround-project history entry should refill each row's own turnaround text (not the combined global+row prompt, not blank).", result);
}

async function testSkillsManagerAndPromptInjection(cdp) {
  logStep("Skills: sidebar defaults collapsed and expands on demand, built-in style defaults off, custom skills support CRUD/scope, single and comic selections stay independent, injection follows list order, and turnaround ignores skills");
  await loadFresh(cdp, "skills-manager");
  const initial = await cdp.eval(`(() => {
    localStorage.removeItem(SKILLS_STORAGE_KEY);
    skillState = defaultSkillState();
    saveSkillState();
    renderActiveSkills();

    const skillsSection = document.getElementById("activeSkillsSection");
    const defaultCollapsed = skillsSection.open === false;
    skillsSection.querySelector("summary").click();
    const expandedOnClick = skillsSection.open === true;
    const builtIn = skillState.skills.find(skill => skill.id === "builtin-anime-commercial-style");
    const defaultOff = skillState.enabled.single.length === 0 && skillState.enabled.comic.length === 0;
    const builtInVisible = !!document.querySelector('[data-skill-id="builtin-anime-commercial-style"]');

    document.querySelector('[data-skill-id="builtin-anime-commercial-style"]').click();
    const singlePrompt = getEffectivePrompt("single");
    const comicBefore = getEffectivePrompt("comic");

    openSkillsModal();
    document.getElementById("addSkill").click();
    document.getElementById("skillName").value = "Identity Lock";
    document.getElementById("skillCategory").value = "functional";
    document.getElementById("skillScope").value = "single";
    document.getElementById("skillTemplate").value = "KEEP_IDENTITY_EXACT";
    document.getElementById("skillEditor").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    const custom = skillState.skills.find(skill => skill.name === "Identity Lock");
    openSkillEditor(custom);
    document.getElementById("skillName").value = "Identity Lock Edited";
    document.getElementById("skillEditor").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const edited = skillState.skills.find(skill => skill.id === custom.id);

    switchMode("single");
    const customBox = document.querySelector('[data-skill-id="' + custom.id + '"]');
    customBox.click();
    const orderedPrompt = getEffectivePrompt("single");
    switchMode("comic");
    const customHiddenInComic = !document.querySelector('[data-skill-id="' + custom.id + '"]');
    const comicStillOff = skillState.enabled.comic.length === 0;
    const turnaroundUntouched = applyEnabledSkills("BASE", "turnaround") === "BASE";

    return {
      defaultCollapsed,
      expandedOnClick,
      defaultOff,
      builtInVisible,
      singleHasBuiltIn: singlePrompt.includes(builtIn.template),
      comicBefore,
      editedName: edited?.name,
      customHiddenInComic,
      comicStillOff,
      turnaroundUntouched,
      orderCorrect: orderedPrompt.indexOf(builtIn.template) < orderedPrompt.indexOf("KEEP_IDENTITY_EXACT"),
      persisted: JSON.parse(localStorage.getItem(SKILLS_STORAGE_KEY) || "null"),
    };
  })()`, true);

  assertQa(initial.defaultCollapsed && initial.expandedOnClick, "The sidebar skill section must start collapsed and expand when its summary is clicked.", initial);
  assertQa(initial.defaultOff && initial.builtInVisible, "The built-in style skill must exist and be unchecked on first use.", initial);
  assertQa(initial.singleHasBuiltIn && !initial.comicBefore.includes("KEEP_IDENTITY_EXACT"), "Checking a single-mode skill must inject it only into the single prompt.", initial);
  assertQa(initial.editedName === "Identity Lock Edited", "Custom skills must be editable through the manager.", initial);
  assertQa(initial.customHiddenInComic && initial.comicStillOff, "Single-only skills must stay out of comic mode, whose selection state is independent.", initial);
  assertQa(initial.turnaroundUntouched, "Turnaround prompts must bypass the skill system.", initial);
  assertQa(initial.orderCorrect, "Enabled templates must be injected in skill-list order.", initial);
  assertQa(initial.persisted?.enabled?.single?.length === 2, "Skill choices must be written to persistent storage.", initial);

  await loadFresh(cdp, "skills-persist-reload");
  const afterReload = await cdp.eval(`({
    defaultCollapsed: document.getElementById("activeSkillsSection").open === false,
    selectedSingle: skillState.enabled.single.length,
    selectedComic: skillState.enabled.comic.length,
    editedName: skillState.skills.find(skill => skill.template === "KEEP_IDENTITY_EXACT")?.name,
    singleChecked: document.querySelectorAll('#activeSkillsList input:checked').length,
  })`);
  assertQa(afterReload.defaultCollapsed, "A full startup must restore the sidebar skill section to its default collapsed state.", afterReload);
  assertQa(afterReload.selectedSingle === 2 && afterReload.selectedComic === 0 && afterReload.singleChecked === 2, "Single/comic skill selections must survive a full reload independently.", afterReload);
  assertQa(afterReload.editedName === "Identity Lock Edited", "Edited custom skill data must survive reload.", afterReload);

  await cdp.eval(`(() => {
    openSkillsModal();
    window.askConfirm = async () => true;
    const card = [...document.querySelectorAll(".skill-card")].find(item => item.textContent.includes("Identity Lock Edited"));
    card.querySelector(".delete-skill").click();
    return true;
  })()`);
  await sleep(60);
  const deletion = await cdp.eval(`({
      removed: !skillState.skills.some(skill => skill.template === "KEEP_IDENTITY_EXACT"),
      selectionRemoved: !skillState.enabled.single.some(id => id.includes("skill-")),
  })`);
  assertQa(deletion.removed && deletion.selectionRemoved, "Deleting a custom skill must remove both the definition and its saved selections.", deletion);
}

async function testOrderedBulkPromptInput(cdp) {
  logStep("Ordered bulk prompt input remains a comic-only workflow, preserves blank positions, and expands panel rows");
  await loadFresh(cdp, "ordered-bulk-prompts");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    document.querySelector('[data-mode="comic"]').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    document.getElementById("panelCount").value = "2";
    document.getElementById("createPanels").click();
    await new Promise(resolve => setTimeout(resolve, 60));
    document.getElementById("bulkInputPanelPrompts").click();
    const opened = !document.getElementById("bulkPromptModal").classList.contains("hidden");
    const bulkText = document.getElementById("bulkPromptText");
    bulkText.value = "shot one\\n\\nshot three\\nshot four\\n";
    bulkText.dispatchEvent(new Event("input", { bubbles: true }));
    const countBeforeApply = document.getElementById("bulkPromptCount").textContent;
    document.getElementById("applyBulkPrompts").click();
    await new Promise(resolve => setTimeout(resolve, 100));
    return {
      opened,
      countBeforeApply,
      prompts: [...document.querySelectorAll("#panelTbody textarea")].map(el => el.value),
      turnaroundHasOnlyClearAction: document.querySelectorAll("#turnaroundSection .section-actions button").length === 1,
    };
  })()`, true);
  assertQa(result.opened, "The comic bulk-prompt button should open its dialog.", result);
  assertQa(result.countBeforeApply.includes("4") && result.countBeforeApply.includes("2"), "The dialog should show live line and panel counts.", result);
  assertQa(JSON.stringify(result.prompts) === JSON.stringify(["shot one", "", "shot three", "shot four"]), "Comic bulk input should expand to four panels and preserve the internal blank line.", result);
  assertQa(result.turnaroundHasOnlyClearAction, "Turnaround mode should keep per-row guidance and expose no unrelated batch-prompt action.", result);
}

async function testComicBulkPromptOverwriteConfirmation(cdp) {
  logStep("Comic bulk prompts require confirmation before replacing existing prompts, blank lines clear matching panels, and later panels remain unchanged");
  await loadFresh(cdp, "comic-bulk-overwrite-confirmation");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const values = () => [...document.querySelectorAll("#panelTbody textarea")].map(input => input.value);
    const waitForAsk = async () => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 1500) {
        const dialog = document.querySelector(".ask-dialog-overlay");
        if (dialog) return dialog;
        await sleep(20);
      }
      return null;
    };

    document.querySelector('[data-mode="comic"]').click();
    await sleep(40);
    document.getElementById("panelCount").value = "4";
    document.getElementById("createPanels").click();
    await sleep(60);
    [...document.querySelectorAll("#panelTbody textarea")].forEach((input, index) => {
      input.value = "old-" + (index + 1);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    openBulkPromptDialog("comic");
    dom.bulkPromptText.value = "new-1\\n\\nnew-3";
    dom.bulkPromptText.dispatchEvent(new Event("input", { bubbles: true }));
    const declinedApply = applyBulkPromptLines();
    const firstDialog = await waitForAsk();
    const firstMessage = firstDialog?.querySelector(".ask-dialog-message")?.textContent || "";
    firstDialog?.querySelector(".ask-dialog-cancel")?.click();
    await declinedApply;
    const afterDecline = values();
    const modalStayedOpen = !dom.bulkPromptModal.classList.contains("hidden");

    const confirmedApply = applyBulkPromptLines();
    const secondDialog = await waitForAsk();
    secondDialog?.querySelector(".ask-dialog-ok")?.click();
    await confirmedApply;
    const afterConfirm = values();

    openBulkPromptDialog("comic");
    dom.bulkPromptText.value = "\\n\\n\\n\\n";
    dom.bulkPromptText.dispatchEvent(new Event("input", { bubbles: true }));
    const clearApply = applyBulkPromptLines();
    const clearDialog = await waitForAsk();
    clearDialog?.querySelector(".ask-dialog-ok")?.click();
    await clearApply;
    const afterBlankClear = values();

    return {
      firstAsked: Boolean(firstDialog),
      firstMessage,
      afterDecline,
      modalStayedOpen,
      secondAsked: Boolean(secondDialog),
      afterConfirm,
      clearAsked: Boolean(clearDialog),
      afterBlankClear,
    };
  })()`, true);

  assertQa(result.firstAsked && result.secondAsked, "Applying comic bulk prompts over existing text must ask for confirmation every time until accepted.", result);
  assertQa(result.firstMessage.includes("空行") || result.firstMessage.toLowerCase().includes("blank"), "The overwrite confirmation must explain that blank lines clear matching panels.", result);
  assertQa(JSON.stringify(result.afterDecline) === JSON.stringify(["old-1", "old-2", "old-3", "old-4"]), "Declining the overwrite confirmation must preserve every existing comic prompt.", result);
  assertQa(result.modalStayedOpen, "Declining overwrite must keep the bulk prompt dialog open so the user can review the input.", result);
  assertQa(JSON.stringify(result.afterConfirm) === JSON.stringify(["new-1", "", "new-3", "old-4"]), "Confirmed bulk input must overwrite matching rows, clear the blank-line row, and leave later rows unchanged.", result);
  assertQa(result.clearAsked && result.afterBlankClear.every(value => value === ""), "An explicitly all-blank batch must be accepted after confirmation and clear all matching comic prompts.", result);
}

async function testBulkPromptInputBeyondOneHundred(cdp) {
  logStep("Comic bulk prompts and turnaround image rows accept more than 100 items without an application hard limit");
  await loadFresh(cdp, "bulk-prompts-over-100");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const total = 105;
    const prompts = Array.from({ length: total }, (_, index) => "批量提示词 " + (index + 1));

    document.querySelector('[data-mode="comic"]').click();
    await sleep(40);
    openBulkPromptDialog("comic");
    dom.bulkPromptText.value = prompts.join("\\n");
    await applyBulkPromptLines();
    const comicRows = [...document.querySelectorAll("#panelTbody .panel-row")];
    const comic = {
      count: comicRows.length,
      inputCount: document.getElementById("panelCount").value,
      first: comicRows[0]?.querySelector("textarea")?.value || "",
      last: comicRows.at(-1)?.querySelector("textarea")?.value || "",
    };

    document.querySelector('[data-mode="turnaround"]').click();
    await sleep(40);
    dom.turnaroundTbody.innerHTML = "";
    turnaroundRowCounter = 0;
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    for (let index = 0; index < total; index++) {
      addTurnaroundRow({ dataUrl: png, fileName: "turnaround-" + String(index + 1).padStart(3, "0") + ".png" });
    }
    const turnaroundRows = [...document.querySelectorAll("#turnaroundTbody .turnaround-row")];
    const turnaround = {
      count: turnaroundRows.length,
      firstName: turnaroundRows[0]?.querySelector(".turnaround-img-thumb")?.title || "",
      lastName: turnaroundRows.at(-1)?.querySelector(".turnaround-img-thumb")?.title || "",
    };

    const files = Array.from({ length: total }, (_, index) => new File(
      [new Uint8Array([index % 255])],
      "turnaround-" + index + ".png",
      { type: "image/png" },
    ));
    let globalReferenceRejected = false;
    try { validateImageImport(files, 0); } catch { globalReferenceRejected = true; }
    const turnaroundImportCount = validateImageImport(files, 0, { maxFiles: Infinity }).length;
    return { total, comic, turnaround, globalReferenceRejected, turnaroundImportCount };
  })()`, true);

  assertQa(result.comic.count === result.total && result.comic.inputCount === String(result.total), "Comic bulk input must auto-create every panel beyond the former 100-panel cap.", result);
  assertQa(result.comic.first === "批量提示词 1" && result.comic.last === `批量提示词 ${result.total}`, "Comic bulk prompts must preserve ordering beyond 100 entries.", result);
  assertQa(result.turnaround.count === result.total && result.turnaround.firstName === "turnaround-001.png" && result.turnaround.lastName === "turnaround-105.png", "Turnaround task rows must scale beyond 100 imported images without truncation.", result);
  assertQa(result.turnaroundImportCount === result.total, "Turnaround image import must not retain the shared 100-reference hard limit.", result);
  assertQa(result.globalReferenceRejected, "Removing the turnaround limit must not allow an unlimited number of global references in a single generation request.", result);
}

async function testAndroidUpdateRedirect(cdp) {
  logStep("Android update check should redirect to GitHub release page, not install in-app");
  await cdp.send("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36",
  });
  try {
    await loadFresh(cdp, "android-update");
    const result = await cdp.eval(`(async () => {
      const originalOpen = window.open;
      const releaseHtmlUrl = "https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v9.9.9";
      const releaseJson = JSON.stringify({
        tag_name: "v9.9.9",
        html_url: releaseHtmlUrl,
        body: "## Test release",
        assets: [
          { name: "AI-Image-Generator-android.apk", browser_download_url: "https://example.test/android.apk" },
          { name: "AI-Image-Generator-Setup.exe", browser_download_url: "https://example.test/Setup.exe" }
        ]
      });
      const calls = [];
      let openedUrls = [];
      window.FlutterDownload = {
        postMessage(raw) {
          const payload = JSON.parse(raw);
          calls.push(payload);
          const result = payload.action === "nativeFetch"
            ? { status: 200, headers: { "content-type": "application/json" }, body: releaseJson }
            : { ok: true };
          setTimeout(() => window.AiGenAndroidBridge.resolve(payload.id, result), 0);
        }
      };
      window.open = (url) => { openedUrls.push(String(url)); return { closed: false }; };
      document.getElementById("settingsBtn").click();
      await new Promise(r => setTimeout(r, 80));
      document.getElementById("checkUpdates").click();
      const start = Date.now();
      while (Date.now() - start < 3000) {
        if (/9\\.9\\.9/.test(document.getElementById("latestVersionLabel")?.textContent || "")) break;
        await new Promise(r => setTimeout(r, 50));
      }
      const installResult = await window.AiGenUpdate.downloadLatestUpdate(true);
      const mobileActionLabel = document.getElementById("installUpdate")?.textContent.trim() || "";
      const previousNativePlatform = window.__AI_GEN_NATIVE_PLATFORM;
      window.__AI_GEN_NATIVE_PLATFORM = "ios";
      const markerPlatform = window.AiGenUpdate.getRuntimePlatform();
      window.__AI_GEN_NATIVE_PLATFORM = previousNativePlatform;
      window.open = originalOpen;
      return {
        platform: window.AiGenUpdate.getRuntimePlatform ? window.AiGenUpdate.getRuntimePlatform() : "unknown",
        installResult,
        openExternalCalls: calls.filter(c => c.action === "openExternal"),
        downloadUpdateCalls: calls.filter(c => c.action === "downloadUpdate"),
        openedUrls,
        status: document.getElementById("updateStatus")?.textContent || "",
        mobileActionLabel,
        markerPlatform,
      };
    })()`, true);
    assertQa(result.downloadUpdateCalls.length === 0, "Android should never invoke the native downloadUpdate/install bridge action.", result);
    assertQa(result.installResult?.opened === true && result.installResult?.url === "https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v9.9.9", "Android install click should resolve with the GitHub release page URL instead of downloading a package.", result);
    assertQa(result.openExternalCalls.length === 1 && result.openExternalCalls[0].url.includes("github.com/2786886095/Langbai-api-image-Studio/releases/tag/v9.9.9"), "Android should open the GitHub release page via the native openExternal bridge.", result);
    assertQa(/GitHub/.test(result.status), "Update status text should tell Android users to use the GitHub release page.", result);
    assertQa(/发布页|發布頁|release|リリース|릴리스/i.test(result.mobileActionLabel), "Mobile update action must say that it opens the release page, not promise an in-app install.", result);
    assertQa(result.markerPlatform === "ios", "The native platform marker must override a desktop-style user agent, as used by some iPads.", result);
  } finally {
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: "" });
  }
}

async function testWindowsInstallDirControl(cdp) {
  logStep("Windows-only 'install directory' override lets the user pick where an in-app update overwrites, instead of always trusting the auto-detected current install location");
  await loadFresh(cdp, "install-dir-hidden");
  const hiddenResult = await cdp.eval(`(() => {
    document.getElementById("settingsBtn").click();
    return {
      rowHidden: document.getElementById("installDirRow").classList.contains("hidden"),
      hintHidden: document.getElementById("installDirHint").classList.contains("hidden"),
    };
  })()`, true);
  assertQa(hiddenResult.rowHidden && hiddenResult.hintHidden, "Without a native Windows bridge (plain browser/PWA/Android), the install-directory row must stay hidden -- it has no meaning outside the packaged Windows exe.", hiddenResult);

  // installDirRow's visibility is computed once at boot (isNativeWindowsWebview()), mirroring how
  // the real WebView2 host injects the FlutterDownload bridge before the page's own script runs.
  // Defining window.FlutterDownload via a plain cdp.eval() AFTER loadFresh() would be too late (the
  // boot-time check would already have run against "no bridge yet"), so it has to go in via
  // Page.addScriptToEvaluateOnNewDocument, same technique testDragDropHintReflectsPlatform uses.
  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.__installDirCalls = [];
      window.__installDirOverrideActive = false;
      window.FlutterDownload = {
        postMessage(raw) {
          const payload = JSON.parse(raw);
          window.__installDirCalls.push(payload.action);
          const autoDir = "C:/Users/test/AppData/Local/AI Image Generator";
          const customDir = "F:/AI/picture/AI Image Generator";
          let result;
          if (payload.action === "getInstallDir") {
            result = { installDir: window.__installDirOverrideActive ? customDir : autoDir, isOverride: window.__installDirOverrideActive };
          } else if (payload.action === "chooseInstallDir") {
            window.__installDirOverrideActive = true;
            result = { installDir: customDir, isOverride: true };
          } else if (payload.action === "resetInstallDir") {
            window.__installDirOverrideActive = false;
            result = { installDir: autoDir, isOverride: false };
          } else {
            result = { ok: true };
          }
          setTimeout(() => window.AiGenAndroidBridge.resolve(payload.id, result), 0);
        }
      };
    `,
  });
  await cdp.send("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  try {
    await loadFresh(cdp, "install-dir-windows");
    const result = await cdp.eval(`(async () => {
      document.getElementById("settingsBtn").click();
      await new Promise(r => setTimeout(r, 150));
      const initialRowHidden = document.getElementById("installDirRow").classList.contains("hidden");
      const initialLabel = document.getElementById("settingsInstallDirLabel")?.textContent || "";
      const initialResetHidden = document.getElementById("settingsResetInstallDir")?.classList.contains("hidden");

      document.getElementById("settingsChooseInstallDir").click();
      let start = Date.now();
      while (Date.now() - start < 3000) {
        if ((document.getElementById("settingsInstallDirLabel")?.textContent || "").includes("F:")) break;
        await new Promise(r => setTimeout(r, 40));
      }
      const afterChooseLabel = document.getElementById("settingsInstallDirLabel")?.textContent || "";
      const afterChooseResetHidden = document.getElementById("settingsResetInstallDir")?.classList.contains("hidden");

      document.getElementById("settingsResetInstallDir").click();
      start = Date.now();
      while (Date.now() - start < 3000) {
        if ((document.getElementById("settingsInstallDirLabel")?.textContent || "").includes("AppData")) break;
        await new Promise(r => setTimeout(r, 40));
      }
      const afterResetLabel = document.getElementById("settingsInstallDirLabel")?.textContent || "";
      const afterResetResetHidden = document.getElementById("settingsResetInstallDir")?.classList.contains("hidden");

      return {
        initialRowHidden,
        initialLabel,
        initialResetHidden,
        afterChooseLabel,
        afterChooseResetHidden,
        afterResetLabel,
        afterResetResetHidden,
        actions: window.__installDirCalls.slice(),
      };
    })()`, true);

    assertQa(!result.initialRowHidden, "Inside a packaged Windows exe (native bridge present + Windows user agent), the install-directory row must be visible.", result);
    assertQa(result.initialLabel.includes("AppData"), "On first load, the label should show the auto-detected install directory (no manual override yet).", result);
    assertQa(result.initialResetHidden, "The 'reset to auto' button must stay hidden while there is no manual override.", result);
    assertQa(result.afterChooseLabel.includes("F:") && result.afterChooseLabel.includes("picture"), "Clicking 'choose directory' and picking a folder must update the label to the newly chosen path.", result);
    assertQa(!result.afterChooseResetHidden, "Once a manual override is set, the 'reset to auto' button must become visible.", result);
    assertQa(result.afterResetLabel.includes("AppData"), "Clicking 'reset to auto' must revert the label back to the auto-detected install directory.", result);
    assertQa(result.afterResetResetHidden, "After resetting, the 'reset to auto' button must hide again since there is no override anymore.", result);
    assertQa(result.actions.filter(a => a === "getInstallDir").length >= 3, "getInstallDir should be queried on load and again after each choose/reset action to refresh the displayed path.", result);
    assertQa(result.actions.includes("chooseInstallDir") && result.actions.includes("resetInstallDir") && result.actions.indexOf("chooseInstallDir") < result.actions.indexOf("resetInstallDir"), "chooseInstallDir must be invoked before resetInstallDir, matching the user's click order.", result);
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: "" });
  }
}

async function testDesktopProxyControls(cdp) {
  logStep("Desktop proxy settings and native payload propagation");
  await loadFresh(cdp, "desktop-proxy");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const calls = [];
    window.FlutterDownload = {
      postMessage(raw) {
        const payload = JSON.parse(raw);
        calls.push(payload);
        const body = payload.action === "nativeFetch"
          ? { status: 200, headers: { "content-type": "application/json" }, body: "{}" }
          : { path: "C:/Temp/update.zip", installerStarted: false };
        setTimeout(() => window.AiGenAndroidBridge.resolve(payload.id, body), 0);
      }
    };
    const nativeTimeouts = [];
    const originalNativeFetchPayload = nativeDownload.nativeFetchPayload;
    nativeDownload.nativeFetchPayload = (payload, timeoutMs, signal) => {
      nativeTimeouts.push({ url: payload.url, timeoutMs });
      return originalNativeFetchPayload(payload, timeoutMs, signal);
    };
    const waitForCall = async (count) => {
      const start = Date.now();
      while (Date.now() - start < 2000) {
        if (calls.length >= count) return;
        await new Promise(r => setTimeout(r, 20));
      }
      throw new Error("Timed out waiting for native bridge call");
    };
    const setMode = async (mode, custom = "") => {
      const modeEl = document.getElementById("desktopProxyMode");
      const customEl = document.getElementById("desktopProxyCustomUrl");
      modeEl.value = mode;
      modeEl.dispatchEvent(new Event("change", { bubbles: true }));
      customEl.value = custom;
      customEl.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(r => setTimeout(r, 30));
    };
    document.getElementById("settingsBtn").click();
    await new Promise(r => setTimeout(r, 80));

    document.getElementById("testDesktopProxy").click();
    await waitForCall(1);
    await setMode("socks10808");
    document.getElementById("testDesktopProxy").click();
    await waitForCall(2);
    await setMode("direct");
    document.getElementById("testDesktopProxy").click();
    await waitForCall(3);
    await setMode("custom", "http://127.0.0.1:7890");
    document.getElementById("testDesktopProxy").click();
    await waitForCall(4);
    await nativeDownload.downloadUpdate("https://example.test/Setup.exe", "Setup.exe", false, "windows");
    await waitForCall(5);
    await smartFetch("http://127.0.0.1:18081/healthz", { nativeTimeoutMs: 5000, forceDirectProxy: true });
    await waitForCall(6);
    await apiFetch("http://127.0.0.1:18081/v1/images/generations", "a".repeat(64), {
      model: "gpt-image-2", prompt: "test", size: "1024x1024", quality: "medium", dimension_mode: "exact_output", n: 1,
    }, { nativeTimeoutMs: 300000, forceDirectProxy: true });
    await waitForCall(7);

    const payload = window.AiGenProxy.withDesktopProxyPayload({ url: "https://example.test", method: "GET" });
    await setMode("custom", "127.0.0.1:7890");
    const beforeInvalid = calls.length;
    document.getElementById("testDesktopProxy").click();
    await new Promise(r => setTimeout(r, 120));

    return {
      modalOpen: !document.getElementById("settingsModal").classList.contains("hidden"),
      defaults: calls[0],
      socks: calls[1],
      direct: calls[2],
      custom: calls[3],
      updateDownload: calls[4],
      codexGatewayHealth: calls[5],
      codexGatewayGenerate: calls[6],
      nativeTimeouts,
      helperPayload: payload,
      invalidDidNotCall: calls.length === beforeInvalid,
      invalidStatus: document.getElementById("desktopProxyStatus").textContent,
      stored: JSON.parse(localStorage.getItem("ai_image_gen_settings") || "{}"),
      customDisabledAfterInvalid: document.getElementById("desktopProxyCustomUrl").disabled,
    };
  })()`, true);
  assertQa(result.modalOpen, "Settings modal should open before testing proxy controls.", result);
  assertQa(result.defaults.proxyMode === "http7890" && result.defaults.proxyUrl === "http://127.0.0.1:7890", "Default desktop proxy should be HTTP 127.0.0.1:7890.", result);
  assertQa(result.socks.proxyMode === "socks10808" && result.socks.proxyUrl === "socks5://127.0.0.1:10808", "SOCKS5 preset should be sent to native bridge.", result);
  assertQa(result.direct.proxyMode === "direct" && result.direct.proxyUrl === "", "Direct mode should be sent to native bridge.", result);
  assertQa(result.custom.proxyMode === "custom" && result.custom.proxyUrl === "http://127.0.0.1:7890", "Custom proxy URL should be sent to native bridge.", result);
  assertQa(result.updateDownload.action === "downloadUpdate" && result.updateDownload.proxyMode === "custom" && result.updateDownload.proxyUrl === "http://127.0.0.1:7890", "Update package downloads should use the desktop proxy payload too.", result);
  assertQa(result.codexGatewayHealth.action === "nativeFetch" && result.codexGatewayHealth.proxyMode === "direct" && result.codexGatewayHealth.proxyUrl === "" && result.nativeTimeouts.some(item => item.url.endsWith("/healthz") && item.timeoutMs === 5000), "Codex gateway health checks must bypass the configured desktop proxy and use a short native timeout.", result);
  assertQa(result.codexGatewayGenerate.action === "nativeFetch" && result.codexGatewayGenerate.proxyMode === "direct" && result.codexGatewayGenerate.proxyUrl === "" && result.nativeTimeouts.some(item => item.url.includes("/v1/images/generations") && item.timeoutMs === 300000), "Codex gateway image requests must bypass the desktop proxy and use the documented 300-second client timeout.", result);
  assertQa(result.helperPayload.proxyMode === "custom" && result.helperPayload.proxyUrl === "http://127.0.0.1:7890", "Proxy helper should append proxy fields to native payloads.", result);
  assertQa(result.invalidDidNotCall && /代理|proxy|URL/i.test(result.invalidStatus), "Invalid custom proxy should show an error and avoid native requests.", result);
  assertQa(result.stored.desktopProxyMode === "custom" && result.stored.desktopProxyCustomUrl === "127.0.0.1:7890", "Desktop proxy settings should persist globally.", result);
  assertQa(result.customDisabledAfterInvalid === false, "Custom proxy input should remain editable in custom mode.", result);
}

async function testOpenAiOfficialProviderOptionsAndIsolation(cdp) {
  logStep("OpenAI official provider sends only its supported gpt-image-2 fields and remains isolated from GrsAI");
  await loadFresh(cdp, "official-provider-current");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==";
    const originalFetch = window.fetch.bind(window);
    const requests = [];
    window.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("api.openai.com/v1/models")) {
        return new Response(JSON.stringify({ data: [{ id: "gpt-image-2" }, { id: "gpt-5" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.includes("api.openai.com/v1/images/generations")) {
        requests.push({ route: "generation", body: JSON.parse(options.body || "{}"), auth: options.headers?.Authorization || "" });
        return new Response(JSON.stringify({ data: [{ b64_json: tinyPng }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.includes("api.openai.com/v1/images/edits")) {
        const fields = {};
        for (const [key, value] of options.body.entries()) fields[key] = value instanceof Blob ? { type: value.type, size: value.size } : String(value);
        requests.push({ route: "edit", fields, auth: options.headers?.Authorization || "" });
        return new Response(JSON.stringify({ data: [{ b64_json: tinyPng }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(url, options);
    };
    applyApiProvider("official", { forceEndpoint: true });
    dom.apiKey.value = "sk-official-isolated";
    dom.model.value = "gpt-image-2";
    setProviderSegmentValue("officialQuality", "high");
    setProviderSegmentValue("officialOutputFormat", "webp");
    const snapshot = captureApiRequestSnapshot();
    dom.apiEndpoint.value = "https://changed.invalid/v1/images/generations";
    dom.apiKey.value = "sk-mutated-after-batch-start";
    dom.model.value = "changed-model";
    await callImageAPI("official generation", "1024x1024", 1, "official", { apiSnapshot: snapshot, references: [], maxRetries: 0 });
    const reference = { dataUrl: "data:image/png;base64," + tinyPng, fileName: "ref.png", width: 1, height: 1 };
    await callImageAPI("official edit", "1024x1024", 1, "official edit", { apiSnapshot: snapshot, references: [reference], maxRetries: 0 });
    const officialPanelVisible = !dom.officialProviderPanel.classList.contains("hidden");
    dom.apiProvider.value = "grsai";
    dom.apiProvider.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 50));
    const isolated = {
      provider: dom.apiProvider.value,
      endpoint: dom.apiEndpoint.value,
      key: dom.apiKey.value,
      officialHidden: dom.officialProviderPanel.classList.contains("hidden"),
      grsaiVisible: !dom.grsaiProviderPanel.classList.contains("hidden"),
    };
    window.fetch = originalFetch;
    return { requests, snapshot, officialPanelVisible, isolated };
  })()`, true);
  const generation = result.requests.find(item => item.route === "generation");
  const edit = result.requests.find(item => item.route === "edit");
  assertQa(generation?.auth === "Bearer sk-official-isolated" && generation.body.model === "gpt-image-2" && generation.body.quality === "high" && generation.body.output_format === "webp" && !("response_format" in generation.body), "A batch must use its frozen official endpoint/key/model/options snapshot and omit response_format even if live fields change mid-run.", result);
  assertQa(edit?.auth === "Bearer sk-official-isolated" && edit.fields.model === "gpt-image-2" && edit.fields.quality === "high" && edit.fields.output_format === "webp" && !("response_format" in edit.fields) && edit.fields["image[]"]?.size > 0, "Official gpt-image-2 edits must preserve the reference and omit response_format.", result);
  assertQa(result.officialPanelVisible && result.isolated.provider === "grsai" && result.isolated.endpoint.includes("grsai") && result.isolated.key === "" && result.isolated.officialHidden && result.isolated.grsaiVisible, "Switching to GrsAI must not carry the official key or panel options into its provider state.", result);
}

async function testOpenAiOfficialProviderResponsiveLayout(cdp) {
  logStep("Official provider controls remain inside the input panel on desktop and mobile");
  for (const viewport of [{ width: 1365, height: 768, mobile: false }, { width: 430, height: 760, mobile: true }]) {
    await loadFresh(cdp, `official-layout-${viewport.width}`, viewport);
    const layout = await cdp.eval(`(() => {
      applyApiProvider("official", { forceEndpoint: true });
      const panel = dom.officialProviderPanel.getBoundingClientRect();
      const input = document.querySelector(".input-panel").getBoundingClientRect();
      const overflow = [...dom.officialProviderPanel.querySelectorAll("button,input,select")].filter(element => element.scrollWidth > element.clientWidth + 2).length;
      return { panel: { left: panel.left, right: panel.right }, input: { left: input.left, right: input.right }, overflow, bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 };
    })()`, true);
    assertQa(layout.panel.left >= layout.input.left - 1 && layout.panel.right <= layout.input.right + 1 && layout.overflow === 0 && !layout.bodyOverflow, "Official provider controls must fit without horizontal overflow.", { viewport, layout });
  }
}

async function testOpenCodexDualModelsSizesAndLocalInpaint(cdp) {
  logStep("Dedicated Codex gateway keeps gpt-image-2 options bounded and local inpaint preserves unmasked pixels");
  await loadFresh(cdp, "codex-gateway-current-options");
  const result = await cdp.eval(`(() => {
    applyApiProvider(CODEX_IMAGE_GATEWAY_PROVIDER, { forceEndpoint: true });
    applyCodexGatewayOptions({ quality: "high", dimensionMode: "exact_output", clientQueue: 100 });
    const options = getCodexGatewayOptions();
    const request = codexImageGateway.buildImageRequest({
      prompt: "gateway edit",
      size: "832x1216",
      refs: [{ dataUrl: "data:image/png;base64,AA==" }],
      options,
    });
    const original = new ImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
    const patch = new ImageData(new Uint8ClampedArray(2 * 2 * 4), 2, 2);
    for (let i = 0; i < 16; i++) original.data.set([10, 20, 220, 255], i * 4);
    for (let i = 0; i < 4; i++) patch.data.set([240, 30, 20, 255], i * 4);
    const alpha = new Uint8ClampedArray(16); [5, 6, 9, 10].forEach(index => { alpha[index] = 255; });
    const output = compositeInpaintPixels(original, patch, alpha, { x: 1, y: 1, width: 2, height: 2 });
    const outside = Array.from({ length: 16 }, (_, index) => [5, 6, 9, 10].includes(index) || [0, 1, 2, 3].every(channel => output.data[index * 4 + channel] === original.data[index * 4 + channel])).every(Boolean);
    const inside = [5, 6, 9, 10].every(index => output.data[index * 4] === 240 && output.data[index * 4 + 2] === 20);
    return { provider: dom.apiProvider.value, endpoint: dom.apiEndpoint.value, model: dom.model.value, options, concurrency: getCodexGatewayConcurrency(options), request, outside, inside };
  })()`, true);
  assertQa(result.provider === "codexImageGateway" && result.endpoint === "http://127.0.0.1:18081/v1" && result.model === "gpt-image-2", "The dedicated gateway must lock its current provider, endpoint and model.", result);
  assertQa(result.concurrency === 100 && result.request.route === "images/edits" && result.request.body.images.length === 1 && result.request.body.n === 1, "Gateway queue concurrency must honor the user-selected 1-100 value while preserving the edit request contract.", result);
  assertQa(result.outside && result.inside, "Local inpaint compositing must alter only masked pixels.", result);
}

async function testCodexGatewayOptionsPersistAcrossRestart(cdp) {
  logStep("ChatGPT web image quality and dimension handling persist across profile restores");
  await loadFresh(cdp, "codex-gateway-options-persist-initial");
  const beforeRestart = await cdp.eval(`(async () => {
    localStorage.clear();
    const profile = normalizeApiConfig({
      id: "qa-codex-gateway-options",
      name: "QA ChatGPT Web",
      apiProvider: CODEX_IMAGE_GATEWAY_PROVIDER,
      endpoint: CODEX_IMAGE_GATEWAY_BASE_URL,
      model: CODEX_IMAGE_GATEWAY_MODEL,
      codexGatewayOptions: { quality: "medium", dimensionMode: "exact_output", clientQueue: 10 },
    });
    saveAllApis([profile]);
    saveActiveApiProfileId(profile.id);
    saveConfig(profile);
    await applyConfig(profile);
    document.querySelector('[data-provider-control="codexGatewayQuality"] button[data-value="low"]').click();
    document.querySelector('[data-provider-control="codexGatewayDimensionMode"] button[data-value="native"]').click();
    const active = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const saved = JSON.parse(localStorage.getItem(STORAGE_APIS) || "[]");
    const fallback = JSON.parse(localStorage.getItem(CODEX_GATEWAY_OPTIONS_STORAGE_KEY) || "{}");
    return { active, saved, fallback, ui: getCodexGatewayOptions() };
  })()`, true);
  assertQa(
    beforeRestart.ui.quality === "low"
      && beforeRestart.ui.dimensionMode === "native"
      && beforeRestart.ui.clientQueue === 10
      && beforeRestart.active.codexGatewayOptions?.quality === "low"
      && beforeRestart.active.codexGatewayOptions?.dimensionMode === "native"
      && beforeRestart.active.codexGatewayOptions?.clientQueue === 10
      && beforeRestart.saved[0]?.codexGatewayOptions?.quality === "low"
      && beforeRestart.saved[0]?.codexGatewayOptions?.dimensionMode === "native"
      && beforeRestart.saved[0]?.codexGatewayOptions?.clientQueue === 10
      && beforeRestart.fallback.quality === "low"
      && beforeRestart.fallback.dimensionMode === "native"
      && beforeRestart.fallback.clientQueue === 10,
    "Changing ChatGPT Web quality, dimension handling or concurrency must update the active profile, saved profile, and recovery preference before restart.",
    beforeRestart,
  );

  await loadFresh(cdp, "codex-gateway-options-persist-restart");
  const restored = await cdp.eval(`(() => ({
    provider: dom.apiProvider.value,
    selected: dom.savedApis.value,
    ui: getCodexGatewayOptions(),
    active: JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"),
    saved: JSON.parse(localStorage.getItem(STORAGE_APIS) || "[]"),
  }))()`, true);
  assertQa(
    restored.provider === "codexImageGateway"
      && restored.selected === "qa-codex-gateway-options"
      && restored.ui.quality === "low"
      && restored.ui.dimensionMode === "native"
      && restored.ui.clientQueue === 10
      && restored.active.codexGatewayOptions?.quality === "low"
      && restored.active.codexGatewayOptions?.dimensionMode === "native"
      && restored.active.codexGatewayOptions?.clientQueue === 10
      && restored.saved[0]?.codexGatewayOptions?.quality === "low"
      && restored.saved[0]?.codexGatewayOptions?.dimensionMode === "native"
      && restored.saved[0]?.codexGatewayOptions?.clientQueue === 10,
    "Restarting must restore the last selected ChatGPT Web output quality, dimension handling and concurrency.",
    restored,
  );

  const legacyProfile = await cdp.eval(`(() => {
    const legacy = {
      id: "qa-codex-gateway-legacy",
      name: "Legacy ChatGPT Web",
      apiProvider: CODEX_IMAGE_GATEWAY_PROVIDER,
      endpoint: CODEX_IMAGE_GATEWAY_BASE_URL,
      model: CODEX_IMAGE_GATEWAY_MODEL,
    };
    localStorage.setItem(STORAGE_APIS, JSON.stringify([legacy]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    localStorage.setItem(ACTIVE_API_PROFILE_KEY, legacy.id);
    localStorage.setItem(CODEX_GATEWAY_OPTIONS_STORAGE_KEY, JSON.stringify({ quality: "high", dimensionMode: "strict_native", clientQueue: 7 }));
    return legacy;
  })()`, true);
  await loadFresh(cdp, "codex-gateway-options-legacy-recovery");
  const legacyRestored = await cdp.eval(`(() => ({
    provider: dom.apiProvider.value,
    ui: getCodexGatewayOptions(),
    active: JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"),
  }))()`, true);
  assertQa(
    legacyRestored.provider === "codexImageGateway"
      && legacyRestored.ui.quality === "high"
      && legacyRestored.ui.dimensionMode === "strict_native"
      && legacyRestored.ui.clientQueue === 7,
    "An older ChatGPT Web profile without option fields must recover the last explicit quality, dimension handling and concurrency preference.",
    { legacyProfile, legacyRestored },
  );
  // Do not leak a selected local gateway profile into unrelated provider and
  // turnaround tests that follow in the shared browser process.
  await cdp.eval(`(() => { localStorage.clear(); return true; })()`, true);
  await loadFresh(cdp, "codex-gateway-options-persist-cleanup");
}

async function testGptImage2InpaintRoutes(cdp) {
  logStep("Local inpaint is enabled only for the two retained gpt-image-2 providers");
  await loadFresh(cdp, "gpt-image-2-inpaint-current-routes");
  const result = await cdp.eval(`(() => {
    const inspect = provider => {
      applyApiProvider(provider, { forceEndpoint: true });
      if (provider === "official") dom.model.value = "gpt-image-2";
      updateInpaintAvailability();
      return { provider: dom.apiProvider.value, disabled: dom.openInpaintFromFile.disabled, capability: getInpaintProviderMode() };
    };
    return {
      gateway: inspect(CODEX_IMAGE_GATEWAY_PROVIDER),
      official: inspect("official"),
      grsai: inspect("grsai"),
      custom: inspect("custom"),
    };
  })()`, true);
  assertQa(!result.gateway.disabled && /codex-gateway/.test(result.gateway.capability), "Codex gateway gpt-image-2 must expose local inpaint.", result);
  assertQa(!result.official.disabled && /official/.test(result.official.capability), "Official OpenAI gpt-image-2 must expose local inpaint.", result);
  assertQa(result.grsai.disabled && result.custom.disabled, "GrsAI and generic custom routes must not claim the dedicated mask workflow.", result);
}

async function testWorkspaceDraftSurvivesFullDocumentReload(cdp) {
  logStep("Workspace reload restores editor text only; result images remain in History until explicitly restored");
  await loadFresh(
    cdp,
    "workspace-draft-before-reload",
    { width: 1365, height: 768, mobile: false },
    { preserveWorkspaceDraft: true },
  );
  await cdp.eval(`(() => {
    localStorage.clear();
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const project = {
      id: "qa_workspace_project",
      type: "comic-project",
      mode: "comic",
      title: "Reload recovery project",
      createdAt: new Date().toISOString(),
      globalPrompt: "workspace global prompt",
      status: "partial",
      panels: [
        { panelId: "1", prompt: "workspace panel one", status: "success", size: "1024x1024" },
        { panelId: "2", prompt: "workspace panel two", status: "pending", size: "1024x1536", hadReferences: true },
      ],
      images: [
        { id: "qa_workspace_image", panelId: "1", prompt: "workspace panel one", imageUrl: png, size: "1024x1024" },
      ],
      imageUrl: png,
    };
    saveHistory([project]);
    switchMode("comic");
    dom.prompt.value = project.globalPrompt;
    dom.panelTbody.innerHTML = "";
    panelCounter = 0;
    project.panels.forEach(panel => {
      const row = addPanelRow(null, { syncCount: false });
      row.querySelector("textarea").value = panel.prompt;
      applyHistoryPanelSize(row, panel.size);
    });
    syncPanelCountInput();
    currentComicHistoryId = project.id;
    restoreHistoryItem(project);
    persistWorkspaceDraft();
    return JSON.parse(localStorage.getItem(WORKSPACE_DRAFT_KEY));
  })()`);

  await loadFresh(
    cdp,
    "workspace-draft-after-reload",
    { width: 1365, height: 768, mobile: false },
    { preserveWorkspaceDraft: true },
  );
  const result = await cdp.eval(`(() => ({
    mode: currentMode,
    prompt: dom.prompt.value,
    panelPrompts: collectPanels().map(panel => panel.prompt),
    resultCards: dom.resultGrid.querySelectorAll(".result-item").length,
    activeProjectId: currentComicHistoryId,
    failedCards: dom.resultGrid.querySelectorAll('[data-status="failed"]').length,
    appReady: window.__AI_GEN_APP_READY === true,
  }))()`);
  assertQa(
    result.appReady
      && result.mode === "comic"
      && result.prompt === "workspace global prompt"
      && result.panelPrompts.join("|") === "workspace panel one|workspace panel two"
      && result.resultCards === 0
      && result.failedCards === 0
      && !result.activeProjectId,
    "Reload recovery may restore editor text, but must not silently reopen project images or an active History project.",
    result,
  );
  await cdp.eval(`(() => {
    persistWorkspaceDraft();
    sessionStorage.removeItem(WORKSPACE_SESSION_MARKER_KEY);
    return true;
  })()`);
  await loadFresh(
    cdp,
    "workspace-draft-cold-session",
    { width: 1365, height: 768, mobile: false },
    { preserveWorkspaceDraft: true },
  );
  const coldStart = await cdp.eval(`(() => ({
    mode: currentMode,
    prompt: dom.prompt.value,
    resultCards: dom.resultGrid.querySelectorAll(".result-item").length,
    activeProjectId: currentComicHistoryId,
    historyProjectCount: loadHistory().filter(isHistoryProject).length,
    draftProjectId: safeStorageReadJson(WORKSPACE_DRAFT_KEY, {}, () => true)?.activeProjectId || "",
  }))()`);
  assertQa(
    coldStart.mode === "single"
      && coldStart.prompt === ""
      && coldStart.resultCards === 0
      && !coldStart.activeProjectId
      && coldStart.historyProjectCount === 1
      && coldStart.draftProjectId === "",
    "A new app session must not reopen previous project images, while the project remains available in History.",
    coldStart,
  );
  await cdp.eval(`(() => {
    localStorage.removeItem(WORKSPACE_DRAFT_KEY);
    saveHistory([]);
    return true;
  })()`);
}

async function testStorageFaultIsolationAndHistoryDbRecovery(cdp) {
  logStep("Storage write faults cannot stop startup, and a rejected history DB open can recover");
  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      if (!location.search.includes("storage-write-fault")) return;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "ai_image_gen_language" || key === "ai_image_gen_theme") {
          throw new DOMException("injected storage fault", "QuotaExceededError");
        }
        return original.call(this, key, value);
      };
    })();`,
  });
  try {
    await loadFresh(cdp, "storage-write-fault");
    const result = await cdp.eval(`(async () => {
      const themeBefore = document.documentElement.getAttribute("data-theme");
      dom.themeToggle.click();
      dom.languageMenuButton.click();
      dom.languageMenu.querySelector('[data-lang="en"]').click();
      await new Promise(resolve => setTimeout(resolve, 50));

      const originalOpen = indexedDB.open.bind(indexedDB);
      let injected = true;
      historyBlobDbPromise = null;
      indexedDB.open = (...args) => {
        if (injected) {
          injected = false;
          throw new DOMException("injected indexedDB open failure", "InvalidStateError");
        }
        return originalOpen(...args);
      };
      let firstRejected = false;
      try { await openHistoryBlobDb(); } catch { firstRejected = true; }
      const promiseReset = historyBlobDbPromise === null;
      const recoveredDb = await openHistoryBlobDb();
      indexedDB.open = originalOpen;
      return {
        ready: window.__AI_GEN_APP_READY === true,
        themeChanged: document.documentElement.getAttribute("data-theme") !== themeBefore,
        languageChanged: document.documentElement.lang === "en",
        settingsClickable: !dom.settingsBtn.disabled,
        firstRejected,
        promiseReset,
        recovered: !!recoveredDb,
      };
    })()`, true);
    assertQa(result.ready && result.themeChanged && result.languageChanged && result.settingsClickable, "Theme/language storage exceptions must not interrupt startup or UI controls.", result);
    assertQa(result.firstRejected && result.promiseReset && result.recovered, "openHistoryBlobDb must clear a rejected promise so a later open can recover.", result);
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
    await loadFresh(cdp, "storage-write-fault-clean");
  }
}

async function testInpaintModalInteractionSafety(cdp) {
  logStep("Inpaint modal owns wheel, focus, Escape and focus restoration");
  await loadFresh(cdp, "inpaint-modal-interaction-safety");
  const result = await cdp.eval(`(async () => {
    applyApiProvider(CODEX_IMAGE_GATEWAY_PROVIDER, { forceEndpoint: true });
    updateInpaintAvailability();
    dom.inpaintSourceInput.click = () => {};
    dom.configSection.open = true;
    const trigger = dom.openInpaintFromFile;
    trigger.focus();
    trigger.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const opened = !dom.inpaintModal.classList.contains("hidden");
    const bodyLocked = document.body.style.overflow === "hidden";
    dom.inputPanel.scrollTop = 140;
    let stableScrollReads = 0;
    let previousScrollTop = dom.inputPanel.scrollTop;
    for (let attempt = 0; attempt < 20 && stableScrollReads < 3; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      const currentScrollTop = dom.inputPanel.scrollTop;
      stableScrollReads = currentScrollTop === previousScrollTop ? stableScrollReads + 1 : 0;
      previousScrollTop = currentScrollTop;
    }
    dom.inputPanel.scrollTop = 140;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const mainBefore = dom.inputPanel.scrollTop;
    const wheelEvent = new WheelEvent("wheel", { deltaY: 500, bubbles: true, cancelable: true });
    const wheelCanceled = !dom.inpaintModal.dispatchEvent(wheelEvent) || wheelEvent.defaultPrevented;
    await new Promise(resolve => setTimeout(resolve, 50));
    const mainAfterWheel = dom.inputPanel.scrollTop;
    const focusable = getFocusableElements(dom.inpaintModal);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last?.focus();
    last?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    const trapped = document.activeElement === first;
    const returnTargetCaptured = dom.inpaintModal._returnFocus === trigger;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      opened,
      bodyLocked,
      wheelCanceled,
      mainBefore,
      mainAfterWheel,
      trapped,
      closed: dom.inpaintModal.classList.contains("hidden"),
      bodyUnlocked: document.body.style.overflow === "",
      focusReturned: document.activeElement === trigger,
      returnTargetCaptured,
      activeElementId: document.activeElement?.id || "",
      triggerConnected: trigger.isConnected,
      triggerDisabled: trigger.disabled,
    };
  })()`, true);
  assertQa(result.opened && result.bodyLocked && result.wheelCanceled && result.mainAfterWheel === result.mainBefore, "Opening inpaint must lock the page and wheel events must not scroll the main input panel.", result);
  assertQa(result.trapped, "Tab from the last inpaint control must wrap to the first control instead of escaping the modal.", result);
  assertQa(result.closed && result.bodyUnlocked && result.focusReturned, "Escape must close inpaint, release body scroll, and restore focus to the opener.", result);
}

async function testGrsaiOfficialAdapter(cdp) {
  logStep("GrsAI official generate/result adapter behavior");
  await loadFresh(cdp, "grsai-official");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const originalFetch = window.fetch.bind(window);
    const originalSleep = sleep;
    const calls = [];
    const genericCalls = [];
    const resultCalls = [];
    const submittedTasks = [];
    let asyncPolls = 0;
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const headerValue = headers => headers?.Authorization || headers?.authorization || "";
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    try {
      sleep = async () => {};
      set("apiProvider", "grsai");
      set("apiEndpoint", "https://grsai.dakka.com.cn/v1/api/generate");
      set("apiKey", "sk-grsai");
      set("proxyEndpoint", "");
      saveSettings({ grsaiSubmit504RetryCount: 2, grsaiSubmit504RetryInterval: 1 });
      loadGrsaiModels();
      const modelOptions = [...document.querySelectorAll("#modelChoices option")].filter(o => o.value).map(item => item.textContent.trim());

      window.fetch = async (url, opts = {}) => {
        const urlText = String(url);
        if (urlText.includes("/v1/api/generate")) {
          const body = JSON.parse(opts.body || "{}");
          calls.push({ url: urlText, body, auth: headerValue(opts.headers) });
          const promptAttempts = calls.filter(call => call.body.prompt === body.prompt).length;
          if (body.prompt === "submit504 prompt") {
            return new Response("<html><head><title>504 Gateway Time-out</title></head><body><h1>504 Gateway Time-out</h1></body></html>", {
              status: 504,
              headers: { "Content-Type": "text/html" }
            });
          }
          if (body.prompt === "submit504 recover prompt" && promptAttempts <= 2) {
            return new Response("<html><head><title>504 Gateway Time-out</title></head></html>", {
              status: 504,
              headers: { "Content-Type": "text/html" }
            });
          }
          if (body.prompt === "async prompt") {
            return new Response(JSON.stringify({ id: "task-ok", status: "running", progress: 10 }), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          }
          if (body.prompt === "poll400 prompt") {
            return new Response(JSON.stringify({ id: "task-400", status: "running", progress: 1 }), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            });
          }
          return new Response(JSON.stringify({ status: "succeeded", results: [{ url: "https://img.test/" + body.model + ".png" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (urlText.includes("/v1/images/generations")) {
          const body = JSON.parse(opts.body || "{}");
          genericCalls.push({ url: urlText, body, auth: headerValue(opts.headers) });
          return new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (urlText.includes("/v1/api/result")) {
          resultCalls.push({ url: urlText, auth: headerValue(opts.headers) });
          if (urlText.includes("task-400")) {
            return new Response(JSON.stringify({ id: "task-400", status: "failed", error: "quota exhausted" }), {
              status: 400,
              headers: { "Content-Type": "application/json" }
            });
          }
          asyncPolls++;
          const transientStatus = [429, 502, 503, 504][asyncPolls - 1];
          if (transientStatus) {
            return new Response(
              transientStatus === 504
                ? "<html><head><title>504 Gateway Time-out</title></head></html>"
                : JSON.stringify({ error: { message: "temporary poll failure" } }),
              {
                status: transientStatus,
                headers: { "Content-Type": transientStatus === 504 ? "text/html" : "application/json" }
              }
            );
          }
          const body = { id: "task-ok", status: "succeeded", progress: 100, results: [{ url: "https://img.test/final.png" }] };
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        return originalFetch(url, opts);
      };

      set("model", "nano-banana-2-4k-cl");
      const nano = await callImageAPI("nano prompt", "1024x1536", 1, "GrsAI nano", {
        references: [{ dataUrl: "data:image/png;base64," + png, fileName: "ref.png" }],
        maxRetries: 0
      });
      set("model", "gpt-image-2-vip");
      const gpt = await callImageAPI("gpt prompt", "2048x2048", 1, "GrsAI gpt", { maxRetries: 0 });
      set("model", "nano-banana-2");
      const asyncResult = await callImageAPI("async prompt", "1536x1024", 1, "GrsAI async", {
        maxRetries: 0,
        onTaskSubmitted: task => submittedTasks.push(task),
      });
      let recovered504Error = "";
      try {
        await callImageAPI("submit504 recover prompt", "1024x1024", 1, "GrsAI submit 504 recovery", { maxRetries: 3 });
      } catch (err) {
        recovered504Error = err.message || String(err);
      }
      let submit504Error = "";
      try {
        await callImageAPI("submit504 prompt", "1024x1024", 1, "GrsAI submit 504", { maxRetries: 3 });
      } catch (err) {
        submit504Error = err.message || String(err);
      }
      set("model", "nano-banana");
      let poll400Error = "";
      try {
        await callImageAPI("poll400 prompt", "1024x1024", 1, "GrsAI 400", { maxRetries: 0 });
      } catch (err) {
        poll400Error = err.message || String(err);
      }
      set("apiProvider", "custom");
      set("apiEndpoint", "https://grsai.dakka.com.cn/v1/images/generations");
      set("model", "gpt-image-2");
      const customGeneric = await callImageAPI("custom grsai domain prompt", "1024x1024", 1, "Custom GrsAI domain", { maxRetries: 0 });

      return {
        modelOptions,
        calls,
        genericCalls,
        resultCalls,
        submittedTasks,
        nanoUrl: nano?.data?.[0]?.url || "",
        gptUrl: gpt?.data?.[0]?.url || "",
        asyncUrl: asyncResult?.data?.[0]?.url || "",
        asyncPolls,
        recovered504Error,
        submit504Error,
        retrySettings: loadSettings(),
        poll400Error,
        customProvider: document.getElementById("apiProvider").value,
        customGenericOk: !!customGeneric?.data?.[0]?.b64_json,
        statusText: document.getElementById("status")?.textContent || "",
      };
    } finally {
      window.fetch = originalFetch;
      sleep = originalSleep;
    }
  })()`, true);
  const nanoCall = result.calls.find(call => call.body.prompt === "nano prompt");
  const gptCall = result.calls.find(call => call.body.prompt === "gpt prompt");
  const asyncCall = result.calls.find(call => call.body.prompt === "async prompt");
  const asyncResultCalls = result.resultCalls.filter(call => call.url.includes("id=task-ok"));
  assertQa(result.modelOptions.some(text => text.includes("nano-banana-2-2k-cl")) && result.modelOptions.some(text => text.includes("gpt-image-2-vip")), "GrsAI model picker should expose the official model set.", result);
  assertQa(nanoCall?.url === "https://grsai.dakka.com.cn/v1/api/generate", "GrsAI should normalize the configured endpoint to /v1/api/generate.", result);
  assertQa(nanoCall?.auth === "Bearer sk-grsai", "GrsAI requests should send Bearer authorization.", result);
  assertQa(nanoCall?.body.aspectRatio === "2:3" && nanoCall?.body.imageSize === "4K", "GrsAI nano-banana payload should map pixel size to official aspectRatio/imageSize.", result);
  assertQa(Array.isArray(nanoCall?.body.images) && nanoCall.body.images[0] && !/^data:/i.test(nanoCall.body.images[0]), "GrsAI reference images should be sent as base64/URL values, not data URLs.", result);
  assertQa(gptCall?.body.aspectRatio === "2048x2048" && !("imageSize" in gptCall.body), "GrsAI gpt-image payload should send pixel aspectRatio and omit nano imageSize.", result);
  assertQa(result.nanoUrl.includes("nano-banana-2-4k-cl") && result.gptUrl.includes("gpt-image-2-vip"), "GrsAI synchronous success responses should return image URLs.", result);
  assertQa(asyncCall && result.asyncUrl === "https://img.test/final.png" && result.submittedTasks.some(task => task.id === "task-ok") && asyncResultCalls.length === 5 && asyncResultCalls.every(call => call.url.includes("/v1/api/result?id=task-ok")), "GrsAI must checkpoint the task id immediately and keep every poll on that same id.", result);
  assertQa(result.asyncPolls === 5 && result.calls.filter(call => call.body.prompt === "async prompt").length === 1, "GrsAI poll 429/502/503/504 errors must back off on the same task without another submit POST.", result);
  assertQa(result.calls.filter(call => call.body.prompt === "submit504 recover prompt").length === 1 && /HTTP 504/.test(result.recovered504Error), "A GrsAI submit HTTP 504 has an unknown outcome and must stop after the original POST even if a later duplicate might succeed.", result);
  assertQa(/HTTP 504/.test(result.submit504Error), "A GrsAI submit 504 must preserve the timeout reason and leave a manual recovery path.", result);
  assertQa(result.calls.filter(call => call.body.prompt === "submit504 prompt").length === 1, "A GrsAI submit 504 must never duplicate the original POST automatically.", result);
  assertQa(result.retrySettings.grsaiSubmit504RetryCount === 2 && result.retrySettings.grsaiSubmit504RetryInterval === 1, "GrsAI submit 504 retry count and interval must persist independently from the generic HTTP-400 retry count.", result);
  assertQa(/HTTP 400/.test(result.poll400Error) && /quota exhausted/.test(result.poll400Error), "GrsAI polling HTTP 400 should preserve the official error reason.", result);
  assertQa(result.customProvider === "custom" && result.customGenericOk, "Custom API selection should remain custom even on a GrsAI domain.", result);
  assertQa(result.genericCalls.length === 1 && result.genericCalls[0].url.includes("/v1/images/generations"), "Custom API selection should use the generic OpenAI-compatible route, not the GrsAI /v1/api/generate route.", result);
}

async function testNativeDownloadTimeoutOptOut(cdp) {
  logStep("Generation native calls have no arbitrary timeout, bounded calls still time out, and abort sends a real native cancellation message");
  await loadFresh(cdp, "native-timeout-optout");
  const result = await cdp.eval(`(async () => {
    let capturedId = null;
    const bridgeCalls = [];
    window.FlutterDownload = {
      postMessage(raw) {
        const payload = JSON.parse(raw);
        bridgeCalls.push(payload);
        if (payload.action === "nativeFetch") capturedId = payload.id;
        // Deliberately never resolve/reject here -- simulates a native call that's still
        // legitimately in flight (or, in the pathological case, one that's truly stuck).
      }
    };

    // Case 1: timeoutMs === null must never settle on its own, no matter how long we wait.
    const unlimitedPromise = nativeDownload.nativeFetchPayload({ url: "http://test/unlimited", method: "GET", headers: {}, body: "" }, null);
    let unlimitedSettled = false;
    unlimitedPromise.then(() => { unlimitedSettled = true; }, () => { unlimitedSettled = true; });
    await new Promise(r => setTimeout(r, 400));
    const stillPendingAfterWait = !unlimitedSettled;

    // It must still resolve normally once a real response actually arrives.
    window.AiGenAndroidBridge.resolve(capturedId, { status: 200, headers: {}, body: "ok" });
    const resolved = await unlimitedPromise;
    await new Promise(r => setTimeout(r, 20));

    // Case 2: an ordinary bounded timeout (chooseDir, saveFile, etc. all still pass a real
    // number) must keep firing as before -- the null-check must not disable timeouts globally.
    let boundedError = null;
    try {
      await nativeDownload.nativeFetchPayload({ url: "http://test/bounded", method: "GET", headers: {}, body: "" }, 60);
    } catch (err) {
      boundedError = err.message;
    }

    // smartFetch itself must keep ordinary native HTTP calls bounded. Generation calls
    // explicitly pass null and remain unlimited.
    let smartFetchBoundedError = null;
    try {
      await smartFetch("http://test/smart-bounded", { nativeTimeoutMs: 60 });
    } catch (err) {
      smartFetchBoundedError = err.message;
    }
    const originalNativeFetchPayload = nativeDownload.nativeFetchPayload;
    let generationTimeout = "not-called";
    nativeDownload.nativeFetchPayload = async (_payload, timeoutMs) => {
      generationTimeout = timeoutMs;
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: [{ b64_json: "ok" }] }),
      };
    };
    await apiFetch("http://test/generation", "sk-test", { prompt: "test" }, { nativeTimeoutMs: null });
    nativeDownload.nativeFetchPayload = originalNativeFetchPayload;

    // Case 3: a real user report -- "点了取消重试没有反应" (clicking the per-card stop-retry
    // button did nothing). Root cause: nativeFetchPayload() never accepted an AbortSignal at
    // all, so when a native call is unlimited (timeoutMs=null) and genuinely in flight, there
    // was NO way to make the JS side stop waiting -- clicking "stop" looked like it did nothing
    // for however long the (now-unbounded) native call happened to take. Aborting the signal
    // must reject immediately, without waiting for the native side to ever respond.
    const ctrl = new AbortController();
    const abortablePromise = nativeDownload.nativeFetchPayload({ url: "http://test/abortable", method: "GET", headers: {}, body: "" }, null, ctrl.signal);
    let abortableSettled = false;
    let abortableError = null;
    abortablePromise.then(() => { abortableSettled = true; }, err => { abortableSettled = true; abortableError = err; });
    await new Promise(r => setTimeout(r, 100));
    const stillPendingBeforeAbort = !abortableSettled;
    ctrl.abort();
    await new Promise(r => setTimeout(r, 20));

    return {
      stillPendingAfterWait, unlimitedSettled, resolvedStatus: resolved?.status, boundedError,
      smartFetchBoundedError, generationTimeout,
      stillPendingBeforeAbort, abortableSettledAfterAbort: abortableSettled, abortableErrorName: abortableError?.name,
      cancelCalls: bridgeCalls.filter(call => call.action === "cancelNativeFetch"),
    };
  })()`, true);

  assertQa(result.stillPendingAfterWait, "A native call with timeoutMs=null must not settle on its own after waiting -- passing null has to skip registering the setTimeout entirely (setTimeout(fn, Infinity) can't be used instead: the delay is coerced to a 32-bit signed int, so a too-large/Infinity delay overflows and most engines, including V8, fire it almost immediately -- the opposite of \"unlimited\").", result);
  assertQa(result.unlimitedSettled && result.resolvedStatus === 200, "A timeoutMs=null call must still resolve normally once the native side actually responds.", result);
  assertQa(result.boundedError && /原生功能调用超时/.test(result.boundedError), "Callers that still pass a real timeoutMs (chooseDir, saveFile, the default 120s, ...) must keep timing out as before -- the null-check added for generation calls must not accidentally disable timeouts for everyone else.", result);
  assertQa(result.smartFetchBoundedError && /原生功能调用超时/.test(result.smartFetchBoundedError), "smartFetch must keep ordinary native HTTP calls bounded instead of leaving update checks and reloads pending forever.", result);
  assertQa(result.generationTimeout === null, "Image-generation API calls must explicitly opt out of the ordinary request timeout.", result);
  assertQa(result.stillPendingBeforeAbort, "Before aborting, a native call with a signal but no response yet must still be genuinely pending (sanity check that the test itself isn't racing).", result);
  assertQa(result.abortableSettledAfterAbort && result.abortableErrorName === "AbortError", "Aborting the signal passed to nativeFetchPayload() must immediately reject the call with an AbortError, even though the native side never actually responded -- this is what lets the per-card 'stop retry' / 'cancel generation' buttons do something instead of silently waiting for a native call that (now that generation has no timeout) might never come back on its own.", result);
  assertQa(result.cancelCalls.length >= 2 && result.cancelCalls.every(call => /^req_/.test(call.targetId || "")), "Timeout and AbortSignal paths must tell the native layer which in-flight request id to close, not only reject the JavaScript promise.", result);
}

async function testSavePathsTextMenuAndWindowsZipChunks(cdp) {
  logStep("Save path modes, prompt context menu, ZIP name uniqueness, and Windows chunked ZIP bridge");
  await loadFresh(cdp, "save-paths-text-menu-zip-chunks");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    window.__AI_GEN_NATIVE_PLATFORM = "windows";
    const calls = [];
    const chunks = [];
    let clipboardText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async value => { clipboardText = String(value); },
        readText: async () => clipboardText,
      },
    });
    window.FlutterDownload = {
      postMessage(raw) {
        const payload = JSON.parse(raw);
        calls.push(payload);
        if (payload.action === "chooseDir") {
          const next = { ...nativeDownload.dirs, [payload.kind]: "C:/QA/" + payload.kind };
          window.AiGenAndroidBridge.setDirs(next);
        }
        if (payload.action === "saveFileChunk") chunks.push(payload.chunk);
        const response = payload.action === "saveFileCommit"
          ? "C:/QA/zips/result.zip"
          : payload.action === "saveFile"
            ? "C:/QA/images/panel.png"
            : true;
        setTimeout(() => window.AiGenAndroidBridge.resolve(payload.id, response), 0);
      }
    };

    saveSettings({ imageAskEveryTime: true, zipAskEveryTime: true });
    await saveOrDownloadBlob(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "panel.png", "image/png", "images");
    const zipBytes = new Uint8Array(420000);
    for (let i = 0; i < zipBytes.length; i++) zipBytes[i] = i % 251;
    await saveOrDownloadBlob(new Blob([zipBytes], { type: "application/zip" }), "project.zip", "application/zip", "zips");

    const prompt = document.getElementById("prompt");
    prompt.value = "alpha beta";
    prompt.setSelectionRange(0, 5);
    prompt.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: innerWidth + 100, clientY: innerHeight + 100 }));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const menuRect = document.getElementById("textContextMenu").getBoundingClientRect();
    document.querySelector('[data-text-action="copy"]').click();
    await new Promise(r => setTimeout(r, 20));
    prompt.setSelectionRange(6, 10);
    prompt.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }));
    clipboardText = "GAMMA";
    document.querySelector('[data-text-action="paste"]').click();
    await new Promise(r => setTimeout(r, 20));

    const used = new Set(["images/panel.png", "images/panel（1）.png", "images/panel（2）.png"]);
    const uniqueArchiveName = makeUniqueArchiveName("images/panel.png", used);
    const reconstructed = chunks.join("");
    return {
      chooseKinds: calls.filter(call => call.action === "chooseDir").map(call => call.kind),
      actions: calls.map(call => call.action),
      chunkCount: chunks.length,
      maxChunk: Math.max(0, ...chunks.map(chunk => chunk.length)),
      reconstructedBytes: atob(reconstructed).length,
      promptValue: prompt.value,
      copied: clipboardText,
      menuInsideViewport: menuRect.right <= innerWidth && menuRect.bottom <= innerHeight && menuRect.left >= 0 && menuRect.top >= 0,
      settings: loadSettings(),
      uniqueArchiveName,
    };
  })()`, true);

  assertQa(result.chooseKinds.filter(kind => kind === "images").length === 1 && result.chooseKinds.filter(kind => kind === "zips").length === 1, "Image and ZIP ask-every-time modes must independently request their directory once per save operation.", result);
  assertQa(
    result.actions.includes("saveFileBegin")
      && result.actions.includes("saveFileChunk")
      && result.actions.includes("saveFileCommit")
      && result.actions.filter(action => action === "saveFile").length === 1,
    "Windows ZIP files must use begin/chunk/commit while the preceding small image remains the only one-message saveFile call.",
    result,
  );
  assertQa(result.chunkCount >= 2 && result.maxChunk <= 256 * 1024 && result.reconstructedBytes === 420000, "Chunked ZIP transport must preserve every byte and keep bridge messages bounded.", result);
  assertQa(result.promptValue === "alpha GAMMA" && result.menuInsideViewport, "Prompt right-click paste must edit the target and keep the menu inside the viewport.", result);
  assertQa(result.settings.imageAskEveryTime === true && result.settings.zipAskEveryTime === true, "Image and ZIP path modes must persist independently.", result);
  assertQa(result.uniqueArchiveName === "images/panel（3）.png", "ZIP entry collisions must keep incrementing beyond （1） and （2）.", result);
}

async function testNativeSecureApiKeyMigration(cdp) {
  logStep("Native shells migrate API keys into system secure storage and redact localStorage without losing the active key");
  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      localStorage.setItem("ai_image_gen_config", JSON.stringify({
        id: "secure_grsai", name: "Secure GrsAI", apiProvider: "grsai",
        endpoint: "https://grsai.dakka.com.cn/v1/api/generate", apiKey: "sk-grsai-secure", model: "gpt-image-2-vip"
      }));
      localStorage.setItem("ai_image_gen_apis", JSON.stringify([
        {
          id: "secure_grsai", name: "Secure GrsAI", apiProvider: "grsai",
          endpoint: "https://grsai.dakka.com.cn/v1/api/generate", apiKey: "sk-grsai-secure", model: "gpt-image-2-vip"
        },
        {
          id: "secure_official", name: "Secure Official", apiProvider: "official",
          endpoint: "https://api.openai.com/v1/images/generations", apiKey: "sk-official-secure", model: "gpt-image-2",
          officialImageOptions: { quality: "high", background: "opaque", outputFormat: "webp", outputCompression: 80, moderation: "auto", inputFidelity: "high" }
        }
      ]));
      window.__AI_GEN_SECURE_STORAGE = true;
      window.__AI_GEN_NATIVE_PLATFORM = "windows";
      window.__secureSecrets = {};
      window.__secureCalls = [];
      window.__secureInFlight = 0;
      window.__secureMaxInFlight = 0;
      window.FlutterDownload = {
        postMessage(raw) {
          const payload = JSON.parse(raw);
          window.__secureCalls.push(payload);
          const isSecret = /^(?:save|load|delete)Secret$/.test(payload.action);
          if (isSecret) {
            window.__secureInFlight++;
            window.__secureMaxInFlight = Math.max(window.__secureMaxInFlight, window.__secureInFlight);
          }
          setTimeout(() => {
            let result = true;
            if (payload.action === "saveSecret") window.__secureSecrets[payload.key] = payload.value;
            if (payload.action === "loadSecret") result = window.__secureSecrets[payload.key] || "";
            if (payload.action === "deleteSecret") delete window.__secureSecrets[payload.key];
            if (isSecret) window.__secureInFlight--;
            window.AiGenAndroidBridge?.resolve(payload.id, result);
          }, isSecret ? 20 : 0);
        }
      };
    `,
  });
  try {
    await loadFresh(cdp, "secure-api-key");
    const result = await cdp.eval(`(async () => {
      const start = Date.now();
      while (Date.now() - start < 3000) {
        const current = JSON.parse(localStorage.getItem("ai_image_gen_config") || "{}");
        const saved = JSON.parse(localStorage.getItem("ai_image_gen_apis") || "[]");
        if (current.hasSecureKey && !current.apiKey && saved.length === 2 && saved.every(item => item.hasSecureKey && !item.apiKey)) break;
        await new Promise(r => setTimeout(r, 30));
      }
      const current = JSON.parse(localStorage.getItem("ai_image_gen_config") || "{}");
      const saved = JSON.parse(localStorage.getItem("ai_image_gen_apis") || "[]");
      const inputBeforeReload = document.getElementById("apiKey").value;
      document.getElementById("apiKey").value = "";
      applyConfig(current);
      await new Promise(r => setTimeout(r, 120));
      const inputAfterReload = document.getElementById("apiKey").value;
      const officialIndex = saved.findIndex(item => item.id === "secure_official");
      document.getElementById("savedApis").value = saved[officialIndex]?.id || "";
      document.getElementById("savedApis").dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      const officialAfterSwitch = {
        key: document.getElementById("apiKey").value,
        provider: document.getElementById("apiProvider").value,
        model: document.getElementById("model").value,
        quality: getOfficialImageOptions().quality,
        outputFormat: getOfficialImageOptions().outputFormat,
      };
      const grsaiIndex = saved.findIndex(item => item.id === "secure_grsai");
      document.getElementById("savedApis").value = saved[grsaiIndex]?.id || "";
      document.getElementById("savedApis").dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      const saveCountBeforeReadyReplay = window.__secureCalls.filter(call => call.action === "saveSecret").length;
      window.dispatchEvent(new Event("aigen-native-ready"));
      window.dispatchEvent(new Event("aigen-native-ready"));
      await new Promise(r => setTimeout(r, 100));
      return {
        current,
        saved,
        inputBeforeReload,
        inputAfterReload,
        officialAfterSwitch,
        grsaiAfterSwitch: {
          key: document.getElementById("apiKey").value,
          provider: document.getElementById("apiProvider").value,
          model: document.getElementById("model").value,
        },
        secrets: window.__secureSecrets,
        maxSecretInFlight: window.__secureMaxInFlight,
        saveCountBeforeReadyReplay,
        saveCountAfterReadyReplay: window.__secureCalls.filter(call => call.action === "saveSecret").length,
        saveCalls: window.__secureCalls.filter(call => call.action === "saveSecret"),
        loadCalls: window.__secureCalls.filter(call => call.action === "loadSecret"),
      };
    })()`, true);
    assertQa(result.current.hasSecureKey === true && result.current.apiKey === "", "The active native config must be redacted after secure storage succeeds.", result);
    assertQa(result.saved.length === 2 && result.saved.every(item => item.hasSecureKey === true && item.apiKey === ""), "Every saved API profile must be redacted independently.", result);
    assertQa(result.inputBeforeReload === "sk-grsai-secure" && result.inputAfterReload === "sk-grsai-secure", "Migration and secure reload must not lose the active GrsAI key.", result);
    assertQa(result.officialAfterSwitch.key === "sk-official-secure" && result.officialAfterSwitch.provider === "official" && result.officialAfterSwitch.model === "gpt-image-2" && result.officialAfterSwitch.quality === "high" && result.officialAfterSwitch.outputFormat === "webp", "Switching to the saved official profile must load its own secure key and complete official option snapshot.", result);
    assertQa(result.grsaiAfterSwitch.key === "sk-grsai-secure" && result.grsaiAfterSwitch.provider === "grsai" && result.grsaiAfterSwitch.model === "gpt-image-2-vip", "Switching back to GrsAI must restore the GrsAI key instead of reusing the official key.", result);
    assertQa(result.secrets["api_key:secure_grsai"] === "sk-grsai-secure" && result.secrets["api_key:secure_official"] === "sk-official-secure", "The native secure store must use distinct per-profile key names and values.", result);
    assertQa(result.maxSecretInFlight === 1, "All secure-storage reads, writes, and deletes must be globally serialized because the Windows plugin rewrites the entire encrypted map.", result);
    assertQa(result.saveCountAfterReadyReplay === result.saveCountBeforeReadyReplay, "Repeated native-ready events must not rerun API key migration or overwrite a newer secure value.", result);
    assertQa(result.saveCalls.length >= 1 && result.loadCalls.length >= 1, "Migration must write and later read the OS secure-storage bridge.", result);
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
  }
}

async function testPwaOfflineCache(cdp) {
  logStep("PWA cache boots the versioned app.js/style.css URLs while fully offline");
  // The rest of the suite deliberately bypasses service workers and disables the
  // browser cache. Turn both controls back on for this real offline boot test.
  await cdp.send("Network.setBypassServiceWorker", { bypass: false });
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  try {
    await loadFresh(cdp, "pwa-offline-warmup");
    const supported = await cdp.eval(`"serviceWorker" in navigator`);
    assertQa(supported, "The PWA test requires Service Worker support on localhost.");
    await cdp.eval(`navigator.serviceWorker.ready.then(() => true)`, true);

    // A newly installed worker controls the next navigation. Wait for that
    // navigation instead of reading the previous document immediately.
    await cdp.send("Page.reload", { ignoreCache: false });
    await sleep(250);
    let controlledOnline = false;
    for (let i = 0; i < 80; i++) {
      controlledOnline = await cdp.eval(`document.readyState === "complete"
        && !!document.getElementById("generateBtn")
        && !!navigator.serviceWorker?.controller`).catch(() => false);
      if (controlledOnline) break;
      await sleep(100);
    }
    assertQa(controlledOnline, "The installed Service Worker must control the online warm-up navigation.");

    await cdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: "none",
    });
    await cdp.send("Page.reload", { ignoreCache: false });
    await sleep(250);
    let result = null;
    for (let i = 0; i < 80; i++) {
      result = await cdp.eval(`(() => ({
        title: document.querySelector(".header h1")?.textContent || "",
        version: window.AiGenUpdate?.APP_VERSION || "",
        hasGenerateButton: !!document.getElementById("generateBtn"),
        controlled: !!navigator.serviceWorker?.controller,
      }))()`).catch(() => null);
      if (result?.version && result.hasGenerateButton && result.controlled) break;
      await sleep(100);
    }
    assertQa(result?.version === expectedAppVersion && result.hasGenerateButton && result.controlled, "The PWA must load its versioned scripts and UI from cache while offline.", result);
  } finally {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: "wifi",
    });
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  }
}


async function testRetainedProviderProfilesAndGatewayMigration(cdp) {
  logStep("Official OpenAI, GrsAI, Custom API and the Codex gateway keep isolated provider profiles");
  await loadFresh(cdp, "retained-provider-profiles");
  const result = await cdp.eval(`(() => {
    localStorage.clear();
    const profiles = [
      normalizeApiConfig({ id: "official-profile", name: "Official", apiProvider: "official", endpoint: "https://api.openai.com/v1/images/generations", apiKey: "sk-official-only", model: "gpt-image-2", officialImageOptions: { quality: "high", outputFormat: "png" } }),
      normalizeApiConfig({ id: "grsai-profile", name: "GrsAI", apiProvider: "grsai", endpoint: "https://grsai.dakka.com.cn/v1/api/generate", apiKey: "sk-grsai-only", model: "gpt-image-2" }),
      normalizeApiConfig({ id: "custom-profile", name: "Custom", apiProvider: "custom", endpoint: "https://custom.example.test/v1/images/generations", apiKey: "sk-custom-only", model: "custom-image-model" }),
    ];
    saveAllApis(profiles);
    const stored = loadAllApis();
    const applied = stored.map(profile => {
      applyConfig(profile);
      return {
        id: profile.id,
        provider: dom.apiProvider.value,
        endpoint: dom.apiEndpoint.value,
        apiKey: dom.apiKey.value,
        model: dom.model.value,
      };
    });
    const legacy = normalizeApiConfig({
      id: "legacy-local",
      apiProvider: "opencodex",
      endpoint: "http://127.0.0.1:10100/v1/images/generations",
      apiKey: "opencodex-local-only",
      model: "gpt-image-2",
    });
    applyConfig(legacy);
    const gatewayProfile = currentApiConfig("Gateway");
    const gatewayOption = dom.apiProvider.querySelector('option[value="codexImageGateway"]');
    customSelects.apiProvider.renderOptions();
    const gatewayInBrowserList = [...document.querySelectorAll("#apiProviderCustomList .custom-select-option")]
      .some(option => /Codex/i.test(option.textContent));
    return {
      stored: stored.map(item => ({ id: item.id, provider: item.apiProvider, endpoint: item.endpoint, apiKey: item.apiKey, model: item.model })),
      applied,
      legacy: { provider: legacy.apiProvider, endpoint: legacy.endpoint, apiKey: legacy.apiKey, model: legacy.model },
      gatewayProfile: { provider: gatewayProfile.apiProvider, endpoint: gatewayProfile.endpoint, apiKey: gatewayProfile.apiKey, model: gatewayProfile.model },
      gatewayOptionHidden: gatewayOption?.hidden === true,
      gatewayInBrowserList,
      grsaiOptionPresent: !!dom.apiProvider.querySelector('option[value="grsai"]'),
      officialOptionPresent: !!dom.apiProvider.querySelector('option[value="official"]'),
      customOptionPresent: !!dom.apiProvider.querySelector('option[value="custom"]'),
    };
  })()`, true);
  const byId = Object.fromEntries(result.applied.map(item => [item.id, item]));
  assertQa(result.stored.length === 3, "All retained API profiles must remain stored independently.", result);
  assertQa(byId["official-profile"]?.apiKey === "sk-official-only" && byId["official-profile"]?.endpoint.includes("api.openai.com"), "Official OpenAI credentials must restore only into the official profile.", result);
  assertQa(byId["grsai-profile"]?.apiKey === "sk-grsai-only" && byId["grsai-profile"]?.endpoint.includes("grsai.dakka.com.cn"), "GrsAI credentials and its default endpoint must remain isolated and restorable.", result);
  assertQa(byId["custom-profile"]?.apiKey === "sk-custom-only" && byId["custom-profile"]?.endpoint.includes("custom.example.test"), "Custom API credentials must remain isolated and restorable.", result);
  assertQa(result.legacy.provider === "codexImageGateway" && result.legacy.endpoint === "http://127.0.0.1:18081/v1" && result.legacy.apiKey === "", "Legacy OpenCodex profiles must migrate to the dedicated gateway without retaining the placeholder key.", result);
  assertQa(result.gatewayProfile.provider === "codexImageGateway" && result.gatewayProfile.apiKey === "" && result.gatewayProfile.model === "gpt-image-2", "Gateway profiles must never persist the local bearer credential.", result);
  assertQa(result.grsaiOptionPresent && result.officialOptionPresent && result.customOptionPresent, "GrsAI, Official OpenAI and Custom API choices must all be preserved.", result);
  assertQa(result.gatewayOptionHidden && !result.gatewayInBrowserList, "The native Windows/Android gateway must be absent from the plain-browser custom dropdown instead of leaving an unusable choice.", result);
}

async function testManualRetryUsesCurrentlySelectedApi(cdp) {
  logStep("Manual retry and retry-all use the API selected at retry time, not the failed card's old provider snapshot");
  await loadFresh(cdp, "retry-current-api");
  const result = await cdp.eval(`(async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const originalFetch = window.fetch.bind(window);
    const calls = [];
    window.fetch = async (url, options = {}) => {
      const textUrl = String(url);
      if (textUrl.includes("api.openai.com")) {
        calls.push({
          url: textUrl,
          authorization: new Headers(options.headers || {}).get("Authorization"),
          body: JSON.parse(String(options.body || "{}")),
        });
        return new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(url, options);
    };
    try {
      localStorage.clear();
      applyApiProvider("grsai", { forceEndpoint: true });
      dom.apiKey.value = "sk-old-grsai";
      dom.model.value = "gpt-image-2";
      const oldSnapshot = captureApiRequestSnapshot();
      const card = addResultPlaceholder("retry-current-api", "retry through selected provider", {
        mode: "single",
        prompt: "retry through selected provider",
        size: "1024x1024",
        apiSnapshot: oldSnapshot,
      });
      markPlaceholderFailed(card, "retry-current-api", Object.assign(new Error("HTTP 500: old provider failed"), { status: 500 }), {
        mode: "single",
        prompt: "retry through selected provider",
        size: "1024x1024",
        apiSnapshot: oldSnapshot,
      });
      dom.apiProvider.value = "official";
      dom.apiProvider.dispatchEvent(new Event("change", { bubbles: true }));
      dom.apiEndpoint.value = "https://api.openai.com/v1/images/generations";
      dom.apiKey.value = "sk-new-official";
      dom.model.value = "gpt-image-2";
      const ok = await retryResultCard(card, false, { quiet: true, retryCountOverride: 0 });
      return {
        ok,
        calls,
        oldProvider: oldSnapshot.provider,
        retriedProvider: card._retryContext?.apiSnapshot?.provider,
        retriedEndpoint: card._retryContext?.apiSnapshot?.endpoint,
        cardStatus: card.dataset.status,
      };
    } finally {
      window.fetch = originalFetch;
    }
  })()`, true);
  assertQa(result.ok && result.cardStatus === "success", "A failed card should regenerate successfully after selecting a new API.", result);
  assertQa(result.oldProvider === "grsai" && result.retriedProvider === "official" && result.retriedEndpoint.includes("api.openai.com"), "Retry context must be replaced with the currently selected API snapshot.", result);
  assertQa(result.calls.length === 1 && result.calls[0].url.includes("api.openai.com") && result.calls[0].authorization === "Bearer sk-new-official" && result.calls[0].body.model === "gpt-image-2", "The retry request must actually reach the newly selected API with its current credential and model.", result);
}

async function testProviderPanelsResponsiveAfterGateway(cdp) {
  logStep("Provider panels remain responsive and clickable after adding the ChatGPT web image gateway");
  for (const viewport of [
    { width: 1365, height: 768, mobile: false },
    { width: 430, height: 720, mobile: true },
  ]) {
    await loadFresh(cdp, `provider-layout-${viewport.width}`, viewport);
    const result = await cdp.eval(`(() => {
      const checks = [];
      for (const provider of ["official", "grsai", "custom", "codexImageGateway"]) {
        applyApiProvider(provider, { forceEndpoint: true });
        const panel = provider === "official" ? dom.officialProviderPanel
          : provider === "grsai" ? dom.grsaiProviderPanel
          : provider === "custom" ? dom.customProviderPanel
          : dom.codexGatewayProviderPanel;
        const rect = panel.getBoundingClientRect();
        const inputRect = document.querySelector(".input-panel").getBoundingClientRect();
        const overflowButtons = [...panel.querySelectorAll("button")].filter(button => {
          const box = button.getBoundingClientRect();
          return box.width > 0 && (box.left < rect.left - 1 || box.right > rect.right + 1);
        }).length;
        checks.push({ provider, hidden: panel.classList.contains("hidden"), left: rect.left, right: rect.right, inputLeft: inputRect.left, inputRight: inputRect.right, scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth, overflowButtons });
      }
      return { checks, bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
    })()`, true);
    assertQa(result.checks.every(item => !item.hidden && item.left >= item.inputLeft - 1 && item.right <= item.inputRight + 1 && item.scrollWidth <= item.clientWidth + 1 && item.overflowButtons === 0), "Every provider panel must fit the input column without clipped or unclickable controls.", { viewport, result });
    assertQa(!result.bodyOverflow, "Provider controls must not introduce horizontal page overflow.", { viewport, result });
  }
}

async function testCodexGatewayAutomaticRecovery(cdp) {
  logStep("ChatGPT web image gateway preserves health failures, restarts once, and shows circuit recovery countdown");
  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      localStorage.clear();
      window.__AI_GEN_NATIVE_PLATFORM = "windows";
      window.__gatewayRecoveryCalls = [];
      window.__gatewayHealthMode = "fail_once";
      window.__gatewayHealthFailures = 1;
      window.FlutterDownload = {
        postMessage(raw) {
          const payload = JSON.parse(raw);
          window.__gatewayRecoveryCalls.push(payload);
          let result = {};
          if (["loadCodexImageGatewayConfig", "restartCodexImageGateway"].includes(payload.action)) {
            result = { baseUrl: "http://127.0.0.1:18081/v1", apiKey: "${"e".repeat(64)}" };
          } else if (payload.action === "getChatGptAccounts") {
            result = { accounts: [], active_account_id: "", auto_switch: true };
          } else if (payload.action === "nativeFetch") {
            const url = String(payload.url || "");
            if (url.endsWith("/healthz")) {
              if (window.__gatewayHealthMode === "fail_once" && window.__gatewayHealthFailures > 0) {
                window.__gatewayHealthFailures--;
                result = { status: 503, headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "starting" }) };
              } else {
                result = {
                  status: 200,
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ status: "ok", session_available: window.__gatewayHealthMode !== "missing_session" }),
                };
              }
            } else {
              result = {
                status: 200,
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  image_only: true, generations: true, edits: true, async_tasks: true,
                  models: ["gpt-image-2"], max_reference_images: 20,
                  default_concurrency: 1, max_concurrency: 100,
                  dimension_modes: ["native", "strict_native", "exact_output"],
                }),
              };
            }
          }
          setTimeout(() => window.AiGenAndroidBridge?.resolve(payload.id, result), 0);
        }
      };
    `,
  });
  try {
    await loadFresh(cdp, "codex-gateway-automatic-recovery");
    const result = await cdp.eval(`(async () => {
      applyApiProvider(CODEX_IMAGE_GATEWAY_PROVIDER, { forceEndpoint: true });
      const recovered = await checkCodexGatewayHealth({ announce: false, force: true, allowRestart: true });
      const restartCallsAfterRecovery = window.__gatewayRecoveryCalls.filter(call => call.action === "restartCodexImageGateway").length;

      window.__gatewayHealthMode = "missing_session";
      codexGatewayCredentials = null;
      codexGatewayHealthCheckedAt = 0;
      setCodexGatewayHealthState("idle");
      const missingSessionReady = await checkCodexGatewayHealth({ announce: false, force: true, allowRestart: true });
      const detailedError = codexGatewayUnavailableError();
      const restartCallsAfterMissingSession = window.__gatewayRecoveryCalls.filter(call => call.action === "restartCodexImageGateway").length;

      scheduleCodexGatewayRecovery(Date.now() + 1600);
      await new Promise(resolve => setTimeout(resolve, 30));
      const recoveryState = codexGatewayHealthState;
      const recoveryText = dom.codexGatewayHealthStatus?.textContent || "";
      clearCodexGatewayRecoveryTimer();
      codexGatewayRuntime.resetAfterHealthCheck({ resetReference: true });
      setCodexGatewayHealthState("ready", CODEX_IMAGE_GATEWAY_MODEL);
      return {
        recovered,
        restartCallsAfterRecovery,
        missingSessionReady,
        detailedMessage: detailedError.message,
        detailedCategory: detailedError.imageError?.category || "",
        restartCallsAfterMissingSession,
        recoveryState,
        recoveryText,
      };
    })()`, true);
    assertQa(
      result.recovered && result.restartCallsAfterRecovery === 1,
      "A transient health failure must restart the bundled ChatGPT gateway once and retry the probe.",
      result,
    );
    assertQa(
      !result.missingSessionReady
        && result.restartCallsAfterMissingSession === 1
        && result.detailedMessage.includes("请先导入一个可用的 ChatGPT 账号令牌")
        && result.detailedCategory === "upstream_unavailable",
      "A missing account session must keep its actionable reason and must not restart the gateway.",
      result,
    );
    assertQa(
      result.recoveryState === "recovering" && /\d+\s*秒/.test(result.recoveryText),
      "An open circuit must show a live recovery countdown before its automatic health probe.",
      result,
    );
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
  }
}

async function testAndroidChatGptGatewayEntry(cdp) {
  logStep("Android exposes the ChatGPT web image provider with manual token import and keeps built-in browser login hidden");
  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      localStorage.clear();
      window.__AI_GEN_NATIVE_PLATFORM = "android";
      window.__androidGatewayCalls = [];
      window.FlutterDownload = {
        postMessage(raw) {
          const payload = JSON.parse(raw);
          window.__androidGatewayCalls.push(payload);
          let result = {};
          if (payload.action === "loadCodexImageGatewayConfig") {
            result = { baseUrl: "http://127.0.0.1:18081/v1", apiKey: "${"d".repeat(64)}" };
          } else if (payload.action === "getChatGptAccounts") {
            result = {
              accounts: [{
                local_account_id: "33333333-3333-4333-8333-333333333333",
                display_name: "Android QA",
                masked_email: "a***@example.com",
                plan_label: "plus",
                status: "ready",
              }],
              active_account_id: "33333333-3333-4333-8333-333333333333",
              auto_switch: true,
            };
          } else if (payload.action === "getChatGptAuthState") {
            result = { status: "ready" };
          } else if (payload.action === "openChatGptSessionPage") {
            result = true;
          } else if (payload.action === "nativeFetch") {
            const url = String(payload.url || "");
            result = url.endsWith("/healthz")
              ? { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "ok", session_available: true }) }
              : { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ image_only: true, generations: true, edits: true, async_tasks: true, models: ["gpt-image-2"], max_reference_images: 20, default_concurrency: 1, max_concurrency: 100, dimension_modes: ["native", "strict_native", "exact_output"] }) };
          }
          setTimeout(() => window.AiGenAndroidBridge?.resolve(payload.id, result), 0);
        }
      };
    `,
  });
  await cdp.send("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
  });
  try {
    await loadFresh(cdp, "android-chatgpt-gateway-entry", { width: 430, height: 820, mobile: true });
    const result = await cdp.eval(`(async () => {
      await new Promise(r => setTimeout(r, 80));
      document.getElementById("configSection").open = true;
      applyApiProvider("codexImageGateway", { forceEndpoint: true });
      const ready = await checkCodexGatewayHealth({ announce: false, force: true });
      customSelects.apiProvider.renderOptions();
      const option = dom.apiProvider.querySelector('option[value="codexImageGateway"]');
      const customOption = [...document.querySelectorAll("#apiProviderCustomList .custom-select-option")]
        .find(item => /ChatGPT/i.test(item.textContent));
      dom.openChatGptSessionPage.click();
      await new Promise(r => setTimeout(r, 30));
      return {
        platform: getRuntimePlatform(),
        ready,
        selectedProvider: dom.apiProvider.value,
        optionHidden: option?.hidden === true,
        customOptionVisible: !!customOption,
        providerPanelVisible: !dom.codexGatewayProviderPanel.classList.contains("hidden"),
        authCardVisible: !dom.chatGptAuthCard.classList.contains("hidden"),
        loginHidden: dom.chatGptLogin.classList.contains("hidden"),
        reloginHidden: dom.chatGptRelogin.classList.contains("hidden"),
        sessionButtonVisible: !dom.openChatGptSessionPage.classList.contains("hidden"),
        importButtonVisible: !dom.importChatGptSession.classList.contains("hidden"),
        accountItems: dom.chatGptAccountList.querySelectorAll(".chatgpt-account-item").length,
        sessionOpenCalls: window.__androidGatewayCalls.filter(call => call.action === "openChatGptSessionPage").length,
        configCalls: window.__androidGatewayCalls.filter(call => call.action === "loadCodexImageGatewayConfig").length,
      };
    })()`, true);
    assertQa(
      result.platform === "android"
        && result.ready
        && result.selectedProvider === "codexImageGateway"
        && !result.optionHidden
        && result.customOptionVisible
        && result.providerPanelVisible,
      "Android must expose and activate the ChatGPT web image provider instead of hiding it as Windows-only.",
      result,
    );
    assertQa(
      result.authCardVisible
        && result.loginHidden
        && result.reloginHidden
        && result.sessionButtonVisible
        && result.importButtonVisible
        && result.accountItems === 1
        && result.sessionOpenCalls === 1
        && result.configCalls >= 1,
      "Android must use the system-browser session page plus manual token import while keeping the unsupported built-in login window hidden.",
      result,
    );
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: "" });
  }
}

async function testCodexImageGatewayIntegration(cdp) {
  logStep("ChatGPT web image gateway loads its Windows credential in memory, gates on capabilities, and uses resumable n=1 tasks");
  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      localStorage.clear();
      window.__AI_GEN_NATIVE_PLATFORM = "windows";
      window.__gatewayCalls = [];
      window.__gatewaySubmittedBodies = [];
      window.__gatewayKey = "${"a".repeat(64)}";
      window.__chatGptAuthState = {
        local_account_id: "11111111-1111-4111-8111-111111111111",
        display_name: "QA ChatGPT",
        masked_email: "q***@example.com",
        plan_label: "plus",
        last_verified_at: "",
        status: "signed_out",
      };
      window.__chatGptAccountsState = {
        accounts: [
          {
            local_account_id: "11111111-1111-4111-8111-111111111111",
            account_fingerprint: "${"b".repeat(64)}",
            display_name: "QA ChatGPT",
            masked_email: "q***@example.com",
            plan_label: "plus",
            expires_at: "",
            last_verified_at: "",
            status: "ready",
            last_error: "",
          },
          {
            local_account_id: "22222222-2222-4222-8222-222222222222",
            account_fingerprint: "${"c".repeat(64)}",
            display_name: "QA Backup",
            masked_email: "b***@example.com",
            plan_label: "free",
            expires_at: "",
            last_verified_at: "",
            status: "ready",
            last_error: "",
          },
        ],
        active_account_id: "11111111-1111-4111-8111-111111111111",
        auto_switch: true,
      };
      window.__gatewayPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==";
      window.FlutterDownload = {
        postMessage(raw) {
          const payload = JSON.parse(raw);
          window.__gatewayCalls.push(payload);
          let result = {};
          if (payload.action === "loadCodexImageGatewayConfig") {
            result = { baseUrl: "http://127.0.0.1:18081/v1", apiKey: window.__gatewayKey };
          } else if (payload.action === "getChatGptAccounts") {
            result = window.__chatGptAccountsState;
          } else if (["selectChatGptAccount", "activateChatGptAccount"].includes(payload.action)) {
            window.__chatGptAccountsState = {
              ...window.__chatGptAccountsState,
              active_account_id: payload.accountId,
            };
            result = window.__chatGptAccountsState;
          } else if (payload.action === "setChatGptAutoSwitch") {
            window.__chatGptAccountsState = {
              ...window.__chatGptAccountsState,
              auto_switch: payload.enabled !== false,
            };
            result = window.__chatGptAccountsState;
          } else if (payload.action === "rotateChatGptAccount") {
            const previous = window.__chatGptAccountsState.active_account_id;
            const next = window.__chatGptAccountsState.accounts.find(item => item.local_account_id !== previous);
            window.__chatGptAccountsState = {
              ...window.__chatGptAccountsState,
              active_account_id: next?.local_account_id || previous,
              accounts: window.__chatGptAccountsState.accounts.map(item => (
                item.local_account_id === previous
                  ? { ...item, status: payload.failedStatus || "rate_limited", last_error: payload.reason || "" }
                  : item
              )),
            };
            result = { ...window.__chatGptAccountsState, rotated_to: next?.local_account_id || "" };
          } else if (payload.action === "deleteChatGptAccount") {
            window.__chatGptAccountsState = {
              ...window.__chatGptAccountsState,
              accounts: window.__chatGptAccountsState.accounts.filter(item => item.local_account_id !== payload.accountId),
              active_account_id: "",
            };
            result = window.__chatGptAccountsState;
          } else if (payload.action === "openChatGptSessionPage") {
            result = true;
          } else if (payload.action === "getChatGptAuthState") {
            result = window.__chatGptAuthState;
          } else if (["openChatGptLogin", "reloginChatGpt"].includes(payload.action)) {
            window.__chatGptAuthState = { ...window.__chatGptAuthState, status: "opening_login" };
            result = window.__chatGptAuthState;
          } else if (payload.action === "logoutChatGpt") {
            window.__chatGptAuthState = { ...window.__chatGptAuthState, status: "signed_out" };
            result = window.__chatGptAuthState;
          } else if (payload.action === "loadSecret") {
            result = "";
          } else if (payload.action === "nativeFetch") {
            const method = String(payload.method || "GET").toUpperCase();
            const url = String(payload.url || "");
            if (url.endsWith("/healthz")) {
              result = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "ok", service: "langbai-codex-image-gateway" }) };
            } else if (url.endsWith("/v1/image-capabilities")) {
              result = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ image_only: true, generations: true, edits: true, async_tasks: true, models: ["gpt-image-2"], max_reference_images: 20, default_concurrency: 10, max_concurrency: 100, dimension_modes: ["native", "strict_native", "exact_output"] }) };
            } else if (method === "POST" && url.endsWith("/v1/image-tasks")) {
              const body = JSON.parse(payload.body || "{}");
              window.__gatewaySubmittedBodies.push({ body, headers: payload.headers, proxyMode: payload.proxyMode, proxyUrl: payload.proxyUrl });
              result = { status: 202, headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "imgjob_" + window.__gatewaySubmittedBodies.length, status: "queued" }) };
            } else if (method === "GET" && /\\/v1\\/image-tasks\\/imgjob_\\d+\\/files\\/0$/.test(url)) {
              const source = Uint8Array.from(atob(window.__gatewayPng), c => c.charCodeAt(0));
              result = {
                status: 200,
                headers: { "content-type": "image/png" },
                transferId: "gateway-image-" + window.__gatewayCalls.length,
                byteLength: source.length,
                chunkSize: 17,
              };
            } else if (method === "GET" && url.includes("/v1/image-tasks/imgjob_")) {
              const id = url.split("/").pop();
              const submitted = window.__gatewaySubmittedBodies[Number(id.split("_").pop()) - 1]?.body || {};
              result = id === "imgjob_1"
                ? { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_gateway_quota" }, body: JSON.stringify({ id, status: "failed", error: { status: 429, type: "rate_limit_error", code: "quota_exhausted", message: "first account quota exhausted", request_id: "req_gateway_quota" } }) }
                : { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_gateway_test" }, body: JSON.stringify({ id, status: "succeeded", result: { data: [{ url: "http://127.0.0.1:18081/v1/image-tasks/" + id + "/files/0" }], langbai: { reference_images_received: (submitted.images || []).length, reference_images_forwarded: Math.min((submitted.images || []).length, 5), reference_boards_compiled: (submitted.images || []).length > 5, dimensions: [{ requested_size: submitted.size, native_size: "1024x1536", final_size: submitted.size, dimension_action: submitted.dimension_mode === "exact_output" ? "smart_cover_crop" : "none" }] } } }) };
            } else {
              result = { status: 404, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: { message: "not mocked" } }) };
            }
          } else if (payload.action === "nativeFetchBlobChunk") {
            const source = Uint8Array.from(atob(window.__gatewayPng), c => c.charCodeAt(0));
            const end = Math.min(source.length, payload.offset + payload.length);
            let binary = "";
            for (const byte of source.slice(payload.offset, end)) binary += String.fromCharCode(byte);
            result = { base64: btoa(binary), nextOffset: end, done: end >= source.length };
          } else if (payload.action === "nativeFetchBlobRelease") {
            result = true;
          }
          setTimeout(() => window.AiGenAndroidBridge?.resolve(payload.id, result), 0);
        }
      };
    `,
  });
  await cdp.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" });
  try {
    await loadFresh(cdp, "codex-gateway-integration");
    const result = await cdp.eval(`(async () => {
      window.__AI_GEN_NATIVE_PLATFORM = "windows";
      applyApiProvider("codexImageGateway", { forceEndpoint: true });
      // Reproduce the v1.5.0 failure: a legacy saved profile can explicitly
      // disable async mode. The bundled gateway must still use /image-tasks.
      applyCodexGatewayOptions({ quality: "high", dimensionMode: "exact_output", asyncTasks: false, clientQueue: 10 });
      const legacyAsyncPreference = getCodexGatewayOptions().asyncTasks;
      const ready = await checkCodexGatewayHealth({ announce: false, force: true });
      if (!ready) return {
        ready,
        healthText: dom.codexGatewayHealthStatus?.textContent || "",
        healthState: dom.codexGatewayHealthStatus?.dataset?.state || "",
        platform: getRuntimePlatform(),
        nativeAvailable: !!nativeDownload.available(),
        bridgeType: typeof window.FlutterDownload?.postMessage,
        calls: window.__gatewayCalls,
      };
      const submitted = [];
      await new Promise(r => setTimeout(r, 30));
      const authCardInitiallyVisible = !dom.chatGptAuthCard.classList.contains("hidden");
      dom.chatGptLogin.click();
      await new Promise(r => setTimeout(r, 30));
      window.AiGenChatGptAuth.onState({
        ...window.__chatGptAuthState,
        status: "ready",
        last_verified_at: new Date().toISOString(),
      });
      await new Promise(r => setTimeout(r, 30));
      const authReady = {
        state: dom.chatGptAuthStatus.dataset.state,
        identity: dom.chatGptAuthIdentity.textContent,
        loginHidden: dom.chatGptLogin.classList.contains("hidden"),
        reloginHidden: dom.chatGptRelogin.classList.contains("hidden"),
        logoutHidden: dom.chatGptLogout.classList.contains("hidden"),
        accountItems: dom.chatGptAccountList.querySelectorAll(".chatgpt-account-item").length,
      };
      dom.chatGptRelogin.click();
      await new Promise(r => setTimeout(r, 30));
      window.AiGenChatGptAuth.onState({ ...window.__chatGptAuthState, status: "ready" });
      await new Promise(r => setTimeout(r, 30));
      const generated = await callImageAPI("gateway generation", "832x1216", 1, "gateway", { maxRetries: 9, onTaskSubmitted: task => submitted.push(task) });
      const reference = { fileName: "ref.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==", width: 1, height: 1 };
      const edited = await callImageAPI("gateway semantic edit", "1024x1024", 1, "gateway edit", { references: [reference], maxRetries: 9, onTaskSubmitted: task => submitted.push(task) });
      applyCodexGatewayOptions({ quality: "medium", dimensionMode: "exact_output", asyncTasks: true, clientQueue: 100 });
      codexGatewayCredentials = null;
      const webCredentials = await loadCodexGatewayCredentials();
      const webRoute = {
        options: getCodexGatewayOptions(),
        legacyAsyncPreference,
        baseUrl: webCredentials.baseUrl,
        concurrency: getCodexGatewayConcurrency(),
        credentialCalls: window.__gatewayCalls.filter(call => call.action === "loadCodexImageGatewayConfig").length,
      };
      applyCodexGatewayOptions({ quality: "high", dimensionMode: "exact_output", asyncTasks: true, clientQueue: 10 });
      codexGatewayCredentials = null;
      const legacyBlob = await imageUrlToBlob("http://127.0.0.1:18081/v1/image-tasks/imgjob_1/files/0");
      const protectedUrlChecks = {
        gateway: isCodexGatewayProtectedImageUrl("http://127.0.0.1:18081/v1/image-tasks/imgjob_1/files/0"),
        dynamicPort: isCodexGatewayProtectedImageUrl("http://127.0.0.1:18092/v1/image-tasks/imgjob_1/files/0"),
        wrongPort: isCodexGatewayProtectedImageUrl("http://127.0.0.1:9999/v1/image-tasks/imgjob_1/files/0"),
        remoteHost: isCodexGatewayProtectedImageUrl("https://example.test/v1/image-tasks/imgjob_1/files/0"),
      };
      updateInpaintAvailability();
      const inpaintEnabled = !dom.openInpaintFromFile.disabled;
      dom.openInpaintFromFile.click();
      await new Promise(r => setTimeout(r, 50));
      const inpaintOpened = !dom.inpaintModal.classList.contains("hidden");
      const gatewayProfile = currentApiConfig("Gateway");
      const localStorageText = Object.keys(localStorage).map(key => localStorage.getItem(key)).join("\\n");
      const providerOptions = [...dom.apiProvider.options].map(option => option.value);
      const compactedHistory = compactHistoryItem({
        id: "history-data-url",
        imageUrl: "cache://history-data-url",
        originalUrl: "data:image/png;base64," + "A".repeat(256 * 1024),
      });
      const originalStorageSetItem = Storage.prototype.setItem;
      let quotaWriteAttempts = 0;
      let quotaFailureEscaped = false;
      try {
        Storage.prototype.setItem = function(key, value) {
          if (key === HISTORY_KEY) {
            quotaWriteAttempts += 1;
            throw new DOMException("quota test", "QuotaExceededError");
          }
          return originalStorageSetItem.call(this, key, value);
        };
        saveHistory([{ id: "quota-test", imageUrl: "data:image/png;base64," + window.__gatewayPng, createdAt: new Date().toISOString() }]);
      } catch {
        quotaFailureEscaped = true;
      } finally {
        Storage.prototype.setItem = originalStorageSetItem;
      }
      const originalCallImageAPI = callImageAPI;
      let retryApiCalls = 0;
      let authenticationRetry;
      let timeoutRetry;
      try {
        callImageAPI = async () => {
          retryApiCalls += 1;
          return { data: [{ b64_json: window.__gatewayPng }] };
        };
        const retrySnapshot = captureApiRequestSnapshot();
        const failedAccount = {
          ...window.__chatGptAccountsState.accounts[0],
          status: "authentication_failed",
          last_error: "HTTP 401: expired QA token",
        };
        window.__chatGptAccountsState = {
          accounts: [failedAccount],
          active_account_id: failedAccount.local_account_id,
          auto_switch: true,
        };
        renderChatGptAccounts(window.__chatGptAccountsState);
        const authCard = addResultPlaceholder("auth-retry", "retry after login", {
          mode: "single", prompt: "retry after login", size: "1024x1024", apiSnapshot: retrySnapshot,
        });
        markPlaceholderFailed(authCard, "auth-retry", Object.assign(new Error("HTTP 401: expired QA token"), { status: 401 }), {
          mode: "single", prompt: "retry after login", size: "1024x1024", apiSnapshot: retrySnapshot,
        });
        const authButton = authCard.querySelector(".retry-now");
        const authButtonInitiallyEnabled = !authButton.disabled;
        authButton.click();
        await new Promise(r => setTimeout(r, 40));
        const openedRelogin = window.__gatewayCalls.some(call => call.action === "reloginChatGpt");
        const pendingBeforeLogin = pendingChatGptRetryCards.has(authCard);
        window.__chatGptAccountsState = {
          ...window.__chatGptAccountsState,
          accounts: [{ ...failedAccount, status: "ready", last_error: "" }],
        };
        window.AiGenChatGptAuth.onState({ status: "ready" });
        const authDeadline = Date.now() + 2000;
        while (Date.now() < authDeadline && authCard.dataset.status !== "success") {
          await new Promise(r => setTimeout(r, 20));
        }
        authenticationRetry = {
          authButtonInitiallyEnabled,
          openedRelogin,
          pendingBeforeLogin,
          finalStatus: authCard.dataset.status,
          pendingAfterLogin: pendingChatGptRetryCards.has(authCard),
        };

        const timeoutCard = addResultPlaceholder("timeout-retry", "retry after local bridge timeout", {
          mode: "single", prompt: "retry after local bridge timeout", size: "1024x1024", apiSnapshot: retrySnapshot,
        });
        markPlaceholderFailed(timeoutCard, "timeout-retry", new Error("TimeoutException after 0:00:10.000000: Future not completed"), {
          mode: "single", prompt: "retry after local bridge timeout", size: "1024x1024", apiSnapshot: retrySnapshot,
        });
        const timeoutButton = timeoutCard.querySelector(".retry-now");
        const timeoutButtonInitiallyEnabled = !timeoutButton.disabled;
        timeoutButton.click();
        const timeoutDeadline = Date.now() + 2000;
        while (Date.now() < timeoutDeadline && timeoutCard.dataset.status !== "success") {
          await new Promise(r => setTimeout(r, 20));
        }
        timeoutRetry = {
          timeoutButtonInitiallyEnabled,
          bulkEligible: timeoutCard.dataset.retryBlocked === "false",
          finalStatus: timeoutCard.dataset.status,
        };
      } finally {
        callImageAPI = originalCallImageAPI;
      }
      return {
        ready,
        chatGptAuth: {
          cardInitiallyVisible: authCardInitiallyVisible,
          ready: authReady,
          actions: window.__gatewayCalls
            .filter(call => /^(?:getChatGptAccounts|getChatGptAuthState|openChatGptLogin|reloginChatGpt|activateChatGptAccount)$/.test(call.action))
            .map(call => call.action),
          finalState: dom.chatGptAuthStatus.dataset.state,
        },
        endpoint: dom.apiEndpoint.value,
        keyValue: dom.apiKey.value,
        keyReadOnly: dom.apiKey.readOnly,
        model: dom.model.value,
        modelReadOnly: dom.model.readOnly,
        options: getCodexGatewayOptions(),
        webRoute,
        taskWaitTimeoutMs: CODEX_IMAGE_GATEWAY_TASK_WAIT_TIMEOUT_MS,
        submitted,
        requestBodies: window.__gatewaySubmittedBodies,
        generated: { count: generated.data?.length || 0, item: generated.data?.[0], meta: generated._openCodex },
        edited: { count: edited.data?.length || 0, item: edited.data?.[0], meta: edited._openCodex },
        legacyBlob: { size: legacyBlob.size, type: legacyBlob.type },
        protectedUrlChecks,
        fileCalls: window.__gatewayCalls.filter(call => /\\/v1\\/image-tasks\\/imgjob_\\d+\\/files\\/0$/.test(String(call.url || ""))),
        profile: gatewayProfile,
        leakedKey: localStorageText.includes(window.__gatewayKey),
        inpaintEnabled,
        inpaintOpened,
        providerOptions,
        gatewayOptionHidden: dom.apiProvider.querySelector('option[value="codexImageGateway"]')?.hidden === true,
        historyPersistence: {
          dataUrlOriginal: sanitizeHistoryOriginalUrl("data:image/png;base64," + "A".repeat(256 * 1024)),
          protectedOriginal: sanitizeHistoryOriginalUrl("http://127.0.0.1:18081/v1/image-tasks/imgjob_1/files/0"),
          compactImageUrl: compactedHistory.imageUrl,
          compactOriginalUrl: compactedHistory.originalUrl,
          quotaWriteAttempts,
          quotaFailureEscaped,
        },
        retryRecovery: { authenticationRetry, timeoutRetry, retryApiCalls },
      };
    })()`, true);
    assertQa(result.ready && result.endpoint === "http://127.0.0.1:18081/v1" && result.model === "gpt-image-2", "The dedicated local gateway must pass health and capability probes before generation.", result);
    assertQa(
      result.chatGptAuth.cardInitiallyVisible
        && result.chatGptAuth.ready.state === "ready"
        && /QA ChatGPT/.test(result.chatGptAuth.ready.identity)
        && /q\*\*\*@example\.com/.test(result.chatGptAuth.ready.identity)
        && !result.chatGptAuth.ready.loginHidden
        && !result.chatGptAuth.ready.reloginHidden
        && !result.chatGptAuth.ready.logoutHidden
        && result.chatGptAuth.ready.accountItems === 2
        && result.chatGptAuth.actions.includes("getChatGptAccounts")
        && result.chatGptAuth.actions.includes("getChatGptAuthState")
        && result.chatGptAuth.actions.includes("openChatGptLogin")
        && result.chatGptAuth.actions.includes("reloginChatGpt")
        && result.chatGptAuth.actions.includes("activateChatGptAccount")
        && result.chatGptAuth.finalState === "ready",
      "The Windows account card must render sanitized multi-account state and keep login, relogin and account activation wired to the native bridge.",
      result.chatGptAuth,
    );
    assertQa(result.keyValue === "" && result.keyReadOnly && result.modelReadOnly && result.profile.apiKey === "" && !result.leakedKey, "The local bearer credential must remain memory-only and never enter API profiles or Local Storage.", result);
    assertQa(result.options.quality === "high" && result.options.dimensionMode === "exact_output" && result.options.asyncTasks && result.options.clientQueue === 10, "Gateway quality, dimensions, async resume and user-selected concurrency must remain available.", result);
    assertQa(result.webRoute.legacyAsyncPreference === true && result.requestBodies.length === 3, "Legacy asyncTasks=false profiles must be normalized to resumable /image-tasks submissions instead of the missing synchronous route.", result);
    assertQa(!("routeMode" in result.webRoute.options) && result.webRoute.baseUrl === "http://127.0.0.1:18081/v1" && result.webRoute.concurrency === 100 && result.webRoute.credentialCalls >= 1, "The web-only image route must reuse the protected local credential, remove the old route selector, and honor concurrency up to one hundred.", result);
    assertQa(result.taskWaitTimeoutMs === 1200000, "Resumable gateway tasks must keep polling for up to 20 minutes instead of being reported failed at the old five-minute UI deadline.", result);
    assertQa(result.submitted.length === 3 && result.submitted.every(task => /^imgjob_\d+$/.test(task.id)), "Every gateway submission, including an account failover retry, must expose a checkpointable async task id.", result);
    assertQa(
      result.requestBodies.length === 3
        && result.requestBodies.every(item => item.body.model === "gpt-image-2" && item.body.n === 1 && item.proxyMode === "direct" && item.proxyUrl === "")
        && result.requestBodies[0].body.account_id === "11111111-1111-4111-8111-111111111111"
        && result.requestBodies.slice(1).every(item => item.body.account_id === "22222222-2222-4222-8222-222222222222"),
      "A terminal 429/quota result must switch accounts, retry only the current image once, bind subsequent tasks to the backup account, and bypass the desktop proxy.",
      result,
    );
    assertQa(!result.requestBodies[0].body.images && !result.requestBodies[1].body.images && result.requestBodies[2].body.images?.length === 1, "Text generation and its account failover retry must omit references while semantic edit sends the selected local reference.", result);
    assertQa(result.generated.count === 1 && result.edited.count === 1 && result.generated.meta?.audit?.taskId === "imgjob_2" && result.edited.meta?.audit?.taskId === "imgjob_3", "Completed task results must retain safe task and dimension audit metadata after account failover.", result);
    assertQa(result.generated.item?.b64_json && !result.generated.item?.url && !result.generated.item?.original_url && result.edited.item?.b64_json && !result.edited.item?.url, "Protected gateway file URLs must be replaced by authenticated local image data before preview rendering.", result);
    assertQa(result.legacyBlob.size > 0 && result.legacyBlob.type === "image/png" && result.fileCalls.length === 3 && result.fileCalls.every(call => call.headers?.Authorization === `Bearer ${"a".repeat(64)}` && call.proxyMode === "direct" && call.proxyUrl === ""), "Gateway downloads and legacy preview reloads must attach the in-memory bearer credential and bypass desktop proxies.", result);
    assertQa(result.historyPersistence.dataUrlOriginal === "" && result.historyPersistence.protectedOriginal === "" && result.historyPersistence.compactImageUrl === "cache://history-data-url" && result.historyPersistence.compactOriginalUrl === "", "Checkpoint history must keep the local cache pointer without persisting multi-megabyte Base64 or protected gateway URLs.", result);
    assertQa(result.historyPersistence.quotaWriteAttempts === 2 && !result.historyPersistence.quotaFailureEscaped, "History quota exhaustion must stay non-fatal after an image succeeds so it cannot erase the card or trigger a duplicate paid submission.", result);
    assertQa(result.protectedUrlChecks.gateway && result.protectedUrlChecks.dynamicPort && !result.protectedUrlChecks.wrongPort && !result.protectedUrlChecks.remoteHost, "Protected task URLs must recognize the embedded gateway's dynamic loopback port while rejecting unrelated local ports and remote hosts.", result);
    assertQa(result.inpaintEnabled && result.inpaintOpened, "Gateway gpt-image-2 must keep local mask inpainting clickable.", result);
    assertQa(result.providerOptions.includes("official") && result.providerOptions.includes("grsai") && result.providerOptions.includes("custom") && !result.gatewayOptionHidden, "The Windows provider list must keep Official, GrsAI and Custom while showing the gateway.", result);
    assertQa(
      result.retryRecovery.authenticationRetry.authButtonInitiallyEnabled
        && result.retryRecovery.authenticationRetry.openedRelogin
        && result.retryRecovery.authenticationRetry.pendingBeforeLogin
        && !result.retryRecovery.authenticationRetry.pendingAfterLogin
        && result.retryRecovery.authenticationRetry.finalStatus === "success",
      "A ChatGPT 401 card must open sign-in from its visible retry button and automatically resume the same card after account recovery.",
      result.retryRecovery,
    );
    assertQa(
      result.retryRecovery.timeoutRetry.timeoutButtonInitiallyEnabled
        && result.retryRecovery.timeoutRetry.bulkEligible
        && result.retryRecovery.timeoutRetry.finalStatus === "success"
        && result.retryRecovery.retryApiCalls === 2,
      "A ChatGPT local-bridge timeout must keep both manual and bulk retry paths actionable instead of rendering a dead button.",
      result.retryRecovery,
    );
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: "" });
  }
}

async function testGeminiWebImageIntegration(cdp) {
  logStep("Gemini web image provider keeps credentials memory-only and completes resumable authenticated tasks");
  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      localStorage.clear();
      window.__AI_GEN_NATIVE_PLATFORM = "windows";
      window.__geminiCalls = [];
      window.__geminiBodies = [];
      window.__geminiPolls = 0;
      window.__geminiAutoSwitch = true;
      window.__geminiAccountAvailable = true;
      window.__geminiKey = "${"d".repeat(64)}";
      window.__geminiPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==";
      window.FlutterDownload = {
        postMessage(raw) {
          const payload = JSON.parse(raw);
          window.__geminiCalls.push(payload);
          let result = {};
          if (payload.action === "loadGeminiWebGatewayConfig") {
            result = {
              baseUrl: "http://127.0.0.1:18160/v1",
              apiKey: window.__geminiKey,
              accounts: [{
                local_account_id: "gemini-account-qa",
                display_name: "QA Gemini",
                masked_email: "g***@example.com",
                status: "ready",
                login_ready: true,
                quota_state: "available",
                temporary_chat_available: false,
                fullsize_download_available: true,
                available: window.__geminiAccountAvailable,
                effective_concurrency: 1,
              }],
              activeAccountId: "gemini-account-qa",
              embeddedBrowserConnected: true,
              autoSwitch: window.__geminiAutoSwitch,
            };
          } else if (payload.action === "getGeminiAccounts") {
            result = {
              accounts: [{
                local_account_id: "gemini-account-qa",
                display_name: "QA Gemini",
                masked_email: "g***@example.com",
                status: "ready",
                login_ready: true,
                quota_state: "available",
                temporary_chat_available: false,
                fullsize_download_available: true,
                available: window.__geminiAccountAvailable,
                effective_concurrency: 1,
              }],
              active_account_id: "gemini-account-qa",
              embedded_browser_connected: true,
              auto_switch: window.__geminiAutoSwitch,
            };
          } else if (payload.action === "loadSecret") {
            result = "";
          } else if (payload.action === "nativeFetch") {
            const method = String(payload.method || "GET").toUpperCase();
            const url = String(payload.url || "");
            if (url.endsWith("/healthz")) {
              result = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({
                 status: "ok", provider: "gemini_web", embedded_browser_connected: true,
                session_available: true, temporary_chat_available: false,
                direct_protocol_available: true,
                fullsize_download_available: true,
              }) };
            } else if (url.endsWith("/v1/capabilities")) {
              result = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({
                provider: "gemini_web", temporary_chat_required: false,
                temporary_chat_available: false, direct_protocol_available: true,
                fullsize_download: true,
                effective_concurrency: 1, dimension_modes: ["native_fullsize"],
              }) };
            } else if (url.endsWith("/v1/accounts")) {
              result = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({
                accounts: [{
                  local_account_id: "gemini-account-qa", display_name: "QA Gemini", status: "ready",
                  login_ready: true, quota_state: "available", temporary_chat_available: false,
                  direct_protocol_available: true,
                  fullsize_download_available: true, available: window.__geminiAccountAvailable,
                  effective_concurrency: 1,
                }],
                ready_account_count: window.__geminiAccountAvailable ? 1 : 0,
                 active_account_id: "gemini-account-qa", embedded_browser_connected: true, auto_switch: window.__geminiAutoSwitch,
              }) };
            } else if (method === "POST" && url.endsWith("/v1/image-tasks")) {
              window.__geminiBodies.push({
                body: JSON.parse(payload.body || "{}"),
                headers: payload.headers,
                proxyMode: payload.proxyMode,
                proxyUrl: payload.proxyUrl,
              });
              result = { status: 202, headers: { "content-type": "application/json" }, body: JSON.stringify({
                id: "gemini_task_qa", status: "queued", account_id: "gemini-account-qa",
              }) };
            } else if (method === "POST" && url.endsWith("/v1/image-tasks/gemini_cancel_qa/cancel")) {
              result = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({
                id: "gemini_cancel_qa", status: "cancelled", account_id: "gemini-account-qa",
              }) };
            } else if (method === "GET" && url.endsWith("/v1/image-tasks/gemini_task_qa/files/0")) {
              const source = Uint8Array.from(atob(window.__geminiPng), c => c.charCodeAt(0));
              result = {
                status: 200,
                headers: { "content-type": "image/png" },
                transferId: "gemini-image",
                byteLength: source.length,
                chunkSize: 17,
              };
            } else if (method === "GET" && url.endsWith("/v1/image-tasks/gemini_task_qa")) {
              window.__geminiPolls += 1;
              result = window.__geminiPolls === 1
                ? { status: 503, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: { code: "bridge_restarting", message: "temporary bridge restart" } }) }
                : { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({
                    id: "gemini_task_qa", client_request_id: "client_qa", status: "succeeded",
                    account_id: "gemini-account-qa",
                    audit: {
                      temporary_chat_verified: true, history_guard: "passed",
                      selector_pack_version: "2026.07.30.2",
                      requested_model_mode: "pro", selected_model_mode: "pro",
                    },
                    result: { data: [{ url: "/v1/image-tasks/gemini_task_qa/files/0" }] },
                  }) };
            } else {
              result = { status: 404, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: { code: "not_mocked" } }) };
            }
          } else if (payload.action === "nativeFetchBlobChunk") {
            const source = Uint8Array.from(atob(window.__geminiPng), c => c.charCodeAt(0));
            const end = Math.min(source.length, payload.offset + payload.length);
            let binary = "";
            for (const byte of source.slice(payload.offset, end)) binary += String.fromCharCode(byte);
            result = { base64: btoa(binary), nextOffset: end, done: end >= source.length };
          } else if (payload.action === "nativeFetchBlobRelease") {
            result = true;
          } else if (payload.action === "openGeminiWebLogin") {
            result = true;
          } else if (payload.action === "setGeminiAutoSwitch") {
            window.__geminiAutoSwitch = payload.enabled;
            result = {
              accounts: [{
                local_account_id: "gemini-account-qa", display_name: "QA Gemini", status: "ready",
                login_ready: true, quota_state: "available", temporary_chat_available: false,
                fullsize_download_available: true, available: window.__geminiAccountAvailable,
                effective_concurrency: 1,
              }],
              ready_account_count: window.__geminiAccountAvailable ? 1 : 0,
              active_account_id: "gemini-account-qa",
              embedded_browser_connected: true,
              auto_switch: window.__geminiAutoSwitch,
            };
          }
          setTimeout(() => window.AiGenAndroidBridge?.resolve(payload.id, result), 0);
        }
      };
    `,
  });
  await cdp.send("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  });
  try {
    await loadFresh(cdp, "gemini-web-integration");
    const result = await cdp.eval(`(async () => {
      applyApiProvider("geminiWeb", { forceEndpoint: true });
      applyGeminiWebOptions({
        sizeMode: "native_fullsize",
        ratio: "1:1",
        targetSize: "1024x1024",
        cropMode: "center_cover",
        qualityIntent: "detail",
        modelPreference: "pro",
        clientQueue: 10,
      });
      const defaultWatermarkEnabled = loadSettings().geminiWatermarkRemovalEnabled === true
        && dom.geminiWatermarkRemovalEnabled?.checked === true;
      const syntheticWatermarkBlob = await fetch("/qa/fixtures/gemini-watermark-48-synthetic.png")
        .then(response => {
          if (!response.ok) throw new Error("Synthetic watermark fixture is unavailable");
          return response.blob();
        });
      const syntheticWatermarkResult = await transformGeminiResultBlob(syntheticWatermarkBlob, {});
      const watermarkSmoke = {
        inputBytes: syntheticWatermarkBlob.size,
        outputBytes: syntheticWatermarkResult.blob.size,
        outputType: syntheticWatermarkResult.blob.type,
        transform: syntheticWatermarkResult.transform,
        sourceSize: syntheticWatermarkResult.sourceSize,
        finalSize: String(syntheticWatermarkResult.final.width) + "x" + String(syntheticWatermarkResult.final.height),
        meta: syntheticWatermarkResult.watermarkRemoval,
      };
      saveSettings({ geminiWatermarkRemovalEnabled: false });
      const ready = await checkGeminiHealth({ announce: false, force: true });
      await nativeDownload.openGeminiWebLogin();
      const submitted = [];
      const data = ready ? await callImageAPI("QA Gemini image", "1024x1024", 1, "QA", {
        geminiWebOptions: getGeminiWebOptions(),
        onTaskSubmitted: task => submitted.push(task),
      }) : null;
      const profile = currentApiConfig("Gemini QA");
      saveConfig(profile);
      applyGeminiWebOptions(geminiImageSizes.DEFAULTS);
      applyConfig(loadConfig());
      const restoredGeminiOptions = getGeminiWebOptions();
      const restoredGeminiButtons = Object.fromEntries(
        ["geminiModelPreference", "geminiQualityIntent"].map(controlId => [
          controlId,
          [...document.querySelectorAll('[data-provider-control="' + controlId + '"] button[data-value]')]
            .filter(button => button.getAttribute("aria-pressed") === "true")
            .map(button => button.dataset.value),
        ]),
      );
      const geminiLanguageStates = {};
      for (const language of ["zh-CN", "zh-Hant", "en", "ja", "ko"]) {
        applyLanguage(language);
        geminiLanguageStates[language] = {
          modelLabel: document.getElementById("geminiModelPreferenceLabel")?.textContent,
          qualityLabel: document.getElementById("geminiQualityIntentLabel")?.textContent,
          modelButtons: [...document.querySelectorAll('[data-provider-control="geminiModelPreference"] button')]
            .map(button => button.textContent),
          qualityButtons: [...document.querySelectorAll('[data-provider-control="geminiQualityIntent"] button')]
            .map(button => button.textContent),
          modelValue: dom.geminiModelPreference.value,
          qualityValue: dom.geminiQualityIntent.value,
        };
      }
      applyLanguage("zh-CN");
      dom.geminiAutoSwitch.checked = false;
      dom.geminiAutoSwitch.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 20));
      const explicitCustom = normalizeApiConfig({
        id: "custom-local",
        apiProvider: "custom",
        endpoint: "http://127.0.0.1:18160/v1",
        apiKey: "custom-key-must-survive",
        model: "custom-image-model",
      });
      const cancelController = new AbortController();
      const cancelPoll = pollGeminiGatewayTask("gemini_cancel_qa", {
        signal: cancelController.signal,
        resolved: geminiImageSizes.resolveRequest({
          ...getGeminiWebOptions(),
          targetSize: "1024x1024",
        }),
        startedAt: Date.now(),
      }).catch(error => error?.name || "error");
      cancelController.abort();
      const cancelResult = await cancelPoll;
      await new Promise(resolve => setTimeout(resolve, 20));
      const untrustedDownload = await geminiGatewayDownloadBlob(
        "https://attacker.invalid/v1/image-tasks/stolen/files/0",
      ).then(() => "unexpected-success").catch(error => String(error?.message || error));
      const heartbeatSnapshot = JSON.parse(JSON.stringify(geminiAccountsState));
      const heartbeatChecksBefore = window.__geminiCalls.filter(call => String(call.url || "").endsWith("/healthz")).length;
      for (let index = 0; index < 20; index += 1) {
        window.AiGenAndroidBridge.onGeminiAccountChanged(heartbeatSnapshot);
      }
      await new Promise(resolve => setTimeout(resolve, 20));
      const heartbeatChecksAfter = window.__geminiCalls.filter(call => String(call.url || "").endsWith("/healthz")).length;
      const submissionsBeforeBlockedPreflight = window.__geminiBodies.length;
      window.__geminiAccountAvailable = false;
      geminiHealthCheckedAt = 0;
      const blockedPreflight = await validateProviderReady();
      const submissionsAfterBlockedPreflight = window.__geminiBodies.length;
      setGeminiHealthState("ready", GEMINI_WEB_MODEL);
      await geminiGatewayResponseError({
        status: 409,
        text: async () => JSON.stringify({
          error: { code: "gemini_account_not_ready", message: "Page not ready." },
          accounts: {
            ...heartbeatSnapshot,
            accounts: heartbeatSnapshot.accounts.map(account => ({
              ...account,
              available: false,
              task_ready: false,
            })),
            ready_account_count: 0,
          },
        }),
      }).catch(() => {});
      const healthStateAfterAccount409 = geminiHealthState;
      geminiHealthPromise = Promise.resolve(true);
      const sharedHealthBlockedPreflight = await validateProviderReady();
      geminiHealthPromise = null;
      const submissionsAfterSharedHealthPreflight = window.__geminiBodies.length;
      const item = data?.data?.[0] || null;
      const geminiSelectedBeforeSwitch = getSelectedSize();
      const geminiVisibleSizes = [...document.querySelectorAll('#sizePresets > [data-size-provider="gemini"]:not(.hidden):not([hidden]) input[name="size"]')]
        .map(input => input.value);
      const standardVisibleWhileGemini = document.querySelectorAll('#sizePresets > [data-size-provider="standard"]:not(.hidden):not([hidden])').length;
      const geminiGuideVisible = !document.getElementById("geminiSizeGuide")?.hidden
        && !document.getElementById("geminiSizeGuide")?.classList.contains("hidden");
      const geminiSavedSizesHidden = document.getElementById("savedSizeRow")?.classList.contains("hidden") === true;
      dom.apiProvider.value = "official";
      dom.apiProvider.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      const standardSizeAfterSwitch = getSelectedSize();
      const standardSavedSizesVisible = document.getElementById("savedSizeRow")?.classList.contains("hidden") === false;
      const geminiVisibleWhileOfficial = document.querySelectorAll('#sizePresets > [data-size-provider="gemini"]:not(.hidden):not([hidden])').length;
      dom.apiProvider.value = "geminiWeb";
      dom.apiProvider.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      const geminiSizeAfterReturn = getSelectedSize();
      applyLanguage("zh-CN");
      const recoveryErrorText = formatImageApiError({
        status: 502,
        code: "gemini_generated_image_recovery_failed",
        message: "Gemini generated the image, but all three download attempts failed.",
      }).message;
      const legacyCorruptErrorText = sanitizeImageErrorMessage(
        "Gemini 网页界面能力不可用。Gemini ?????????????????????????",
      );
      return {
        ready,
        defaultWatermarkEnabled,
        watermarkSmoke,
        provider: dom.apiProvider.value,
        providerPanelVisible: !dom.geminiProviderPanel.classList.contains("hidden"),
        optionHidden: [...dom.apiProvider.options].find(option => option.value === "geminiWeb")?.hidden,
        model: dom.model.value,
        endpoint: dom.apiEndpoint.value,
        pairingControlRemoved: !document.getElementById("geminiPairingKey") && !document.getElementById("copyGeminiPairingKey"),
        autoSwitchValue: dom.geminiAutoSwitch.checked,
        loginCalls: window.__geminiCalls.filter(call => call.action === "openGeminiWebLogin"),
        autoSwitchCalls: window.__geminiCalls.filter(call => call.action === "setGeminiAutoSwitch"),
        apiKeyValue: dom.apiKey.value,
        profile,
        restoredGeminiOptions,
        restoredGeminiButtons,
        geminiLanguageStates,
        submitted,
        bodies: window.__geminiBodies,
        globalSize: getSelectedSize(),
        fileCalls: window.__geminiCalls.filter(call => String(call.url || "").includes("/files/0")),
        item,
        meta: data?._openCodex || null,
        concurrency: getProviderConcurrency(),
        pollCount: window.__geminiPolls,
        explicitCustom,
        cancelResult,
        cancelCalls: window.__geminiCalls.filter(call => String(call.url || "").endsWith("/v1/image-tasks/gemini_cancel_qa/cancel")),
        untrustedDownload,
        untrustedCalls: window.__geminiCalls.filter(call => String(call.url || "").includes("attacker.invalid")),
        heartbeatChecksBefore,
        heartbeatChecksAfter,
        blockedPreflight,
        healthStateAfterAccount409,
        sharedHealthBlockedPreflight,
        submissionsBeforeBlockedPreflight,
        submissionsAfterBlockedPreflight,
        submissionsAfterSharedHealthPreflight,
        leakedKey: JSON.stringify(localStorage).includes(window.__geminiKey),
        geminiSelectedBeforeSwitch,
        geminiVisibleSizes,
        standardVisibleWhileGemini,
        geminiGuideVisible,
        geminiSavedSizesHidden,
        standardSizeAfterSwitch,
        standardSavedSizesVisible,
        geminiVisibleWhileOfficial,
        geminiSizeAfterReturn,
        recoveryErrorText,
        legacyCorruptErrorText,
      };
    })()`, true);
    assertQa(
      result.ready
        && result.provider === "geminiWeb"
        && result.providerPanelVisible
        && !result.optionHidden
        && result.model === "gemini-web-image"
        && result.endpoint === "http://127.0.0.1:18160/v1",
      "The native Gemini provider must become ready without interfering with other provider routes.",
      result,
    );
    assertQa(
      result.defaultWatermarkEnabled
        && result.watermarkSmoke?.outputBytes > 0
        && result.watermarkSmoke?.outputType === "image/png"
        && result.watermarkSmoke?.transform === "gemini_watermark_removed"
        && result.watermarkSmoke?.sourceSize === "320x320"
        && result.watermarkSmoke?.finalSize === "320x320"
        && result.watermarkSmoke?.meta?.enabled === true
        && result.watermarkSmoke?.meta?.applied === true
        && result.watermarkSmoke?.meta?.size === 48
        && result.watermarkSmoke?.meta?.position?.x === 240
        && result.watermarkSmoke?.meta?.position?.y === 240,
      "Gemini watermark removal must default on and process a real 48px synthetic watermark without resizing.",
      result.watermarkSmoke,
    );
    assertQa(
      result.geminiVisibleSizes.includes("1264x848")
        && result.geminiVisibleSizes.includes("848x1264")
        && result.geminiVisibleSizes.includes("3168x1344")
        && result.standardVisibleWhileGemini === 0
        && result.geminiGuideVisible
        && result.geminiSavedSizesHidden
        && result.standardSavedSizesVisible
        && result.geminiVisibleWhileOfficial === 0
        && result.standardSizeAfterSwitch === "1536x1024"
        && result.geminiSizeAfterReturn === result.geminiSelectedBeforeSwitch,
      "Gemini must show only its official 1K/2K presets, while switching back restores the existing non-Gemini size set.",
      result,
    );
    assertQa(
      result.recoveryErrorText.includes("Gemini 原图下载失败")
        && result.recoveryErrorText.includes("连续三次仍未能下载原图")
        && !result.recoveryErrorText.includes("????")
        && !result.recoveryErrorText.includes("网页界面能力不可用"),
      "A completed Gemini image whose original cannot be downloaded must show a readable recovery error, not UI-capability text or replacement question marks.",
      result,
    );
    assertQa(
      result.legacyCorruptErrorText.includes("旧版本保存的错误详情编码损坏")
        && !result.legacyCorruptErrorText.includes("????"),
      "Legacy Gemini task errors containing literal replacement question marks must be shown as a readable migration notice.",
      result,
    );
    assertQa(
      result.pairingControlRemoved
        && result.loginCalls.length === 1
        && result.autoSwitchCalls.length === 1
        && result.autoSwitchCalls[0].enabled === false
        && result.autoSwitchValue === false
        && result.apiKeyValue === ""
        && result.profile.apiKey === ""
        && !result.leakedKey,
      "Gemini must use the in-app login flow, persist auto-switch through the native bridge, and keep loopback credentials out of API profiles and Local Storage.",
      result,
    );
    assertQa(
      result.blockedPreflight === false
        && result.sharedHealthBlockedPreflight === false
        && result.healthStateAfterAccount409 === "error"
        && result.submissionsBeforeBlockedPreflight === 1
        && result.submissionsAfterBlockedPreflight === 1
        && result.submissionsAfterSharedHealthPreflight === 1,
      "A Gemini account that is not ready must stop the batch before any result cards or repeated image-task submissions are created.",
      result,
    );
    assertQa(
      result.heartbeatChecksBefore === result.heartbeatChecksAfter,
      "Repeated identical Gemini account heartbeats must not restart the health check or flash the generate controls.",
      result,
    );
    assertQa(
      result.bodies.length === 1
        && result.bodies[0].body.provider === "geminiWeb"
        && result.bodies[0].body.n === 1
        && result.bodies[0].body.temporary_chat_required === true
        && `${result.bodies[0].body.requested_size.width}x${result.bodies[0].body.requested_size.height}` === result.globalSize
        && result.bodies[0].body.size_mode === "native_fullsize"
        && result.bodies[0].body.crop_mode === "smart_cover"
        && result.bodies[0].body.quality_intent === "detail"
        && result.bodies[0].body.model_preference === "pro"
        && result.profile.geminiWebOptions?.qualityIntent === "detail"
        && result.profile.geminiWebOptions?.modelPreference === "pro"
        && result.restoredGeminiOptions?.qualityIntent === "detail"
        && result.restoredGeminiOptions?.modelPreference === "pro"
        && result.restoredGeminiButtons?.geminiQualityIntent?.join(",") === "detail"
        && result.restoredGeminiButtons?.geminiModelPreference?.join(",") === "pro"
        && Object.values(result.geminiLanguageStates || {}).every(state => (
          state.modelLabel
          && state.qualityLabel
          && state.modelButtons.length === 3
          && state.qualityButtons.length === 3
          && !JSON.stringify(state).includes("undefined")
          && state.modelValue === "pro"
          && state.qualityValue === "detail"
        ))
        && result.bodies[0].proxyMode === "direct"
        && result.submitted[0]?.id === "gemini_task_qa",
      "Gemini generation must submit one checkpointable temporary-chat task using the app-wide resolution over the direct loopback route.",
      result,
    );
    assertQa(
      result.item?.b64_json
        && !result.item?.url
        && result.fileCalls.length === 1
        && result.fileCalls[0].headers?.Authorization === `Bearer ${"d".repeat(64)}`
        && result.fileCalls[0].proxyMode === "direct",
      "Gemini protected result URLs must be authenticated and converted to local image bytes before preview.",
      result,
    );
    assertQa(
      /不受信任|untrusted/i.test(result.untrustedDownload)
        && result.untrustedCalls.length === 0,
      "Gemini loopback credentials must never be forwarded to a result URL outside the active local gateway.",
      result,
    );
    assertQa(
      result.meta?.audit?.temporaryChatVerified
        && result.meta?.audit?.historyGuard === "passed"
        && result.meta?.audit?.requestedModelMode === "pro"
        && result.meta?.audit?.selectedModelMode === "pro"
        && result.meta?.response?.nativeSize === "1x1"
        && result.meta?.response?.finalSize === "1x1"
        && result.meta?.response?.dimensionAction === "none"
        && result.meta?.audit?.nativeSha256 === result.meta?.audit?.finalSha256
        && result.concurrency === 1
        && result.pollCount === 2,
      "Gemini audit metadata must preserve temporary-chat verification and keep the downloaded original byte-for-byte while transient poll failures keep the original task alive.",
      result,
    );
    assertQa(
      result.explicitCustom.apiProvider === "custom"
        && result.explicitCustom.apiKey === "custom-key-must-survive"
        && result.explicitCustom.model === "custom-image-model",
      "An explicitly saved custom API on a Gemini-like loopback port must not be reclassified or lose its key.",
      result.explicitCustom,
    );
    assertQa(
      result.cancelResult === "AbortError"
        && result.cancelCalls.length === 1
        && String(result.cancelCalls[0].method || "").toUpperCase() === "POST",
      "Cancelling a Gemini task must stop local polling and cancel the same claimed gateway task instead of leaving browser automation running.",
      result,
    );
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: script.identifier,
    });
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: "" });
  }
}

async function main() {
  const server = createStaticServer();
  await new Promise(resolve => server.listen(appPort, host, resolve));
  await removeDirWithRetry(edgeProfile);
  fs.mkdirSync(edgeProfile, { recursive: true });

  const edge = spawn(findEdgeExecutable(), [
    "--headless=new",
    "--disable-gpu",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${edgeProfile}`,
    appUrl,
  ], { stdio: "ignore", windowsHide: true });

  let cdp;
  try {
    cdp = await setupBrowserPage();
    await testColdStartupProfilesAndCoreControls(cdp);
    await testStorageFaultIsolationAndHistoryDbRecovery(cdp);
    await testCustomSelects(cdp);
    await testApiConfig(cdp);
    await testSkillsManagerAndPromptInjection(cdp);
    await testReferencesAndAutoFill(cdp);
    await testOrderedBulkPromptInput(cdp);
    await testComicBulkPromptOverwriteConfirmation(cdp);
    await testBulkPromptInputBeyondOneHundred(cdp);
    await testUploadDebounceWindow(cdp);
    await testComicProjectRestorePreservesReferencesAndFailures(cdp);
    await testWorkspaceDraftSurvivesFullDocumentReload(cdp);
    await testTurnaroundProjectRestorePreservesReferencesAndFailures(cdp);
    await testInterruptedProjectCheckpointResume(cdp);
    await testHistoryRestoreAndExport(cdp);
    await testExportedProjectFolderRoundTrip(cdp);
    await testHistoryImageCacheFallback(cdp);
    await testGeneratedImagePersistentCache(cdp);
    await testHistoryPruneConcurrency(cdp);
    await testRetryReplacesHistoryEntry(cdp);
    await testSequentialToggleSharedAcrossModes(cdp);
    await testSaveComicFolder(cdp);
    await testStrictExportCompleteness(cdp);
    await testRetryClearReloadAndI18n(cdp);
    await testEveryFailureRemainsManuallyRetryable(cdp);
    await testRetryAllFailedRepeatsEachCardUntilSuccessOrLimit(cdp);
    await testRetryAllFailedManualSupplementButton(cdp);
    await testRetryAllFailedShowsQueuedCardsBeyondConcurrency(cdp);
    await testRetryAllFailedCanCancelAndRestart(cdp);
    await testCardRetryAttemptDisplayAndStop(cdp);
    await testCancelDuringFirstAttempt(cdp);
    await testDesktopProxyControls(cdp);
    await testRetainedProviderProfilesAndGatewayMigration(cdp);
    await testManualRetryUsesCurrentlySelectedApi(cdp);
    await testProviderPanelsResponsiveAfterGateway(cdp);
    await testOpenAiOfficialProviderOptionsAndIsolation(cdp);
    await testOpenAiOfficialProviderResponsiveLayout(cdp);
    await testOpenCodexDualModelsSizesAndLocalInpaint(cdp);
    await testCodexGatewayOptionsPersistAcrossRestart(cdp);
    await testCodexGatewayAutomaticRecovery(cdp);
    await testGptImage2InpaintRoutes(cdp);
    await testInpaintModalInteractionSafety(cdp);
    await testAndroidChatGptGatewayEntry(cdp);
    await testCodexImageGatewayIntegration(cdp);
    await testGeminiWebImageIntegration(cdp);
    await testGrsaiOfficialAdapter(cdp);
    await testNativeDownloadTimeoutOptOut(cdp);
    await testSavePathsTextMenuAndWindowsZipChunks(cdp);
    await testNativeSecureApiKeyMigration(cdp);
    await testPwaOfflineCache(cdp);
    await testUpdateControls(cdp);
    await testStartupUpdatePrompt(cdp);
    await testDragDropHintReflectsPlatform(cdp);
    await testUploadZoneHintTargetsCorrectSpan(cdp);
    await testManualWheelScrollFallback(cdp);
    await testModelChoicesWheelScroll(cdp);
    await testModelComboboxBehavior(cdp);
    await testTurnaroundMode(cdp);
    await testAndroidUpdateRedirect(cdp);
    await testWindowsInstallDirControl(cdp);
    cdp.assertNoRuntimeIssues();
    console.log("\n[qa] All regression checks passed.");
  } finally {
    try { cdp?.close(); } catch {}
    try { edge.kill("SIGKILL"); } catch {}
    await sleep(500);
    await new Promise(resolve => server.close(resolve));
    await removeDirWithRetry(edgeProfile);
  }
}

main().catch(err => {
  console.error("\n[qa] Regression failed:", err.message);
  if (err.details !== undefined) {
    console.error(JSON.stringify(err.details, null, 2));
  }
  process.exit(1);
});
