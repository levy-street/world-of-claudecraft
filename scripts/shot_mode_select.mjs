import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? 'pr-shots';
const LABEL = process.env.LABEL ?? 'dev';
const BROWSER_PATH = process.env.BROWSER_PATH ?? '/usr/bin/chromium';
fs.mkdirSync(OUT, { recursive: true });

async function shoot(viewport, suffix) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#server-select-trigger', { timeout: 15000 });
    await page.click('#server-select-trigger');
    await new Promise((r) => setTimeout(r, 300));
    const rect = await page.evaluate(() => {
      const trigger = document.querySelector('#server-select');
      const menu = document.querySelector('#server-select-menu');
      const t = trigger.getBoundingClientRect();
      const m = menu.getBoundingClientRect();
      return {
        x: Math.min(t.x, m.x),
        y: Math.min(t.y, m.y),
        width: Math.max(t.right, m.right) - Math.min(t.x, m.x),
        height: Math.max(t.bottom, m.bottom) - Math.min(t.y, m.y),
      };
    });
    await page.screenshot({
      path: `${OUT}/${LABEL}-${suffix}.png`,
      clip: {
        x: Math.max(0, rect.x - 8),
        y: Math.max(0, rect.y - 8),
        width: rect.width + 16,
        height: rect.height + 16,
      },
    });
    await browser.close();
  } catch (err) {
    await browser.close();
    throw err;
  }
}

await shoot({ width: 1280, height: 800 }, 'desktop');
await shoot({ width: 800, height: 400 }, 'mobile');
console.log(`wrote ${OUT}/${LABEL}-desktop.png and ${OUT}/${LABEL}-mobile.png`);
