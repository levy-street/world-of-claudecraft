// Mobile input focus-zoom regression check.
//
// iOS Safari (and Android Chrome) auto-zoom the page when a focused text-entry control
// renders below 16px. The fix floors every input/textarea/select at 16px on
// coarse-pointer (touch) devices. A headless browser cannot reproduce the iOS zoom
// animation itself, so this asserts the exact property that drives it: the COMPUTED
// font-size of every form control is >= 16px on touch, while desktop keeps its small
// classic-MMO fonts. Runs across several phone screen sizes and also covers admin.html.
//
//   npm run dev    # (separate terminal, serves :5173)
//   node scripts/mobile_input_zoom_check.mjs
//   BASE_URL=http://localhost:5173 node scripts/mobile_input_zoom_check.mjs

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
mkdirSync('tmp', { recursive: true });

// A spread of real phone logical viewports (CSS px) plus one very small legacy size.
const PHONES = [
  { name: 'iphone-se', width: 375, height: 667, dsf: 2 },
  { name: 'iphone-13', width: 390, height: 844, dsf: 3 },
  { name: 'iphone-15-pro-max', width: 430, height: 932, dsf: 3 },
  { name: 'pixel-7', width: 412, height: 915, dsf: 2.625 },
  { name: 'galaxy-s8', width: 360, height: 740, dsf: 3 },
  { name: 'small-android', width: 320, height: 568, dsf: 2 },
];

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${name}${extra ? ' -- ' + extra : ''}`); }
};

// Injected representatives for controls that only exist once a HUD window opens, each
// wrapped in the ancestor that gives its real (highest-specificity) base rule so the
// cascade is authentic. Includes the two controls a low-specificity catch-all misses.
const GAME_INJECT = `
  <div class="prompt"><input class="prompt-number" type="number" value="1"></div>
  <input class="cd-input" type="text">
  <textarea class="cd-input"></textarea>
  <div class="char-row"><input class="rename-input" maxlength="16"></div>
  <div class="mkt-price-row"><input class="coininput" type="number" value="1"></div>
  <label class="trade-money"><input type="number" value="0"></label>
  <textarea id="report-details"></textarea>
`;
const ADMIN_INJECT = `
  <form id="login"><input id="login-username"><input id="login-password" type="password"></form>
  <input id="account-search">
  <input class="account-custom-expiry" type="datetime-local">
  <input id="cf-warnings" type="number">
  <form class="word-add"><input maxlength="64"></form>
