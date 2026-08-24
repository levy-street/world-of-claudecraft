// Evidence screenshot for the feat_brightwood_relic desc reword: the Book of
// Deeds Feats shelf card for "Brightwood Remembered", desktop and phone
// landscape. Needs `npm run dev` (GAME_URL to point elsewhere, default :5173).
//   node scripts/brightwood_relic_desc_shot.mjs [outDir]

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
const OUT = process.argv[2] ?? 'pr-shots';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 180000,
  args: [
    '--no-sandbox',
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: null,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));

async function evr(fn, ...args) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await Promise.race([
        page.evaluate(fn, ...args).then((v) => ({ v })),
        sleep(45000).then(() => 'stall'),
      ]);
      if (res !== 'stall') return res.v;
      console.log('WARN: evaluate stalled 45s, retrying');
    } catch (e) {
      console.log(`WARN: evaluate threw (${e.message.slice(0, 80)}), retrying`);
      await sleep(1000);
    }
  }
  throw new Error('evaluate failed six times');
}

const media = await page.createCDPSession();
let currentClip = null;
async function flipViewport(w, h, dsf, phone) {
  if (phone) {
    await media.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    });
    await media.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await media.send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: dsf,
    mobile: phone,
    screenWidth: w,
    screenHeight: h,
    positionX: 0,
    positionY: 0,
  });
  await media.send('Emulation.resetPageScaleFactor').catch(() => {});
  await sleep(400);
  await evr((isPhone) => {
    if (isPhone) document.body.classList.add('mobile-touch');
    window.dispatchEvent(new Event('resize'));
  }, phone);
  currentClip = { x: 0, y: 0, width: w, height: h };
  await sleep(1200);
}

async function openBook(phone) {
  if (!phone) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyZ');
    await page.keyboard.up('Shift');
    await sleep(700);
    return evr(() => document.querySelector('#deeds-window')?.style.display === 'flex');
  }
  // Real mobile flow: the More tray's Deeds button.
  await evr(() => document.querySelector('#mobile-more')?.click());
  await sleep(600);
  await evr(() => document.querySelector('#mobile-deeds')?.click());
  await sleep(900);
  return evr(() => document.querySelector('#deeds-window')?.style.display === 'flex');
}

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await flipViewport(1600, 900, 1, false);
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Evidence', settleMs: 2000 });
let entered = false;
for (let i = 0; i < 30 && !entered; i++) {
  await sleep(2000);
  entered = (await evr(() => window.__game?.world?.entities?.size ?? 0)) > 5;
}
if (!entered) throw new Error('never entered the offline world');
await evr(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await sleep(500);
await flipViewport(1600, 900, 1, false);
console.log('offline world entered');

async function captureCard(file, vp) {
  const opened = await openBook(vp !== '1600x900');
  if (!opened) throw new Error(`${vp}: Book of Deeds did not open`);
  await evr(() => {
    for (const b of document.querySelectorAll('#deeds-window [data-cat]')) {
      if (b.dataset.cat === 'feat') b.click();
    }
  });
  await sleep(700);
  await evr(() => {
    const search = document.querySelector('#deeds-window .deed-search');
    if (search) {
      search.value = 'brightwood';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(500);
  const rect = await evr(() => {
    const card = document.querySelector('.deed-card[data-deed="feat_brightwood_relic"]');
    if (!card) return null;
    card.scrollIntoView({ block: 'center' });
    return true;
  });
  await sleep(400);
  const box = await evr(() => {
    const card = document.querySelector('.deed-card[data-deed="feat_brightwood_relic"]');
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!rect || !box) throw new Error(`${vp}: feat_brightwood_relic card not found`);
  const pad = 14;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: Math.min(currentClip.width, box.width + pad * 2),
    height: Math.min(currentClip.height, box.height + pad * 2),
  };
  await page.mouse.move(0, 0);
  await sleep(200);
  await page.screenshot({ path: `${OUT}/${file}`, clip });
  console.log(`shot  ${file}`);
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);
}

await captureCard('brightwood-relic-1600x900.png', '1600x900');
await flipViewport(844, 390, 3, true);
await captureCard('brightwood-relic-844x390.png', '844x390');

await page.close();
await browser.close();
console.log('done');
