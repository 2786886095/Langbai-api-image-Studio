"use strict";

// Parent runner owns launch, profile, fresh page and artifacts. Requiring this
// module performs no I/O and starts no browser or process.
module.exports = async function studioCacheBrowserChecks(cdp, { loadFresh, assertQa, logStep }) {
  logStep("A7 cache recovery: quota/blocked/local-only retry/export/capacity/locales");
  await loadFresh(cdp, "studio-cache-recovery", { width: 1280, height: 1000, mobile: false });
  const result = await cdp.eval(`(async () => {
    const saved = {
      acquire: imageUrlToBlobWithFallback, write: putGeneratedCacheBlob,
      export: saveOrDownloadBlob, cleanup: cleanupGeneratedImageCache,
      retry: retryResultCard, fetch: window.fetch, language: currentLanguage,
      images: generatedImageUrls.slice(), cards: getAllResultCards(), page: resultWindowState.page, controls: resultWindowState.controls
    };
    const storage = navigator.storage;
    const estimateDescriptor = storage && Object.getOwnPropertyDescriptor(storage, 'estimate');
    const cases = [], unhandled = [];
    const onUnhandled = event => unhandled.push(String(event.reason));
    window.addEventListener('unhandledrejection', onUnhandled);
    const fixtureCards = [];
    let card, api = 0, acquisitions = 0, writes = 0, exports = 0, persisted = null, exported = null;
    let mode = 'quota';
    const original = new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII='), c => c.charCodeAt(0))], {type:'image/png'});
    const check = (condition, name) => { if (!condition) throw Error(name); cases.push(name); };
    const fail = name => new DOMException('A7 injected ' + name, name);
    try {
      imageUrlToBlobWithFallback = async () => { acquisitions++; return original; };
      putGeneratedCacheBlob = async (key, blob) => {
        writes++;
        if (mode === 'quota') throw fail('QuotaExceededError');
        if (mode === 'blocked') throw fail('SecurityError');
        persisted = blob;
      };
      cleanupGeneratedImageCache = async () => 0;
      saveOrDownloadBlob = async blob => {
        exports++;
        if (mode === 'export-failed') throw fail('NotAllowedError');
        exported = blob;
      };
      retryResultCard = () => { api++; throw Error('Unexpected generation retry'); };
      window.fetch = () => { api++; throw Error('Unexpected API/fetch'); };
      currentLanguage = 'en';
      card = document.createElement('div'); card.className = 'result-item';
      fixtureCards.push(card); registerResultCard(card, {prepend:true});
      check(getAllResultCards().includes(card) && resultWindowState.members.has(card), 'fixture uses production result registry');
      const record = replacePlaceholder(card, 'A7', { data: [{ url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=' }] }, 'A7 ORIGINAL PROMPT', { skipHistory: true });
      while (getAllResultCards().length <= RESULT_PAGE_SIZE) {
        const filler = document.createElement('div'); filler.className = 'result-item';
        fixtureCards.push(filler); registerResultCard(filler);
      }
      setResultPage(1);
      check(!card.isConnected && isLiveResultNode(card, card.querySelector('img')), 'off-page node lease remains live through registry membership');
      await card._imageCachePromise;
      await card._a7CacheRetryPromise?.catch(() => {});
      check(card.dataset.status === 'success' && card._zipBlob === original && card.dataset.cacheFailureReason === 'quota', 'quota preserves successful card and original bytes');
      check(card.querySelector('img').src.startsWith('blob:'), 'off-page acquisition installs original preview bytes');
      setResultPage(0);
      const retry = card.querySelector('[data-a7-cache-action="retry"]');
      const exp = card.querySelector('[data-a7-cache-action="export"]');
      check(retry?.textContent === 'Retry local caching only' && exp?.textContent === 'Export now', 'dedicated local-only action labels');
      const before = writes;
      retry.click(); retry.click();
      let rejected = false;
      try { await card._a7CacheRetryPromise; } catch (error) { rejected = error.name === 'QuotaExceededError'; }
      check(rejected && writes === before + 1 && !retry.disabled && card.dataset.cacheStatus === 'failed', 'duplicate retry guarded, rejection visible, next retry enabled');
      exp.click(); exp.click();
      await card._a7CacheExportOperation.promise;
      await Promise.resolve();
      check(exports === 1 && exported === original, 'duplicate export guarded and original blob handed off');
      mode = 'blocked';
      await a7CacheRetryLocal(card).catch(() => {});
      check(card.dataset.cacheFailureReason === 'blocked' && card.dataset.status === 'success', 'blocked storage remains a cache-only error');
      mode = 'ok';
      await a7CacheRetryLocal(card);
      check(persisted === original && card.dataset.cacheStatus === 'cached' && !card._zipImage.cacheWarning, 'local cache retry succeeds without regenerating');
      mode = 'export-failed';
      rejected = false;
      try { await a7CacheExportNow(card); } catch (error) { rejected = error.name === 'NotAllowedError'; }
      await Promise.resolve();
      check(rejected && card._a7CacheExportStatus === 'exportFailed', 'export rejection is visible, not swallowed');
      mode = 'ok'; await a7CacheExportNow(card);
      check(card._a7CacheExportStatus === 'exported', 'export can be retried after failure');
      setResultPage(1);
      check(!card.isConnected && getAllResultCards().includes(card), 'global refresh checks exercise an actual off-page card');
      if (storage) {
        await a7CacheCapacityPending;
        Object.defineProperty(storage, 'estimate', {configurable:true,value:async () => ({usage:null,quota:100})});
        await a7CacheRefreshCapacity();
        check(a7CacheCapacityState.status === 'unknown' && a7CacheCapacityState.remaining === null, 'unknown capacity is not zero free space');
        check(card.querySelector('[data-a7-cache-capacity]').dataset.capacityStatus === 'unknown', 'unknown capacity reaches off-page cards');
        Object.defineProperty(storage, 'estimate', {configurable:true,value:async () => ({usage:95,quota:100})});
        await a7CacheRefreshCapacity();
        check(a7CacheCapacityState.status === 'low' && document.querySelector('#a7CacheCapacityStatus')?.dataset.capacityStatus === 'low', 'capacity estimate updates settings and card status');
        check(card.querySelector('[data-a7-cache-capacity]').dataset.capacityStatus === 'low', 'low capacity reaches off-page cards');
      } else {
        await a7CacheRefreshCapacity();
        check(a7CacheCapacityState.status === 'unknown', 'unsupported capacity stays unknown');
      }
      for (const lang of ['zh-CN','zh-Hant','en','ja','ko']) {
        currentLanguage = lang; a7CacheLocalize();
        check(retry.textContent === a7CacheText('retry') && exp.getAttribute('aria-label') === a7CacheText('export') && record.prompt === 'A7 ORIGINAL PROMPT', 'semantic labels without prompt mutation: ' + lang);
      }
      setResultPage(0);
      check(card.isConnected && exp.getAttribute('aria-label') === a7CacheText('export'), 'returning page retains current semantic labels');
      check(api === 0 && acquisitions === 1 && unhandled.length === 0, 'no generation/API calls, reacquisition, or unhandled rejection');
      return { cases, api, acquisitions, writes, exports, unhandled };
    } finally {
      imageUrlToBlobWithFallback = saved.acquire; putGeneratedCacheBlob = saved.write;
      saveOrDownloadBlob = saved.export; cleanupGeneratedImageCache = saved.cleanup;
      retryResultCard = saved.retry; window.fetch = saved.fetch;
      currentLanguage = saved.language; generatedImageUrls = saved.images;
      if (storage) {
        if (estimateDescriptor) Object.defineProperty(storage, 'estimate', estimateDescriptor);
        else delete storage.estimate;
      }
      for (const fixtureCard of fixtureCards) {
        resultWindowState.retired.add(fixtureCard); resultWindowState.members.delete(fixtureCard);
        const index = resultWindowState.cards.indexOf(fixtureCard);
        if (index >= 0) resultWindowState.cards.splice(index, 1);
        releaseCardImageCache(fixtureCard); fixtureCard.remove();
      }
      if (resultWindowState.controls !== saved.controls) {
        resultWindowState.controls?.remove(); resultWindowState.controls = saved.controls;
      }
      resultWindowState.page = saved.page; renderResultWindow();
      if (getAllResultCards().length !== saved.cards.length || getAllResultCards().some((value, index) => value !== saved.cards[index])) throw Error('A7 fixture changed existing result registry');
      a7CacheLocalize();
      await a7CacheRefreshCapacity();
      window.removeEventListener('unhandledrejection', onUnhandled);
    }
  })()`, true);
  assertQa(result.api === 0 && result.acquisitions === 1 && result.unhandled.length === 0,
    "A7 cache recovery performs no generation/API calls or byte reacquisition", result);
  assertQa(result.cases.length >= 15, "A7 cache browser contract assertions all completed", result);
  logStep(`A7 cache browser checks passed: ${result.cases.length} assertions; API=0; acquisitions=1`);
};
