// Captures a mobile (landscape phone) screenshot of the offline game world to
// showcase the new mobile Jump button. Needs `npm run dev` running on :5173.
// Run: node scripts/mobile_jump_shot.mjs
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.WOC_URL || 'http://localhost:5173/';
const OUT = process.env.OUT || 'mobile-jump.png';

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({
    width: 844,
    height: 390,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const client = await page.target().createCDPSession();
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'pointer', value: 'coarse' }],
  });

  await page.goto(URL, { waitUntil: 'networkidle2' });

  // Offline flow: Play Offline -> pick a class -> Start.
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thunderpaw' });

  // Let the world, renderer and mobile controls settle.
  await page.waitForSelector('body.mobile-touch #mobile-jump', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 4000));

  await page.screenshot({ path: OUT });
  console.log('wrote', OUT);

  if (process.env.CLIP_OUT) {
    const box = await page.evaluate(() => {
      const r = document.getElementById('mobile-combat-controls').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const pad = 16;
    await page.screenshot({
      path: process.env.CLIP_OUT,
      clip: {
        x: Math.max(0, box.x - pad),
        y: Math.max(0, box.y - pad),
        width: box.w + pad * 2,
        height: box.h + pad * 2,
      },
    });
    console.log('wrote', process.env.CLIP_OUT);
  }
} finally {
  await browser.close();
}
