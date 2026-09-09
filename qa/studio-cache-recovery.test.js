"use strict";
// No npm dependencies, network, real account, generation endpoint, or user storage.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const defaultRoot = path.join(__dirname, "..");
const root = path.resolve(process.argv[2] || defaultRoot);
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const errorNamed = name => Object.assign(new Error(name), {name});
const hash = async blob => createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex");

function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `production section missing: ${start}`);
  return source.slice(a,b);
}

function productionSlices(source = app) {
  const start = source.indexOf("// A7 CACHE RECOVERY START"), end = source.indexOf("// A7 CACHE RECOVERY END", start);
  return {
    recovery: start < 0 ? "" : source.slice(start, end),
    card: section(source, "function replacePlaceholder(", "function retryContextProvider("),
    writer: section(source, "async function putGeneratedCacheBlob(", "async function getGeneratedCacheBlob("),
    opener: section(source, "function openHistoryBlobDb()", "async function putHistoryBlob("),
    classifier: section(source, "function classifyLocalCacheFailure(", "function localizeUiMetadata("),
    filename: section(source, "function sanitizeFilePart(", "function makeUniqueArchiveName("),
    extension: section(source, "function imageExtFromBlob(", "function getZipCrcTable("),
    registry: section(source, "const RESULT_PAGE_SIZE =", "function clearAllResultCards("),
  };
}

