const p = await browser.getPage('radar-matrix');
const thread = 'thr_yaa3n3kk73';
const base = 'https://salem.getbb.app';
const pause = ms => new Promise(r => setTimeout(r, ms));
async function route(path) {
  await p.evaluate(path => { history.pushState(history.state, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
  await pause(500);
}
async function state(t = thread, seq = null) {
  return p.evaluate((t, seq) => {
    const aa = [...document.querySelectorAll('[data-notification-thread][data-notification-message]')].filter(e => e.dataset.notificationThread === t);
    let b;
    for (let e = aa[0]?.parentElement; e && e !== document.body; e = e.parentElement) if (/^(auto|scroll)$/.test(getComputedStyle(e).overflowY) && e.clientHeight > 0) { b = e; break; }
    const a = seq ? aa.find(e => Number(e.dataset.notificationMessage) === seq) : aa.find(e => e.getBoundingClientRect().bottom > b?.getBoundingClientRect().top && e.getBoundingClientRect().top < b?.getBoundingClientRect().bottom);
    return { hash: location.hash, active: document.visibilityState === 'visible' && document.hasFocus(), seq: a ? Number(a.dataset.notificationMessage) : seq, offset: a && b ? a.getBoundingClientRect().top - b.getBoundingClientRect().top : null, scrollRange: b ? b.scrollHeight - b.clientHeight : null, bottomGap: b ? b.scrollHeight - b.clientHeight - b.scrollTop : null, cache: JSON.parse(localStorage.getItem(`radar-scroll:${t}`) || 'null'), visibility: b ? getComputedStyle(b).visibility : null, bounds: b ? (()=>{const r=b.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})() : null, rect: b ? { x: b.getBoundingClientRect().left + b.clientWidth / 2, y: b.getBoundingClientRect().top + b.clientHeight / 2 } : null };
  }, t, seq);
}
async function middle(t = thread, newDocument = true) {
  await p.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  const destination = `/projects/proj_jfxygzbhcr/threads/${t}${t === thread ? '#msg=20' : ''}`;
  if (newDocument) await p.goto(base + destination);
  else await route(destination);
  await p.waitForFunction(t => document.querySelector(`[data-notification-thread="${t}"]${t === "thr_yaa3n3kk73" ? '[data-notification-message="20"]' : ""}`), { timeout: 30000 }, t);
  await pause(1500);
  await p.evaluate(() => { history.replaceState(history.state, '', location.pathname); dispatchEvent(new PopStateEvent('popstate')); });
  const s = await state(t);
  await p.mouse.move(s.rect.x, s.rect.y);
  await p.mouse.wheel({ deltaY: t === thread ? 160 : -1600 });
  await pause(1800);
  const result = await state(t);
  if (!result.active || !result.seq) throw new Error('Setup did not establish an active thread');
  if (result.scrollRange < 40) throw new Error('No scrollable reading point in current chat');
  if (result.bottomGap < 40) throw new Error('Setup did not establish a middle reading position');
  return result;
}
async function away() { await route('/settings/mobile'); }
function startFrames(t, expected) {
  window.__radarScrollDebug = true;
  window.scrollTrace = [];
  if (window.__radarScrollTraceHandler) window.removeEventListener('radar-scroll-trace', window.__radarScrollTraceHandler);
  window.__radarScrollTraceHandler = e => window.scrollTrace.push(e.detail);
  window.addEventListener('radar-scroll-trace', window.__radarScrollTraceHandler);
  window.matrixFrames = [];
  window.matrixStart = performance.now();
  function sample() {
    const aa = [...document.querySelectorAll('[data-notification-thread][data-notification-message]')].filter(e => e.dataset.notificationThread === t);
    let b;
    for (let e = aa[0]?.parentElement; e && e !== document.body; e = e.parentElement) if (/^(auto|scroll)$/.test(getComputedStyle(e).overflowY) && e.clientHeight > 0) { b = e; break; }
    const a = aa.find(e => Number(e.dataset.notificationMessage) === expected.seq);
    let painted=false;
    if (b) {
      const bounds=b.getBoundingClientRect();
      for(const fraction of [0.05,0.15,0.25,0.35,0.45,0.55,0.65,0.75,0.85,0.95]) {
        const hit=document.elementFromPoint((bounds.left+bounds.right)/2,bounds.top+bounds.height*fraction);
        const message=hit?.closest('[data-notification-thread][data-notification-message]');
        if(message?.dataset.notificationThread!==t)continue;
        let visible=true;
        for(let node=message;node;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0){visible=false;break;}}
        if(visible){painted=true;break;}
      }
    }
    const targetRow=a?.closest('[data-timeline-row-id]')??a;
    const targetBounds=targetRow?.getBoundingClientRect();
    const targetVisible=!!b&&!!targetBounds&&targetBounds.bottom>b.getBoundingClientRect().top&&targetBounds.top<b.getBoundingClientRect().bottom;
    window.matrixFrames.push({ wallTime: performance.timeOrigin + performance.now(), ms: performance.now() - window.matrixStart, painted, hidden: !!b && getComputedStyle(b).visibility === 'hidden', offset: a && b && targetVisible ? a.getBoundingClientRect().top - b.getBoundingClientRect().top : null, bottomGap: b ? b.scrollHeight - b.clientHeight - b.scrollTop : null });
    if (performance.now() - window.matrixStart < 10000) requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
}
async function measure(action, expected, t = thread) {
  const cdp = await p.target().createCDPSession();
  const images = [];
  const started = Date.now();
  cdp.on('Page.screencastFrame', frame => {
    if (images.length < 1500 && (images.length === 0 || Date.now() - started < 6000 || Date.now() - images[images.length - 1].at >= 100)) images.push({ at: Date.now(), data: frame.data, metadata: frame.metadata });
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
  });
  await cdp.send('Page.enable');
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 45, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });
  const triggerAt = await p.evaluate(() => Date.now());
  if (action === 'reload') {
    const injection = await p.evaluateOnNewDocument(startFrames, t, expected);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.removeScriptToEvaluateOnNewDocument(injection.identifier);
  } else {
    await p.evaluate(startFrames, t, expected);
    if (action === 'return') { await p.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); }); await p.goBack(); }
    if (action === 'resume') await p.evaluate(() => { delete document.visibilityState; window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  }
  await pause(9000);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  await p.evaluate(() => { window.__radarMatrixImages = []; });
  for (let start = 0; start < images.length; start += 40) await p.evaluate(data => window.__radarMatrixImages.push(...data), images.slice(start, start + 40).map(x => x.data));
  const imageInfo = images.map((x, i) => ({ index: i, ms: Math.round(x.metadata.timestamp * 1000 - triggerAt), deviceWidth: x.metadata.deviceWidth, deviceHeight: x.metadata.deviceHeight }));
  return { diagnostics: await p.evaluate(() => ({ navigation: performance.getEntriesByType('navigation').map(e => ({ startTime:e.startTime,requestStart:e.requestStart,responseStart:e.responseStart,responseEnd:e.responseEnd,domContentLoadedEventEnd:e.domContentLoadedEventEnd })), resources: performance.getEntriesByType('resource').filter(e => /timeline|plugin-app-assets/.test(e.name)).map(e => ({ path:new URL(e.name).pathname,startTime:e.startTime,responseEnd:e.responseEnd,duration:e.duration })) })), action, expected, triggerAt, imageInfo, final: await state(t, expected.seq), frames: await p.evaluate(() => window.matrixFrames || []), trace: await p.evaluate(() => { window.__radarScrollDebug = false; return window.scrollTrace || []; }) };
}
