// Before/after-style evidence for the UI accessibility pass. Captures the landing
// page in cinematic mode, high-contrast mode, and on an emulated phone (asserting
// the 5.7MB trailer mp4 is never requested there). Needs `npm run dev` on :5173.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { BROWSER_PATH as EXEC } from './browser_path.mjs';

const BASE = 'http://localhost:5173/';
const OUT = 'pr-assets-a11y';
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EXEC,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function shot(name, { phone = false } = {}) {
  const page = await browser.newPage();
  const mp4 = [];
  page.on('request', (r) => { if (r.url().includes('home-bg.mp4')) mp4.push(r.url()); });
  await page.setViewport(
    phone
      ? { width: 414, height: 896, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { width: 1440, height: 900, deviceScaleFactor: 1 },
  );
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await wait(1500);
  return { page, mp4 };
}

// 1. Cinematic (default desktop)
{
  const { page } = await shot('cinematic');
  await page.screenshot({ path: `${OUT}/landing-cinematic.png` });
  await page.close();
  console.log('✓ landing-cinematic.png');
}

// 2. High-contrast (click the footer toggle)
{
  const { page } = await shot('contrast');
  await page.click('#landing-contrast-toggle');
  await wait(600);
  const pressed = await page.$eval('#landing-contrast-toggle', (b) => b.getAttribute('aria-pressed'));
  const isStatic = await page.$eval('#start-screen-backdrop', (b) => b.classList.contains('backdrop-static'));
  await page.screenshot({ path: `${OUT}/landing-highcontrast.png` });
  await page.close();
  console.log(`✓ landing-highcontrast.png (aria-pressed=${pressed}, backdrop-static=${isStatic})`);
}

// 3. Phone (poster only — mp4 must NOT be fetched)
{
  const { page, mp4 } = await shot('phone', { phone: true });
  const isStatic = await page.$eval('#start-screen-backdrop', (b) => b.classList.contains('backdrop-static'));
  await page.screenshot({ path: `${OUT}/landing-phone.png` });
  await page.close();
  console.log(`✓ landing-phone.png (backdrop-static=${isStatic}, mp4 requests=${mp4.length} — expect 0)`);
}

await browser.close();
console.log('done →', OUT);
