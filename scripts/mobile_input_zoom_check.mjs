// Mobile input focus-zoom regression check.
//
// iOS WebKit can zoom on focus when text-entry controls render below 16px.
// Chromium does not reproduce native iOS focus zoom. This check instead measures
// computed fonts and 100em probes beside the controls, including #ui's CSS zoom.
// Covers both game entries, portrait/landscape, coarse-pointer and runtime touch
// mode, HUD scales, outside-HUD controls, and the current Svelte admin login.
//
//   npm run dev
//   BASE_URL=http://127.0.0.1:5173 node scripts/mobile_input_zoom_check.mjs

import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const SCALES = [0.75, 0.85, 1, 1.4, 2];
const FONT_FLOOR = 16;
const LAYOUT_TOLERANCE = 0.01;
const PHONES = [
  { name: 'iphone-se', width: 375, height: 667, dsf: 2 },
  { name: 'iphone-13', width: 390, height: 844, dsf: 3 },
  { name: 'iphone-15-pro-max', width: 430, height: 932, dsf: 3 },
  { name: 'pixel-7', width: 412, height: 915, dsf: 2.625 },
  { name: 'galaxy-s8', width: 360, height: 740, dsf: 3 },
  { name: 'small-phone', width: 320, height: 568, dsf: 2 },
];
const NON_TEXT = new Set([
  'range',
  'checkbox',
  'radio',
  'color',
  'file',
  'button',
  'submit',
  'reset',
  'image',
  'hidden',
]);
const isTextEntry = (c) => !(c.tag === 'input' && NON_TEXT.has(c.type));
const label = (c) => `${c.tag}${c.id ? `#${c.id}` : ''}.${c.cls.trim().split(/\s+/).join('.')}`;
let pass = 0;
let fail = 0;
const check = (name, condition, extra = '') => {
  if (condition) pass++;
  else {
    fail++;
    console.log(`  FAIL: ${name}${extra ? ` -- ${extra}` : ''}`);
  }
};

// Current production classes and ancestor selectors, including fields created
// dynamically when a quantity dialog or inventory/auction window opens.
const GAME_GROUPS = [
  [
    '#prompt-stack',
    '<div class="prompt bank-quantity-prompt"><input class="prompt-number ui-input" type="number" value="1"></div><div class="prompt buy-quantity-prompt"><input class="prompt-number ui-input" type="number" value="1"></div>',
  ],
  [
    '#bags',
    '<input class="bag-search ui-input" type="search"><select class="bag-sort ui-btn"><option>fixture</option></select>',
  ],
  [
    '#bank-window',
    '<input class="bag-search ui-input" type="search"><select class="bag-sort ui-input"><option>fixture</option></select>',
  ],
  [
    '#market-window',
    '<input class="mkt-search ui-input" type="search"><div class="mkt-price-row"><input class="coininput ui-input" type="number" value="1"></div><textarea class="ui-input"></textarea>',
  ],
];
const ADMIN_INJECT =
  '<input id="account-search"><input class="account-custom-expiry" type="datetime-local"><input id="cf-warnings" type="number"><form class="word-add"><input maxlength="64"></form>';

async function loadPage(page, path, admin = false) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (admin) {
    // The login is rendered by Svelte after its stylesheet and runtime load.
    await page.waitForSelector('#login-username', { timeout: 60000 });
  } else {
    // domcontentloaded can fire before Vite's JS-imported style barrel arrives.
    await page.waitForFunction(
      () => {
        const probe = document.createElement('input');
        probe.className = 'ui-input';
        document.body.appendChild(probe);
        const ready =
          getComputedStyle(probe).display === 'flex' &&
          getComputedStyle(document.documentElement).getPropertyValue('--input-h').trim() !== '';
        probe.remove();
        return ready;
      },
      { timeout: 60000 },
    );
    await page.evaluate(() => {
      if (!document.getElementById('ui')) {
        const template = document.getElementById('game-ui-template');
        if (!(template instanceof HTMLTemplateElement))
          throw new Error('Missing game HUD template');
        document.body.appendChild(template.content.cloneNode(true));
      }
    });
  }
}

