// Screenshot harness for the home-page account portal (feat/account-portal).
// Requires: npm run dev (5173) + npm run server (proxied). Registers a fresh
// account, then captures the logged-out nav, the account portal, and sections.
import puppeteer from 'puppeteer-core';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium';
const BASE = 'http://localhost:5173/';
const OUT = 'pr-assets-account';
const user = 'Portal' + Date.now().toString().slice(-7);
const pass = 'portalpass1';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERR:', m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(1500);

// 1) Logged-out nav (Login/Register visible, Account hidden).
await page.screenshot({ path: `${OUT}/01-nav-logged-out.png` });

// Open the login panel, switch to register, create an account.
await page.click('#nav-btn-login');
await sleep(600);
await page.click('#btn-auth-toggle').catch(() => {});
await sleep(400);
await page.type('#login-user', user, { delay: 12 });
await page.type('#login-pass', pass, { delay: 12 });
await page.screenshot({ path: `${OUT}/02-register.png` });
await page.click('#btn-login');
await sleep(2500);

// 2) Logged-in nav now shows the Account tab.
await page.screenshot({ path: `${OUT}/03-nav-logged-in.png` });

// Open the account portal.
await page.evaluate(() => {
  document.querySelector('#nav-item-account')?.removeAttribute('hidden');
});
await page.click('#nav-btn-account');
await sleep(1500);
await page.screenshot({ path: `${OUT}/04-account-portal.png`, fullPage: true });

// Fill the password form for a focused shot.
await page.type('#account-current-pass', pass, { delay: 12 }).catch(() => {});
await page.type('#account-new-pass', 'newportalpass2', { delay: 12 }).catch(() => {});
await page.screenshot({ path: `${OUT}/05-settings.png` });

console.log('OK registered', user, '→ screenshots in', OUT);
await browser.close();
