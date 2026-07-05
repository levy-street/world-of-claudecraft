// Proof shots for the Aldrin Club membership window (PR #938):
//   01: a non-member panel with the perk list and per-method gating (the
//       signMessage-only wallet blocks every crypto rail; Stripe is advertised)
//   02: the USDC payment quote (amount, 50/50 treasury/buyback-burn split,
//       memo, static expiry) rendered through a can-sign wallet stub
//
// Offline UI proof only: the window's deps are stubbed through the same
// injected-deps seam main.ts wires (vite serves the real module), so what
// renders is the real window with the real view-core gating. There is
// deliberately NO payment path on this branch (the wallet cannot sign
// transactions online), which is why the rails-disabled notice is part of
// both shots.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes PNGs to
// docs/screenshots/aldrin/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/aldrin';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=900,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 900, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Aldrin');
await page.evaluate(() =>
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click(),
);
await page.evaluate(() => document.querySelector('#btn-start-offline').click());
await page.waitForFunction(
  () =>
    window.__game?.sim?.player &&
    getComputedStyle(document.querySelector('#ui')).display !== 'none',
  { timeout: 120000 },
);
await sleep(600);

// Shared stub payloads: the wire shapes the server's GET /api/aldrin and
// POST /api/aldrin/quote return (server/aldrin_club_http.ts).
const STATUS = {
  enabled: true,
  priceUsdCents: 2000,
  periodDays: 30,
  burnBps: 5000,
  methods: ['sol', 'usdc', 'woc', 'stripe'],
  perks: [
    { id: 'aura', kind: 'cosmetic' },
    { id: 'regalia', kind: 'cosmetic' },
    { id: 'mount', kind: 'cosmetic' },
    { id: 'title', kind: 'cosmetic' },
    { id: 'nameColor', kind: 'cosmetic' },
    { id: 'lounge', kind: 'access' },
    { id: 'wardrobe', kind: 'convenience' },
    { id: 'queue', kind: 'convenience' },
    { id: 'stipend', kind: 'convenience' },
  ],
  membership: null,
};

// Shot 1: non-member, signMessage-only wallet (this branch): every crypto rail
// is gated with its reason, Stripe stays selectable, rails notice visible.
await page.evaluate(async (status) => {
  const mod = await import('/src/ui/aldrin_club_window.ts');
  void mod.openAldrinClubWindow({
    status: async () => status,
    quote: async () => {
      throw new Error('unreachable in shot 1');
    },
    walletCanSignTransactions: false,
  });
}, STATUS);
await page.waitForSelector('.aldrin-club-panel', { timeout: 5000 });
await sleep(400);
let panel = await page.$('.aldrin-club-panel');
await panel.screenshot({ path: `${OUT}/01-non-member-gating.png` });
console.log(`shot -> ${OUT}/01-non-member-gating.png`);

// Shot 2: the USDC quote path through a can-sign wallet stub. $20 at 6
// decimals, split 50/50, 10-minute expiry; the real view core derives the
// percents and the static countdown.
await page.evaluate(() => document.querySelector('.aldrin-close-btn').click());
await sleep(200);
await page.evaluate(async (status) => {
  const mod = await import('/src/ui/aldrin_club_window.ts');
  void mod.openAldrinClubWindow({
    status: async () => status,
    quote: async (method) => ({
      quoteId: 'c0ffee5673d1c4a1b2e3f4a5b6c7d8e9',
      method,
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      decimals: 6,
      priceBase: '20000000',
      treasury: 'Treasury1111111111111111111111111111111111',
      buyback: 'Buyback11111111111111111111111111111111111',
      treasuryBase: '10000000',
      splitBase: '10000000',
      memo: 'c0ffee5673d1c4a1b2e3f4a5b6c7d8e9',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    }),
    walletCanSignTransactions: true,
  });
}, STATUS);
await page.waitForSelector('.aldrin-club-panel', { timeout: 5000 });
await page.click('.aldrin-method-btn[data-method="usdc"]');
await page.waitForSelector('.aldrin-quote', { timeout: 5000 });
await sleep(400);
panel = await page.$('.aldrin-club-panel');
await panel.screenshot({ path: `${OUT}/02-usdc-quote.png` });
console.log(`shot -> ${OUT}/02-usdc-quote.png`);

await browser.close();
