"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const hash = relative => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");

const app = read("app.js");
const bootstrapGuard = read("bootstrap-guard.js");
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
const vendoredWindowsWebview = read("third_party/webview_win_floating/lib/webview_win_floating.dart");
const vendoredWindowsMethodChannel = read("third_party/webview_win_floating/lib/webview_win_floating_method_channel.dart");
const vendoredWindowsPatches = read("third_party/webview_win_floating/LANGBAI_PATCHES.md");
const vendoredWindowsNativeWebview = read("third_party/webview_win_floating/windows/my_webview.cpp");
const vendoredWindowsPlugin = read("third_party/webview_win_floating/windows/webview_win_floating_plugin.cpp");
const windowsRunner = read("windows/runner/win32_window.cpp");

const version = app.match(/const APP_VERSION = "([^"]+)";/)?.[1];
assert.equal(version, "1.4.0", "APP_VERSION must be the release source of truth");
assert.match(pubspec, /^version:\s*1\.4\.0\+62$/m);
assert.match(html, /v1\.4\.0/);
assert.match(html, /20260726-1-4-0/g);
assert.match(sw, /ai-image-generator-1-4-0-20260726/);
assert.match(sw, /ignoreSearch:\s*true/);
assert.match(runnerRc, /VERSION_AS_NUMBER 1,4,0,62/);
assert.match(runnerRc, /VERSION_AS_STRING "1\.4\.0"/);
assert.match(pubspec, /webview_win_floating:\s*\n\s*path:\s*third_party\/webview_win_floating/);
assert.doesNotMatch(pubspec, /^\s*webview_windows:/m);
assert.match(vendoredWindowsWebview, /class WinWebViewWidget/);
assert.match(vendoredWindowsWebview, /addScriptToExecuteOnDocumentCreated/);
assert.match(vendoredWindowsWebview, /onProcessFailed/);
assert.match(vendoredWindowsMethodChannel, /call\.method == "onProcessFailed"/);
assert.match(vendoredWindowsMethodChannel, /notifyRawWebMessage_/);
assert.match(vendoredWindowsNativeWebview, /CreateCoreWebView2Controller\(/);
assert.match(vendoredWindowsNativeWebview, /add_ProcessFailed/);
assert.match(vendoredWindowsNativeWebview, /completeCreation/);
assert.match(vendoredWindowsNativeWebview, /NotifyParentWindowPositionChanged/);
assert.match(vendoredWindowsNativeWebview, /CallDevToolsProtocolMethod/);
assert.doesNotMatch(vendoredWindowsNativeWebview, /CompositionController|SendMouseInput/);
assert.match(vendoredWindowsPlugin, /registrar->GetView\(\)->GetNativeWindow\(\)/);
assert.match(vendoredWindowsPlugin, /m_pendingWebviewMap/);
assert.match(vendoredWindowsPlugin, /ensureTopLevelHost/);
assert.match(vendoredWindowsPlugin, /WS_CLIPCHILDREN/);
assert.match(vendoredWindowsPlugin, /RegisterTopLevelWindowProcDelegate/);
assert.match(vendoredWindowsPatches, /bbae6b84cc1f3119327701e187eee53283cae567/);
assert.match(dartMain, /WinWebViewController/);
assert.match(dartMain, /WinWebViewWidget/);
assert.match(dartMain, /_recoverWindowsWebView/);
assert.match(dartMain, /runJavaScriptReturningResult\('1'\)/);
assert.match(dartMain, /--windows-webview-self-test/);
assert.match(dartMain, /--windows-webview-input-self-test/);
assert.match(dartMain, /Input\.dispatchMouseEvent/);
assert.match(workflow, /Run hidden Windows WebView2 startup smoke test/);
assert.match(workflow, /Run native Windows WebView2 hit-test and click smoke test/);
assert.match(bootstrapGuard, /__AI_GEN_APP_READY/);
assert.match(app, /window\.__AI_GEN_APP_READY = true/);
assert.match(dartMain, /'flutter_webview_windows',\s*'ai_image_generator',\s*\]\.join/);
assert.match(dartMain, /addScriptToExecuteOnDocumentCreated/);
assert.match(dartMain, /controller\.onWebMessageReceived/);
assert.match(dartMain, /__AI_GEN_WINDOWS_WINDOWED_WEBVIEW = true/);
assert.match(app, /!isNativeWindowsWebview\(\) \|\| window\.__AI_GEN_WINDOWS_WINDOWED_WEBVIEW/);
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
assert.match(app, /objectStore\(HISTORY_BLOB_STORE\)\.openKeyCursor\(\)/);
assert.doesNotMatch(app, /generatedStore\.getAllKeys\(\)/);
assert.match(app, /setTimeout\(runStartupCacheCleanup, 15000\)/);
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

for (const file of ["app.js", "bootstrap-guard.js", "index.html", "style.css", "sw.js", "manifest.webmanifest"]) {
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
