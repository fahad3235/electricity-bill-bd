#!/usr/bin/env node
/* Headless-Chromium smoke test for electricity-bill-bd via raw CDP.
 * Usage: node smoke.mjs   (starts its own chrome on port 9322)
 * Exit 0 = all checks pass, 1 = any failure.
 */
'use strict';

const CHROME = '/opt/meta-chromium/chrome';
const PORT = 9322;
const DIR = '/home/hatch/workspace/muse-project-factory/builds/electricity-bill-bd';
const URL = 'file://' + DIR + '/index.html';

const { spawn } = await import('node:child_process');

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: cond ? undefined : detail });
  console.log((cond ? '  ✔ ' : '  ✖ ') + name + (cond || !detail ? '' : '  -> ' + detail));
}

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--no-proxy-server',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/ebb-qa-profile',
  'about:blank',
], { stdio: 'ignore' });

async function waitForDebugger() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('chrome debugger never came up');
}

async function newTarget() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' });
  const j = await r.json();
  return j.webSocketDebuggerUrl;
}

let msgId = 0;
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const onMsg = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id === id) {
        ws.removeEventListener('message', onMsg);
        if (m.error) reject(new Error(method + ': ' + JSON.stringify(m.error)));
        else resolve(m.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { ws.removeEventListener('message', onMsg); reject(new Error('CDP timeout ' + method)); }, 15000);
  });
}

async function ev(ws, expr, awaitPromise = false) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error('JS exception: ' + r.exceptionDetails.text + ' ' + expr.slice(0, 120));
  return r.result.value;
}

function drainConsole(ws, errors) {
  ws.addEventListener('message', (evm) => {
    let m;
    try { m = JSON.parse(evm.data); } catch (e) { return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      const type = m.params.type;
      if (type === 'error') errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push('page exception: ' + (m.params.exceptionDetails.text || ''));
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error') errors.push('log.error: ' + e.text);
    }
  });
}

