#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const host = "127.0.0.1";
const appPort = 8765;
const debugPort = Number(process.env.AIGEN_QA_DEBUG_PORT) || (19000 + (process.pid % 20000));
const appUrl = `http://${host}:${appPort}/index.html`;
const edgeProfile = path.join(path.dirname(projectRoot), `aigen-edge-qa-${process.pid}`);

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

async function loadFresh(cdp, query = "qa", viewport = { width: 1365, height: 768, mobile: false }) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  });
  const targetUrl = `${appUrl}?${query}=${Date.now()}`;
  await cdp.send("Page.navigate", { url: targetUrl });
  let lastState = null;
  for (let i = 0; i < 200; i++) {
    lastState = await cdp.eval(`(() => ({
      url: location.href,
      readyState: document.readyState,
      hasGenerateButton: !!document.getElementById("generateBtn"),
      title: document.title,
      bodyLength: document.body?.textContent?.length || 0,
    }))()`).catch(err => ({ transientNavigationError: String(err?.message || err) }));
    if (lastState?.readyState === "complete" && lastState.hasGenerateButton) {
      await sleep(150);
      return;
    }
    await sleep(100);
  }
  throw new Error(`App did not become ready: ${JSON.stringify(lastState)}`);
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
  assertQa(apiProviderFlow.options.length === 3, "API type dropdown should list all 3 provider options.", apiProviderFlow);
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
    document.getElementById("savedApis").value = "0";
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
  assertQa(reloadDelete.after.endpoint === "" && reloadDelete.after.key === "", "Deleting active API should clear fields.", reloadDelete);
  assertQa(reloadDelete.after.apis.length === 0 && reloadDelete.after.active === null, "Deleting active API should clear storage.", reloadDelete);

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
    applyConfig(migrated[0]);
    renderSavedApis();
    document.getElementById("savedApis").value = "1";
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
    document.getElementById("autoFillTemplate").value = "ref-bubble-number";
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
  assertQa(result.panelCount === 3, "Reference auto-fill should create one panel per reference.", result);
  assertQa(JSON.stringify(result.prompts) === JSON.stringify([
    "给参考图1加入1的气泡字幕",
    "给参考图2加入2的气泡字幕",
    "给参考图3加入3的气泡字幕",
  ]), "Reference bubble auto-fill template should match the requested wording.", result);
}

