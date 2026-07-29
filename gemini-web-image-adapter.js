(function (root, factory) {
  const api = factory(root.GeminiImageSizeRegistry || (typeof require === "function" ? require("./gemini-image-size-registry.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GeminiWebImageAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (sizes) {
  "use strict";

  if (!sizes) throw new Error("GeminiImageSizeRegistry is required");
  const PROVIDER_ID = "geminiWeb";
  const MODEL = "gemini-web-image";
  const DEFAULT_BASE_URL = "http://127.0.0.1:18160/v1";
  const TERMINAL_STATES = new Set(["succeeded", "failed", "needs_login", "protocol_changed", "cancelled"]);

  function normalizeBaseUrl(value) {
    const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
    if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{2,5}\/v1$/i.test(raw)) {
      throw new Error("Gemini embedded browser bridge must use a loopback /v1 URL");
    }
    return raw.replace("localhost", "127.0.0.1");
  }

  function validatePairingKey(value) {
    return /^[a-f0-9]{64}$/.test(String(value || ""));
  }

  function validateCapabilities(value = {}) {
    const missing = [];
    if (value.provider !== "gemini_web") missing.push("provider:gemini_web");
    if (value.temporary_chat_required !== true) missing.push("temporary_chat_required");
    if (value.fullsize_download !== true) missing.push("fullsize_download");
    if (!Array.isArray(value.dimension_modes) || !value.dimension_modes.includes("exact_output")) missing.push("dimension_mode:exact_output");
    return { ok: missing.length === 0, missing, capabilities: value };
  }

  function buildTaskRequest({ prompt, size, refs = [], options = {}, clientRequestId = "" }) {
    const resolved = sizes.resolveRequest({ ...options, targetSize: options.targetSize || size });
    const sourceReferences = Array.isArray(refs) ? refs : [];
    if (sourceReferences.length > 20) {
      const error = new Error(`Gemini web image tasks accept at most 20 references; received ${sourceReferences.length}`);
      error.status = 400;
      error.code = "too_many_reference_images";
      throw error;
    }
    const references = sourceReferences.map((reference, index) => ({
      index: index + 1,
      file_name: reference.fileName || `reference-${index + 1}.png`,
      data_url: reference.dataUrl,
      width: Number(reference.width || 0),
      height: Number(reference.height || 0),
    }));
    return {
      client_request_id: clientRequestId || (globalThis.crypto?.randomUUID?.() || `gemini_${Date.now()}_${Math.random().toString(16).slice(2)}`),
      provider: PROVIDER_ID,
      prompt: `${sizes.buildPromptPrefix(resolved)}\n\n${String(prompt || "").trim()}`,
      original_prompt: String(prompt || "").trim(),
      references,
      requested_size: { width: resolved.target.width, height: resolved.target.height },
      requested_ratio: resolved.ratio,
      size_mode: resolved.sizeMode,
      resolution_intent: resolved.resolutionIntent,
      crop_mode: resolved.cropMode,
      quality_intent: resolved.qualityIntent,
      model_preference: resolved.modelPreference,
      temporary_chat_required: true,
      n: 1,
    };
  }

  function normalizeTask(value = {}) {
    const status = String(value.status || "queued");
    return {
      id: String(value.id || value.task_id || ""),
      clientRequestId: String(value.client_request_id || ""),
      status,
      terminal: TERMINAL_STATES.has(status),
      error: value.error || null,
      result: value.result || null,
      audit: value.audit || value.result?.audit || null,
      accountId: String(value.account_id || ""),
    };
  }

  function extractTaskId(value = {}) {
    return String(value.id || value.task_id || "");
  }

  function buildSafeAudit(task = {}) {
    const normalized = normalizeTask(task);
    const audit = normalized.audit || {};
    return {
      taskId: normalized.id,
      clientRequestId: normalized.clientRequestId,
      provider: PROVIDER_ID,
      temporaryChatVerified: audit.temporary_chat_verified === true,
      historyGuard: audit.history_guard || "unknown",
      selectorPackVersion: String(audit.selector_pack_version || ""),
      requestedSize: String(audit.requested_size || ""),
      downloadedFullsize: String(audit.downloaded_fullsize || ""),
      finalSize: String(audit.final_size || ""),
      transform: String(audit.transform || "none"),
      requestedModelMode: String(audit.requested_model_mode || "auto"),
      selectedModelMode: String(audit.selected_model_mode || "unknown"),
      accountSuffix: String(normalized.accountId || "").slice(-4),
    };
  }

  return Object.freeze({
    PROVIDER_ID,
    MODEL,
    DEFAULT_BASE_URL,
    DEFAULTS: sizes.DEFAULTS,
    normalizeBaseUrl,
    validatePairingKey,
    validateCapabilities,
    buildTaskRequest,
    normalizeTask,
    extractTaskId,
    buildSafeAudit,
  });
});
