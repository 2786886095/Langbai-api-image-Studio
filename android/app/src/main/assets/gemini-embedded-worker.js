"use strict";

const LANGBAI_GEMINI_TEMPORARY_CHAT_STATE = (() => {
  const GEMINI_HOME_URL = "https://gemini.google.com/app";

  function conversationKey(value) {
    try {
      const parsed = new URL(String(value || ""), GEMINI_HOME_URL);
      if (parsed.hostname !== "gemini.google.com") return "";
      const match = parsed.pathname.match(/^\/app\/([^/?#]+)/);
      return match ? `/app/${decodeURIComponent(match[1])}` : "";
    } catch {
      return "";
    }
  }

  function isOrdinaryConversationUrl(value) {
    return !!conversationKey(value);
  }

  function activationEvidence(snapshot = {}) {
    const reasons = [];
    if (snapshot.controlActive === true) reasons.push("active_control_state");
    if (snapshot.exitControlVisible === true) reasons.push("exit_control");
    if (snapshot.activeExplanationVisible === true) reasons.push("temporary_chat_explanation");
    return Object.freeze({
      active: reasons.length > 0,
      reasons: Object.freeze(reasons),
    });
  }

  function trustedActivationEvidence(snapshot = {}) {
    const accepted = snapshot.exactControl === true
      && snapshot.trustedClick === true
      && snapshot.loginReady === true
      && snapshot.overlayVisible !== true
      && !isOrdinaryConversationUrl(snapshot.url);
    return Object.freeze({
      active: accepted,
      reasons: Object.freeze(accepted ? ["trusted_temporary_chat_control"] : []),
    });
  }

  function preparationAction(snapshot = {}) {
    const evidence = activationEvidence(snapshot);
    if (evidence.active) return Object.freeze({ action: "verified", evidence });
    if (snapshot.controlVisible === true) {
      return Object.freeze({ action: "activate_control", evidence });
    }
    if (isOrdinaryConversationUrl(snapshot.url)) {
      return Object.freeze({
        action: "navigate_home",
        homeUrl: GEMINI_HOME_URL,
        evidence,
      });
    }
    return Object.freeze({ action: "wait_for_surface", evidence });
  }

  function normalizeHistorySnapshot(entries = [], currentUrl = "") {
    const byKey = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
      const key = conversationKey(entry?.href);
      if (!key) continue;
      const previous = byKey.get(key);
      byKey.set(key, {
        key,
        active: entry?.active === true || previous?.active === true,
      });
    }
    const normalizedEntries = [...byKey.values()]
      .sort((left, right) => left.key.localeCompare(right.key));
    return Object.freeze({
      entries: Object.freeze(normalizedEntries.map(Object.freeze)),
      keys: Object.freeze(normalizedEntries.map(entry => entry.key)),
      currentKey: conversationKey(currentUrl),
    });
  }

  function assessHistoryMutation(before = {}, after = {}) {
    const beforeKeys = new Set(Array.isArray(before.keys) ? before.keys : []);
    const afterEntries = Array.isArray(after.entries) ? after.entries : [];
    const addedEntries = afterEntries.filter(entry => !beforeKeys.has(entry.key));
    const currentKey = String(after.currentKey || "");
    const currentOrdinaryConversationAdded = !!currentKey
      && addedEntries.some(entry => entry.key === currentKey && entry.active === true);
    if (currentOrdinaryConversationAdded) {
      return Object.freeze({
        status: "ordinary_conversation_added",
        warning: "当前普通会话已新增到 Gemini 历史；图片已生成并保存，不会自动重新提交。",
        addedKeys: Object.freeze(addedEntries.map(entry => entry.key)),
      });
    }
    if (addedEntries.length > 0) {
      return Object.freeze({
        status: "sidebar_changed",
        warning: "Gemini 历史侧栏异步变化，但未确认当前任务写入普通历史；图片已保留。",
        addedKeys: Object.freeze(addedEntries.map(entry => entry.key)),
      });
    }
    return Object.freeze({
      status: "passed",
      warning: "",
      addedKeys: Object.freeze([]),
    });
  }

  function isGeneratedImageCandidate(snapshot = {}) {
    const nodeOrResourceChanged = snapshot.wasPresentBefore !== true
      || snapshot.resourceSignatureChanged === true;
    const belongsToSubmittedResponse = snapshot.responseChanged === true
      || (
        snapshot.hasResponseContainer === true
        && snapshot.responseContainerWasPresentBefore !== true
      );
    return snapshot.submissionAcknowledged === true
      && nodeOrResourceChanged
      && belongsToSubmittedResponse;
  }

  function loginReadiness(snapshot = {}) {
    const composerPresent = snapshot.composerPresent === true;
    const signedOutMarkerPresent = snapshot.signedOutMarkerPresent === true;
    const authenticatedMarkerPresent =
      snapshot.authenticatedMarkerPresent === true;
    const ready = composerPresent
      && authenticatedMarkerPresent
      && !signedOutMarkerPresent;
    return Object.freeze({
      ready,
      composerPresent,
      signedOutMarkerPresent,
      authenticatedMarkerPresent,
      reason: ready
        ? "authenticated"
        : signedOutMarkerPresent
          ? "signed_out"
          : !composerPresent
            ? "composer_missing"
            : "authenticated_marker_missing",
    });
  }

  function taskResumeAction(snapshot = {}) {
    if (snapshot.resumedClaim !== true) return "start";
    const status = String(snapshot.status || "");
    if (["submitting", "generating", "locating_full_size"].includes(status)) {
      return "fail_unknown_submission";
    }
    if (status === "uploading_references") return "restart_before_submission";
    return "resume_preparation";
  }

  return Object.freeze({
    GEMINI_HOME_URL,
    conversationKey,
    isOrdinaryConversationUrl,
    activationEvidence,
    trustedActivationEvidence,
    preparationAction,
    normalizeHistorySnapshot,
    assessHistoryMutation,
    isGeneratedImageCandidate,
    loginReadiness,
    taskResumeAction,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = LANGBAI_GEMINI_TEMPORARY_CHAT_STATE;
}

(() => {
  // WebView2 injects document-created scripts into child frames as well. Only
  // the top-level Gemini document may claim and execute an image task.
  if (globalThis.top !== globalThis) return;
  if (globalThis.__LANGBAI_GEMINI_COMPANION_STARTED) return;
  globalThis.__LANGBAI_GEMINI_COMPANION_STARTED = true;

  const TEMPORARY_CHAT_CHECKPOINT_KEY = "langbai_gemini_temporary_chat_checkpoint_v1";
  const SELECTORS = globalThis.LANGBAI_GEMINI_SELECTORS || Object.freeze({
    version: "2026.07.30.6",
    temporaryChat: [
      "Temporary chat", "Start temporary chat", "Turn on temporary chat",
      "临时对话", "临时聊天", "发起临时对话", "发起临时聊天",
      "臨時對話", "臨時聊天", "發起臨時對話", "發起臨時聊天",
      "一時的なチャット", "一時チャット", "임시 채팅",
    ],
    temporaryChatExit: [
      "Exit temporary chat", "Turn off temporary chat",
      "退出临时对话", "关闭临时对话", "結束臨時對話", "關閉臨時對話",
      "一時的なチャットを終了", "一時的なチャットをオフ",
      "임시 채팅 종료", "임시 채팅 끄기",
    ],
    temporaryChatCss: ['[data-test-id="temp-chat-button"]'],
    temporaryChatActiveText: [
      "Ask in a temporary chat", "Temporary chats aren't saved",
      "在临时对话中提问", "在临时聊天中提问", "临时对话不会保存", "临时聊天不会保存",
      "在臨時對話中提問", "在臨時聊天中提問", "臨時對話不會儲存", "臨時聊天不會儲存",
      "一時的なチャットで質問", "一時チャットで質問", "임시 채팅에서 질문",
    ],
    temporaryChatActiveCss: [
      '[data-test-id="temp-chat-button"][aria-pressed="true"]',
      '[data-test-id="temp-chat-button"][aria-selected="true"]',
      '[data-test-id="temp-chat-button"][data-state="active"]',
    ],
    historyLinkCss: ['a[href*="/app/"]'],
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
          event.source !== window
          || event.origin !== location.origin
          ||
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
      if (typeof __LANGBAI_GEMINI_NATIVE_SEND === "function") {
        __LANGBAI_GEMINI_NATIVE_SEND(command);
      } else if (
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
    try {
      if (typeof __LANGBAI_GEMINI_NATIVE_SEND === "function") {
        __LANGBAI_GEMINI_NATIVE_SEND(message);
      } else {
        globalThis.__LANGBAI_GEMINI_NATIVE_REPORT?.(message);
        globalThis.chrome?.webview?.postMessage?.(message);
        globalThis.webkit?.messageHandlers?.langbaiGemini?.postMessage?.(message);
      }
    } catch {}
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
    return [
      element?.getAttribute?.("aria-label") || "",
      element?.getAttribute?.("title") || "",
      element?.getAttribute?.("placeholder") || "",
      element?.getAttribute?.("data-tooltip") || "",
      element?.textContent || "",
    ].join(" ").replace(/\s+/g, " ").trim();
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
      .filter(element => /temporary chat|临时对话|临时聊天|臨時對話|臨時聊天|一時的なチャット|一時チャット|임시 채팅/i.test(normalizedText(element)))
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
      historyCount: historyDigest().keys.length,
    };
  }

  function candidatePattern(candidates = []) {
    return candidates
      .map(value => String(value || "").trim().toLowerCase())
      .filter(Boolean);
  }

  function textMatchesCandidates(text, candidates = []) {
    const normalized = String(text || "").toLowerCase();
    return candidatePattern(candidates).some(candidate => normalized.includes(candidate));
  }

  function findTemporaryChatControl() {
    for (const selector of SELECTORS.temporaryChatCss || []) {
      const found = [...document.querySelectorAll(selector)].find(visible);
      if (found) {
        // Gemini currently puts data-test-id on a <gem-icon-button> wrapper
        // and the actual event handler on its nested native <button>. Clicking
        // the wrapper's centre can produce trusted pointer events without
        // activating the Angular control, leaving Temporary Chat off.
        return found.matches("button,[role=button],a")
          ? found
          : found.querySelector("button,[role=button],a")
            || found.closest("button,[role=button],a")
            || found;
      }
    }
    return findByCandidates(
      [
        ...(SELECTORS.temporaryChat || []),
        ...(SELECTORS.temporaryChatExit || []),
      ],
      'button,[role="button"],a,[data-test-id],[aria-label],[title]',
    );
  }

  function temporaryChatActivationSnapshot() {
    const control = findTemporaryChatControl();
    const controlActive = !!control?.closest?.(
      '[aria-pressed="true"],[aria-selected="true"],[aria-current="page"],[data-state="active"],[data-selected="true"]',
    ) || (SELECTORS.temporaryChatActiveCss || [])
      .some(selector => [...document.querySelectorAll(selector)].some(visible));
    const exitControlVisible = [...document.querySelectorAll(
      'button,[role="button"],[role="tooltip"],[aria-label],[title],[data-tooltip]',
    )]
      .filter(visible)
      .some(element => textMatchesCandidates(
        normalizedText(element),
        SELECTORS.temporaryChatExit || [],
      ));
    const activeExplanationVisible = [...document.querySelectorAll(
      'h1,h2,h3,[role="heading"],[role="status"],[aria-label],[title],[placeholder],[data-test-id]',
    )]
      .filter(visible)
      .some(element => textMatchesCandidates(
        normalizedText(element),
        SELECTORS.temporaryChatActiveText || [],
      ));
    return {
      control,
      controlVisible: !!control,
      controlActive,
      exitControlVisible,
      activeExplanationVisible,
    };
  }

  function temporaryChatActivationEvidence() {
    return LANGBAI_GEMINI_TEMPORARY_CHAT_STATE.activationEvidence(
      temporaryChatActivationSnapshot(),
    );
  }

  function isTemporaryChatSurfaceActive() {
    return temporaryChatActivationEvidence().active;
  }

  async function waitForTemporaryChatSurface(timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    do {
      const control = findTemporaryChatControl();
      if (control || isTemporaryChatSurfaceActive()) return control;
      await sleep(250);
    } while (Date.now() < deadline);
    return null;
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

  function loginSurfaceSnapshot() {
    const signedOutMarkerPresent = !!document.querySelector([
      '[data-test-id="signed-out-disclaimer"]',
      '[data-test-id="mavatar-sign-in-icon-button"]',
      ".signed-out-buttons",
    ].join(","));
    const authenticatedMarkerPresent = !!document.querySelector([
      'a[href*="SignOutOptions"]',
      'a[href*="/Logout"]',
      'a[href*="accounts.google.com"][aria-label*="@"]',
      '[role="button"][aria-label*="@"]',
    ].join(","));
    return {
      composerPresent: !!findComposer(),
      signedOutMarkerPresent,
      authenticatedMarkerPresent,
    };
  }

  function geminiLoginReadiness() {
    return LANGBAI_GEMINI_TEMPORARY_CHAT_STATE.loginReadiness(
      loginSurfaceSnapshot(),
    );
  }

  function isGeminiLoginReady() {
    return geminiLoginReadiness().ready;
  }

  async function waitForGeminiLoginReady(timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    do {
      const login = geminiLoginReadiness();
      if (login.ready) return login;
      if (login.reason === "signed_out") return login;
      await sleep(250);
    } while (Date.now() < deadline);
    return geminiLoginReadiness();
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
    const directProtocolAvailable =
      typeof globalThis.LANGBAI_GEMINI_DIRECT_PROTOCOL?.generate === "function";
    const temporary = directProtocolAvailable
      || !!findTemporaryChatControl()
      || isTemporaryChatSurfaceActive();
    const login = geminiLoginReadiness();
    const status = login.ready
      ? "ready"
      : login.reason === "signed_out"
        ? "needs_login"
        : "unknown";
    const body = {
      browser_profile_id: config.profileId,
      account_uuid: config.accountUuid,
      display_name: String(config.displayName || config.display_name || "Gemini 浏览器账号"),
      masked_email: maskedEmail(),
      status,
      temporary_chat_available: temporary,
      direct_protocol_available: directProtocolAvailable,
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
    const serverAccount = Array.isArray(snapshot.accounts)
      ? snapshot.accounts.find(account => (
        account?.local_account_id === bridge.accountId
        || account?.account_uuid === bridge.accountUuid
      ))
      : null;
    const blockedAccountState = !!serverAccount && (
      serverAccount.login_ready === false
      || ["needs_login", "session_expired", "protocol_changed", "rate_limited", "quota_exhausted"].includes(serverAccount.status)
      || ["cooldown", "exhausted"].includes(serverAccount.quota_state)
    );
    const generationReady = login.ready
      && temporary
      && serverAccount?.generation_ready === true;
    const claimRecoveryReady = login.ready
      && snapshot.selector_pack_compatible !== false
      && serverAccount?.login_ready === true
      && !blockedAccountState;
    notifyNative("login_state", {
      status: generationReady
        ? "ready"
        : login.ready
          ? (serverAccount?.status || "logged_in")
          : status,
      login_ready: login.ready,
      generation_ready: generationReady,
      account_id: bridge.accountId,
      account_uuid: bridge.accountUuid,
      masked_email: body.masked_email,
      temporary_chat_available: temporary,
      direct_protocol_available: directProtocolAvailable,
      fullsize_download_available: true,
      selector_pack_compatible: snapshot.selector_pack_compatible !== false,
      login_reason: login.reason,
    });
    return {
      snapshot,
      login,
      generationReady,
      claimRecoveryReady,
      serverAccount,
    };
  }

  async function reportAccountStatus(status, error = null) {
    const loginReady = !["needs_login", "session_expired", "authentication_failed"].includes(status);
    const payload = {
      account_id: bridge?.accountId || "",
      account_uuid: bridge?.accountUuid || "",
      status,
      login_ready: loginReady,
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
    const selectors = SELECTORS.historyLinkCss?.length
      ? SELECTORS.historyLinkCss.join(",")
      : 'a[href*="/app/"]';
    const entries = [...document.querySelectorAll(selectors)]
      .slice(0, 500)
      .map(element => ({
        href: element.getAttribute("href") || "",
        active: !!element.closest(
          '[aria-current="page"],[aria-selected="true"],[data-state="active"],[data-selected="true"]',
        ),
      }));
    return LANGBAI_GEMINI_TEMPORARY_CHAT_STATE.normalizeHistorySnapshot(
      entries,
      location.href,
    );
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

  function writeTemporaryChatCheckpoint(taskId, details = {}) {
    try {
      const previous = readTemporaryChatCheckpoint();
      const sameTask = previous?.taskId === String(taskId || "");
      sessionStorage.setItem(TEMPORARY_CHAT_CHECKPOINT_KEY, JSON.stringify({
        taskId: String(taskId || ""),
        createdAt: Date.now(),
        sourceUrl: location.href,
        phase: String(details.phase || (sameTask ? previous.phase : "") || "preparing"),
        recoveryAttempts: Math.max(
          0,
          Number(details.recoveryAttempts ?? (sameTask ? previous.recoveryAttempts : 0)) || 0,
        ),
        activationAttempts: Math.max(
          0,
          Number(details.activationAttempts ?? (sameTask ? previous.activationAttempts : 0)) || 0,
        ),
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

  function deferTemporaryChatTask(taskId, details = {}) {
    const current = readTemporaryChatCheckpoint();
    const sameTask = current?.taskId === String(taskId || "");
    writeTemporaryChatCheckpoint(taskId, {
      ...details,
      recoveryAttempts: Number(
        details.recoveryAttempts
        ?? (sameTask ? current.recoveryAttempts : 0)
        ?? 0,
      ),
      activationAttempts: Number(
        details.activationAttempts
        ?? (sameTask ? current.activationAttempts : 0)
        ?? 0,
      ),
    });
    throw Object.assign(
      new Error(details.message || "Gemini 临时对话页面正在恢复；保留当前任务与 claim，尚未提交提示词。"),
      {
        code: details.code || "temporary_chat_resume_pending",
        recoverable: true,
      },
    );
  }

  function navigateHomeForTemporaryChatRecovery(taskId, reason = "") {
    const current = readTemporaryChatCheckpoint();
    const recoveryAttempts = current?.taskId === String(taskId || "")
      ? Number(current.recoveryAttempts || 0) + 1
      : 1;
    writeTemporaryChatCheckpoint(taskId, {
      phase: "returning_home",
      recoveryAttempts,
    });
    location.replace(LANGBAI_GEMINI_TEMPORARY_CHAT_STATE.GEMINI_HOME_URL);
    deferTemporaryChatTask(taskId, {
      phase: "returning_home",
      recoveryAttempts,
      code: "temporary_chat_navigation_pending",
      message: `Gemini 当前为普通会话，已安全返回主页并保留原任务 checkpoint。${reason}`,
    });
  }

  async function ensureTemporaryChat(task) {
    const taskId = String(task?.id || "");
    const navigationCheckpoint = readTemporaryChatCheckpoint();
    if (navigationCheckpoint?.taskId === taskId) {
      // The checkpoint preserves the task claim across a Gemini SPA/document
      // navigation. It is never activation evidence by itself.
      await waitForTemporaryChatSurface(8000);
      if (isTemporaryChatSurfaceActive()) {
        clearTemporaryChatCheckpoint(taskId);
        return "active_state";
      }
    }

    let button = findTemporaryChatControl() || await waitForTemporaryChatSurface(8000);
    let activation = temporaryChatActivationSnapshot();
    let preparation = LANGBAI_GEMINI_TEMPORARY_CHAT_STATE.preparationAction({
      url: location.href,
      controlVisible: !!button,
      controlActive: activation.controlActive,
      exitControlVisible: activation.exitControlVisible,
      activeExplanationVisible: activation.activeExplanationVisible,
    });
    if (preparation.action === "verified") {
      clearTemporaryChatCheckpoint(taskId);
      return "active_state";
    }

    if (!button) {
      if (preparation.action === "navigate_home") {
        navigateHomeForTemporaryChatRecovery(
          taskId,
          "提示词没有写入当前普通会话。",
        );
      }
      const sameTaskCheckpoint = navigationCheckpoint?.taskId === taskId
        ? navigationCheckpoint
        : readTemporaryChatCheckpoint()?.taskId === taskId
          ? readTemporaryChatCheckpoint()
          : null;
      const recoveryAttempts = Number(sameTaskCheckpoint?.recoveryAttempts || 0) + 1;
      if (recoveryAttempts <= 3) {
        deferTemporaryChatTask(taskId, {
          phase: "waiting_for_surface",
          recoveryAttempts,
          code: "temporary_chat_surface_pending",
          message: `Gemini 主页尚未呈现临时对话入口，保留当前任务并等待页面恢复（${recoveryAttempts}/3）。`,
        });
      }
      clearTemporaryChatCheckpoint(taskId);
      throw Object.assign(
        new Error("Gemini 主页在多轮恢复后仍未提供临时对话入口；任务未提交到普通历史。"),
        { code: "gemini_temporary_chat_unavailable" },
      );
    }

    if (!isTemporaryChatSurfaceActive()) {
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
      const currentCheckpoint = readTemporaryChatCheckpoint();
      const activationAttempts = currentCheckpoint?.taskId === taskId
        ? Number(currentCheckpoint.activationAttempts || 0) + 1
        : 1;
      writeTemporaryChatCheckpoint(taskId, {
        phase: "activating",
        activationAttempts,
      });
      try {
        await activateControl(button);
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          await sleep(250);
          activation = temporaryChatActivationSnapshot();
          if (LANGBAI_GEMINI_TEMPORARY_CHAT_STATE.activationEvidence(activation).active) {
            clearTemporaryChatCheckpoint(taskId);
            return "active_state";
          }
        }
      } finally {
        tracedEvents.forEach(type => document.removeEventListener(type, traceInput, true));
      }

      if (LANGBAI_GEMINI_TEMPORARY_CHAT_STATE.isOrdinaryConversationUrl(location.href)) {
        navigateHomeForTemporaryChatRecovery(
          taskId,
          "临时对话点击后落入普通会话，已阻止提交。",
        );
      }

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
      const exactControl = button.matches('[data-test-id="temp-chat-button"]')
        || !!button.closest('[data-test-id="temp-chat-button"]');
      const trustedActivation =
        LANGBAI_GEMINI_TEMPORARY_CHAT_STATE.trustedActivationEvidence({
          exactControl,
          trustedClick: inputTrace.some(
            event => event.type === "click" && event.trusted === true,
          ),
          loginReady: isGeminiLoginReady(),
          overlayVisible: overlays.length > 0,
          url: location.href,
        });
      if (trustedActivation.active) {
        clearTemporaryChatCheckpoint(taskId);
        return "trusted_control_click";
      }
      if (activationAttempts <= 3) {
        deferTemporaryChatTask(taskId, {
          phase: "activation_unverified",
          activationAttempts,
          code: "temporary_chat_activation_pending",
          message:
            `已触发临时对话入口，但尚未出现退出按钮、active 状态或临时对话说明；`
            + `保留当前任务继续验证（${activationAttempts}/3）。`
            + ` urlChanged=${location.href !== beforeUrl}`,
        });
      }
      clearTemporaryChatCheckpoint(taskId);
      const controlHost = button.closest?.(
        '[data-test-id="temp-chat-button"],gem-icon-button',
      ) || button.parentElement;
      throw Object.assign(
        new Error(
          `已点击临时对话，但页面没有返回可验证的启用状态；任务未提交，以避免写入普通历史。`
          + ` control=${JSON.stringify(describeControl(button))}`
          + ` host=${JSON.stringify(describeControl(controlHost))}`
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
    clearTemporaryChatCheckpoint(taskId);
    return "active_state";
  }

  async function enableImageAction() {
    const exactMatch = (element, candidates) => {
      const value = normalizedText(element).replace(/\s+/g, " ").trim().toLowerCase();
      return candidates.some(candidate =>
        value === String(candidate || "").trim().toLowerCase()
      );
    };
    const safeActionCandidates = () => [...document.querySelectorAll(
      'button,[role="button"],[role="menuitem"],[role="option"]',
    )]
      .filter(visible)
      .filter(element => !element.closest("nav,aside,[role=navigation]"))
      .filter(element => exactMatch(element, SELECTORS.imageAction || []));
    let action = safeActionCandidates()[0] || null;
    if (action) {
      await activateControl(action);
      await sleep(500);
      return true;
    }
    const composer = findComposer();
    const tools = [...document.querySelectorAll('button,[role="button"]')]
      .filter(visible)
      .filter(element => !element.closest("nav,aside,[role=navigation]"))
      .filter(element => exactMatch(element, ["Tools", "工具", "ツール", "도구"]))
      .find(element => {
        if (!composer) return false;
        const controlRect = element.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        return controlRect.bottom >= composerRect.top - 180
          && controlRect.top <= composerRect.bottom + 180;
      }) || null;
    if (tools) {
      await activateControl(tools);
      await sleep(500);
      action = safeActionCandidates()[0] || null;
    }
    if (!action) return false;
    await activateControl(action);
    await sleep(500);
    return true;
  }

  const GEMINI_MODEL_LABELS = Object.freeze({
    fast: ["Fast", "Flash", "快速", "快速模式", "高速"],
    pro: ["Pro", "专业", "專業"],
  });

  function normalizedChoiceText(element) {
    return normalizedText(element).replace(/\s+/g, " ").trim().toLowerCase();
  }

  function matchesChoiceLabel(element, labels) {
    const text = normalizedChoiceText(element);
    return labels.some(label => {
      const normalized = label.toLowerCase();
      return text === normalized || text.startsWith(`${normalized} `);
    });
  }

  function matchesGeminiModelMode(element, mode) {
    const text = normalizedChoiceText(element);
    if (mode === "fast") {
      return (
        /\bflash\b/i.test(text)
        && !/\bflash[\s-]*lite\b/i.test(text)
      ) || /快速|高速/.test(text);
    }
    if (mode === "pro") {
      return /(?:^|\s)pro(?:\s|$)/i.test(text) || /专业|專業/.test(text);
    }
    return false;
  }

  function findGeminiModelTrigger() {
    const allLabels = Object.values(GEMINI_MODEL_LABELS).flat();
    const dedicated = [...document.querySelectorAll(
      'bard-mode-switcher [role="group"],bard-mode-switcher [role="button"],bard-mode-switcher button,bard-mode-switcher',
    )]
      .filter(visible)
      .find(element => matchesChoiceLabel(element, allLabels)
        || matchesGeminiModelMode(element, "fast")
        || matchesGeminiModelMode(element, "pro"));
    if (dedicated) return dedicated;
    const candidates = [...document.querySelectorAll(
      'button[aria-haspopup],[role="button"][aria-haspopup],button,[role="button"]',
    )]
      .filter(visible)
      .filter(element => matchesChoiceLabel(element, allLabels));
    return candidates.find(element => element.hasAttribute("aria-haspopup"))
      || candidates.find(element => element.closest("main"))
      || candidates[0]
      || null;
  }

  function geminiModelDiagnostics() {
    const safeText = value => String(value || "")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
      .replace(/\s+/g, " ")
      .trim();
    return [...document.querySelectorAll(
      "bard-mode-switcher,bard-mode-switcher *",
    )]
      .filter(visible)
      .map(element => ({
        element,
        text: safeText(normalizedText(element)),
      }))
      .filter(item =>
        item.text.length > 0
        && item.text.length <= 80
        && /(?:^|\s)(?:pro|fast)(?:\s|$)|快速|专业|專業/i.test(item.text)
      )
      .slice(0, 10)
      .map(item => ({
        tag: item.element.tagName.toLowerCase(),
        text: item.text,
        role: item.element.getAttribute("role") || "",
        aria: safeText(item.element.getAttribute("aria-label") || ""),
        testId: item.element.getAttribute("data-test-id") || "",
        parent: item.element.parentElement?.tagName?.toLowerCase?.() || "",
      }));
  }

  function geminiModelOptionDiagnostics() {
    const safeText = value => String(value || "")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
      .replace(/\s+/g, " ")
      .trim();
    return [...document.querySelectorAll(
      '[role="option"],[role="menuitem"],[role="menuitemradio"],[role="radio"],[role="listbox"] button,[role="menu"] button,[role="dialog"] button',
    )]
      .filter(visible)
      .map(element => ({
        tag: element.tagName.toLowerCase(),
        text: safeText(normalizedText(element)).slice(0, 120),
        role: element.getAttribute("role") || "",
        aria: safeText(element.getAttribute("aria-label") || "").slice(0, 120),
        testId: element.getAttribute("data-test-id") || "",
      }))
      .filter(item => item.text || item.aria)
      .slice(0, 20);
  }

  async function selectGeminiModel(preference = "auto") {
    const requested = ["fast", "pro"].includes(preference) ? preference : "auto";
    if (requested === "auto") return "auto";
    const labels = GEMINI_MODEL_LABELS[requested];
    const trigger = findGeminiModelTrigger();
    if (!trigger) {
      throw Object.assign(
        new Error(
          `未识别到 Gemini 模型选择器，无法切换到 ${requested}。`
          + ` candidates=${JSON.stringify(geminiModelDiagnostics())}`,
        ),
        { code: "gemini_model_selector_missing" },
      );
    }
    if (
      matchesChoiceLabel(trigger, labels)
      || matchesGeminiModelMode(trigger, requested)
    ) return requested;
    await activateControl(trigger);
    const deadline = Date.now() + 6000;
    let option = null;
    while (Date.now() < deadline && !option) {
      await sleep(200);
      option = [...document.querySelectorAll(
        '[role="option"],[role="menuitem"],[role="menuitemradio"],[role="radio"],button,[role="button"]',
      )]
        .filter(element => element !== trigger && visible(element))
        .find(element => matchesGeminiModelMode(element, requested)) || null;
    }
    if (!option) {
      throw Object.assign(
        new Error(
          `Gemini 当前账号没有显示 ${requested} 模型选项。`
          + ` candidates=${JSON.stringify(geminiModelOptionDiagnostics())}`,
        ),
        { code: "gemini_model_unavailable" },
      );
    }
    await activateControl(option);
    const verifyDeadline = Date.now() + 6000;
    while (Date.now() < verifyDeadline) {
      await sleep(250);
      const selected = findGeminiModelTrigger();
      if (selected && matchesGeminiModelMode(selected, requested)) {
        return requested;
      }
    }
    throw Object.assign(
      new Error(`已点击 ${requested} 模型，但页面未确认切换成功。`),
      { code: "gemini_model_unverified" },
    );
  }

  function setComposerText(composer, text) {
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), "value")?.set;
      setter?.call(composer, text);
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
      return "native_value_setter";
    }
    // Gemini uses a framework-controlled rich text editor. Assigning
    // textContent makes the text visible but does not update the framework
    // state, so the send button stays disabled. Editing through the active
    // Selection + insertText path produces the same input transaction as a
    // user paste and keeps the editor model in sync.
    const selection = globalThis.getSelection?.();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const inserted = document.execCommand?.("insertText", false, text) === true;
    selection?.removeAllRanges();
    if (!inserted || !composerText(composer)) {
      const beforeInput = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      });
      composer.dispatchEvent(beforeInput);
      composer.textContent = text;
      composer.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }));
      return "text_content_fallback";
    }
    return "exec_command_insert_text";
  }

  async function setComposerTextTrusted(composer, text) {
    composer.focus();
    const selection = globalThis.getSelection?.();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection?.removeAllRanges();
    selection?.addRange(range);
    await postMessageNativeCommand(
      "trusted-text-request",
      { text },
      15000,
    );
    selection?.removeAllRanges();
    return "trusted_cdp_insert_text";
  }

  function composerText(composer) {
    if (!(composer instanceof Element)) return "";
    const value = composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement
      ? composer.value
      : composer.textContent;
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  async function waitForStableComposerPrompt(
    expectedPrompt,
    timeoutMs = 4000,
    stableMs = 1000,
  ) {
    const probe = String(expectedPrompt || "").replace(/\s+/g, " ").trim().slice(-160);
    const deadline = Date.now() + timeoutMs;
    let stableComposer = null;
    let stableSince = 0;
    while (Date.now() < deadline) {
      const composer = findComposer();
      const current = composerText(composer);
      const matches = composer?.isConnected
        && current
        && (!probe || current.includes(probe));
      if (matches) {
        if (composer !== stableComposer) {
          stableComposer = composer;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= stableMs) {
          return composer;
        }
      } else {
        stableComposer = null;
        stableSince = 0;
      }
      await sleep(100);
    }
    return null;
  }

  async function writeStableComposerPrompt(expectedPrompt, maxAttempts = 4) {
    const methods = [];
    let sawComposer = false;
    const config = readEmbeddedConfig() || {};
    const useTrustedText = config.embedded === true
      && String(config.platform || "").toLowerCase() === "windows";
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const composer = findComposer();
      if (!composer) {
        await sleep(300);
        continue;
      }
      sawComposer = true;
      let method;
      if (useTrustedText) {
        try {
          method = await setComposerTextTrusted(composer, expectedPrompt);
        } catch (error) {
          methods.push(`trusted_error:${String(error?.code || "unknown")}`);
          method = setComposerText(composer, expectedPrompt);
        }
      } else {
        method = setComposerText(composer, expectedPrompt);
      }
      methods.push(method);
      const stableComposer = await waitForStableComposerPrompt(expectedPrompt);
      if (stableComposer) {
        return {
          composer: stableComposer,
          method,
          attempt,
          methods,
        };
      }
      // Model/tool/temporary-chat changes can remount Gemini's Quill editor.
      // Retry only before any send action, always against the latest editor.
      await sleep(250);
    }
    throw Object.assign(
      new Error(
        sawComposer
          ? `Gemini 输入框反复刷新，未能稳定保存本次提示词。methods=${methods.join(",")}`
          : "未识别到 Gemini 输入框",
      ),
      {
        code: sawComposer
          ? "gemini_composer_input_unstable"
          : "selector_pack_outdated",
      },
    );
  }

  function findSendControl() {
    const directSelectors = [
      'button[data-test-id*="send"]',
      'button[aria-label="Send message"]',
      'button[aria-label="发送消息"]',
      'button[aria-label="傳送訊息"]',
      'button[aria-label="送信"]',
      'button[aria-label="보내기"]',
      "button.send-button",
      '[role="button"][data-test-id*="send"]',
    ];
    for (const selector of directSelectors) {
      const found = [...document.querySelectorAll(selector)].find(visible);
      if (found) return found;
    }
    return findByCandidates(SELECTORS.send);
  }

  async function waitForEnabledSendControl(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const send = findSendControl();
      if (send && !send.matches(":disabled,[aria-disabled=true]")) return send;
      await sleep(100);
    }
    return findSendControl();
  }

  function promptStillPending(composer, baseline, expectedPrompt) {
    const promptProbe = String(expectedPrompt || "").replace(/\s+/g, " ").trim().slice(-160);
    const currentComposer = composerText(composer);
    const currentUser = userMessageSnapshot();
    const userUnchanged = currentUser.count === baseline.user.count
      && currentUser.digest === baseline.user.digest;
    return userUnchanged
      && !!currentComposer
      && (!promptProbe || currentComposer.includes(promptProbe));
  }

  function submissionDiagnostic(composer, baseline, expectedPrompt, send) {
    const currentUser = userMessageSnapshot();
    const currentResponse = modelResponseSnapshot();
    const promptProbe = String(expectedPrompt || "").replace(/\s+/g, " ").trim().slice(-160);
    const latestUser = String(currentUser.latest || "").replace(/\s+/g, " ").trim();
    const compactControl = element => {
      if (!(element instanceof Element)) return null;
      return {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        disabled: element.matches(":disabled,[aria-disabled=true]"),
        className: String(element.className || "").slice(0, 100),
      };
    };
    return {
      composerTextLength: composerText(composer).length,
      userCountBefore: baseline.user.count,
      userCountNow: currentUser.count,
      latestUserTail: latestUser.slice(-240),
      latestUserMatches: !!promptProbe && latestUser.includes(promptProbe),
      responseCountBefore: baseline.response.count,
      responseCountNow: currentResponse.count,
      generationActive: generationIsActive(),
      composer: compactControl(composer),
      send: compactControl(send),
      active: compactControl(document.activeElement),
    };
  }

  async function waitForChangedSubmission(
    composer,
    baseline,
    prompt,
    send,
    timeoutMs = 15000,
  ) {
    try {
      return await waitForSubmissionAck(composer, baseline, prompt, timeoutMs);
    } catch (error) {
      if (error?.code !== "gemini_submission_not_acknowledged") throw error;
      throw Object.assign(
        new Error(
          "Gemini 页面发生变化，但未出现与本次提示词匹配的新用户消息。"
          + ` diagnostic=${JSON.stringify(submissionDiagnostic(composer, baseline, prompt, send))}`,
        ),
        { code: "gemini_submission_not_acknowledged" },
      );
    }
  }

  async function submitPromptAndWait({
    composer,
    send,
    baseline,
    prompt,
  }) {
    await activateControl(send);
    try {
      return await waitForSubmissionAck(composer, baseline, prompt, 5000);
    } catch (error) {
      if (error?.code !== "gemini_submission_not_acknowledged") throw error;
      if (!promptStillPending(composer, baseline, prompt)) {
        return waitForChangedSubmission(composer, baseline, prompt, send);
      }
    }

    // WebView2 composition surfaces occasionally accept physical pointer
    // events without forwarding the resulting click to the web component.
    // A DOM click is safe only while the exact prompt is still pending and no
    // new user message exists.
    send.click();
    try {
      return await waitForSubmissionAck(composer, baseline, prompt, 5000);
    } catch (error) {
      if (error?.code !== "gemini_submission_not_acknowledged") throw error;
      if (!promptStillPending(composer, baseline, prompt)) {
        return waitForChangedSubmission(composer, baseline, prompt, send);
      }
    }

    composer.focus();
    for (const type of ["keydown", "keypress", "keyup"]) {
      composer.dispatchEvent(new KeyboardEvent(type, {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }));
    }
    try {
      return await waitForSubmissionAck(composer, baseline, prompt, 5000);
    } catch (error) {
      if (error?.code !== "gemini_submission_not_acknowledged") throw error;
      throw Object.assign(
        new Error(
          "Gemini 页面没有确认本次提示词提交。"
          + ` diagnostic=${JSON.stringify(submissionDiagnostic(composer, baseline, prompt, send))}`,
        ),
        { code: "gemini_submission_not_acknowledged" },
      );
    }
  }

  function userMessageSnapshot() {
    const selectors = [
      "user-query .query-text",
      "user-query .query-content",
      "user-query",
      '[data-test-id*="user-query"]',
      '[data-message-author-role="user"]',
      '[class*="user-query"] [class*="query-text"]',
      '[class*="user-query"] [class*="query-content"]',
      '[class*="user-query"]',
      ".query-text",
      ".query-content",
    ].join(",");
    const elements = [...document.querySelectorAll(selectors)]
      .filter(visible)
      .filter((element, index, all) => !all.some((other, otherIndex) => (
        otherIndex !== index
        && element.contains(other)
        && normalizedText(other) === normalizedText(element)
      )));
    const texts = elements
      .map(normalizedText)
      .map(value => value.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return {
      count: texts.length,
      digest: texts.join("\n---\n"),
      latest: texts.at(-1) || "",
    };
  }

  async function waitForSubmissionAck(
    composer,
    baseline,
    expectedPrompt,
    timeoutMs = 15000,
  ) {
    const normalizedExpected = String(expectedPrompt || "")
      .replace(/\s+/g, " ")
      .trim();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const currentUser = userMessageSnapshot();
      const currentResponse = modelResponseSnapshot();
      const composerCleared = !composer.isConnected || composerText(composer) === "";
      const userMessageAdded = currentUser.count > baseline.user.count
        || (currentUser.digest && currentUser.digest !== baseline.user.digest);
      const normalizedLatestUser = String(currentUser.latest || "")
        .replace(/\s+/g, " ")
        .trim();
      const promptProbe = normalizedExpected.slice(-160);
      const userMessageMatches = userMessageAdded
        && (
          !promptProbe
          || normalizedLatestUser.includes(promptProbe)
          || normalizedExpected.includes(normalizedLatestUser)
        );
      const responseStarted = currentResponse.count > baseline.response.count
        || (currentResponse.digest && currentResponse.digest !== baseline.response.digest);
      const generationStarted = generationIsActive();
      // A cleared composer or a newly rendered response can be caused by SPA
      // navigation and lazy loading. Only the exact newly submitted prompt is
      // strong enough evidence that this task was accepted.
      if (userMessageMatches) {
        return {
          acknowledged: true,
          acknowledgedAt: Date.now(),
          composerCleared,
          userMessageAdded,
          userMessageMatches,
          responseStarted,
          generationStarted,
        };
      }
      await sleep(250);
    }
    throw Object.assign(
      new Error("Gemini 页面没有确认提交：输入框未清空，也没有出现新消息或生成状态。"),
      { code: "gemini_submission_not_acknowledged" },
    );
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

  function imageSignature(image) {
    return [
      image.currentSrc || image.src || "",
      image.srcset || "",
      image.naturalWidth || 0,
      image.naturalHeight || 0,
    ].join("|");
  }

  function imageSnapshot() {
    const images = [...document.images];
    return {
      nodes: new WeakSet(images),
      signatures: new Map(images.map(image => [image, imageSignature(image)])),
    };
  }

  function modelResponseSelector() {
    return [
      "model-response",
      '[data-test-id*="model-response"]',
      '[data-message-author-role="model"]',
      '[data-message-author-role="assistant"]',
      '[class*="model-response"]',
    ].join(",");
  }

  function modelResponseContainer(image) {
    return image?.closest?.(modelResponseSelector()) || null;
  }

  function modelResponseSnapshot() {
    const nodes = [...document.querySelectorAll(modelResponseSelector())]
      .filter(visible)
      .filter((element, index, all) => !all.some((other, otherIndex) => (
        otherIndex !== index
        && other.contains(element)
        && normalizedText(other) === normalizedText(element)
      )));
    const texts = nodes
      .map(normalizedText)
      .map(value => value.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return {
      count: texts.length,
      digest: texts.join("\n---\n"),
      latest: texts.at(-1) || "",
      nodes: new WeakSet(nodes),
    };
  }

  function generationIsActive() {
    const stopLabels = [
      "Stop response", "Stop generating", "Cancel response",
      "停止回复", "停止生成", "取消生成",
      "停止回覆", "停止產生", "キャンセル", "응답 중지", "생성 중지",
    ];
    if (findByCandidates(stopLabels, 'button,[role="button"],[aria-label]')) return true;
    return [...document.querySelectorAll('main [aria-busy="true"],model-response [aria-busy="true"]')]
      .some(visible);
  }

  function isImageProgressText(value) {
    return /creating (?:an )?image|generating (?:an )?image|正在生成(?:图片|图像)|正在创作|正在绘制|正在產生(?:圖片|圖像)|画像を生成中|이미지 생성 중/i
      .test(String(value || ""));
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

  async function waitForGeneratedImage(previous, {
    timeoutMs = 20 * 60 * 1000,
    heartbeat = null,
    baselineResponse = modelResponseSnapshot(),
    submission = null,
  } = {}) {
    if (submission?.acknowledged !== true) {
      throw Object.assign(
        new Error("Gemini 提交尚未确认，拒绝读取页面已有图片。"),
        { code: "gemini_submission_not_acknowledged" },
      );
    }
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(60 * 1000, Number(timeoutMs) || 20 * 60 * 1000);
    let lastHeartbeat = 0;
    let stableResponseDigest = "";
    let stableResponseSince = 0;
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
      const response = modelResponseSnapshot();
      const hasNewResponse = response.count > baselineResponse.count
        || (response.digest && response.digest !== baselineResponse.digest);
      const candidates = [...document.images]
        .filter(image => visible(image) && image.complete && image.naturalWidth >= 256 && image.naturalHeight >= 256)
        .filter(image => {
          const responseContainer = modelResponseContainer(image);
          return LANGBAI_GEMINI_TEMPORARY_CHAT_STATE.isGeneratedImageCandidate({
            submissionAcknowledged: submission.acknowledged === true,
            wasPresentBefore: previous.nodes?.has(image) === true,
            resourceSignatureChanged: previous.signatures?.get(image) !== imageSignature(image),
            hasResponseContainer: !!responseContainer,
            responseContainerWasPresentBefore:
              !!responseContainer && baselineResponse.nodes?.has(responseContainer) === true,
            responseChanged: hasNewResponse,
          });
        })
        .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));
      if (candidates[0]) {
        await candidates[0].decode?.().catch(() => {});
        if (candidates[0].naturalWidth > 0 && candidates[0].naturalHeight > 0) return candidates[0];
      }
      if (hasNewResponse && response.latest) {
        const responseFailure = classifyVisibleFailure(response.latest);
        if (responseFailure) {
          throw Object.assign(
            new Error(response.latest.slice(0, 500)),
            { code: responseFailure.code, accountStatus: responseFailure.status },
          );
        }
        const active = generationIsActive() || isImageProgressText(response.latest);
        if (!active && Date.now() - startedAt >= 15000) {
          if (stableResponseDigest !== response.digest) {
            stableResponseDigest = response.digest;
            stableResponseSince = Date.now();
          } else if (Date.now() - stableResponseSince >= 45000) {
            throw Object.assign(
              new Error(`Gemini 已结束回复但没有返回图片：${response.latest.slice(0, 300)}`),
              { code: "gemini_no_image_returned" },
            );
          }
        } else {
          stableResponseDigest = "";
          stableResponseSince = 0;
        }
      }
      await sleep(1200);
    }
    throw Object.assign(
      new Error("Gemini 网页在 20 分钟内没有返回图片，任务已停止以避免永久卡在生成中。"),
      { code: "gemini_no_image_timeout" },
    );
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

  async function event(
    task,
    status,
    error = null,
    audit = null,
    recovery = null,
  ) {
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
        ...(recovery ? { recovery } : {}),
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

  function startClaimHeartbeat(task) {
    let stopped = false;
    let inFlight = null;
    let fatalError = null;
    const pulse = async () => {
      if (stopped) return;
      if (fatalError) throw fatalError;
      if (inFlight) return inFlight;
      inFlight = (async () => {
        const response = await bridgeFetch(
          `companion/tasks/${encodeURIComponent(task.id)}/heartbeat`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Langbai-Account-Id": bridge.accountId || "",
              "X-Langbai-Claim-Id": task.claim_id || "",
            },
            body: JSON.stringify({
              account_id: bridge.accountId || "",
              claim_id: task.claim_id || "",
            }),
          },
        );
        const body = await response.json().catch(() => ({}));
        if (body?.status === "cancelled") {
          throw Object.assign(
            new Error("Gemini task was cancelled"),
            { code: "task_cancelled" },
          );
        }
        if (!response.ok) {
          throw Object.assign(
            new Error(
              body?.error?.message
              || `Gemini companion heartbeat failed: HTTP ${response.status}`,
            ),
            { code: body?.error?.code || "companion_heartbeat_failed" },
          );
        }
      })()
        .catch(error => {
          fatalError = error;
          throw error;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    };
    const timer = setInterval(() => {
      void pulse().catch(error => {
        notifyNative("claim_heartbeat_error", {
          status: "failed",
          code: error?.code || "companion_heartbeat_failed",
          message: String(error?.message || error),
          task_id: task.id,
        });
      });
    }, 30000);
    return Object.freeze({
      pulse,
      stop() {
        stopped = true;
        clearInterval(timer);
      },
    });
  }

  async function downloadDirectGeneratedImage(image) {
    const original = String(image?.url || "");
    if (!/^https:\/\//i.test(original)) {
      throw Object.assign(
        new Error("Gemini 直接调用没有返回有效图片地址。"),
        { code: "fullsize_download_missing", directSubmissionStarted: true },
      );
    }
    const highResolution = original
      .replace(/=s\d+(?:-[a-z]+)?(?:\?.*)?$/i, "")
      + "=s2048-rj";
    let best = null;
    const failures = [];
    for (const url of [...new Set([highResolution, original])]) {
      try {
        const response = await fetch(url, {
          credentials: "include",
          cache: "no-store",
        });
        if (response.ok) {
          const blob = await response.blob();
          if (blob.size > 0 && (!best || blob.size > best.size)) best = blob;
        } else {
          failures.push(`page:${response.status}`);
        }
      } catch (error) {
        failures.push(`page:${String(error?.name || error)}`);
      }
      if (
        readEmbeddedConfig()?.embedded
        && String(readEmbeddedConfig()?.platform || "").toLowerCase() === "windows"
      ) {
        try {
          const downloaded = await postMessageNativeCommand(
            "image-download-request",
            { url },
            90000,
          );
          const bytes = decodeBase64(
            downloaded?.bodyBase64 || downloaded?.body_base64,
          );
          const blob = new Blob(
            [bytes],
            {
              type:
                downloaded?.contentType
                || downloaded?.content_type
                || "image/jpeg",
            },
          );
          if (blob.size > 0 && (!best || blob.size > best.size)) best = blob;
        } catch (error) {
          failures.push(
            `native:${String(error?.code || error?.name || error)}`,
          );
        }
      }
    }
    if (!best) {
      throw Object.assign(
        new Error(`Gemini 已生成图片，但直接下载失败：${failures.join(",")}`),
        { code: "fullsize_download_missing", directSubmissionStarted: true },
      );
    }
    return best;
  }

  async function persistTaskResult(task, blob, audit, claimHeartbeat = null) {
    await event(task, "locating_full_size", null, audit);
    const auditHeader = btoa(
      unescape(encodeURIComponent(JSON.stringify(audit))),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await claimHeartbeat?.pulse?.();
      const result = await bridgeFetch(
        `companion/tasks/${encodeURIComponent(task.id)}/result`,
        {
          method: "POST",
          headers: {
            "Content-Type": blob.type || "image/png",
            "X-Langbai-Audit": auditHeader,
            "X-Langbai-Account-Id": bridge.accountId || "",
            "X-Langbai-Claim-Id": task.claim_id || "",
          },
          body: blob,
        },
      ).catch(error => {
        lastError = error;
        return null;
      });
      if (result?.ok) return;
      const currentResponse = await bridgeFetch(
        `image-tasks/${encodeURIComponent(task.id)}`,
        { headers: { "X-Langbai-Account-Id": bridge.accountId || "" } },
      ).catch(() => null);
      const currentTask = await currentResponse?.json?.().catch(() => null);
      if (currentResponse?.ok && currentTask?.status === "succeeded") return;
      const resultBody = await result?.json?.().catch(() => ({}));
      lastError = Object.assign(
        new Error(
          resultBody?.error?.message
          || `Saving the generated Gemini image failed: HTTP ${result?.status || 0}`,
        ),
        { code: resultBody?.error?.code || "gemini_result_save_failed" },
      );
      if (attempt < 3) await sleep(2000 * attempt);
    }
    throw lastError || Object.assign(
      new Error("Saving the generated Gemini image failed."),
      { code: "gemini_result_save_failed" },
    );
  }

  async function processRecoveredDirectResult(
    task,
    request,
    claimHeartbeat,
  ) {
    const recovery = task.recovery;
    if (
      recovery?.phase !== "direct_image_ready"
      || !/^https:\/\//i.test(String(recovery?.image?.url || ""))
    ) {
      throw Object.assign(
        new Error("The generated Gemini image recovery checkpoint is invalid."),
        { code: "gemini_generated_image_checkpoint_invalid" },
      );
    }
    let downloaded = null;
    let downloadError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await claimHeartbeat?.pulse?.();
      try {
        downloaded = await downloadDirectGeneratedImage(recovery.image);
        break;
      } catch (error) {
        downloadError = error;
        if (attempt < 3) await sleep(3000 * attempt);
      }
    }
    if (!downloaded) {
      throw Object.assign(
        new Error(
          "Gemini generated the image, but all three download attempts failed. "
          + "Submitting again may consume another generation; manual confirmation is required. "
          + String(downloadError?.message || downloadError || ""),
        ),
        {
          code: "gemini_generated_image_recovery_failed",
          directSubmissionStarted: true,
        },
      );
    }
    let processed;
    let transformWarning = "";
    try {
      processed = await transformForRequestedOutput(downloaded, request);
    } catch (error) {
      const decoded = await decodeImageBlob(downloaded);
      const source = { width: decoded.width, height: decoded.height };
      decoded.close();
      processed = {
        blob: downloaded,
        source,
        final: source,
        transform: "requested_transform_failed_original_preserved",
      };
      transformWarning = String(error?.message || error).slice(0, 500);
    }
    const audit = {
      selector_pack_version: SELECTORS.version,
      submission_transport: recovery.transport || "gemini_web_direct_rpc",
      direct_protocol: "StreamGenerate",
      requested_model_mode: request.model_preference || "auto",
      selected_model_mode: request.model_preference || "auto",
      temporary_chat_requested: true,
      temporary_chat_verified: false,
      temporary_chat_verification: {
        method: "protocol_request_flag",
        history_persisted: "not_observable",
      },
      reference_count:
        Array.isArray(request.references) ? request.references.length : 0,
      returned_image_count: Number(recovery.image_count || 1),
      requested_size:
        `${request.requested_size?.width || 0}x${request.requested_size?.height || 0}`,
      downloaded_fullsize:
        `${processed.source.width}x${processed.source.height}`,
      final_size: `${processed.final.width}x${processed.final.height}`,
      transform: processed.transform,
      ...(transformWarning ? { transform_warning: transformWarning } : {}),
    };
    await persistTaskResult(task, processed.blob, audit, claimHeartbeat);
  }

  async function processTaskThroughDirectProtocol(
    task,
    request,
    claimHeartbeat,
  ) {
    const directProtocol = globalThis.LANGBAI_GEMINI_DIRECT_PROTOCOL;
    if (!directProtocol?.generate) {
      throw Object.assign(
        new Error("The Gemini direct protocol module is unavailable."),
        { code: "gemini_direct_protocol_unavailable" },
      );
    }
    await event(task, "preparing_temporary_chat");
    await event(task, "uploading_references");
    const requestedPrompt = String(request.prompt || "").trim();
    const prompt =
      "Generate one image now. Return the image directly without explanatory text.\n\n"
      + requestedPrompt;
    const generated = await directProtocol.generate({
      prompt,
      references: request.references || [],
      modelPreference: request.model_preference || "auto",
      onBeforeSubmit: () => event(task, "submitting"),
      heartbeat: async () => {
        await claimHeartbeat?.pulse?.();
        await event(task, "generating");
      },
    });
    await event(task, "generating");
    const recovery = {
      phase: "direct_image_ready",
      image: {
        url: generated.image.url,
        image_id: generated.image.imageId || "",
        cid: generated.image.cid || "",
        rid: generated.image.rid || "",
        rcid: generated.image.rcid || "",
      },
      image_count: Number(generated.imageCount || 1),
      transport: generated.transport,
    };
    await event(task, "locating_full_size", null, null, recovery);
    task.recovery = recovery;
    await processRecoveredDirectResult(task, request, claimHeartbeat);
  }

  async function processTask(task) {
    const request = task.request || {};
    const claimHeartbeat = startClaimHeartbeat(task);
    let directFallbackReason = "";
    try {
      const resumeAction = LANGBAI_GEMINI_TEMPORARY_CHAT_STATE.taskResumeAction({
        resumedClaim: task.resumed_claim === true,
        status: task.status,
      });
      if (
        resumeAction === "fail_unknown_submission"
        && task.recovery?.phase !== "direct_image_ready"
      ) {
        await event(task, "failed", {
          code: "gemini_submission_state_unknown",
          message:
            "Gemini 页面在提示词可能已经提交后重载；为避免重复生成，软件未再次发送提示词。请先检查当前临时对话，再决定是否手动重试。",
        });
        return;
      }
      const login = await waitForGeminiLoginReady();
      if (!login.ready) {
        throw Object.assign(
          new Error("Gemini 登录状态已失效，请重新登录后再生成。"),
          {
            code: login.reason === "signed_out"
              ? "gemini_login_required"
              : "gemini_login_state_unknown",
          },
        );
      }
      if (task.recovery?.phase === "direct_image_ready") {
        await processRecoveredDirectResult(
          task,
          request,
          claimHeartbeat,
        );
        return;
      }
      try {
        await processTaskThroughDirectProtocol(
          task,
          request,
          claimHeartbeat,
        );
        return;
      } catch (directError) {
        const safeFallbackCodes = new Set([
          "gemini_direct_bootstrap_unavailable",
          "gemini_direct_protocol_unavailable",
          "gemini_direct_upload_unavailable",
          "gemini_direct_quota_unavailable",
        ]);
        const safeAfterDirectSubmission =
          directError?.safeToFallbackToUi === true
          && directError?.code === "gemini_direct_quota_unavailable";
        if (
          (directError?.directSubmissionStarted === true && !safeAfterDirectSubmission)
          || (
            !safeFallbackCodes.has(String(directError?.code || ""))
            && !safeAfterDirectSubmission
          )
        ) {
          throw directError;
        }
        directFallbackReason = String(directError?.code || "direct_protocol_unavailable");
        notifyNative("direct_protocol_fallback", {
          status: "fallback",
          code: directError.code,
          message: String(directError.message || directError),
          task_id: task.id,
        });
      }
      await event(task, "preparing_temporary_chat");
      const temporaryChatVerification = await ensureTemporaryChat(task);
      const before = historyDigest();
      const selectedModelMode = await selectGeminiModel(request.model_preference || "auto");
      await event(task, "uploading_references");
      await uploadReferences(request.references || []);
      await event(task, "submitting");
      const explicitImageAction = await enableImageAction();
      const preSubmissionHistory = historyDigest();
      const currentOrdinaryHistoryVisible = !!preSubmissionHistory.currentKey
        && preSubmissionHistory.entries.some(
          entry => entry.key === preSubmissionHistory.currentKey
            && entry.active === true,
        );
      if (
        !temporaryChatVerification
        || !isGeminiLoginReady()
        || currentOrdinaryHistoryVisible
      ) {
        throw Object.assign(
          new Error(
            "Gemini 在提交前失去可验证的临时对话状态；提示词未发送。"
            + ` proof=${JSON.stringify(temporaryChatVerification)}`
            + ` login=${isGeminiLoginReady()}`
            + ` currentKey=${JSON.stringify(preSubmissionHistory.currentKey)}`
            + ` currentOrdinaryHistoryVisible=${currentOrdinaryHistoryVisible}`
            + ` url=${JSON.stringify(location.href)}`,
          ),
          { code: "temporary_chat_unverified" },
        );
      }
      const requestedPrompt = String(request.prompt || "").trim();
      const prompt = `请立即生成一张图片，不要只回复文字、解释或提示词；直接输出图片。\n\n${requestedPrompt}`;
      // Baselines must be captured on the verified Temporary Chat surface.
      // Capturing them before ensureTemporaryChat() lets images from a normal
      // conversation's replacement document look new after SPA navigation.
      const previous = imageSnapshot();
      const baselineResponse = modelResponseSnapshot();
      const submissionBaseline = {
        user: userMessageSnapshot(),
        response: baselineResponse,
      };
      const composerWrite = await writeStableComposerPrompt(prompt);
      const composer = composerWrite.composer;
      const composerWriteMethod = composerWrite.method;
      const send = await waitForEnabledSendControl();
      if (!send || send.matches(":disabled,[aria-disabled=true]")) {
        throw Object.assign(
          new Error(
            `Gemini 发送按钮不可用。writeMethod=${composerWriteMethod}`
            + ` send=${JSON.stringify(describeControl(send))}`,
          ),
          { code: "gemini_send_unavailable" },
        );
      }
      const submission = await submitPromptAndWait({
        composer,
        send,
        baseline: submissionBaseline,
        prompt,
      });
      await event(task, "generating");
      const image = await waitForGeneratedImage(
        previous,
        {
          timeoutMs: 20 * 60 * 1000,
          heartbeat: async () => {
            await claimHeartbeat.pulse();
            await event(task, "generating");
          },
          baselineResponse,
          submission,
        },
      );
      await event(task, "locating_full_size");
      const downloadedBlob = await fetchFullsize(image);
      const processed = await transformForRequestedOutput(downloadedBlob, request);
      const blob = processed.blob;
      const after = historyDigest();
      const historyAssessment = LANGBAI_GEMINI_TEMPORARY_CHAT_STATE.assessHistoryMutation(
        before,
        after,
      );
      const audit = {
        selector_pack_version: SELECTORS.version,
        image_action_mode: explicitImageAction ? "explicit_tool+forced_prompt" : "forced_prompt",
        requested_model_mode: request.model_preference || "auto",
        selected_model_mode: selectedModelMode,
        temporary_chat_verified: true,
        temporary_chat_verification: temporaryChatVerification,
        submission_acknowledged: submission.acknowledged === true,
        submission_acknowledgement: Object.keys(submission)
          .filter(key => key !== "acknowledgedAt" && submission[key] === true),
        history_guard: historyAssessment.status === "passed" ? "passed" : "warning",
        history_guard_status: historyAssessment.status,
        history_guard_warning: historyAssessment.warning || "",
        history_added_keys: historyAssessment.addedKeys,
        history_count_before: before.keys.length,
        history_count_after: after.keys.length,
        requested_size: `${request.requested_size?.width || 0}x${request.requested_size?.height || 0}`,
        downloaded_fullsize: `${processed.source.width}x${processed.source.height}`,
        final_size: `${processed.final.width}x${processed.final.height}`,
        transform: processed.transform,
        ...(directFallbackReason ? {
          direct_protocol_fallback: directFallbackReason,
        } : {}),
      };
      await persistTaskResult(task, blob, audit, claimHeartbeat);
    } catch (error) {
      if (error?.code === "task_cancelled") return;
      if ([
        "temporary_chat_navigation_pending",
        "temporary_chat_surface_pending",
        "temporary_chat_activation_pending",
        "temporary_chat_resume_pending",
      ].includes(error?.code)) {
        notifyNative("temporary_chat_recovery", {
          status: "preparing_temporary_chat",
          code: error.code,
          message: String(error.message || error),
          task_id: task.id,
          claim_id: task.claim_id || "",
        });
        return;
      }
      const protocolFailure = [
        "temporary_chat_guard_failed",
        "temporary_chat_unverified",
        "selector_pack_outdated",
      ].includes(error.code);
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
        ...(error?.requestId ? { request_id: String(error.requestId) } : {}),
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
    } finally {
      claimHeartbeat.stop();
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
      const identity = await publishIdentity(config);
      // A signed-out Gemini page still renders a composer. Do not claim a
      // queued task until both an authenticated account marker and the
      // Temporary Chat entry are present, otherwise the same task can flash
      // between generating and failed while the page is not executable.
      if (!identity.claimRecoveryReady) return;
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
