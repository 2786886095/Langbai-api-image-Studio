"use strict";

// Coordinate clicks, not element.click(): off-screen/covered controls must fail.
module.exports = async function testStudioWorkspace(cdp, { loadFresh, assertQa, logStep }) {
  logStep("Studio shell: 50 viewport/theme/language cases and real pointer navigation");
  const frame = () => cdp.eval("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))", true);
  async function click(selector) {
    const box = await cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return {missing:true};
      el.scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"});
      const r = el.getBoundingClientRect(), x = r.left + r.width/2, y = r.top + r.height/2;
      return {x,y,width:r.width,height:r.height,hit:el.contains(document.elementFromPoint(x,y)),disabled:!!el.disabled};
    })()`);
    assertQa(box.hit && box.width > 0 && box.height > 0 && !box.disabled, "Studio control must be visible and pointer-reachable", {selector,box});
    await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,x:box.x,y:box.y});
    await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,x:box.x,y:box.y});
    await frame();
  }
  let cases = 0;
  for (const width of [320,390,768,1024,1440]) {
    await loadFresh(cdp, `studio-${width}`, {width,height:900,mobile:width<600});
    assertQa(await cdp.eval("!!window.StudioShell"), "Studio must initialize after core startup");
    await cdp.eval('addPanelRow(); addTurnaroundRow(); dom.panelTbody.querySelector("textarea").value="提示词不可被界面翻译修改";');
    for (const theme of ["light","dark"]) {
      for (const language of ["zh-CN","zh-Hant","en","ja","ko"]) {
        await cdp.eval(`applyTheme(${JSON.stringify(theme)}); applyLanguage(${JSON.stringify(language)});`);
        await frame();
        const metadata = await cdp.eval(`({reference:document.querySelector('#uploadZone').getAttribute('aria-label'),delete:dom.panelTbody.querySelector('.delete-panel').title,brush:dom.inpaintBrush.title})`);
        if (language === 'en') assertQa(metadata.reference==='Upload global reference images' && metadata.delete==='Delete panel' && metadata.brush==='Brush','Canonical UI labels translate in existing and new rows',metadata);
        const translated = await cdp.eval(`({aria:dom.panelTbody.querySelector('.panel-retry-count').getAttribute('aria-label'),
          prompt:dom.panelTbody.querySelector('textarea').value, label:dom.panelTbody.querySelector('.studio-cell-label').textContent, expected:tr('重试'),
          trigger:document.getElementById('autoFillTemplateTrigger').textContent.trim(),option:dom.autoFillTemplate.selectedOptions[0].textContent.trim()})`);
        assertQa(translated.aria===translated.expected && translated.label===translated.expected && translated.prompt==='提示词不可被界面翻译修改' && translated.trigger===translated.option,"Existing storyboard metadata must change language without rewriting prompts or template values",{width,theme,language,translated});
        const layout = await cdp.eval(`(() => {
          const nodes = [...document.querySelectorAll('.studio-navigation button,.header-actions > button,.language-button,.studio-tools > summary,.mode-tab')];
          return {overflow:document.documentElement.scrollWidth > innerWidth+1, bad:nodes.filter(el => {
            const r=el.getBoundingClientRect();
            return r.width<=0 || r.left<0 || r.right>innerWidth+1 || el.scrollWidth>el.clientWidth+2 || (el.closest('.header-actions') && r.height>48);
          }).map(el=>({id:el.id,text:el.innerText,width:el.clientWidth,scroll:el.scrollWidth}))};
        })()`);
        assertQa(!layout.overflow && !layout.bad.length,"Navigation and modes must fit without clipping",{width,theme,language,layout});
        if (width <= 600) {
          const targets=await cdp.eval(`[...document.querySelectorAll('.studio-navigation button,.header-actions > button,.language-button,.studio-tools > summary,.mode-tab')].map(el=>{const r=el.getBoundingClientRect();return {id:el.id,w:r.width,h:r.height};})`);
          assertQa(targets.every(r=>r.w>=48&&r.h>=48),'Mobile primary controls have 48px touch targets',{width,theme,language,targets});
        }
        await click('#studioApi');
        assertQa(await cdp.eval('getTopVisibleOverlay()?.id === "studioApiModal"'),"API navigation opens the active dialog");
        await click('#studioCloseApi');
        await click('#settingsBtn');
        for (const group of ["generation","network","updates","files"]) {
          await click(`[data-settings-group="${group}"]`);
          const state = await cdp.eval(`(() => {
            const active = document.querySelector('[data-settings-group="${group}"]');
            const hiddenFocus = getFocusableElements(dom.settingsModal).some(el=>el.closest('.studio-section-inactive'));
            return {selected:active.getAttribute('aria-pressed')==='true',hiddenFocus,overflow:document.documentElement.scrollWidth>innerWidth+1};
          })()`);
          assertQa(state.selected && !state.hiddenFocus && !state.overflow,"Settings groups must own visibility and keyboard focus",{width,theme,language,group,state});
        }
        await click('#closeSettings');
        await click('#historyBtn');
        assertQa(await cdp.eval('getTopVisibleOverlay()?.id === "historyModal"'),"Project history opens through existing handler");
        await click('#closeHistory');
        await click('.studio-tools > summary');
        const toolState = await cdp.eval(`['importWatermarkImages','exportBtn','skillsBtn'].map(id=>{
          const el=document.getElementById(id),r=el.getBoundingClientRect();
          return {id,width:r.width,right:r.right,viewport:innerWidth,hit:el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};
        })`);
        assertQa(toolState.every(t=>t.width>0 && t.right<=t.viewport && t.hit),"Import watermark tool, export and skills remain reachable",{width,theme,language,toolState});
        await click('.studio-tools > summary');
        assertQa(await cdp.eval("!getFocusableElements(document.body).some(el=>el.closest('.studio-tools-list'))"),"Closed image-tools menu must not leak into keyboard tab order");
        for (const mode of ['comic','turnaround','single']) {
          await click(`.mode-tab[data-mode="${mode}"]`);
          assertQa(await cdp.eval(`document.querySelector('.mode-tab[data-mode="${mode}"]').getAttribute('aria-selected')==='true'`),"Mode handler must still work after reparenting");
          if (width<=600 && mode!=='single') {
            await click('#studioResultsTab');
            const tableId=mode==='comic'?'panelTable':'turnaroundTable';
            const rowFit=await cdp.eval(`(() => {
              const table=document.getElementById('${tableId}'), rect=table.getBoundingClientRect();
              const field=table.querySelector('textarea'),size=parseFloat(getComputedStyle(field).fontSize);
              const cells=[...table.querySelectorAll('tbody td')].filter(el=>{const r=el.getBoundingClientRect();return r.left<rect.left-1 || r.right>rect.right+1;});
              return {size,cells:cells.length,fieldWidth:field.getBoundingClientRect().width};
            })()`);
            assertQa(rowFit.size>=16 && !rowFit.cells && rowFit.fieldWidth>=200,'Mobile storyboards use readable full-width fields, not compressed desktop cells',{width,theme,language,mode,rowFit});
            if (mode==='comic') {
              const retry=await cdp.eval(`(() => {const el=dom.panelTbody.querySelector('.panel-retry-count'),r=el.getBoundingClientRect();return {font:parseFloat(getComputedStyle(el).fontSize),width:r.width,height:r.height};})()`);
              assertQa(retry.font>=16 && retry.width>=48 && retry.height>=48,'Mobile retry inputs retain 16px text and 48px targets without legacy important overrides',{width,theme,language,retry});
            }
            await click('#studioEditorTab');
          }
        }
        if (width<=980) {
          await click('#studioResultsTab');
          assertQa(await cdp.eval('getComputedStyle(dom.inputPanel).display === "none" && getComputedStyle(document.querySelector(".result-panel")).display !== "none"'),"Mobile results must have a dedicated scroll surface");
          await click('#studioEditorTab');
        }
        cases++;
      }
    }
  }
  await loadFresh(cdp,"studio-state-preservation");
  const state = await cdp.eval(`(async () => {
    dom.prompt.value='KEEP CURRENT PROMPT';
    const original=dom.prompt;
    keepApiConfigVisible();
    dom.apiEndpoint.value='https://example.invalid/v1';
    dom.apiKey.value='synthetic-ui-fixture-only';
    const keyNode=dom.apiKey;
    StudioShell.closeApi(); StudioShell.openApi();
    const retained=keyNode===dom.apiKey && dom.apiKey.value==='synthetic-ui-fixture-only' && original===dom.prompt && dom.prompt.value==='KEEP CURRENT PROMPT';
    StudioShell.closeApi();
    openModal(dom.settingsModal); closeModal(dom.settingsModal); openModal(dom.historyModal);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const focusOwned=dom.historyModal.contains(document.activeElement);
    closeModal(dom.historyModal);
    openModal(dom.settingsModal);
    const oldClear=clearGeneratedCacheStore;
    let clearCalls=0;
    clearGeneratedCacheStore=async()=>{clearCalls++;return 0;};
    try {
      const cancel=clearGeneratedImageCacheFromSettings();
      const asksBefore=document.querySelectorAll('.ask-dialog-overlay').length;
      document.querySelector('.ask-dialog-cancel').click();
      await cancel;
      const callsAfterCancel=clearCalls;
      const confirm=clearGeneratedImageCacheFromSettings();
      document.querySelector('.ask-dialog-ok').click();
      await confirm;
      return {retained,focusOwned,asksBefore,callsAfterCancel,clearCalls,enabled:!dom.clearGeneratedCache.disabled};
    } finally { clearGeneratedCacheStore=oldClear; }
  })()`,true);
  assertQa(state.retained && state.focusOwned && state.asksBefore===1 && state.callsAfterCancel===0 && state.clearCalls===1 && state.enabled,"Navigation must retain draft/API fields; modal transitions retain focus; cache deletion requires explicit confirmation",state);
  console.log(`[qa] Studio matrix passed: ${cases} cases; state/focus/cache-confirmation passed.`);
};