async function testUploadDebounceWindow(cdp) {
  logStep("openFileInputOnce()'s debounce must block a genuine same-instant double-fire but not a user's realistic impatient re-click a few hundred ms later -- caption mode's bulk upload zone gets clicked repeatedly in normal use, and users reported clicking it sometimes 'does nothing'");
  await loadFresh(cdp, "upload-debounce");
  const result = await cdp.eval(`(async () => {
    let clicks = 0;
    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this === document.getElementById("captionBulkInput")) clicks++;
    };
    document.querySelector('[data-mode="caption"]').click();
    await new Promise(r => setTimeout(r, 50));

    const zone = document.getElementById("captionUploadZone");
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
      if (history.length === 1) break;
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

async function testCaptionProjectRestorePreservesReferencesAndFailures(cdp) {
  logStep("Restoring a caption project keeps every row and caption but intentionally does not restore reference images");
  await loadFresh(cdp, "restore-refs-and-fails-caption");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      // Every caption row carries its own reference image, so this always goes through the
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
    document.querySelector('[data-mode="caption"]').click();
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
    const bulkInput = document.getElementById("captionBulkInput");
    bulkInput.files = dt.files;
    bulkInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));

    const rows = [...document.querySelectorAll(".caption-row")];
    rows[0].querySelector(".caption-text").value = "row one text";
    rows[0].querySelector(".caption-text").dispatchEvent(new Event("input", { bubbles: true }));
    rows[1].querySelector(".caption-text").value = "row two text";
    rows[1].querySelector(".caption-text").dispatchEvent(new Event("input", { bubbles: true }));
    const ref1DataUrl = rows[0]._captionReference?.dataUrl;
    const ref2DataUrl = rows[1]._captionReference?.dataUrl;

    document.getElementById("generateBtn").click();
    const start = Date.now();
    while (Date.now() - start < 6000) {
      const history = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
      if (history.length === 1) break;
      await new Promise(r => setTimeout(r, 80));
    }

    const history = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
    const item = history[0] || {};
    const savedPanelsOmitRefs = Array.isArray(item.panels) && item.panels.every(p => !p.references || p.references.length === 0);
    const savedStatuses = (item.panels || []).map(p => p.status);

    document.getElementById("resultGrid").innerHTML = "";
    document.getElementById("captionTbody").innerHTML = "";
    document.querySelector('[data-mode="single"]').click();
    await new Promise(r => setTimeout(r, 50));
    document.getElementById("historyBtn").click();
    await new Promise(r => setTimeout(r, 100));
    document.querySelector(".history-project-card .history-actions .btn")?.click();
    await new Promise(r => setTimeout(r, 200));

    const restoredRows = [...document.querySelectorAll(".caption-row")];
    return {
      savedPanelsOmitRefs,
      savedStatuses,
      restoredRowCount: restoredRows.length,
      restoredTexts: restoredRows.map(r => r.querySelector(".caption-text").value),
      restoredRef1Matches: restoredRows[0]?._captionReference?.dataUrl === ref1DataUrl,
      restoredRef2Matches: restoredRows[1]?._captionReference?.dataUrl === ref2DataUrl,
      restoredThumbsVisible: restoredRows.map(r => !r.querySelector(".panel-img-preview")?.classList.contains("hidden")),
    };
  })()`, true);

  assertQa(result.savedPanelsOmitRefs, "Caption project history must not persist reference-image bytes.", result);
  assertQa(JSON.stringify(result.savedStatuses) === JSON.stringify(["success", "failed"]), "A partially-failed caption batch must still save a project record covering every row and tagging each one's status.", result);
  assertQa(result.restoredRowCount === 2, "Restoring the project must recreate both caption rows, including the one that failed to generate.", result);
  assertQa(JSON.stringify(result.restoredTexts) === JSON.stringify(["row one text", "row two text"]), "Restoring must refill each row's own caption text, for both the successful and the failed row.", result);
  assertQa(!result.restoredRef1Matches && !result.restoredRef2Matches, "Restoring a caption project must not reattach old reference images.", result);
  assertQa(result.restoredThumbsVisible.every(value => value === false), "Restored caption rows must show empty image slots until the user chooses references again.", result);
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

    return { singleHidden, comicHidden, nestedInNImagesField, checkedAfterClick };
  })()`, true);
  assertQa(result.singleHidden === false, "Sequential/concurrent toggle should be visible in single-image mode.", result);
  assertQa(result.comicHidden === false, "Sequential/concurrent toggle should also be visible in comic mode (it used to be trapped inside the single-image-only field, so comic batches had no visible way to control it).", result);
  assertQa(result.nestedInNImagesField === false, "The toggle should live in the shared config area, not nested inside the single-image-only image-count field.", result);
  assertQa(result.checkedAfterClick === true, "Clicking the toggle should still work after being relocated.", result);
}

async function testSaveComicFolder(cdp) {
  logStep("Project folder exports use the entered name, otherwise distinguish comic/caption projects, and always append a collision-safe local timestamp");
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

    document.querySelector('[data-mode="caption"]').click();
    await new Promise(r => setTimeout(r, 50));
    const captionNamePlaceholder = document.getElementById("zipFileName").placeholder;
    const unnamedCaptionCalls = await saveFolderOnce();

    const saveCalls = [...namedComicCalls, ...unnamedComicCalls, ...unnamedCaptionCalls];
    return {
      singleHidden,
      comicHidden,
      saveCallCount: saveCalls.length,
      namedComicFolders: [...new Set(namedComicCalls.map(c => c.folder))],
      unnamedComicFolders: [...new Set(unnamedComicCalls.map(c => c.folder))],
      unnamedCaptionFolders: [...new Set(unnamedCaptionCalls.map(c => c.folder))],
      fileNames: [...new Set(saveCalls.map(c => c.fileName))],
      kinds: [...new Set(saveCalls.map(c => c.kind))],
      allHaveBase64: saveCalls.every(c => typeof c.base64 === "string" && c.base64.length > 0),
      projectNamePlaceholder,
      captionNamePlaceholder,
    };
  })()`, true);

  assertQa(result.singleHidden === true, "Save-to-folder button should stay hidden in single-image mode.", result);
  assertQa(result.comicHidden === false, "Save-to-folder button should become visible when switching to comic mode.", result);
  assertQa(result.saveCallCount === 6, "Three 2-image project exports should call the native saveFile bridge once per image.", result);
  assertQa(result.namedComicFolders.length === 1 && /^海边-故事_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(result.namedComicFolders[0]), "An entered project name must become the folder name, with invalid filename characters sanitized and a timestamp appended.", result);
  assertQa(result.unnamedComicFolders.length === 1 && /^漫画项目_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(result.unnamedComicFolders[0]), "An unnamed comic export must use the localized comic-project prefix plus timestamp.", result);
  assertQa(result.unnamedCaptionFolders.length === 1 && /^嵌字项目_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(result.unnamedCaptionFolders[0]), "An unnamed caption export must use a different localized caption-project prefix plus timestamp.", result);
  assertQa(new Set([result.namedComicFolders[0], result.unnamedComicFolders[0], result.unnamedCaptionFolders[0]]).size === 3, "Named, unnamed comic, and unnamed caption exports must never collapse into the same folder name.", result);
  assertQa(/项目.*文件夹/.test(result.projectNamePlaceholder) && /项目.*文件夹/.test(result.captionNamePlaceholder), "Comic and caption modes should explain that the name field controls both the project and folder name.", result);
  assertQa(result.kinds.length === 1 && result.kinds[0] === "images", "Folder save should use the 'images' download-directory kind, matching the existing image-dir picker.", result);
  assertQa(result.allHaveBase64, "Every saveFile call should carry the actual image bytes as base64.", result);
  assertQa(result.fileNames.length === 4, "Comic panels and caption images should each get distinct filenames inside their project folder.", result);
}

