"use strict";
// Run against a staged source directory or, after integration, the repository root.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const languages = ["zh-CN", "zh-Hant", "en", "ja", "ko"];
function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source section ${start}`);
  return app.slice(a, b);
}
function fn(name) {
  const a = app.indexOf(`function ${name}(`);
  assert.ok(a >= 0, `Missing function ${name}`);
  return app.slice(a, app.indexOf("\n}", a) + 2);
}
const ctx = vm.createContext({ currentLanguage: "zh-CN" });
vm.runInContext(section("const I18N =", "function applyCleanLanguage()") +
  section("const GEMINI_WEB_LOCALES =", "function getGeminiWebOptions()") +
  "\nthis.tables = {CLEAN_LOCALES,INPAINT_LOCALES,CODEX_GATEWAY_LOCALES,CHATGPT_ACCOUNT_LOCALES}; this.legacy=I18N; this.ui=UI_METADATA_LOCALES; this.gemini=GEMINI_WEB_LOCALES;", ctx);
let passed = 0, failed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${error.message.split("\n")[0]}`); }
}
test("cleanText dictionaries have one owner per key in all five languages", () => {
  for (const lang of languages) {
    const owners = new Map();
    for (const [name, table] of Object.entries(ctx.tables)) {
      for (const key of Object.keys(table[lang])) {
        assert.ok(!owners.has(key), `${lang}.${key}: ${owners.get(key)} and ${name}`);
        owners.set(key, name);
      }
    }
  }
});
test("account removal and current inpaint route semantics remain authoritative", () => {
  const remove = ["移除当前账号", "移除目前帳號", "Remove active account", "現在のアカウントを削除", "현재 계정 삭제"];
  languages.forEach((lang, i) => {
    ctx.currentLanguage = lang;
    assert.equal(ctx.cleanText("chatGptLogout"), remove[i]);
    for (const [key, value] of Object.entries(ctx.tables.CHATGPT_ACCOUNT_LOCALES[lang])) assert.equal(ctx.cleanText(key), value);
    for (const [key, value] of Object.entries(ctx.tables.INPAINT_LOCALES[lang])) assert.equal(ctx.cleanText(key), value);
  });
  const handler = section('dom.chatGptLogout?.addEventListener("click"', "\n});");
  assert.match(handler, /askConfirm\(cleanText\("chatGptDeleteCurrentConfirm"\)\)/);
  assert.match(handler, /nativeDownload.deleteChatGptAccount\(account.local_account_id\)/);
  ctx.currentLanguage = "unrecognized";
  assert.equal(ctx.cleanText("chatGptLogout"), remove[0]);
  assert.equal(ctx.cleanText("missing-key"), "missing-key");
});
test("legacy dictionary has no duplicate source properties", () => {
  const keys = [...section("const I18N =", "const I18N_PATTERNS =").matchAll(/^  "([^"]+)":/gm)].map(m => m[1]);
  assert.equal(keys.length, new Set(keys).size);
});
test("ambiguous reverse values are never silently assigned to a different action", () => {
  for (const value of ["Retry", "Edit & Retry", "Generating...", "再試行", "재시도"]) {
    assert.equal(ctx.normalizeI18nSource(value), value, value);
  }
  for (const source of ["重试", "一键重试", "编辑重试", "编辑后重试", "生成中……", "正在生成中……"]) {
    for (const lang of languages) {
      ctx.currentLanguage = lang;
      assert.equal(ctx.tr(source), lang === "zh-CN" ? source : ctx.legacy[source][lang]);
    }
  }
});
test("mask example, status and candidate keys cover all five languages", () => {
  for (const key of ["inpaintPromptPlaceholder", "inpaintReadingSource", "inpaintSourceFailed", "inpaintMaskTooLarge", "inpaintCandidatesReady", "inpaintCandidatesPartial", "inpaintCancelled", "inpaintFailed", "inpaintSelectCandidate", "inpaintCandidateLabel"]) {
    for (const lang of languages) {
      ctx.currentLanguage = lang;
      assert.notEqual(ctx.cleanText(key), key, `${lang}.${key}`);
      assert.ok(ctx.tables.INPAINT_LOCALES[lang][key]);
    }
  }
  assert.match(fn("updateInpaintLanguage"), /inpaintPromptPlaceholder/);
  assert.match(fn("renderInpaintCandidates"), /inpaintCandidateLabel/);
});
test("Gemini runtime keys cover account actions, sizes and key placeholder", () => {
  for (const key of ["useAccount", "removeAccount", "deleteConfirm", "temporaryChatUnavailable", "loginContinue", "loginOpening", "loginComplete", "keyPlaceholder", "embeddedBrowser", "sizeTitle", "sizeHint", "sizeSummary"]) {
    for (const lang of languages) assert.ok(ctx.gemini[lang][key], `${lang}.${key}`);
  }
  for (const name of ["renderGeminiAccounts", "geminiAccountAvailabilityText", "applyApiProvider", "updateApiProviderHint"]) {
    assert.ok(!fn(name).includes('currentLanguage === "en"'), name);
  }
  assert.match(fn("updateGeminiLanguage"), /keyPlaceholder/);
});
test("remaining HTML metadata uses explicit UI keys without replacing input values", () => {
  for (const key of ["proxyEndpointPlaceholder", "proxyCustomPlaceholder", "skillsLibrary", "textEditMenu"]) {
    assert.equal(ctx.ui[key]?.length, 5, key);
    assert.ok(html.includes(`="${key}"`), key);
  }
  assert.match(fn("localizeUiMetadata"), /data-ui-placeholder/);
  assert.ok(!/node\.value\s*=/.test(fn("localizeUiMetadata")));
});
test("runtime localization binds canonical sources instead of displayed strings", () => {
  assert.match(fn("showLoading"), /setI18nText\(dom.loadingText, text\)/);
  assert.match(fn("refreshLocalizedFormMetadata"), /translateNodeValue/);
  assert.match(fn("applyLanguage"), /refreshI18nBindings/);
  assert.match(fn("translateElement"), /data-no-i18n/);
  assert.match(app, /data-clean-label="retry"/);
  assert.match(app, /data-clean-label="editRetry"/);
});
test("node/attribute bindings preserve distinct canonical sources across every language pair", () => {
  for (const source of ["重试", "一键重试", "编辑重试", "编辑后重试", "生成中……", "正在生成中……"]) {
    for (const first of languages) {
      const node = {};
      ctx.currentLanguage = first;
      let text = ctx.translateNodeValue(node, "title", "", source);
      for (const lang of [...languages, first, "zh-CN"]) {
        ctx.currentLanguage = lang;
        text = ctx.translateNodeValue(node, "title", text);
        assert.equal(text, lang === "zh-CN" ? source : ctx.legacy[source][lang]);
      }
      ctx.currentLanguage = "en";
      assert.equal(ctx.translateNodeValue(node, "title", "UNCHANGED USER TEXT"), "UNCHANGED USER TEXT");
    }
  }
});
test("user content boundaries and Gemini watermark labels are explicit", () => {
  for (const name of ["history-project-title", "history-prompt-text", "history-prompt"]) assert.ok(fn("translateElement").includes(name));
  assert.match(fn("makeCardActionBtn"), /dataset.cleanLabel = key/);
  assert.match(fn("updateInpaintLanguage"), /const hasSource = !!inpaintState.source/);
  const watermark = section("async function processImportedWatermarkImages(", "dom.importWatermarkImages?.addEventListener");
  assert.ok(!watermark.includes('currentLanguage === "en"'));
  for (const key of ["watermarkChooseImages", "watermarkSaved", "watermarkFinished", "watermarkFailed", "resultMismatch"]) assert.ok(ctx.ui[key]?.length === 5, key);
});
console.log(`RESULT: ${passed}/${passed + failed} checks passed; languages=${languages.join(",")}`);
process.exitCode = failed ? 1 : 0;
