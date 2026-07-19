// Screenshot the live-devnet woc_auction_escrow proof: the deployed program
// account plus one representative transaction per instruction type (open / bid /
// settle / cancel) from the official Solana explorer (cluster=devnet). Reads the
// signatures captured by tests/woc_auction_escrow.devnet_alltypes.test.ts
// (devnet-proof.json) and writes PNGs to docs/screenshots/. Pure proof tooling;
// not part of the build.
//
// Adapted from wt-gamblefi-core/scripts/woc_devnet_tx_shots.mjs. Requires
// puppeteer-core + a local Chrome; when that is not available headless, the
// signature list + explorer links + Finalized status in devnet-proof.json is the
// proof artifact instead.
//
//   node scripts/woc_devnet_tx_shots.mjs [path/to/devnet-proof.json]

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const proof = JSON.parse(readFileSync(process.argv[2] ?? 'devnet-proof.json', 'utf8'));
const PROGRAM = proof.programId;
const sigs = proof.signatures;
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });

const tx = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
// The program account, the deploy tx, and one representative tx per type. bid2 is
// the atomic outbid refund; settle1 is the seller-payout-plus-rake-burn.
const shots = [
  { name: 'woc-auction-devnet-program', url: `https://explorer.solana.com/address/${PROGRAM}?cluster=devnet` },
  { name: 'woc-auction-devnet-tx-deploy', url: tx(proof.deploySignature) },
  { name: 'woc-auction-devnet-tx-open', url: tx(sigs.open1) },
  { name: 'woc-auction-devnet-tx-bid-atomic-refund', url: tx(sigs.bid2) },
  { name: 'woc-auction-devnet-tx-settle-payout-burn', url: tx(sigs.settle1) },
  { name: 'woc-auction-devnet-tx-cancel', url: tx(sigs.cancel2) },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,2000'],
});
try {
  for (const s of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 2000, deviceScaleFactor: 2 });
    await page.goto(s.url, { waitUntil: 'networkidle2', timeout: 60_000 });
    await page.waitForSelector('table, .card, [class*="Card"]', { timeout: 30_000 }).catch(() => {});
    await sleep(4000);
    const file = `${OUT}/${s.name}.png`;
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    console.log(`shot ${s.name} <- ${s.url}`);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('done');
