// Screenshot the solscan devnet pages for the deploy + each transaction type.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_PATH } from '../../../scripts/browser_path.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = JSON.parse(fs.readFileSync(path.join(__dir, 'devnet-results.json'), 'utf8'));
const shots = [
  ['deploy', '2YBhr8P966NRoSvwEAt7Y56hUEn96ntCsNrDwTxGGxAJvWqe5hHK3hrmeGbVE3xCL6tj1jR8mFynJ5uGwFpxHHuk'],
  ...results.confirmed.map((c) => [c.label.replace(/[^a-z0-9]+/gi, '_'), c.sig]),
];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new',
  args: ['--window-size=1280,1400', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 1400 },
});
const page = await browser.newPage();
for (const [label, sig] of shots) {
  // solscan.io is Cloudflare bot-walled for headless; the official Solana Explorer
  // renders the same on-chain tx (incl. token balance changes) without a challenge.
  const url = `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(4000); // let the SPA fetch + render the tx detail
    const out = path.join(OUT, `${label}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`shot ${label} -> ${out}`);
  } catch (e) { console.log(`shot ${label} FAILED: ${e.message}`); }
}
await browser.close();
