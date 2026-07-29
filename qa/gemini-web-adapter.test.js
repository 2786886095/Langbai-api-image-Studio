"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sizes = require("../gemini-image-size-registry.js");
const adapter = require("../gemini-web-image-adapter.js");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("uses an isolated Gemini provider and loopback bridge", () => {
  assert.equal(adapter.PROVIDER_ID, "geminiWeb");
  assert.equal(adapter.normalizeBaseUrl("http://localhost:18160/v1/"), "http://127.0.0.1:18160/v1");
  assert.throws(() => adapter.normalizeBaseUrl("https://gemini.google.com/v1"));
});

test("selects ratios symmetrically and supports requested presets", () => {
  assert.equal(sizes.nearestRatio(832, 1216), "2:3");
  assert.equal(sizes.nearestRatio(1216, 832), "3:2");
  assert.equal(sizes.nearestRatio(1920, 1080), "16:9");
  assert.ok(sizes.TARGET_PRESETS.includes("3840x2160"));
});

test("damaged legacy Gemini options fall back without crashing startup", () => {
  const normalized = sizes.normalizeOptions({
    targetSize: "broken-size",
    ratio: "broken-ratio",
    qualityIntent: "broken-quality",
    modelPreference: "broken-model",
  });
  assert.equal(normalized.targetSize, sizes.DEFAULTS.targetSize);
  assert.equal(normalized.ratio, sizes.DEFAULTS.ratio);
  assert.equal(normalized.qualityIntent, sizes.DEFAULTS.qualityIntent);
  assert.equal(normalized.modelPreference, sizes.DEFAULTS.modelPreference);
  assert.doesNotThrow(() => sizes.normalizeOptions(null));
  assert.doesNotThrow(() => sizes.normalizeOptions("legacy"));
});

test("builds one resumable temporary-chat task without credentials", () => {
  const task = adapter.buildTaskRequest({
    prompt: "漫画分镜",
    size: "832x1216",
    refs: [{ dataUrl: "data:image/png;base64,AA==", fileName: "ref.png", width: 1, height: 1 }],
    options: {
      sizeMode: "exact_output",
      qualityIntent: "detail",
      modelPreference: "pro",
      clientQueue: 20,
    },
    clientRequestId: "request-1",
  });
  assert.equal(task.provider, "geminiWeb");
  assert.equal(task.n, 1);
  assert.equal(task.temporary_chat_required, true);
  assert.equal(task.requested_ratio, "2:3");
  assert.equal(task.requested_size.width, 832);
  assert.equal(task.references.length, 1);
  assert.equal(task.quality_intent, "detail");
  assert.equal(task.model_preference, "pro");
  assert.equal(JSON.stringify(task).includes("cookie"), false);
  assert.equal(JSON.stringify(task).includes("token"), false);
});

test("plans exact output without non-uniform stretching", () => {
  const plan = sizes.planTransform(2528, 1696, 1920, 1080, "center_cover");
  assert.equal(plan.targetRect.join(","), "0,0,1920,1080");
  assert.match(plan.action, /cover_crop/);
  assert.ok(plan.sourceRect[2] <= 2528 && plan.sourceRect[3] <= 1696);
});

test("validates companion capabilities and produces a safe audit", () => {
  assert.equal(adapter.validateCapabilities({
    provider: "gemini_web",
    temporary_chat_required: true,
    fullsize_download: true,
    dimension_modes: ["native_fullsize", "exact_output"],
  }).ok, true);
  const audit = adapter.buildSafeAudit({
    id: "gemini-task-1",
    account_id: "account-secret-id",
    status: "succeeded",
    audit: {
      requested_size: "832x1216",
      downloaded_fullsize: "1696x2528",
      final_size: "832x1216",
      requested_model_mode: "pro",
      selected_model_mode: "pro",
    },
  });
  assert.equal(audit.accountSuffix, "t-id");
  assert.equal(audit.requestedModelMode, "pro");
  assert.equal(audit.selectedModelMode, "pro");
  assert.equal(JSON.stringify(audit).includes("secret"), false);
});

test("uses the Windows native input bridge for Gemini controls", () => {
  const worker = fs.readFileSync(
    path.join(__dirname, "..", "gemini-embedded-worker.js"),
    "utf8",
  );
  assert.match(worker, /"trusted-click-request"/);
  assert.match(worker, /"image-download-request"/);
  assert.match(worker, /await activateControl\(button\)/);
  assert.match(worker, /await activateControl\(action\)/);
  assert.match(worker, /await activateControl\(send\)/);
  assert.match(worker, /async function selectGeminiModel\(preference = "auto"\)/);
  assert.match(worker, /await selectGeminiModel\(request\.model_preference \|\| "auto"\)/);
  assert.doesNotMatch(worker, /\bbutton\.click\(\)/);
  assert.doesNotMatch(worker, /\baction\.click\(\)/);
  assert.doesNotMatch(worker, /\bsend\.click\(\)/);
});

test("forces image output and terminates no-image responses", () => {
  const worker = fs.readFileSync(
    path.join(__dirname, "..", "gemini-embedded-worker.js"),
    "utf8",
  );
  assert.match(worker, /请立即生成一张图片，不要只回复文字、解释或提示词；直接输出图片/);
  assert.match(worker, /function modelResponseSnapshot\(\)/);
  assert.match(worker, /function generationIsActive\(\)/);
  assert.match(worker, /async function waitForSubmissionAck\(composer, baseline, timeoutMs = 15000\)/);
  assert.match(worker, /code: "gemini_submission_not_acknowledged"/);
  assert.match(worker, /code: "gemini_no_image_returned"/);
  assert.match(worker, /code: "gemini_no_image_timeout"/);
  assert.match(worker, /nodes: new WeakSet\(images\)/);
  assert.match(worker, /currentTask\?\.status === "succeeded"/);
  assert.match(worker, /code: body\?\.error\?\.code \|\| "gemini_result_save_failed"/);
  assert.doesNotMatch(worker, /waitForGeneratedImage\(\s*previous,\s*0,/);
});

test("writes exact global dimensions into the cached Gemini task result", () => {
  const worker = fs.readFileSync(
    path.join(__dirname, "..", "gemini-embedded-worker.js"),
    "utf8",
  );
  assert.match(worker, /async function transformForRequestedOutput\(blob, request = \{\}\)/);
  assert.match(worker, /\["exact_output", "local_4k_upscale"\]\.includes\(sizeMode\)/);
  assert.match(worker, /context\.drawImage\(decoded\.source, \.\.\.sourceRect, \.\.\.targetRect\)/);
  assert.match(worker, /const processed = await transformForRequestedOutput\(downloadedBlob, request\)/);
  assert.match(worker, /final_size: `\$\{processed\.final\.width\}x\$\{processed\.final\.height\}`/);
  assert.match(worker, /body: blob/);
});

console.log("\nGemini web adapter tests passed.");
