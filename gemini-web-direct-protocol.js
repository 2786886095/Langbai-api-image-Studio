"use strict";

(() => {
  if (globalThis.LANGBAI_GEMINI_DIRECT_PROTOCOL) return;

  const GENERATE_PATH =
    "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
  const UPLOAD_URL = "https://content-push.googleapis.com/upload";
  const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
  const MODEL_HEADERS = Object.freeze({
    fast: ["fbb127bbb056c959", 1],
    pro: ["9d8ca3786ebdfbea", 1],
  });

  function error(message, code, extra = {}) {
    return Object.assign(new Error(message), { code, ...extra });
  }

  function nested(value, path, fallback = null) {
    let current = value;
    for (const key of path) {
      if (current == null || typeof current !== "object" || !(key in current)) {
        return fallback;
      }
      current = current[key];
    }
    return current ?? fallback;
  }

  function decodeBootstrapString(value) {
    const source = String(value || "");
    return source
      .replace(/\\u003d/gi, "=")
      .replace(/\\u0026/gi, "&")
      .replace(/\\\//g, "/")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  function extractBootstrapField(source, field) {
    const direct = globalThis.WIZ_global_data?.[field];
    if (typeof direct === "string" && direct) return direct;
    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`"${escapedField}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`),
      new RegExp(`\\\\"${escapedField}\\\\"\\s*:\\s*\\\\"((?:\\\\.|[^"\\\\])*)\\\\"`),
    ];
    for (const pattern of patterns) {
      const match = String(source || "").match(pattern);
      if (match?.[1]) return decodeBootstrapString(match[1]);
    }
    return "";
  }

  async function bootstrap(fetchImpl = fetch) {
    const read = source => ({
      accessToken: extractBootstrapField(source, "SNlM0e"),
      buildLabel: extractBootstrapField(source, "cfb2h"),
      sessionId: extractBootstrapField(source, "FdrFJe"),
      language:
        extractBootstrapField(source, "TuX5cc")
        || document.documentElement?.lang
        || "zh-CN",
      pushId: extractBootstrapField(source, "qKIAYe"),
    });
    let values = read(document.documentElement?.innerHTML || "");
    if (!values.accessToken) {
      const response = await fetchImpl("/app", {
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
      });
      if (!response.ok) {
        throw error(
          `Gemini 登录页令牌读取失败：HTTP ${response.status}`,
          "gemini_direct_bootstrap_unavailable",
        );
      }
      values = read(await response.text());
    }
    if (!values.accessToken) {
      throw error(
        "Gemini 页面没有提供直接调用令牌，请刷新登录状态。",
        "gemini_direct_bootstrap_unavailable",
      );
    }
    return values;
  }

  function uuid() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().toUpperCase();
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes]
      .map(value => value.toString(16).padStart(2, "0"))
      .join("");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-").toUpperCase();
  }

  function modelHeaders(preference) {
    const selected = MODEL_HEADERS[String(preference || "auto").toLowerCase()];
    if (!selected) return {};
    return {
      "x-goog-ext-525001261-jspb":
        `[1,null,null,null,"${selected[0]}",null,null,0,[4],null,null,${selected[1]}]`,
      "x-goog-ext-73010989-jspb": "[0]",
      "x-goog-ext-73010990-jspb": "[0]",
    };
  }

  async function uploadReferences(references, state, fetchImpl = fetch) {
    if (!Array.isArray(references) || references.length === 0) return null;
    if (!state.pushId) {
      throw error(
        "Gemini 页面没有提供参考图上传标识。",
        "gemini_direct_upload_unavailable",
      );
    }
    const uploaded = [];
    for (const [index, reference] of references.entries()) {
      const input = await fetchImpl(reference.data_url);
      if (!input.ok) {
        throw error(
          `读取参考图 ${index + 1} 失败：HTTP ${input.status}`,
          "reference_upload_failed",
        );
      }
      const blob = await input.blob();
      const name = String(reference.file_name || `reference-${index + 1}.png`);
      const form = new FormData();
      form.append("file", new File([blob], name, {
        type: blob.type || "image/png",
      }));
      const response = await fetchImpl(UPLOAD_URL, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-Tenant-Id": "bard-storage",
          "Push-ID": state.pushId,
        },
        body: form,
      });
      if (!response.ok) {
        throw error(
          `Gemini 参考图上传失败：HTTP ${response.status}`,
          "reference_upload_failed",
        );
      }
      const uploadedUrl = (await response.text()).trim();
      if (
        uploadedUrl.length < 12
        || uploadedUrl.length > 8192
        || !/^https:\/\/[^\s]+$/i.test(uploadedUrl)
      ) {
        throw error(
          "Gemini reference upload returned an invalid file URL; generation was not submitted.",
          "reference_upload_failed",
        );
      }
      uploaded.push([[uploadedUrl], name]);
    }
    return uploaded;
  }

  function streamPayloads(raw) {
    const payloads = [];
    const seen = new Set();
    const visit = (value, depth = 0) => {
      if (
        depth > 12
        || value == null
        || typeof value !== "object"
        || seen.has(value)
      ) return;
      seen.add(value);
      if (
        Array.isArray(value)
        && typeof value[2] === "string"
        && /^[\[{]/.test(value[2].trim())
      ) {
        try {
          const decoded = JSON.parse(value[2]);
          payloads.push(decoded);
          visit(decoded, depth + 1);
        } catch {}
      }
      const children = Array.isArray(value) ? value : Object.values(value);
      for (const child of children.slice(0, 500)) visit(child, depth + 1);
    };
    for (const line of String(raw || "").split(/\r?\n/)) {
      const candidate = line.trim();
      if (!candidate.startsWith("[")) continue;
      try {
        visit(JSON.parse(candidate));
      } catch {}
    }
    return payloads;
  }

  function generatedImages(raw) {
    const images = [];
    for (const payload of streamPayloads(raw)) {
      const metadata = nested(payload, [1], []);
      const candidates = nested(payload, [4], []);
      if (!Array.isArray(candidates)) continue;
      for (const candidate of candidates) {
        const groups = [
          nested(candidate, [12, 7, 0], []),
          nested(candidate, [12, 0, "8", 0], []),
        ];
        for (const group of groups) {
          if (!Array.isArray(group)) continue;
          for (const entry of group) {
            const url = nested(entry, [0, 3, 3], "");
            if (!/^https:\/\//i.test(String(url || ""))) continue;
            images.push({
              url: String(url),
              imageId: String(nested(entry, [1, 0], "")),
              cid: String(metadata?.[0] || ""),
              rid: String(metadata?.[1] || ""),
              rcid: String(candidate?.[0] || ""),
            });
          }
        }
      }
    }
    const unique = new Map();
    for (const image of images) unique.set(image.url, image);
    return [...unique.values()];
  }

  function responseFailure(raw) {
    const text = String(raw || "")
      .replace(/\\"/g, '"')
      .replace(/\\u[\da-f]{4}/gi, value => {
        try {
          return String.fromCharCode(Number.parseInt(value.slice(2), 16));
        } catch {
          return value;
        }
      })
      .normalize("NFKC");
    if (
      /\u989d\u5ea6\u9650\u5236\u5f71\u54cd\u56fe\u7247\u751f\u6210|\u989d\u5ea6\u91cd\u7f6e\u540e\u624d\u80fd\u751f\u6210\u56fe\u7247|\u56fe\u7247\u751f\u6210.*(?:\u989d\u5ea6|\u9650\u5236)|(?:\u989d\u5ea6|\u6b21\u6570).*(?:\u8017\u5c3d|\u7528\u5b8c|\u91cd\u7f6e)|image generation.*(?:limit|quota)|quota.*image generation/i.test(text)
    ) {
      return {
        code: "quota_exhausted",
        accountStatus: "quota_exhausted",
        message: "\u5f53\u524d Gemini \u8d26\u53f7\u7684\u56fe\u7247\u751f\u6210\u989d\u5ea6\u5df2\u8017\u5c3d\uff0c\u8bf7\u7b49\u5f85\u989d\u5ea6\u91cd\u7f6e\u6216\u5207\u6362\u8d26\u53f7\u3002",
      };
    }
    if (/too many requests|rate.?limit|\u7a0d\u540e\u518d\u8bd5|\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41/i.test(text)) {
      return {
        code: "gemini_rate_limited",
        accountStatus: "rate_limited",
        message: "Gemini \u5f53\u524d\u6b63\u5728\u9650\u6d41\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
      };
    }
    if (/sign.?in|log.?in|session expired|\u767b\u5f55.*\u5931\u6548/i.test(text)) {
      return {
        code: "gemini_login_required",
        accountStatus: "needs_login",
        message: "Gemini \u767b\u5f55\u72b6\u6001\u5df2\u5931\u6548\u3002",
      };
    }
    if (/safety|policy|\u5185\u5bb9\u5ba1\u6838|\u8fdd\u53cd.*\u653f\u7b56|\u65e0\u6cd5\u751f\u6210.*(?:\u5b89\u5168|\u653f\u7b56|\u5185\u5bb9)/i.test(text)) {
      return {
        code: "moderation_blocked",
        accountStatus: "",
        message: "Gemini \u56e0\u5185\u5bb9\u5ba1\u6838\u6ca1\u6709\u8fd4\u56de\u56fe\u7247\u3002",
      };
    }
    return null;
  }
  async function readResponse(response, heartbeat = null) {
    if (!response.body?.getReader) return response.text();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let output = "";
    let lastHeartbeat = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
      if (output.length > MAX_RESPONSE_BYTES) {
        throw error(
          "Gemini 直接调用响应超过解析上限。",
          "gemini_direct_response_oversized",
          { directSubmissionStarted: true },
        );
      }
      if (heartbeat && Date.now() - lastHeartbeat > 10000) {
        await heartbeat();
        lastHeartbeat = Date.now();
      }
    }
    return output + decoder.decode();
  }

  async function generate({
    prompt,
    references = [],
    modelPreference = "auto",
    fetchImpl = fetch,
    heartbeat = null,
    onBeforeSubmit = null,
  } = {}) {
    const state = await bootstrap(fetchImpl);
    const uploaded = await uploadReferences(references, state, fetchImpl);
    const message = [String(prompt || "").trim(), 0, null, uploaded, null, null, 0];
    const inner = Array(69).fill(null);
    inner[0] = message;
    inner[1] = [state.language || "zh-CN"];
    inner[2] = ["", "", "", null, null, null, null, null, null, ""];
    inner[6] = [1];
    inner[7] = 1;
    inner[10] = 1;
    inner[11] = 0;
    inner[17] = [[0]];
    inner[18] = 0;
    inner[27] = 1;
    inner[30] = [4];
    inner[41] = [1];
    inner[45] = 1;
    inner[53] = 0;
    inner[59] = uuid();
    inner[61] = [];
    inner[68] = 2;

    const query = new URLSearchParams({
      hl: state.language || "zh-CN",
      _reqid: String(Math.floor(10000 + Math.random() * 90000)),
      rt: "c",
    });
    if (state.buildLabel) query.set("bl", state.buildLabel);
    if (state.sessionId) query.set("f.sid", state.sessionId);
    const body = new URLSearchParams({
      at: state.accessToken,
      "f.req": JSON.stringify([null, JSON.stringify(inner)]),
    });

    if (typeof onBeforeSubmit === "function") await onBeforeSubmit();
    let response;
    try {
      response = await fetchImpl(`${GENERATE_PATH}?${query}`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "X-Same-Domain": "1",
          "x-goog-ext-525005358-jspb": `["${inner[59]}",1]`,
          ...modelHeaders(modelPreference),
        },
        body,
      });
    } catch (cause) {
      throw error(
        `Gemini 直接调用连接失败：${String(cause?.message || cause)}`,
        "gemini_direct_connection_failed",
        { directSubmissionStarted: true },
      );
    }
    if (!response.ok) {
      const rawError = await response.text().catch(() => "");
      const classified = responseFailure(rawError);
      const requestId =
        response.headers.get("x-request-id")
        || response.headers.get("request-id")
        || "";
      const code = classified?.code
        || (response.status === 429
          ? "gemini_rate_limited"
          : response.status === 401 || response.status === 403
            ? "gemini_login_required"
            : response.status === 400 || response.status === 404
              ? "invalid_parameters"
              : response.status === 413
                ? "payload_too_large"
                : response.status >= 500
                  ? "upstream_disconnected"
                  : "gemini_direct_request_failed");
      throw error(
        classified?.message
        || `Gemini direct request returned HTTP ${response.status}`
        + (rawError ? `: ${rawError.replace(/\s+/g, " ").slice(0, 500)}` : ""),
        code,
        {
          accountStatus: classified?.accountStatus
            || (response.status === 429
              ? "rate_limited"
              : response.status === 401 || response.status === 403
                ? "needs_login"
                : ""),
          ...(requestId ? { requestId } : {}),
          directSubmissionStarted: true,
        },
      );
    }

    const raw = await readResponse(response, heartbeat);
    const images = generatedImages(raw);
    if (!images.length) {
      const failure = responseFailure(raw);
      if (failure) {
        throw error(
          failure.message,
          failure.code,
          {
            accountStatus: failure.accountStatus,
            directSubmissionStarted: true,
          },
        );
      }
      throw error(
        `Gemini 直接调用已结束但没有返回生成图片。responseTail=${raw.replace(/\s+/g, " ").slice(-800)}`,
        "gemini_no_image_returned",
        { directSubmissionStarted: true },
      );
    }
    return {
      image: images[0],
      imageCount: images.length,
      transport: "gemini_web_direct_rpc",
      temporaryRequested: true,
      temporaryVerified: false,
    };
  }

  globalThis.LANGBAI_GEMINI_DIRECT_PROTOCOL = Object.freeze({
    generate,
    _test: Object.freeze({
      generatedImages,
      modelHeaders,
      responseFailure,
      streamPayloads,
    }),
  });
})();
