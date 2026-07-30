(function initImageTaskStability(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ImageTaskStability = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function imageTaskStabilityFactory() {
  "use strict";

  const ERROR_CATEGORIES = Object.freeze({
    moderation: "moderation_blocked",
    parameters: "invalid_parameters",
    authentication: "authentication_failed",
    account: "account_unavailable",
    payload: "payload_too_large",
    rateLimit: "rate_limited",
    providerUi: "provider_ui_unavailable",
    disconnected: "upstream_disconnected",
    unavailable: "upstream_unavailable",
    timeout: "upstream_timeout",
    taskNotFound: "task_not_found",
    decode: "decode_failed",
    canceled: "canceled",
    unknown: "unknown",
  });

  function textOf(value) {
    if (value instanceof Error) return String(value.message || value);
    if (value && typeof value === "object") {
      return String(value.message || value.error?.message || value.error || JSON.stringify(value));
    }
    return String(value || "");
  }

  function firstMatch(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1];
    }
    return "";
  }

  function parseSafetyViolations(text, source = null) {
    const values = [];
    const append = value => {
      String(value || "")
        .replace(/^\[|\]$/g, "")
        .split(/[,;\s]+/)
        .map(item => item.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean)
        .forEach(item => { if (!values.includes(item)) values.push(item); });
    };
    const structured = source?.safety_violations || source?.error?.safety_violations;
    if (Array.isArray(structured)) structured.forEach(append);
    else append(structured);
    append(firstMatch(text, [
      /safety_violations\s*=\s*\[([^\]]+)\]/i,
      /safety[_\s-]*violations?\s*[:=]\s*([^\n.]+)/i,
    ]));
    return values;
  }

  function classifyApiError(value, extra = {}) {
    const source = value && typeof value === "object" ? value : null;
    const message = textOf(value);
    const status = Number(extra.status || source?.status || firstMatch(message, [/HTTP\s*(\d{3})/i])) || 0;
    const code = String(
      extra.code
      || source?.code
      || source?.error?.code
      || firstMatch(message, [/\[([a-z][a-z0-9_-]+)\]/i, /\bcode\s*[:=]\s*["']?([a-z][a-z0-9_-]+)/i])
      || "",
    ).toLowerCase();
    const requestId = String(
      extra.requestId
      || source?.requestId
      || source?.request_id
      || source?.error?.request_id
      || firstMatch(message, [
        /request[_\s-]*id\s*[:=]?\s*([a-z0-9][a-z0-9_-]{7,})/i,
        /include the request ID\s+([a-z0-9-]{16,})/i,
      ])
      || "",
    );
    const safetyViolations = parseSafetyViolations(message, source);
    const lower = `${code} ${message}`.toLowerCase();

    let category = ERROR_CATEGORIES.unknown;
    let retryPolicy = "manual";
    let requiresEdit = false;
    let pausesQueue = false;

    if (/abort|cancel|client_closed_request/.test(lower) || status === 499) {
      category = ERROR_CATEGORIES.canceled;
      retryPolicy = "never";
    } else if (status === 404 && /task[_\s-]*not[_\s-]*found|not found/.test(lower)) {
      category = ERROR_CATEGORIES.taskNotFound;
      retryPolicy = "never";
    } else if (/moderation_blocked|safety system|safety_violations|content[_\s-]*policy/.test(lower)) {
      category = ERROR_CATEGORIES.moderation;
      retryPolicy = "edit_required";
      requiresEdit = true;
    } else if (
      /selector_pack_outdated|protocol_changed|gemini_temporary_chat_unavailable|temporary_chat_(unverified|guard_failed)|gemini_(composer_input_(failed|unstable)|trusted_text_failed|send_unavailable|submission_not_acknowledged|generated_image_recovery_failed|direct_(bootstrap|protocol|upload)_unavailable|no_image_returned|control_(missing|disabled|outside_viewport|occluded)|model_(unavailable|unverified))/.test(lower)
    ) {
      category = ERROR_CATEGORIES.providerUi;
      retryPolicy = "after_probe";
      pausesQueue = true;
    } else if (/gemini_account_(required|not_ready)/.test(lower)) {
      category = ERROR_CATEGORIES.account;
      retryPolicy = "after_configuration_change";
      pausesQueue = true;
    } else if (status === 401 || status === 403 || /invalid_api_key|authentication|unauthori[sz]ed|reauth/.test(lower)) {
      category = ERROR_CATEGORIES.authentication;
      retryPolicy = "after_configuration_change";
      pausesQueue = true;
    } else if (status === 413 || /payload too large|content too large|request entity too large/.test(lower)) {
      category = ERROR_CATEGORIES.payload;
      retryPolicy = "edit_required";
      requiresEdit = true;
    } else if (status === 429 || /rate[_\s-]*limit|quota|cooling down|too many requests/.test(lower)) {
      category = ERROR_CATEGORIES.rateLimit;
      retryPolicy = "after_delay";
      pausesQueue = true;
    } else if (status === 502 || /socket closed|socket hang up|econnreset|connection (?:reset|closed)|closed before full header|broken pipe|fetch failed/.test(lower)) {
      category = ERROR_CATEGORIES.disconnected;
      retryPolicy = "manual_limited";
    } else if (status === 503 || /service unavailable|upstream unavailable/.test(lower)) {
      category = ERROR_CATEGORIES.unavailable;
      retryPolicy = "after_probe";
      pausesQueue = true;
    } else if (status === 504 || /timed?\s*out|timeout/.test(lower)) {
      category = ERROR_CATEGORIES.timeout;
      retryPolicy = "manual_unknown_outcome";
    } else if (
      status === 400
      || status === 422
      || /invalid[_\s-]*(request|parameter)|unsupported parameter|not supported|image_dimension_mismatch/.test(lower)
    ) {
      category = ERROR_CATEGORIES.parameters;
      retryPolicy = "edit_required";
      requiresEdit = true;
    } else if (/base64|decode|invalid image|image data/.test(lower)) {
      category = ERROR_CATEGORIES.decode;
      retryPolicy = "manual";
    }

    return Object.freeze({
      category,
      status,
      code,
      requestId,
      safetyViolations: Object.freeze(safetyViolations),
      retryPolicy,
      requiresEdit,
      pausesQueue,
      originalMessage: message,
    });
  }

  function retryDirective(value, { attempt = 1, baseDelayMs = 1500, phase = "submit" } = {}) {
    const detail = value?.retryPolicy ? value : classifyApiError(value);
    const policy = String(detail.retryPolicy || "manual");
    const status = Number(detail.status || 0);
    const unknownSubmissionOutcome = phase === "submit" && (
      policy === "manual_unknown_outcome" || status === 504
    );
    const providerUiFailure = detail.category === ERROR_CATEGORIES.providerUi;
    const retryable = !unknownSubmissionOutcome && !providerUiFailure && (
      policy === "after_delay"
      || policy === "manual_limited"
      || policy === "after_probe"
    );
    const multiplier = status === 429 ? 2 : status === 503 ? 1.5 : 1;
    const delayMs = retryable
      ? Math.min(60_000, Math.round(Math.max(0, Number(baseDelayMs) || 0) * multiplier * (2 ** Math.max(0, Number(attempt) - 1))))
      : 0;
    return Object.freeze({
      retryable,
      delayMs,
      retryPolicy: policy,
      unknownSubmissionOutcome,
      providerUiFailure,
      status,
    });
  }

  function parsePixelSize(value) {
    const match = String(value || "").trim().toLowerCase().replace("×", "x").match(/^(\d{1,5})\s*x\s*(\d{1,5})$/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  function evaluateDimensions(requestedSize, actualWidth, actualHeight) {
    const requested = parsePixelSize(requestedSize);
    const width = Number(actualWidth) || 0;
    const height = Number(actualHeight) || 0;
    if (!requested || !width || !height) {
      return Object.freeze({ status: "unknown", requested, actual: width && height ? { width, height } : null });
    }
    return Object.freeze({
      status: requested.width === width && requested.height === height ? "exact" : "mismatch",
      requested,
      actual: { width, height },
    });
  }

  function normalizePrompt(value) {
    return String(value || "").replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()).join("\n").trim();
  }

  function bytesFromString(value) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(String(value));
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(String(value), "utf8"));
    throw new Error("UTF-8 encoder unavailable");
  }

  function sha256Fallback(bytes) {
    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const length = bytes.length;
    const paddedLength = Math.ceil((length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[length] = 0x80;
    const bitLength = length * 8;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);
    const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const words = new Uint32Array(64);
    const rotateRight = (value, shift) => (value >>> shift) | (value << (32 - shift));
    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4, false);
      for (let index = 16; index < 64; index++) {
        const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
        const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
        words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index++) {
        const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choice = (e & f) ^ (~e & g);
        const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
        const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (sum0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
    }
    return Array.from(hash, value => value.toString(16).padStart(8, "0")).join("");
  }

  async function sha256Hex(value) {
    let bytes;
    if (value instanceof Uint8Array) bytes = value;
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (typeof Blob !== "undefined" && value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer());
    else bytes = bytesFromString(value);
    if (!globalThis.crypto?.subtle) return sha256Fallback(bytes);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function dataUrlPayload(value) {
    const match = String(value || "").match(/^data:[^,]*;base64,(.*)$/is);
    return match?.[1]?.replace(/\s+/g, "") || "";
  }

  async function hashReference(reference) {
    const payload = dataUrlPayload(reference?.dataUrl);
    if (!payload) return "";
    let bytes;
    if (typeof atob === "function") {
      const binary = atob(payload);
      bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    } else if (typeof Buffer !== "undefined") {
      bytes = new Uint8Array(Buffer.from(payload, "base64"));
    } else {
      throw new Error("Base64 decoder unavailable");
    }
    return sha256Hex(bytes);
  }

  async function buildRequestAudit({ provider, model, prompt, size, quality, references = [] } = {}) {
    const promptNormalized = normalizePrompt(prompt);
    const promptSha256 = await sha256Hex(promptNormalized);
    const referenceSha256 = [];
    for (const reference of references) {
      const hash = await hashReference(reference);
      if (hash) referenceSha256.push(hash);
    }
    const fingerprintSource = JSON.stringify({
      provider: String(provider || ""),
      model: String(model || ""),
      prompt: promptNormalized,
      size: String(size || ""),
      quality: String(quality || ""),
      references: referenceSha256,
    });
    return Object.freeze({
      promptSha256,
      referenceSha256: Object.freeze(referenceSha256),
      requestFingerprint: await sha256Hex(fingerprintSource),
    });
  }

  function createOpenCodexRuntime({ initialConcurrency = 100, circuitFailureThreshold = 3, circuitMs = 45_000 } = {}) {
    const state = {
      concurrency: Math.max(1, Number(initialConcurrency) || 100),
      upstreamFailureStreak: 0,
      circuitOpenUntil: 0,
      referenceRoute: "unknown",
      referenceFailure: "",
    };
    return Object.freeze({
      snapshot() { return Object.freeze({ ...state }); },
      beforeRequest({ hasReference = false, now = Date.now() } = {}) {
        if (state.circuitOpenUntil > now) {
          return Object.freeze({ allowed: false, reason: "circuit_open", retryAfterMs: state.circuitOpenUntil - now });
        }
        if (hasReference && state.referenceRoute === "unavailable") {
          return Object.freeze({ allowed: false, reason: "reference_route_unavailable", detail: state.referenceFailure });
        }
        return Object.freeze({ allowed: true });
      },
      recordSuccess({ hasReference = false } = {}) {
        state.upstreamFailureStreak = 0;
        if (hasReference) {
          state.referenceRoute = "ready";
          state.referenceFailure = "";
        }
      },
      recordFailure(classification, { hasReference = false, message = "", now = Date.now() } = {}) {
        const category = classification?.category || ERROR_CATEGORIES.unknown;
        if (category === ERROR_CATEGORIES.disconnected || category === ERROR_CATEGORIES.unavailable) {
          state.upstreamFailureStreak += 1;
          if (state.upstreamFailureStreak >= 2) state.concurrency = 1;
          if (state.upstreamFailureStreak >= circuitFailureThreshold) state.circuitOpenUntil = now + circuitMs;
          if (hasReference) {
            state.referenceRoute = "unavailable";
            state.referenceFailure = String(message || classification?.originalMessage || "").slice(0, 300);
          }
        } else if (category !== ERROR_CATEGORIES.canceled) {
          state.upstreamFailureStreak = 0;
        }
      },
      resetAfterHealthCheck({ resetReference = false } = {}) {
        state.circuitOpenUntil = 0;
        state.upstreamFailureStreak = 0;
        state.concurrency = Math.max(1, Number(initialConcurrency) || 100);
        if (resetReference) {
          state.referenceRoute = "unknown";
          state.referenceFailure = "";
        }
      },
    });
  }

  return Object.freeze({
    ERROR_CATEGORIES,
    classifyApiError,
    retryDirective,
    parsePixelSize,
    evaluateDimensions,
    normalizePrompt,
    sha256Hex,
    sha256Fallback,
    hashReference,
    buildRequestAudit,
    createOpenCodexRuntime,
  });
});
