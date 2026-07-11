// Visual proof of the armor-type tooltip line. Boots the offline game as a MAGE
// (cloth wearer), drops one chest piece of each armor class (mail / leather /
// cloth) into the bags, and hovers each to capture the slot line now showing the
// armor subtype on the right. As a mage, the mail and leather types render RED
// (the class cannot wear them) and cloth renders in the normal light color.
//   node scripts/armor_type_tooltip_shot.mjs    (needs `npm run dev` on :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);
await new Promise((r) => setTimeout(r, 400));
await jsClick('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Magus');
await jsClick('#offline-select .mini-class[data-class="mage"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 40000 });
await new Promise((r) => setTimeout(r, 2000));

// One chest of each armor class so the new "slot left / type right" line is obvious.
const inv = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.addItem('militia_vest', 1, sim.player.id); // mail (warrior/paladin/shaman)
  sim.addItem('shadow_jerkin', 1, sim.player.id); // leather (druid/rogue/hunter)
  sim.addItem('woven_robe', 1, sim.player.id); // cloth (mage/priest/warlock)
  return sim.inventory.map((s) => s.itemId);
});
console.log('inventory set:', JSON.stringify(inv));

// Dismiss the new-adventurer tutorial overlay, which otherwise intercepts input.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));

await page.keyboard.press('b'); // open bags
await new Promise((r) => setTimeout(r, 600));
const bagCount = await page.evaluate(() => document.querySelectorAll('#bags .item-cell').length);
console.log('bag rows:', bagCount);

async function hoverItem(name, shot) {
  // reset the mouse so the previous tooltip clears between hovers
  await page.mouse.move(10, 10);
  await new Promise((r) => setTimeout(r, 120));
  const ok = await page.evaluate((nm) => {
    const rows = [...document.querySelectorAll('#bags .item-cell')];
    const row = rows.find((r) => (r.getAttribute('aria-label') || '').includes(nm));
    if (!row) return false;
    const b = row.getBoundingClientRect();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
      row.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    }
    return true;
  }, name);
  if (!ok) {
    console.log('row not found:', name);
    return;
  }
  await new Promise((r) => setTimeout(r, 300));
  const tip = await page.evaluate(() => {
    const tt = document.querySelector('#tooltip');
    return {
      shown: tt && tt.style.display === 'block',
      text: tt?.innerText?.replace(/\n/g, ' | '),
    };
  });
  console.log(`tooltip[${name}]:`, JSON.stringify(tip));
  const box = await page.evaluate(() => {
    const tt = document.querySelector('#tooltip');
    const b = tt.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const pad = 8;
  await page.screenshot({
    path: shot,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.w + pad * 2,
      height: box.h + pad * 2,
    },
  });
}

await hoverItem('Militia Chainvest', 'tmp/armor_type_mail.png');
await hoverItem('Shadowstitch Jerkin', 'tmp/armor_type_leather.png');
await hoverItem('Valewoven Robe', 'tmp/armor_type_cloth.png');

// a full-window shot for context too
await page.mouse.move(10, 10);
await new Promise((r) => setTimeout(r, 120));
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#bags .item-cell')];
  const row = rows.find((r) => (r.getAttribute('aria-label') || '').includes('Militia Chainvest'));
  if (!row) return;
  const b = row.getBoundingClientRect();
  for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
    row.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        clientX: b.x + b.width / 2,
        clientY: b.y + b.height / 2,
      }),
    );
  }
});
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'tmp/armor_type_full.png' });

await browser.close();
