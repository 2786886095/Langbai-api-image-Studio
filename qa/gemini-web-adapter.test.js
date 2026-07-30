"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
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
  assert.equal(sizes.normalizeOptions({ sizeMode: "exact_output" }).sizeMode, "native_fullsize");
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
  assert.equal(task.size_mode, "native_fullsize");
  assert.equal(task.quality_intent, "detail");
  assert.equal(task.model_preference, "pro");
  assert.equal(JSON.stringify(task).includes("cookie"), false);
  assert.equal(JSON.stringify(task).includes("token"), false);
});

test("rejects more than twenty references before creating a Gemini task", () => {
  const refs = Array.from({ length: 21 }, (_, index) => ({
    dataUrl: "data:image/png;base64,AA==",
    fileName: `ref-${index}.png`,
  }));
  assert.throws(
    () => adapter.buildTaskRequest({ prompt: "too many refs", size: "1024x1024", refs }),
    error => error?.status === 400 && error?.code === "too_many_reference_images",
  );
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
    temporary_chat_required: false,
    temporary_chat_available: false,
    direct_protocol_available: true,
    fullsize_download: true,
    dimension_modes: ["native_fullsize"],
  }).ok, true);
  const unavailable = adapter.validateCapabilities({
    provider: "gemini_web",
    temporary_chat_required: false,
    temporary_chat_available: false,
    direct_protocol_available: false,
    fullsize_download: true,
    dimension_modes: ["native_fullsize"],
  });
  assert.equal(unavailable.ok, false);
  assert.deepEqual(unavailable.missing, ["gemini_generation_transport"]);
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
  assert.match(worker, /"trusted-text-request"/);
  assert.match(worker, /"image-download-request"/);
  assert.match(worker, /await activateControl\(button\)/);
  assert.match(worker, /await activateControl\(action\)/);
  assert.match(worker, /await activateControl\(send\)/);
  assert.match(worker, /async function selectGeminiModel\(preference = "auto"\)/);
  assert.match(worker, /"bard-mode-switcher,bard-mode-switcher \*"/);
  assert.match(worker, /\.replace\(\/\[A-Z0-9\._%\+-\]\+@/);
  assert.match(worker, /await selectGeminiModel\(request\.model_preference \|\| "auto"\)/);
  assert.match(worker, /!element\.closest\("nav,aside,\[role=navigation\]"\)/);
  assert.doesNotMatch(worker, /findByCandidates\(SELECTORS\.imageAction\)/);
  assert.doesNotMatch(worker, /\bbutton\.click\(\)/);
  assert.doesNotMatch(worker, /\baction\.click\(\)/);
});

