/* ES5-only bootstrap: no eval/Function, polyfills, storage writes or UA gating. */
(function () {
  "use strict";
  var fallbackLabels = {
    "zh-CN": ["程序初始化失败：", "程序初始化超时。请重启软件；此提示不会清理现有数据。", "当前内置浏览器缺少必要功能：", "请更新 Android System WebView／Chrome（Android）、Microsoft Edge WebView2 Runtime（Windows），或通过系统软件更新升级 WebKit（iOS／macOS），然后重启软件。若设备已无可用更新，请使用支持这些功能的设备。此检查不会修改配置或清理数据。"],
    "zh-Hant": ["程式初始化失敗：", "程式初始化逾時。請重新啟動；此提示不會清理現有資料。", "目前內建瀏覽器缺少必要功能：", "請更新 Android System WebView／Chrome（Android）、Microsoft Edge WebView2 Runtime（Windows），或透過系統軟體更新升級 WebKit（iOS／macOS），然後重新啟動。若裝置已無可用更新，請使用支援這些功能的裝置。此檢查不會修改設定或清理資料。"],
    "en": ["App initialization failed: ", "App initialization timed out. Restart the app; this notice does not clear your data.", "This embedded browser is missing required features: ", "Update Android System WebView / Chrome (Android), Microsoft Edge WebView2 Runtime (Windows), or WebKit through system software updates (iOS / macOS), then restart the app. If updates are unavailable, use a device supporting these features. This check does not change settings or clear data."],
    "ja": ["アプリの初期化に失敗しました：", "アプリの初期化がタイムアウトしました。再起動してください。この通知は既存データを削除しません。", "内蔵ブラウザーに必要な機能がありません：", "Android は Android System WebView／Chrome、Windows は Microsoft Edge WebView2 Runtime、iOS／macOS はシステムのソフトウェア更新で WebKit を更新し、アプリを再起動してください。更新がない場合は対応する端末をご使用ください。この確認は設定を変更せず、データも削除しません。"],
    "ko": ["앱 초기화 실패: ", "앱 초기화 시간이 초과되었습니다. 앱을 다시 시작하세요. 이 알림은 기존 데이터를 삭제하지 않습니다.", "내장 브라우저에 필요한 기능이 없습니다: ", "Android는 Android System WebView / Chrome, Windows는 Microsoft Edge WebView2 Runtime, iOS / macOS는 시스템 소프트웨어 업데이트로 WebKit을 업데이트한 후 앱을 다시 시작하세요. 업데이트가 없으면 해당 기능을 지원하는 기기를 사용하세요. 이 검사는 설정을 변경하거나 데이터를 삭제하지 않습니다."]
  };
  function normalizeLanguage(value) {
    var language = String(value || "").toLowerCase().replace(/_/g, "-");
    if (/^zh-(hant|tw|hk|mo)(-|$)/.test(language)) return "zh-Hant";
    if (/^zh(-|$)/.test(language)) return "zh-CN";
    if (/^en(-|$)/.test(language)) return "en";
    if (/^ja(-|$)/.test(language)) return "ja";
    if (/^ko(-|$)/.test(language)) return "ko";
    return "";
  }
  function fallbackText(index) {
    var saved = "";
    try { saved = window.localStorage.getItem("ai_image_gen_language"); } catch (_) {}
    var language = normalizeLanguage(saved) || normalizeLanguage(document.documentElement.lang) || "zh-CN";
    return fallbackLabels[language][index];
  }
  function query(selector) { return document.querySelector(selector); }
  function toggleClass(node, name, enabled) {
    if (!node) return;
    if (node.classList) {
      if (enabled) node.classList.add(name);
      else node.classList.remove(name);
    } else {
      var value = String(node.className || "").replace(new RegExp("(^|\\s)" + name + "(?=\\s|$)", "g"), " ");
      node.className = value + (enabled ? " " + name : "");
    }
  }
  window.__AI_GEN_APP_READY = false;
  // Core-ready does not mean the asynchronously loaded Studio layout is ready.
  window.__AI_GEN_UI_READY = false;
  window.__AI_GEN_PRESENTATION = "loading";
  window.__AI_GEN_STARTUP_ERRORS = [];
  var runtime = { contract: "studio-runtime-v1", state: "unmanaged", supported: false, missing: [], optional: {}, loaded: [] };
  window.__AI_GEN_RUNTIME = runtime;
  var started = false;
  var failed = false;
  var presentationLabels = {
    "zh-CN": ["正在启动工作室…", "工作室界面加载失败，已显示备用界面；请重启软件。现有配置和历史不会被清理。"],
    "zh-Hant": ["正在啟動工作室…", "工作室介面載入失敗，已顯示備用介面；請重新啟動。現有設定與歷史不會被清理。"],
    "en": ["Starting Studio…", "Studio layout could not load. The fallback interface is available; restart the app. Your settings and history are preserved."],
    "ja": ["Studio を起動しています…", "Studio の画面を読み込めませんでした。代替画面を表示しています。再起動してください。設定と履歴は保持されます。"],
    "ko": ["Studio 시작 중…", "Studio 화면을 불러오지 못해 대체 화면을 표시합니다. 앱을 다시 시작하세요. 설정과 기록은 유지됩니다."]
  };
  function presentationText(index) {
    var saved = "";
    try { saved = window.localStorage.getItem("ai_image_gen_language"); } catch (_) {}
    return presentationLabels[normalizeLanguage(saved) || normalizeLanguage(document.documentElement.lang) || "zh-CN"][index];
  }
  var initialStatus = query("#studio-startup-status");
  if (initialStatus) {
    initialStatus.textContent = presentationText(0);
    try {
      var theme = window.localStorage.getItem("ai_image_gen_theme");
      if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
    } catch (_) {}
  }
  function finishPresentation(state, details) {
    if (state !== "ready" && state !== "fallback") return;
    window.__AI_GEN_PRESENTATION = state;
    window.__AI_GEN_UI_READY = state === "ready";
    toggleClass(document.documentElement, "studio-starting", false);
    var status = query("#studio-startup-status");
    if (status) {
      toggleClass(status, "hidden", state === "ready");
      if (state === "fallback") renderStatus(presentationText(1) + (details ? " " + details : ""));
    }
  }
  function recordError(value) {
    var message;
    try { message = String((value && (value.message || value.reason)) || value || "Unknown startup error"); }
    catch (_) { message = "Unknown startup error"; }
    window.__AI_GEN_STARTUP_ERRORS.push(message);
    if (window.__AI_GEN_STARTUP_ERRORS.length > 10) window.__AI_GEN_STARTUP_ERRORS.shift();
  }
  function renderStatus(text) {
    // Before the shell boots, #status sits far down the creation sidebar.
    // Unsupported engines get an independent, first-in-document alert instead.
    var unsupported = runtime.state === "unsupported";
    var status = unsupported ? query("#ai-gen-runtime-status") : (query("#studio-startup-status") || query("#status"));
    if (!status && document.body && document.createElement) {
      status = query("#ai-gen-runtime-status");
      if (!status) {
        status = document.createElement("p");
        status.id = "ai-gen-runtime-status";
        status.style.cssText = "display:block;position:relative;margin:12px;padding:16px;border:2px solid #9b1c1c;background:#fff;color:#111;font:16px/1.5 sans-serif;text-align:left;white-space:normal;word-wrap:break-word;";
        document.body.insertBefore(status, document.body.firstChild);
      }
    }
    if (!status) return;
    status.textContent = text;
    if (status.setAttribute) { status.setAttribute("role", "alert"); status.setAttribute("aria-live", "assertive"); }
    toggleClass(status, "hidden", false);
    toggleClass(status, "success", false);
    toggleClass(status, "error", true);
  }
  function showFallback() {
    if (window.__AI_GEN_UI_READY === true || (window.__AI_GEN_APP_READY === true && !initialStatus)) return;
    if (runtime.state === "unsupported") {
      finishPresentation("fallback");
      renderStatus(unsupportedMessage());
      return;
    }
    var errors = window.__AI_GEN_STARTUP_ERRORS;
    var details = errors[errors.length - 1];
    renderStatus(details ? fallbackText(0) + details : fallbackText(1));
  }
  function unsupportedMessage() {
    return fallbackText(2) + runtime.missing.join(", ") + ". " + fallbackText(3);
  }
  function startupError(value) {
    recordError(value);
    if (started && window.__AI_GEN_UI_READY !== true && runtime.state !== "unsupported") {
      failed = true;
      runtime.state = "error";
      finishPresentation("fallback");
      showFallback();
    }
  }
  addEventListener("error", function (event) { startupError(event.error || event.message); });
  addEventListener("unhandledrejection", function (event) { startupError(event.reason); });
  addEventListener("ai-generator-ready", function () {
    if (started && !failed && runtime.state !== "unsupported" && window.__AI_GEN_APP_READY === true) runtime.state = "ready";
  });
  addEventListener("studio-shell-ready", function () {
    if (window.__AI_GEN_APP_READY === true && window.StudioShell) finishPresentation("ready");
  });
  function inspect() {
    var missing = [];
    function check(name, probe) {
      try { if (probe()) return; } catch (_) {}
      missing.push(name);
    }
    function method(name) {
      check(name, function () {
        var parts = name.split(".");
        var value = window;
        for (var i = 0; i < parts.length; i++) value = value[parts[i]];
        return typeof value === "function";
      });
    }
    // Required by shipped JS and UI; this does NOT certify a device or OS.
    var methods = ["Promise", "Promise.allSettled", "Map", "Set", "WeakMap", "Symbol",
      "Object.assign", "Object.entries", "Object.values", "Object.fromEntries",
      "Array.from", "Array.prototype.includes", "Array.prototype.find", "Array.prototype.at", "Array.prototype.flatMap",
      "String.prototype.matchAll", "String.prototype.padStart", "String.prototype.trimStart",
      "fetch", "Headers", "Headers.prototype.entries", "Response", "Response.prototype.blob",
      "Response.prototype.arrayBuffer", "FormData", "FormData.prototype.entries",
      "AbortController", "Blob", "Blob.prototype.arrayBuffer", "Blob.prototype.text", "FileReader",
      "TextDecoder", "Uint8Array", "URL", "URL.createObjectURL", "URL.revokeObjectURL",
      "URLSearchParams", "CustomEvent", "MutationObserver", "requestAnimationFrame", "queueMicrotask",
      "Element.prototype.closest", "Element.prototype.matches", "Element.prototype.append",
      "Element.prototype.remove", "Element.prototype.replaceChildren", "NodeList.prototype.forEach",
      "HTMLCanvasElement.prototype.getContext", "HTMLCanvasElement.prototype.toBlob"];
    for (var i = 0; i < methods.length; i++) method(methods[i]);
    check("globalThis", function () { return window.globalThis === window; });
    check("Symbol.iterator", function () { return !!window.Symbol.iterator; });
    check("HTMLElement.inert", function () { return "inert" in window.HTMLElement.prototype; });
    check("template.content", function () { return !!document.createElement("template").content; });
    check("RegExp dotAll", function () { return new RegExp(".", "s").test("\n"); });
    check("CSS variables", function () { return window.CSS.supports("--studio-runtime-check", "0"); });
    check("CSS grid", function () { return window.CSS.supports("display", "grid"); });
    check("CSS color-mix", function () { return window.CSS.supports("color", "color-mix(in srgb, black 50%, white)"); });
    // Presence only: optional operations may still fail. Never test storage by writing.
    function optional(probe) { try { return !!probe(); } catch (_) { return false; } }
    return { contract: runtime.contract, supported: missing.length === 0, missing: missing,
      optional: {
        indexedDB: optional(function () { return window.indexedDB && typeof window.indexedDB.open === "function"; }),
        webCrypto: optional(function () { return window.crypto && window.crypto.subtle; }),
        serviceWorker: optional(function () { return window.navigator && window.navigator.serviceWorker; }),
        decompressionStream: optional(function () { return typeof window.DecompressionStream === "function"; }),
        createImageBitmap: optional(function () { return typeof window.createImageBitmap === "function"; }),
        offscreenCanvas: optional(function () { return typeof window.OffscreenCanvas === "function"; }),
        clipboard: optional(function () { return window.navigator && window.navigator.clipboard; }),
        storageEstimate: optional(function () { return window.navigator.storage && window.navigator.storage.estimate; }),
        contentVisibility: optional(function () { return window.CSS.supports("content-visibility", "auto"); }),
        dynamicViewport: optional(function () { return window.CSS.supports("height", "100dvh"); }),
        hasSelector: optional(function () { return window.CSS.supports("selector(:has(*))"); })
      }
    };
  }
  function updateInspection() {
    var result = inspect();
    runtime.supported = result.supported;
    runtime.missing = result.missing;
    runtime.optional = result.optional;
  }
  function start() {
    if (started) return runtime.supported && !failed;
    started = true;
    updateInspection();
    if (!runtime.supported) {
      runtime.state = "unsupported";
      // Native hosts already read STARTUP_ERRORS: retain the same localized
      // actionable message if a host replaces this page with its error view.
      recordError(unsupportedMessage());
      showFallback();
      return false;
    }
    // Parent integration: inert descriptors FIRST, this guard LAST with
    // data-ai-gen-autoload. Remove ALL normal src tags for these files.
    var names = ["image-task-stability.js", "codex-image-gateway.js", "gemini-image-size-registry.js",
      "gemini-web-image-adapter.js", "gemini-selector-pack.js", "gemini-watermark-remover.bundle.js", "app.js", "studio-shell.js"];
    var nodes = document.querySelectorAll("script[type='application/x-ai-gen-script'][data-src]");
    var sources = [];
    for (var i = 0; i < nodes.length; i++) {
      var source = nodes[i].getAttribute("data-src") || "";
      var pieces = source.split("?");
      if (nodes[i].getAttribute("src") !== null || pieces[0] !== names[i] || pieces.length > 2 ||
          (pieces.length === 2 && !/^v=[A-Za-z0-9._-]+$/.test(pieces[1]))) {
        startupError("Invalid runtime script manifest at position " + (i + 1));
        return false;
      }
      sources.push(source);
    }
    if (sources.length !== names.length) { startupError("Incomplete runtime script manifest"); return false; }
    runtime.state = "loading";
    var nextIndex = 0;
    function next() {
      if (failed) return;
      if (nextIndex === sources.length) {
        if (runtime.state !== "ready") runtime.state = "loaded";
        return;
      }
      var source = sources[nextIndex++];
      var script = document.createElement("script");
      script.async = false;
      script.src = source;
      script.onload = function () { runtime.loaded.push(source); next(); };
      script.onerror = function () { startupError("Script load failed: " + source); };
      (document.head || document.body).appendChild(script);
    }
    next();
    return true;
  }
  window.AiGenRuntime = { inspect: inspect, start: start, finishPresentation: finishPresentation };
  updateInspection();
  function showFallbackModal(modal) {
    if (!modal) return;
    toggleClass(modal, "hidden", false);
    toggleClass(document.body, "modal-open", true);
  }
  function hideFallbackModal(modal) {
    if (!modal) return;
    toggleClass(modal, "hidden", true);
    if (!query(".modal:not(.hidden), .lightbox")) toggleClass(document.body, "modal-open", false);
  }
  // Fallback itself needs no closest, dataset, NodeList.forEach or classList.toggle.
  document.addEventListener("click", function (event) {
    if (window.__AI_GEN_APP_READY === true) return;
    var target = event.target;
    while (target && !(String(target.tagName).toLowerCase() === "button" ||
        (target.getAttribute && target.getAttribute("role") === "button"))) target = target.parentNode;
    if (!target) return;
    var id = target.id;
    if (id === "settingsBtn" || id === "skillsBtn" || id === "openSkillsFromPanel") {
      event.preventDefault();
      showFallbackModal(query(id === "settingsBtn" ? "#settingsModal" : "#skillsModal"));
    } else if (id === "closeSettings" || id === "closeSkills") {
      event.preventDefault();
      hideFallbackModal(query(id === "closeSettings" ? "#settingsModal" : "#skillsModal"));
    } else if (/(^|\s)mode-tab(\s|$)/.test(target.className) && target.getAttribute("data-mode")) {
      event.preventDefault();
      var mode = target.getAttribute("data-mode");
      var tabs = document.querySelectorAll(".mode-tab[data-mode]");
      for (var i = 0; i < tabs.length; i++) {
        toggleClass(tabs[i], "active", tabs[i] === target);
        tabs[i].setAttribute("aria-selected", tabs[i] === target ? "true" : "false");
      }
      toggleClass(query("#comicPanelSection"), "hidden", mode !== "comic");
      toggleClass(query("#turnaroundSection"), "hidden", mode !== "turnaround");
      toggleClass(query("#nImagesField"), "hidden", mode !== "single");
      toggleClass(query("#globalPromptField"), "hidden", mode === "turnaround");
      toggleClass(query("#activeSkillsSection"), "hidden", mode === "turnaround");
    }
  }, true);
  document.addEventListener("DOMContentLoaded", function () {
    if (runtime.state === "unsupported" || runtime.state === "error") showFallback();
  });
  setTimeout(showFallback, 5000);
  var ownScript = document.currentScript;
  if (ownScript && ownScript.getAttribute("data-ai-gen-autoload") !== null) start();
}());