class Element {
  constructor(tag = "div") {
    this.tagName=tag.toUpperCase(); this.dataset={}; this.style={}; this.children=[];
    this.attributes={}; this.listeners={}; this.className=""; this.textContent="";
    this.classList={
      contains: cls => this.className.split(/\s+/).includes(cls),
      add: (...classes) => { this.className=[...new Set([...this.className.split(/\s+/),...classes])].join(" ").trim(); },
      remove: (...classes) => { this.className=this.className.split(/\s+/).filter(c=>!classes.includes(c)).join(" "); },
      toggle: (cls, enabled) => { const next=enabled??!this.classList.contains(cls); next?this.classList.add(cls):this.classList.remove(cls); return next; }
    };
  }
  get isConnected() { return this.tagName === "BODY" || !!this.parentNode?.isConnected; }
  get lastElementChild() { return this.children.at(-1); }
  contains(node) { return this === node || this.children.some(child=>child.contains(node)); }
  set innerHTML(value) { for (const child of this.children) child.parentNode=null; this.children=[]; this._html=value; }
  get innerHTML() { return this._html || ""; }
  append(...children) { for(const child of children) this.appendChild(child); }
  appendChild(child) { child.parentNode=this; this.children.push(child); return child; }
  remove() { if(this.parentNode) this.parentNode.children=this.parentNode.children.filter(n=>n!==this); this.parentNode=null; }
  setAttribute(name,value) { this.attributes[name]=String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name,fn) { (this.listeners[name] ||= []).push(fn); }
  click() { if(this.disabled) return; for(const fn of this.listeners.click || []) fn({preventDefault(){},stopPropagation(){}}); }
  matches(selector) {
    if(selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if(selector.startsWith("[data-")) {
      const [,key,value]=selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/)||[];
      const camel=key?.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
      return Object.hasOwn(this.dataset,camel) && (value===undefined || this.dataset[camel]===value);
    }
    return this.tagName===selector.toUpperCase();
  }
  querySelectorAll(selector) { return this.children.flatMap(child=>[...(selector.split(/,\s*/).some(s=>child.matches(s))?[child]:[]),...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function harness({quota = false, blocked = false, timeoutScale = 1} = {}) {
  const body=new Element("body");
  const document={body,createElement:tag=>new Element(tag),querySelectorAll:selector=>body.querySelectorAll(selector)};
  const state={quota,blocked,downloads:0,api:0,writes:0,transactions:0,aborts:0,saves:0,saved:[],logs:[],unhandled:[],timers:new Set()};
  const original=new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,254,255,42,7,128,3])], {type:"image/png"});
  state.original=original;
  const db={transaction() {
    state.transactions++;
    const tx={objectStore:store=>({put(value,key) {
      if(state.quota) throw errorNamed("QuotaExceededError");
      if(store==="generated_cache") { state.writes++; state.persisted=value.blob; state.key=key; }
    }}),abort() { state.aborts++; tx.aborted=true; queueMicrotask(()=>tx.onabort?.()); }};
    state.lastTx=tx;
    if(!state.hangTransaction) queueMicrotask(()=>{ if(!tx.aborted) tx.oncomplete?.(); });
    return tx;
  }};
  const context=vm.createContext({
    Blob,AbortController,DOMException,Error,queueMicrotask,URL:{createObjectURL:()=>"blob:qa-original",revokeObjectURL(){}},
    setTimeout:(fn,ms)=>{ const timer=setTimeout(()=>{state.timers.delete(timer);fn();},Math.max(1,ms*timeoutScale)); state.timers.add(timer);return timer; },
    clearTimeout:timer=>{ clearTimeout(timer);state.timers.delete(timer); },
    document,navigator:{storage:{estimate:async()=>({usage:10,quota:1000})}},console:{warn:(...x)=>state.logs.push(x)},
    currentLanguage:"en",currentMode:"single",referenceImages:[],generatedImageUrls:[],
    dom:{model:{value:"fixture-model"},apiEndpoint:{value:"https://generation.invalid"},resultGrid:body},
    // This adapter controls attachment only. Membership/liveness/registration
    // execute the actual production registry functions, including retired leases.
    renderResultWindow(){},
    tr:value=>value,cleanText:value=>value,uiText:key=>key,
    setRetryContext:(card,panelId,value)=>{card._retryContext={...value,panelId};},
    setButtonText:(node,icon,key)=>{node.textContent=key;},renderOpenCodexResultMeta(){},
    inferImageMimeFromBase64:()=>"image/png",sanitizeHistoryOriginalUrl:value=>value,
    getPanelOnlyPrompt:source=>source.prompt||"",serializableReferences:refs=>refs,
    buildOfficialBilling:()=>null,normalizeOfficialUsage:()=>null,renderResultBilling(){},
    makeCardActionBtn:(icon,key,fn)=>{const el=new Element("button");el.addEventListener("click",fn);return el;},
    getSelectedSize:()=>"1024x1024",getGlobalRetryCount:()=>2,setResultReviewState(){},updateFailedRetryTools(){},
    saveGenerationRecord:()=>{throw Error("Unexpected history save");},
    retryResultCard:()=>{state.api++;throw Error("Generation must never be called");},
    fetch:()=>{state.api++;throw Error("Unexpected fetch");},
    showStatus:(...x)=>state.logs.push(x),cleanupGeneratedImageCache:async()=>0,
    imageUrlToBlobWithFallback:async()=>{state.downloads++;return original;},
    getGeneratedCacheBlob:async()=>original,
    openHistoryBlobDb:async()=>{if(state.blocked) throw errorNamed("SecurityError");return db;},
    GENERATED_CACHE_STORE:"generated_cache",GENERATED_CACHE_META_STORE:"generated_cache_meta",
    saveOrDownloadBlob:async(blob,filename,type,kind)=>{
      state.saves++; if(state.saveFailure) throw state.saveFailure;
      if(state.saveDeferred) await state.saveDeferred.promise;
      state.saved.push({blob,filename,type,kind});
    },
  });
  const parts=productionSlices();
  vm.runInContext(Object.entries(parts).filter(([name])=>name!=="opener").map(([,value])=>value).join("\n"),context);
  const registry=vm.runInContext("resultWindowState",context);
  const newCard=()=>{
    const card=new Element();card.className="result-item";
    context.registerResultCard(card);body.appendChild(card);
    assert.ok(context.getAllResultCards().includes(card));
    assert.ok(registry.members.has(card));
    return card;
  };
  async function generate() {
    const card=newCard();
    const record=context.replacePlaceholder(card,"7",{data:[{url:"https://images.invalid/original.png"}]},"KEEP PROMPT",{skipHistory:true});
    await card._imageCachePromise;
    await card._a7CacheRetryPromise?.catch(()=>{});
    await tick();
    return {card,record};
  }
  return {context,state,db,document,registry,newCard,generate,dispose(){for(const t of state.timers)clearTimeout(t);}};
}