`;

// Runs in the page: inject the representatives, then measure every form control.
function measure(injectHtml) {
  const host = document.createElement('div');
  host.id = '__zoomtest';
  host.style.cssText = 'position:fixed;left:-99999px;top:0;'; // rendered (not display:none) but offscreen
  host.innerHTML = injectHtml;
  // Clone <template> contents (the HUD markup, e.g. #chat-input) into the live DOM so
  // template-defined controls are measured under the real cascade, not left inert.
  for (const tpl of document.querySelectorAll('template')) {
    host.appendChild(tpl.content.cloneNode(true));
  }
  document.body.appendChild(host);
  const out = [];
  for (const el of document.querySelectorAll('input, textarea, select')) {
    const cs = getComputedStyle(el);
    out.push({
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute('type') || '').toLowerCase(),
      id: el.id || '',
      cls: el.className || '',
      px: parseFloat(cs.fontSize),
      injected: host.contains(el),
    });
  }
  return {
    coarse: matchMedia('(pointer: coarse)').matches,
    fine: matchMedia('(pointer: fine)').matches,
    controls: out,
  };
}

const label = (c) => `${c.tag}${c.type ? '[' + c.type + ']' : ''}${c.id ? '#' + c.id : ''}${c.cls ? '.' + String(c.cls).trim().split(/\s+/).join('.') : ''}`;
// type=range / checkbox / radio / color / file / button do not render text, so font-size
// never triggers focus-zoom on them -- exclude from the >=16 assertion (the rule still
// harmlessly applies, we just do not require it).
const NON_TEXT = new Set(['range', 'checkbox', 'radio', 'color', 'file', 'button', 'submit', 'reset', 'image']);
const isTextEntry = (c) => !(c.tag === 'input' && NON_TEXT.has(c.type));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});

async function loadTouch(url, viewport) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ ...viewport, isMobile: true, hasTouch: true, deviceScaleFactor: viewport.dsf });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Belt: force the coarse-pointer media so the @media(pointer:coarse) gate is exercised
  // even if device-metrics emulation alone did not flip it.
  try {
    const client = await page.target().createCDPSession();
    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
  } catch { /* feature not emulable on this Chrome; rely on device emulation */ }
  return { ctx, page };
}

console.log(`\n=== GAME CLIENT (${BASE}/) across ${PHONES.length} phone sizes ===`);
for (const v of PHONES) {
  const { ctx, page } = await loadTouch(`${BASE}/`, v);
  const r = await page.evaluate(measure, GAME_INJECT);
  check(`[${v.name}] pointer:coarse matches`, r.coarse, `coarse=${r.coarse} fine=${r.fine}`);
  const textControls = r.controls.filter(isTextEntry);
  const bad = textControls.filter((c) => !(c.px >= 16));
  check(`[${v.name}] all ${textControls.length} text controls >= 16px`, bad.length === 0,
    bad.map((c) => `${label(c)}=${c.px}px`).join(', '));
  if (v.name === 'iphone-13') {
    console.log(`  measured (${textControls.length} text controls): ` +
      textControls.map((c) => `${label(c)}=${c.px}`).join(' | '));
  }
  await page.screenshot({ path: `tmp/zoom_game_${v.name}.png` }).catch(() => {});
  await ctx.close();
}

console.log(`\n=== ADMIN (${BASE}/admin.html) across ${PHONES.length} phone sizes ===`);
for (const v of PHONES) {
  const { ctx, page } = await loadTouch(`${BASE}/admin.html`, v);
  const r = await page.evaluate(measure, ADMIN_INJECT);
  check(`[admin ${v.name}] pointer:coarse matches`, r.coarse);
  const textControls = r.controls.filter(isTextEntry);
  const bad = textControls.filter((c) => !(c.px >= 16));
  check(`[admin ${v.name}] all ${textControls.length} text controls >= 16px`, bad.length === 0,
    bad.map((c) => `${label(c)}=${c.px}px`).join(', '));
  if (v.name === 'iphone-13') {
    console.log(`  measured (${textControls.length} text controls): ` +
      textControls.map((c) => `${label(c)}=${c.px}`).join(' | '));
    await page.screenshot({ path: `tmp/zoom_admin_${v.name}.png` }).catch(() => {});
  }
  await ctx.close();
}

// Desktop regression: a fine/none pointer context must NOT trigger the floor, so the
// small classic fonts must be retained (proves the fix is mobile-only).
console.log(`\n=== DESKTOP regression (small fonts retained) ===`);
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const r = await page.evaluate(measure, GAME_INJECT);
  check('desktop is NOT pointer:coarse', !r.coarse, `coarse=${r.coarse}`);
  const cd = r.controls.find((c) => c.tag === 'input' && /\bcd-input\b/.test(c.cls));
  const pn = r.controls.find((c) => /\bprompt-number\b/.test(c.cls));
  check('desktop .cd-input stays 12px', cd && Math.abs(cd.px - 12) < 0.6, cd ? `${cd.px}px` : 'not found');
  check('desktop .prompt-number stays 12px', pn && Math.abs(pn.px - 12) < 0.6, pn ? `${pn.px}px` : 'not found');
  await ctx.close();

  const actx = await browser.createBrowserContext();
  const apage = await actx.newPage();
  await apage.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  await apage.goto(`${BASE}/admin.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const ar = await apage.evaluate(measure, ADMIN_INJECT);
  const lu = ar.controls.find((c) => c.id === 'login-username');
  check('desktop admin #login-username stays 14px', lu && Math.abs(lu.px - 14) < 0.6, lu ? `${lu.px}px` : 'not found');
  await actx.close();
}

await browser.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail > 0 ? 1 : 0);
