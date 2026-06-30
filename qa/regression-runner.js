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
    ws.addEventListener("message", event => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const item = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) item.reject(new Error(JSON.stringify(msg.error)));
        else item.resolve(msg.result);
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
    window.prompt = () => "qa-api";
    window.confirm = () => true;
    document.getElementById("openApiConfig").click();
    await new Promise(r => setTimeout(r, 50));
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("apiEndpoint", "https://www.huanapi.com/v1/images/edits");
    set("apiKey", "sk-qa-1234567890");
    set("model", "gpt-image-2");
    set("proxyEndpoint", "http://127.0.0.1:8787/proxy");
    document.getElementById("saveConfig").click();
    await new Promise(r => setTimeout(r, 80));
    return {
      configOpen: document.getElementById("configSection").open,
      selected: document.getElementById("savedApis").value,
      apis: JSON.parse(localStorage.getItem("ai_image_gen_apis") || "[]"),
      active: JSON.parse(localStorage.getItem("ai_image_gen_config") || "{}"),
      quick: document.getElementById("apiQuickTitle").textContent,
    };
  })()`, true);
  assertQa(saveResult.configOpen, "API config should remain open after saving.", saveResult);
  assertQa(saveResult.apis.length === 1, "Saved API list should contain one record.", saveResult);
  assertQa(saveResult.active.endpoint.includes("huanapi"), "Active API config should be persisted.", saveResult);
  assertQa(saveResult.quick.includes("已接入"), "API quick card should show connected state.", saveResult);

  await cdp.eval("location.reload()");
  await sleep(700);
  const reloadDelete = await cdp.eval(`(async () => {
    const before = {
      endpoint: document.getElementById("apiEndpoint").value,
      key: document.getElementById("apiKey").value,
      model: document.getElementById("model").value,
      proxy: document.getElementById("proxyEndpoint").value,
      configOpen: document.getElementById("configSection").open,
    };
    document.getElementById("openApiConfig").click();
    await new Promise(r => setTimeout(r, 50));
    window.confirm = () => true;
    document.getElementById("savedApis").value = "0";
    document.getElementById("deleteSavedApi").click();
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

  await loadFresh(cdp, "api-mobile", { width: 430, height: 560, mobile: true });
  const mobile = await cdp.eval(`(async () => {
    document.getElementById("openApiConfig").click();
    await new Promise(r => setTimeout(r, 80));
    const body = document.querySelector("#configSection .config-body");
    const save = document.getElementById("saveConfig");
    body.scrollTop = 9999;
    await new Promise(r => setTimeout(r, 80));
    const rect = save.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      body: {
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
        scrollTop: body.scrollTop,
        overflowY: getComputedStyle(body).overflowY,
        maxHeight: getComputedStyle(body).maxHeight,
      },
      saveVisible: rect.top >= 0 && rect.bottom <= innerHeight,
      saveClickable: save === hit || save.contains(hit),
    };
  })()`, true);
  assertQa(mobile.body.overflowY === "auto" && mobile.body.scrollHeight > mobile.body.clientHeight, "Mobile API config body should scroll internally.", mobile);
  assertQa(mobile.saveVisible && mobile.saveClickable, "Mobile API save button should be reachable and clickable after scrolling.", mobile);
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
    document.getElementById("zipFileName").value = "qa-side-rail-export";
    document.getElementById("exportBtn").click();
    const sideExportStart = Date.now();
    while (Date.now() - sideExportStart < 5000) {
      if (window.__downloadBlobs.length >= 2 && !document.getElementById("downloadZip").disabled) break;
      await new Promise(r => setTimeout(r, 80));
    }
    const sideCurrentBlob = window.__downloadBlobs[1];
    const sideCurrentEntries = sideCurrentBlob ? await listZipEntries(sideCurrentBlob.blob) : [];
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
      sideRailCurrent: {
        download: window.__downloads.find(item => item.download === "qa-side-rail-export.zip") || null,
        blob: sideCurrentBlob ? { size: sideCurrentBlob.size, type: sideCurrentBlob.type } : null,
        entries: sideCurrentEntries,
      },
      sideRailHistory: {
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
  assertQa(result.sideRailCurrent.download?.download === "qa-side-rail-export.zip", "Side rail export should download current result images.", result);
  assertQa(result.sideRailCurrent.blob?.type === "application/zip" && result.sideRailCurrent.entries.includes("comic-project/prompts.txt"), "Side rail current export should produce a valid ZIP.", result);
  assertQa(result.sideRailHistory.opened && result.sideRailHistory.projectCards === 1, "Side rail export should open history when current results are empty.", result);
  assertQa(result.sideRailHistory.projectButtons.some(text => text.includes("导出") || text.includes("Export")), "History project cards should expose project export after side rail export.", result);
  assertQa(result.sideRailHistory.projectExport?.type === "application/zip" && result.sideRailHistory.projectExport.entries.some(name => name.endsWith("/project.json")), "History project export button should create a valid project ZIP.", result);
  assertQa(result.directDownload.clicked && result.directDownload.immediateRevokes === 0, "Browser download should not revoke its object URL immediately.", result);
  assertQa(result.buttonDisabled === false, "Generate button should reset after generation.", result);
}

async function testRetryClearReloadAndI18n(cdp) {
  logStep("400-only retry, clear while generating, reload failed image, and i18n layout");
  await loadFresh(cdp, "misc");
  const retry = await cdp.eval(`(async () => {
    let attempts400 = 0;
    const ok400 = await retryTransient(async () => {
      attempts400++;
      if (attempts400 < 3) throw new Error("HTTP 400: busy");
      return "ok";
    }, { maxRetries: 3, baseDelay: 1 });
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
    return { attempts400, ok400, attempts500, threw500 };
  })()`, true);
  assertQa(retry.attempts400 === 3 && retry.ok400 === "ok", "HTTP 400 should retry until success.", retry);
  assertQa(retry.attempts500 === 1 && retry.threw500, "Non-400 errors should not be retried.", retry);

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
    const card = document.createElement("div");
    card.className = "result-item";
    document.getElementById("resultGrid").appendChild(card);
    replacePlaceholder(card, 1, { data: [{ url: "http://127.0.0.1:8765/missing-preview.png" }] }, "panel only", {
      skipHistory: true,
      retryContext: { mode: "comic", globalPrompt: "global", panelPrompt: "panel only", prompt: "global\\n\\npanel only" },
    });
    const img = card.querySelector("img");
    const button = card.querySelector(".result-media-reload");
    img.dispatchEvent(new Event("error"));
    const before = img.src;
    button.click();
    await new Promise(r => setTimeout(r, 60));
    return { before, after: img.src, cacheBust: /_reload=/.test(img.src) };
  })()`, true);
  assertQa(reload.before !== reload.after && reload.cacheBust, "Failed image reload should re-request the image with a cache-busting URL.", reload);

  const resultGrid = await cdp.eval(`(async () => {
    localStorage.clear();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const set = (id, value) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
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
      if (document.querySelectorAll(".result-item.is-failed").length === 0 && window.__batchRetryCalls.length === 4) break;
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
        const nodes = [...document.querySelectorAll("button,.btn,.btn-sm,.btn-xs,.mode-tab,.rail-item,.language-select")]
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
        results.push({
          lang,
          header: document.querySelector(".header h1")?.innerText,
          rail: [...document.querySelectorAll(".rail-item")].map(el => el.innerText.trim()),
          badWords: ["undefined", "null", "NaN", "????"].filter(word => text.includes(word)),
          hasJaChinesePanel: lang === "ja" && text.includes("分镜"),
          overflows,
          languageCenter: langStyle.textAlign === "center" && langStyle.textAlignLast === "center",
        });
      }
      return results;
    })()`, true);
    i18n.push({ viewport: viewport.name, item });
  }
  const flat = i18n.flatMap(group => group.item.map(item => ({ viewport: group.viewport, ...item })));
  const bad = flat.filter(item => item.badWords.length || item.hasJaChinesePanel || item.overflows.length || !item.languageCenter);
  assertQa(bad.length === 0, "All supported languages should render without bad tokens, Japanese Chinese residue, or control overflow.", bad);
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
    await testApiConfig(cdp);
    await testReferencesAndAutoFill(cdp);
    await testHistoryRestoreAndExport(cdp);
    await testRetryClearReloadAndI18n(cdp);
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
