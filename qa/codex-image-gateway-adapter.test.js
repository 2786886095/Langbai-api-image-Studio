"use strict";

const assert = require("assert");
const gateway = require("../codex-image-gateway.js");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("uses the dedicated provider and local endpoint", () => {
  assert.equal(gateway.PROVIDER_ID, "codexImageGateway");
  assert.equal(gateway.BASE_URL, "http://127.0.0.1:18081/v1");
  assert.equal(gateway.MODEL, "gpt-image-2");
});

test("accepts only a 64-character lowercase hexadecimal local key", () => {
  assert.equal(gateway.validateLocalKey("a".repeat(64)), true);
  assert.equal(gateway.validateLocalKey("A".repeat(64)), false);
  assert.equal(gateway.validateLocalKey("a".repeat(63)), false);
});

test("requires the gateway image-only, async, reference, model and exact-output capabilities", () => {
  const valid = gateway.validateCapabilities({
    image_only: true,
    generations: true,
    edits: true,
    async_tasks: true,
    models: ["gpt-image-2"],
    max_reference_images: 20,
    max_concurrency: 100,
    dimension_modes: ["native", "exact_output"],
  });
  assert.equal(valid.ok, true);
  const invalid = gateway.validateCapabilities({ image_only: false });
  assert.equal(invalid.ok, false);
  assert(invalid.missing.includes("image_only"));
  assert(invalid.missing.includes("max_reference_images>=20"));
});

test("builds exact-output generation and edit requests without leaking unsupported fields", () => {
  const generation = gateway.buildImageRequest({
    prompt: "scene",
    size: "832x1216",
  });
  assert.equal(generation.route, "images/generations");
  assert.deepEqual(generation.body, {
    model: "gpt-image-2",
    prompt: "scene",
    size: "832x1216",
    quality: "medium",
    n: 1,
    response_format: "b64_json",
    output_format: "png",
    dimension_mode: "exact_output",
  });
  const edit = gateway.buildImageRequest({
    prompt: "edit",
    size: "1024x1024",
    refs: [{ dataUrl: "data:image/png;base64,AA==" }],
    options: { quality: "high", dimensionMode: "native" },
  });
  assert.equal(edit.route, "images/edits");
  assert.equal(edit.body.images.length, 1);
  assert.equal(edit.body.quality, "high");
  assert.equal(edit.body.dimension_mode, "native");
});

test("accepts twenty direct local references without client-side aggregation", () => {
  const refs = Array.from({ length: 20 }, () => ({
    dataUrl: "data:image/jpeg;base64,AA==",
  }));
  const request = gateway.buildImageRequest({
    prompt: "characters",
    size: "1024x1536",
    refs,
  });
  assert.equal(request.referenceCount, 20);
  assert.equal(request.referenceBoardsExpected, false);
  assert.throws(() => gateway.buildImageRequest({
    prompt: "too many",
    size: "1024x1024",
    refs: refs.concat(refs[0]),
  }), /at most 20 references/);
});

test("normalizes async task states and preserves task ids for resume", () => {
  assert.deepEqual(gateway.normalizeTask({ id: "imgjob_1", status: "running" }), {
    id: "imgjob_1",
    status: "running",
    terminal: false,
    succeeded: false,
    failed: false,
    cancelled: false,
    result: null,
    error: null,
  });
  const done = gateway.normalizeTask({
    id: "imgjob_1",
    status: "succeeded",
    result: { data: [{ url: "http://127.0.0.1:18081/v1/image-tasks/imgjob_1/files/0" }] },
  });
  assert.equal(done.succeeded, true);
  assert.equal(done.result.data[0].url.includes("imgjob_1"), true);
});

test("extracts dimension and reference-board audit fields without credentials or image bytes", () => {
  const result = {
    langbai: {
      reference_images_received: 20,
      reference_images_forwarded: 5,
      reference_boards_compiled: true,
      dimensions: [{
        requested_size: "832x1216",
        native_size: "1024x1536",
        final_size: "832x1216",
        dimension_action: "smart_cover_crop",
      }],
    },
  };
  const audit = gateway.buildSafeGatewayAudit(result, { id: "imgjob_1" });
  assert.equal(audit.taskId, "imgjob_1");
  assert.equal(audit.referenceImagesReceived, 20);
  assert.equal(audit.referenceImagesForwarded, 5);
  assert.equal(audit.referenceBoardsCompiled, true);
  assert.deepEqual(audit.dimensions, {
    requestedSize: "832x1216",
    nativeSize: "1024x1536",
    finalSize: "832x1216",
    action: "smart_cover_crop",
  });
  assert.equal(JSON.stringify(audit).includes("base64"), false);
  assert.equal(JSON.stringify(audit).includes("apiKey"), false);
});

console.log("\nCodex image gateway adapter tests passed.");
