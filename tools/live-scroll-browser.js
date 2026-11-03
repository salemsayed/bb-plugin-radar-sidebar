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
    return { seq: a ? Number(a.dataset.notificationMessage) : seq, offset: a && b ? a.getBoundingClientRect().top - b.getBoundingClientRect().top : null, bottomGap: b ? b.scrollHeight - b.clientHeight - b.scrollTop : null, cache: JSON.parse(localStorage.getItem(`radar-scroll:${t}`) || 'null'), visibility: b ? getComputedStyle(b).visibility : null, rect: b ? { x: b.getBoundingClientRect().left + b.clientWidth / 2, y: b.getBoundingClientRect().top + b.clientHeight / 2 } : null };
  }, t, seq);
}
async function middle(t = thread) {
  await p.goto(`${base}/projects/proj_jfxygzbhcr/threads/${t}${t === thread ? '#msg=20' : ''}`);
  await p.waitForFunction(t => document.querySelector(`[data-notification-thread="${t}"]${t === "thr_yaa3n3kk73" ? '[data-notification-message="20"]' : ""}`), { timeout: 30000 }, t);
  await pause(1500);
  await p.evaluate(() => { history.replaceState(history.state, '', location.pathname); dispatchEvent(new PopStateEvent('popstate')); });
  const s = await state(t);
  await p.mouse.move(s.rect.x, s.rect.y);
  await p.mouse.wheel({ deltaY: t === thread ? 160 : -1600 });
  await pause(1800);
  const result = await state(t);
  if (result.bottomGap < 40 || !result.seq) throw new Error('Setup did not establish a middle reading position');
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
    const painted = !!b && getComputedStyle(b).visibility === 'visible' && aa.some(e => e.getBoundingClientRect().bottom > b.getBoundingClientRect().top && e.getBoundingClientRect().top < b.getBoundingClientRect().bottom);
    window.matrixFrames.push({ ms: performance.now() - window.matrixStart, painted, hidden: !!b && getComputedStyle(b).visibility === 'hidden', offset: a && b ? a.getBoundingClientRect().top - b.getBoundingClientRect().top : null, bottomGap: b ? b.scrollHeight - b.clientHeight - b.scrollTop : null });
    if (performance.now() - window.matrixStart < 10000) requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
}
async function measure(action, expected, t = thread) {
  const cdp = await p.target().createCDPSession();
  const images = [];
  const started = Date.now();
  cdp.on('Page.screencastFrame', frame => {
    if (images.length < 40 && (images.length === 0 || Date.now() - images[images.length - 1].at >= (images.length < 20 ? 100 : 500))) images.push({ at: Date.now(), data: frame.data, metadata: frame.metadata });
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
  });
  await cdp.send('Page.enable');
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 45, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });
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
  await p.evaluate(data => sessionStorage.setItem('radar-matrix-images', JSON.stringify(data)), images.map(x => x.data));
  const imageInfo = images.map((x, i) => ({ index: i, ms: x.at-started, length: x.data.length }));
  return { expected, imageInfo, final: await state(t, expected.seq), frames: await p.evaluate(() => window.matrixFrames || []), trace: await p.evaluate(() => { window.__radarScrollDebug = false; return window.scrollTrace || []; }) };
}
