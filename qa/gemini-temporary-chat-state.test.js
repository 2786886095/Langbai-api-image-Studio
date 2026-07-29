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

test("worker captures image baseline only after Temporary Chat verification", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "gemini-embedded-worker.js"),
    "utf8",
  );
  const processStart = source.indexOf("async function processTask(task)");
  const processSource = source.slice(processStart, source.indexOf("\n  async function tick()", processStart));
  const ensureIndex = processSource.indexOf("await ensureTemporaryChat(task)");
  const baselineIndex = processSource.indexOf("const previous = imageSnapshot()");
  const sendIndex = processSource.indexOf("await waitForSubmissionAck");
  assert.ok(ensureIndex >= 0);
  assert.ok(baselineIndex > ensureIndex);
  assert.ok(sendIndex > baselineIndex);
  assert.doesNotMatch(
    source,
    /isTemporaryChatSurfaceActive\(\)\s*\|\|\s*location\.href\s*!==/,
  );
  assert.match(processSource, /history_guard_warning/);
  assert.doesNotMatch(processSource, /throw Object\.assign\(new Error\("临时对话守卫检测到普通历史发生变化"/);
});

console.log("\nGemini Temporary Chat state tests passed.");
