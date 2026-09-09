"use strict";
// Isolated headless browser. Never connects to an installed app or user profile.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const {spawn} = require('node:child_process'), Module = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const out = path.resolve(process.env.AIGEN_PAINT_OUTPUT || path.join(root, '.codex-artifacts/first-paint'));
process.env.AIGEN_QA_APP_PORT ||= '8782';
process.env.AIGEN_QA_DEBUG_PORT ||= '38882';
const runner = path.join(__dirname, 'regression-runner.js');
const mod = new Module(runner, module); mod.filename = runner; mod.paths = Module._nodeModulePaths(path.dirname(runner));
let source = fs.readFileSync(runner, 'utf8');
source = source.slice(0, source.lastIndexOf('\nmain().catch'));
mod._compile(source + '\nmodule.exports={findEdgeExecutable,setupBrowserPage,edgeProfile,appUrl,sleep,mime,removeDirWithRetry};', runner);
const h = mod.exports;
let scenario = 'slow', server, edge, cdp;
const records = [];
async function until(predicate, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await predicate()) return; await h.sleep(40); }
  throw Error('First-paint observation timed out: ' + scenario);
}
async function click(selector) {
  const p=await cdp.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});
  await h.sleep(50);
}
async function main() {
  fs.mkdirSync(out, {recursive:true});
  server = http.createServer((req,res) => {
    const name = decodeURIComponent(new URL(req.url, h.appUrl).pathname);
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end();return;}
    const captured = scenario;
    const send = () => {
      let data = fs.readFileSync(file);
      if (name === '/studio-shell.js' && captured === 'missing') {res.writeHead(404);res.end();return;}
      if (name === '/studio-shell.js' && captured === 'skip') data = Buffer.from('window.AiGenRuntime.finishPresentation("fallback", "Synthetic missing shell contract");');
      res.writeHead(200, {'Content-Type':h.mime[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});res.end(data);
    };
    setTimeout(send, name === '/app.js' ? 650 : name === '/studio-shell.js' ? 900 : 0);
  });
  await new Promise(resolve => server.listen(Number(process.env.AIGEN_QA_APP_PORT),'127.0.0.1',resolve));
  edge = spawn(h.findEdgeExecutable(), ['--headless=new','--disable-gpu','--disable-sync','--no-first-run',
    '--remote-debugging-port='+process.env.AIGEN_QA_DEBUG_PORT,'--user-data-dir='+h.edgeProfile,'about:blank'], {stdio:'ignore',windowsHide:true});
  cdp = await h.setupBrowserPage();
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.paintSamples=[];window.paintNavigationCount=1;
    localStorage.setItem('qa_paint_sentinel','PRESERVE');
    localStorage.setItem('ai_image_gen_language','en');
    const sample=()=>{const a=document.querySelector('.app');if(a){const s=getComputedStyle(a);paintSamples.push({oldVisible:!document.body.classList.contains('studio-shell')&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0',core:window.__AI_GEN_APP_READY===true,shell:!!window.StudioShell});}requestAnimationFrame(sample);};requestAnimationFrame(sample);
  `});
  const defects = [];
  for (const [width,theme] of [[1440,'dark'],[390,'light']]) {
    scenario='slow';
    const seed = await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('ai_image_gen_theme',${JSON.stringify(theme)});`});
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
    await cdp.send('Page.navigate',{url:h.appUrl+'?qaDisableWorkspaceDraft=1&paint='+width});
    await until(() => cdp.eval('window.__AI_GEN_APP_READY===true'));
    // app.js is ready, but the shell response is deliberately still withheld.
    const early = await cdp.eval(`({core:__AI_GEN_APP_READY,shell:!!window.StudioShell,hidden:getComputedStyle(document.querySelector('.app')).visibility==='hidden',pending:document.documentElement.classList.contains('studio-starting')})`);
    fs.writeFileSync(path.join(out,`early-${width}.png`),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await until(() => cdp.eval('!!window.StudioShell'));
    await h.sleep(120);
    const state = await cdp.eval(`({oldFrames:paintSamples.filter(s=>s.oldVisible).length,pending:document.documentElement.classList.contains('studio-starting'),theme:document.documentElement.getAttribute('data-theme'),uiReady:window.__AI_GEN_UI_READY===true,sentinel:localStorage.getItem('qa_paint_sentinel')})`);
    await click('#settingsBtn');
    assert.equal(await cdp.eval(`!document.querySelector('#settingsModal').classList.contains('hidden')`),true);
    await click('#closeSettings');await click('[data-mode="comic"]');
    await h.sleep(1200);
    assert.equal(await cdp.eval(`document.querySelector('[data-mode="comic"]').classList.contains('active')`),true,'Comic must not jump back after startup');
    fs.writeFileSync(path.join(out,`ready-${width}.png`),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    records.push({scenario,width,theme,early,...state});
    if(state.oldFrames || !early.hidden || !state.uiReady) defects.push('visible legacy frames at '+width+': '+state.oldFrames);
    assert.equal(state.pending,false);assert.equal(state.sentinel,'PRESERVE');
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:seed.identifier});
  }
  if (defects.length) throw Error(defects.join('; '));
  cdp.assertNoRuntimeIssues();
  for(scenario of ['missing','skip']) {
    await cdp.send('Page.navigate',{url:h.appUrl+'?qaDisableWorkspaceDraft=1&paint='+scenario});
    await until(() => cdp.eval(`location.search.includes('paint=${scenario}') && document.readyState!=='loading' && window.__AI_GEN_APP_READY===true && window.__AI_GEN_PRESENTATION==='fallback'`));
    await cdp.eval('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',true);
    const failure=await cdp.eval(`({visible:getComputedStyle(document.querySelector('.app')).visibility!=='hidden',banner:document.querySelector('#studio-startup-status').textContent,pending:document.documentElement.classList.contains('studio-starting'),sentinel:localStorage.getItem('qa_paint_sentinel')})`);
    records.push({scenario,...failure});
    assert.equal(failure.visible,true,JSON.stringify(failure));assert.equal(failure.pending,false);assert.ok(failure.banner.length);assert.equal(failure.sentinel,'PRESERVE');
    await cdp.eval(`document.querySelector('#settingsBtn').click()`);
    assert.equal(await cdp.eval(`!document.querySelector('#settingsModal').classList.contains('hidden')`),true,scenario+' fallback settings button');
  }
  console.log('PASS: zero legacy frames; desktop/mobile; delayed shell; settings/comic stable; missing/skipped shell fallback; storage preserved');
}
main().catch(error=>{console.error('FAIL: '+error.stack);process.exitCode=1;}).finally(async()=>{
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify(records,null,2));
  if(cdp)cdp.close();if(edge)edge.kill();if(server)server.close();await h.sleep(500);
  // The profile is created by this process only; reject an unexpected cleanup target.
  assert.equal(path.dirname(path.resolve(h.edgeProfile)),path.dirname(path.resolve(__dirname,'..')));
  assert.ok(path.basename(h.edgeProfile).startsWith('aigen-edge-qa-'));await h.removeDirWithRetry(h.edgeProfile);
});
