"use strict";

(() => {
  // WebView2 injects document-created scripts into child frames as well. Only
  // the top-level Gemini document may claim and execute an image task.
  if (globalThis.top !== globalThis) return;
  if (globalThis.__LANGBAI_GEMINI_COMPANION_STARTED) return;
  globalThis.__LANGBAI_GEMINI_COMPANION_STARTED = true;

  const TEMPORARY_CHAT_CHECKPOINT_KEY = "langbai_gemini_temporary_chat_checkpoint_v1";
  const SELECTORS = globalThis.LANGBAI_GEMINI_SELECTORS || Object.freeze({
    version: "2026.07.29.1",
    temporaryChat: ["Temporary chat", "临时对话", "臨時對話", "一時的なチャット", "임시 채팅"],
    imageAction: ["Create image", "Generate image", "生成图片", "產生圖片", "画像を生成", "이미지 생성"],
    send: ["Send message", "Submit", "发送", "傳送", "送信", "보내기"],
    fullsize: ["Download full size", "Download original", "下载完整尺寸", "下載完整尺寸", "元のサイズをダウンロード", "전체 크기 다운로드"],
    composer: ['div[contenteditable="true"][role="textbox"]', "textarea[aria-label]", "textarea"],
  });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const STORAGE_UUID_KEY = "langbai_gemini_local_account_uuid_v1";
  let running = false;
  let stopped = false;
  let bridge = null;
  let fallbackAccountUuid = "";
  let lastNativeReportSignature = "";

  function extensionStorageAvailable() {
    return typeof chrome !== "undefined" && !!chrome.storage?.local;
  }

  function extensionRuntimeAvailable() {
    return typeof chrome !== "undefined" && !!chrome.runtime?.onMessage;
  }

  function readEmbeddedConfig() {
    let value = globalThis.__LANGBAI_GEMINI_EMBEDDED_CONFIG;
    if (typeof value === "function") {
      try { value = value(); }
      catch { value = null; }
    }
    if (typeof value === "string") {
      try { value = JSON.parse(value); }
      catch { value = null; }
    }
    return value && typeof value === "object" ? value : null;
  }

  function normalizeUuid(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return UUID_PATTERN.test(normalized) ? normalized : "";
  }

  function createUuid() {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function localAccountUuid(config = {}) {
    const configured = normalizeUuid(
      config.accountUuid
      || config.account_uuid
      || config.localAccountUuid
      || config.local_account_uuid
      || config.profileId
      || config.profile_id,
    );
    if (configured) return configured;
    try {
      const stored = normalizeUuid(localStorage.getItem(STORAGE_UUID_KEY));
      if (stored) return stored;
      const created = createUuid();
      localStorage.setItem(STORAGE_UUID_KEY, created);
      return created;
    } catch {
      fallbackAccountUuid ||= createUuid();
      return fallbackAccountUuid;
    }
  }

  function normalizeBaseUrl(value) {
    const raw = String(value || "").trim().replace(/\/+$/, "");
    if (!raw) return "";
    try {
      const parsed = new URL(raw);
      if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)) return "";
      if (parsed.protocol !== "http:") return "";
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      if (!parsed.pathname.endsWith("/v1")) parsed.pathname += "/v1";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/+$/, "").replace("localhost", "127.0.0.1");
    } catch {
      return "";
    }
  }

  function headersObject(value) {
    if (value instanceof Headers) return Object.fromEntries(value.entries());
    if (Array.isArray(value)) return Object.fromEntries(value);
    return { ...(value || {}) };
  }

  function decodeBase64(value) {
    const binary = atob(String(value || "").replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function encodeBase64(bytes) {
    const view = bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
    const chunks = [];
    const chunkSize = 0x8000;
    for (let offset = 0; offset < view.length; offset += chunkSize) {
      chunks.push(String.fromCharCode(...view.subarray(offset, offset + chunkSize)));
    }
    return btoa(chunks.join(""));
  }

  async function serializableRequestBody(body, headers) {
    if (body == null) return { body: null };
    if (body instanceof Blob) {
      const contentType = body.type || headers["Content-Type"] || headers["content-type"] || "application/octet-stream";
      return {
        bodyBase64: encodeBase64(new Uint8Array(await body.arrayBuffer())),
        contentType,
      };
    }
    if (body instanceof ArrayBuffer) {
      return {
        bodyBase64: encodeBase64(new Uint8Array(body)),
        contentType: headers["Content-Type"] || headers["content-type"] || "application/octet-stream",
      };
    }
    if (ArrayBuffer.isView(body)) {
      return {
        bodyBase64: encodeBase64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)),
        contentType: headers["Content-Type"] || headers["content-type"] || "application/octet-stream",
      };
    }
    return { body: typeof body === "string" ? body : String(body) };
  }

  function nativeResponse(value) {
    if (value instanceof Response) return value;
    if (!value || typeof value !== "object") {
      throw Object.assign(new Error("Native transport returned no response"), { code: "gemini_native_transport_invalid" });
    }
    const status = Number(value.status || value.statusCode || 0);
    if (!Number.isFinite(status) || status < 100 || status > 599) {
      throw Object.assign(new Error("Native transport returned an invalid HTTP status"), { code: "gemini_native_transport_invalid" });
    }
    const responseHeaders = new Headers(value.headers || {});
    let body = value.body ?? value.text ?? "";
    if (typeof value.bodyBase64 === "string" || typeof value.body_base64 === "string") {
      body = decodeBase64(value.bodyBase64 || value.body_base64);
    } else if (
      body &&
      typeof body === "object" &&
      !(body instanceof Blob) &&
      !(body instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(body)
    ) {
      body = JSON.stringify(body);
      if (!responseHeaders.has("content-type")) {
        responseHeaders.set("content-type", "application/json");
      }
    }
    return new Response(body, {
      status,
      statusText: String(value.statusText || ""),
      headers: responseHeaders,
    });
  }

  async function postMessageNativeRequest(payload, timeoutMs) {
    const requestId = `gemini_native_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        removeEventListener("message", listener);
        reject(Object.assign(new Error("Native transport RPC timed out"), { code: "gemini_native_transport_timeout" }));
      }, timeoutMs);
      const listener = event => {
        const data = event?.data;
        if (
          data?.source !== "langbai-gemini-native"
          || data?.type !== "native-response"
          || data?.requestId !== requestId
        ) return;
        clearTimeout(timeout);
        removeEventListener("message", listener);
        if (data.error) {
          reject(Object.assign(
            new Error(data.error.message || data.error),
            { code: data.error.code || "gemini_native_transport_failed" },
          ));
          return;
        }
        try { resolve(nativeResponse(data.response)); }
        catch (error) { reject(error); }
      };
      addEventListener("message", listener);
      postMessage({
        source: "langbai-gemini-executor",
        type: "native-request",
        requestId,
        payload,
      }, "*");
    });
  }

  async function nativeTransportFetch(url, options, config) {
    const requestHook = config?.nativeRequest
      || config?.native_request
      || globalThis.__LANGBAI_GEMINI_NATIVE_REQUEST;
    const requestHeaders = headersObject(options?.headers);
    const payload = {
      url,
      method: String(options?.method || "GET").toUpperCase(),
      headers: requestHeaders,
      ...(await serializableRequestBody(options?.body, requestHeaders)),
      cache: options?.cache || "no-store",
    };
    const timeoutMs = Number(config?.nativeRequestTimeoutMs || config?.native_request_timeout_ms || 30000);
    if (typeof requestHook === "function") {
      return nativeResponse(await requestHook(payload));
    }
    if (config?.nativeTransport === "postMessage" || config?.native_transport === "postMessage") {
      return postMessageNativeRequest(payload, timeoutMs);
    }
    throw Object.assign(
      new Error("Embedded Gemini execution requires window.__LANGBAI_GEMINI_NATIVE_REQUEST(payload) because page fetch may be blocked by Gemini CSP"),
      { code: "gemini_native_transport_required" },
    );
  }

  async function gatewayFetch(url, options, config) {
    if (config?.embedded) {
      try {
        return await nativeTransportFetch(url, options, config);
      } catch (error) {
        notifyNative("transport_error", {
          status: "failed",
          code: error?.code || "gemini_native_transport_failed",
          message: String(error?.message || error),
        });
        throw error;
      }
    }
    return fetch(url, options);
  }

  function notifyNative(type, payload = {}) {
    const config = readEmbeddedConfig() || {};
    const message = {
      source: "langbai-gemini-executor",
      type,
      at: new Date().toISOString(),
      account_uuid: localAccountUuid(config),
      ...payload,
    };
    const signature = JSON.stringify([type, message.status, message.code, message.account_id]);
    if (signature === lastNativeReportSignature) return;
    lastNativeReportSignature = signature;
    try { config.reportStatus?.(message); } catch {}
    try { globalThis.__LANGBAI_GEMINI_NATIVE_REPORT?.(message); } catch {}
    try { globalThis.chrome?.webview?.postMessage?.(message); } catch {}
    try { globalThis.webkit?.messageHandlers?.langbaiGemini?.postMessage?.(message); } catch {}
    try {
      dispatchEvent(new CustomEvent("langbai-gemini-native-report", { detail: message }));
    } catch {}
  }

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
    const embedded = readEmbeddedConfig();
    if (embedded) {
      const accountUuid = localAccountUuid(embedded);
      return {
        pairingKey: String(embedded.pairingKey || embedded.pairing_key || embedded.apiKey || embedded.api_key || ""),
        bridgePort: Number(embedded.bridgePort || embedded.bridge_port || embedded.port || 0),
        bridgeBaseUrl: normalizeBaseUrl(embedded.baseUrl || embedded.base_url || embedded.gatewayUrl || embedded.gateway_url),
        enabled: embedded.enabled !== false,
        profileId: String(embedded.profileId || embedded.profile_id || `embedded:${accountUuid}`),
        accountUuid,
        displayName: String(embedded.displayName || embedded.display_name || "Gemini 嵌入账号"),
        nativeRequest: embedded.nativeRequest || embedded.native_request || null,
        nativeTransport: embedded.nativeTransport || embedded.native_transport || "",
        nativeRequestTimeoutMs: Number(embedded.nativeRequestTimeoutMs || embedded.native_request_timeout_ms || 30000),
        embedded: true,
      };
    }
    if (!extensionStorageAvailable()) return null;
    const stored = await chrome.storage.local.get({
      pairingKey: "",
      bridgePort: 0,
      enabled: true,
      profileId: "",
      accountUuid: "",
    });
    const accountUuid = localAccountUuid(stored);
    if (!normalizeUuid(stored.accountUuid)) {
      await chrome.storage.local.set({ accountUuid });
    }
    return { ...stored, accountUuid, embedded: false };
  }

  async function discover(config) {
    const pairingKey = config.pairingKey;
    const preferredPort = Number(config.bridgePort || 0);
    const preferredBaseUrl = config.bridgeBaseUrl || "";
    const preferredBase = normalizeBaseUrl(preferredBaseUrl);
    if (preferredBase) {
      try {
        const response = await gatewayFetch(`${preferredBase.replace(/\/v1$/, "")}/healthz`, {
          headers: { Authorization: `Bearer ${pairingKey}` },
          cache: "no-store",
          signal: AbortSignal.timeout(1000),
        }, config);
        const body = await response.json().catch(() => ({}));
        if (response.ok && body.provider === "gemini_web") {
          return { base: preferredBase, key: pairingKey, config };
        }
      } catch (error) {
        if (config.embedded) throw error;
      }
    }
    const ports = preferredPort ? [preferredPort, ...Array.from({ length: 40 }, (_, index) => 18160 + index).filter(port => port !== preferredPort)] : Array.from({ length: 40 }, (_, index) => 18160 + index);
    for (const port of ports) {
      try {
        const response = await gatewayFetch(`http://127.0.0.1:${port}/healthz`, {
          headers: { Authorization: `Bearer ${pairingKey}` },
          cache: "no-store",
          signal: AbortSignal.timeout(500),
        }, config);
        const body = await response.json().catch(() => ({}));
        if (response.ok && body.provider === "gemini_web") {
          if (extensionStorageAvailable()) {
            await chrome.storage.local.set({ bridgePort: port });
          }
          return { base: `http://127.0.0.1:${port}/v1`, key: pairingKey, config };
        }
      } catch (error) {
        if (config.embedded) throw error;
      }
    }
    return null;
  }

  async function bridgeFetch(path, options = {}) {
    if (!bridge) throw new Error("Langbai bridge is not paired");
    return gatewayFetch(`${bridge.base}/${path.replace(/^\/+/, "")}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${bridge.key}`,
        ...(options.headers || {}),
      },
      cache: "no-store",
    }, bridge.config);
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
    const status = findComposer() ? "ready" : "needs_login";
    const body = {
      browser_profile_id: config.profileId,
      account_uuid: config.accountUuid,
      display_name: String(config.displayName || config.display_name || "Gemini 浏览器账号"),
      masked_email: maskedEmail(),
      status,
      temporary_chat_available: temporary,
      fullsize_download_available: true,
      effective_concurrency: 1,
      platform: config.embedded ? `embedded:${navigator.platform || "webview"}` : (navigator.platform || "browser"),
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
    bridge.accountUuid = snapshot.account_uuid || config.accountUuid || "";
    if (snapshot.selector_pack_compatible === false) {
      throw Object.assign(
        new Error(`Gemini selector pack mismatch; expected ${snapshot.expected_selector_pack_version || "the app version"}`),
        { code: "selector_pack_outdated" },
      );
    }
    notifyNative("login_state", {
      status,
      login_ready: status === "ready",
      account_id: bridge.accountId,
      account_uuid: bridge.accountUuid,
      masked_email: body.masked_email,
    });
    return snapshot;
  }

  async function reportAccountStatus(status, error = null) {
    const payload = {
      account_id: bridge?.accountId || "",
      account_uuid: bridge?.accountUuid || "",
      status,
      login_ready: status === "ready",
      error,
    };
    notifyNative(
      status === "quota_exhausted" || status === "rate_limited"
        ? "quota_error"
        : "account_state",
      {
        ...payload,
        code: error?.code || "",
        message: error?.message || "",
      },
    );
    if (!bridge?.accountId) return null;
    const response = await bridgeFetch("companion/account-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Langbai-Account-Id": bridge.accountId,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Object.assign(
        new Error(body?.error?.message || `Gemini account report failed: HTTP ${response.status}`),
        { code: body?.error?.code || "gemini_account_report_failed" },
      );
    }
    const snapshot = await response.json().catch(() => ({}));
    const nextAccountId = String(snapshot?.active_account_id || "");
    if (nextAccountId && nextAccountId !== bridge.accountId) {
      notifyNative("account_switch_requested", {
        status: "switching_account",
        active_account_id: nextAccountId,
        previous_account_id: bridge.accountId,
      });
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

  function readTemporaryChatCheckpoint() {
    try {
      const value = JSON.parse(sessionStorage.getItem(TEMPORARY_CHAT_CHECKPOINT_KEY) || "null");
      if (
        value
        && typeof value.taskId === "string"
        && Number.isFinite(Number(value.createdAt))
        && Date.now() - Number(value.createdAt) < 2 * 60 * 1000
      ) return value;
    } catch {}
    return null;
  }

  function writeTemporaryChatCheckpoint(taskId) {
    try {
      sessionStorage.setItem(TEMPORARY_CHAT_CHECKPOINT_KEY, JSON.stringify({
        taskId: String(taskId || ""),
        createdAt: Date.now(),
        sourceUrl: location.href,
      }));
    } catch {}
  }

  function clearTemporaryChatCheckpoint(taskId = "") {
    try {
      const current = readTemporaryChatCheckpoint();
      if (!taskId || !current || current.taskId === String(taskId)) {
        sessionStorage.removeItem(TEMPORARY_CHAT_CHECKPOINT_KEY);
      }
    } catch {}
  }

  async function ensureTemporaryChat(task) {
    const taskId = String(task?.id || "");
    const navigationCheckpoint = readTemporaryChatCheckpoint();
    if (navigationCheckpoint?.taskId === taskId) {
      // Clicking Gemini's temporary-chat control performs a full document
      // navigation in the current UI. The old JavaScript context disappears
      // before it can observe aria-pressed. The gateway returns the same claim
      // after reload, so this checkpoint is the verifiable continuation point.
      clearTemporaryChatCheckpoint(taskId);
      return true;
    }
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
      writeTemporaryChatCheckpoint(taskId);
      button.click();
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        await sleep(250);
        button = findByCandidates(SELECTORS.temporaryChat);
        if (isActive(button)) {
          clearTemporaryChatCheckpoint(taskId);
          return true;
        }
      }
      clearTemporaryChatCheckpoint(taskId);
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

  function classifyVisibleFailure(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    if (/policy|safety|blocked|无法生成|不能生成|违规/i.test(text)) {
      return { code: "moderation_blocked", status: "failed" };
    }
    if (/quota exhausted|no .*quota|额度(?:已)?(?:用完|耗尽|不足)|配额(?:已)?(?:用完|耗尽|不足)/i.test(text)) {
      return { code: "quota_exhausted", status: "quota_exhausted" };
    }
    if (/rate.?limit|too many requests|稍后再试|请求过多|\blimit\b/i.test(text)) {
      return { code: "gemini_rate_limited", status: "rate_limited" };
    }
    if (/sign.?in|log.?in|session expired|登录|登入|会话已过期/i.test(text)) {
      return { code: "gemini_login_required", status: "needs_login" };
    }
    if (/繁忙|try again|temporarily unavailable|service unavailable/i.test(text)) {
      return { code: "gemini_service_busy", status: "failed" };
    }
    return null;
  }

  async function waitForGeneratedImage(previous, timeoutMs = 0, heartbeat = null) {
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
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
      const failure = classifyVisibleFailure(errors);
      if (failure) {
        throw Object.assign(
          new Error(errors.slice(0, 500)),
          { code: failure.code, accountStatus: failure.status },
        );
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
      await ensureTemporaryChat(task);
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
        0,
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
      const terminalStatus = protocolFailure
        ? "protocol_changed"
        : error.code === "gemini_login_required"
          ? "needs_login"
          : "failed";
      const accountStatus = error?.accountStatus
        || (error.code === "quota_exhausted"
          ? "quota_exhausted"
          : error.code === "gemini_rate_limited"
            ? "rate_limited"
            : error.code === "gemini_login_required"
              ? "needs_login"
              : "");
      const reportError = {
        code: error.code || "gemini_web_failed",
        message: String(error.message || error).slice(0, 1000),
      };
      await event(task, terminalStatus, reportError).catch(() => {});
      if (accountStatus) {
        await reportAccountStatus(accountStatus, reportError).catch(nativeError => {
          notifyNative("account_report_error", {
            status: accountStatus,
            code: nativeError?.code || "gemini_account_report_failed",
            message: String(nativeError?.message || nativeError),
          });
        });
      }
    }
  }

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const config = await state();
      if (!config) {
        notifyNative("configuration_error", {
          status: "failed",
          code: "gemini_embedded_config_missing",
          message: "No embedded config or extension storage is available",
        });
        return;
      }
      if (!config.enabled) return;
      if (!/^[a-f0-9]{64}$/.test(config.pairingKey || "") || !config.profileId) {
        notifyNative("configuration_error", {
          status: "failed",
          code: "invalid_pairing_config",
          message: "Gemini pairing key or local profile UUID is missing",
        });
        return;
      }
      bridge = await discover(config);
      if (!bridge) {
        notifyNative("transport_error", {
          status: "failed",
          code: "gemini_gateway_unavailable",
          message: "The local Gemini gateway was not found",
        });
        return;
      }
      await publishIdentity(config);
      const response = await bridgeFetch("companion/tasks/next", {
        headers: { "X-Langbai-Account-Id": bridge.accountId || "" },
      });
      if (response.status === 204) return;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        notifyNative("gateway_error", {
          status: "failed",
          code: body?.error?.code || "gemini_gateway_error",
          message: body?.error?.message || `HTTP ${response.status}`,
          account_id: bridge.accountId || "",
        });
        return;
      }
      const task = await response.json();
      if (task?.id) await processTask(task);
    } catch (error) {
      notifyNative("executor_error", {
        status: "failed",
        code: error?.code || "gemini_executor_failed",
        message: String(error?.message || error),
        account_id: bridge?.accountId || "",
      });
    } finally {
      running = false;
    }
  }

  if (extensionRuntimeAvailable()) {
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === "langbai-wake") void tick();
    });
  }
  addEventListener("langbai-gemini-wake", () => void tick());
  addEventListener("langbai-gemini-config-changed", () => {
    bridge = null;
    void tick();
  });
  const timer = setInterval(() => void tick(), 2500);
  addEventListener("pagehide", () => {
    stopped = true;
    clearInterval(timer);
  }, { once: true });
  void tick();
})();
