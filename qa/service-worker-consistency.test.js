"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");

test("release shell assets are installed as one immutable cache generation", () => {
  assert.match(source, /const CACHE_NAME = "ai-image-generator-[^"]+"/);
  assert.match(source, /new Request\(asset, \{ cache: "reload" \}\)/);
  assert.match(source, /CORE_PATHS\.has\(url\.pathname\)/);
  assert.doesNotMatch(source, /cache\.put\(/);
});

test("navigation and core assets use the same installed release cache", () => {
  assert.match(source, /request\.mode === "navigate"/);
  assert.match(source, /cache\.match\("\.\/index\.html"\)/);
  assert.match(source, /cache\.match\(request, \{ ignoreSearch: true \}\)/);
  assert.match(source, /keys\.filter\(key => key !== CACHE_NAME\)/);
});