async function main() {
  let failed=0,passed=0;
  const cases=[];
  const test=(name,run)=>cases.push({name,run});
  const using=async(options,run)=>{const h=harness(options);try{await run(h);}finally{h.dispose();}};

  test("capacity hook and dedicated semantic module exist",()=>{
    assert.match(html,/id="a7CacheCapacityStatus"[^>]*data-a7-cache-capacity/);
    assert.ok(productionSlices().recovery.includes("navigator?.storage"));
    const language=section(app,"function applyLanguage(","function refreshLocalizedFormMetadata(");
    assert.match(language,/refreshLocalizedFormMetadata\(\);\s*(?:refreshI18nBindings\(\);\s*)?a7CacheLocalize\(\)/);
  });
  test("quota keeps successful card and byte-identical original available",()=>using({quota:true},async h=>{
    const {card,record}=await h.generate();
    assert.equal(card.dataset.status,"success"); assert.equal(card.classList.contains("is-failed"),false);
    assert.equal(card._zipBlob,h.state.original,"fetched bytes were discarded on quota failure");
    assert.equal(await card._imageCachePromise,h.state.original);
    assert.equal(card._zipImage.url,"https://images.invalid/original.png");
    assert.equal(record.prompt,"KEEP PROMPT"); assert.equal(card.dataset.cacheStatus,"failed");
    assert.equal(card.querySelector(".result-cache-recovery")!==null,true);
    assert.equal(h.state.api,0); assert.equal(h.state.downloads,1);
  }));
  test("blocked cache stays separate from generation and preview failure",()=>using({blocked:true},async h=>{
    const {card}=await h.generate();
    assert.equal(card.dataset.status,"success"); assert.equal(card.dataset.cacheFailureReason,"blocked");
    assert.equal(card._zipBlob,h.state.original); assert.ok(!card.dataset.failed);
    assert.ok(!card.querySelector(".result-media").classList.contains("is-error"));
  }));
  test("retry failure rejects; next retry succeeds without fetch or generation",()=>using({quota:true},async h=>{
    const {card,record}=await h.generate(); const before=JSON.stringify(record);
    await assert.rejects(h.context.a7CacheRetryLocal(card),{name:"QuotaExceededError"});
    assert.equal(card.dataset.cacheStatus,"failed");
    h.state.quota=false;
    assert.equal(await h.context.a7CacheRetryLocal(card),h.state.original);
    assert.equal(card.dataset.cacheStatus,"cached"); assert.equal(card._zipImage.cacheWarning,undefined);
    assert.equal(JSON.stringify(record),before); assert.equal(await hash(h.state.persisted),await hash(h.state.original));
    assert.equal(h.state.downloads,1); assert.equal(h.state.api,0);
  }));
  test("concurrent retry calls share one transaction and promise",()=>using({quota:true},async h=>{
    const {card}=await h.generate(); h.state.quota=false;
    const before=h.state.transactions;
    const a=h.context.a7CacheRetryLocal(card),b=h.context.a7CacheRetryLocal(card);
    assert.equal(a,b); await a;
    assert.equal(h.state.transactions-before,1); assert.equal(card._a7CacheRetryPromise,null);
  }));
  test("cache button is local-only and export button emits exact original bytes",()=>using({quota:true},async h=>{
    const {card}=await h.generate();
    const retry=card.querySelector('[data-a7-cache-action="retry"]');
    const exp=card.querySelector('[data-a7-cache-action="export"]');
    assert.equal(retry.textContent,"Retry local caching only"); assert.equal(exp.textContent,"Export now");
    retry.click(); retry.click(); await card._a7CacheRetryPromise.catch(()=>{});
    exp.click(); exp.click(); await card._a7CacheExportOperation.promise; await tick();
    assert.equal(h.state.saves,1); assert.equal(await hash(h.state.saved[0].blob),await hash(h.state.original));
    assert.equal(h.state.saved[0].filename,"panel-7.png");
    assert.equal(h.state.api,0); assert.equal(h.state.downloads,1); assert.equal(card.dataset.status,"success");
  }));
  test("export does not wait for a hanging persistence retry",()=>using({quota:true},async h=>{
    const {card}=await h.generate(); h.state.quota=false;h.state.hangTransaction=true;
    const retry=h.context.a7CacheRetryLocal(card); const rejection=assert.rejects(retry,{name:"AbortError"});
    await h.context.a7CacheExportNow(card);
    assert.equal(h.state.saved[0].blob,h.state.original);
    card._a7CacheRetryController.abort(errorNamed("AbortError")); await rejection;
    assert.equal(card.dataset.status,"success");
  }));
  test("save errors are visible and reject, then export can be retried",()=>using({quota:true},async h=>{
    const {card}=await h.generate();h.state.saveFailure=errorNamed("NotAllowedError");
    await assert.rejects(h.context.a7CacheExportNow(card),{name:"NotAllowedError"}); await tick();
    assert.equal(card._a7CacheExportStatus,"exportFailed");
    assert.match(card.querySelector(".a7-cache-export-status").textContent,/Export failed/);
    h.state.saveFailure=null;await h.context.a7CacheExportNow(card);
    assert.equal(h.state.saves,2);assert.equal(h.state.api,0);assert.equal(h.state.downloads,1);
  }));
  test("native export timeout keeps lock until late save settles",()=>using({quota:true,timeoutScale:.0001},async h=>{
    const {card}=await h.generate();h.state.saveDeferred=deferred();
    const first=h.context.a7CacheExportNow(card);
    await assert.rejects(first,{name:"TimeoutError"});
    assert.equal(card._a7CacheExportStatus,"exportPending");
    assert.equal(h.context.a7CacheExportNow(card),first);assert.equal(h.state.saves,1);
    h.state.saveDeferred.reject(errorNamed("NotAllowedError"));await tick();await tick();
    assert.equal(card._a7CacheExportOperation,null);assert.equal(card._a7CacheExportStatus,"exportFailed");
    h.state.saveDeferred=null;await h.context.a7CacheExportNow(card);assert.equal(h.state.saves,2);
  }));
  test("cache timeout aborts transaction, unlocks, and next attempt is not swallowed",()=>using({quota:true,timeoutScale:.001},async h=>{
    const {card}=await h.generate();h.state.quota=false;h.state.hangTransaction=true;
    await assert.rejects(h.context.a7CacheRetryLocal(card),{name:"TimeoutError"});
    assert.ok(h.state.aborts>=1);assert.equal(card._a7CacheFailureKey,"timeout");assert.equal(card._a7CacheRetryPromise,null);
    h.state.hangTransaction=false;await h.context.a7CacheRetryLocal(card);
    assert.equal(card.dataset.cacheStatus,"cached");assert.equal(h.state.api,0);
  }));
  test("export byte wait timeout reports failure, not a pending native save",()=>using({timeoutScale:.0001},async h=>{
    const card=h.newCard();card.dataset.status="success";card._imageCachePromise=new Promise(()=>{});
    h.context.a7CacheReportFailure(card,errorNamed("Error"));
    await assert.rejects(h.context.a7CacheExportNow(card),{name:"TimeoutError"});await tick();
    assert.equal(card._a7CacheExportStatus,"exportFailed");assert.equal(card._a7CacheExportOperation,null);
    card._zipBlob=h.state.original;await h.context.a7CacheExportNow(card);assert.equal(h.state.saves,1);
  }));
  test("expired cache opener never starts a late transaction",()=>using({quota:true,timeoutScale:.001},async h=>{
    const {card}=await h.generate(); const open=deferred();h.context.openHistoryBlobDb=()=>open.promise;
    const before=h.state.transactions;
    await assert.rejects(h.context.a7CacheRetryLocal(card),{name:"TimeoutError"});
    open.resolve(h.db);await tick();assert.equal(h.state.transactions,before);
    h.state.quota=false;await h.context.a7CacheRetryLocal(card);assert.equal(card.dataset.cacheStatus,"cached");
  }));
  test("stale acquisition and retry completion cannot mutate a replacement card",()=>using({quota:true},async h=>{
    const {card}=await h.generate();const open=deferred();h.context.openHistoryBlobDb=()=>open.promise;
    const retry=h.context.a7CacheRetryLocal(card);const reject=assert.rejects(retry,{name:"AbortError"});await tick();
    h.context.releaseCardImageCache(card);card.dataset.status="loading";open.resolve(h.db);await reject;
    assert.equal(card.dataset.status,"loading");assert.equal(card.dataset.cacheStatus,undefined);
    assert.equal(card.querySelector(".result-cache-recovery"),null);
    const bytes=deferred();h.context.imageUrlToBlobWithFallback=()=>bytes.promise;
    h.context.replacePlaceholder(card,"8",{data:[{url:"https://images.invalid/new.png"}]},"NEW",{skipHistory:true});
    const pending=card._imageCachePromise;h.context.releaseCardImageCache(card);card.dataset.status="loading";
    bytes.resolve(h.state.original);await pending;
    assert.equal(card._zipBlob,null);assert.equal(card.dataset.cacheStatus,undefined);
  }));
  test("missing bytes fail visibly without re-fetch, persistence or generation",()=>using({},async h=>{
    const card=h.newCard();card.dataset.status="success";card._generatedCacheKey="missing";
    h.context.a7CacheReportFailure(card,errorNamed("Error"));
    await assert.rejects(h.context.a7CacheRetryLocal(card),{name:"NotFoundError"});
    await assert.rejects(h.context.a7CacheExportNow(card),{name:"NotFoundError"});
    assert.equal(h.state.downloads,0);assert.equal(h.state.api,0);assert.equal(h.state.writes,0);assert.equal(h.state.saves,0);
  }));
  test("capacity distinguishes unknown, zero, low, full and available; single flight",()=>using({},async h=>{
    for(const value of [null,{}, {usage:0}, {usage:null,quota:5},{usage:0,quota:undefined},{usage:0,quota:NaN},{usage:-1,quota:2},{usage:"0",quota:4}]) {
      h.context.navigator.storage.estimate=async()=>value;
      const state=await h.context.a7CacheRefreshCapacity();assert.equal(state.status,"unknown");assert.equal(state.remaining,null);
    }
    for(const [usage,quota,status] of [[0,0,"full"],[100,100,"full"],[120,100,"full"],[95,100,"low"],[0,100,"available"]]) {
      h.context.navigator.storage.estimate=async()=>({usage,quota});
      assert.equal((await h.context.a7CacheRefreshCapacity()).status,status);
    }
    let calls=0;const gate=deferred();h.context.navigator.storage.estimate=()=>{calls++;return gate.promise;};
    const a=h.context.a7CacheRefreshCapacity(),b=h.context.a7CacheRefreshCapacity();assert.equal(a,b);
    gate.resolve({usage:10,quota:100});await a;assert.equal(calls,1);
  }));
  test("unsupported, throwing, rejected and timed-out estimate stays unknown",()=>using({timeoutScale:.001},async h=>{
    h.context.navigator={};assert.equal((await h.context.a7CacheRefreshCapacity()).status,"unknown");
    h.context.navigator.storage={get estimate(){throw errorNamed("SecurityError");}};
    assert.equal((await h.context.a7CacheRefreshCapacity()).status,"unknown");
    h.context.navigator.storage={estimate:async()=>{throw errorNamed("TypeError");}};
    assert.equal((await h.context.a7CacheRefreshCapacity()).status,"unknown");
    const old=deferred();h.context.navigator.storage={estimate:()=>old.promise};
    assert.equal((await h.context.a7CacheRefreshCapacity()).status,"unknown");
    h.context.navigator.storage={estimate:async()=>({usage:10,quota:100})};await h.context.a7CacheRefreshCapacity();
    old.resolve({usage:100,quota:100});await tick();
    assert.equal(vm.runInContext("a7CacheCapacityState.status",h.context),"available");
  }));
  test("all A7 semantics relocalize in five languages without touching prompts",()=>using({quota:true},async h=>{
    const {card}=await h.generate();const prompt=card._retryContext.prompt;
    const rows=vm.runInContext("A7_CACHE_RECOVERY_TEXT",h.context);
    assert.ok(Object.values(rows).every(row=>row.length===5&&row.every(value=>typeof value==="string"&&value.length)));
    const langs=["zh-CN","zh-Hant","en","ja","ko"];
    for(let i=0;i<langs.length;i++) {
      h.context.currentLanguage=langs[i];h.context.a7CacheLocalize();
      assert.equal(card.querySelector('[data-a7-cache-action="retry"]').textContent,rows.retry[i]);
      assert.equal(card.querySelector('[data-a7-cache-action="export"]').getAttribute("aria-label"),rows.export[i]);
      assert.equal(card._retryContext.prompt,prompt);
    }
  }));
  test("existing DB blocked request resets and next local retry opens again",()=>using({quota:true},async h=>{
    const {card}=await h.generate();let opens=0,closeCount=0,request;
    Object.assign(h.context,{HISTORY_BLOB_DB:"fixture",HISTORY_BLOB_STORE:"images",GENERATED_CACHE_CREATED_AT_INDEX:"created_at",historyBlobDbPromise:null,
      indexedDB:{open(){opens++;request={};queueMicrotask(()=>request.onblocked());return request;}}});
    vm.runInContext(productionSlices().opener,h.context);
    await assert.rejects(h.context.a7CacheRetryLocal(card),/阻塞/);
    assert.equal(card.dataset.cacheFailureReason,"blocked");assert.equal(h.context.historyBlobDbPromise,null);
    request.result={close(){closeCount++;}};request.onsuccess();assert.equal(closeCount,1);
    h.state.quota=false;h.context.indexedDB.open=()=>{opens++;const req={result:h.db};queueMicrotask(()=>req.onsuccess());return req;};
    await h.context.a7CacheRetryLocal(card);assert.equal(opens,2);assert.equal(card.dataset.cacheStatus,"cached");
  }));
  test("forced preview reload never changes downloaded original or fails on quota",()=>using({quota:true},async h=>{
    const {card}=await h.generate();const original=card._zipBlob;
    h.context.imageUrlToBlobWithFallback=async()=>{h.state.downloads++;return new Blob(["different preview"],{type:"image/webp"});};
    card.querySelector(".result-media-reload").click();await card._imageCachePromise;await tick();
    assert.equal(card._zipBlob,original);
    assert.equal(card.querySelector(".result-media").classList.contains("is-error"),false);
    await h.context.a7CacheExportNow(card);assert.equal(h.state.saved[0].blob,original);assert.equal(h.state.api,0);
  }));
  test("off-page registered card receives bytes and recovery; retired card cannot revive",()=>using({quota:true},async h=>{
    const card=h.newCard(),bytes=deferred();h.context.imageUrlToBlobWithFallback=async()=>{h.state.downloads++;return bytes.promise;};
    h.context.replacePlaceholder(card,"off-page",{data:[{url:"https://images.invalid/off-page.png"}]},"OFF-PAGE PROMPT",{skipHistory:true});
    const img=card.querySelector("img");card.remove();
    assert.equal(card.isConnected,false);assert.ok(h.context.getAllResultCards().includes(card));
    assert.equal(h.context.isLiveResultNode(card,img),true);
    bytes.resolve(h.state.original);await card._imageCachePromise;await card._a7CacheRetryPromise?.catch(()=>{});
    assert.equal(img.src,"blob:qa-original");assert.equal(card._zipBlob,h.state.original);
    assert.equal(card.dataset.status,"success");assert.equal(card.dataset.cacheStatus,"failed");
    h.state.quota=false;await h.context.a7CacheRetryLocal(card);await h.context.a7CacheExportNow(card);
    assert.equal(card.dataset.cacheStatus,"cached");assert.equal(h.state.saved[0].blob,h.state.original);
    assert.equal(h.state.api,0);assert.equal(h.state.downloads,1);
    const previousImage=img;
    h.context.replacePlaceholder(card,"off-page",{data:[{url:"https://images.invalid/replacement.png"}]},"REPLACEMENT",{skipHistory:true});
    assert.equal(h.context.isLiveResultNode(card,previousImage),false);
    await card._imageCachePromise;await card._a7CacheRetryPromise?.catch(()=>{});
    h.registry.retired.add(card);h.registry.members.delete(card);h.registry.cards.splice(h.registry.cards.indexOf(card),1);
    h.context.releaseCardImageCache(card);
    assert.equal(h.context.isLiveResultNode(card,card.querySelector("img")),false);
    const downloads=h.state.downloads;
    assert.equal(h.context.replacePlaceholder(card,"retired",{data:[{url:"https://images.invalid/retired.png"}]},"RETIRED",{skipHistory:true}),undefined);
    assert.equal(h.state.downloads,downloads);assert.equal(card._zipBlob,null);
  }));
  test("global A7 localization and capacity refresh reach detached registered cards",()=>using({quota:true},async h=>{
    const {card,record}=await h.generate();card.remove();
    assert.ok(h.registry.members.has(card));assert.equal(card.isConnected,false);
    for(const language of ["zh-CN","zh-Hant","en","ja","ko"]) {
      h.context.currentLanguage=language;h.context.a7CacheLocalize();
      assert.equal(card.querySelector('[data-a7-cache-action="retry"]').textContent,h.context.a7CacheText("retry"),"off-page retry label must follow global language");
      assert.equal(card.querySelector('[data-a7-cache-action="export"]').getAttribute("aria-label"),h.context.a7CacheText("export"));
      assert.equal(record.prompt,"KEEP PROMPT");
    }
    h.context.navigator.storage.estimate=async()=>({usage:null,quota:100});await h.context.a7CacheRefreshCapacity();
    const capacity=card.querySelector("[data-a7-cache-capacity]");
    assert.equal(capacity.dataset.capacityStatus,"unknown");assert.equal(capacity.textContent,h.context.a7CacheText("capacityUnknown"));
    h.context.navigator.storage.estimate=async()=>({usage:95,quota:100});await h.context.a7CacheRefreshCapacity();
    assert.equal(capacity.dataset.capacityStatus,"low");assert.equal(capacity.textContent,h.context.a7CacheCapacityText());
    h.document.body.appendChild(card);
    assert.equal(card.querySelector('[data-a7-cache-action="retry"]').textContent,h.context.a7CacheText("retry"));
    assert.equal(h.state.api,0);assert.equal(h.state.downloads,1);
  }));

  const unhandled=[];const listener=error=>unhandled.push(error);process.on("unhandledRejection",listener);
  for(const {name,run} of cases) {
    try {await run();passed++;console.log(`PASS: ${name}`);} catch(error) {failed++;console.log(`FAIL: ${name}: ${String(error.message||error).split("\n")[0]}`);}
  }
  await tick();process.removeListener("unhandledRejection",listener);
  if(unhandled.length) {failed++;console.log(`FAIL: unhandled rejections: ${unhandled.length}`);}
  else console.log("PASS: no unhandled rejections");
  console.log(`RESULT: ${passed}/${cases.length} runtime checks passed; unhandled=${unhandled.length}; generation/API calls are forbidden by harness`);
  process.exitCode=failed?1:0;
}

module.exports={productionSlices,section};
if(require.main===module) main().catch(error=>{console.error(error);process.exitCode=1;});
