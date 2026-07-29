"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const state = require("../gemini-embedded-worker.js");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("SPA URL changes never prove Temporary Chat activation", () => {
  const evidence = state.activationEvidence({
    urlChanged: true,
    controlActive: false,
    exitControlVisible: false,
    activeExplanationVisible: false,
  });
  assert.equal(evidence.active, false);
  assert.deepEqual(evidence.reasons, []);

  const decision = state.preparationAction({
    url: "https://gemini.google.com/app/ordinary-chat-id",
    urlChanged: true,
    controlVisible: false,
    controlActive: false,
    exitControlVisible: false,
    activeExplanationVisible: false,
  });
  assert.equal(decision.action, "navigate_home");
});

test("an ordinary conversation without the entry safely returns home", () => {
  const decision = state.preparationAction({
    url: "https://gemini.google.com/app/regular-history-thread?hl=zh-CN",
    controlVisible: false,
  });
  assert.equal(decision.action, "navigate_home");
  assert.equal(decision.homeUrl, "https://gemini.google.com/app");
});

test("explicit active, exit, and explanation evidence verify Temporary Chat", () => {
  for (const snapshot of [
    { controlActive: true },
    { exitControlVisible: true },
    { activeExplanationVisible: true },
  ]) {
    assert.equal(state.activationEvidence(snapshot).active, true);
    assert.equal(state.preparationAction(snapshot).action, "verified");
  }
});

test("a trusted click on the exact Temporary Chat control is bounded evidence", () => {
  const accepted = state.trustedActivationEvidence({
    exactControl: true,
    trustedClick: true,
    loginReady: true,
    overlayVisible: false,
    url: "https://gemini.google.com/app",
  });
  assert.equal(accepted.active, true);
  for (const invalid of [
    { exactControl: false },
    { trustedClick: false },
    { loginReady: false },
    { overlayVisible: true },
    { url: "https://gemini.google.com/app/ordinary-chat-id" },
  ]) {
    assert.equal(state.trustedActivationEvidence({
      exactControl: true,
      trustedClick: true,
      loginReady: true,
      overlayVisible: false,
      url: "https://gemini.google.com/app",
      ...invalid,
    }).active, false);
  }
});

test("history sidebar reordering is not treated as a new ordinary chat", () => {
  const before = state.normalizeHistorySnapshot([
    { href: "/app/thread-a", active: false },
    { href: "/app/thread-b", active: false },
  ], "https://gemini.google.com/app");
  const after = state.normalizeHistorySnapshot([
    { href: "/app/thread-b", active: false },
    { href: "/app/thread-a", active: false },
  ], "https://gemini.google.com/app");
  assert.deepEqual(after.keys, before.keys);
  assert.equal(state.assessHistoryMutation(before, after).status, "passed");
});

test("only the newly active ordinary conversation produces a history warning", () => {
  const before = state.normalizeHistorySnapshot([
    { href: "/app/thread-a", active: false },
  ], "https://gemini.google.com/app");
  const after = state.normalizeHistorySnapshot([
    { href: "/app/thread-a", active: false },
    { href: "/app/new-normal-thread", active: true },
  ], "https://gemini.google.com/app/new-normal-thread");
  const assessment = state.assessHistoryMutation(before, after);
  assert.equal(assessment.status, "ordinary_conversation_added");
  assert.match(assessment.warning, /图片已生成并保存/);
});

test("an old image present after activation navigation is never this task's result", () => {
  assert.equal(state.isGeneratedImageCandidate({
    submissionAcknowledged: true,
    wasPresentBefore: true,
    resourceSignatureChanged: false,
    hasResponseContainer: true,
    responseContainerWasPresentBefore: true,
    responseChanged: false,
  }), false);

  assert.equal(state.isGeneratedImageCandidate({
    submissionAcknowledged: false,
    wasPresentBefore: false,
    resourceSignatureChanged: true,
    hasResponseContainer: true,
    responseContainerWasPresentBefore: false,
    responseChanged: true,
  }), false);

  assert.equal(state.isGeneratedImageCandidate({
    submissionAcknowledged: true,
    wasPresentBefore: false,
    resourceSignatureChanged: true,
    hasResponseContainer: true,
    responseContainerWasPresentBefore: false,
    responseChanged: true,
  }), true);
});

test("a signed-out Gemini composer never counts as a logged-in account", () => {
  const signedOut = state.loginReadiness({
    composerPresent: true,
    signedOutMarkerPresent: true,
    authenticatedMarkerPresent: false,
  });
  assert.equal(signedOut.ready, false);
  assert.equal(signedOut.reason, "signed_out");

  const anonymousComposer = state.loginReadiness({
    composerPresent: true,
    signedOutMarkerPresent: false,
    authenticatedMarkerPresent: false,
  });
  assert.equal(anonymousComposer.ready, false);
  assert.equal(anonymousComposer.reason, "authenticated_marker_missing");

  const authenticated = state.loginReadiness({
    composerPresent: true,
    signedOutMarkerPresent: false,
    authenticatedMarkerPresent: true,
  });
  assert.equal(authenticated.ready, true);
  assert.equal(authenticated.reason, "authenticated");
});

test("resumed claims never resubmit an uncertain prompt", () => {
  assert.equal(state.taskResumeAction({
    resumedClaim: true,
    status: "uploading_references",
  }), "restart_before_submission");
  for (const status of ["submitting", "generating", "locating_full_size"]) {
    assert.equal(state.taskResumeAction({
      resumedClaim: true,
      status,
    }), "fail_unknown_submission");
  }
  assert.equal(state.taskResumeAction({
    resumedClaim: false,
    status: "generating",
  }), "start");
});

test("worker captures image baseline only after Temporary Chat verification", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "gemini-embedded-worker.js"),
    "utf8",
  );
  const processStart = source.indexOf("async function processTask(task)");
  const processSource = source.slice(processStart, source.indexOf("\n  async function tick()", processStart));
  const ensureIndex = processSource.indexOf("await ensureTemporaryChat(task)");
  const baselineIndex = processSource.indexOf("const previous = imageSnapshot()");
  const sendIndex = processSource.indexOf("await submitPromptAndWait");
  assert.ok(ensureIndex >= 0);
  assert.ok(baselineIndex > ensureIndex);
  assert.ok(sendIndex > baselineIndex);
  assert.doesNotMatch(
    source,
    /isTemporaryChatSurfaceActive\(\)\s*\|\|\s*location\.href\s*!==/,
  );
  assert.match(processSource, /history_guard_warning/);
  assert.doesNotMatch(processSource, /throw Object\.assign\(new Error\("临时对话守卫检测到普通历史发生变化"/);
  assert.match(source, /if \(!identity\.claimRecoveryReady\) return;/);
  assert.match(source, /found\.querySelector\("button,\[role=button\],a"\)/);
  assert.match(processSource, /const login = await waitForGeminiLoginReady\(\)/);
  assert.match(processSource, /if \(!login\.ready\)/);
  assert.match(processSource, /gemini_submission_state_unknown/);
  assert.match(
    processSource,
    /submitPromptAndWait\(\{\s*composer,\s*send,\s*baseline: submissionBaseline,\s*prompt,/,
  );
});

console.log("\nGemini Temporary Chat state tests passed.");
