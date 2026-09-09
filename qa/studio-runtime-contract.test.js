"use strict";
// No npm install needed: prefer Acorn if supplied, otherwise Node's bundled copy.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const file = path.resolve(process.argv[2] || path.join(root, "bootstrap-guard.js"));
const source = fs.readFileSync(file, "utf8");
function acorn() {
  try { return require(process.env.AIGEN_ACORN_PATH || "acorn"); } catch (_) {
    const code = process.binding("natives")["internal/deps/acorn/acorn/dist/acorn"];
    assert.ok(code, "Provide Acorn via AIGEN_ACORN_PATH when Node has no bundled parser");
    const context = { exports: {}, module: {} };
    vm.runInNewContext(code, context);
    return context.exports;
  }
}
const scripts = ["image-task-stability.js", "codex-image-gateway.js", "gemini-image-size-registry.js",
  "gemini-web-image-adapter.js", "gemini-selector-pack.js", "gemini-watermark-remover.bundle.js", "app.js", "studio-shell.js"];
let passed = 0, failed = 0;
function test(name, run) {
  try { run(); passed++; console.log("PASS: " + name); }
  catch (error) { failed++; console.log("FAIL: " + name + ": " + error.message.split("\n")[0]); }
}
function boot({ before = "", language = "en", auto = true, domLanguage = "zh-CN" } = {}) {
  const context = vm.createContext({ scripts, language, auto, domLanguage });
  vm.runInContext(`
    this.window = this;
    this.listeners = {}; this.domListeners = {}; this.timers = []; this.loads = []; this.writes = 0;
    function node(id) {
      return { id: id, className:'hidden', tagName:'BUTTON', style:{}, attributes:{},
        getAttribute:function(k){return Object.prototype.hasOwnProperty.call(this.attributes,k)?this.attributes[k]:null;},
        setAttribute:function(k,v){this.attributes[k]=v;} };
    }
    this.status = node('status'); this.body = node('body'); this.banner=null; body.insertBefore=function(n){banner=n;};
    this.settings = node('settingsModal'); this.skills = node('skillsModal');
    this.comic = node('comicPanelSection'); this.turnaround = node('turnaroundSection');
    this.tabs = ['single','comic','turnaround'].map(function(mode){var x=node(mode);x.className='mode-tab';x.attributes['data-mode']=mode;return x;});
    this.descriptors = scripts.map(function(src){var x=node('script');x.attributes['data-src']=src+'?v=contract-test';return x;});
    this.saved = {ai_image_gen_language:language, config:'unchanged', history:'unchanged'};
    this.localStorage = {getItem:function(k){return saved[k]||null;},setItem:function(){writes++;},removeItem:function(){writes++;},clear:function(){writes++;}};
    this.document = {
      currentScript: auto ? {getAttribute:function(){return '';}} : null,
      documentElement:{lang:domLanguage}, body:body,
      head:{appendChild:function(script){loads.push(script);}},
      createElement:function(tag){return tag==='template'?{content:{}}:node('');},
      querySelector:function(selector){return ({'#ai-gen-runtime-status':banner,'#status':status,'#settingsModal':settings,'#skillsModal':skills,'#comicPanelSection':comic,'#turnaroundSection':turnaround})[selector]||null;},
      querySelectorAll:function(selector){return selector.indexOf('script[')===0?descriptors:tabs;},
      addEventListener:function(k,fn){domListeners[k]=fn;}
    };
    this.addEventListener=function(k,fn){listeners[k]=fn;}; this.setTimeout=function(fn){timers.push(fn);};
    this.CSS={supports:function(){return true;}};
    this.Element=function(){}; ['closest','matches','append','remove','replaceChildren'].forEach(function(k){Element.prototype[k]=function(){};});
    this.HTMLElement=function(){}; HTMLElement.prototype.inert=false;
    this.NodeList=function(){}; NodeList.prototype.forEach=function(){};
    this.HTMLCanvasElement=function(){}; HTMLCanvasElement.prototype.getContext=function(){}; HTMLCanvasElement.prototype.toBlob=function(){};
    ['fetch','Headers','Response','FormData','AbortController','Blob','FileReader','TextDecoder','URL','URLSearchParams','CustomEvent','MutationObserver','requestAnimationFrame','queueMicrotask'].forEach(function(k){window[k]=function(){};});
    Headers.prototype.entries=function(){}; FormData.prototype.entries=function(){};
    ['blob','arrayBuffer','text'].forEach(function(k){Response.prototype[k]=Blob.prototype[k]=function(){};});
    URL.createObjectURL=function(){}; URL.revokeObjectURL=function(){};
    this.navigator={};
  `, context);
  vm.runInContext(before, context);
  vm.runInContext(source, context, { filename: file });
  return context;
}

