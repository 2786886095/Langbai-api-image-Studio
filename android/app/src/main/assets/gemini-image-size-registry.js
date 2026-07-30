(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GeminiImageSizeRegistry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROVIDER_ID = "geminiWeb";
  const RATIOS = Object.freeze(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);
  const SIZE_MODES = Object.freeze(["native_fullsize"]);
  const CROP_MODES = Object.freeze(["smart_cover", "center_cover", "contain"]);
  const TARGET_PRESETS = Object.freeze([
    "1024x1024", "1264x848", "848x1264", "896x1200", "1200x896",
    "928x1152", "1152x928", "768x1376", "1376x768", "1584x672",
    "2048x2048", "1696x2528", "2528x1696", "1792x2400", "2400x1792",
    "1856x2304", "2304x1856", "1536x2752", "2752x1536", "3168x1344",
  ]);
  const VERIFIED_NATIVE = Object.freeze({
    "1:1": Object.freeze({ width: 2048, height: 2048, resolution: "2k", status: "verified" }),
    "3:2": Object.freeze({ width: 2528, height: 1696, resolution: "2k", status: "verified" }),
  });
  const DEFAULTS = Object.freeze({
    sizeMode: "native_fullsize",
    ratio: "auto",
    targetSize: "848x1264",
    cropMode: "smart_cover",
    qualityIntent: "standard",
    modelPreference: "auto",
    clientQueue: 10,
  });

  function clampInteger(value, minimum, maximum, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
  }

  function parseSize(value) {
    const match = String(value || "").trim().match(/^(\d{2,5})x(\d{2,5})$/i);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width < 64 || height < 64 || width > 7680 || height > 7680) return null;
    return { width, height, text: `${width}x${height}`, ratio: width / height };
  }

  function ratioValue(value) {
    const match = String(value || "").match(/^(\d+):(\d+)$/);
    if (!match || Number(match[2]) === 0) return 1;
    return Number(match[1]) / Number(match[2]);
  }

  function nearestRatio(width, height, candidates = RATIOS) {
    const target = Number(width) / Math.max(1, Number(height));
    return [...candidates].reduce((best, candidate) => {
      const distance = Math.abs(Math.log(target / ratioValue(candidate)));
      return !best || distance < best.distance ? { ratio: candidate, distance } : best;
    }, null)?.ratio || "1:1";
  }

  function normalizeOptions(value = {}) {
    value = value && typeof value === "object" ? value : {};
    const sizeMode = SIZE_MODES.includes(value.sizeMode || value.size_mode)
      ? (value.sizeMode || value.size_mode)
      : DEFAULTS.sizeMode;
    const parsedTarget = parseSize(value.targetSize || value.target_size || DEFAULTS.targetSize)
      || parseSize(DEFAULTS.targetSize);
    const targetSize = parsedTarget.text;
    const requestedRatio = value.ratio || value.requested_ratio || DEFAULTS.ratio;
    const ratio = requestedRatio === "auto"
      ? "auto"
      : RATIOS.includes(requestedRatio) ? requestedRatio : DEFAULTS.ratio;
    const cropMode = CROP_MODES.includes(value.cropMode || value.crop_mode)
      ? (value.cropMode || value.crop_mode)
      : DEFAULTS.cropMode;
    const qualityIntent = ["fast", "standard", "detail"].includes(value.qualityIntent || value.quality_intent)
      ? (value.qualityIntent || value.quality_intent)
      : DEFAULTS.qualityIntent;
    const modelPreference = ["auto", "fast", "pro"].includes(value.modelPreference || value.model_preference)
      ? (value.modelPreference || value.model_preference)
      : DEFAULTS.modelPreference;
    return {
      sizeMode,
      ratio,
      targetSize,
      cropMode,
      qualityIntent,
      modelPreference,
      clientQueue: clampInteger(value.clientQueue ?? value.client_queue, 1, 100, DEFAULTS.clientQueue),
    };
  }

  function resolveRequest(value = {}) {
    const options = normalizeOptions(value);
    const target = parseSize(options.targetSize);
    const ratio = options.ratio === "auto" ? nearestRatio(target.width, target.height) : options.ratio;
    const native = VERIFIED_NATIVE[ratio] || null;
    return {
      ...options,
      ratio,
      target,
      resolutionIntent: "2k",
      verifiedNative: native,
      requiresPostProcess: false,
      requiresExactNative: false,
    };
  }

  function planTransform(sourceWidth, sourceHeight, targetWidth, targetHeight, cropMode = "smart_cover") {
    const source = { width: Number(sourceWidth), height: Number(sourceHeight) };
    const target = { width: Number(targetWidth), height: Number(targetHeight) };
    if (![source.width, source.height, target.width, target.height].every(value => Number.isFinite(value) && value > 0)) {
      throw new Error("Invalid image dimensions");
    }
    if (source.width === target.width && source.height === target.height) {
      return { action: "none", sourceRect: [0, 0, source.width, source.height], targetRect: [0, 0, target.width, target.height] };
    }
    if (cropMode === "contain") {
      const scale = Math.min(target.width / source.width, target.height / source.height);
      const drawWidth = Math.max(1, Math.round(source.width * scale));
      const drawHeight = Math.max(1, Math.round(source.height * scale));
      return {
        action: "contain+high_quality_resample",
        sourceRect: [0, 0, source.width, source.height],
        targetRect: [
          Math.floor((target.width - drawWidth) / 2),
          Math.floor((target.height - drawHeight) / 2),
          drawWidth,
          drawHeight,
        ],
      };
    }
    const scale = Math.max(target.width / source.width, target.height / source.height);
    const cropWidth = Math.min(source.width, target.width / scale);
    const cropHeight = Math.min(source.height, target.height / scale);
    return {
      action: `${cropMode === "smart_cover" ? "safe_zone_center_crop" : "center_cover_crop"}+high_quality_resample`,
      sourceRect: [
        Math.max(0, Math.round((source.width - cropWidth) / 2)),
        Math.max(0, Math.round((source.height - cropHeight) / 2)),
        Math.max(1, Math.round(cropWidth)),
        Math.max(1, Math.round(cropHeight)),
      ],
      targetRect: [0, 0, target.width, target.height],
    };
  }

  function buildPromptPrefix(resolved) {
    const target = resolved.target;
    const orientation = target.width === target.height ? "正方形" : target.width > target.height ? "横向" : "竖向";
    const quality = resolved.qualityIntent === "detail"
      ? "细节优先，保留精细纹理与清晰边缘"
      : resolved.qualityIntent === "fast"
        ? "构图优先，减少不必要的复杂微小元素"
        : "兼顾构图、细节与生成稳定性";
    return [
      `${orientation} ${resolved.ratio} 构图，按网页原生 2K 细节绘制。`,
      `${quality}。`,
      `全局分辨率 ${target.text} 仅用于确定构图方向与最接近比例。`,
      `完整保留画面内容；不要在画面内写入尺寸说明。`,
    ].join("");
  }

  return Object.freeze({
    PROVIDER_ID,
    RATIOS,
    SIZE_MODES,
    CROP_MODES,
    TARGET_PRESETS,
    VERIFIED_NATIVE,
    DEFAULTS,
    parseSize,
    nearestRatio,
    normalizeOptions,
    resolveRequest,
    planTransform,
    buildPromptPrefix,
  });
});
