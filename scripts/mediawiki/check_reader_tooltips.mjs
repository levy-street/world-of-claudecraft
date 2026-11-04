import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../browser_path.mjs';

const [base] = process.argv.slice(2);
if (!base) throw Error('Pass an encyclopedia URL or an offline export file URL.');
const browser = await puppeteer.launch({
  headless: true,
  executablePath: BROWSER_PATH,
  args: ['--disable-gpu'],
});
const active = '.wiki-game-tooltip:not([hidden])';
try {
  const page = await browser.newPage(),
    errors = [],
    requests = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('request', (r) => requests.push(r.url()));
  await page.setViewport({ width: 1280, height: 850 });
  await page.goto(base + '#Paladin#class-spellbook', {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForSelector('.wiki-game-tooltip', { visible: false, timeout: 90000 });
  const choice = 'article li a[href="#Mending%20Light%20(Ability)"]',
    item = 'article a[href="#Training%20Mace"],.wiki-infobox a[href="#Training%20Mace"]';
  const link = await page.waitForSelector(choice);
  await link.hover();
  await page.waitForSelector(active);
  const text = await page.$eval(active, (n) => n.innerText);
  assert(
    text.includes('Mending Light') && text.includes('25 Mana') && text.includes('42 to 51'),
    text,
  );
  const dataTitle = await link.evaluate((el) => el.getAttribute('aria-describedby'));
  assert.equal(dataTitle, 'wiki-game-tooltip');
  await page.keyboard.press('Escape');
  await page.waitForSelector(active, { hidden: true });
  const icon = await link.evaluateHandle((el) => el.closest('li').querySelector('img'));
  await icon.asElement().hover();
  await page.waitForSelector(active);
  await page.keyboard.press('Escape');
  const mace = await page.waitForSelector(item);
  await mace.hover();
  await page.waitForFunction(
    () =>
      document.querySelector('[role=tooltip]:not([hidden]) .tt-title')?.textContent ===
      'Training Mace',
  );
  const weapon = await page.$eval(active, (n) => n.innerText);
  assert(
    weapon.includes('Common Weapon') &&
      weapon.includes('Speed 2.6') &&
      weapon.includes('Sell price'),
    weapon,
  );
  await mace.click();
  await page.waitForFunction(
    () => document.querySelector('main').dataset.article === 'Training Mace',
  );
  await page.waitForSelector(active, { hidden: true });
  await page.setViewport({ width: 320, height: 790 });
  await page.goto(base + '#Paladin#class-spellbook', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(choice);
  await page.focus(choice);
  await page.waitForSelector(active);
  const bounds = await page.$eval(active, (el) => {
    const b = el.getBoundingClientRect();
    return {
      left: b.left,
      right: b.right,
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    };
  });
  assert(bounds.left >= 0 && bounds.right <= bounds.width + 1 && bounds.scroll <= bounds.width + 1);
  await page.keyboard.press('Escape');
  await page.waitForSelector(active, { hidden: true });
  assert.deepEqual(errors, []);
  if (base.startsWith('file:')) assert(!requests.some((u) => /^https?:/.test(u)));
  await page.goto(base + '#Paladin#class-spellbook', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(choice);
  const point = await page.$eval(choice, (el) => {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForSelector(active, { timeout: 5000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await page.$eval('main', (el) => el.dataset.article), 'Paladin');
  console.log(
    'Passed ability names and icons, item stats, click-through, keyboard focus, Escape and 320px bounds for ' +
      base.split(':')[0],
  );
} finally {
  await browser.close();
}
