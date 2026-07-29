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
const geminiSizeRegistry = read("gemini-image-size-registry.js");
const geminiWebAdapter = read("gemini-web-image-adapter.js");
const geminiSelectorPack = read("gemini-selector-pack.js");
const geminiEmbeddedWorker = read("gemini-embedded-worker.js");
const bootstrapGuard = read("bootstrap-guard.js");
const pubspec = read("pubspec.yaml");
const html = read("index.html");
const sw = read("sw.js");
const readme = read("README.md");
const handoff = read("CODEX_HANDOFF.md");
const runnerRc = read("windows/runner/Runner.rc");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const workflow = read(".github/workflows/build-all-platforms.yml");
const dartMain = read("lib/main.dart");
const proxyConfig = read("lib/proxy_config.dart");
const codexGatewayConfig = read("lib/codex_image_gateway_config.dart");
const chatGptAccountStore = read("lib/chatgpt_account_store.dart");
const chatGptMultiAccount = read("lib/chatgpt_multi_account.dart");
const embeddedChatGptGateway = read("lib/embedded_chatgpt_gateway.dart");
const androidChatGptGateway = read("lib/android_chatgpt_gateway.dart");
const geminiAccountStore = read("lib/gemini_account_store.dart");
const geminiWebGateway = read("lib/gemini_web_gateway.dart");
const geminiEmbeddedBrowser = read("lib/gemini_embedded_browser.dart");
const secureStorageQueue = read("lib/secure_storage_queue.dart");
const androidBuild = read("android/app/build.gradle");
const androidSettings = read("android/settings.gradle");
const androidMainActivity = read("android/app/src/main/kotlin/com/aigen/ai_image_generator/MainActivity.kt");
const androidGatewayPython = read("android/app/src/main/python/android_chatgpt_gateway.py");
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
const windowsInstaller = read("windows/installer/setup.iss");

