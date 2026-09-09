"use strict";
// Integration hook: await require('./studio-i18n-browser-checks')(cdp, helpers).
// All accounts/results below are fixtures; bridges are stubbed before clicks.
module.exports = async function testStudioI18n(cdp, { loadFresh, assertQa, logStep }) {
  logStep("Five-language i18n source identity, mask states and synthetic Gemini UI");
  await loadFresh(cdp, "studio-i18n");
  const results = await cdp.eval(`(async () => {
    const results = [];
    const check = (name, ok, actual) => results.push({name, ok: !!ok, actual});
    const settle = () => new Promise(r => setTimeout(r, 30));
    const langs = ['zh-CN','zh-Hant','en','ja','ko'];
    const sourceKeys = ['重试','一键重试','编辑重试','编辑后重试','生成中……','正在生成中……'];
    applyLanguage('zh-CN');
    const fixture = document.createElement('section');
    fixture.id = 'qa-i18n-fixture';
    fixture.innerHTML = sourceKeys.map(source => '<button title="'+source+'">'+source+'</button>').join('');
    document.body.append(fixture);
    translateElement(fixture);
    const user = document.createElement('section');
    user.dataset.noI18n = '';
    user.innerHTML = '<span title="Retry">重试</span><textarea>Generating...</textarea>';
    document.body.append(user);
    dom.prompt.value = '一键重试 / Retry / Generating...';
    dom.inpaintPrompt.value = '用户原文：Retry {count}';
    // Exact UI words, through actual renderers rather than a generic sentinel.
    // Keep cards separate from the live history container so windowing may own
    // that container without weakening the preservation assertions.
    const contentHost = document.createElement('section');
    document.body.append(contentHost);
    const sentinels = ['Retry','Generating...','移除当前账号'];
    const authored = sentinels.map((text,index) => {
      const item = {id:'qa-i18n-project-'+index,type:'comic-project',mode:'comic',title:text,globalPrompt:text,
        panels:[{panelId:1,panelPrompt:text}],images:[],createdAt:'2026-09-09T00:00:00.000Z'};
      const project = createHistoryProjectCard(item,[],null);
      const single = createHistoryCard({id:'qa-i18n-single-'+index,prompt:text,createdAt:item.createdAt});
      const result = addResultPlaceholder('qa-user-'+index,text);
      contentHost.append(project,single,result);
      project.querySelector('details').open = true;
      return {text,item,project,single,result};
    });
    await settle();
    const accountState = {active_account_id:'qa-active', accounts:[
      {local_account_id:'qa-active',display_name:'Retry',masked_email:'qa-a@example.invalid',status:'ready',task_ready:true},
      {local_account_id:'qa-second',display_name:'一键重试',masked_email:'qa-b@example.invalid',status:'needs_login',login_ready:false}
    ]};
    const oldNative = {};
    const calls = [];
    for (const name of ['selectGeminiAccount','deleteGeminiAccount','openGeminiWebLogin']) {
      oldNative[name] = nativeDownload[name];
      nativeDownload[name] = async id => { calls.push([name,id]); return accountState; };
    }
    const oldHealth = checkGeminiHealth, oldConfirm = askConfirm;
    checkGeminiHealth = async () => {};
    let confirmation = '';
    askConfirm = async message => { confirmation = message; return true; };
    try {
      dom.apiProvider.value = 'geminiWeb';
      geminiAccountsState = accountState;
      for (const lang of [...langs, 'en', 'zh-CN', 'ko', 'zh-CN']) {
        applyLanguage(lang);
        await settle();
        const expected = source => lang === 'zh-CN' ? source : I18N[source][lang];
        const actual = [...fixture.querySelectorAll('button')].map(n=>[n.textContent,n.title]);
        check(lang+': canonical legacy text/attribute round trip', actual.every((v,i)=>v[0]===expected(sourceKeys[i])&&v[1]===expected(sourceKeys[i])),actual);
        check(lang+': user prompt/value/opaque text unchanged', dom.prompt.value==='一键重试 / Retry / Generating...' && dom.inpaintPrompt.value==='用户原文：Retry {count}' && user.querySelector('span').textContent==='重试' && user.querySelector('span').title==='Retry',dom.prompt.value);
        for (const sample of authored) {
          const {text,project,single,result,item} = sample;
          dom.prompt.value = text;
          dom.inpaintPrompt.value = text;
          applyLanguage('en'); applyLanguage(lang); await settle();
          const projectPrompts = [...project.querySelectorAll('.history-prompt-text')].map(n=>n.textContent);
          const singlePrompt = single.querySelector('.history-prompt');
          const resultPrompt = result.querySelector('.result-actions > span');
          check(lang+': exact authored term '+text, dom.prompt.value===text && dom.inpaintPrompt.value===text
            && project.querySelector('.history-project-title').textContent===text
            && projectPrompts.length===2 && projectPrompts.every(value=>value===text)
            && singlePrompt.textContent===text && singlePrompt.title===text
            && resultPrompt.title===text && resultPrompt.textContent===text+'…'
            && item.title===text && item.globalPrompt===text && item.panels[0].panelPrompt===text,
            {text,title:project.querySelector('.history-project-title').textContent,projectPrompts,single:singlePrompt.textContent,result:resultPrompt.title});
        }
        dom.prompt.value='一键重试 / Retry / Generating...'; dom.inpaintPrompt.value='用户原文：Retry {count}';
        check(lang+': mask example and metadata', dom.inpaintPrompt.placeholder===cleanText('inpaintPromptPlaceholder') && dom.inpaintPrompt.placeholder!==cleanText('inpaintPromptLabel') && document.querySelector('#closeSkills').title===uiText('close'), dom.inpaintPrompt.placeholder);
        check(lang+': mask unloaded source label',dom.inpaintSourceMeta.textContent===cleanText('inpaintNoSource'),dom.inpaintSourceMeta.textContent);
        check(lang+': Gemini placeholder, sizes and account actions', dom.apiKey.placeholder===geminiText('keyPlaceholder') && document.querySelector('#geminiSizeTitle')?.textContent===geminiText('sizeTitle') && [...dom.geminiAccountList.querySelectorAll('button')].some(n=>n.textContent===geminiText('useAccount')),dom.apiKey.placeholder);
        check(lang+': Gemini names remain user content', dom.geminiAccountList.querySelector('strong')?.textContent==='Retry' && dom.geminiAccountIdentity.textContent.includes('Retry'),dom.geminiAccountIdentity.textContent);
        const label = geminiAccountAvailabilityText({status:'ready',temporary_chat_available:false,direct_protocol_available:false});
        check(lang+': Gemini unavailable state is localized',label===geminiText('temporaryChatUnavailable'),label);
        await processImportedWatermarkImages([]);
        check(lang+': Gemini watermark input error is localized',dom.status.textContent===uiText('watermarkChooseImages'),dom.status.textContent);
        const action = makeCardActionBtn('edit','editRetry',()=>{});
        contentHost.append(action);
        applyLanguage('en'); applyLanguage(lang); await settle();
        check(lang+': successful-card edit action retains its semantic key',action.title===cleanText('editRetry')&&action.getAttribute('aria-label')===cleanText('editRetry'),action.title);
        action.remove();
        showLoading('生成中……');
        applyLanguage('en'); await settle(); applyLanguage(lang); await settle();
        check(lang+': loading source is retained', dom.loadingText.textContent===expected('生成中……'),dom.loadingText.textContent);
        hideLoading();
        if (typeof setInpaintStatusKey === 'function') {
          setInpaintStatusKey('inpaintCandidatesPartial','info',{count:2,failed:1});
          applyLanguage('en'); applyLanguage(lang); await settle();
          check(lang+': mask status counts survive switching',dom.inpaintStatus.textContent===interpolate(cleanText('inpaintCandidatesPartial'),{count:2,failed:1}),dom.inpaintStatus.textContent);
          setInpaintStatusKey('inpaintFailed','error',{reason:'Retry {count} <opaque>'});
          applyLanguage('en'); applyLanguage(lang); await settle();
          check(lang+': mask error detail stays opaque',dom.inpaintStatus.textContent===interpolate(cleanText('inpaintFailed'),{reason:'Retry {count} <opaque>'}),dom.inpaintStatus.textContent);
        } else check(lang+': mask keyed states',false,'setInpaintStatusKey missing');
        const card = addResultPlaceholder('qa-1','Retry');
        markPlaceholderFailed(card,'qa-1',new Error('HTTP 500 fixture'));
        applyLanguage('en'); applyLanguage(lang); await settle();
        check(lang+': retry and edit labels retain their action',card.querySelector('.retry-now').getAttribute('aria-label')===cleanText('retry') && card.querySelector('.edit-retry').title===cleanText('editRetry'),[card.querySelector('.retry-now').title,card.querySelector('.edit-retry').title]);
        card.remove();
      }
      applyLanguage('ja'); await settle();
      renderGeminiAccounts(accountState); await settle();
      dom.geminiAccountList.querySelectorAll('.gemini-account-item')[1].querySelector('button').click();
      await settle();
      dom.geminiAccountList.querySelectorAll('.gemini-account-item')[1].querySelector('.btn-danger').click();
      await settle();
      check('Gemini synthetic actions retain account ids and confirmation semantics',calls.some(c=>c[0]==='selectGeminiAccount'&&c[1]==='qa-second') && calls.some(c=>c[0]==='deleteGeminiAccount'&&c[1]==='qa-second') && confirmation===geminiText('deleteConfirm'), {calls,confirmation});
      applyLanguage('zh-CN');
      showStatus('重试','info'); applyLanguage('en'); await settle(); clearStatus(); applyLanguage('zh-CN'); await settle();
      check('cleared status is not resurrected by a source binding',dom.status.textContent==='',dom.status.textContent);
    } finally {
      Object.assign(nativeDownload, oldNative); checkGeminiHealth=oldHealth; askConfirm=oldConfirm;
      fixture.remove(); user.remove(); contentHost.remove();
    }
    return results;
  })()`, true);
  for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"}: ${result.name}${result.ok ? "" : " " + JSON.stringify(result.actual)}`);
  const failed = results.filter(r => !r.ok);
  console.log(`BROWSER RESULT: ${results.length-failed.length}/${results.length} checks passed; languages=zh-CN,zh-Hant,en,ja,ko`);
  assertQa(!failed.length, "i18n browser checks", failed);
};
