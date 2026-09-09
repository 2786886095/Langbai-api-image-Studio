"use strict";
// Production metadata, standalone startup fallback, and non-fatal reporting.
// Actual A7 acquisition/write catches belong to the dedicated cache suite.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const languages=['zh-CN','zh-Hant','en','ja','ko'];
function section(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,`Production section missing: ${start}`);
  return source.slice(a,b);
}
function fn(name) {
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,`Production function missing: ${name}`);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,`Production function end missing: ${name}`);
  return source.slice(start,end+2);
}
const locales=section('const UI_METADATA_LOCALES =','function applyCleanLanguage()');
for(const lang of languages) {
  const context=vm.createContext({currentLanguage:lang});vm.runInContext(locales,context);
  for(const [name,key] of [['QuotaExceededError','cacheQuota'],['SecurityError','cacheBlocked'],['NotAllowedError','cacheBlocked'],['InvalidStateError','cacheUnavailable'],['AbortError','cacheUnavailable'],['TypeError','cacheUnknown']]) {
    assert.equal(context.classifyLocalCacheFailure({name}),key);assert.ok(context.uiText(key).length>10);
  }
}
console.log('PASS: cache quota, permission, unavailable, and unknown errors have five-language messages');

function node(tag,dataset={}) {
  return {tagName:tag,dataset:{...dataset},textContent:'KEEP CONTENT',value:'KEEP USER PROMPT',title:'',attributes:{},
    setAttribute(key,value){this.attributes[key]=value;},closest(){return null;}};
}
const label=node('BUTTON',{uiLabel:'interfaceLanguage'}),hint=node('SPAN',{uiText:'skillsHint'});
const input=node('INPUT',{uiPlaceholder:'skillNamePlaceholder'});
const cacheWarning=node('DIV',{cacheFailureKey:'cacheQuota',cacheFailureDetail:'USER DETAIL'});
const retry=node('BUTTON',{cleanLabel:'retry'});retry.closest=()=>({_lastImageError:{requiresEdit:true}});
const prompt=node('TEXTAREA'),icon=node('SPAN'),filename=node('OUTPUT');
const untouched=JSON.stringify([prompt,icon,filename]);
const uiRoot={querySelectorAll(selector){
  if(selector==='[data-cache-failure-key]')return [cacheWarning];
  if(selector==='[data-clean-label]')return [retry];
  if(selector==='[data-ui-text], [data-ui-label], [data-ui-placeholder]')return [label,hint,input];
  throw new Error('Unexpected metadata selector: '+selector);
}};
const metadata=vm.createContext({currentLanguage:'en',document:uiRoot,
  cleanText:key=>'CLEAN '+metadata.currentLanguage+' '+key,
  IMAGE_ERROR_TEXT:Object.fromEntries(languages.map(lang=>[lang,{editRequired:'EDIT '+lang}]))});
vm.runInContext(locales,metadata);
for(const lang of languages) {
  metadata.currentLanguage=lang;metadata.localizeUiMetadata();
  assert.equal(label.title,metadata.uiText('interfaceLanguage'));
  assert.equal(label.attributes['aria-label'],label.title);assert.equal(label.textContent,'KEEP CONTENT');
  assert.equal(hint.textContent,metadata.uiText('skillsHint'));
  assert.equal(input.attributes.placeholder,metadata.uiText('skillNamePlaceholder'));assert.equal(input.value,'KEEP USER PROMPT');
  assert.equal(cacheWarning.textContent,metadata.uiText('cacheQuota')+' USER DETAIL');
  assert.equal(retry.title,'EDIT '+lang);assert.equal(retry.attributes['aria-label'],'CLEAN '+lang+' retry');
  for(const n of [label,hint,input,cacheWarning,retry])assert.ok(Object.hasOwn(n.dataset,'noI18n'));
  assert.equal(JSON.stringify([prompt,icon,filename]),untouched);
}
console.log('PASS: semantic metadata relocalizes in five languages without replacing prompts, filenames, or icons');