const expectedVersion = "1.6.8";
const expectedBuild = 85;
const expectedCacheToken = "20260730-1-6-8";
const expectedSwCache = "ai-image-generator-1-6-8-20260730";
const version = app.match(/const APP_VERSION = "([^"]+)";/)?.[1];
assert.equal(version, expectedVersion, "APP_VERSION must be the release source of truth");
assert.match(pubspec, new RegExp(`^version:\\s*${expectedVersion.replaceAll(".", "\\.")}\\+${expectedBuild}$`, "m"));
assert.match(pubspec, /^\s*- bootstrap-guard\.js$/m);
assert.match(pubspec, /^\s*- image-task-stability\.js$/m);
assert.match(pubspec, /^\s*- codex-image-gateway\.js$/m);
assert.match(pubspec, /^\s*- gemini-image-size-registry\.js$/m);
assert.match(pubspec, /^\s*- gemini-web-image-adapter\.js$/m);
assert.match(pubspec, /^\s*- gemini-selector-pack\.js$/m);
assert.match(pubspec, /^\s*- gemini-embedded-worker\.js$/m);
assert.doesNotMatch(pubspec, /gemini_companion/);
assert.match(imageTaskStability, /moderation_blocked/);
assert.match(imageTaskStability, /createOpenCodexRuntime/);
assert.match(html, /v1\.6\.8/);
assert.match(html, /20260730-1-6-8/g);
assert.match(sw, /ai-image-generator-1-6-8-20260730/);
const localCacheTokens = [
  ...html.matchAll(/(?:href|src)="(?:\.\/)?(?:style\.css|[a-z0-9-]+\.js)\?v=([^"]+)"/gi),
].map(match => match[1]);
assert.ok(localCacheTokens.length > 0, "index.html must reference versioned local assets");
assert.deepEqual(
  [...new Set(localCacheTokens)],
  [expectedCacheToken],
  "Every local CSS/JS asset must use the current release cache token",
);
assert.match(sw, new RegExp(expectedSwCache.replaceAll("-", "\\-")));
assert.match(sw, /codex-image-gateway\.js/);
assert.match(sw, /gemini-web-image-adapter\.js/);
assert.match(sw, /ignoreSearch:\s*true/);
assert.match(runnerRc, /VERSION_AS_NUMBER 1,6,8,85/);
assert.match(runnerRc, /VERSION_AS_STRING "1\.6\.8"/);
assert.match(workflow, /const APP_VERSION = "1\.6\.8";/);
assert.match(workflow, /bootstrap-guard\.js\\\?v=20260730-1-6-8/);
assert.match(workflow, /codex-image-gateway\.js/);
assert.doesNotMatch(workflow, /Gemini-Chromium-Companion|gemini_companion/);
assert.match(workflow, /gemini-embedded-worker\.js/);
assert.match(workflow, /node qa\/gemini-web-adapter\.test\.js/);
assert.match(embeddedGatewayLauncher, /version="1\.6\.8"/);
assert.match(readme, /^## v1\.6\.8[：:]/m);
assert.match(handoff, /^# .*v1\.6\.8$/m);
assert.match(handoff, /源码版本 `1\.6\.8\+85`/);
assert.match(windowsInstaller, /AppVersion=\{#MyAppVersion\}/);
assert.match(app, /function isNativeChatGptGatewayWebview\(\)/);
assert.match(app, /\["windows", "android"\]\.includes\(getRuntimePlatform\(\)\)/);
assert.match(app, /session_available === false/);
assert.match(dartMain, /AndroidChatGptGatewayManager/);
assert.match(dartMain, /Platform\.isAndroid/);
assert.match(androidChatGptGateway, /HttpServer\.bind/);
assert.match(androidChatGptGateway, /\/v1\/image-tasks/);
assert.match(androidChatGptGateway, /default_concurrency': 1/);
assert.match(androidSettings, /com\.chaquo\.python" version "17\.0\.0"/);
assert.match(androidBuild, /version = "3\.13"/);
assert.match(androidBuild, /Pillow==11\.0\.0/);
assert.match(androidMainActivity, /getModule\("android_chatgpt_gateway"\)/);
assert.match(androidGatewayPython, /chat-requirements/);
assert.match(androidGatewayPython, /interactive_verification_required/);
assert.match(androidGatewayPython, /ImageOps\.fit/);
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
assert.match(dartMain, /windowsAppHealthProbeScript/);
assert.match(dartMain, /_probeWindowsAppHealth/);
assert.match(dartMain, /health\.healthy/);
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
const initializeApplicationCall = app.search(/\b(?:void\s+)?initializeApplication\(\)(?:\.catch|\s*;)/);
assert.ok(
  initializeApplicationCall >= 0,
  "Application startup must invoke initializeApplication()",
);
assert.ok(
  app.indexOf("const KNOWN_PRICES") < initializeApplicationCall,
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
  "geminiProviderPanel", "openGeminiLogin", "geminiAutoSwitch",
  "testGeminiHealth", "geminiAccountList", "geminiModelPreference",
  "geminiQualityIntent", "geminiClientQueue",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `Missing provider-specific control: ${id}`);
}
assert.match(app, /provider:\s*"official"/);
assert.match(app, /provider:\s*"grsai"/);
assert.match(app, /provider:\s*CODEX_IMAGE_GATEWAY_PROVIDER/);
assert.match(app, /provider:\s*GEMINI_WEB_PROVIDER/);
assert.match(geminiSizeRegistry, /safe_zone_center_crop/);
assert.match(geminiSizeRegistry, /high_quality_resample/);
assert.match(geminiWebAdapter, /temporary_chat_required:\s*true/);
assert.match(geminiWebAdapter, /client_request_id/);
assert.match(geminiSelectorPack, /temporaryChat/);
assert.match(geminiSelectorPack, /data-test-id="temp-chat-button"/);
assert.match(geminiSelectorPack, /临时聊天/);
assert.match(geminiEmbeddedWorker, /__LANGBAI_GEMINI_EMBEDDED_CONFIG/);
assert.match(geminiEmbeddedWorker, /globalThis\.top !== globalThis/);
assert.match(geminiEmbeddedWorker, /TEMPORARY_CHAT_CHECKPOINT_KEY/);
assert.match(geminiEmbeddedWorker, /ensureTemporaryChat\(task\)/);
assert.match(geminiEmbeddedWorker, /findTemporaryChatControl/);
assert.match(geminiEmbeddedWorker, /activationEvidence/);
assert.match(geminiEmbeddedWorker, /exitControlVisible/);
assert.match(geminiEmbeddedWorker, /activeExplanationVisible/);
assert.doesNotMatch(
  geminiEmbeddedWorker,
  /if\s*\(\s*location\.href\s*!==\s*beforeUrl\s*\)\s*(?:return|break)/,
  "A Gemini URL change must never prove Temporary Chat activation",
);
assert.doesNotMatch(app, /GEMINI_WEB_TASK_WAIT_TIMEOUT_MS/);
const geminiAvailableGetter =
  geminiAccountStore.match(/bool get available =>[\s\S]*?;/)?.[0] || "";
for (const requiredCondition of [
  /loginReady/,
  /status == 'ready'/,
  /quotaState != 'exhausted'/,
  /!coolingDown/,
  /temporaryChatAvailable/,
  /fullsizeDownloadAvailable/,
]) {
  assert.match(
    geminiAvailableGetter,
    requiredCondition,
    "Gemini account availability must retain every persisted readiness condition",
  );
}
assert.match(geminiWebGateway, /Future<\(int, String, String\)> _submissionAccountError\(\)/);
for (const accountErrorCode of [
  /'gemini_account_required'/,
  /'gemini_rate_limited'/,
  /'gemini_login_required'/,
  /'gemini_account_not_ready'/,
]) {
  assert.match(geminiWebGateway, accountErrorCode);
}
assert.match(geminiWebGateway, /'accounts':\s*await accountsSnapshot\(\)/);
assert.match(geminiWebGateway, /Future<void> _taskSubmissionChain = Future<void>\.value\(\)/);
assert.ok(
  geminiWebGateway.indexOf("final duplicate = _tasks.values")
    < geminiWebGateway.indexOf("final submissionAccount = await _submissionAccount();"),
  "Gemini idempotency lookup must run before mutable account readiness checks",
);
assert.match(
  geminiWebGateway,
  /temporaryChatAvailable:\s*[\s\S]*selectorPackCompatible\s*&&\s*body\['temporary_chat_available'\]\s*==\s*true/,
  "Current page capability must be authoritative; stale success must not create a false-ready account",
);
assert.match(app, /requireReadyAccount:\s*true/);
assert.match(app, /function geminiUnavailableReason\(\)/);
assert.match(app, /if \(!accountsResponse\.ok\) throw new Error/);
assert.match(app, /payload\?\.accounts[\s\S]*renderGeminiAccounts\(payload\.accounts\)[\s\S]*geminiHealthCheckedAt = 0/);
assert.match(app, /function geminiAccountSnapshotFingerprint\(/);
assert.match(app, /if \(previousFingerprint === nextFingerprint\) return;/);
assert.match(app, /background:\s*geminiHealthState === "ready"/);
assert.match(app, /gemini_account_required", "gemini_account_not_ready", "gemini_login_required"/);
assert.match(
  app,
  /if \(geminiHealthPromise\) \{[\s\S]*!requireReadyAccount \|\| geminiReadyAccounts\(\)\.length > 0/,
  "A stricter generation preflight must re-check account readiness when sharing an in-flight health request",
);
assert.match(imageTaskStability, /gemini_account_\(required\|not_ready\)/);
for (const removedId of [
  "geminiSizeMode", "geminiRatio", "geminiCropMode",
]) {
  assert.doesNotMatch(
    html,
    new RegExp(`id="${removedId}"`),
    `Gemini must use the app-wide resolution instead of duplicate control ${removedId}`,
  );
}
assert.match(geminiEmbeddedWorker, /__LANGBAI_GEMINI_NATIVE_REQUEST/);
assert.match(geminiEmbeddedWorker, /bodyBase64/);
assert.match(geminiEmbeddedBrowser, /GeminiMobileEmbeddedBrowser/);
assert.match(geminiEmbeddedBrowser, /GeminiWindowsEmbeddedBrowser/);
assert.match(geminiEmbeddedBrowser, /gemini-embedded-worker\.js/);
assert.match(geminiEmbeddedBrowser, /gemini_sessions/);
assert.match(geminiEmbeddedBrowser, /deleteGeminiEmbeddedProfileData/);
assert.match(geminiEmbeddedBrowser, /registerLoggedInProfile/);
assert.match(geminiEmbeddedBrowser, /status'] == 'page_ready'/);
assert.match(
  geminiEmbeddedBrowser,
  /useTopLevelWindowHost:\s*false/,
  "Gemini login WebView must preserve the visible Flutter close toolbar.",
);
assert.match(androidMainActivity, /gemini_sessions/);
assert.doesNotMatch(androidMainActivity, /removeAllCookies/);
assert.match(iosDelegate, /gemini_sessions/);
assert.match(macWindow, /gemini_sessions/);
assert.doesNotMatch(geminiWebGateway, /https?:\/\/(?!127\.0\.0\.1|localhost)/);
assert.match(geminiWebGateway, /HttpServer\.bind/);
assert.match(geminiWebGateway, /_geminiActiveAccountStorage/);
assert.match(geminiWebGateway, /\/v1\/companion\/tasks\/next/);
assert.match(geminiWebGateway, /invalid_pairing_key/);
assert.match(geminiWebGateway, /_persistenceChain/);
assert.match(geminiWebGateway, /_companionLeaseDuration/);
assert.match(geminiWebGateway, /stale_or_wrong_task_claim/);
assert.match(geminiWebGateway, /invalid_status_transition/);
assert.match(geminiWebGateway, /image-tasks\/\(\[\^\/\]\+\)\/cancel/);
assert.match(geminiWebGateway, /task\.error = null/);
assert.match(geminiWebGateway, /try \{\s*await _recordAccountSuccess\(task\.accountId\);\s*\} catch \(_\) \{\}/);
assert.match(app, /signal\?\.addEventListener\("abort", cancelRemoteTask/);
assert.match(macReleaseEntitlements, /com\.apple\.security\.network\.server/);
assert.match(app, /geminiGatewayDownloadBlob/);
assert.match(app, /function geminiGatewayProtectedImagePath/);
assert.match(app, /port >= 18160 && port <= 18199/);
assert.match(app, /const gatewayOrigin = new URL\(credentials\.baseUrl\)\.origin/);
assert.match(app, /new URL\(protectedPath, `\$\{gatewayOrigin\}\/`\)/);
assert.match(codexImageGateway, /http:\/\/127\.0\.0\.1:18081\/v1/);
assert.match(codexImageGateway, /MAX_REFERENCE_IMAGES\s*=\s*20/);
assert.match(codexImageGateway, /asyncTasks:\s*true/);
assert.match(codexImageGateway, /Older saved profiles may contain asyncTasks=false/);
assert.match(codexImageGateway, /dimensionMode:\s*"exact_output"/);
assert.match(app, /loadCodexImageGatewayConfig/);
assert.match(app, /image-tasks/);
assert.doesNotMatch(app, /if\s*\(\s*gatewayOptions\.asyncTasks\s*\)/);
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
assert.match(chatGptMultiAccount, /restoreGatewaySession/);
assert.match(dartMain, /_chatGptMultiAccountStore\.restoreGatewaySession/);
assert.doesNotMatch(chatGptMultiAccount, /localStorage|SharedPreferences/);
assert.match(embeddedChatGptGateway, /18081/);
assert.match(embeddedChatGptGateway, /18100/);
assert.match(embeddedChatGptGateway, /Process\.start/);
assert.match(embeddedChatGptGateway, /Future<void> stopAllForUpdate\(\)/);
assert.match(embeddedChatGptGateway, /gatewayStopByPathPowerShell/);
assert.match(embeddedChatGptGateway, /Get-CimInstance Win32_Process/);
assert.match(embeddedChatGptGateway, /ExecutablePath/);
assert.match(embeddedChatGptGateway, /Stop-Process -Id/);
assert.doesNotMatch(embeddedChatGptGateway, /taskkill\.exe/);
assert.match(dartMain, /await _embeddedChatGptGateway\.stopAllForUpdate\(\);\s*await Process\.start\(/s);
assert.match(windowsInstaller, /function PrepareToInstall/);
assert.match(windowsInstaller, /function StopBundledGateway/);
assert.match(windowsInstaller, /Get-CimInstance Win32_Process/);
assert.match(windowsInstaller, /ExecutablePath/);
assert.match(windowsInstaller, /Stop-Process -Id/);
assert.match(embeddedGatewayLauncher, /host = "127\.0\.0\.1"/);
assert.match(embeddedGatewayLauncher, /docs_url=None/);
assert.match(embeddedGatewayLauncher, /_install_runtime_streams/);
assert.match(embeddedGatewayLauncher, /@app\.get\("\/images\/\{image_path:path\}"/);
assert.match(embeddedGatewayLauncher, /return get_image_response\(image_path\)/);
assert.match(embeddedGatewaySmoke, /images\\smoke\\route-check\.png/);
assert.match(embeddedGatewaySmoke, /Gateway image route did not return the persisted image bytes/);
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
assert.match(dartMain, /secure_storage_queue\.dart/);
assert.match(secureStorageQueue, /class SecureStorageQueue/);
assert.match(secureStorageQueue, /static Future<void> _tail/);
assert.match(secureStorageQueue, /static Future<T> run<T>/);
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

for (const file of [
  "app.js", "bootstrap-guard.js", "image-task-stability.js",
  "codex-image-gateway.js", "gemini-image-size-registry.js",
  "gemini-web-image-adapter.js", "gemini-selector-pack.js",
  "gemini-embedded-worker.js",
  "index.html", "style.css", "sw.js", "manifest.webmanifest",
]) {
  assert.equal(
    hash(file),
    hash(`android/app/src/main/assets/${file}`),
    `Android asset copy is stale: ${file}`,
  );
}

assert.doesNotMatch(app, /HTTP\\s\*\(400\|502|400\/502\/503\/504/);
assert.match(imageTaskStability, /category = ERROR_CATEGORIES\.moderation;[\s\S]*?retryPolicy = "edit_required"/);
assert.match(imageTaskStability, /status === 400[\s\S]*?category = ERROR_CATEGORIES\.parameters;[\s\S]*?retryPolicy = "edit_required"/);
assert.match(imageTaskStability, /policy === "after_delay"/);
assert.match(imageTaskStability, /policy === "manual_limited"/);
assert.match(imageTaskStability, /policy === "after_probe"/);
assert.match(app, /\[429,\s*502,\s*503,\s*504\]\.includes\(pollResp\.status\)/);
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
