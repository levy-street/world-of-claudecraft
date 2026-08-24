// Before/after screenshots for the account-portal "Set a Password" section
// (fix/apple-signin-set-password): a passwordSet:false account (Apple- or
// Discord-provisioned, no real password yet) now sees a "Set a Password" form
// in place of "Change Password" on the Account Settings card. This is the
// pre-login marketing shell (index.html #account-view), not the in-game HUD,
// so it drives the account portal directly by DOM state (no live account
// backing it) rather than through window.__game / the offline entry flow.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5174';
const OUT_DIR = 'docs/screenshots/account-set-password';
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });

// Show the account view the way switchMainView does (toggle hidden + aria-hidden
// on the view sections), and populate the header fields so the card reads like a
// signed-in portal, all without a real backend session.
await page.evaluate(() => {
  for (const id of ['#hero-view', '#highscores-view', '#news-view', '#download-view']) {
    const el = document.querySelector(id);
    if (el) {
      el.setAttribute('hidden', '');
      el.setAttribute('aria-hidden', 'true');
    }
  }
  const view = document.querySelector('#account-view');
  view.removeAttribute('hidden');
  view.setAttribute('aria-hidden', 'false');
  document.querySelector('#account-logged-out').hidden = true;
  document.querySelector('#account-sections').hidden = false;
  document.querySelector('#account-username').textContent = 'Aelwyn';
  document.querySelector('#account-member-since').textContent = 'Member since Aug 12, 2026';
  document.querySelector('#account-char-count').textContent = '3 characters';
});

const clipCard = async (name) => {
  await new Promise((r) => setTimeout(r, 150));
  const box = await page.evaluate(() => {
    const el = document.querySelectorAll('.account-card')[0];
    const r = el.getBoundingClientRect();
    return { x: r.x - 16, y: r.y - 16, w: r.width + 32, h: r.height + 32 };
  });
  await page.screenshot({
    path: `${OUT_DIR}/${name}.png`,
    clip: { x: box.x, y: box.y, width: box.w, height: box.h },
  });
};

// BEFORE: an ordinary account (passwordSet:true), unaffected, still shows
// Change Password. This is the state every existing account was already in.
await page.evaluate(() => {
  document.querySelector('#account-password-form').hidden = false;
  document.querySelector('#account-set-password-form').hidden = true;
});
await clipCard('before-change-password');

// AFTER: an Apple/Discord-provisioned account with no real password yet
// (passwordSet:false) now sees "Set a Password" instead.
await page.evaluate(() => {
  document.querySelector('#account-password-form').hidden = true;
  document.querySelector('#account-set-password-form').hidden = false;
});
await clipCard('after-set-password');

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console/page errors');
await browser.close();