const guard=fs.readFileSync(path.join(root,'bootstrap-guard.js'),'utf8');
for(const [lang,prefix] of [['zh-CN','程序初始化失败：'],['zh-Hant','程式初始化失敗：'],['en','App initialization failed: '],['ja','アプリの初期化に失敗しました：'],['ko','앱 초기화 실패: ']]) {
  const status={classList:{remove(){},add(){}}};let timeout;
  const context={window:{localStorage:{getItem:()=>lang}},document:{documentElement:{lang:'zh-CN'},addEventListener(){},querySelector:()=>status},addEventListener(){},setTimeout:callback=>{timeout=callback;}};
  vm.runInNewContext(guard,context);context.window.__AI_GEN_STARTUP_ERRORS.push('SYNTHETIC_STARTUP_ERROR');timeout();
  assert.equal(status.textContent,prefix+'SYNTHETIC_STARTUP_ERROR');
  context.window.__AI_GEN_STARTUP_ERRORS.length=0;timeout();assert.ok(status.textContent.length>20);
  const before=status.textContent;context.window.__AI_GEN_APP_READY=true;timeout();assert.equal(status.textContent,before);
}
console.log('PASS: independent startup guard respects saved language before core app initialization');

// Execute the actual reporter/classifiers, not a substring of a removed catch.
// Only presentation/capacity I/O is stubbed; generation/persistence calls fail.
const a7Text=section('const A7_CACHE_RECOVERY_TEXT =','const A7_CACHE_LIMITS =');
for(const lang of languages) {
  const original={bytes:'UNCHANGED ORIGINAL'},image={url:'cache://fixture',prompt:'KEEP PROMPT',panelId:'3'};
  const card={dataset:{status:'success'},_zipImage:image,_zipBlob:original,_a7CacheOriginalBlob:original,isConnected:false};
  let notices=0,renders=0,capacity=0;
  const unexpected=()=>{throw new Error('Reporting must not regenerate, retry, or persist');};
  const context=vm.createContext({currentLanguage:lang,
    a7CacheNotice:c=>{assert.equal(c,card);notices++;},a7CacheRender:c=>{assert.equal(c,card);renders++;},
    a7CacheRefreshCapacity:()=>{capacity++;return Promise.resolve();},callImageAPI:unexpected,
    retryResultCard:unexpected,markPlaceholderFailed:unexpected,putGeneratedCacheBlob:unexpected,saveHistory:unexpected});
  vm.runInContext(a7Text+'\n'+fn('a7CacheText')+'\n'+fn('a7CacheFailureKey')+'\n'+fn('a7CacheReportFailure'),context);
  for(const [name,key] of [['QuotaExceededError','quota'],['SecurityError','blocked'],['NotAllowedError','blocked'],['Error','failed']]) {
    const result=context.a7CacheReportFailure(card,Object.assign(new Error('synthetic '+name),{name}));
    assert.equal(result,undefined); // reporter is synchronous; acquisition catch owns null
    assert.equal(card.dataset.status,'success');assert.equal(card.dataset.cacheStatus,'failed');
    assert.equal(card.dataset.cacheFailureReason,key);assert.equal(card._a7CacheFailureKey,key);
    assert.equal(card._zipImage,image);assert.equal(image.url,'cache://fixture');assert.equal(image.prompt,'KEEP PROMPT');
    assert.equal(card._zipBlob,original);assert.equal(card._a7CacheOriginalBlob,original);
    assert.equal(image.cacheWarning,context.a7CacheText(key));assert.ok(image.cacheWarning.length>10);
  }
  assert.equal(notices,4);assert.equal(renders,4);assert.equal(capacity,4);
  if(lang==='en')assert.match(context.a7CacheText('quota'),/original image remains/);
}
console.log('PASS: actual A7 failure reporter remains non-fatal, classified and translated; completed images/original bytes survive without regeneration');