// Runs in the page. Each representative is attached to its actual HUD ancestor.
// A sibling probe copies only font-size; its geometry therefore includes the
// ancestor CSS zoom instead of merely repeating getComputedStyle().fontSize.
function measure({ groups = [], adminHtml = '', scale = 1, runtimeTouch = false }) {
  const previousClass = document.body.className;
  const root = document.documentElement;
  const previousScale = root.style.getPropertyValue('--ui-scale');
  document.body.classList.toggle('mobile-touch', runtimeTouch);
  // The pre-game focus guard hides #ui. These checks open HUD controls without
  // entering a world; remove that guard only for this synchronous measurement.
  document.body.classList.remove('start-screen-open');
  root.style.setProperty('--ui-scale', String(scale));
  const cleanup = [];
  const controls = [];
  const representatives = new Set();
  try {
    for (const [selector, html] of groups) {
      let parent = document.querySelector(selector);
      if (!parent) {
        parent = document.createElement('div');
        parent.id = selector.slice(1);
        document.getElementById('ui').appendChild(parent);
        cleanup.push(() => parent.remove());
      }
      const previousStyle = parent.getAttribute('style');
      // Closed production windows are display:none; render the representatives
      // for measurement without entering a game or changing saved settings.
      parent.style.setProperty('display', 'block', 'important');
      cleanup.push(() =>
        previousStyle === null
          ? parent.removeAttribute('style')
          : parent.setAttribute('style', previousStyle),
      );
      const host = document.createElement('div');
      host.innerHTML = html;
      parent.appendChild(host);
      for (const control of host.querySelectorAll('input, textarea, select')) {
        controls.push(control);
        representatives.add(control);
      }
      cleanup.push(() => host.remove());
    }
    const outside = document.createElement('div');
    outside.innerHTML = adminHtml || '<input class="ui-input" id="outside-hud">';
    document.body.appendChild(outside);
    for (const control of outside.querySelectorAll('input, textarea, select')) {
      controls.push(control);
      representatives.add(control);
    }
    cleanup.push(() => outside.remove());
    // Actual page controls retain broad computed-font coverage; hidden windows
    // cannot yield rendered geometry and are measured when their fixtures open.
    controls.push(...document.querySelectorAll('input, textarea, select'));
    const out = [];
    for (const control of new Set(controls)) {
      const fontSize = getComputedStyle(control).fontSize;
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;display:block;width:1em;height:100em;';
      probe.style.fontSize = fontSize;
      control.parentElement.appendChild(probe);
      const renderedPx = probe.getBoundingClientRect().height / 100;
      probe.remove();
      out.push({
        tag: control.tagName.toLowerCase(),
        type: (control.getAttribute('type') || '').toLowerCase(),
        id: control.id,
        cls: control.className,
        computedPx: Number.parseFloat(fontSize),
        renderedPx: renderedPx || null,
        representative: representatives.has(control),
      });
    }
    return {
      coarse: matchMedia('(pointer: coarse)').matches,
      fine: matchMedia('(pointer: fine)').matches,
      controls: out,
    };
  } finally {
    for (const clean of cleanup.reverse()) clean();
    document.body.className = previousClass;
    if (previousScale) root.style.setProperty('--ui-scale', previousScale);
    else root.style.removeProperty('--ui-scale');
  }
}

