"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const hash = relative => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");

const app = read("app.js");
const imageTaskStability = read("image-task-stability.js");
const codexImageGateway = read("codex-image-gateway.js");
const bootstrapGuard = read("bootstrap-guard.js");
const pubspec = read("pubspec.yaml");
const html = read("index.html");
const sw = read("sw.js");
const runnerRc = read("windows/runner/Runner.rc");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const workflow = read(".github/workflows/build-all-platforms.yml");
const dartMain = read("lib/main.dart");
const proxyConfig = read("lib/proxy_config.dart");
const codexGatewayConfig = read("lib/codex_image_gateway_config.dart");
const chatGptAccountStore = read("lib/chatgpt_account_store.dart");
const chatGptMultiAccount = read("lib/chatgpt_multi_account.dart");
const embeddedChatGptGateway = read("lib/embedded_chatgpt_gateway.dart");
const embeddedGatewayLauncher = read("embedded_gateway/launcher.py");
const embeddedGatewayCompat = read("embedded_gateway/vendor/chatgpt2api/api/langbai_compat.py");
const embeddedGatewaySession = read("embedded_gateway/vendor/chatgpt2api/services/browser_session_service.py");
const embeddedGatewaySmoke = read("embedded_gateway/smoke-packaged.ps1");
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
assert.equal(version, "1.5.0", "APP_VERSION must be the release source of truth");
assert.match(pubspec, /^version:\s*1\.5\.0\+72$/m);
assert.match(pubspec, /^\s*- bootstrap-guard\.js$/m);
assert.match(pubspec, /^\s*- image-task-stability\.js$/m);
assert.match(pubspec, /^\s*- codex-image-gateway\.js$/m);
assert.match(imageTaskStability, /moderation_blocked/);
assert.match(imageTaskStability, /createOpenCodexRuntime/);
assert.match(html, /v1\.5\.0/);
assert.match(html, /20260729-1-5-0/g);
assert.match(sw, /ai-image-generator-1-5-0-20260729/);
assert.match(sw, /codex-image-gateway\.js/);
assert.match(sw, /ignoreSearch:\s*true/);
assert.match(runnerRc, /VERSION_AS_NUMBER 1,5,0,72/);
assert.match(runnerRc, /VERSION_AS_STRING "1\.5\.0"/);
assert.match(workflow, /const APP_VERSION = "1\.5\.0";/);
assert.match(workflow, /bootstrap-guard\.js\\\?v=20260729-1-5-0/);
assert.match(workflow, /codex-image-gateway\.js/);
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
assert.match(workflow, /Run hidden Windows WebView2 startup smoke test/);
assert.match(workflow, /Verify Windows hit testing reaches WebView2/);
assert.match(bootstrapGuard, /__AI_GEN_APP_READY/);
assert.match(app, /window\.__AI_GEN_APP_READY = true/);
assert.match(app, /gatewayTaskTerminal = true/);
assert.match(app, /const CODEX_IMAGE_GATEWAY_TASK_WAIT_TIMEOUT_MS = 1200000;/);
assert.match(app, /Date\.now\(\) \+ CODEX_IMAGE_GATEWAY_TASK_WAIT_TIMEOUT_MS/);
assert.match(app, /function restoreSavedConfigurationOnStartup\(\)/);
assert.match(app, /function initializeApplication\(\)/);
assert.ok(
  app.indexOf("const KNOWN_PRICES") < app.indexOf("initializeApplication();"),
  "Saved configuration restoration must run only after KNOWN_PRICES is initialized",
);
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
  "codexGatewayProviderPanel", "codexGatewayQuality", "codexGatewayDimensionMode",
  "codexGatewayAsyncTasks", "codexGatewayClientQueue", "testCodexGatewayHealth", "codexGatewayHealthStatus",
  "openInpaintFromFile", "inpaintModal", "inpaintMaskCanvas", "inpaintBrush", "inpaintEraser",
  "inpaintUndo", "inpaintRedo", "generateInpaint", "applyInpaint",
  "grsaiProviderPanel", "customProviderPanel", "grsaiRetrySettings",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `Missing provider-specific control: ${id}`);
}
assert.match(app, /provider:\s*"official"/);
assert.match(app, /provider:\s*"grsai"/);
assert.match(app, /provider:\s*CODEX_IMAGE_GATEWAY_PROVIDER/);
assert.match(codexImageGateway, /http:\/\/127\.0\.0\.1:18081\/v1/);
assert.match(codexImageGateway, /MAX_REFERENCE_IMAGES\s*=\s*20/);
assert.match(codexImageGateway, /asyncTasks:\s*true/);
assert.match(codexImageGateway, /dimensionMode:\s*"exact_output"/);
assert.match(app, /loadCodexImageGatewayConfig/);
assert.match(app, /image-tasks/);
assert.match(app, /codexGatewayDownloadAsBase64/);
assert.match(app, /function isCodexGatewayProtectedImageUrl/);
assert.match(app, /function sanitizeHistoryOriginalUrl/);
assert.match(app, /History metadata persistence skipped after quota exhaustion/);
assert.match(app, /initialConcurrency:\s*100/);
assert.match(codexImageGateway, /clientQueue:\s*10/);
assert.match(html, /id="codexGatewayClientQueue"[^>]*max="100"[^>]*value="10"/);
assert.match(app, /function codexGatewayProtectedImagePath/);
assert.match(app, /port >= 18080 && port <= 18100/);
assert.match(app, /requestUrl = new URL\(protectedPath,/);
assert.match(app, /Authorization:\s*`Bearer \$\{credentials\.apiKey\}`/);
assert.match(app, /const \{\s*url:\s*protectedUrl,\s*original_url:\s*_legacyUrl,\s*\.\.\.safeItem\s*\}\s*=\s*item/);
assert.doesNotMatch(app, /normalizedData\.push\(\{\s*\.\.\.item,[^}]*original_url:\s*item\.url/);
assert.match(app, /gatewayTaskId/);
assert.match(codexGatewayConfig, /local-api-key\.txt/);
assert.match(codexGatewayConfig, /\^\[a-f0-9\]\{64\}\$/);
for (const id of [
  "chatGptAuthCard", "chatGptAuthStatus", "chatGptAuthIdentity",
  "chatGptLogin", "chatGptRelogin", "chatGptLogout",
  "openChatGptSessionPage", "chatGptSessionInput", "importChatGptSession",
  "chatGptAutoSwitch", "chatGptAccountList",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `Missing ChatGPT account control: ${id}`);
}
assert.match(dartMain, /--chatgpt-auth-window/);
assert.match(dartMain, /--chatgpt-account-id=/);
assert.match(dartMain, /profileDirectory\(widget\.accountId\)\.absolute\.path/);
assert.match(dartMain, /https:\/\/chatgpt\.com\//);
assert.match(dartMain, /ProcessStartMode\.detached/);
assert.match(dartMain, /window\.AiGenChatGptAuth/);
assert.match(chatGptAccountStore, /ChatGPTProfiles/);
assert.match(chatGptAccountStore, /auth-state\.json/);
assert.doesNotMatch(chatGptAccountStore, /access[_-]?token|authorization|cookie|password/i);
assert.match(app, /getChatGptAuthState/);
assert.match(app, /openChatGptLogin/);
assert.match(app, /reloginChatGpt/);
assert.match(app, /logoutChatGpt/);
assert.match(app, /getChatGptAccounts/);
assert.match(app, /importChatGptSession/);
assert.match(app, /activateChatGptAccount/);
assert.match(app, /rotateChatGptAccount/);
assert.match(app, /account_id:\s*account\.local_account_id/);
assert.match(app, /shouldSwitchChatGptAccount/);
assert.match(app, /result\.gatewayTaskTerminal = error\?\.gatewayTaskTerminal === true/);
assert.match(chatGptMultiAccount, /FlutterSecureStorage/);
assert.match(chatGptMultiAccount, /chatGptTokenSecureKeyPrefix/);
assert.match(chatGptMultiAccount, /maskChatGptEmail/);
assert.match(chatGptMultiAccount, /rotateAfterFailure/);
assert.doesNotMatch(chatGptMultiAccount, /localStorage|SharedPreferences/);
assert.match(embeddedChatGptGateway, /18081/);
assert.match(embeddedChatGptGateway, /18100/);
assert.match(embeddedChatGptGateway, /Process\.start/);
assert.match(embeddedGatewayLauncher, /host = "127\.0\.0\.1"/);
assert.match(embeddedGatewayLauncher, /docs_url=None/);
assert.match(embeddedGatewayLauncher, /_install_runtime_streams/);
assert.match(embeddedGatewayCompat, /account_id/);
assert.match(embeddedGatewaySession, /self\._sessions/);
assert.match(embeddedGatewaySmoke, /textStatus -ne 404/);
assert.match(workflow, /smoke-packaged\.ps1/);
assert.match(workflow, /embedded_gateway_process_test\.dart/);
assert.match(app, /repairDuplicateApiConfigIds/);
assert.match(app, /queueSecureStorageOperation/);
assert.match(app, /GENERATED_CACHE_META_STORE\s*=\s*"generated_cache_meta"/);
assert.match(app, /createdAtIndex\.openKeyCursor\(IDBKeyRange\.upperBound\(cutoff, true\)\)/);
assert.match(app, /objectStore\(HISTORY_BLOB_STORE\)\.openKeyCursor\(\)/);
assert.doesNotMatch(app, /generatedStore\.getAllKeys\(\)/);
assert.match(app, /setTimeout\(\(\) => \{\s*void cleanupGeneratedImageCache\(\)/);
assert.match(app, /secureStorageMigrationStarted/);
assert.match(dartMain, /_secureStorageOperationChain/);
assert.doesNotMatch(html, /gemini-3\.1-flash-image/);
assert.match(app, /compositeInpaintPixels/);
assert.match(app, /buildInwardFeatherAlpha/);
for (const size of ["1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160", "2160x3840"]) {
  assert.match(html, new RegExp(`value="${size}"`), `Missing GPT Image 2 popular size: ${size}`);
}
assert.match(html, /option value="codexImageGateway"/);
assert.match(codexImageGateway, /images\s*=\s*refs\.map/);
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

for (const file of ["app.js", "bootstrap-guard.js", "image-task-stability.js", "codex-image-gateway.js", "index.html", "style.css", "sw.js", "manifest.webmanifest"]) {
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
assert.match(dartMain, /final partial = File\('\$\{file\.path\}\.part'\)/);
assert.match(dartMain, /split\(RegExp\(r'\[\/\\\\\]\+'\)\)/);
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