test("forces image output and terminates no-image responses", () => {
  const worker = fs.readFileSync(
    path.join(__dirname, "..", "gemini-embedded-worker.js"),
    "utf8",
  );
  assert.match(worker, /请立即生成一张图片，不要只回复文字、解释或提示词；直接输出图片/);
  assert.match(worker, /function modelResponseSnapshot\(\)/);
  assert.match(worker, /"user-query \.query-text"/);
  assert.match(worker, /"user-query \.query-content"/);
  assert.match(worker, /function generationIsActive\(\)/);
  assert.match(worker, /document\.execCommand\?\.\("insertText", false, text\)/);
  assert.match(worker, /async function waitForStableComposerPrompt\(/);
  assert.match(worker, /async function writeStableComposerPrompt\(/);
  assert.match(worker, /const composer = findComposer\(\)/);
  assert.match(worker, /code: sawComposer\s*\?\s*"gemini_composer_input_unstable"/);
  assert.match(worker, /async function waitForEnabledSendControl\(/);
  assert.match(worker, /function promptStillPending\(/);
  assert.match(worker, /function submissionDiagnostic\(/);
  assert.match(worker, /async function waitForChangedSubmission\(/);
  assert.match(worker, /async function submitPromptAndWait\(/);
  assert.match(worker, /send\.click\(\)/);
  assert.match(worker, /promptStillPending\(composer, baseline, prompt\)/);
  assert.match(
    worker,
    /async function waitForSubmissionAck\(\s*composer,\s*baseline,\s*expectedPrompt,\s*timeoutMs = 15000,/,
  );
  assert.match(worker, /normalizedLatestUser\.includes\(promptProbe\)/);
  assert.match(worker, /if \(userMessageMatches\)/);
  assert.match(
    worker,
    /submitPromptAndWait\(\{\s*composer,\s*send,\s*baseline: submissionBaseline,\s*prompt,/,
  );
  assert.match(worker, /code: "gemini_submission_not_acknowledged"/);
  assert.match(worker, /code: "gemini_no_image_returned"/);
  assert.match(worker, /code: "gemini_no_image_timeout"/);
  assert.match(worker, /await event\(task, "locating_full_size", null, audit\)/);
  assert.match(worker, /nodes: new WeakSet\(images\)/);
  assert.match(worker, /currentTask\?\.status === "succeeded"/);
  assert.match(worker, /code: resultBody\?\.error\?\.code \|\| "gemini_result_save_failed"/);
  assert.doesNotMatch(worker, /waitForGeneratedImage\(\s*previous,\s*0,/);
});

test("direct Gemini protocol bypasses the composer and extracts generated images", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "gemini-web-direct-protocol.js"),
    "utf8",
  );
  const sandbox = {
    console,
    URL,
    URLSearchParams,
    TextDecoder,
  };
  vm.runInNewContext(source, sandbox, {
    filename: "gemini-web-direct-protocol.js",
  });
  const protocol = sandbox.LANGBAI_GEMINI_DIRECT_PROTOCOL;
  assert.ok(protocol);
  const candidate = [];
  candidate[0] = "response-candidate";
  candidate[12] = [];
  candidate[12][7] = [[[
    [null, null, null, [
      null,
      null,
      null,
      "https://lh3.googleusercontent.com/generated=s1024-rj",
    ]],
    ["generated-image-id"],
  ]]];
  const payload = [];
  payload[1] = ["conversation-id", "reply-id"];
  payload[4] = [candidate];
  const stream = JSON.stringify([
    ["wrb.fr", "StreamGenerate", JSON.stringify(payload)],
  ]);
  const images = protocol._test.generatedImages(stream);
  assert.equal(images.length, 1);
  assert.equal(images[0].cid, "conversation-id");
  assert.equal(images[0].rid, "reply-id");
  assert.equal(images[0].rcid, "response-candidate");
  assert.equal(images[0].imageId, "generated-image-id");
  assert.match(images[0].url, /googleusercontent\.com/);
  const fullSizeUrl = "https://lh3.googleusercontent.com/full-size-indirection";
  const fullSizeRpc = `)]}'\n${JSON.stringify([["wrb.fr", "c8o8Fe", JSON.stringify([fullSizeUrl]), null, null, null, "generic"]])}`;
  assert.equal(protocol._test.extractFullSizeRpcUrl(fullSizeRpc), fullSizeUrl);
  assert.equal(
    protocol._test.normalizeUploadedFileIdentifier(
      "/contrib_service/ttl_1d/1709764705i7wdlyx3mdzndme3a767pluckv4flj",
    ),
    "/contrib_service/ttl_1d/1709764705i7wdlyx3mdzndme3a767pluckv4flj",
  );
  assert.equal(
    protocol._test.normalizeUploadedFileIdentifier(
      '"/contrib_service/ttl_1d/quoted-reference-id"',
    ),
    "/contrib_service/ttl_1d/quoted-reference-id",
  );
  assert.equal(
    protocol._test.normalizeUploadedFileIdentifier(
      "https://lh3.googleusercontent.com/uploaded-reference",
    ),
    "https://lh3.googleusercontent.com/uploaded-reference",
  );
  assert.equal(
    protocol._test.normalizeUploadedFileIdentifier("https://example.com/not-gemini"),
    "",
  );
  const expectedQuota = {
    code: "gemini_direct_quota_unavailable",
    accountStatus: "",
    safeToFallbackToUi: true,
    message: "当前 Gemini 直连生图路径额度不可用，正在切换到网页生图路径。",
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      protocol._test.responseFailure('["额度重置后才能生成图片"]'),
    )),
    expectedQuota,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      protocol._test.responseFailure(
        '["\\u989d\\u5ea6\\u9650\\u5236\\u5f71\\u54cd\\u56fe\\u7247\\u751f\\u6210"]',
      ),
    )),
    expectedQuota,
  );
  assert.equal(
    protocol._test.responseFailure('["内容审核未通过，无法生成图片"]')?.code,
    "moderation_blocked",
  );
  assert.match(source, /inner\[45\] = 1/);
  assert.match(source, /const rawError = await response\.text\(\)/);
  assert.match(source, /response\.headers\.get\("x-request-id"\)/);
  assert.match(source, /normalizeUploadedFileIdentifier\(await response\.text\(\)\)/);
  assert.match(source, /const FULL_SIZE_RPC_ID = "c8o8Fe"/);
  assert.match(source, /resolveFullSizeImageUrl\(image, state, fetchImpl\)/);
  assert.match(source, /fullSizeUrl:/);
  assert.match(source, /temporaryVerified: false/);
  assert.match(source, /StreamGenerate/);
  const worker = fs.readFileSync(
    path.join(__dirname, "..", "gemini-embedded-worker.js"),
    "utf8",
  );
  assert.match(worker, /gemini_direct_quota_unavailable/);
  assert.match(worker, /safeAfterDirectSubmission/);
  assert.match(worker, /direct_protocol_fallback/);
  assert.match(worker, /function currentGeminiModelMode\(\)/);
  assert.match(worker, /currentGeminiModelMode\(\) \|\| "fast"/);
  assert.match(worker, /direct_model_fallback/);
  assert.match(worker, /selectedDirectModel = "fast"/);
  assert.match(worker, /resource-download-request/);
  assert.match(worker, /resolveDirectOriginalDownloadUrl\(image\)/);
  assert.match(worker, /=d-I\?alr=yes/);
  assert.match(worker, /info\.pixels > bestInfo\.pixels/);
  assert.match(worker, /Preserve the authenticated Gemini original byte-for-byte/);
  assert.match(worker, /final: source/);
  assert.match(worker, /generated = await generateDirect\(null\)/);
  assert.match(worker, /error\?\.message \|\| ""/);
  assert.match(
    worker,
    /if \(!directFallbackReason\) \{\s*await event\(task, "preparing_temporary_chat"\)/,
  );
  assert.match(
    worker,
    /if \(!directFallbackReason\) \{\s*await event\(task, "uploading_references"\)/,
  );
  assert.match(
    worker,
    /if \(!directFallbackReason\) \{\s*await event\(task, "submitting"\)/,
  );
});

test("preserves the downloaded Gemini original in the cached task result", () => {
  const worker = fs.readFileSync(
    path.join(__dirname, "..", "gemini-embedded-worker.js"),
    "utf8",
  );
  assert.match(worker, /async function transformForRequestedOutput\(blob, request = \{\}\)/);
  assert.doesNotMatch(worker, /safe_zone_center_crop\+high_quality_resample/);
  assert.match(worker, /Preserve the authenticated Gemini original byte-for-byte/);
  assert.match(worker, /blob,\s*source,\s*final: source,\s*transform: "none"/);
  assert.doesNotMatch(worker, /context\.drawImage\(decoded\.source/);
  assert.match(worker, /const processed = await transformForRequestedOutput\(downloadedBlob, request\)/);
  assert.match(worker, /final_size: `\$\{processed\.final\.width\}x\$\{processed\.final\.height\}`/);
  assert.match(worker, /body: blob/);
  assert.match(worker, /companion\/tasks\/\$\{encodeURIComponent\(task\.id\)\}\/heartbeat/);
  assert.match(worker, /phase: "direct_image_ready"/);
  assert.match(worker, /task\.recovery\?\.phase === "direct_image_ready"/);
  assert.match(worker, /temporary_chat_verified: false/);
});

test("embedded hosts reject signed-out and stale-profile readiness events", () => {
  const host = fs.readFileSync(
    path.join(__dirname, "..", "lib", "gemini_embedded_browser.dart"),
    "utf8",
  );
  assert.match(host, /data-test-id="signed-out-disclaimer"/);
  assert.match(host, /a\[href\*="SignOutOptions"\]/);
  assert.match(
    host,
    /message\['status'\] == 'page_ready' &&\s*message\['login_ready'\] == true/,
  );
  assert.match(host, /int _controllerGeneration = 0;/);
  assert.match(host, /config\.nativeBridgeCapability/);
  assert.match(host, /message\['capability'\]\?\.toString\(\) != nativeBridgeCapability/);
  assert.doesNotMatch(
    host,
    /globalThis\.__LANGBAI_GEMINI_NATIVE_REPORT =/,
  );
  assert.match(
    host,
    /generation == _controllerGeneration &&\s*profileId == _activeProfileId &&\s*profileId == widget\.requestController\.profileId/,
  );
});

console.log("\nGemini web adapter tests passed.");