test("entire guard parses as ES5, not merely current Node syntax", () => {
  acorn().parse(source, { ecmaVersion: 5 });
  assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/);
});
test("adequate engine loads original scripts sequentially, once, without taking app ready ownership", () => {
  const c = boot();
  assert.equal(c.__AI_GEN_RUNTIME.supported, true);
  assert.equal(c.loads.length, 1);
  for (let i = 0; i < scripts.length; i++) {
    assert.equal(c.loads.length, i + 1);
    assert.equal(c.loads[i].src, scripts[i] + "?v=contract-test");
    assert.equal(c.loads[i].async, false);
    c.loads[i].onload();
  }
  assert.equal(c.__AI_GEN_RUNTIME.state, "loaded");
  assert.equal(c.__AI_GEN_APP_READY, false);
  c.__AI_GEN_APP_READY = true; c.listeners["ai-generator-ready"]();
  assert.equal(c.__AI_GEN_RUNTIME.state, "ready");
  assert.equal(c.AiGenRuntime.start(), true); assert.equal(c.loads.length, 8);
  c.status.textContent = "app-owned"; c.timers[0](); assert.equal(c.status.textContent, "app-owned");
});
test("every required callable is a negative gate before any app script insertion", () => {
  const match = source.match(/var methods = (\[[\s\S]*?\]);/);
  assert.ok(match, "required API contract exists");
  const methods = vm.runInNewContext(match[1]);
  for (const method of methods) {
    const c = boot({ before: `${method}=undefined;` });
    assert.equal(c.__AI_GEN_RUNTIME.state, "unsupported", method);
    assert.ok(Array.from(c.__AI_GEN_RUNTIME.missing).includes(method), method);
    assert.equal(c.loads.length, 0, method);
    assert.equal(c.__AI_GEN_APP_READY, false);
    assert.equal(c.writes, 0);
  }
});
test("DOM/CSS/globalThis gaps block; Android OS and spoofed UA do not decide support", () => {
  for (const before of ["CSS=undefined;", "delete HTMLElement.prototype.inert;", "globalThis=undefined;",
    "var create=document.createElement; document.createElement=function(tag){return tag==='template'?{}:create(tag);};"]) {
    const c = boot({ before }); assert.equal(c.__AI_GEN_RUNTIME.state, "unsupported"); assert.equal(c.loads.length, 0);
  }
  const c = boot({ before: "navigator.userAgent='Android 7; Chrome/60.0';" });
  assert.equal(c.__AI_GEN_RUNTIME.supported, true);
});
test("unsupported notice is immediate and actionable in five saved languages, stays after timeout", () => {
  for (const [language, prefix] of [["zh-CN","当前内置浏览器"],["zh-Hant","目前內建瀏覽器"],["en","This embedded browser"],["ja","内蔵ブラウザー"],["ko","내장 브라우저"]]) {
    const c = boot({ language, before: "Array.prototype.at=undefined;" });
    assert.ok(c.banner.textContent.startsWith(prefix));
    assert.ok(c.banner.textContent.includes("Array.prototype.at"));
    assert.ok(c.banner.textContent.includes("WebView2 Runtime"));
    assert.equal(c.banner.attributes.role, "alert");
    assert.equal(c.__AI_GEN_STARTUP_ERRORS[0], c.banner.textContent, "native health error retains localized action");
    const message = c.banner.textContent; c.timers[0](); assert.equal(c.banner.textContent, message);
    assert.equal(c.writes, 0); assert.equal(c.saved.config, "unchanged"); assert.equal(c.saved.history, "unchanged");
  }
});
test("language aliases and blocked localStorage retain readable DOM-language fallback", () => {
  const c = boot({ language: "en-GB", before: "fetch=undefined;" });
  assert.match(c.banner.textContent, /^This embedded browser/);
  const d = boot({ domLanguage: "zh-TW", before: "fetch=undefined; Object.defineProperty(window,'localStorage',{get:function(){throw Error('blocked');}});" });
  assert.match(d.banner.textContent, /^目前內建瀏覽器/);
});
test("optional storage, crypto, SW, decompression, viewport and clipboard do not deny startup", () => {
  const c = boot({ before: "CSS.supports=function(k){return k!=='content-visibility'&&k!=='height'&&k.indexOf('selector')!==0;}; Object.defineProperty(window,'indexedDB',{get:function(){throw Error('denied');}});" });
  assert.equal(c.__AI_GEN_RUNTIME.supported, true); assert.equal(c.loads.length, 1);
  for (const value of Object.values(c.__AI_GEN_RUNTIME.optional)) assert.equal(value, false);
});
test("bad/missing manifest never loads a prefix, supports no alternate origin or inline payload", () => {
  for (const before of ["descriptors.pop();", "descriptors[1].attributes['data-src']='https://other.example/x.js';",
    "descriptors[0].attributes.src='image-task-stability.js';", "descriptors.reverse();",
    "descriptors[0].attributes['data-src']='image-task-stability.js?v=x#fragment';"]) {
    const c = boot({ before }); assert.equal(c.loads.length, 0); assert.equal(c.__AI_GEN_RUNTIME.state, "error");
    assert.equal(c.AiGenRuntime.start(), false);
  }
});
test("resource/parse/rejection failures stop the loader and retain error/timeout fallback", () => {
  const c = boot(); c.loads[0].onerror(); assert.equal(c.loads.length, 1); assert.equal(c.__AI_GEN_RUNTIME.state, "error");
  assert.match(c.status.textContent, /Script load failed/);
  const d = boot(); d.listeners.error({error:new SyntaxError("synthetic syntax failure")}); d.loads[0].onload();
  assert.equal(d.loads.length, 1); assert.match(d.status.textContent, /synthetic syntax failure/);
  const e = boot(); e.listeners.unhandledrejection({reason:new Error("synthetic rejection")});
  assert.match(e.status.textContent, /synthetic rejection/);
  const f = boot({ auto: false }); f.timers[0](); assert.match(f.status.textContent, /timed out/);
  for (let i = 0; i < 20; i++) f.listeners.error({message:"failure-"+i});
  assert.equal(f.__AI_GEN_STARTUP_ERRORS.length, 10); f.timers[0](); assert.match(f.status.textContent, /failure-19$/);
});
test("legacy fallback controls work without closest/classList, and relinquish ready-app clicks", () => {
  const c = boot({ before: "Element.prototype.closest=undefined;" });
  let prevented = 0;
  function click(target) { c.domListeners.click({target,preventDefault(){prevented++;}}); }
  click({parentNode:{tagName:"BUTTON",id:"settingsBtn"}}); assert.doesNotMatch(c.settings.className, /hidden/);
  click({tagName:"BUTTON",id:"closeSettings"}); assert.match(c.settings.className, /hidden/);
  click({tagName:"BUTTON",id:"skillsBtn"}); assert.doesNotMatch(c.skills.className, /hidden/);
  click({tagName:"BUTTON",id:"closeSkills"}); assert.match(c.skills.className, /hidden/);
  click(c.tabs[1]); assert.equal(c.tabs[1].attributes["aria-selected"], "true"); assert.doesNotMatch(c.comic.className, /hidden/);
  c.__AI_GEN_APP_READY = true; const count = prevented; click({tagName:"BUTTON",id:"settingsBtn"}); assert.equal(prevented, count);
});
const paintFixture = `
  this.paint=node('studio-startup-status');paint.className='';
  document.documentElement.className='studio-starting';
  document.documentElement.setAttribute=function(k,v){this[k]=v;};
  var originalQuery=document.querySelector;
  document.querySelector=function(s){return s==='#studio-startup-status'?paint:originalQuery(s);};
`;
test("core ready never releases first paint; shell ready does, without storage writes", () => {
  const c=boot({before:paintFixture});
  c.__AI_GEN_APP_READY=true;c.listeners['ai-generator-ready']();
  assert.equal(c.__AI_GEN_UI_READY,false);
  assert.match(c.document.documentElement.className,/studio-starting/);
  c.StudioShell={};c.listeners['studio-shell-ready']();
  assert.equal(c.__AI_GEN_UI_READY,true);
  assert.doesNotMatch(c.document.documentElement.className,/studio-starting/);
  assert.match(c.paint.className,/hidden/);assert.equal(c.writes,0);
});
test("slow shell timeout stays visible without flashing legacy UI, and late ready recovers", () => {
  const c=boot({before:paintFixture});c.__AI_GEN_APP_READY=true;
  c.timers[0]();assert.match(c.paint.textContent,/timed out/);
  assert.match(c.document.documentElement.className,/studio-starting/);
  c.StudioShell={};c.listeners['studio-shell-ready']();c.timers[0]();
  assert.equal(c.__AI_GEN_UI_READY,true);assert.match(c.paint.className,/hidden/);
});
test("load failure after core ready still releases a readable fallback; no stuck gate", () => {
  const c=boot({before:paintFixture});c.__AI_GEN_APP_READY=true;
  c.loads[0].onerror();
  assert.equal(c.__AI_GEN_PRESENTATION,'fallback');assert.equal(c.__AI_GEN_UI_READY,false);
  assert.doesNotMatch(c.document.documentElement.className,/studio-starting/);
  assert.match(c.paint.textContent,/Script load failed/);assert.doesNotMatch(c.paint.className,/hidden/);
  assert.equal(c.writes,0);
});
test("unsupported engines release the gate and retain their independent diagnostic", () => {
  const c=boot({before:paintFixture+'Array.prototype.at=undefined;'});
  assert.doesNotMatch(c.document.documentElement.className,/studio-starting/);
  assert.match(c.banner.textContent,/WebView2 Runtime/);assert.equal(c.loads.length,0);
});
console.log(`RESULT: ${passed}/${passed + failed} runtime checks passed`);
process.exitCode = failed ? 1 : 0;
