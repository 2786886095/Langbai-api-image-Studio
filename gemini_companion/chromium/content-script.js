"use strict";

(() => {
  if (globalThis.__LANGBAI_GEMINI_COMPANION_STARTED) return;
  globalThis.__LANGBAI_GEMINI_COMPANION_STARTED = true;

  const SELECTORS = globalThis.LANGBAI_GEMINI_SELECTORS;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let running = false;
  let stopped = false;
  let bridge = null;

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function normalizedText(element) {
    return `${element?.getAttribute?.("aria-label") || ""} ${element?.textContent || ""}`.replace(/\s+/g, " ").trim();
  }

  function findByCandidates(candidates, selector = "button,[role=button],a") {
    const normalized = candidates.map(value => value.toLowerCase());
    return [...document.querySelectorAll(selector)].find(element => {
      if (!visible(element)) return false;
      const text = normalizedText(element).toLowerCase();
      return normalized.some(candidate => text === candidate || text.includes(candidate));
    }) || null;
  }

  function findComposer() {
    for (const selector of SELECTORS.composer) {
      const found = [...document.querySelectorAll(selector)].find(visible);
      if (found) return found;
    }
    return null;
  }

  async function state() {
    return chrome.storage.local.get({
      pairingKey: "",
      bridgePort: 0,
      enabled: true,
      profileId: "",
    });
  }

  async function discover(pairingKey, preferredPort = 0) {
    const ports = preferredPort ? [preferredPort, ...Array.from({ length: 40 }, (_, index) => 18160 + index).filter(port => port !== preferredPort)] : Array.from({ length: 40 }, (_, index) => 18160 + index);
    for (const port of ports) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
          headers: { Authorization: `Bearer ${pairingKey}` },
          cache: "no-store",
          signal: AbortSignal.timeout(500),
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok && body.provider === "gemini_web") {
          await chrome.storage.local.set({ bridgePort: port });
          return { base: `http://127.0.0.1:${port}/v1`, key: pairingKey };
        }
      } catch {}
    }
    return null;
  }

  async function bridgeFetch(path, options = {}) {
    if (!bridge) throw new Error("Langbai bridge is not paired");
    return fetch(`${bridge.base}/${path.replace(/^\/+/, "")}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${bridge.key}`,
        ...(options.headers || {}),
      },
      cache: "no-store",
    });
  }

  function maskedEmail() {
    const candidates = [...document.querySelectorAll('[aria-label*="@"]')];
    const text = candidates.map(normalizedText).find(value => value.includes("@")) || "";
    const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (!match) return "";
    const [name, domain] = match[0].split("@");
    return `${name.slice(0, 1)}***@${domain}`;
  }

  async function publishIdentity(config) {
    const temporary = !!findByCandidates(SELECTORS.temporaryChat);
    const imageAction = !!findByCandidates(SELECTORS.imageAction);
    const body = {
      browser_profile_id: config.profileId,
      display_name: "Gemini 浏览器账号",
      masked_email: maskedEmail(),
      status: findComposer() ? "ready" : "needs_login",
      temporary_chat_available: temporary,
      fullsize_download_available: true,
      effective_concurrency: 1,
      platform: navigator.platform || "browser",
      selector_pack_version: SELECTORS.version,
    };
    const response = await bridgeFetch("companion/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const snapshot = await response.json().catch(() => ({}));
    // Each browser profile must claim only tasks assigned to that profile.
    // Using the app-wide active account here would allow a different running
    // profile to execute work under the wrong login.
    bridge.accountId = snapshot.local_account_id || "";
    if (snapshot.selector_pack_compatible === false) {
      throw Object.assign(
        new Error(`Gemini selector pack mismatch; expected ${snapshot.expected_selector_pack_version || "the app version"}`),
        { code: "selector_pack_outdated" },
      );
    }
    return snapshot;
  }

  function historyDigest() {
    const links = [...document.querySelectorAll('a[href*="/app/"]')]
      .filter(visible)
      .slice(0, 80)
      .map(element => `${element.getAttribute("href")}|${normalizedText(element)}`);
    return { count: links.length, digest: links.join("\n") };
  }

  async function ensureTemporaryChat() {
    let button = findByCandidates(SELECTORS.temporaryChat);
    if (!button) throw Object.assign(new Error("未识别到 Gemini 临时对话入口"), { code: "selector_pack_outdated" });
    const isActive = element => {
      if (!(element instanceof Element)) return false;
      const stateNode = element.closest(
        '[aria-pressed="true"],[aria-selected="true"],[aria-current="page"],[data-state="active"],[data-selected="true"]',
      );
      return !!stateNode || /\b(active|selected|checked)\b/i.test(String(element.className || ""));
    };
    if (!isActive(button)) {
      button.click();
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        await sleep(250);
        button = findByCandidates(SELECTORS.temporaryChat);
        if (isActive(button)) return true;
      }
      throw Object.assign(
        new Error("已点击临时对话，但页面没有返回可验证的启用状态；任务未提交，以避免写入普通历史"),
        { code: "temporary_chat_unverified" },
      );
    }
    return true;
  }

  async function enableImageAction() {
    let action = findByCandidates(SELECTORS.imageAction);
    if (action) {
      action.click();
      await sleep(500);
      return;
    }
    const tools = findByCandidates(["Tools", "工具", "ツール", "도구"]);
    if (tools) {
      tools.click();
      await sleep(500);
      action = findByCandidates(SELECTORS.imageAction);
    }
    if (!action) throw Object.assign(new Error("未识别到 Gemini 生图入口"), { code: "image_action_missing" });
    action.click();
    await sleep(500);
  }

  function setComposerText(composer, text) {
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), "value")?.set;
      setter?.call(composer, text);
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    composer.textContent = text;
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  async function uploadReferences(references) {
    if (!Array.isArray(references) || references.length === 0) return;
    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw Object.assign(new Error("未识别到参考图上传入口"), { code: "reference_upload_failed" });
    const transfer = new DataTransfer();
    for (const reference of references) {
      const response = await fetch(reference.data_url);
      const blob = await response.blob();
      transfer.items.add(new File([blob], reference.file_name || `reference-${reference.index}.png`, { type: blob.type || "image/png" }));
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(1200);
  }

  function imageSnapshot() {
    return new Set([...document.images].map(image => image.currentSrc || image.src).filter(Boolean));
  }

  async function waitForGeneratedImage(previous, timeoutMs = 12 * 60 * 1000, heartbeat = null) {
    const deadline = Date.now() + timeoutMs;
    let lastHeartbeat = 0;
    while (Date.now() < deadline) {
      if (heartbeat && Date.now() - lastHeartbeat >= 10000) {
        await heartbeat();
        lastHeartbeat = Date.now();
      }
      const errors = [...document.querySelectorAll('[role="alert"],[aria-live="assertive"]')]
        .filter(visible)
        .map(normalizedText)
        .join(" ");
      if (/policy|safety|blocked|无法生成|不能生成|违规|quota|limit|繁忙|try again/i.test(errors)) {
        const code = /policy|safety|blocked|违规/i.test(errors) ? "moderation_blocked" : /quota|limit/i.test(errors) ? "gemini_rate_limited" : "gemini_service_busy";
        throw Object.assign(new Error(errors.slice(0, 500)), { code });
      }
      const candidates = [...document.images]
        .filter(image => visible(image) && image.naturalWidth >= 512 && image.naturalHeight >= 512)
        .filter(image => !previous.has(image.currentSrc || image.src))
        .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));
      if (candidates[0]) return candidates[0];
      await sleep(1200);
    }
    throw Object.assign(new Error("等待 Gemini 网页图片超时"), { code: "gemini_service_busy" });
  }

  async function fetchFullsize(image) {
    const urls = [];
    const responseContainer = image.closest(
      'article,[role="article"],[data-test-id*="response"],[data-message-id]',
    );
    const parentLink = image.closest("a[href]");
    if (parentLink?.href) urls.push(parentLink.href);
    if (responseContainer) {
      for (const link of responseContainer.querySelectorAll("a[href]")) {
        const text = normalizedText(link).toLowerCase();
        if (
          SELECTORS.fullsize.some(candidate => text.includes(candidate.toLowerCase()))
          || link.hasAttribute("download")
          || link.querySelector("img") === image
        ) {
          urls.push(link.href);
        }
      }
    }
    urls.push(image.currentSrc || image.src);
    const unique = [...new Set(urls.filter(Boolean))];
    let best = null;
    for (const url of unique.slice(0, 12)) {
      try {
        const response = await fetch(url, { credentials: "include", cache: "no-store" });
        if (!response.ok || !(response.headers.get("content-type") || "").startsWith("image/")) continue;
        const blob = await response.blob();
        if (!best || blob.size > best.size) best = blob;
      } catch {}
    }
    if (!best) throw Object.assign(new Error("未定位到可下载的完整尺寸图片"), { code: "fullsize_download_missing" });
    return best;
  }

  async function event(task, status, error = null, audit = null) {
    const response = await bridgeFetch(`companion/tasks/${encodeURIComponent(task.id)}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Langbai-Account-Id": bridge.accountId || "",
        "X-Langbai-Claim-Id": task.claim_id || "",
      },
      body: JSON.stringify({
        status,
        error,
        audit,
        account_id: bridge.accountId || "",
        claim_id: task.claim_id || "",
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (body?.status === "cancelled") {
      throw Object.assign(new Error("Gemini task was cancelled"), { code: "task_cancelled" });
    }
    if (!response.ok) {
      throw Object.assign(
        new Error(body?.error?.message || `Gemini companion event failed: HTTP ${response.status}`),
        { code: body?.error?.code || "companion_event_failed" },
      );
    }
    return body;
  }

  async function processTask(task) {
    const request = task.request || {};
    const before = historyDigest();
    const previous = imageSnapshot();
    try {
      await event(task, "preparing_temporary_chat");
      await ensureTemporaryChat();
      await event(task, "uploading_references");
      await uploadReferences(request.references || []);
      await event(task, "submitting");
      await enableImageAction();
      const composer = findComposer();
      if (!composer) throw Object.assign(new Error("未识别到 Gemini 输入框"), { code: "selector_pack_outdated" });
      setComposerText(composer, request.prompt || "");
      await sleep(300);
      const send = findByCandidates(SELECTORS.send);
      if (send) send.click();
      else composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      await event(task, "generating");
      const image = await waitForGeneratedImage(
        previous,
        12 * 60 * 1000,
        () => event(task, "generating"),
      );
      await event(task, "locating_full_size");
      const blob = await fetchFullsize(image);
      const after = historyDigest();
      const historyGuard = before.count === after.count && before.digest === after.digest ? "passed" : "failed";
      if (historyGuard !== "passed") {
        throw Object.assign(new Error("临时对话守卫检测到普通历史发生变化"), { code: "temporary_chat_guard_failed" });
      }
      const audit = {
        selector_pack_version: SELECTORS.version,
        temporary_chat_verified: true,
        history_guard: historyGuard,
        history_count_before: before.count,
        history_count_after: after.count,
        requested_size: `${request.requested_size?.width || 0}x${request.requested_size?.height || 0}`,
        downloaded_fullsize: `${image.naturalWidth}x${image.naturalHeight}`,
        final_size: `${image.naturalWidth}x${image.naturalHeight}`,
        transform: "none",
      };
      const auditHeader = btoa(unescape(encodeURIComponent(JSON.stringify(audit)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const result = await bridgeFetch(`companion/tasks/${encodeURIComponent(task.id)}/result`, {
        method: "POST",
        headers: {
          "Content-Type": blob.type || "image/png",
          "X-Langbai-Audit": auditHeader,
          "X-Langbai-Account-Id": bridge.accountId || "",
          "X-Langbai-Claim-Id": task.claim_id || "",
        },
        body: blob,
      });
      if (!result.ok) throw new Error(`保存图片失败：HTTP ${result.status}`);
    } catch (error) {
      if (error?.code === "task_cancelled") return;
      const protocolFailure = ["temporary_chat_guard_failed", "temporary_chat_unverified", "selector_pack_outdated"].includes(error.code);
      await event(task, protocolFailure ? "protocol_changed" : error.code === "gemini_login_required" ? "needs_login" : "failed", {
        code: error.code || "gemini_web_failed",
        message: String(error.message || error).slice(0, 1000),
      }).catch(() => {});
    }
  }

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const config = await state();
      if (!config.enabled || !/^[a-f0-9]{64}$/.test(config.pairingKey || "") || !config.profileId) return;
      bridge = await discover(config.pairingKey, Number(config.bridgePort || 0));
      if (!bridge) return;
      await publishIdentity(config);
      const response = await bridgeFetch("companion/tasks/next", {
        headers: { "X-Langbai-Account-Id": bridge.accountId || "" },
      });
      if (response.status === 204) return;
      if (!response.ok) return;
      const task = await response.json();
      if (task?.id) await processTask(task);
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "langbai-wake") void tick();
  });
  const timer = setInterval(() => void tick(), 2500);
  addEventListener("pagehide", () => {
    stopped = true;
    clearInterval(timer);
  }, { once: true });
  void tick();
})();
