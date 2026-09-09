"use strict";

// Parent runner contract: await require('./studio-result-window-checks')(cdp, helpers).
// Synthetic cards/bytes only; no account, provider request, file save or screenshot.
module.exports = async function resultWindowChecks(cdp, { loadFresh, assertQa, logStep }) {
  logStep('Results: bounded DOM, ALL-card operations, original objects and late callbacks');
  await loadFresh(cdp, 'result-window', { width: 1440, height: 1000, mobile: false });
  const small = await cdp.eval(`(() => {
    dom.clearResults.click();
    dom.resultGrid.classList.remove('hidden');dom.emptyState.classList.add('hidden');
    window.__resultCards=Array.from({length:60},(_,i)=>addResultPlaceholder(i+1,'KEEP PROMPT '+i,{mode:'single',prompt:'KEEP PROMPT '+i}));
    return {attached:dom.resultGrid.querySelectorAll('.result-item').length,
      identity:__resultCards.every(c=>c.isConnected),pager:!!document.querySelector('.result-pagination')};
  })()`);
  assertQa(small.attached===60 && small.identity && !small.pager, '<=60 keeps every original card attached with no pager', small);
  console.log('[qa] <=60: PASS attached=60 identity=true pager=false');
  const many = await cdp.eval(`(() => {
    for(let i=60;i<241;i++) __resultCards.push(addResultPlaceholder(i+1,'KEEP PROMPT '+i,{mode:'single',prompt:'KEEP PROMPT '+i}));
    return {attached:dom.resultGrid.querySelectorAll('.result-item').length,
      all:typeof getAllResultCards==='function'?getAllResultCards().length:dom.resultGrid.querySelectorAll('.result-item').length};
  })()`);
  assertQa(many.attached===60 && many.all===241, '241 cards must attach only 60 and retain ALL 241', many);
  console.log('[qa] 241: PASS attached=60 all=241');

  const frame = () => cdp.eval('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',true);
  async function click(selector) {
    const box=await cdp.eval(`(()=>{
      const el=document.querySelector(${JSON.stringify(selector)});if(!el)return {missing:true};
      el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect();
      const x=r.left+r.width/2,y=r.top+r.height/2;
      return {x,y,hit:el.contains(document.elementFromPoint(x,y)),disabled:el.disabled,w:r.width,h:r.height};
    })()`);
    assertQa(box.hit&&!box.disabled&&box.w>=48&&box.h>=48,'Pager must be pointer-reachable and have 48px targets',box);
    for(const type of ['mousePressed','mouseReleased']) await cdp.send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,x:box.x,y:box.y});
    await frame();
  }
  await cdp.eval(`(()=>{
    window.__marker=document.createElement('button');__marker.textContent='fixture callback';window.__markerClicks=0;
    __marker.addEventListener('click',()=>__markerClicks++);__resultCards[0].appendChild(__marker);
    window.__allQueryApis=[Document.prototype.querySelectorAll,Element.prototype.querySelectorAll,Node.prototype.appendChild,Object.getOwnPropertyDescriptor(Node.prototype,'isConnected').get];
  })()`);
  const ids=new Set(await cdp.eval("[...dom.resultGrid.querySelectorAll('.result-item')].map(c=>c.dataset.panelId)"));
  for(let page=1;page<5;page++) {
    await click('[data-result-page=next]');
    const view=await cdp.eval(`({ids:[...dom.resultGrid.querySelectorAll('.result-item')].map(c=>c.dataset.panelId),
      same:getAllResultCards().every((c,i)=>c===__resultCards[i]),
      count:document.querySelectorAll('.result-item').length})`);
    assertQa(view.count===(page===4?1:60)&&view.same,'Page retains canonical order and original card identities',view);
    view.ids.forEach(id=>ids.add(id));
  }
  assertQa(ids.size===241&&ids.has('241'),'Every card is reachable, none are hidden elsewhere in the attached DOM',ids.size);
  await cdp.eval('setResultPage(0);__marker.click()');
  assertQa(await cdp.eval('__markerClicks===1 && __resultCards[0].lastChild===__marker'),'Paging preserves descendant objects and event listeners');

  await cdp.eval(`(async()=>{
    applyLanguage('zh-CN');setResultPage(0);
    const card=__resultCards[60];
    replacePlaceholder(card,61,{data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg=='}]},'Download',{skipHistory:true});
    await card._imageCachePromise;
    window.__localeActionNodes=[card.querySelector('[data-clean-label="retry"]'),card.querySelector('[data-clean-label="editRetry"]')];
    const prompt=__resultCards[61].querySelector('.result-actions span');
    prompt.textContent='Download';prompt.title='Download';window.__localePromptNode=prompt;
  })()`,true);

  const expected={ 'zh-CN':['上一页','下一页'], 'zh-Hant':['上一頁','下一頁'], en:['Previous page','Next page'], ja:['前のページ','次のページ'], ko:['이전 페이지','다음 페이지'] };
  for(const width of [1440,320]) {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    await cdp.eval("if(innerWidth<981)document.getElementById('studioResultsTab')?.click()");
    for(const [lang,labels] of Object.entries(expected)) {
      await cdp.eval(`applyLanguage(${JSON.stringify(lang)});setResultPage(0)`);await frame();
      const accessible=await cdp.eval(`(()=>{
        const nav=document.querySelector('.result-pagination');const r=nav.getBoundingClientRect();
        return {labels:[...nav.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')),
          named:!!nav.getAttribute('aria-label'),live:nav.querySelector('[role=status]').getAttribute('aria-live'),
          described:[...nav.querySelectorAll('button')].every(b=>b.getAttribute('aria-controls')==='resultGrid'&&document.getElementById(b.getAttribute('aria-describedby'))?.textContent.length>30),
          fits:r.left>=0&&r.right<=innerWidth+1,all:getAllResultCards().length};
      })()`);
      assertQa(JSON.stringify(accessible.labels)===JSON.stringify(labels)&&accessible.named&&accessible.live==='polite'&&accessible.described&&accessible.fits&&accessible.all===241,'Pager labels, ALL scope and layout work in five languages', {width,lang,accessible});
      await click('[data-result-page=next]');
      const actionLocale=await cdp.eval(`(()=>{
        const card=__resultCards[60];
        return {labels:__localeActionNodes.map(n=>({title:n?.title,aria:n?.getAttribute('aria-label')})),
          expected:[cleanText('retry'),cleanText('editRetry')],
          same:__localeActionNodes.every(n=>n&&card.contains(n)),live:card.isConnected,
          prompt:card._retryContext.prompt,exportPrompt:card._zipImage.prompt,
          promptNodeSame:__resultCards[61].contains(__localePromptNode),promptText:__localePromptNode.textContent,promptTitle:__localePromptNode.title};
      })()`);
      assertQa(actionLocale.same&&actionLocale.live&&actionLocale.labels.every((n,i)=>n.title===actionLocale.expected[i]&&n.aria===actionLocale.expected[i])&&
        actionLocale.prompt==='Download'&&actionLocale.exportPrompt==='Download'&&actionLocale.promptNodeSame&&actionLocale.promptText==='Download'&&actionLocale.promptTitle==='Download',
        'Reattached retry/edit actions adopt current language without replacing nodes or translating user prompts',{width,lang,actionLocale});
      await cdp.eval("document.querySelector('[data-result-page=prev]').focus()");
      await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
      await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await frame();
      const keyboard=await cdp.eval("({page:resultWindowState.page,active:document.activeElement?.outerHTML?.slice(0,400),ok:document.activeElement===document.querySelector('[data-result-page=next]')})");
      assertQa(keyboard.page===0&&keyboard.ok,'Keyboard navigation retains focus on an enabled boundary control',{width,lang,keyboard});
    }
  }
  const roundtrip=await cdp.eval(`(()=>{
    applyLanguage('en');setResultPage(1);
    applyLanguage('ja');setResultPage(0);applyLanguage('en');setResultPage(1);
    return {actual:__localeActionNodes.map(n=>n.title),expected:[cleanText('retry'),cleanText('editRetry')],
      same:__localeActionNodes.every(n=>__resultCards[60].contains(n)),prompt:__resultCards[60]._zipImage.prompt};
  })()`);
  assertQa(JSON.stringify(roundtrip.actual)===JSON.stringify(roundtrip.expected)&&roundtrip.same&&roundtrip.prompt==='Download',
    'Visible language change followed by off-page return to the cached language refreshes action metadata',roundtrip);
  console.log('[qa] Pages/locales: PASS 241 reachable; original callbacks; 10 viewport/language cases; keyboard boundaries; ALL scope; locale roundtrip');

  await loadFresh(cdp,'result-batch-completion',{width:1440,height:1000,mobile:false});
  const batch=await cdp.eval(`(async()=>{
    localStorage.clear();switchMode('comic');
    dom.apiProvider.value='custom';dom.apiEndpoint.value='https://example.invalid/v1/images/generations';dom.apiKey.value='synthetic-fixture';dom.model.value='test-image';
    dom.prompt.value='';dom.sequentialMode.checked=false;
    clearEditorRowUndo(dom.panelTbody);dom.panelTbody.innerHTML='';panelCounter=0;
    for(let i=0;i<181;i++)addPanelRow(null,{syncCount:false}).querySelector('textarea').value='BATCH '+(i+1);
    syncPanelCountInput();
    window.__png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==';
    window.__originalCall=callImageAPI;window.__batchCalls=0;window.__peakAttached=0;
    callImageAPI=async(prompt,size,n,label,options)=>{
      __batchCalls++;__peakAttached=Math.max(__peakAttached,document.querySelectorAll('.result-item').length);
      const card=getAllResultCards().find(c=>c._retryContext.prompt===prompt);
      updateCardRetryAttempt(card,{retryIndex:1,maxRetries:2});
      await new Promise(r=>setTimeout(r,1));
      if(prompt==='BATCH 181')throw new Error('HTTP 500: fixture off-page failure');
      return {data:[{b64_json:__png}]};
    };
    await generateComic();
    window.__batchCards=getAllResultCards();await Promise.all(__batchCards.map(c=>c._imageCachePromise));
    const success=getAllResultCards('[data-status=success]');
    return {calls:__batchCalls,all:__batchCards.length,peak:__peakAttached,attached:document.querySelectorAll('.result-item').length,
      exports:getCurrentResultImages().length,failed:getFailedResultCards().map(c=>c._retryContext.panelId),
      offPageSuccess:success.filter(c=>!c.isConnected).length,
      cached:success.every(c=>c._zipBlob instanceof Blob && c.querySelector('img').src.startsWith('blob:')),
      protected:success.every(c=>collectLiveGeneratedCacheKeys().has(c._generatedCacheKey)),
      retryAttempt:__batchCards[180]?.querySelector('.retry-now')!==null};
  })()`,true);
  assertQa(batch.calls===181&&batch.all===181&&batch.peak===60&&batch.attached===60&&batch.exports===180&&batch.failed.join(',')==='181'&&batch.offPageSuccess===120&&batch.cached&&batch.protected&&batch.retryAttempt,'Actual 181-panel batch completes and caches off-page successes while retaining off-page failures',batch);
  console.log('[qa] Batch: PASS calls=181 attached=60 success=180 offPageSuccess=120 cached=180 exports=180 failed=181');

  const exported=await cdp.eval(`(async()=>{
    setResultPage(3);setResultReviewState(__batchCards[170],null,'rejected');
    const oldSave=saveOrDownloadBlob;let zip=null;
    try{saveOrDownloadBlob=async blob=>{zip=blob;};await downloadAllAsZip();}finally{saveOrDownloadBlob=oldSave;}
    const files=await extractProjectZipFiles(zip);
    const manifest=JSON.parse(await files.find(f=>f.name==='project.json').text());
    const imageFiles=files.filter(f=>f.type==='image/png');
    window.__batchManifest=manifest;
    const oldAvailable=nativeDownload.available,oldSaveFile=nativeDownload.saveFile,oldDir=nativeDownload.dirs.images;
    const saved=[];
    try{
      nativeDownload.available=()=>true;nativeDownload.dirs.images='fixture-only';
      nativeDownload.saveFile=async(kind,name,mime,b64,folder)=>{saved.push({name,mime});};
      await saveProjectResultsToFolder();
    }finally{nativeDownload.available=oldAvailable;nativeDownload.saveFile=oldSaveFile;nativeDownload.dirs.images=oldDir;}
    return {png:imageFiles.length,manifest:manifest.images.length,ids:manifest.images.map(i=>String(i.panelId)),
      reviewed:manifest.images.find(i=>String(i.panelId)==='171')?.review,
      folderPng:saved.filter(f=>f.mime==='image/png').length,folderMeta:saved.some(f=>f.name==='project.json'),
      page:resultWindowState.page,attached:document.querySelectorAll('.result-item').length};
  })()`,true);
  assertQa(exported.png===180&&exported.manifest===180&&exported.ids.includes('180')&&exported.reviewed==='rejected'&&exported.folderPng===180&&exported.folderMeta&&exported.page===3&&exported.attached===1,'Real ZIP round-trip and folder export include ALL successes regardless of page or review status',exported);
  console.log('[qa] Exports: PASS ZIP=180 decoded PNGs/manifest entries; folder=180; review/page do not filter');

  const retried=await cdp.eval(`(async()=>{
    setResultPage(0);dom.failedRetryCount.value='0';
    const oldSnapshot=captureApiRequestSnapshot;
    captureApiRequestSnapshot=()=>({...oldSnapshot(),providerConcurrency:1});
    window.__retryCalls=[];const gates=[];
    const wait=async fn=>{const end=Date.now()+6000;while(!fn()){if(Date.now()>end)throw new Error('Retry fixture deadline');await new Promise(r=>setTimeout(r,5));}};
    callImageAPI=(prompt,size,n,label,options)=>new Promise((resolve,reject)=>{__retryCalls.push(prompt);gates.push({prompt,resolve,reject,signal:options.signal});});
    try{
      const task=retryAllFailedResults();await wait(()=>gates.length===1);
      const late=addResultPlaceholder(182,'LATE FAILURE',{mode:'single',prompt:'LATE FAILURE'});
      markPlaceholderFailed(late,182,'HTTP 500: late failure',late._retryContext);
      const automaticallyQueued=retryAllFailedRun.pendingCards.includes(late)&&late.dataset.status==='queued'&&!late.isConnected;
      gates[0].reject(new Error('HTTP 500: fail once'));
      await wait(()=>gates.length===2&&retryAllFailedRun.completedCards.has(__batchCards[180]));
      const supplementable=getSupplementableFailedCards().includes(__batchCards[180]);
      dom.enqueueRemainingFailed.click();
      const manuallyQueued=retryAllFailedRun.pendingCards.includes(__batchCards[180]);
      gates[1].resolve({data:[{b64_json:__png}]});await wait(()=>gates.length===3);
      gates[2].resolve({data:[{b64_json:__png}]});await task;
      await Promise.all(getAllResultCards().map(c=>c._imageCachePromise));
      return {automaticallyQueued,supplementable,manuallyQueued,calls:__retryCalls,
        failed:getFailedResultCards().length,exports:getCurrentResultImages().length,live:isLiveResultCard(late),
        same:getAllResultCards()[180]===__batchCards[180],offpage:!__batchCards[180].isConnected&&!late.isConnected};
    }finally{captureApiRequestSnapshot=oldSnapshot;callImageAPI=__originalCall;}
  })()`,true);
  assertQa(retried.automaticallyQueued&&retried.supplementable&&retried.manuallyQueued&&retried.calls.join('|')==='BATCH 181|LATE FAILURE|BATCH 181'&&retried.failed===0&&retried.exports===182&&retried.live&&retried.same&&retried.offpage,'Dynamic retry-all and manual supplement retain detached failures and original card identity',retried);
  console.log('[qa] Retry: PASS detached failure, dynamic supplement, manual supplement; exports=182 failed=0');

  const callbacks=await cdp.eval(`(async()=>{
    const card=__batchCards[170];setResultPage(0);
    const oldLightbox=openLightbox,oldCopy=copyImageUrl,oldDownload=downloadImage,oldInpaint=openInpaintFromCard,oldRetry=retryResultCard;
    const calls=[];
    try{
      openLightbox=url=>calls.push(['preview',url]);copyImageUrl=()=>calls.push(['copy']);downloadImage=()=>calls.push(['download']);
      openInpaintFromCard=c=>calls.push(['inpaint',c===card]);retryResultCard=(c,edit)=>calls.push(['retry',c===card,edit]);
      setResultPage(2);card.querySelector('img').click();
      card.querySelectorAll('.card-action').forEach(button=>button.click());
      return {calls,review:card.dataset.review,same:getAllResultCards()[170]===card,source:card.querySelector('img').src};
    }finally{openLightbox=oldLightbox;copyImageUrl=oldCopy;downloadImage=oldDownload;openInpaintFromCard=oldInpaint;retryResultCard=oldRetry;}
  })()`,true);
  assertQa(callbacks.same&&callbacks.calls.length===6&&callbacks.calls[0][1]===callbacks.source&&callbacks.calls.some(c=>c[0]==='inpaint'&&c[1])&&callbacks.calls.filter(c=>c[0]==='retry'&&c[1]).length===2&&callbacks.review==='pending','Production card callbacks and successful preview remain wired after reattachment',callbacks);

  const cleared=await cdp.eval(`(async()=>{
    const wait=async fn=>{const end=Date.now()+6000;while(!fn()){if(Date.now()>end)throw new Error('Clear fixture deadline');await new Promise(r=>setTimeout(r,5));}};
    const gates=[];
    callImageAPI=(prompt,size,n,label,options)=>new Promise(resolve=>gates.push({resolve,signal:options.signal}));
    const task=generateComic();await wait(()=>gates.length>0&&getAllResultCards().length===181);
    const old=getAllResultCards();const detached=old.filter(c=>!c.isConnected).length;
    dom.clearResults.click();
    const aborted=old.every(c=>c._cardRetryAbortController.signal.aborted)&&gates.every(g=>g.signal.aborted);
    gates.forEach(g=>g.resolve({data:[{b64_json:__png}]}));await task;await new Promise(r=>setTimeout(r,30));
    return {detached,aborted,all:getAllResultCards().length,exports:getCurrentResultImages().length,
      failed:getFailedResultCards().length,attached:document.querySelectorAll('.result-item').length,
      invalid:old.every(c=>!isLiveResultCard(c)&&!c._localImageUrl),pager:!!document.querySelector('.result-pagination'),
      hidden:dom.resultGrid.classList.contains('hidden'),run:!!activeGenerationRun};
  })()`,true);
  assertQa(cleared.detached===121&&cleared.aborted&&cleared.all===0&&cleared.exports===0&&cleared.failed===0&&cleared.attached===0&&cleared.invalid&&!cleared.pager&&cleared.hidden&&!cleared.run,'Clearing an actual 181-card generation aborts off-page work and ignores successful late responses',cleared);
  console.log('[qa] Clear generation: PASS 181 invalidated/aborted; late success ignored; registry/DOM/exports=0');

  const queueClear=await cdp.eval(`(async()=>{
    dom.resultGrid.classList.remove('hidden');window.__clearCards=Array.from({length:121},(_,i)=>addResultPlaceholder(i+1,'CLEAR '+i,{mode:'single',prompt:'CLEAR '+i}));
    for(const card of __clearCards.slice(60))markPlaceholderFailed(card,card._retryContext.panelId,'HTTP 500: fixture',card._retryContext);
    const oldSnapshot=captureApiRequestSnapshot;captureApiRequestSnapshot=()=>({...oldSnapshot(),providerConcurrency:1});
    let resolveCall,signal;
    callImageAPI=(prompt,size,n,label,options)=>{signal=options.signal;return new Promise(r=>resolveCall=r);};
    const task=retryAllFailedResults();
    while(!resolveCall)await new Promise(r=>setTimeout(r,5));
    const pending=retryAllFailedRun.pendingCards.length;const run=retryAllFailedRun;
    dom.clearResults.click();resolveCall({data:[{b64_json:__png}]});await task;
    captureApiRequestSnapshot=oldSnapshot;callImageAPI=__originalCall;
    return {pending,cancelled:run.cancelRequested,aborted:signal.aborted,finished:!retryAllFailedRun,
      invalid:__clearCards.every(c=>!isLiveResultCard(c)),all:getAllResultCards().length,exports:getCurrentResultImages().length};
  })()`,true);
  assertQa(queueClear.pending===60&&queueClear.cancelled&&queueClear.aborted&&queueClear.finished&&queueClear.invalid&&queueClear.all===0&&queueClear.exports===0,'Clear cancels a real off-page retry queue and suppresses late retry success',queueClear);
  console.log('[qa] Clear retry: PASS active aborted, 60 pending cancelled, stale callback rejected');

  const leases=await cdp.eval(`(async()=>{
    dom.resultGrid.classList.remove('hidden');
    const cards=Array.from({length:121},(_,i)=>addResultPlaceholder(i+1,'LEASE '+i,{mode:'single',prompt:'LEASE '+i}));
    const blob=await (await fetch('data:image/png;base64,'+__png)).blob();
    const oldRead=getGeneratedCacheBlob,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
    const reads=new Map(),created=[],revoked=[];
    const acquisition=async key=>{
      const deadline=Date.now()+6000;
      while(!reads.has(key)){
        if(Date.now()>deadline)throw new Error('Cache acquisition fixture deadline: '+key);
        await new Promise(r=>setTimeout(r,5));
      }
      return reads.get(key);
    };
    getGeneratedCacheBlob=key=>new Promise((resolve,reject)=>reads.set(key,{resolve,reject}));
    URL.createObjectURL=blob=>{const url=oldCreate.call(URL,blob);created.push(url);return url;};
    URL.revokeObjectURL=url=>{revoked.push(url);return oldRevoke.call(URL,url);};
    try{
      const live=cards[100];replacePlaceholder(live,101,{data:[{url:'cache://late-live'}]},'LIVE',{skipHistory:true});
      const noInitialSource=!live.querySelector('img').getAttribute('src')&&!live.isConnected;
      (await acquisition('late-live')).resolve(blob);await live._imageCachePromise;
      const automatic=live.querySelector('img').src.startsWith('blob:')&&live._zipBlob===blob;
      setResultPage(1);live.scrollIntoView({block:'center',behavior:'instant'});
      for(let i=0;i<100&&!live.querySelector('img').naturalWidth;i++)await new Promise(r=>setTimeout(r,20));
      const decoded=live.querySelector('img').complete&&live.querySelector('img').naturalWidth===1;
      setResultPage(0);
      const retried=cards[101];replacePlaceholder(retried,102,{data:[{url:'cache://stale-child'}]},'OLD',{skipHistory:true});
      const oldLease=retried._imageCachePromise;
      await acquisition('stale-child');
      replacePlaceholder(retried,102,{data:[{url:'cache://new-child'}]},'NEW',{skipHistory:true});
      (await acquisition('new-child')).resolve(blob);await retried._imageCachePromise;
      const newUrl=retried.querySelector('img').src;
      const beforeStale=created.length;(await acquisition('stale-child')).resolve(blob);await oldLease;
      const staleChildIgnored=created.length===beforeStale&&retried.querySelector('img').src===newUrl&&retried._zipImage.prompt==='NEW';
      const failed=cards[102];replacePlaceholder(failed,103,{data:[{url:'cache://late-error'}]},'ERROR',{skipHistory:true});
      (await acquisition('late-error')).reject(new Error('fixture cache error'));await failed._imageCachePromise;
      const errorShown=!failed.isConnected&&!!failed.querySelector('.result-cache-warning');
      const removed=cards[103];replacePlaceholder(removed,104,{data:[{url:'cache://after-clear'}]},'REMOVED',{skipHistory:true});
      const removedLease=removed._imageCachePromise;
      const removedAcquisition=await acquisition('after-clear');
      const beforeClear=created.length;dom.clearResults.click();removedAcquisition.resolve(blob);await removedLease;
      return {noInitialSource,automatic,decoded,staleChildIgnored,errorShown,
        staleClearIgnored:created.length===beforeClear&&!removed._localImageUrl&&!isLiveResultCard(removed),
        urlsReleased:created.every(url=>revoked.includes(url)),empty:getAllResultCards().length===0};
    }finally{getGeneratedCacheBlob=oldRead;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
  })()`,true);
  assertQa(Object.values(leases).every(Boolean),'Detached cache-only previews hydrate automatically; old child and cleared leases never revive cards',leases);
  console.log('[qa] Preview leases: PASS cache-only off-page decode; detached error; stale child/clear ignored; URLs released');

  const restore=await cdp.eval(`(async()=>{
    // History-backed cards are built before registration in one restore branch.
    const images=Array.from({length:121},(_,i)=>({panelId:String(i+1),prompt:'RESTORE '+i,imageUrl:'data:image/png;base64,'+__png,size:'1024x1024'}));
    restoreHistoryItem({id:'fixture-restore',type:'comic-project',mode:'comic',globalPrompt:'',images,panels:images});
    const original=getAllResultCards();await Promise.all(original.map(c=>c._imageCachePromise));
    setResultPage(2);
    restoreHistoryItem({id:'fixture-single',type:'single',mode:'single',prompt:'PREPEND',imageUrl:'data:image/png;base64,'+__png});
    const all=getAllResultCards();await all[0]._imageCachePromise;
    const result={all:all.length,attached:document.querySelectorAll('.result-item').length,page:resultWindowState.page,
      prepended:all[0]._retryContext.prompt==='PREPEND',same:original.every((c,i)=>all[i+1]===c),
      previews:all.every(c=>c.querySelector('img')?.src.startsWith('blob:')),exports:getCurrentResultImages().length};
    dom.clearResults.click();return result;
  })()`,true);
  assertQa(restore.all===122&&restore.attached===60&&restore.page===0&&restore.prepended&&restore.same&&restore.previews&&restore.exports===122,'Restore prebuilt cards, prepend and clear all use the registry without replacing originals',restore);
  console.log('[qa] Restore: PASS 121 prebuilt cards + prepend; original identities; exports=122; attached=60');
};
