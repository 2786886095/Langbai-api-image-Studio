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
  await cdp.eval(`location.href = ${JSON.stringify(`${appUrl}?${query}=`)} + Date.now()`);
  for (let i = 0; i < 80; i++) {
    const ready = await cdp.eval(`document.readyState === "complete" && !!document.getElementById("generateBtn")`);
    if (ready) {
      await sleep(150);
      return;
    }
    await sleep(100);
  }
  throw new Error("App did not become ready.");
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
      if (window.__downloadBlobs.length && !document.getElementById("downloadZip").disabled) break;
      await new Promise(r => setTimeout(r, 80));
    }
    const blobRec = window.__downloadBlobs[0];
    let zipText = "";
    if (blobRec) zipText = new TextDecoder().decode(await blobRec.blob.arrayBuffer());
    const zipEntries = blobRec ? await listZipEntries(blobRec.blob) : [];
    document.getElementById("zipFileName").value = "qa-header-export";
    document.getElementById("exportBtn").click();
    const headerExportStart = Date.now();
    while (Date.now() - headerExportStart < 5000) {
      if (window.__downloadBlobs.length >= 2 && !document.getElementById("downloadZip").disabled) break;
      await new Promise(r => setTimeout(r, 80));
    }
    const headerCurrentBlob = window.__downloadBlobs[1];
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
      if (window.__downloadBlobs.length >= 3) break;
      await new Promise(r => setTimeout(r, 80));
    }
    const projectBlob = window.__downloadBlobs[2];
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
  logStep("Comic-mode 'save to folder' button is mode-gated and saves every panel through the native bridge into one shared auto-created folder");
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

    document.getElementById("saveComicFolder").click();
    start = Date.now();
    while (Date.now() - start < 4000) {
      if (calls.filter(c => c.action === "saveFile").length >= 2) break;
      await new Promise(r => setTimeout(r, 80));
    }
    await new Promise(r => setTimeout(r, 50));

    const saveCalls = calls.filter(c => c.action === "saveFile");
    return {
      singleHidden,
      comicHidden,
      saveCallCount: saveCalls.length,
      folders: [...new Set(saveCalls.map(c => c.folder))],
      fileNames: [...new Set(saveCalls.map(c => c.fileName))],
      kinds: [...new Set(saveCalls.map(c => c.kind))],
      allHaveBase64: saveCalls.every(c => typeof c.base64 === "string" && c.base64.length > 0),
    };
  })()`, true);

  assertQa(result.singleHidden === true, "Save-to-folder button should stay hidden in single-image mode.", result);
  assertQa(result.comicHidden === false, "Save-to-folder button should become visible when switching to comic mode.", result);
  assertQa(result.saveCallCount === 2, "Saving a 2-panel comic result to a folder should call the native saveFile bridge once per panel.", result);
  assertQa(result.folders.length === 1 && !!result.folders[0], "All panels from one save-to-folder action should share the same auto-created folder name.", result);
  assertQa(result.kinds.length === 1 && result.kinds[0] === "images", "Folder save should use the 'images' download-directory kind, matching the existing image-dir picker.", result);
  assertQa(result.allHaveBase64, "Every saveFile call should carry the actual image bytes as base64.", result);
  assertQa(result.fileNames.length === 2, "Each panel should get a distinct filename within the shared folder.", result);
}

async function testRetryClearReloadAndI18n(cdp) {
  logStep("400-only retry, clear while generating, reload failed image, and i18n layout");
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
  assertQa(JSON.stringify(retry.retryRounds) === JSON.stringify([{ retryIndex: 1, maxRetries: 3 }, { retryIndex: 2, maxRetries: 3 }]), "HTTP 400 retry status should report the current retry round and total rounds.", retry);
  assertQa(retry.attempts400SuccessImmediately === 1 && retry.okImmediate === "image", "Successful image responses should stop retry immediately.", retry);
  assertQa(retry.attempts500 === 1 && retry.threw500, "Non-400 errors should not be retried.", retry);
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
      toolbarHidden: document.getElementById("resultToolbar").classList.contains("hidden"),
    };
    document.getElementById("clearResults").click();
    await new Promise(r => setTimeout(r, 120));
    return {
      during,
      after: {
        disabled: document.getElementById("generateBtn").disabled,
        gridHidden: document.getElementById("resultGrid").classList.contains("hidden"),
        toolbarHidden: document.getElementById("resultToolbar").classList.contains("hidden"),
        progressHidden: document.getElementById("progressWrap").classList.contains("hidden"),
      },
    };
  })()`, true);
  assertQa(clear.during.disabled, "Generate button should be disabled during generation.", clear);
  assertQa(!clear.after.disabled && clear.after.gridHidden && clear.after.toolbarHidden && clear.after.progressHidden, "Clear results should abort generation and reset UI.", clear);

  const reload = await cdp.eval(`(async () => {
    document.getElementById("resultGrid").classList.remove("hidden");
    document.getElementById("emptyState").classList.add("hidden");
    document.getElementById("resultToolbar").classList.remove("hidden");
    const originalFetch = window.fetch.bind(window);
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    let fetchCalls = 0;
    window.fetch = async (url, opts = {}) => {
      if (String(url).includes("mock-preview-image.png")) {
        fetchCalls++;
        if (fetchCalls === 1) throw new TypeError("initial preview cache failed");
        const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
        return new Response(bytes, { status: 200, headers: { "Content-Type": "image/png" } });
      }
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
      blobPreview: img.src.startsWith("blob:"),
      zipBlobSize: card._zipBlob?.size || 0,
      errorState: media.classList.contains("is-error"),
      loadingState: media.classList.contains("is-loading"),
    };
    window.fetch = originalFetch;
    return result;
  })()`, true);
  assertQa(reload.before !== reload.after && reload.blobPreview && reload.zipBlobSize > 0, "Failed image reload should fetch image bytes and switch preview to a local blob URL.", reload);
  assertQa(reload.fetchCalls >= 2 && !reload.errorState, "Reload should recover from direct preview failure using the same byte-fetch path as download.", reload);

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
    const start = Date.now();
    while (Date.now() - start < 5000) {
      // Retries now run concurrently: all four cards clear .is-failed and fire their
      // API calls almost simultaneously, well before their DOM is re-rendered. Wait
      // for the replacement <img> nodes too, or we snapshot mid-flight.
      if (document.querySelectorAll(".result-item.is-failed").length === 0
        && window.__batchRetryCalls.length === 4
        && document.querySelectorAll(".result-item img").length === 24) break;
      await new Promise(r => setTimeout(r, 80));
    }
    const after = {
      failedCount: document.querySelectorAll(".result-item.is-failed").length,
      imageCount: document.querySelectorAll(".result-item img").length,
      retryToolsHidden: document.getElementById("retryFailedTools").classList.contains("hidden"),
      retryCounts: cards.slice(0, 4).map(card => card._retryContext?.retryCount),
      calls: window.__batchRetryCalls,
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
        results.push({
          lang,
          header: document.querySelector(".header h1")?.innerText,
          badWords: ["undefined", "null", "NaN", "????"].filter(word => text.includes(word)),
          hasJaChinesePanel: lang === "ja" && text.includes("分镜"),
          overflows,
          languageCenter: langStyle.textAlign === "center" && langStyle.textAlignLast === "center",
          exportVisible: exportStyle.display !== "none" && exportStyle.visibility !== "hidden" && exportRect.width > 0 && exportRect.height > 0,
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
  const bad = flat.filter(item => item.badWords.length || item.hasJaChinesePanel || item.overflows.length || !item.languageCenter || !item.exportVisible);
  assertQa(bad.length === 0, "All supported languages should render without bad tokens, Japanese Chinese residue, or control overflow.", bad);
  const menuBad = i18n.filter(group => !group.menu.opened || !group.menu.changed);
  assertQa(menuBad.length === 0, "Language menu button should open and apply a selected language.", menuBad);
  const themeBad = i18n.filter(group => group.theme.before === group.theme.after);
  assertQa(themeBad.length === 0, "Theme toggle should switch between dark and light themes.", themeBad);
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
    window.__openExternalCalls = [];
    window.__origFetch = window.fetch;
    window.fetch = function(url, options) {
      if (String(url).includes("/releases/latest")) {
        return Promise.resolve(new Response(JSON.stringify({
          tag_name: ${JSON.stringify(tagName)},
          html_url: "https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/${tagName}",
          body: "## Mock release for testing",
          assets: [{ name: "AI-Image-Generator-Setup.exe", browser_download_url: "https://example.test/Setup.exe" }]
        }), { status: 200, headers: { "content-type": "application/json" } }));
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
    const nativeWindowsText = await cdp.eval(`document.querySelector(".image-upload .upload-zone span:last-child")?.textContent || ""`, false);
    assertQa(!/拖/.test(nativeWindowsText), "Packaged Windows exe should not tell users they can drag-and-drop reference images onto the upload zone.", { nativeWindowsText });
    assertQa(/点击/.test(nativeWindowsText), "The click-to-upload affordance (the working fallback) should still be advertised.", { nativeWindowsText });
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: "" });
  }

  await loadFresh(cdp, "dragdrop-browser");
  const browserText = await cdp.eval(`document.querySelector(".image-upload .upload-zone span:last-child")?.textContent || ""`, false);
  assertQa(/拖/.test(browserText), "Browser/PWA build (real Chromium, real drag-and-drop support) should still advertise drag-and-drop.", { browserText });
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
      window.open = originalOpen;
      return {
        platform: window.AiGenUpdate.getRuntimePlatform ? window.AiGenUpdate.getRuntimePlatform() : "unknown",
        installResult,
        openExternalCalls: calls.filter(c => c.action === "openExternal"),
        downloadUpdateCalls: calls.filter(c => c.action === "downloadUpdate"),
        openedUrls,
        status: document.getElementById("updateStatus")?.textContent || "",
      };
    })()`, true);
    assertQa(result.downloadUpdateCalls.length === 0, "Android should never invoke the native downloadUpdate/install bridge action.", result);
    assertQa(result.installResult?.opened === true && result.installResult?.url === "https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v9.9.9", "Android install click should resolve with the GitHub release page URL instead of downloading a package.", result);
    assertQa(result.openExternalCalls.length === 1 && result.openExternalCalls[0].url.includes("github.com/2786886095/Langbai-api-image-Studio/releases/tag/v9.9.9"), "Android should open the GitHub release page via the native openExternal bridge.", result);
    assertQa(/GitHub/.test(result.status), "Update status text should tell Android users to use the GitHub release page.", result);
  } finally {
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
    await testHistoryRestoreAndExport(cdp);
    await testRetryReplacesHistoryEntry(cdp);
    await testSequentialToggleSharedAcrossModes(cdp);
    await testSaveComicFolder(cdp);
    await testRetryClearReloadAndI18n(cdp);
    await testDesktopProxyControls(cdp);
    await testGrsaiOfficialAdapter(cdp);
    await testUpdateControls(cdp);
    await testStartupUpdatePrompt(cdp);
    await testDragDropHintReflectsPlatform(cdp);
    await testManualWheelScrollFallback(cdp);
    await testModelChoicesWheelScroll(cdp);
    await testModelComboboxBehavior(cdp);
    await testAndroidUpdateRedirect(cdp);
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
