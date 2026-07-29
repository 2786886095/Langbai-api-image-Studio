"use strict";

const assert = require("node:assert/strict");
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

test("builds one resumable temporary-chat task without credentials", () => {
  const task = adapter.buildTaskRequest({
    prompt: "漫画分镜",
    size: "832x1216",
    refs: [{ dataUrl: "data:image/png;base64,AA==", fileName: "ref.png", width: 1, height: 1 }],
    options: { sizeMode: "exact_output", qualityIntent: "detail", clientQueue: 20 },
    clientRequestId: "request-1",
  });
  assert.equal(task.provider, "geminiWeb");
  assert.equal(task.n, 1);
  assert.equal(task.temporary_chat_required, true);
  assert.equal(task.requested_ratio, "2:3");
  assert.equal(task.requested_size.width, 832);
  assert.equal(task.references.length, 1);
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
    audit: { requested_size: "832x1216", downloaded_fullsize: "1696x2528", final_size: "832x1216" },
  });
  assert.equal(audit.accountSuffix, "t-id");
  assert.equal(JSON.stringify(audit).includes("secret"), false);
});

console.log("\nGemini web adapter tests passed.");
