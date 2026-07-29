"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const stability = require("../image-task-stability.js");

test("moderation errors keep safety category and request id instead of becoming parameter errors", () => {
  const detail = stability.classifyApiError(
    "HTTP 400: [moderation_blocked] rejected by the safety system; request ID 830ccca8-cd98-4812-a1b8-5260b3bca40d; safety_violations=[sexual]",
  );
  assert.equal(detail.category, "moderation_blocked");
  assert.equal(detail.requiresEdit, true);
  assert.equal(detail.retryPolicy, "edit_required");
  assert.equal(detail.requestId, "830ccca8-cd98-4812-a1b8-5260b3bca40d");
  assert.deepEqual(detail.safetyViolations, ["sexual"]);
});

test("HTTP error families remain distinct", () => {
  assert.equal(stability.classifyApiError("HTTP 400: unsupported size").category, "invalid_parameters");
  const dimensionMismatch = stability.classifyApiError({
    status: 422,
    code: "image_dimension_mismatch",
    message: "The returned image dimensions do not match exact_output.",
  });
  assert.equal(dimensionMismatch.category, "invalid_parameters");
  assert.equal(dimensionMismatch.retryPolicy, "edit_required");
  assert.equal(stability.classifyApiError("HTTP 401: invalid_api_key").category, "authentication_failed");
  assert.equal(stability.classifyApiError("HTTP 413: payload too large").category, "payload_too_large");
  assert.equal(stability.classifyApiError("HTTP 429: too many requests").category, "rate_limited");
  assert.equal(stability.classifyApiError("HTTP 502: socket closed").category, "upstream_disconnected");
  assert.equal(stability.classifyApiError("HTTP 503: service unavailable").category, "upstream_unavailable");
});

test("Gemini account readiness is not mislabeled as quota exhaustion", () => {
  const detail = stability.classifyApiError({
    status: 409,
    code: "gemini_account_not_ready",
    message: "The selected Gemini browser profile is not ready.",
  });
  assert.equal(detail.category, "account_unavailable");
  assert.equal(detail.retryPolicy, "after_configuration_change");
  assert.equal(detail.pausesQueue, true);
});

test("Gemini page capability failures are not mislabeled as ChatGPT disconnects", () => {
  for (const code of [
    "selector_pack_outdated",
    "gemini_temporary_chat_unavailable",
    "temporary_chat_unverified",
    "temporary_chat_guard_failed",
  ]) {
    const detail = stability.classifyApiError({
      status: 502,
      code,
      message: "Gemini Temporary Chat is unavailable.",
    });
    assert.equal(detail.category, "provider_ui_unavailable");
    assert.equal(detail.retryPolicy, "after_probe");
    assert.equal(detail.pausesQueue, true);
  }
});

test("actual dimensions are authoritative", () => {
  assert.equal(stability.evaluateDimensions("1024x1536", 1024, 1536).status, "exact");
  assert.equal(stability.evaluateDimensions("1024x1536", 864, 1821).status, "mismatch");
  assert.equal(stability.evaluateDimensions("auto", 1024, 1024).status, "unknown");
});

test("OpenCodex runtime starts at two, drops to one, opens a circuit, and blocks a failed reference route", () => {
  const runtime = stability.createOpenCodexRuntime({ initialConcurrency: 2, circuitFailureThreshold: 3, circuitMs: 60_000 });
  const failure = stability.classifyApiError("HTTP 502: socket closed");
  runtime.recordFailure(failure, { hasReference: true, message: "socket closed", now: 1000 });
  assert.equal(runtime.snapshot().concurrency, 2);
  assert.equal(runtime.beforeRequest({ hasReference: true, now: 1001 }).reason, "reference_route_unavailable");
  runtime.recordFailure(failure, { now: 1002 });
  assert.equal(runtime.snapshot().concurrency, 1);
  runtime.recordFailure(failure, { now: 1003 });
  assert.equal(runtime.beforeRequest({ now: 1004 }).reason, "circuit_open");
  runtime.resetAfterHealthCheck({ resetReference: true });
  assert.equal(runtime.snapshot().concurrency, 2);
  assert.equal(runtime.beforeRequest({ hasReference: true }).allowed, true);
});

test("request audit hashes normalized prompts and reference bytes without retaining their contents", async () => {
  const reference = { dataUrl: "data:image/png;base64,aGVsbG8=" };
  const audit = await stability.buildRequestAudit({
    provider: "opencodex",
    model: "gpt-image-2",
    prompt: " hello \r\n world ",
    size: "1024x1536",
    quality: "medium",
    references: [reference],
  });
  assert.match(audit.promptSha256, /^[a-f0-9]{64}$/);
  assert.match(audit.requestFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(audit.referenceSha256.length, 1);
  assert.equal(JSON.stringify(audit).includes("aGVsbG8"), false);
});

test("SHA-256 fallback remains available in non-secure packaged WebViews", () => {
  const bytes = new TextEncoder().encode("abc");
  assert.equal(stability.sha256Fallback(bytes), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
