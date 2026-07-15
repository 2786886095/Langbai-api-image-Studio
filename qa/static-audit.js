"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const hash = relative => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");

const app = read("app.js");
const pubspec = read("pubspec.yaml");
const html = read("index.html");
const sw = read("sw.js");
const runnerRc = read("windows/runner/Runner.rc");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const workflow = read(".github/workflows/build-all-platforms.yml");
const dartMain = read("lib/main.dart");
const proxyConfig = read("lib/proxy_config.dart");
const macWindow = read("macos/Runner/MainFlutterWindow.swift");
const macDebugEntitlements = read("macos/Runner/DebugProfile.entitlements");
const macReleaseEntitlements = read("macos/Runner/Release.entitlements");
const iosDelegate = read("ios/Runner/AppDelegate.swift");

const version = app.match(/const APP_VERSION = "([^"]+)";/)?.[1];
assert.equal(version, "1.3.18", "APP_VERSION must be the release source of truth");
assert.match(pubspec, /^version:\s*1\.3\.18\+42$/m);
assert.match(html, /v1\.3\.18/);
assert.match(html, /20260715-1-3-18/g);
assert.match(sw, /ai-image-generator-1-3-18-20260715/);
assert.match(sw, /ignoreSearch:\s*true/);
assert.match(runnerRc, /VERSION_AS_NUMBER 1,3,18,42/);
assert.match(runnerRc, /VERSION_AS_STRING "1\.3\.18"/);

for (const file of ["app.js", "index.html", "style.css", "sw.js", "manifest.webmanifest"]) {
  assert.equal(
    hash(file),
    hash(`android/app/src/main/assets/${file}`),
    `Android asset copy is stale: ${file}`,
  );
}

assert.doesNotMatch(app, /HTTP\\s\*\(400\|502|400\/502\/503\/504/);
assert.match(app, /return \/HTTP\\s\*400\\b\/i\.test\(msg\)/);
assert.match(app, /expectedSha256/);
assert.match(app, /nativeTimeoutMs:\s*null/);
assert.match(app, /imageUrlToBlobWithFallback/);
assert.doesNotMatch(manifest, /REQUEST_INSTALL_PACKAGES/);
assert.match(pubspec, /flutter_secure_storage:/);
assert.match(pubspec, /socks5_proxy:/);
assert.match(dartMain, /SocksTCPClient\.assignToHttpClient/);
assert.match(dartMain, /isTrustedReleaseAssetUrl/);
assert.match(dartMain, /expectedSha256/);
assert.match(proxyConfig, /DesktopProxyKind\.socks5/);
assert.match(macWindow, /bookmarkData\([\s\S]*\.withSecurityScope/);
assert.match(macWindow, /resolvingBookmarkData:[\s\S]*\.withSecurityScope/);
for (const entitlements of [macDebugEntitlements, macReleaseEntitlements]) {
  assert.match(entitlements, /com\.apple\.security\.files\.downloads\.read-write/);
  assert.match(entitlements, /keychain-access-groups/);
}
assert.match(iosDelegate, /UIDocumentPickerDelegate/);
assert.match(iosDelegate, /bookmarkData/);
assert.match(workflow, /name: Quality gate/);
assert.match(workflow, /refusing to publish a debug-signed release artifact/);

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, "index.html contains duplicate ids");

console.log(`[static-audit] v${version}: versions, caches, assets, retry/timeout rules, secure storage, native proxy/update bridges, and CI gate are consistent.`);
