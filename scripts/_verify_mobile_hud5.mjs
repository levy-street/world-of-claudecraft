import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const VIEWPORT = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=844,390', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: VIEWPORT,
});
const page = await browser.newPage();
page.on('console', (m) => console.log('CONSOLE:', m.type(), m.text()));
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'VerifyFive', settleMs: 4000 });
await page.evaluate(() => document.body.classList.add('mobile-touch'));
await new Promise((r) => setTimeout(r, 600));

await page.screenshot({ path: 'tmp/phase5_hud.png' });

const info = await page.evaluate(() => {
  const rect = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.x),
      y: Math.round(r.y),
    };
  };
  const attack = document.getElementById('mobile-action-attack');
  const nearest = document.getElementById('mobile-attack-nearest');
  const chest = document.getElementById('daily-rewards-button');
  const minimap = document.getElementById('minimap-wrap');
  const toggle = document.getElementById('mobile-action-page-toggle');
  const indicator = toggle?.querySelector('.mobile-action-page-indicator');
  return {
    attackIconSvg: !!attack?.querySelector('svg.ui-icon'),
    attackIconBg: attack?.querySelector('.icon-label')?.style.backgroundImage || null,
    nearestIcon: nearest?.dataset.icon,
    nearestLabel: nearest?.querySelector('.mobile-label')?.textContent,
    nearestAria: nearest?.getAttribute('aria-label'),
    pageIndicatorText: indicator?.textContent,
    attackRect: rect('mobile-action-attack'),
    ringRect: rect('mobile-action-ring'),
    minimapRect: rect('minimap-wrap'),
    chestRect: rect('daily-rewards-button'),
    sideButtonsRect: rect('side-buttons'),
    bodyClass: document.body.className,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
