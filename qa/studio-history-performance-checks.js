"use strict";
module.exports = async function historyPerformance(cdp, { loadFresh, assertQa, logStep }) {
  logStep("History: bounded pages, keyed identity, visible-only previews, stale leases, search and locale");
  const pause = ms => cdp.eval(`new Promise(r=>setTimeout(r,${ms}))`, true);
  await loadFresh(cdp,"history-performance",{width:1440,height:1000,mobile:false});
  const first = await cdp.eval(`(() => {
    localStorage.clear();saveSettings({historyLimit:500});
    window.__perfRecords=Array.from({length:241},(_,i)=>({id:'perf-'+i,type:'comic-project',mode:'comic',title:'Project '+i,createdAt:'2026-09-09T08:00:00.000Z',globalPrompt:'USER GLOBAL '+i,panels:[{panelId:1,panelPrompt:'UNIQUE SCENE '+i}],images:[]}));
    saveHistory(__perfRecords);
    const before=performance.now();renderHistory();openModal(dom.historyModal);
    window.__firstCard=document.querySelector('.history-project-card');
    return {count:document.querySelectorAll('.history-card').length,time:performance.now()-before,pager:document.querySelector('.history-pagination')?.textContent};
  })()`);
  assertQa(first.count===60,"241 records must allocate only a 60-card visible page",first);
  const desktopSearch=await cdp.eval("dom.historySearch.getBoundingClientRect().height");
  assertQa(desktopSearch>=44&&desktopSearch<=60,"Desktop search uses full-sized input styling",desktopSearch);
  assertQa(await cdp.eval("!document.querySelector('.history-project-empty-preview').classList.contains('is-error')"),"A project without images is not mislabeled as a failed request");
  const identity=await cdp.eval(`(async()=>{
    const details=__firstCard.querySelector('details');details.open=true;await new Promise(r=>setTimeout(r,10));
    const block=details.querySelector('.history-prompt-block');renderHistory();
    return {same:document.querySelector('.history-card')===__firstCard,open:details.open,blockSame:details.querySelector('.history-prompt-block')===block};
  })()`,true);
  assertQa(identity.same&&identity.open&&identity.blockSame,"Unchanged refresh reuses cards, expanded prompts and their DOM",identity);
  const ids = new Set(await cdp.eval("[...document.querySelectorAll('.history-card')].map(x=>x.dataset.historyId)"));
  for(let page=1;page<5;page++){
    const box=await cdp.eval(`(()=>{const el=document.querySelector('[data-history-page="next"]');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,disabled:el.disabled};})()`);
    assertQa(!box.disabled,"Next page remains reachable",box);
    for(const type of ['mousePressed','mouseReleased']) await cdp.send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,x:box.x,y:box.y});
    await pause(30);
    const values=await cdp.eval("[...document.querySelectorAll('.history-card')].map(x=>x.dataset.historyId)");
    assertQa(values.length<61,"Every page stays within the DOM cap",values.length);
    values.forEach(id=>ids.add(id));
  }
  assertQa(ids.size===241&&ids.has('perf-240'),"All 241 records remain reachable; pagination loses none",ids.size);
  assertQa(await cdp.eval("historyViewState.cards.size<=120 && document.querySelector('[data-history-page=next]').disabled"),"LRU stays bounded and last-page next button is disabled");
  const search=await cdp.eval(`(async()=>{
    dom.historySearch.value='UNIQUE SCENE 161';dom.historySearch.dispatchEvent(new Event('input'));await new Promise(r=>setTimeout(r,230));
    const result=[...document.querySelectorAll('.history-card')].map(x=>x.dataset.historyId);
    __perfRecords[161].title='EDITED PROJECT';saveHistory(__perfRecords);renderHistory();
    return {result,title:document.querySelector('.history-project-title').textContent,page:historyViewState.page};
  })()`,true);
  assertQa(search.result.length===1&&search.result[0]==='perf-161'&&search.title==='EDITED PROJECT'&&search.page===0,"Search covers off-page prompts and replaces changed record content",search);

  await loadFresh(cdp,"history-preview-queue",{width:390,height:844,mobile:true});
  await cdp.eval(`(()=>{
    window.__previewStats={reads:0,active:0,max:0,created:0,revoked:0};
    window.__oldHistoryBlob=getHistoryBlob;window.__oldCreate=URL.createObjectURL;window.__oldRevoke=URL.revokeObjectURL;
    URL.createObjectURL=(...args)=>{__previewStats.created++;return __oldCreate.apply(URL,args);};
    URL.revokeObjectURL=(...args)=>{__previewStats.revoked++;return __oldRevoke.apply(URL,args);};
    getHistoryBlob=async()=>{__previewStats.reads++;__previewStats.active++;__previewStats.max=Math.max(__previewStats.max,__previewStats.active);await new Promise(r=>setTimeout(r,160));__previewStats.active--;return new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'});};
    saveHistory(Array.from({length:80},(_,i)=>({id:'thumb-'+i,mode:'single',type:'single',createdAt:'2026-09-09',imageUrl:'idb://thumb-'+i,prompt:'PROMPT '+i})));
    renderHistory();
  })()`);
  try {
    await pause(220);
    assertQa(await cdp.eval("__previewStats.reads===0"),"A closed history dialog performs no thumbnail reads");
    await cdp.eval("openModal(dom.historyModal)");
    await pause(500);
    const mobileSearch=await cdp.eval("dom.historySearch.getBoundingClientRect().height");
    assertQa(mobileSearch>=48&&mobileSearch<=60,"Column toolbar never stretches the mobile search field to 220px",mobileSearch);
    const stats=await cdp.eval("({...__previewStats,jobs:historyPreviewJobs.size})");
    assertQa(stats.reads>0&&stats.reads<20&&stats.max<=4,"Only near-visible thumbnails load with at most four active reads",stats);
    const saturation=await cdp.eval(`(async()=>{
      let activated=0;for(const job of historyPreviewJobs.values()){if(job.state==='queued'&&activated++<12)job.visible=true;}
      pumpHistoryPreviews();await new Promise(r=>setTimeout(r,35));return {...__previewStats};
    })()`,true);
    assertQa(saturation.active===4&&saturation.max===4,"The actual queue saturates at four and leaves additional reads queued",saturation);
    await cdp.eval("dom.historySearch.value='PROMPT 79';renderHistory();dom.historySearch.value='PROMPT 78';renderHistory();closeModal(dom.historyModal);");
    await pause(420);
    const closed=await cdp.eval("({...__previewStats,jobs:historyPreviewJobs.size,attached:document.querySelectorAll('[data-history-object-url]').length})");
    assertQa(closed.jobs===0&&closed.active===0&&closed.attached===0&&closed.created===closed.revoked,"Closing during rapid search cancels stale jobs and revokes every leased object URL",closed);
    await cdp.eval("openModal(dom.historyModal)");await pause(420);
    assertQa(await cdp.eval("document.querySelector('.history-card img').src.startsWith('blob:')"),"Reopening rehydrates the retained card preview");
    console.log('[qa] History performance measurements:',JSON.stringify({firstPage:first,visibleQueue:stats,closed}));
  } finally {
    await cdp.eval("closeModal(dom.historyModal)");await pause(220);
    await cdp.eval("getHistoryBlob=__oldHistoryBlob;URL.createObjectURL=__oldCreate;URL.revokeObjectURL=__oldRevoke;");
  }
  console.log('[qa] History performance checks passed: bounded/keyed/visible/stale/search.');
};