function checkTouchFonts(name, result) {
  const controls = result.controls.filter(isTextEntry);
  check(`${name} has text controls`, controls.length > 0);
  const bad = controls.filter(
    (c) =>
      !Number.isFinite(c.computedPx) ||
      c.computedPx < FONT_FLOOR - LAYOUT_TOLERANCE ||
      (c.renderedPx !== null && c.renderedPx < FONT_FLOOR - LAYOUT_TOLERANCE) ||
      (c.representative && c.renderedPx === null),
  );
  check(
    `${name} computed and rendered fonts >=16px`,
    bad.length === 0,
    bad.map((c) => `${label(c)} computed=${c.computedPx} rendered=${c.renderedPx}`).join(', '),
  );
  const outside = controls.find((c) => c.id === 'outside-hud');
  if (outside)
    check(
      `${name} outside HUD stays 16px`,
      Math.abs(outside.computedPx - FONT_FLOOR) <= LAYOUT_TOLERANCE &&
        Math.abs(outside.renderedPx - FONT_FLOOR) <= LAYOUT_TOLERANCE,
    );
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  for (const path of ['/', '/play']) {
    for (const runtimeTouch of [false, true]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      try {
        await page.setViewport({
          width: 390,
          height: 844,
          isMobile: !runtimeTouch,
          hasTouch: !runtimeTouch,
          deviceScaleFactor: 3,
        });
        await loadPage(page, path);
        for (const phone of PHONES) {
          for (const landscape of [false, true]) {
            await page.setViewport({
              width: landscape ? phone.height : phone.width,
              height: landscape ? phone.width : phone.height,
              deviceScaleFactor: phone.dsf,
              isMobile: !runtimeTouch,
              hasTouch: !runtimeTouch,
            });
            for (const scale of SCALES) {
              const name = `${path} ${runtimeTouch ? 'runtime-touch/non-coarse' : 'coarse'} ${phone.name} ${landscape ? 'landscape' : 'portrait'} scale=${scale}`;
              const result = await page.evaluate(measure, {
                groups: GAME_GROUPS,
                scale,
                runtimeTouch,
              });
              check(`${name} pointer mode`, runtimeTouch ? !result.coarse : result.coarse);
              checkTouchFonts(name, result);
            }
          }
        }
        console.log(
          `  Checked ${path} ${runtimeTouch ? 'runtime touch/non-coarse pointer' : 'coarse pointer'}: ${PHONES.length * 2 * SCALES.length} scenarios`,
        );
      } finally {
        await context.close();
      }
    }
  }
  for (const touch of [true, false]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    try {
      await page.setViewport({
        width: touch ? 390 : 1440,
        height: touch ? 844 : 900,
        isMobile: touch,
        hasTouch: touch,
        deviceScaleFactor: touch ? 3 : 1,
      });
      await loadPage(page, '/admin.html', true);
      if (touch) {
        for (const phone of PHONES) {
          for (const landscape of [false, true]) {
            await page.setViewport({
              width: landscape ? phone.height : phone.width,
              height: landscape ? phone.width : phone.height,
              isMobile: true,
              hasTouch: true,
              deviceScaleFactor: phone.dsf,
            });
            const result = await page.evaluate(measure, { adminHtml: ADMIN_INJECT });
            check('admin touch pointer is coarse', result.coarse);
            checkTouchFonts(`admin ${phone.name} ${landscape ? 'landscape' : 'portrait'}`, result);
          }
        }
      } else {
        const result = await page.evaluate(measure, {});
        const login = result.controls.find((c) => c.id === 'login-username');
        check(
          'desktop admin login stays 14px',
          login && Math.abs(login.computedPx - 14) <= LAYOUT_TOLERANCE,
        );
      }
    } finally {
      await context.close();
    }
  }
  for (const path of ['/', '/play']) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    try {
      await page.setViewport({
        width: 1440,
        height: 900,
        isMobile: false,
        hasTouch: false,
        deviceScaleFactor: 1,
      });
      await loadPage(page, path);
      const result = await page.evaluate(measure, { groups: GAME_GROUPS });
      check(`${path} desktop non-coarse pointer`, !result.coarse);
      for (const className of ['prompt-number', 'bag-search', 'mkt-search']) {
        const control = result.controls.find((c) => c.cls.split(/\s+/).includes(className));
        check(
          `${path} desktop .${className}.ui-input stays 13px`,
          control &&
            Math.abs(control.computedPx - 13) <= LAYOUT_TOLERANCE &&
            Math.abs(control.renderedPx - 13) <= LAYOUT_TOLERANCE,
        );
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail > 0 ? 1 : 0;
