(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CodexImageGateway = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROVIDER_ID = "codexImageGateway";
  const BASE_URL = "http://127.0.0.1:18080/v1";
  const HEALTH_URL = "http://127.0.0.1:18080/healthz";
  const CAPABILITIES_URL = `${BASE_URL}/image-capabilities`;
  const MODEL = "gpt-image-2";
  const MAX_REFERENCE_IMAGES = 20;
  const DIRECT_REFERENCE_IMAGES = 5;
  const DEFAULTS = Object.freeze({
    quality: "medium",
    dimensionMode: "exact_output",
    asyncTasks: true,
    clientQueue: 2,
  });

  function normalizeBaseUrl(value) {
    const raw = String(value || BASE_URL).trim().replace(/\/+$/, "");
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("Invalid Codex image gateway URL");
    }
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.protocol !== "http:") {
      throw new Error("The Codex image gateway must use a local HTTP URL");
    }
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!path.endsWith("/v1")) parsed.pathname = `${path}/v1`.replace(/\/+/g, "/");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  }

  function validateLocalKey(value) {
    return /^[a-f0-9]{64}$/.test(String(value || "").trim());
  }

  function normalizeOptions(value = {}) {
    const quality = ["low", "medium", "high"].includes(value.quality)
      ? value.quality
      : DEFAULTS.quality;
    const dimensionMode = ["native", "strict_native", "exact_output"].includes(value.dimensionMode || value.dimension_mode)
      ? (value.dimensionMode || value.dimension_mode)
      : DEFAULTS.dimensionMode;
    const clientQueue = Math.max(1, Math.min(2, Math.floor(Number(value.clientQueue) || DEFAULTS.clientQueue)));
    return Object.freeze({
      quality,
      dimensionMode,
      asyncTasks: value.asyncTasks !== false,
      clientQueue,
    });
  }

  function validateCapabilities(value) {
    const caps = value && typeof value === "object" ? value : {};
    const missing = [];
    if (caps.image_only !== true) missing.push("image_only");
    if (caps.generations !== true) missing.push("generations");
    if (caps.edits !== true) missing.push("edits");
    if (caps.async_tasks !== true) missing.push("async_tasks");
    if (!Array.isArray(caps.models) || !caps.models.includes(MODEL)) missing.push(`model:${MODEL}`);
    if (Number(caps.max_reference_images || 0) < MAX_REFERENCE_IMAGES) missing.push(`max_reference_images>=${MAX_REFERENCE_IMAGES}`);
    if (!Array.isArray(caps.dimension_modes) || !caps.dimension_modes.includes("exact_output")) missing.push("dimension_mode:exact_output");
    return Object.freeze({ ok: missing.length === 0, missing: Object.freeze(missing), capabilities: caps });
  }

  function buildImageRequest({ prompt, size, refs = [], options = {} } = {}) {
    const normalized = normalizeOptions(options);
    const cleanPrompt = String(prompt || "").trim();
    if (!cleanPrompt) throw new Error("Prompt is required");
    if (!/^\d{2,5}x\d{2,5}$/i.test(String(size || ""))) throw new Error("Invalid image size");
    if (!Array.isArray(refs)) throw new Error("References must be an array");
    if (refs.length > MAX_REFERENCE_IMAGES) throw new Error(`The gateway accepts at most ${MAX_REFERENCE_IMAGES} references`);
    const images = refs.map((ref, index) => {
      const dataUrl = String(ref?.dataUrl || ref?.image_url || ref || "");
      if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(dataUrl)) {
        throw new Error(`Reference ${index + 1} must be a local PNG, JPEG, or WebP Data URL`);
      }
      return { image_url: dataUrl };
    });
    const body = {
      model: MODEL,
      prompt: cleanPrompt,
      size: String(size),
      quality: normalized.quality,
      n: 1,
      response_format: "b64_json",
      output_format: "png",
      dimension_mode: normalized.dimensionMode,
    };
    if (images.length) body.images = images;
    return Object.freeze({
      body,
      route: images.length ? "images/edits" : "images/generations",
      referenceCount: images.length,
      referenceBoardsExpected: images.length > DIRECT_REFERENCE_IMAGES,
      options: normalized,
    });
  }

  function extractTaskId(value) {
    return String(value?.id || value?.task_id || "").trim();
  }

  function normalizeTask(value) {
    const task = value && typeof value === "object" ? value : {};
    const status = String(task.status || "").toLowerCase();
    return Object.freeze({
      id: extractTaskId(task),
      status,
      terminal: ["succeeded", "failed", "cancelled"].includes(status),
      succeeded: status === "succeeded",
      failed: status === "failed",
      cancelled: status === "cancelled",
      result: task.result || null,
      error: task.error || null,
    });
  }

  function extractDimensionMetadata(result) {
    const first = result?.langbai?.dimensions?.[0] || null;
    if (!first || typeof first !== "object") return null;
    return Object.freeze({
      requestedSize: String(first.requested_size || ""),
      nativeSize: String(first.native_size || ""),
      finalSize: String(first.final_size || ""),
      action: String(first.dimension_action || ""),
    });
  }

  function buildSafeGatewayAudit(result, task = {}) {
    const langbai = result?.langbai || {};
    return Object.freeze({
      taskId: String(task.id || ""),
      upstreamRequestId: String(
        result?._responseMeta?.requestId
        || result?.request_id
        || langbai.upstream_request_id
        || "",
      ),
      referenceImagesReceived: Math.max(0, Number(langbai.reference_images_received) || 0),
      referenceImagesForwarded: Math.max(0, Number(langbai.reference_images_forwarded) || 0),
      referenceBoardsCompiled: langbai.reference_boards_compiled === true,
      dimensions: extractDimensionMetadata(result),
    });
  }

  return Object.freeze({
    PROVIDER_ID,
    BASE_URL,
    HEALTH_URL,
    CAPABILITIES_URL,
    MODEL,
    MAX_REFERENCE_IMAGES,
    DIRECT_REFERENCE_IMAGES,
    DEFAULTS,
    normalizeBaseUrl,
    validateLocalKey,
    normalizeOptions,
    validateCapabilities,
    buildImageRequest,
    extractTaskId,
    normalizeTask,
    extractDimensionMetadata,
    buildSafeGatewayAudit,
  });
});
