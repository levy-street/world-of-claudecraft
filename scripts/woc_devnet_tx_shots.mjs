// Screenshot the live-devnet woc_escrow proof: the upgraded program account plus one
// transaction per instruction type (open / join / settle / cancel / refund), from the
// official Solana explorer (cluster=devnet). Reads the signatures captured by
// tests/arena_escrow.devnet_alltypes.test.ts (DEVNET_SIGS_OUT) and writes PNGs to
// docs/screenshots/. Pure proof tooling; not part of the build.
//
//   node scripts/woc_devnet_tx_shots.mjs [path/to/sigs.json]
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROGRAM = 'Fn4LMsV7akGX9KXwYv4uh2v8nM2uqgaAxhKrsYYbZqcJ';
const DEPLOY_SIG = '5AW8ZUAZzG78HFSEnVQcPZjQv8aBUDk7B15kD2S4cacndhwAWGAPgGYLZ57gMRirhtL9vAAggwBf4QgSLRKxc5X7';
const sigs = JSON.parse(readFileSync(process.argv[2] ?? '/tmp/devnet_alltypes.json', 'utf8'));
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });

const tx = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
// One representative tx per instruction type + the program account + the deploy tx.
const shots = [
  { name: 'woc-devnet-program-upgrade', url: `https://explorer.solana.com/address/${PROGRAM}?cluster=devnet` },
  { name: 'woc-devnet-tx-deploy', url: tx(DEPLOY_SIG) },
  { name: 'woc-devnet-tx-open', url: tx(sigs.openSettle) },
  { name: 'woc-devnet-tx-join', url: tx(sigs.joinSettle) },
  { name: 'woc-devnet-tx-settle', url: tx(sigs.settle) },
  { name: 'woc-devnet-tx-cancel', url: tx(sigs.cancel) },
  { name: 'woc-devnet-tx-refund', url: tx(sigs.refund) },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1440,2000'] });
try {
  for (const s of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 2000, deviceScaleFactor: 2 });
    await page.goto(s.url, { waitUntil: 'networkidle2', timeout: 60_000 });
    // The explorer renders tx/account detail after the RPC round-trip; give React time
    // and wait for the status/overview card to be present.
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
