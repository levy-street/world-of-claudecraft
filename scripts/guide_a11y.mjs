// Accessibility QA for the Guide (/wiki). Needs `npm run dev`. Override with GUIDE_URL=.
// Runs axe-core (WCAG 2 A/AA) on key routes, checks the skip link is the first tab stop,
// and verifies 320px reflow has no horizontal scroll. Writes a 320px screenshot to tmp/.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE = process.env.GUIDE_URL ?? 'http://localhost:5173';
const ROUTES = ['/wiki', '/wiki/how-to-play', '/wiki/classes', '/wiki/classes/druid', '/wiki/bestiary', '/wiki/models', '/wiki/world', '/wiki/gear', '/wiki/economy', '/wiki/social', '/wiki/dungeons', '/wiki/quests', '/wiki/reference/controls', '/wiki/reference/combat', '/wiki/reference/stats', '/wiki/reference/progression'];
const AXE_CDN = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js';
mkdirSync('tmp', { recursive: true });

let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
  if (!cond) fail++;
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--no-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  let axeReady = true;
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.guide-main h1');
    try {
      await page.addScriptTag({ url: AXE_CDN });
    } catch {
      axeReady = false;
      break;
    }
    const results = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      return await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] });
    });
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const summary = serious.map((v) => `${v.id}(${v.nodes.length})`).join(', ');
    check(`axe: no serious/critical on ${route}`, serious.length === 0, summary);
    if (results.violations.length) {
      console.log(`     (all violations on ${route}: ${results.violations.map((v) => `${v.id}:${v.impact}`).join(', ')})`);
    }
  }
  if (!axeReady) console.log('NOTE  axe-core CDN unreachable; skipped automated WCAG scan (run with network).');

  // Keyboard: skip link is the first focusable element.
  await page.goto(`${BASE}/wiki`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-skip');
  await page.keyboard.press('Tab');
  const firstFocus = await page.evaluate(() => document.activeElement?.className || '');
  check('skip link is the first tab stop', firstFocus.includes('guide-skip'), firstFocus);

  // Reflow at 320px: no horizontal scrollbar (WCAG 1.4.10).
  await page.setViewport({ width: 320, height: 640 });
  await page.goto(`${BASE}/wiki`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.guide-hero-title');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal scroll at 320px', overflow <= 1, `overflow=${overflow}px`);
  await page.screenshot({ path: 'tmp/wiki-320.png', fullPage: true });
} finally {
  await browser.close();
}

console.log(fail ? `\n${fail} a11y check(s) failed` : '\nAll a11y checks passed');
process.exit(fail > 0 ? 1 : 0);
