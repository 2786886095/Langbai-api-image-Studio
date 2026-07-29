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
    temporaryChatExit: [
      "Exit temporary chat", "Turn off temporary chat",
      "退出临时对话", "关闭临时对话", "結束臨時對話", "關閉臨時對話",
      "一時的なチャットを終了", "一時的なチャットをオフ",
      "임시 채팅 종료", "임시 채팅 끄기",
    ],
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

  async function postMessageNativeCommand(type, payload, timeoutMs) {
    const requestId = `gemini_native_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        removeEventListener("message", listener);
        reject(Object.assign(new Error("Native command timed out"), { code: "gemini_native_command_timeout" }));
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
            { code: data.error.code || "gemini_native_command_failed" },
          ));
          return;
        }
        resolve(data.response);
      };
      addEventListener("message", listener);
      const command = {
        source: "langbai-gemini-executor",
        type,
        requestId,
        ...(type === "native-request" ? { payload } : payload),
      };
      if (
        type !== "native-request"
        && typeof globalThis.__LANGBAI_GEMINI_NATIVE_REPORT === "function"
      ) {
        globalThis.__LANGBAI_GEMINI_NATIVE_REPORT(command);
      } else {
        postMessage(command, "*");
      }
    });
  }

  async function postMessageNativeRequest(payload, timeoutMs) {
    return nativeResponse(await postMessageNativeCommand(
      "native-request",
      payload,
      timeoutMs,
    ));
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

  function describeControl(element) {
    if (!(element instanceof Element)) return null;
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      ariaPressed: element.getAttribute("aria-pressed") || "",
      ariaSelected: element.getAttribute("aria-selected") || "",
      ariaExpanded: element.getAttribute("aria-expanded") || "",
      dataState: element.getAttribute("data-state") || "",
      disabled: element.matches(":disabled,[aria-disabled=true]"),
      className: String(element.className || "").slice(0, 240),
      attributes: Object.fromEntries(
        [...element.attributes]
          .slice(0, 24)
          .map(attribute => [attribute.name, attribute.value.slice(0, 180)]),
      ),
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  function temporaryChatStateSnapshot() {
    const matching = [...document.querySelectorAll(
      'button,[role="button"],[aria-label],[title],h1,h2,h3,[role="heading"]',
    )]
      .filter(element => /temporary chat|临时对话|臨時對話|一時的なチャット|임시 채팅/i.test(normalizedText(element)))
      .slice(0, 20)
      .map(element => [
        element.tagName.toLowerCase(),
        element.getAttribute("aria-label") || "",
        String(element.className || "").slice(0, 100),
        String(element.parentElement?.className || "").slice(0, 100),
        normalizedText(element.parentElement).slice(0, 120),
      ]);
    const active = document.activeElement;
    return {
      url: location.href,
      title: document.title,
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      active: normalizedText(active).slice(0, 120),
      matching,
      historyCount: historyDigest().count,
    };
  }

  function isTemporaryChatSurfaceActive() {
    return [...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
      .filter(visible)
      .some(element => /temporary chat|临时对话|臨時對話|一時的なチャット|임시 채팅/i.test(normalizedText(element)));
  }

  async function activateControl(element) {
    if (!(element instanceof Element)) {
      throw Object.assign(
        new Error("The requested Gemini control is missing."),
        { code: "gemini_control_missing" },
      );
    }
    const config = readEmbeddedConfig() || {};
    const platform = String(config.platform || "").toLowerCase();
    if (!config.embedded || platform !== "windows") {
      element.click();
      return;
    }
    if (element.matches(":disabled,[aria-disabled=true]")) {
      throw Object.assign(
        new Error("The requested Gemini control is disabled."),
        { code: "gemini_control_disabled" },
      );
    }
    element.scrollIntoView({ block: "center", inline: "center" });
    await sleep(80);
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (
      rect.width <= 0
      || rect.height <= 0
      || x < 0
      || y < 0
      || x >= innerWidth
      || y >= innerHeight
    ) {
      throw Object.assign(
        new Error(`Gemini control is outside the active viewport: ${JSON.stringify(describeControl(element))}`),
        { code: "gemini_control_outside_viewport" },
      );
    }
    const hit = document.elementFromPoint(x, y);
    if (!(hit instanceof Element) || !(hit === element || element.contains(hit) || hit.contains(element))) {
      throw Object.assign(
        new Error(
          `Gemini control is covered by another element: target=${JSON.stringify(describeControl(element))}`
          + ` hit=${JSON.stringify(describeControl(hit))}`,
        ),
        { code: "gemini_control_occluded" },
      );
    }
    await postMessageNativeCommand(
      "trusted-click-request",
      { x, y },
      10000,
    );
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
    const allTemporaryChatLabels = [
      ...SELECTORS.temporaryChat,
      ...(SELECTORS.temporaryChatExit || []),
    ];
    let button = findByCandidates(allTemporaryChatLabels);
    if (!button) throw Object.assign(new Error("未识别到 Gemini 临时对话入口"), { code: "selector_pack_outdated" });
    const isActive = element => {
      if (!(element instanceof Element)) return false;
      const stateNode = element.closest(
        '[aria-pressed="true"],[aria-selected="true"],[aria-current="page"],[data-state="active"],[data-selected="true"]',
      );
      const text = normalizedText(element).toLowerCase();
      const exitLabel = (SELECTORS.temporaryChatExit || [])
        .some(candidate => text.includes(candidate.toLowerCase()));
      return !!stateNode
        || exitLabel
        || /\b(active|selected|checked|toggled)\b/i.test(String(element.className || ""));
    };
    if (!isActive(button) && !isTemporaryChatSurfaceActive()) {
      const beforeUrl = location.href;
      const beforeText = normalizedText(button);
      const beforeState = temporaryChatStateSnapshot();
      const inputTrace = [];
      const traceInput = event => {
        const target = event.target instanceof Element ? event.target : null;
        inputTrace.push({
          type: event.type,
          trusted: event.isTrusted === true,
          target: target?.tagName?.toLowerCase?.() || "",
          ariaLabel: target?.getAttribute?.("aria-label") || "",
        });
      };
      const tracedEvents = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
      tracedEvents.forEach(type => document.addEventListener(type, traceInput, true));
      writeTemporaryChatCheckpoint(taskId);
      await activateControl(button);
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        await sleep(250);
        button = findByCandidates(allTemporaryChatLabels);
        if (
          isActive(button)
          || isTemporaryChatSurfaceActive()
          || location.href !== beforeUrl
        ) {
          tracedEvents.forEach(type => document.removeEventListener(type, traceInput, true));
          clearTemporaryChatCheckpoint(taskId);
          return true;
        }
      }
      tracedEvents.forEach(type => document.removeEventListener(type, traceInput, true));
      clearTemporaryChatCheckpoint(taskId);
      const afterText = normalizedText(button);
      const afterState = temporaryChatStateSnapshot();
      const overlays = [...document.querySelectorAll(
        '[role="dialog"],[role="menu"],[role="menuitem"],[aria-modal="true"]',
      )]
        .filter(visible)
        .slice(0, 12)
        .map(element => ({
          role: element.getAttribute("role") || "",
          text: normalizedText(element).slice(0, 180),
        }));
      throw Object.assign(
        new Error(
          `已点击临时对话，但页面没有返回可验证的启用状态；任务未提交，以避免写入普通历史。`
          + ` before=${JSON.stringify(beforeText.slice(0, 160))}`
          + ` after=${JSON.stringify(afterText.slice(0, 160))}`
          + ` urlChanged=${location.href !== beforeUrl}`
          + ` stateChanged=${JSON.stringify(beforeState) !== JSON.stringify(afterState)}`
          + ` state=${JSON.stringify(afterState)}`
          + ` trustedEvents=${inputTrace.map(event => `${event.type}:${event.trusted ? 1 : 0}`).join(",")}`
          + ` overlays=${JSON.stringify(overlays)}`,
        ),
        { code: "temporary_chat_unverified" },
      );
    }
    return true;
  }

  async function enableImageAction() {
    let action = findByCandidates(SELECTORS.imageAction);
    if (action) {
      await activateControl(action);
      await sleep(500);
      return true;
    }
    const tools = findByCandidates(["Tools", "工具", "ツール", "도구"]);
    if (tools) {
      await activateControl(tools);
      await sleep(500);
      action = findByCandidates(SELECTORS.imageAction);
    }
    if (!action) return false;
    await activateControl(action);
    await sleep(500);
    return true;
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
    const failures = [];
    for (const url of unique.slice(0, 12)) {
      try {
        const response = await fetch(url, { credentials: "include", cache: "no-store" });
        if (!response.ok) {
          failures.push(`page:${response.status}:${new URL(url, location.href).hostname}`);
          continue;
        }
        const blob = await response.blob();
        const contentType = response.headers.get("content-type") || blob.type || "";
        if (
          blob.size > 0
          && (
            contentType.startsWith("image/")
            || url.startsWith("blob:")
            || url.startsWith("data:image/")
          )
          && (!best || blob.size > best.size)
        ) best = blob;
      } catch (error) {
        failures.push(`page:${String(error?.name || error)}:${String(url).slice(0, 120)}`);
      }
      if (
        /^https:\/\//i.test(url)
        && readEmbeddedConfig()?.embedded
        && String(readEmbeddedConfig()?.platform || "").toLowerCase() === "windows"
      ) {
        try {
          const downloaded = await postMessageNativeCommand(
            "image-download-request",
            { url },
            90000,
          );
          const bytes = decodeBase64(downloaded?.bodyBase64 || downloaded?.body_base64);
          const blob = new Blob(
            [bytes],
            { type: downloaded?.contentType || downloaded?.content_type || "application/octet-stream" },
          );
          if (blob.size > 0 && (!best || blob.size > best.size)) best = blob;
        } catch (error) {
          failures.push(`native:${error?.code || error?.name || "error"}:${new URL(url).hostname}`);
        }
      }
    }
    if (!best) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        best = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      } catch (error) {
        failures.push(`canvas:${String(error?.name || error)}`);
      }
    }
    if (!best) {
      throw Object.assign(
        new Error(
          `未定位到可下载的完整尺寸图片。sources=${JSON.stringify(unique.map(url => String(url).slice(0, 180)).slice(0, 8))}`
          + ` failures=${JSON.stringify(failures.slice(0, 12))}`,
        ),
        { code: "fullsize_download_missing" },
      );
    }
    return best;
  }

  function requestedOutputSize(request = {}) {
    const width = Math.round(Number(request.requested_size?.width || 0));
    const height = Math.round(Number(request.requested_size?.height || 0));
    if (
      !Number.isFinite(width)
      || !Number.isFinite(height)
      || width < 1
      || height < 1
      || width > 8192
      || height > 8192
      || width * height > 40_000_000
    ) {
      throw Object.assign(new Error("全局分辨率无效或超出本地处理上限"), {
        code: "invalid_output_dimensions",
      });
    }
    return { width, height };
  }

  async function decodeImageBlob(blob) {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    }
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Gemini full-size image could not be decoded"));
        image.src = url;
      });
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob
          ? resolve(blob)
          : reject(Object.assign(new Error("精确尺寸图片编码失败"), { code: "image_encode_failed" })),
        "image/png",
      );
    });
  }

  async function transformForRequestedOutput(blob, request = {}) {
    const decoded = await decodeImageBlob(blob);
    const source = { width: decoded.width, height: decoded.height };
    try {
      const sizeMode = String(request.size_mode || "native_fullsize");
      if (!["exact_output", "local_4k_upscale"].includes(sizeMode)) {
        return {
          blob,
          source,
          final: source,
          transform: "none",
        };
      }

      const target = requestedOutputSize(request);
      if (source.width === target.width && source.height === target.height) {
        return {
          blob,
          source,
          final: target,
          transform: "none",
        };
      }

      const cropMode = request.crop_mode === "contain" ? "contain" : "smart_cover";
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) {
        throw Object.assign(new Error("当前内置浏览器不支持图片尺寸处理"), {
          code: "canvas_unavailable",
        });
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      let sourceRect = [0, 0, source.width, source.height];
      let targetRect = [0, 0, target.width, target.height];
      let transform = "safe_zone_center_crop+high_quality_resample";
      if (cropMode === "contain") {
        const scale = Math.min(target.width / source.width, target.height / source.height);
        const drawWidth = Math.max(1, Math.round(source.width * scale));
        const drawHeight = Math.max(1, Math.round(source.height * scale));
        targetRect = [
          Math.floor((target.width - drawWidth) / 2),
          Math.floor((target.height - drawHeight) / 2),
          drawWidth,
          drawHeight,
        ];
        context.clearRect(0, 0, target.width, target.height);
        transform = "contain+high_quality_resample";
      } else {
        const scale = Math.max(target.width / source.width, target.height / source.height);
        const cropWidth = Math.min(source.width, target.width / scale);
        const cropHeight = Math.min(source.height, target.height / scale);
        sourceRect = [
          Math.max(0, Math.round((source.width - cropWidth) / 2)),
          Math.max(0, Math.round((source.height - cropHeight) / 2)),
          Math.max(1, Math.round(cropWidth)),
          Math.max(1, Math.round(cropHeight)),
        ];
      }

      context.drawImage(decoded.source, ...sourceRect, ...targetRect);
      return {
        blob: await canvasToPngBlob(canvas),
        source,
        final: target,
        transform,
      };
    } finally {
      decoded.close();
    }
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
      const explicitImageAction = await enableImageAction();
      const composer = findComposer();
      if (!composer) throw Object.assign(new Error("未识别到 Gemini 输入框"), { code: "selector_pack_outdated" });
      const requestedPrompt = String(request.prompt || "").trim();
      const prompt = explicitImageAction
        ? requestedPrompt
        : `请生成一张图片，不要只回复文字。\n\n${requestedPrompt}`;
      setComposerText(composer, prompt);
      await sleep(300);
      const send = findByCandidates(SELECTORS.send);
      if (send) await activateControl(send);
      else composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      await event(task, "generating");
      const image = await waitForGeneratedImage(
        previous,
        0,
        () => event(task, "generating"),
      );
      await event(task, "locating_full_size");
      const downloadedBlob = await fetchFullsize(image);
      const processed = await transformForRequestedOutput(downloadedBlob, request);
      const blob = processed.blob;
      const after = historyDigest();
      const historyGuard = before.count === after.count && before.digest === after.digest ? "passed" : "failed";
      if (historyGuard !== "passed") {
        throw Object.assign(new Error("临时对话守卫检测到普通历史发生变化"), { code: "temporary_chat_guard_failed" });
      }
      const audit = {
        selector_pack_version: SELECTORS.version,
        image_action_mode: explicitImageAction ? "explicit_tool" : "direct_pro_prompt",
        temporary_chat_verified: true,
        history_guard: historyGuard,
        history_count_before: before.count,
        history_count_after: after.count,
        requested_size: `${request.requested_size?.width || 0}x${request.requested_size?.height || 0}`,
        downloaded_fullsize: `${processed.source.width}x${processed.source.height}`,
        final_size: `${processed.final.width}x${processed.final.height}`,
        transform: processed.transform,
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
