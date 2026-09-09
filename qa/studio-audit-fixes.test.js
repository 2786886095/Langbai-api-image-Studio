"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const css = read("studio-shell.css"), app = read("app.js"), shell = read("studio-shell.js");
let failed = 0;
function test(name, run) { try { run(); console.log(`PASS: ${name}`); } catch (e) { failed++; console.log(`FAIL: ${name}: ${String(e.message || e).split("\n")[0]}`); } }
const luminance = hex => hex.match(/\w\w/g).map(x => parseInt(x,16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((n,v,i) => n+v*[.2126,.7152,.0722][i],0);
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
test("interactive borders >= 3:1 against both adjacent surfaces", () => {
  assert.match(css, /--control-border:#6e7186/);
  assert.match(css, /--control-border:#888ea2/);
  for (const [a,b] of [["888ea2","ffffff"],["888ea2","f5f7fc"],["6e7186","191a23"],["6e7186","20212d"]]) assert.ok(contrast(a,b)>=3);
  assert.match(css, /border-color:var\(--control-border\)/);
});
test("forced colors retain masked icons and a non-color selected indicator", () => {
  assert.match(css, /@media\s*\(forced-colors:active\)/);
  assert.match(css, /\.ui-icon\s*\{[^}]*forced-color-adjust:none/);
  assert.match(css, /background:ButtonText; color:ButtonText/);
  assert.match(css, /outline:2px solid Highlight/);
});
test("legacy selector parsing and viewport fallback are independent", () => {
  assert.ok(!css.includes("html:has(.studio-shell),body.studio-shell"));
  assert.match(css, /max-height:calc\(100vh - 16px\); max-height:calc\(100dvh - 16px\)/);
});
test("missing modal functions leave all working controls untouched", () => {
  let moves=0,warnings=0;
  vm.runInNewContext(shell, {
    window:{__AI_GEN_APP_READY:true}, document:{querySelector:()=>({}), createElement:()=>{moves++;throw Error("moved before contract check");}},
    console:{warn:()=>warnings++, error:e=>{throw e;}}
  });
  assert.equal(moves,0); assert.equal(warnings,1);
});
test("metadata translations are canonical and complete in five languages", () => {
  const start=app.indexOf("const UI_METADATA_LOCALES ="), end=app.indexOf("function applyCleanLanguage()",start);
  assert.ok(start>=0 && end>start);
  const context=vm.createContext({currentLanguage:"en"});
  vm.runInContext(app.slice(start,end)+"\nthis.table=UI_METADATA_LOCALES;",context);
  for(const values of Object.values(context.table)) {
    assert.equal(values.length,5); assert.ok(values.every(v=>typeof v==='string'&&v.length));
  }
  assert.equal(context.uiText("brush"),"Brush");
  assert.equal(context.uiText("deletePanel"),"Delete panel");
  assert.equal(context.uiText("unrecognized-key"),"unrecognized-key");
});
test("single title owner, panel undo, and search coalescing exist", () => {
  assert.ok(!app.includes('document.title = tr("AI 图片生成器")'));
  assert.match(app,/function deleteEditorRowWithUndo\(/);
  assert.match(app,/function clearEditorRowUndo\(/);
  assert.match(app,/historySearch.*addEventListener\("compositionend", scheduleHistorySearch\)/);
  assert.match(app,/setTimeout\(renderHistory, 180\)/);
  assert.match(app,/details.addEventListener\("toggle",/);
});
test("table fields use normal component cascade; visibility and reduced-motion guards remain strong", () => {
  for (const name of ["style.css", "studio-shell.css"]) {
    const code=read(name).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\.(?:panel-row|turnaround-row)\s+textarea|\.panel-(?:size-w|size-h|retry-count)\b/.test(match[1])) {
        assert.doesNotMatch(match[2], /!\s*important\b/i, name+": "+match[1].trim());
      }
    }
  }
  assert.match(css, /\.studio-section-inactive\s*\{[^}]*display:\s*none\s*!important/);
  assert.match(css, /scroll-behavior:\s*auto\s*!important/);
  assert.match(read("style.css"), /\.hidden\s*\{[^}]*display:\s*none\s*!important/);
});
console.log(`RESULT: ${7-failed}/7 checks passed`);
process.exitCode = failed ? 1 : 0;
