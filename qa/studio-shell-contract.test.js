"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname,"..");
const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root,"app.js");
const source = fs.readFileSync(file,"utf8");
const fn = source.slice(source.indexOf("function getFocusableElements("),source.indexOf("\nfunction clampGrsaiSubmit504RetryInterval"));
const make = (options = {}) => ({
  tabIndex:0,
  closest(selector) { return options.hidden || (options.inert && selector.includes("inert")) || (options.ariaHidden && selector.includes("aria-hidden")) ? {} : null; },
  getClientRects() { return options.noLayout ? [] : [{}]; },
  matches() { return !!options.disabled; },
  ...options,
});
const visible = make();
const elements = [visible,make({hidden:true}),make({noLayout:true}),make({inert:true}),make({ariaHidden:true}),make({disabled:true}),make({tabIndex:-1})];
const context = vm.createContext({getComputedStyle:() => ({visibility:"visible"})});
vm.runInContext(fn,context);
const actual = context.getFocusableElements({querySelectorAll:() => elements});
assert.equal(actual.length,1,"Modal focus must exclude hidden layout, inert, aria-hidden, disabled and negative-tabindex controls");
assert.equal(actual[0],visible);
assert.match(source,/if \(getTopVisibleOverlay\(\) !== modal\) return;/,"A deferred open must not focus a closed or superseded dialog");
console.log("PASS: modal focus excludes unavailable controls and stale open callbacks");
if (!process.argv[2]) {
  for(const asset of ["studio-shell.js","studio-shell.css"]) {
    for(const manifest of ["index.html","pubspec.yaml","sw.js"]) {
      assert.ok(fs.readFileSync(path.join(root,manifest),"utf8").includes(asset),`${manifest} includes ${asset}`);
    }
    assert.deepEqual(fs.readFileSync(path.join(root,asset)),fs.readFileSync(path.join(root,"android/app/src/main/assets",asset)));
  }
  assert.match(fs.readFileSync(path.join(root,"studio-shell.js"),"utf8"),/ai-generator-ready/);
  let moves=0,warnings=0;
  vm.runInNewContext(fs.readFileSync(path.join(root,"studio-shell.js"),"utf8"),{
    window:{__AI_GEN_APP_READY:true},
    document:{querySelector:selector=>selector==='#historyBtn'?null:{},createElement:()=>{moves++;throw Error('UI must remain untouched');}},
    console:{warn:()=>warnings++,error:error=>{throw error;}},
  });
  assert.equal(warnings,1);
  assert.equal(moves,0,"Missing required views must be detected before mutating the working UI");
  console.log("PASS: studio startup and Web/Flutter/Android/offline asset contracts");
}
