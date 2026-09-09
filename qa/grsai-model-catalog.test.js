"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const input = process.argv[2] || path.join(__dirname, "../app.js");
const source = fs.readFileSync(input, "utf8");
const start = source.indexOf("const GRSAI_GPT_IMAGE_MODELS");
const end = source.indexOf("function loadOfficialModels", start);
assert.ok(start > 0 && end > start);
const storage = new Map();
const dom = { model: { value: "gpt-image-2", placeholder: "" }, apiProvider: {value:"grsai"}, apiEndpoint:{value:"https://grsai.dakka.com.cn/v1/api/generate"} };
let rows = [], requests = [], status = "";
const ctx = vm.createContext({dom, console, Date, Object, Number, String, JSON, Map, Set,
  safeStorageReadJson: (key, fallback) => storage.has(key) ? JSON.parse(storage.get(key)) : fallback,
  safeStorageSetItem: (key, value) => storage.set(key, value),
  updateApiQuickState: () => {},
  showStatus: text => { status = text; },
  currentLanguage: "zh",
  apiConfigApplySequence: 0,
});
vm.runInContext(source.slice(start, end), ctx);
ctx.capture = models => { rows = Array.from(models); };
vm.runInContext("setModelChoices = models => { capture(models); return models; }", ctx);
async function run() {
  vm.runInContext("loadGrsaiModels()", ctx);
  assert.equal(dom.model.value, "gpt-image-2", "loading the GrsAI list must preserve the current model");
  assert.ok(rows.includes("gpt-image-2.5"), "offline catalog includes verified new models");
  const response = {code:0, data:{list:[
    {name:"gpt-image-2.5",type:"image",cost:600},
    {name:"future-image-model",type:"image",cost:100},
    {name:"future-image-model",type:"image",cost:100},
    {name:"text-only",type:"text",cost:5},
    {name:"video-only",type:"video",cost:5},
  ]}};
  ctx.smartFetch = async (url, options) => {
    requests.push({url,options});
    return {ok:true,json:async()=>response};
  };
  await vm.runInContext("refreshGrsaiModels()", ctx);
  assert.ok(rows.includes("future-image-model"));
  assert.ok(!rows.includes("text-only") && !rows.includes("video-only"));
  assert.equal(rows.filter(x=>x==="future-image-model").length, 1);
  assert.equal(dom.model.value,"gpt-image-2");
  assert.equal(requests.length,1);
  assert.equal(requests[0].options.headers.Authorization,undefined);
  assert.equal(requests[0].options.body,"{}");
  assert.ok(status.includes("在线"));
  assert.equal(vm.runInContext('priceLabel("gpt-image-2.5")',ctx)," · 600 积分/次");
  ctx.smartFetch = async () => { throw new Error("offline fixture"); };
  await vm.runInContext("refreshGrsaiModels()",ctx);
  assert.ok(rows.includes("future-image-model"));
  assert.ok(status.includes("刷新失败"));
  assert.equal(dom.model.value,"gpt-image-2");
  ctx.smartFetch = async () => ({ok:true,json:async()=>({code:0,data:{list:[{name:"text",type:"text"}]}})});
  await vm.runInContext("refreshGrsaiModels()",ctx);
  assert.ok(rows.includes("future-image-model"),"invalid response must not erase cached models");
  let complete;
  ctx.smartFetch = () => new Promise(resolve=>{complete=resolve;});
  const pending=vm.runInContext("refreshGrsaiModels()",ctx);
  dom.apiProvider.value="official";
  dom.model.value="official-user-model";
  rows=["official-user-model"];
  complete({ok:true,json:async()=>response});
  await pending;
  assert.deepEqual(rows,["official-user-model"],"late refresh must not replace another provider's list");
  assert.equal(dom.model.value,"official-user-model");
  dom.apiProvider.value="grsai";
  dom.model.value="my-custom-image";
  vm.runInContext("loadGrsaiModels()",ctx);
  assert.ok(rows.includes("my-custom-image"));
  assert.equal(dom.model.value,"my-custom-image");
  assert.ok(!JSON.stringify([...storage]).includes("Authorization"));
  console.log("PASS: live catalog, offline catalog, filtering, prices, preserved selection, failed refresh and provider race");
}
run().catch(error=>{console.error(error.message); process.exitCode=1;});