try {
  await waitForDebugger();
  const wsUrl = await newTarget();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  const consoleErrors = [];
  drainConsole(ws, consoleErrors);
  await send(ws, 'Runtime.enable');
  await send(ws, 'Log.enable');
  await send(ws, 'Page.enable');
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // wait for app boot
  await ev(ws, `new Promise(r => { const t = setInterval(() => { if (window.__ebb) { clearInterval(t); r(1); } }, 100); })`, true);

  console.log('DESKTOP (1280x800)');
  check('page title', (await ev(ws, 'document.title')).includes('Electricity Bill BD'));
  check('app booted (window.__ebb)', await ev(ws, '!!window.__ebb'));
  check('slab-rule note visible', await ev(ws, 'document.querySelector(".rule-note").textContent.length > 20'));
  check('disclaimer in footer', (await ev(ws, 'document.querySelector(".disclaimer").textContent')).includes('BERC'));

  // Calculator: 40 units
  await ev(ws, `document.getElementById('unitsInput').value = '40'; document.getElementById('calcBtn').click();`);
  check('40 units total = ৳ 309.54', await ev(ws, `document.getElementById('billTotal').textContent`) === '৳ 309.54');
  check('applied slab = Lifeline', (await ev(ws, `document.getElementById('billRows').textContent`)).includes('Lifeline'));
  check('result rows shown', await ev(ws, `document.querySelectorAll('#billRows tr').length`) === 6);

  // Calculator: 601 units boundary
  await ev(ws, `document.getElementById('unitsInput').value = '601'; document.getElementById('calcBtn').click();`);
  check('601 units total = ৳ 11,034.82', await ev(ws, `document.getElementById('billTotal').textContent`) === '৳ 11,034.82');
  check('601+ slab applied', (await ev(ws, `document.getElementById('billRows').textContent`)).includes('601+'));

  // Validation: empty + negative
  await ev(ws, `document.getElementById('unitsInput').value = ''; document.getElementById('calcBtn').click();`);
  check('empty input shows inline error', await ev(ws, `!document.getElementById('unitsError').hidden && document.getElementById('unitsError').textContent.length > 0`));
  await ev(ws, `document.getElementById('unitsInput').value = '-5'; document.getElementById('calcBtn').click();`);
  check('negative input rejected', await ev(ws, `!document.getElementById('unitsError').hidden`));
  await ev(ws, `document.getElementById('unitsInput').value = '40'; document.getElementById('calcBtn').click();`);
  check('error clears on valid input', await ev(ws, `document.getElementById('unitsError').hidden`));

  // i18n toggle to Bengali
  await ev(ws, `document.getElementById('langToggle').click();`);
  check('html lang=bn', await ev(ws, `document.documentElement.lang`) === 'bn');
  check('Bengali digits in total', await ev(ws, `document.getElementById('billTotal').textContent`) === '৳ ৩০৯.৫৪');
  check('BN calc button text', (await ev(ws, `document.getElementById('calcBtn').textContent`)).includes('বিল'));
  check('lang persisted', await ev(ws, `localStorage.getItem('ebb-lang-v1')`) === 'bn');
  await ev(ws, `document.getElementById('langToggle').click();`);
  check('toggle back to en', await ev(ws, `document.documentElement.lang`) === 'en');

  // Save bill to history
  await ev(ws, `document.getElementById('monthInput').value = 'Oct 2026'; document.getElementById('saveBtn').click();`);
  check('history row added', await ev(ws, `document.querySelectorAll('#historyBody tr').length`) === 1);
  check('history persisted', (await ev(ws, `localStorage.getItem('ebb-bill-history-v1')`)).includes('Oct 2026'));
  check('stats show totals', (await ev(ws, `document.getElementById('statAvgBill').textContent`)).includes('309.54'));
  // delete
  await ev(ws, `document.querySelector('#historyBody button').click();`);
  check('history row deleted', await ev(ws, `document.querySelectorAll('#historyBody tr').length`) === 0);
  check('empty state visible', await ev(ws, `!document.getElementById('historyEmpty').hidden`));

  // Export/import logic via hook
  const rt = await ev(ws, `window.__ebb.exportHistoryJSON([{id:'x',month:'M',units:1,total:2}])`);
  check('export JSON contains app marker', rt.includes('electricity-bill-bd'));
  check('malformed import rejected', await ev(ws, `window.__ebb.importHistoryJSON('{bad').ok`) === false);
  check('import with zero valid bills rejected', await ev(ws, `window.__ebb.importHistoryJSON('{"bills":[{"id":1}]}').ok`) === false);
  check('valid import accepted', await ev(ws, `window.__ebb.importHistoryJSON(window.__ebb.exportHistoryJSON([{id:'a',month:'অক্টোবর',units:40,total:309.54}])).ok`) === true);

  // Savings estimator
  await ev(ws, `document.getElementById('unitsInput').value = '80'; document.getElementById('calcBtn').click();`);
  await ev(ws, `document.getElementById('cutInput').value = '30'; document.getElementById('estimateBtn').click();`);
  check('savings panel shown', await ev(ws, `!document.getElementById('savingsOut').hidden`));
  check('savings monthly = ৳ 434.70', await ev(ws, `document.getElementById('svMonthly').textContent`) === '৳ 434.70');

  // savings estimator with no baseline -> inline message (fresh page state)
  await send(ws, 'Page.reload');
  await ev(ws, `new Promise(r => { const t = setInterval(() => { if (window.__ebb) { clearInterval(t); r(1); } }, 100); })`, true);
  await ev(ws, `document.getElementById('cutInput').value = '10'; document.getElementById('estimateBtn').click();`);
  check('savings without baseline shows message', await ev(ws, `!document.getElementById('savingsMsg').hidden`));

  // Config edit + persistence + reset
  await ev(ws, `const i = document.querySelector('#slabRatesWrap input'); i.value = '6.00'; i.dispatchEvent(new Event('change', {bubbles:true}));`);
  check('edited rate persisted', await ev(ws, `JSON.parse(localStorage.getItem('ebb-tariff-config-v1')).slabs[0].rate`) === 6.00);
  await ev(ws, `document.getElementById('resetCfgBtn').click();`);
  check('reset restores 5.32', await ev(ws, `JSON.parse(localStorage.getItem('ebb-tariff-config-v1')).slabs[0].rate`) === 5.32);

  // no horizontal overflow desktop
  check('no horizontal overflow (desktop)', await ev(ws, `document.documentElement.scrollWidth <= window.innerWidth`));

  console.log('MOBILE (390px)');
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await new Promise((r) => setTimeout(r, 400));
  check('no horizontal overflow (390px)', await ev(ws, `document.documentElement.scrollWidth <= 390`));
  await ev(ws, `document.getElementById('unitsInput').value = '76'; document.getElementById('calcBtn').click();`);
  const t76 = await ev(ws, `document.getElementById('billTotal').textContent`);
  check('76 units on mobile = ৳ 764.40', t76 === '৳ 764.40', 'got ' + t76);
  check('stats grid fits (390px)', await ev(ws, `document.querySelector('.stats').scrollWidth <= 390`));

  // reload persistence: save a bill, reload, check it survives
  await ev(ws, `document.getElementById('monthInput').value = 'Sep 2026'; document.getElementById('saveBtn').click();`);
  await send(ws, 'Page.reload');
  await ev(ws, `new Promise(r => { const t = setInterval(() => { if (window.__ebb && document.querySelectorAll('#historyBody tr').length >= 0) { clearInterval(t); r(1); } }, 100); setTimeout(() => r(0), 8000); })`, true);
  check('history survives reload', await ev(ws, `document.querySelectorAll('#historyBody tr').length`) === 1);
  check('config survives reload', await ev(ws, `!!localStorage.getItem('ebb-tariff-config-v1')`) === true);

  await new Promise((r) => setTimeout(r, 500));
  check('zero console/page errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

  ws.close();
} catch (e) {
  results.push({ name: 'smoke run completed', ok: false, detail: String(e && e.message || e) });
  console.log('  ✖ smoke run error: ' + (e && e.message || e));
} finally {
  try { chrome.kill(); } catch (e) { /* noop */ }
}

const pass = results.filter((r) => r.ok).length;
console.log(`\nSMOKE: ${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
