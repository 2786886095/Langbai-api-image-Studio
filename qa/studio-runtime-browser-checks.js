"use strict";
module.exports=async function runtimeBrowser(cdp,{loadFresh,assertQa,logStep}){
  logStep('Early runtime contract: supported startup, unsupported visible diagnostic, unchanged storage, enforced CSP');
  await loadFresh(cdp,'runtime-supported',{width:1440,height:1000,mobile:false});
  const normal=await cdp.eval("({ready:__AI_GEN_APP_READY,runtime:window.__AI_GEN_RUNTIME,scriptCount:[...document.scripts].filter(s=>s.src).length,body:document.body.classList.contains('studio-shell')})");
  assertQa(normal.ready===true&&normal.body&&normal.scriptCount===9,'Guard loads every app dependency once and retains working shell',normal);
  const url=await cdp.eval("location.origin+'/index.html?runtime-negative=1'");
  const negative=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    localStorage.setItem('ai_image_gen_language','en');localStorage.setItem('qa_runtime_sentinel','PRESERVE ORIGINAL');
    const original=CSS.supports.bind(CSS);CSS.supports=(...args)=>String(args).includes('color-mix')?false:original(...args);
  })();`});
  try{
    await cdp.send('Page.navigate',{url});
    let state;
    for(let i=0;i<50;i++){
      await new Promise(r=>setTimeout(r,60));
      state=await cdp.eval(`(()=>{const el=document.querySelector('#ai-gen-runtime-status');const r=el?.getBoundingClientRect();return {state:window.__AI_GEN_RUNTIME?.state,ready:window.__AI_GEN_APP_READY,text:el?.textContent,visible:!!r&&r.top>=0&&r.top<innerHeight&&r.height>0,sentinel:localStorage.getItem('qa_runtime_sentinel'),sources:[...document.scripts].filter(s=>s.src).map(s=>s.src),defined:typeof renderHistory};})()`);
      if(state.text) break;
    }
    assertQa(state.ready!==true&&state.defined==='undefined'&&state.sources.length===1,'Unsupported engine never parses or runs app modules',state);
    assertQa(state.visible&&/CSS color-mix/.test(state.text)&&/WebView2/.test(state.text)&&state.sentinel==='PRESERVE ORIGINAL','Unsupported-engine guidance is visible and leaves stored data untouched',state);
  }finally{await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:negative.identifier});}
  await loadFresh(cdp,'runtime-csp',{width:1440,height:1000,mobile:false});
  // Deliberate negative security probes. Capture only their expected CSP logs;
  // all unrelated runtime errors remain part of the suite's failure gate.
  const issueStart=cdp.runtimeIssues.length;
  const security=await cdp.eval(`(async()=>{
    const violations=[];const handler=e=>violations.push(e.effectiveDirective);
    addEventListener('securitypolicyviolation',handler);
    window.__cspInlineRan=false;window.__cspHandlerRan=false;
    const script=document.createElement('script');script.textContent='window.__cspInlineRan=true';document.body.appendChild(script);script.remove();
    const b=document.createElement('button');b.setAttribute('onclick','window.__cspHandlerRan=true');document.body.appendChild(b);b.click();b.remove();
    const base=document.createElement('base');base.href='https://invalid.example/';document.head.appendChild(base);
    const baseUnaffected=new URL('app.js',document.baseURI).origin===location.origin;base.remove();
    const data=await fetch('data:text/plain,local-only').then(r=>r.text());
    const workerUrl=URL.createObjectURL(new Blob(['onmessage=()=>postMessage("worker-ok")'],{type:'text/javascript'}));
    const worker=new Worker(workerUrl);const message=await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=reject;worker.postMessage('test');});worker.terminate();URL.revokeObjectURL(workerUrl);
    const remoteStyles=document.createElement('link');remoteStyles.rel='stylesheet';remoteStyles.href='https://fonts.googleapis.com/css2?family=Inter';document.head.appendChild(remoteStyles);
    const remoteFont=new FontFace('qa-remote-font','url(https://fonts.gstatic.com/qa-probe.woff2)');
    const fontBlocked=await remoteFont.load().then(()=>false,()=>true);
    await new Promise(r=>setTimeout(r,80));removeEventListener('securitypolicyviolation',handler);
    remoteStyles.remove();
    return {inline:__cspInlineRan,handler:__cspHandlerRan,baseUnaffected,data,message,violations,fontBlocked};
  })()`,true);
  assertQa(!security.inline&&!security.handler&&security.baseUnaffected,'CSP blocks inline scripts, event attributes and injected base URLs',security);
  assertQa(security.violations.includes('script-src-elem')&&security.violations.includes('script-src-attr')&&security.violations.includes('base-uri')&&security.data==='local-only'&&security.message==='worker-ok','Actual enforcement preserves data fetch and blob workers',security);
  assertQa(security.fontBlocked&&security.violations.includes('font-src')&&security.violations.includes('style-src-elem'),'Unused Google Fonts stylesheets and font binaries are blocked by CSP',security);
  const added=cdp.runtimeIssues.splice(issueStart);
  const unexpected=added.filter(issue=>!/(?:Content Security Policy|content security policy|violates the following Content Security Policy)/.test(JSON.stringify(issue)));
  cdp.runtimeIssues.push(...unexpected);
  console.log('[qa] Runtime/CSP browser checks passed: gated/visible/storage/inline/base/worker.');
};
