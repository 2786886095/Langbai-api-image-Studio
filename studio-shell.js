/* Presentation only: reuse existing controls and handlers; never copy API or task state. */
(() => {
  "use strict";
  const labels = {
    "zh-CN": { navigation:"主导航", create:"创作", history:"项目历史", api:"API / 账号", settings:"设置", edit:"创作参数", results:"分镜与结果", canvas:"作品预览", canvasHint:"生成结果仅缓存在应用内，导出后写入你的文件夹。", apiHint:"管理供应商、已保存配置与账号。切换不会清空当前作品。", back:"返回创作", close:"关闭", files:"文件与缓存", generation:"生成策略", network:"网络代理", updates:"软件信息", settingsHint:"设置自动保存。清空操作会再次确认。", subtitle:"把想法变成作品", tools:"图像工具", preview:"v1.7.1" },
    "zh-Hant": { navigation:"主導覽", create:"創作", history:"專案歷史", api:"API / 帳號", settings:"設定", edit:"創作參數", results:"分鏡與結果", canvas:"作品預覽", canvasHint:"生成結果僅快取於應用內，匯出後寫入你的資料夾。", apiHint:"管理供應商、已儲存設定與帳號。切換不會清空目前作品。", back:"返回創作", close:"關閉", files:"檔案與快取", generation:"生成策略", network:"網路代理", updates:"軟體資訊", settingsHint:"設定自動儲存。清空操作會再次確認。", subtitle:"把想法變成作品", tools:"影像工具", preview:"v1.7.1" },
    en: { navigation:"Main navigation", create:"Create", history:"Projects", api:"API / Accounts", settings:"Settings", edit:"Create", results:"Panels & results", canvas:"Your workspace", canvasHint:"Results stay in the app cache until you export them to a folder.", apiHint:"Manage providers, saved profiles and accounts without clearing your work.", back:"Back to create", close:"Close", files:"Files & cache", generation:"Generation", network:"Network", updates:"About & updates", settingsHint:"Settings save automatically. Destructive actions ask for confirmation.", subtitle:"From ideas to images", tools:"Image tools", preview:"v1.7.1" },
    ja: { navigation:"メインナビゲーション", create:"制作", history:"プロジェクト", api:"API / アカウント", settings:"設定", edit:"制作設定", results:"コマと結果", canvas:"作品プレビュー", canvasHint:"画像はアプリ内にキャッシュされ、書き出すと指定フォルダーに保存されます。", apiHint:"プロバイダー・保存済み設定・アカウントを管理。切替時も作品を保持します。", back:"制作に戻る", close:"閉じる", files:"ファイルとキャッシュ", generation:"生成設定", network:"ネットワーク", updates:"ソフトウェア情報", settingsHint:"設定は自動保存されます。削除操作には確認が必要です。", subtitle:"アイデアを作品に", tools:"画像ツール", preview:"v1.7.1" },
    ko: { navigation:"기본 탐색", create:"만들기", history:"프로젝트", api:"API / 계정", settings:"설정", edit:"생성 설정", results:"장면과 결과", canvas:"작품 미리보기", canvasHint:"이미지는 앱에 캐시되며 내보낼 때 폴더에 저장됩니다.", apiHint:"작품을 지우지 않고 공급자, 저장된 설정 및 계정을 관리합니다.", back:"만들기로 돌아가기", close:"닫기", files:"파일과 캐시", generation:"생성 정책", network:"네트워크", updates:"소프트웨어 정보", settingsHint:"설정은 자동 저장됩니다. 삭제 작업은 다시 확인합니다.", subtitle:"아이디어를 작품으로", tools:"이미지 도구", preview:"v1.7.1" },
  };
  const $ = selector => document.querySelector(selector);
  const text = key => (labels[document.documentElement.lang] || labels["zh-CN"])[key] || labels["zh-CN"][key] || key;
  const localNodes = [];
  function localized(tag, key, className = "") {
    const node = document.createElement(tag);
    node.className = className;
    node.dataset.noI18n = "";
    node.dataset.studioText = key;
    node.textContent = text(key);
    localNodes.push(node);
    return node;
  }
  function button(key, className = "studio-nav-button") {
    const node = localized("button", key, className);
    node.type = "button";
    return node;
  }
  function start() {
    if (window.StudioShell || !window.__AI_GEN_APP_READY) return;
    const root = $(".app"), header = $(".header"), input = $(".input-panel"), result = $(".result-panel");
    const config = $("#configSection"), modeTabs = $("#modeTabs");
    if (!root || !header || !input || !result || !config || !modeTabs) return;
    // Fail before moving any controls if a future build omits a required view.
    // The original working layout remains intact instead of a half-built shell.
    const required = ["#historyBtn", "#settingsBtn", "#importWatermarkImages", "#exportBtn", "#skillsBtn", ".header-actions", "#themeToggle", "#comicPanelSection", "#turnaroundSection", "#settingsModal .modal-card", "#settingsModal .settings-grid", "#historyModal", ".subtitle"];
    if (required.some(selector => !$(selector))) {
      console.warn("Studio layout skipped: a required view is missing; existing UI retained.");
      return;
    }
    if (typeof openModal !== "function" || typeof closeModal !== "function" || typeof getTopVisibleOverlay !== "function") {
      console.warn("Studio layout skipped: modal contract is missing; existing UI retained.");
      return;
    }

    const nav = document.createElement("nav");
    nav.className = "studio-navigation";
    nav.setAttribute("aria-label", text("navigation"));
    const create = button("create");
    create.id = "studioCreate";
    const api = button("api");
    api.id = "studioApi";
    const history = $("#historyBtn"), settings = $("#settingsBtn");
    for (const [node,key] of [[history,"history"],[settings,"settings"]]) {
      node.classList.add("studio-nav-button");
      node.appendChild(localized("span",key));
    }
    nav.append(create, history, api, settings);
    header.append(nav);
    const preview = localized("span","preview","studio-preview-badge");
    header.append(preview);

    const toolsMenu = document.createElement("details");
    toolsMenu.className = "studio-tools";
    const toolsSummary = localized("summary","tools");
    const toolsList = document.createElement("div");
    toolsList.className = "studio-tools-list";
    const toolsLabels = [];
    for (const id of ["importWatermarkImages","exportBtn","skillsBtn"]) {
      const control = $("#" + id);
      const label = document.createElement("span");
      label.dataset.noI18n = "";
      control.append(label);
      toolsLabels.push([control,label]);
      control.addEventListener("click",() => { toolsMenu.open = false; });
      toolsList.append(control);
    }
    toolsMenu.append(toolsSummary,toolsList);
    $(".header-actions").insertBefore(toolsMenu,$("#themeToggle"));
    document.addEventListener("pointerdown",event => { if(!toolsMenu.contains(event.target)) toolsMenu.open = false; });
    toolsMenu.addEventListener("keydown",event => { if(event.key === "Escape") { toolsMenu.open = false; toolsSummary.focus(); } });

    const workspaceHead = document.createElement("div");
    workspaceHead.className = "studio-workspace-header";
    workspaceHead.append(modeTabs);
    const paneSwitch = document.createElement("div");
    paneSwitch.className = "studio-pane-switch";
    const edit = button("edit", "studio-pane-button");
    edit.id = "studioEditorTab";
    const results = button("results", "studio-pane-button");
    results.id = "studioResultsTab";
    paneSwitch.append(edit, results);
    workspaceHead.append(paneSwitch);
    root.insertBefore(workspaceHead, $(".main-layout"));
    function showPane(pane) {
      document.body.dataset.studioPane = pane;
      edit.setAttribute("aria-pressed", String(pane === "edit"));
      results.setAttribute("aria-pressed", String(pane === "results"));
    }
    edit.addEventListener("click", () => showPane("edit"));
    results.addEventListener("click", () => showPane("results"));
    showPane("edit");

    const editor = document.createElement("section");
    editor.className = "studio-storyboard";
    editor.append($("#comicPanelSection"), $("#turnaroundSection"));
    const resultHead = document.createElement("div");
    resultHead.className = "studio-canvas-header";
    resultHead.append(localized("h2","canvas"),localized("p","canvasHint"));
    result.prepend(editor, resultHead);
    input.prepend(localized("h2","edit","studio-panel-heading"));

    // Reparent the original API controls once, retaining values, DOM references
    // and every existing handler. The new dialog uses the app's modal stack.
    const apiModal = document.createElement("div");
    apiModal.id = "studioApiModal";
    apiModal.className = "modal studio-api-modal hidden";
    apiModal.setAttribute("role", "dialog");
    apiModal.setAttribute("aria-modal", "true");
    apiModal.setAttribute("aria-labelledby", "studioApiTitle");
    const apiCard = document.createElement("div");
    apiCard.className = "modal-card studio-api-card";
    apiCard.tabIndex = -1;
    const apiHeader = document.createElement("div");
    apiHeader.className = "modal-header";
    const apiTitle = localized("h2","api");
    apiTitle.id = "studioApiTitle";
    const apiClose = button("back", "btn");
    apiClose.id = "studioCloseApi";
    apiHeader.append(apiTitle, apiClose);
    apiCard.append(apiHeader, localized("p","apiHint","studio-dialog-description"), config);
    apiModal.append(apiCard);
    document.body.append(apiModal);
    config.open = true;
    const openApi = () => { config.open = true; openModal(apiModal); };
    const closeApi = () => closeModal(apiModal);
    api.addEventListener("click",openApi);
    apiClose.addEventListener("click",closeApi);
    apiModal.addEventListener("click",event => { if(event.target === apiModal) closeApi(); });
    document.addEventListener("keydown",event => {
      if (event.key === "Escape" && !event.defaultPrevented && getTopVisibleOverlay() === apiModal) {
        event.preventDefault(); closeApi();
      }
    });
    create.addEventListener("click", () => {
      [apiModal,$("#settingsModal"),$("#historyModal")].forEach(modal => closeModal(modal));
    });

    const settingGroups = {
      files: ".download-settings,.history-settings,.cache-settings",
      generation: ".watermark-settings,.retry-settings",
      network: ".proxy-settings",
      updates: ".update-settings",
    };
    const settingsCard = $("#settingsModal .modal-card");
    const settingsNav = document.createElement("nav");
    settingsNav.className = "studio-settings-navigation";
    const groupButtons = new Map();
    function selectSettings(group) {
      for (const [key,selector] of Object.entries(settingGroups)) {
        settingsCard.querySelectorAll(selector).forEach(section => {
          section.classList.toggle("studio-section-inactive",key !== group);
          section.inert = key !== group;
        });
        groupButtons.get(key)?.setAttribute("aria-pressed",String(key === group));
      }
    }
    for (const key of Object.keys(settingGroups)) {
      const control = button(key,"studio-settings-tab");
      control.dataset.settingsGroup = key;
      control.addEventListener("click",() => selectSettings(key));
      groupButtons.set(key,control);
      settingsNav.append(control);
    }
    settingsCard.insertBefore(settingsNav,$("#settingsModal .settings-grid"));
    settingsCard.insertBefore(localized("p","settingsHint","studio-dialog-description"),settingsNav);
    selectSettings("files");
    const routeObservers = [];
    function updateRoute() {
      const active = !apiModal.classList.contains("hidden") ? api : !$("#settingsModal").classList.contains("hidden") ? settings : !$("#historyModal").classList.contains("hidden") ? history : create;
      [create,history,api,settings].forEach(node => {
        node.classList.toggle("is-current", node === active);
        node.setAttribute("aria-current", node === active ? "page" : "false");
      });
    }
    for (const modal of [apiModal,$("#settingsModal"),$("#historyModal")]) {
      const observer = new MutationObserver(updateRoute);
      observer.observe(modal,{attributes:true,attributeFilter:["class"]});
      routeObservers.push(observer);
    }
    const updateLanguage = () => {
      localNodes.forEach(node => { if(node.isConnected) node.textContent = text(node.dataset.studioText); });
      nav.setAttribute("aria-label",text("navigation"));
      toolsSummary.title = text("tools");
      $(".subtitle").textContent = text("subtitle");
      toolsLabels.forEach(([control,label]) => { label.textContent = control.getAttribute("aria-label") || control.title; });
    };
    const languageObserver = new MutationObserver(updateLanguage);
    languageObserver.observe(document.documentElement,{attributes:true,attributeFilter:["lang"]});
    updateRoute();
    updateLanguage();
    document.body.classList.add("studio-shell");
    document.documentElement.classList.add("studio-shell-root");
    window.StudioShell = Object.freeze({ openApi, closeApi, showPane, selectSettings });
    window.dispatchEvent(new CustomEvent("studio-shell-ready"));
  }
  function initialize() {
    try {
      start();
      if (!window.StudioShell) window.AiGenRuntime?.finishPresentation("fallback");
    }
    catch (error) {
      console.error("Studio layout initialization failed",error);
      window.AiGenRuntime?.finishPresentation("fallback", String(error?.message || error));
    }
  }
  if (window.__AI_GEN_APP_READY) initialize();
  else window.addEventListener("ai-generator-ready",initialize,{once:true});
})();
