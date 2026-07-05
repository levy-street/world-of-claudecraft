// Proof shots for the NFT PFP skins claim window: the picker with a linked
// Ethereum wallet (claim enabled for its rows, Solana rows gated), and the
// server-verified error path (not_owner) rendered in the feedback line.
//
// Offline UI proof only: the window's deps are stubbed through the same
// injected-deps seam main.ts wires (vite serves the real module), so what
// renders is the real window with real gating logic. Ownership verification
// itself is server-side and out of scope here.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes PNGs to
// docs/screenshots/nft/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/nft';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=900,860', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 900, height: 860 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Collector');
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

// Open the real window through its injected-deps seam with a linked Ethereum
// wallet and three supported collections; claim resolves the server's
// not_owner rejection so the error mapping renders.
await page.evaluate(async () => {
  const mod = await import('/src/ui/nft_skins_window.ts');
  void mod.openNftSkinsWindow({
    eligible: async () => ({
      wallets: { ethereum: '0x1a2B3c4D5e6F7a8B9c0D1e2F3a4B5c6D7e8F9a0B', solana: null },
      collections: [
        {
          chain: 'ethereum',
          contract: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
          name: 'Bored Ape Yacht Club',
          standard: 'erc721',
        },
        {
          chain: 'ethereum',
          contract: '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB',
          name: 'CryptoPunks',
          standard: 'cryptopunks',
        },
        {
          chain: 'solana',
          contract: 'J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w',
          name: 'Mad Lads',
          standard: 'metaplex',
        },
      ],
    }),
    claim: async () => {
      throw new Error('not_owner');
    },
    linkEthereum: async () => null,
    linkSolana: async () => null,
    onClaimed: () => {},
  });
});
await page.waitForSelector('.nft-skins-panel', { timeout: 5000 });
await sleep(400);
const panel = await page.$('.nft-skins-panel');
await panel.screenshot({ path: `${OUT}/01-claim-window.png` });
console.log(`shot -> ${OUT}/01-claim-window.png`);

// Type a token id into the first (linked, enabled) row and claim: the stubbed
// server rejection renders through the real error mapping.
await page.type('.nft-collection-row .nft-token-input', '3749');
await page.click('.nft-collection-row .nft-claim-btn');
await sleep(500);
await panel.screenshot({ path: `${OUT}/02-claim-not-owner.png` });
console.log(`shot -> ${OUT}/02-claim-not-owner.png`);

await browser.close();