for(const lang of languages) {
  const messages=[],writes=[],original={type:'comic-project',createdAt:'2026-09-09',images:[]};let pruneCalls=0;
  const context=vm.createContext({currentLanguage:lang,console:{warn(){}},HISTORY_KEY:'synthetic-history',
    loadSettings:()=>({historyLimit:100}),isHistoryProject:()=>true,getHistoryThumbnail:()=>'',
    safeStorageSetItem:(key,value)=>{writes.push({key,value});return false;},compactHistoryItem:x=>x,
    scheduleHistoryBlobPrune:()=>{pruneCalls++;},showStatus:message=>messages.push(message)});
  vm.runInContext(locales+'\n'+fn('saveHistory'),context);
  assert.doesNotThrow(()=>context.saveHistory([original]));assert.equal(writes.length,2);assert.equal(pruneCalls,0);
  assert.deepEqual(messages,[context.uiText('historyWriteFailed')]);
  assert.deepEqual(original,{type:'comic-project',createdAt:'2026-09-09',images:[]});
  if(lang==='en')assert.equal(messages[0],'Image generated, but history could not be saved. The current image is still available to download.');
}
console.log('PASS: history write failure remains non-fatal and translated after both write attempts');

// A7 history persistence must reuse acquired original bytes after quota failure.
// Production callers pass Promise<Blob>; re-fetching an expired URL loses history.
(async function verifyHistoryBlobRecovery() {
  const bytes = Buffer.from('original-image-bytes\0do-not-transform', 'utf8');
  const original = new Blob([bytes], { type: 'image/png' });
  const dataUrl = 'data:image/png;base64,' + bytes.toString('base64');
  for (const cacheKind of ['history', 'generated']) {
    for (const inputKind of ['blob', 'promise', 'fetch']) {
      let fetches = 0, writes = 0, encodes = 0;
      const quota = Object.assign(new Error('synthetic quota'), { name: 'QuotaExceededError' });
      const persist = async (_key, blob) => {
        writes++;
        assert.equal(blob, original);
        throw quota;
      };
      const context = vm.createContext({
        Blob, console: { warn() {} },
        sanitizeFilePart: value => value,
        getGeneratedCacheBlob: async () => null,
        putGeneratedCacheBlob: persist, putHistoryBlob: persist,
        imageUrlToBlob: async () => {
          fetches++;
          if (inputKind !== 'fetch' || fetches > 1) throw new Error('original URL expired');
          return original;
        },
        blobToDataUrl: async blob => {
          encodes++;
          assert.equal(blob, original);
          assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
          return dataUrl;
        },
      });
      vm.runInContext('async ' + fn('makeHistoryImageUrl'), context);
      const cached = inputKind === 'blob' ? original : inputKind === 'promise' ? Promise.resolve(original) : null;
      const value = await context.makeHistoryImageUrl('https://expired.invalid/original.png', cached, 'history-fixture', cacheKind === 'generated' ? 'generated-fixture' : '');
      assert.equal(value, dataUrl, cacheKind + '/' + inputKind + ': original bytes survive write failure');
      assert.equal(writes, 1);
      assert.equal(encodes, 1);
      assert.equal(fetches, inputKind === 'fetch' ? 1 : 0, 'no second network acquisition');
    }
  }
  const forbidden = () => { throw new Error('existing cache URI must remain untouched'); };
  const context = vm.createContext({ Blob, imageUrlToBlob: forbidden, putHistoryBlob: forbidden, console: { warn: forbidden } });
  vm.runInContext('async ' + fn('makeHistoryImageUrl'), context);
  for (const uri of ['idb://existing', 'cache://existing', '']) assert.equal(await context.makeHistoryImageUrl(uri), uri);
  console.log('PASS: history/generated quota fallback reuses Blob, Promise<Blob>, and fetched originals without re-fetch; existing cache URIs preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
