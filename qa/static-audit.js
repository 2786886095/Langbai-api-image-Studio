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
const vendoredWindowsWebview = read("third_party/webview_windows/lib/src/widgets/webview.dart");
const vendoredWindowsController = read("third_party/webview_windows/lib/src/controller.dart");
const vendoredWindowsRenderWebview = read("third_party/webview_windows/lib/src/rendering/render_webview.dart");
const vendoredWindowsPatches = read("third_party/webview_windows/LANGBAI_PATCHES.md");
const vendoredWindowsNativeWebview = read("third_party/webview_windows/windows/webview.cc");
const vendoredWindowsBridge = read("third_party/webview_windows/windows/webview_bridge.cc");
const windowsRunner = read("windows/runner/win32_window.cpp");

const version = app.match(/const APP_VERSION = "([^"]+)";/)?.[1];
assert.equal(version, "1.3.36", "APP_VERSION must be the release source of truth");
assert.match(pubspec, /^version:\s*1\.3\.36\+60$/m);
assert.match(html, /v1\.3\.36/);
assert.match(html, /20260725-1-3-36/g);
assert.match(sw, /ai-image-generator-1-3-36-20260725/);
assert.match(sw, /ignoreSearch:\s*true/);
assert.match(runnerRc, /VERSION_AS_NUMBER 1,3,36,60/);
assert.match(runnerRc, /VERSION_AS_STRING "1\.3\.36"/);
assert.match(pubspec, /webview_windows:\s*\n\s*path:\s*third_party\/webview_windows/);
assert.match(vendoredWindowsWebview, /behavior:\s*HitTestBehavior\.translucent/);
assert.match(vendoredWindowsWebview, /child:\s*RenderWebview/);
assert.match(vendoredWindowsWebview, /size\.width < 2 \|\| size\.height < 2/);
assert.match(vendoredWindowsWebview, /setPointerButtonState\(button, true, ev\.localPosition\)/);
assert.match(vendoredWindowsController, /'x': position\.dx/);
assert.match(vendoredWindowsController, /'y': position\.dy/);
assert.match(vendoredWindowsController, /\[dx, dy, position\.dx, position\.dy\]/);
assert.match(vendoredWindowsBridge, /SetPointerButtonState\([\s\S]*\*xValue, \*yValue\)/);
assert.match(vendoredWindowsBridge, /SetScrollDelta\(\*dx, \*dy, \*x, \*y\)/);
assert.match(vendoredWindowsNativeWebview, /last_cursor_pos_ = point;[\s\S]*MoveFocus/);
assert.match(vendoredWindowsNativeWebview, /GetCursorPos\(&point\)[\s\S]*ScreenToClient\(hwnd_, &point\)/);
assert.match(vendoredWindowsWebview, /scaleChanged && _surfaceSize != null/);
assert.match(vendoredWindowsRenderWebview, /class RenderWebview/);
assert.match(vendoredWindowsPatches, /2ae79f8cda1c3846ea24b9c67d522162cdd8a846/);
assert.match(dartMain, /WebviewHost\.create/);
assert.match(dartMain, /'flutter_webview_windows',\s*'ai_image_generator',\s*\]\.join/);
assert.match(dartMain, /setNewWindowRequestedDelegate/);
assert.match(windowsRunner, /wparam == SIZE_MINIMIZED/);
assert.match(windowsRunner, /LOWORD\(wparam\) != WA_INACTIVE/);
for (const id of [
  "officialProviderPanel", "officialQuality", "officialBackground", "officialOutputFormat",
  "officialOutputCompression", "officialModeration", "officialInputFidelity",
  "officialCostSummary", "officialEstimatedCost", "officialRateStatus", "officialPricingLink", "refreshOfficialRate",
  "openCodexProviderPanel", "openCodexModel", "openCodexQuality", "openCodexBackground",
  "openCodexAspectRatio", "openCodexImageSize", "testOpenCodexHealth", "openCodexHealthStatus",
  "openInpaintFromFile", "inpaintModal", "inpaintMaskCanvas", "inpaintBrush", "inpaintEraser",
  "inpaintUndo", "inpaintRedo", "generateInpaint", "applyInpaint",
  "grsaiProviderPanel", "customProviderPanel", "grsaiRetrySettings",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `Missing provider-specific control: ${id}`);
}
assert.match(app, /provider:\s*"official"/);
assert.match(app, /provider:\s*"grsai"/);
assert.match(app, /provider:\s*"opencodex"/);
assert.match(app, /OPENCODEX_API_ENDPOINT\s*=\s*"http:\/\/127\.0\.0\.1:10100\/v1\/images\/generations"/);
assert.match(app, /OPENCODEX_REQUEST_TIMEOUT_MS\s*=\s*620000/);
assert.match(app, /OPENCODEX_GPT_PRIVATE_QUALITY\s*=\s*"medium"/);
assert.match(app, /OPENCODEX_GPT_PRIVATE_MAX_PIXELS_OBSERVED\s*=\s*1573770/);
assert.match(app, /OPENCODEX_GPT_PRIVATE_MAX_EDGE_OBSERVED\s*=\s*2172/);
assert.match(app, /addOpenCodexGptAspectInstruction/);
assert.match(app, /repairDuplicateApiConfigIds/);
assert.match(app, /queueSecureStorageOperation/);
assert.match(app, /GENERATED_CACHE_META_STORE\s*=\s*"generated_cache_meta"/);
assert.match(app, /createdAtIndex\.openKeyCursor\(IDBKeyRange\.upperBound\(cutoff, true\)\)/);
assert.match(app, /requestIdleCallback\(runStartupCacheCleanup/);
assert.match(app, /secureStorageMigrationStarted/);
assert.match(dartMain, /_secureStorageOperationChain/);
assert.match(app, /gemini-3\.1-flash-image/);
assert.match(app, /OPENCODEX_NANO_ASPECT_RATIOS/);
assert.match(app, /compositeInpaintPixels/);
assert.match(app, /buildInwardFeatherAlpha/);
for (const size of ["1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160", "2160x3840"]) {
  assert.match(html, new RegExp(`value="${size}"`), `Missing GPT Image 2 popular size: ${size}`);
}
assert.match(html, /option value="opencodex"/);
assert.match(app, /body\.images\s*=\s*refs\.map\(ref => \(\{\s*image_url:\s*ref\.dataUrl\s*\}\)\)/);
assert.match(app, /forceDirectProxy:\s*true/);
assert.ok(app.includes("gpt-image-2|gpt-image-1\\.5|gpt-image-1-mini"), "Official model aliases/snapshots must be matched explicitly");
assert.match(app, /output_compression/);
assert.match(app, /input_fidelity/);
assert.match(app, /api\.frankfurter\.dev\/v2\/rate\/USD\/CNY\?providers=ECB/);
assert.match(app, /GPT_IMAGE_2_TOKEN_USD_PER_MILLION/);
assert.match(app, /buildOfficialBilling/);
assert.match(app, /enqueueFailedCardsForRetryRun/);
assert.match(app, /seenCards:\s*new Set\(\)/);
assert.match(html, /id="grsaiSubmit504RetryCount"/);
assert.match(html, /id="grsaiSubmit504RetryInterval"/);
assert.match(app, /getGrsaiSubmit504RetryPolicy/);
assert.match(app, /onSubmit504Retry/);

for (const file of ["app.js", "index.html", "style.css", "sw.js", "manifest.webmanifest"]) {
  assert.equal(
    hash(file),
    hash(`android/app/src/main/assets/${file}`),
    `Android asset copy is stale: ${file}`,
  );
}

assert.doesNotMatch(app, /HTTP\\s\*\(400\|502|400\/502\/503\/504/);
assert.match(app, /return \/HTTP\\s\*400\\b\/i\.test\(msg\)/);
assert.match(app, /pollResp\.status === 504/);
assert.match(app, /responseType:\s*"chunkedBase64"/);
assert.match(dartMain, /nativeFetchBlobChunk/);
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