async function testRetryClearReloadAndI18n(cdp) {
  logStep("HTTP-400-only retry, clear while generating, reload failed image, and i18n layout");
  await loadFresh(cdp, "misc");
  const retry = await cdp.eval(`(async () => {
    let attempts400 = 0;
    const retryRounds = [];
    const ok400 = await retryTransient(async () => {
      attempts400++;
      if (attempts400 < 3) throw new Error("HTTP 400: busy");
      return "ok";
    }, {
      maxRetries: 3,
      baseDelay: 1,
      onRetry: info => retryRounds.push({ retryIndex: info.retryIndex, maxRetries: info.maxRetries })
    });
    const non400Probe = async message => {
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
    const probe504 = await non400Probe("HTTP 504: Gateway Time-out");
    const probe502 = await non400Probe("HTTP 502: Bad Gateway");
    const probe503 = await non400Probe("HTTP 503: Service Unavailable");
    const probeConnClosed = await non400Probe("HttpException: Connection closed before full header was received");
    let attempts400SuccessImmediately = 0;
    const okImmediate = await retryTransient(async () => {
      attempts400SuccessImmediately++;
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
            status: 400,
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
      ok400,
      attempts504: probe504.attempts,
      threw504: probe504.threw,
      attempts502: probe502.attempts,
      threw502: probe502.threw,
      attempts503: probe503.attempts,
      threw503: probe503.threw,
      attemptsConnClosed: probeConnClosed.attempts,
      threwConnClosed: probeConnClosed.threw,
      retryRounds,
      attempts400SuccessImmediately,
      okImmediate,
      attempts500,
      threw500,
      callAttempts,
      callImageReturned: !!data?.data?.[0]?.b64_json,
      statusText: document.getElementById("status")?.textContent || "",
    };
  })()`, true);
  assertQa(retry.attempts400 === 3 && retry.ok400 === "ok", "HTTP 400 should retry until success.", retry);
  assertQa(retry.attempts504 === 1 && retry.threw504, "HTTP 504 must fail immediately; only HTTP 400 is retryable.", retry);
  assertQa(retry.attempts502 === 1 && retry.threw502, "HTTP 502 must fail immediately; only HTTP 400 is retryable.", retry);
  assertQa(retry.attempts503 === 1 && retry.threw503, "HTTP 503 must fail immediately; only HTTP 400 is retryable.", retry);
  assertQa(retry.attemptsConnClosed === 1 && retry.threwConnClosed, "Connection errors must fail immediately rather than entering the HTTP 400 retry loop.", retry);
  assertQa(JSON.stringify(retry.retryRounds) === JSON.stringify([{ retryIndex: 1, maxRetries: 3 }, { retryIndex: 2, maxRetries: 3 }]), "HTTP 400 retry status should report the current retry round and total rounds.", retry);
  assertQa(retry.attempts400SuccessImmediately === 1 && retry.okImmediate === "image", "Successful image responses should stop retry immediately.", retry);
  assertQa(retry.attempts500 === 1 && retry.threw500, "HTTP 500 must not retry; the retryable set is exactly HTTP 400.", retry);
  assertQa(retry.callAttempts === 3 && retry.callImageReturned, "Image API should stop retrying as soon as a successful image payload returns.", retry);
  assertQa(/1\/3|2\/3/.test(retry.statusText), "Retry status should show the current retry round and total retry rounds.", retry);

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
        markPlaceholderFailed(card, i, "HTTP 400: mocked failure reason for panel " + i, {
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
    await new Promise(r => setTimeout(r, 3300)); // outlast the 3s post-completion hide delay
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
  assertQa(resultGrid.after.calls.length === 4 && resultGrid.after.retryCounts.every(count => count === 2), "Retry all failed should use the toolbar retry count for each failed panel.", resultGrid);
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
  const bad = flat.filter(item => item.badWords.length || item.hasJaChinesePanel || item.overflows.length || !item.languageCenter || !item.exportVisible || !item.statusOk);
  assertQa(bad.length === 0, "All supported languages should render without bad tokens, Japanese Chinese residue, or control overflow.", bad);
  const menuBad = i18n.filter(group => !group.menu.opened || !group.menu.changed);
  assertQa(menuBad.length === 0, "Language menu button should open and apply a selected language.", menuBad);
  const themeBad = i18n.filter(group => group.theme.before === group.theme.after);
  assertQa(themeBad.length === 0, "Theme toggle should switch between dark and light themes.", themeBad);
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
      markPlaceholderFailed(card, i, "HTTP 400: initial failure", {
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
    const during = {
      calls: hangingCalls,
      toolsVisible: !tools.classList.contains("hidden"),
      buttonEnabled: !button.disabled,
      buttonText: button.textContent,
      loadingCards: document.querySelectorAll(".result-item[data-status='loading']").length,
      status: document.getElementById("status").textContent,
    };

    button.click();
    const cancelStart = Date.now();
    while (Date.now() - cancelStart < 2000) {
      if (document.querySelectorAll(".result-item.is-failed").length === 2 && !button.disabled) break;
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
      if (document.querySelectorAll(".result-item img").length === 2) break;
      await sleep(20);
    }
    const afterRestart = {
      calls: restartCalls,
      images: document.querySelectorAll(".result-item img").length,
      failedCards: document.querySelectorAll(".result-item.is-failed").length,
      toolsHidden: tools.classList.contains("hidden"),
    };

    const cardToHangThenClear = document.querySelector(".result-item");
    markPlaceholderFailed(cardToHangThenClear, 1, "HTTP 400: fail before clear", cardToHangThenClear._retryContext);
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
    markPlaceholderFailed(freshCard, 3, "HTTP 400: fresh failure", {
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

  assertQa(result.during.calls === 2 && result.during.loadingCards === 2, "Retry all should start every failed card instead of silently ignoring the click.", result);
  assertQa(result.during.toolsVisible && result.during.buttonEnabled && /取消|cancel/i.test(result.during.buttonText), "While retry requests are pending, the toolbar must stay visible and turn into an enabled cancel control.", result);
  assertQa(result.during.status.includes("2"), "Starting retry all should immediately show how many failed items are being retried.", result);
  assertQa(result.afterCancel.failedCards === 2 && result.afterCancel.toolsVisible && result.afterCancel.buttonEnabled, "Cancelling hung retries must restore failed cards and release the global retry lock.", result);
  assertQa(/全部失败重试|retry all failed/i.test(result.afterCancel.buttonText) && /可再次|again/i.test(result.afterCancel.status), "After cancellation, the control and status should clearly say retrying is available again.", result);
  assertQa(result.afterRestart.calls === 2 && result.afterRestart.images === 2 && result.afterRestart.failedCards === 0 && result.afterRestart.toolsHidden, "A fresh retry-all round after cancellation must run normally and replace every failed card.", result);
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
            status: 400,
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
  assertQa(result.panelACalls === 2, "Stopping the card must not trigger yet another request -- exactly the initial attempt (HTTP 400) plus the one retry that got cancelled, nothing more.", result);
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
  logStep("Drag-and-drop hint text must not promise drag support inside the packaged Windows exe (webview_windows off-screen mode never delivers HTML5 drag events into the page — upstream flutter-webview-windows#9 is still open/unresolved), but should still promise it for the browser/PWA build where real Chromium drag-and-drop works");

  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.FlutterDownload = { postMessage() {} };`,
  });
  await cdp.send("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  try {
    await loadFresh(cdp, "dragdrop-native-windows");
    const nativeWindowsText = await cdp.eval(`document.querySelector(".image-upload .upload-zone > span:last-child")?.textContent || ""`, false);
    assertQa(!/拖/.test(nativeWindowsText), "Packaged Windows exe should not tell users they can drag-and-drop reference images onto the upload zone.", { nativeWindowsText });
    assertQa(/点击/.test(nativeWindowsText), "The click-to-upload affordance (the working fallback) should still be advertised.", { nativeWindowsText });
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
    document.querySelector('[data-mode="caption"]').click();
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
      caption: measure("#captionUploadZone"),
    };
  })()`, true);

  assertQa(result.globalRef.zoneHeight < 200, `Global reference upload zone must stay compact (measured ${result.globalRef.zoneHeight}px) — a runaway height means the hint text landed on the wrong element again.`, result);
  assertQa(result.globalRef.iconOwnText === "", "The global reference upload zone's icon span must never contain the hint sentence.", result);
  assertQa(/点击|拖拽|Click|Drag|クリック|ドラッグ|클릭|드래그/.test(result.globalRef.hintText || ""), "The global reference upload zone's actual hint span must contain real hint text.", result);

  assertQa(result.caption.zoneHeight < 200, `Caption mode's bulk-upload zone must stay compact (measured ${result.caption.zoneHeight}px) — a runaway height means the hint text landed on the wrong element again.`, result);
  assertQa(result.caption.iconOwnText === "", "The caption upload zone's icon span must never contain the hint sentence.", result);
  assertQa(/点击|拖拽|Click|Drag|クリック|ドラッグ|클릭|드래그/.test(result.caption.hintText || ""), "The caption upload zone's actual hint span must contain real hint text.", result);
}

async function testManualWheelScrollFallback(cdp) {
  logStep("Native Windows exe must manually redirect wheel-scroll to the nested scrollable ancestor under the cursor, working around webview_windows 0.4.0 not forwarding cursor position with wheel events (upstream flutter-webview-windows#313, merged upstream but never released to pub.dev — still stuck at 0.4.0 from 2024-02)");

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

async function testCaptionMode(cdp) {
  logStep("Caption mode: bulk-add sorts by filename, each row generates its own request carrying exactly one reference image (the whole point of the feature, avoiding the HTTP 413 from bundling many references into one request), results save as a single project, and per-row retry/restore both work correctly");
  await loadFresh(cdp, "caption-mode");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const originalFetch = window.fetch.bind(window);
    const calls = [];
    window.fetch = async (url, opts = {}) => {
      if (String(url).includes("/v1/api/generate")) {
        let body = {};
        try { body = JSON.parse(opts.body || "{}"); } catch {}
        calls.push({ prompt: body.prompt, imagesCount: (body.images || []).length });
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
    set("apiKey", "sk-qa-caption");
    set("model", "gpt-image-2");
    document.querySelector('[data-mode="caption"]').click();
    await new Promise(r => setTimeout(r, 50));
    const globalSizeFieldHiddenInCaption = document.getElementById("globalSizeField").classList.contains("hidden");
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
    const input = document.getElementById("captionBulkInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));

    const rowsBeforeGenerate = [...document.querySelectorAll(".caption-row")];
    const sortedFileNames = rowsBeforeGenerate.map(r => r.querySelector(".caption-img-thumb").title);
    const noEmptyRowBeforeUpload = rowsBeforeGenerate.length === 3; // no leftover auto-created blank row ahead of the bulk-added ones
    rowsBeforeGenerate.forEach((row, i) => {
      const ta = row.querySelector(".caption-text");
      ta.value = "bubble text " + (i + 1);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });

    document.getElementById("generateBtn").click();
    let start = Date.now();
    while (Date.now() - start < 6000) {
      const h = JSON.parse(localStorage.getItem("ai_image_gen_history_v1") || "[]");
      if (h.length === 1 && document.querySelectorAll(".result-item img").length === 3) break;
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

    // Restore from history and confirm it repopulates caption mode with the right rows.
    document.getElementById("resultGrid").innerHTML = "";
    document.getElementById("resultGrid").classList.add("hidden");
    document.getElementById("emptyState").classList.remove("hidden");
    document.getElementById("captionTbody").innerHTML = "";
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
      globalSizeFieldHiddenInCaption,
      globalSizeFieldVisibleInSingle,
      allRequestsHadExactlyOneImage: calls.every(c => c.imagesCount === 1),
      totalGenerationCalls: initialGenerationCalls,
      historyLength: history.length,
      historyType: item.type,
      historyMode: item.mode,
      historyImageCount: (item.images || []).length,
      retryFiredExactlyOneMoreCall: calls.length === callsBeforeRetry + 1,
      projectCardsBeforeRestore,
      restoredActiveTabMode: document.querySelector(".mode-tab.active")?.dataset.mode,
      restoredRowCount: document.querySelectorAll(".caption-row").length,
      restoredCaptionTexts: [...document.querySelectorAll(".caption-text")].map(el => el.value).sort(),
    };
  })()`, true);

  assertQa(result.noEmptyRowBeforeUpload, "Switching into caption mode must not leave a stray auto-created empty row ahead of bulk-uploaded images.", result);
  assertQa(result.globalSizeFieldHiddenInCaption, "The global resolution picker must be hidden in caption mode — each row's output size always follows its own reference image's dimensions, so a global size control there is irrelevant noise.", result);
  assertQa(result.globalSizeFieldVisibleInSingle, "The global resolution picker must still be visible in single mode (only caption mode hides it).", result);
  assertQa(JSON.stringify(result.sortedFileNames) === JSON.stringify(["cap-1.png", "cap-2.png", "cap-10.png"]),
    "Bulk-adding images with out-of-order but numeric filenames should create rows sorted in natural filename order (1, 2, 10), not upload order or lexical string order.", result);
  assertQa(result.totalGenerationCalls === 3, "Bulk-generating 3 caption rows should fire exactly 3 separate generation requests, one per row.", result);
  assertQa(result.allRequestsHadExactlyOneImage, "Every caption-mode generation request must carry exactly one reference image — this is the entire point of the feature (avoiding the HTTP 413 from bundling many reference images into a single request).", result);
  assertQa(result.historyLength === 1 && result.historyType === "caption-project" && result.historyMode === "caption",
    "Caption-mode results must be saved as a single combined 'caption-project' history entry, not three separate single-image records (a prior bug in saveGenerationProject() silently forced every project's type/mode back to comic regardless of what was passed in).", result);
  assertQa(result.historyImageCount === 3, "The saved caption project should contain all 3 generated images.", result);
  assertQa(result.retryFiredExactlyOneMoreCall, "Retrying a single caption result card should fire exactly one more generation call, not regenerate every row.", result);
  assertQa(result.projectCardsBeforeRestore >= 1, "The caption project should show up as a project card in the history list (isHistoryProject() must recognize mode: caption).", result);
  assertQa(result.restoredActiveTabMode === "caption", "Restoring a caption-project history entry should switch the app into caption mode, not comic mode.", result);
  assertQa(result.restoredRowCount === 3, "Restoring a caption-project history entry should repopulate all 3 rows.", result);
  assertQa(JSON.stringify(result.restoredCaptionTexts) === JSON.stringify(["bubble text 1", "bubble text 2", "bubble text 3"]),
    "Restoring a caption-project history entry should refill each row's own caption text (not the combined global+row prompt, not blank).", result);
}

async function testCaptionAutoFill(cdp) {
  logStep("Caption mode one-click-fill (一键填写): default numbered-bubble template substitutes each row's own number, overwrite requires confirmation, and a custom template can be typed in");
  await loadFresh(cdp, "caption-autofill");
  const result = await cdp.eval(`(async () => {
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

    document.querySelector('[data-mode="caption"]').click();
    await new Promise(r => setTimeout(r, 50));

    async function makeImageFile(name, color) {
      const canvas = document.createElement("canvas");
      canvas.width = 4; canvas.height = 4;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color; ctx.fillRect(0, 0, 4, 4);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      return new File([blob], name, { type: "image/png" });
    }
    const dt = new DataTransfer();
    dt.items.add(await makeImageFile("a.png", "#f33"));
    dt.items.add(await makeImageFile("b.png", "#3f3"));
    const input = document.getElementById("captionBulkInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));

    // Rows start empty, so the default template fill should apply with no overwrite prompt.
    document.getElementById("captionAutoFillTemplate").value = "numbered-bubble";
    document.getElementById("autoFillCaptionRows").click();
    await new Promise(r => setTimeout(r, 80));
    const afterDefaultFill = [...document.querySelectorAll(".caption-text")].map(el => el.value);

    // Rows now have content: clicking fill again must ask for overwrite confirmation first.
    document.getElementById("autoFillCaptionRows").click();
    const dialogAppeared = await Promise.race([
      answerAskDialog(false), // decline the overwrite this time
      new Promise(r => setTimeout(() => r(false), 2500)),
    ]);
    await new Promise(r => setTimeout(r, 80));
    const afterDeclinedOverwrite = [...document.querySelectorAll(".caption-text")].map(el => el.value);

    // Now accept the overwrite and use a custom template (should prompt for the template text too).
    document.getElementById("captionAutoFillTemplate").value = "custom";
    document.getElementById("autoFillCaptionRows").click();
    await answerAskDialog(true); // confirm overwrite
    await answerAskDialog("图{n}号标注"); // supply the custom template
    await new Promise(r => setTimeout(r, 80));
    const afterCustomFill = [...document.querySelectorAll(".caption-text")].map(el => el.value);

    return { afterDefaultFill, dialogAppeared, afterDeclinedOverwrite, afterCustomFill };
  })()`, true);

  assertQa(JSON.stringify(result.afterDefaultFill) === JSON.stringify(["给图片加入1的气泡字幕", "给图片加入2的气泡字幕"]),
    "The default numbered-bubble template should fill each row with an instruction sentence naming its own row number (bubble styling/position is meant to be described once in the global prompt, not repeated per row).", result);
  assertQa(result.dialogAppeared, "Clicking fill again once rows already have content must show a confirm-before-overwrite dialog instead of silently overwriting.", result);
  assertQa(JSON.stringify(result.afterDeclinedOverwrite) === JSON.stringify(result.afterDefaultFill),
    "Declining the overwrite confirmation must leave the existing caption text untouched.", result);
  assertQa(JSON.stringify(result.afterCustomFill) === JSON.stringify(["图1号标注", "图2号标注"]),
    "Confirming the overwrite and supplying a custom template should fill each row using that template with {n} substituted.", result);
}

async function testOrderedBulkPromptInput(cdp) {
  logStep("Ordered bulk prompt input maps one line per comic panel/caption image, preserves blank positions, expands comic panels, and refuses caption overflow");
  await loadFresh(cdp, "ordered-bulk-prompts");
  const result = await cdp.eval(`(async () => {
    localStorage.clear();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    document.querySelector('[data-mode="comic"]').click();
    await sleep(60);
    document.getElementById("panelCount").value = "2";
    document.getElementById("createPanels").click();
    await sleep(60);
    document.getElementById("bulkInputPanelPrompts").click();
    await sleep(30);
    const comicModalOpened = !document.getElementById("bulkPromptModal").classList.contains("hidden");
    const bulkText = document.getElementById("bulkPromptText");
    bulkText.value = "镜头一\\n\\n镜头三\\n镜头四\\n";
    bulkText.dispatchEvent(new Event("input", { bubbles: true }));
    const comicCountBeforeApply = document.getElementById("bulkPromptCount").textContent;
    document.getElementById("applyBulkPrompts").click();
    await sleep(100);
    const comicPrompts = [...document.querySelectorAll("#panelTbody textarea")].map(el => el.value);

    document.querySelector('[data-mode="caption"]').click();
    await sleep(60);
    async function makeImageFile(name, color) {
      const canvas = document.createElement("canvas");
      canvas.width = 3; canvas.height = 3;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color; ctx.fillRect(0, 0, 3, 3);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      return new File([blob], name, { type: "image/png" });
    }
    const dt = new DataTransfer();
    dt.items.add(await makeImageFile("caption-1.png", "#f33"));
    dt.items.add(await makeImageFile("caption-2.png", "#3f3"));
    dt.items.add(await makeImageFile("caption-3.png", "#33f"));
    const upload = document.getElementById("captionBulkInput");
    upload.files = dt.files;
    upload.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(250);

    document.getElementById("bulkInputCaptionPrompts").click();
    await sleep(30);
    bulkText.value = "文字一\\n文字二\\n文字三\\n多余文字";
    bulkText.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("applyBulkPrompts").click();
    await sleep(60);
    const overflowStayedOpen = !document.getElementById("bulkPromptModal").classList.contains("hidden");
    const overflowMessage = document.getElementById("bulkPromptCount").textContent;
    const afterRejectedOverflow = [...document.querySelectorAll(".caption-text")].map(el => el.value);

    bulkText.value = "文字一\\n文字二";
    bulkText.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("applyBulkPrompts").click();
    await sleep(80);
    const captionPrompts = [...document.querySelectorAll(".caption-text")].map(el => el.value);
    const statusAfterPartial = document.getElementById("status").textContent;

    document.getElementById("bulkInputCaptionPrompts").click();
    await sleep(30);
    bulkText.value = "覆盖一";
    bulkText.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("applyBulkPrompts").click();
    const start = Date.now();
    let ask = null;
    while (Date.now() - start < 1500) {
      ask = document.querySelector(".ask-dialog-overlay");
      if (ask) break;
      await sleep(20);
    }
    const overwriteAsked = !!ask;
    ask?.querySelector(".ask-dialog-cancel")?.click();
    await sleep(50);
    const afterDeclinedOverwrite = document.querySelector(".caption-text").value;
    document.getElementById("cancelBulkPrompts").click();

    return {
      comicModalOpened,
      comicCountBeforeApply,
      comicPrompts,
      overflowStayedOpen,
      overflowMessage,
      afterRejectedOverflow,
      captionPrompts,
      statusAfterPartial,
      overwriteAsked,
      afterDeclinedOverwrite,
    };
  })()`, true);

  assertQa(result.comicModalOpened, "The comic bulk-prompt button should open the shared dialog.", result);
  assertQa(result.comicCountBeforeApply.includes("4") && result.comicCountBeforeApply.includes("2"), "The dialog should show live input-line and current-row counts before applying.", result);
  assertQa(JSON.stringify(result.comicPrompts) === JSON.stringify(["镜头一", "", "镜头三", "镜头四"]), "Comic bulk input should expand to four panels and preserve the internal blank line as panel 2.", result);
  assertQa(result.overflowStayedOpen && result.overflowMessage.includes("4") && result.overflowMessage.includes("3"), "Caption bulk input must keep the dialog open and explain when prompts outnumber uploaded images.", result);
  assertQa(result.afterRejectedOverflow.every(value => value === ""), "Rejected caption overflow must not partially mutate any rows.", result);
  assertQa(JSON.stringify(result.captionPrompts) === JSON.stringify(["文字一", "文字二", ""]), "A shorter caption list should update only matching images and leave the remaining image unchanged.", result);
  assertQa(result.statusAfterPartial.includes("2") && result.statusAfterPartial.includes("1"), "Partial caption application should explicitly report applied and unchanged counts.", result);
  assertQa(result.overwriteAsked && result.afterDeclinedOverwrite === "文字一", "Existing prompt text must require confirmation and remain unchanged when overwrite is declined.", result);

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  try {
    await loadFresh(cdp, "ordered-bulk-prompts-mobile");
    const mobileLayout = await cdp.eval(`(async () => {
      document.querySelector('[data-mode="comic"]').click();
      await new Promise(r => setTimeout(r, 50));
      document.getElementById("bulkInputPanelPrompts").click();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const card = document.querySelector("#bulkPromptModal .modal-card").getBoundingClientRect();
      const textarea = document.getElementById("bulkPromptText").getBoundingClientRect();
      const actions = document.querySelector("#bulkPromptModal .bulk-prompt-actions").getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        card: { left: card.left, top: card.top, right: card.right, bottom: card.bottom },
        textarea: { left: textarea.left, right: textarea.right, height: textarea.height },
        actions: { left: actions.left, right: actions.right, bottom: actions.bottom },
        bodyOverflow: document.body.style.overflow,
      };
    })()`, true);
    const tolerance = 1;
    assertQa(
      mobileLayout.card.left >= -tolerance && mobileLayout.card.top >= -tolerance
        && mobileLayout.card.right <= mobileLayout.viewport.width + tolerance
        && mobileLayout.card.bottom <= mobileLayout.viewport.height + tolerance,
      "The bulk-prompt modal card must remain fully inside a 390x844 mobile viewport.",
      mobileLayout,
    );
    assertQa(
      mobileLayout.textarea.left >= mobileLayout.card.left - tolerance
        && mobileLayout.textarea.right <= mobileLayout.card.right + tolerance
        && mobileLayout.textarea.height >= 180,
      "The bulk textarea must stay inside the modal and remain comfortably editable on mobile.",
      mobileLayout,
    );
    assertQa(
      mobileLayout.actions.left >= mobileLayout.card.left - tolerance
        && mobileLayout.actions.right <= mobileLayout.card.right + tolerance
        && mobileLayout.actions.bottom <= mobileLayout.card.bottom + tolerance
        && mobileLayout.bodyOverflow === "hidden",
      "Mobile modal actions must stay visible and opening the modal must lock background scrolling.",
      mobileLayout,
    );
  } finally {
    await cdp.send("Emulation.clearDeviceMetricsOverride");
  }
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
  assertQa(result.helperPayload.proxyMode === "custom" && result.helperPayload.proxyUrl === "http://127.0.0.1:7890", "Proxy helper should append proxy fields to native payloads.", result);
  assertQa(result.invalidDidNotCall && /代理|proxy|URL/i.test(result.invalidStatus), "Invalid custom proxy should show an error and avoid native requests.", result);
  assertQa(result.stored.desktopProxyMode === "custom" && result.stored.desktopProxyCustomUrl === "127.0.0.1:7890", "Desktop proxy settings should persist globally.", result);
  assertQa(result.customDisabledAfterInvalid === false, "Custom proxy input should remain editable in custom mode.", result);
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
      set("apiEndpoint", "https://grsai.dakka.com.cn/v1/api/generate");
      set("apiKey", "sk-grsai");
      set("proxyEndpoint", "");
      loadGrsaiModels();
      const modelOptions = [...document.querySelectorAll("#modelChoices option")].filter(o => o.value).map(item => item.textContent.trim());

      window.fetch = async (url, opts = {}) => {
        const urlText = String(url);
        if (urlText.includes("/v1/api/generate")) {
          const body = JSON.parse(opts.body || "{}");
          calls.push({ url: urlText, body, auth: headerValue(opts.headers) });
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
          const body = asyncPolls === 1
            ? { id: "task-ok", status: "running", progress: 55 }
            : { id: "task-ok", status: "succeeded", progress: 100, results: [{ url: "https://img.test/final.png" }] };
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
      const asyncResult = await callImageAPI("async prompt", "1536x1024", 1, "GrsAI async", { maxRetries: 0 });
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
        nanoUrl: nano?.data?.[0]?.url || "",
        gptUrl: gpt?.data?.[0]?.url || "",
        asyncUrl: asyncResult?.data?.[0]?.url || "",
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
  assertQa(result.modelOptions.some(text => text.includes("nano-banana-2-2k-cl")) && result.modelOptions.some(text => text.includes("gpt-image-2-vip")), "GrsAI model picker should expose the official model set.", result);
  assertQa(nanoCall?.url === "https://grsai.dakka.com.cn/v1/api/generate", "GrsAI should normalize the configured endpoint to /v1/api/generate.", result);
  assertQa(nanoCall?.auth === "Bearer sk-grsai", "GrsAI requests should send Bearer authorization.", result);
  assertQa(nanoCall?.body.aspectRatio === "2:3" && nanoCall?.body.imageSize === "4K", "GrsAI nano-banana payload should map pixel size to official aspectRatio/imageSize.", result);
  assertQa(Array.isArray(nanoCall?.body.images) && nanoCall.body.images[0] && !/^data:/i.test(nanoCall.body.images[0]), "GrsAI reference images should be sent as base64/URL values, not data URLs.", result);
  assertQa(gptCall?.body.aspectRatio === "2048x2048" && !("imageSize" in gptCall.body), "GrsAI gpt-image payload should send pixel aspectRatio and omit nano imageSize.", result);
  assertQa(result.nanoUrl.includes("nano-banana-2-4k-cl") && result.gptUrl.includes("gpt-image-2-vip"), "GrsAI synchronous success responses should return image URLs.", result);
  assertQa(asyncCall && result.asyncUrl === "https://img.test/final.png" && result.resultCalls.some(call => call.url.includes("/v1/api/result?id=task-ok")), "GrsAI running responses should poll /v1/api/result until succeeded.", result);
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

async function testNativeSecureApiKeyMigration(cdp) {
  logStep("Native shells migrate API keys into system secure storage and redact localStorage without losing the active key");
  const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      localStorage.setItem("ai_image_gen_config", JSON.stringify({
        id: "secure_primary", name: "Secure API", apiProvider: "custom",
        endpoint: "https://api.example.test/v1/images/generations", apiKey: "sk-legacy-secret", model: "gpt-image-2"
      }));
      localStorage.setItem("ai_image_gen_apis", JSON.stringify([{
        id: "secure_primary", name: "Secure API", apiProvider: "custom",
        endpoint: "https://api.example.test/v1/images/generations", apiKey: "sk-legacy-secret", model: "gpt-image-2"
      }]));
      window.__AI_GEN_SECURE_STORAGE = true;
      window.__AI_GEN_NATIVE_PLATFORM = "windows";
      window.__secureSecrets = {};
      window.__secureCalls = [];
      window.FlutterDownload = {
        postMessage(raw) {
          const payload = JSON.parse(raw);
          window.__secureCalls.push(payload);
          let result = true;
          if (payload.action === "saveSecret") window.__secureSecrets[payload.key] = payload.value;
          if (payload.action === "loadSecret") result = window.__secureSecrets[payload.key] || "";
          if (payload.action === "deleteSecret") delete window.__secureSecrets[payload.key];
          setTimeout(() => window.AiGenAndroidBridge?.resolve(payload.id, result), 0);
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
        if (current.hasSecureKey && !current.apiKey) break;
        await new Promise(r => setTimeout(r, 30));
      }
      const current = JSON.parse(localStorage.getItem("ai_image_gen_config") || "{}");
      const saved = JSON.parse(localStorage.getItem("ai_image_gen_apis") || "[]");
      const inputBeforeReload = document.getElementById("apiKey").value;
      document.getElementById("apiKey").value = "";
      applyConfig(current);
      await new Promise(r => setTimeout(r, 120));
      return {
        current,
        saved,
        inputBeforeReload,
        inputAfterReload: document.getElementById("apiKey").value,
        saveCalls: window.__secureCalls.filter(call => call.action === "saveSecret"),
        loadCalls: window.__secureCalls.filter(call => call.action === "loadSecret"),
      };
    })()`, true);
    assertQa(result.current.hasSecureKey === true && result.current.apiKey === "", "The active native config must be redacted after secure storage succeeds.", result);
    assertQa(result.saved[0]?.hasSecureKey === true && result.saved[0]?.apiKey === "", "Saved API profiles must be redacted too.", result);
    assertQa(result.inputBeforeReload === "sk-legacy-secret" && result.inputAfterReload === "sk-legacy-secret", "Migration and secure reload must not lose the user's API key.", result);
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
    assertQa(result?.version === "1.3.20" && result.hasGenerateButton && result.controlled, "The PWA must load its versioned scripts and UI from cache while offline.", result);
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
    await testCustomSelects(cdp);
    await testApiConfig(cdp);
    await testReferencesAndAutoFill(cdp);
    await testOrderedBulkPromptInput(cdp);
    await testUploadDebounceWindow(cdp);
    await testComicProjectRestorePreservesReferencesAndFailures(cdp);
    await testCaptionProjectRestorePreservesReferencesAndFailures(cdp);
    await testHistoryRestoreAndExport(cdp);
    await testHistoryImageCacheFallback(cdp);
    await testHistoryPruneConcurrency(cdp);
    await testRetryReplacesHistoryEntry(cdp);
    await testSequentialToggleSharedAcrossModes(cdp);
    await testSaveComicFolder(cdp);
    await testRetryClearReloadAndI18n(cdp);
    await testRetryAllFailedCanCancelAndRestart(cdp);
    await testCardRetryAttemptDisplayAndStop(cdp);
    await testCancelDuringFirstAttempt(cdp);
    await testDesktopProxyControls(cdp);
    await testGrsaiOfficialAdapter(cdp);
    await testNativeDownloadTimeoutOptOut(cdp);
    await testNativeSecureApiKeyMigration(cdp);
    await testPwaOfflineCache(cdp);
    await testUpdateControls(cdp);
    await testStartupUpdatePrompt(cdp);
    await testDragDropHintReflectsPlatform(cdp);
    await testUploadZoneHintTargetsCorrectSpan(cdp);
    await testManualWheelScrollFallback(cdp);
    await testModelChoicesWheelScroll(cdp);
    await testModelComboboxBehavior(cdp);
    await testCaptionMode(cdp);
    await testCaptionAutoFill(cdp);
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
