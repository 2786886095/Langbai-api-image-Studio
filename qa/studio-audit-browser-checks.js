"use strict";
module.exports = async function testStudioAuditFixes(cdp, { loadFresh, assertQa, logStep }) {
  logStep("Studio audit fixes: pointer undo, project boundaries, IME search, lazy prompts, forced colors");
  const frame = () => cdp.eval("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",true);
  async function click(selector) {
    const box=await cdp.eval(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el)return {}; el.scrollIntoView({block:'nearest',behavior:'instant'}); const r=el.getBoundingClientRect(); const x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,hit:el.contains(document.elementFromPoint(x,y)),disabled:el.disabled}; })()`);
    assertQa(box.hit&&!box.disabled,"Audited control accepts a real pointer",{selector,box});
    for(const type of ["mousePressed","mouseReleased"]) await cdp.send("Input.dispatchMouseEvent",{type,button:"left",clickCount:1,x:box.x,y:box.y});
    await frame();
  }
  await loadFresh(cdp,"studio-audit-undo",{width:1440,height:1000,mobile:false});
  await click('[data-mode="comic"]');
  await cdp.eval(`(() => {
    dom.panelTbody.innerHTML='';
    window.__auditRows=[addPanelRow(),addPanelRow(),addPanelRow()];
    __auditRows.forEach((row,i)=>{row.querySelector('textarea').value='ORIGINAL '+i;row.querySelector('.panel-size-w').value='832';row.querySelector('.panel-size-h').value='1216';row.querySelector('.panel-retry-count').value='7';row._panelReference={fileName:'synthetic.png',dataUrl:'data:image/png;base64,c3ludGhldGlj'};});
  })()`);
  await click('#panelTbody tr:nth-child(2) .delete-panel');
  await click('#panelTbody tr:first-child .delete-panel');
  await click('[data-undo-editor="panelTbody"]');
  await click('[data-undo-editor="panelTbody"]');
  assertQa(await cdp.eval(`__auditRows.every((row,i)=>dom.panelTbody.children[i]===row && row.querySelector('textarea').value==='ORIGINAL '+i && row.querySelector('.panel-size-w').value==='832' && row.querySelector('.panel-size-h').value==='1216' && row.querySelector('.panel-retry-count').value==='7' && row._panelReference.fileName==='synthetic.png')`),"Undo restores row identity, order, references, prompts and parameters");
  await click('#panelTbody tr:last-child .delete-panel');
  await click('[data-undo-editor="panelTbody"]');
  await click('#panelTbody tr:last-child .delete-panel');
  await click('#clearPanels');
  await click('.ask-dialog-ok');
  assertQa(await cdp.eval("dom.panelTbody.children.length===0 && !document.querySelector('[data-undo-editor=panelTbody]') && !editorRowUndoStates.has(dom.panelTbody)"),"Confirmed clear ends undo; old project rows cannot reappear");
  await click('[data-mode="turnaround"]');
  await cdp.eval("window.__auditTurnaround=addTurnaroundRow();__auditTurnaround.querySelector('textarea').value='KEEP CHARACTER';__auditTurnaround._turnaroundReference={fileName:'reference.png'};");
  await click('#turnaroundTbody tr:last-child .delete-panel');
  await click('[data-undo-editor="turnaroundTbody"]');
  assertQa(await cdp.eval("__auditTurnaround.isConnected && __auditTurnaround.querySelector('textarea').value==='KEEP CHARACTER' && __auditTurnaround._turnaroundReference.fileName==='reference.png'"),"Turnaround deletion has independent non-destructive undo");

  await loadFresh(cdp,"studio-audit-history",{width:1440,height:1000,mobile:false});
  await cdp.eval(`saveHistory(Array.from({length:10},(_,i)=>({id:'qa-'+i,type:'comic-project',mode:'comic',title:i===0?'needle':'project '+i,createdAt:new Date().toISOString(),globalPrompt:'GLOBAL USER TEXT',panels:Array.from({length:500},(_,j)=>({panelId:j+1,panelPrompt:'SCENE '+j})),images:[]})));`);
  await click('#historyBtn');
  assertQa(await cdp.eval("document.querySelectorAll('.history-project-card').length===10 && document.querySelectorAll('.history-prompt-block').length===0"),"5000 collapsed prompts allocate no hidden prompt blocks");
  await click('.history-project-details summary');
  assertQa(await cdp.eval("document.querySelectorAll('.history-prompt-block').length===501"),"Expanded project renders global prompt and 500 separate scene prompts");
  await click('.history-project-details summary');
  await click('.history-project-details summary');
  assertQa(await cdp.eval("document.querySelectorAll('.history-prompt-block').length===501"),"Reopening prompt details does not duplicate content");
  const search=await cdp.eval(`(async()=>{
    const original=renderHistory;let calls=0;renderHistory=()=>{calls++;original();};
    try {
      const field=dom.historySearch;
      field.dispatchEvent(new CompositionEvent('compositionstart'));
      for (const value of ['n','ne','nee']) {field.value=value;field.dispatchEvent(new InputEvent('input',{isComposing:true}));}
      await new Promise(r=>setTimeout(r,230));const duringComposition=calls;
      field.value='needle';field.dispatchEvent(new CompositionEvent('compositionend'));
      field.dispatchEvent(new InputEvent('input'));
      await new Promise(r=>setTimeout(r,230));
      return {duringComposition,calls,cards:document.querySelectorAll('.history-project-card').length,title:document.querySelector('.history-project-title')?.textContent};
    } finally {renderHistory=original;}
  })()`,true);
  assertQa(search.duringComposition===0&&search.calls===1&&search.cards===1&&search.title==='needle',"IME input and rapid keys coalesce into one final search",search);
  await click('#closeHistory');
  await cdp.send("Emulation.setEmulatedMedia",{features:[{name:"forced-colors",value:"active"}]});
  try {
    await click('#settingsBtn');
    const colors=await cdp.eval(`(() => { const icon=getComputedStyle(document.querySelector('#closeSettings .ui-icon'));const tabs=[...document.querySelectorAll('.studio-settings-tab')];return {paint:icon.backgroundColor,color:icon.color,adjust:icon.forcedColorAdjust,selected:tabs.filter(el=>getComputedStyle(el).outlineStyle==='solid'&&parseFloat(getComputedStyle(el).outlineWidth)>=2).length}; })()`);
    assertQa(colors.paint===colors.color && colors.adjust==='none' && colors.selected===1,"Forced colors keep the close icon and exactly one selected group indicator",colors);
    await click('#closeSettings');
  } finally {await cdp.send("Emulation.setEmulatedMedia",{features:[]});}
  console.log("[qa] Studio audit browser checks passed: undo/state/IME/lazy prompts/forced colors.");
};
