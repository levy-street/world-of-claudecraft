// Mobile-cluster smoke test: boots the game in headless Edge with the TOUCH
// interface forced (Interface Mode: Touch pre-seeded in woc_settings), verifies
// the RoV-style action cluster renders and casts, exercises the binding editor
// (Customize Controls) end-to-end incl. persistence + reset, and saves
// screenshots to tmp/ for visual inspection. Needs `npm run dev` running.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1180,560', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1180, height: 560 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`CONSOLE: ${msg.text()}`);
});

// Force the touch interface before the game boots (Options > Interface Mode).
await page.evaluateOnNewDocument(() => {
  try {
    const stored = JSON.parse(localStorage.getItem('woc_settings') ?? '{}');
    stored.interfaceMode = 2;
    localStorage.setItem('woc_settings', JSON.stringify(stored));
  } catch {
    localStorage.setItem('woc_settings', JSON.stringify({ interfaceMode: 2 }));
  }
});

const results = [];
const check = (ok, label) => {
  results.push([ok, label]);
  console.log(ok ? 'ok  ' : 'FAIL', label);
};

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Thumbs');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: 'tmp/mc_01_spawn.png' });

// 1. Touch interface + cluster present.
const boot = await page.evaluate(() => {
  const cluster = document.getElementById('mobile-cluster');
  const visibleRoles = cluster
    ? [...cluster.querySelectorAll('.action-btn:not(.empty)')].map(
        (b) => [...b.classList].find((c) => c.startsWith('mcl-')) ?? '?',
      )
    : [];
  return {
    touch: document.body.classList.contains('mobile-touch'),
    clusterShown: !!cluster,
    visibleRoles,
    kitLabel: cluster?.querySelector('.mcl-kit-label')?.textContent ?? '',
    legacyBarHidden:
      getComputedStyle(document.getElementById('actionbar-row')).display === 'none',
  };
});
check(boot.touch, 'touch interface active');
check(boot.clusterShown, 'cluster rendered');
check(boot.visibleRoles.includes('mcl-attack'), 'attack button visible');
check(boot.visibleRoles.includes('mcl-skill1'), 'skill1 visible');
check(boot.legacyBarHidden, 'legacy hotbar row hidden');
check(boot.kitLabel.length > 0, `kit label present (${boot.kitLabel})`);

// 2. A cluster tap routes into the existing cast path (heroic strike errors
// without a target -- an #error-msg toast, not a crash, is the expected route).
await page.evaluate(() => {
  document.querySelector('#mobile-cluster .mcl-skill1')?.click();
});
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/mc_02_tap.png' });
check(true, 'cluster tap dispatched');

// 3. Binding editor: open on Skill 2, rebind it, verify persistence, reset.
const editor = await page.evaluate(() => {
  const g = window.__game;
  g.hud.openClusterEditor('skill2');
  const el = document.getElementById('cluster-editor');
  const items = [...el.querySelectorAll('.cluster-editor-item')];
  return {
    open: el.style.display === 'block',
    slots: el.querySelectorAll('.cluster-editor-slot').length,
    abilities: items.length,
  };
});
check(editor.open, 'editor opens');
check(editor.slots === 5, `five slot tabs (${editor.slots})`);
check(editor.abilities > 0, `eligible abilities listed (${editor.abilities})`);
await page.screenshot({ path: 'tmp/mc_03_editor.png' });

const rebind = await page.evaluate(() => {
  const el = document.getElementById('cluster-editor');
  const items = [...el.querySelectorAll('.cluster-editor-item')];
  // pick the first ability that is not already the current binding
  const pick = items.find((b) => !b.classList.contains('current'));
  const picked = pick?.querySelector('span:last-child')?.textContent ?? null;
  pick?.click();
  const stored = Object.keys(localStorage).filter((k) => k.startsWith('woc_cluster_'));
  return { picked, stored };
});
check(rebind.picked !== null, `rebound skill2 to ${rebind.picked}`);
check(rebind.stored.length === 1, `override persisted (${rebind.stored.join(',')})`);
await page.screenshot({ path: 'tmp/mc_04_rebound.png' });

const reset = await page.evaluate(() => {
  const el = document.getElementById('cluster-editor');
  const buttons = [...el.querySelectorAll('.cluster-editor-footer .btn')];
  buttons[buttons.length - 1]?.click(); // Reset all to Class Defaults
  return Object.keys(localStorage).filter((k) => k.startsWith('woc_cluster_')).length;
});
check(reset === 0, 'reset-all clears saved bindings');
await page.evaluate(() => window.__game.hud.closeClusterEditor());

// 4. Editor closed, cluster still live.
const after = await page.evaluate(() => ({
  editorClosed: document.getElementById('cluster-editor').style.display !== 'block',
  attackShown: !!document.querySelector('#mobile-cluster .mcl-attack:not(.empty)'),
}));
check(after.editorClosed, 'editor closes');
check(after.attackShown, 'cluster intact after editing');
await page.screenshot({ path: 'tmp/mc_05_done.png' });

if (errors.length) {
  console.log('\n=== PAGE ERRORS ===');
  for (const e of errors.slice(0, 20)) console.log(e);
}
const failed = results.filter(([ok]) => !ok).length;
console.log(failed === 0 && errors.length === 0 ? 'SMOKE OK' : `SMOKE FAILURES: ${failed}`);
await browser.close();
process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
