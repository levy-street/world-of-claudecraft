// Screenshots of the devnet transactions produced by job_escrow_devnet_e2e.mjs.
// Solscan blocks headless browsers (Cloudflare), so these capture the official
// Solana Explorer page for the same signatures — same on-chain proof. The Solscan
// links live in devnet-tx-links.json.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const OUT = 'docs/screenshots/jobs';
const { links } = JSON.parse(fs.readFileSync(`${OUT}/devnet-tx-links.json`, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1200, height: 1300 },
});

let i = 0;
for (const { label, url } of links) {
  const sig = url.match(/tx\/([^?]+)/)[1];
  const explorer = `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  const page = await browser.newPage();
  await page.goto(explorer, { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => console.log(`goto ${label}:`, e.message));
  // Wait for the explorer to render the transaction result.
  await page.waitForFunction(() => /Finalized|Confirmed|Success|Result/i.test(document.body.innerText), { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  const file = `${OUT}/tx-${String(++i).padStart(2, '0')}-${slug(label)}.png`;
  await page.screenshot({ path: file });
  console.log(`${label} → ${file}`);
  await page.close();
}
console.log('done');
await browser.close();
