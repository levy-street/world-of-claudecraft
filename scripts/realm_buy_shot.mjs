// Standalone screenshot harness for the realm operator panel's NEW buy-with-
// SOL/USDC flow and the ongoing $WOC bond UI (#475). It does NOT drive the live
// app: the buy screen needs api.realmBuyInfo() data whose live prices come from
// mainnet Jupiter (unavailable locally), and the bond warning needs a bought
// realm in grace. So instead we esbuild-bundle the REAL src/ui/realm_operator.ts
// RealmOperator class, mount it with a STUBBED RealmOperatorHost returning
// realistic sample data, inline the panel's real .ro-* CSS from index.html, and
// puppeteer-screenshot it. Faithful (real component + real CSS) and deterministic.
//
// Pattern: export_loot_spreadsheet.mjs (esbuild self-bundle) + account_portal_shots.mjs
// (puppeteer-core). Outputs PNGs into docs/screenshots/. Build artifacts go under
// tmp/ (gitignored). Run: node scripts/realm_buy_shot.mjs
import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const root = process.cwd();
const srcDir = path.join(root, 'src');
const tmpDir = path.join(root, 'tmp');
const outDir = path.join(root, 'docs', 'screenshots');
mkdirSync(tmpDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// 1) Pull the panel's CSS out of index.html so the bundled RealmOperator renders
//    with its real .ro-* styles (plus :root vars, .btn*, .panel, .auth-panel*).
//    There is one <style> block; inline it whole.
// ---------------------------------------------------------------------------
const indexHtml = readFileSync(path.join(root, 'index.html'), 'utf8');
const styleBlocks = [...indexHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
if (styleBlocks.length === 0) throw new Error('No <style> block found in index.html');
const css = styleBlocks.join('\n');

// ---------------------------------------------------------------------------
// 2) esbuild-bundle a small TS entry that mounts the REAL RealmOperator with a
//    stubbed host. We inline the entry into tmp/ so its relative import of
//    ../src/ui/realm_operator resolves, then bundle to an IIFE we drop into the
//    harness page as inline JS (so file:// needs no static server).
// ---------------------------------------------------------------------------

// FIXED timestamps so the rendered dates are deterministic (no Date.now()).
// Pretend "now" is 2026-06-25; the in-grace realm's top-up deadline is ~5 days out.
const BOND_GRACE_UNTIL = '2026-06-30T17:00:00.000Z';

// The stub host + sample data, as a TS source the bundle compiles. The api is a
// plain object implementing only the methods RealmOperator.open()/render() call:
// realmTiers, realmBuyInfo, myRealms (the three awaited in open()). The wallet glue
// returns a connected, linked state so the panel shows its founding form fully.
const entrySource = `
import { RealmOperator } from '../src/ui/realm_operator';
import { setLanguage } from '../src/ui/i18n';

// English is statically resident (currentLanguage defaults to 'en' and the en
// resolved table is eagerly imported), so a plain setLanguage('en') is enough for
// t() to return English; no ensureLocaleLoaded() needed for the resident locale.
setLanguage('en');

const WOC_MINT = '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth';
const TREASURY = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j';
const BUYBACK = '8xj1k9Qn3pVeRc2mYtHbWqLZ4dFgN7sUvT6rA1oP3eX';
const SAMPLE_WALLET = '7nQ2bF9rK4mXp1wZ8sVcD6tLgYhE3aJ5uN0RqWoP2dM';

const buyInfo = {
  wocMint: WOC_MINT,
  wocDecimals: 6,
  supplyBase: '1000000000000000',
  treasuryBps: 7000,
  treasury: TREASURY,
  buybackVault: BUYBACK,
  maxPerAccount: 3,
  bondBps: 1000,
  currencies: [
    { key: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, native: false },
    { key: 'SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9, native: true },
  ],
  tiers: [
    { tier: 1, name: 'bronze', bps: 100, wocBase: '10000000000000', bondBase: '1000000000000', prices: { USDC: '12000000000', SOL: '85000000000' } },
    { tier: 2, name: 'silver', bps: 500, wocBase: '50000000000000', bondBase: '5000000000000', prices: { USDC: '60000000000', SOL: '420000000000' } },
    { tier: 3, name: 'gold', bps: 1000, wocBase: '100000000000000', bondBase: '10000000000000', prices: { USDC: '120000000000', SOL: '840000000000' } },
  ],
};

const tiersInfo = {
  mint: WOC_MINT,
  decimals: 6,
  supplyBase: '1000000000000000',
  timelockSeconds: 259200,
  maxPerAccount: 3,
  tiers: [
    { tier: 1, name: 'bronze', bps: 100, amountBase: '10000000000000' },
    { tier: 2, name: 'silver', bps: 500, amountBase: '50000000000000' },
    { tier: 3, name: 'gold', bps: 1000, amountBase: '100000000000000' },
  ],
};

const ownedRealms = [
  // A bought GOLD realm currently BELOW its bond: bondGraceUntil set -> warning.
  { realmId: 42, name: 'Ironhold', type: 'Normal', status: 'active', tier: 3, url: '',
    releaseEligibleAt: null, bondBase: '10000000000000', bondGraceUntil: '${BOND_GRACE_UNTIL}' },
  // A bought BRONZE realm in good standing: bondGraceUntil null -> calm info line.
  { realmId: 43, name: 'Stormreach', type: 'PvP', status: 'active', tier: 1, url: '',
    releaseEligibleAt: null, bondBase: '1000000000000', bondGraceUntil: null },
];

// Only the methods RealmOperator actually calls during open()/render() need real
// returns; the rest are benign no-ops so nothing rejects unhandled mid-render.
const api = {
  realmTiers: async () => tiersInfo,
  realmBuyInfo: async () => buyInfo,
  myRealms: async () => ownedRealms,
  // Never reached in screenshot mode (no submit click), but stubbed for safety.
  quoteRealm: async () => { throw new Error('not used in harness'); },
  quoteRealmBuy: async () => { throw new Error('not used in harness'); },
  confirmRealm: async () => ({}),
  confirmRealmBuy: async () => ({}),
  decommissionRealm: async () => ({ closed: true }),
  releaseRealm: async () => ({}),
};

const host = {
  api,
  linkedWallet: () => SAMPLE_WALLET,
  ensureWalletReady: async () => SAMPLE_WALLET,
  signLock: async () => null,
  signPurchase: async () => null,
  affiliateCode: () => null,
  enterRealm: () => {},
  close: () => {},
};

const container = document.getElementById('realm-operator-body');
const op = new RealmOperator(container, host);

// Drive the panel deterministically from the puppeteer side. The panel toggles its
// own state via clicks on the rendered DOM, so expose tiny helpers that click the
// real selectors (the buy method tab .ro-method-tab[data-method=buy], a currency
// tab .ro-method-tab[data-currency=...], a tier .ro-tier[data-tier=...]).
function clickByData(attr, value) {
  const el = container.querySelector('.ro-method-tab[data-' + attr + '="' + value + '"], .ro-tier[data-' + attr + '="' + value + '"]');
  if (el) el.click();
  return !!el;
}

window.__shot = {
  ready: false,
  // Switch to the BUY method, pick a currency, select a tier -> the per-tier price,
  // the 70/30 split note, and the ongoing $WOC bond line all render together.
  showBuyTier(currency, tier) {
    clickByData('method', 'buy');
    if (currency) clickByData('currency', currency);
    clickByData('tier', String(tier));
  },
};

(async () => {
  await op.open();                 // awaits loadTiers + loadBuyInfo + loadOwned
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__shot.ready = true;
})();
`;

const entryPath = path.join(tmpDir, 'realm_buy_shot_entry.ts');
writeFileSync(entryPath, entrySource);

const build = await esbuild.build({
  entryPoints: [entryPath],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  logLevel: 'silent',
  absWorkingDir: root,
  // src/ui/i18n pulls in the resident en table; keep the bundle self-contained.
  loader: { '.ts': 'ts' },
  // Vite normally statically replaces import.meta.env.* . esbuild leaves the bare
  // access in place, which throws at runtime (reading .PROD of undefined). Define it
  // as a dev (non-release) build: import.meta.env.PROD === false, so t() renders
  // English for any pending key rather than hard-failing. (The realmOp.* domain is
  // English-only and fully resident, so nothing is pending anyway.)
  define: {
    'import.meta.env.PROD': 'false',
    'import.meta.env.DEV': 'true',
    'import.meta.env.MODE': '"development"',
    'import.meta.env': '{"PROD":false,"DEV":true,"MODE":"development"}',
  },
});
const bundledJs = build.outputFiles[0].text;

// ---------------------------------------------------------------------------
// 3) Assemble the harness HTML: inlined <style>, the panel chrome the app wraps
//    the body in (#realm-operator-panel.panel.auth-panel.auth-panel-premium), a
//    #realm-operator-body the bundle mounts into, and the IIFE inline. A dark page
//    background so the (transparent) panel text is readable. Written to tmp/ and
//    loaded via file:// (no server needed since the JS is inlined).
// ---------------------------------------------------------------------------
const harnessHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Alegreya+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
${css}
</style>
<style>
  /* Harness-only page chrome: dark backdrop + centered panel, matching the app. */
  html, body {
    margin: 0; padding: 0;
    background: radial-gradient(120% 120% at 50% 0%, #161320 0%, #0a0a10 60%, #060609 100%);
    min-height: 100vh; color: #f0ead8; font-family: var(--font-ui, system-ui, sans-serif);
  }
  .harness-wrap { display: flex; justify-content: center; padding: 28px 20px 40px; }
  /* Let the panel grow tall enough that the full founding form + bond UI is in frame. */
  #realm-operator-panel .ro { max-height: none; overflow: visible; }
  #realm-operator-panel { margin: 0; }
</style>
</head>
<body>
<div class="harness-wrap">
  <div id="realm-operator-panel" class="panel auth-panel auth-panel-premium">
    <h2 class="auth-title"><span>Realm Operator</span> <span id="realm-operator-user" class="cs-realm">operator</span></h2>
    <div id="realm-operator-body"></div>
    <div class="auth-actions auth-actions-split">
      <button type="button" class="btn btn-secondary">Back</button>
    </div>
  </div>
</div>
<script>
${bundledJs}
</script>
</body>
</html>`;

const harnessPath = path.join(tmpDir, 'realm_buy_shot.html');
writeFileSync(harnessPath, harnessHtml);

// ---------------------------------------------------------------------------
// 4) Puppeteer: load the harness, wait for the panel to settle, drive the buy /
//    bond states via window.__shot, and capture the PNGs.
// ---------------------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  // Collect real script errors only. Relative asset URLs in the inlined CSS
  // (cursor images, decorative backgrounds referencing /assets/...) 404 over
  // file:// and are irrelevant to the panel layout, so drop those ERR_FILE_NOT_FOUND
  // resource-load lines and keep genuine page exceptions.
  const pageErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) {
      pageErrors.push(m.text());
    }
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('file://' + harnessPath, { waitUntil: 'networkidle0' });
  // Wait for the async open() loads (tiers/buyInfo/owned) to settle.
  await page.waitForFunction(() => window.__shot && window.__shot.ready === true, { timeout: 15000 })
    .catch(async (err) => {
      const state = await page.evaluate(() => ({
        hasShot: typeof window.__shot,
        bodyHtml: (document.getElementById('realm-operator-body') || {}).innerHTML?.slice(0, 300),
      }));
      console.log('Panel did not finish mounting. State:', JSON.stringify(state));
      throw err;
    });
  // Give the web fonts a beat to swap in.
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await sleep(400);

  const panel = await page.$('#realm-operator-panel');
  const written = [];

  // Clip to a given element so the relevant content is fully framed and legible.
  async function shot(el, file) {
    const out = path.join(outDir, file);
    const box = await el.boundingBox();
    await el.screenshot({ path: out });
    // boundingBox is CSS px; the file is deviceScaleFactor x that.
    written.push({ file: out, css: box });
    return out;
  }

  // (a) BUY founding screen: buy method, USDC, gold tier selected -> the per-tier
  //     price ("120,000 USDC"), the 70/30 split note, and the ongoing $WOC bond line.
  await page.evaluate(() => window.__shot.showBuyTier('USDC', 3));
  await sleep(250);
  await shot(panel, 'realm-buy-founding.png');

  // (b) Same screen with SOL selected, to show the second rail (price re-prices to
  //     "840 SOL"; the bond stays a $WOC hold, now noted as separate from the SOL paid).
  await page.evaluate(() => window.__shot.showBuyTier('SOL', 3));
  await sleep(250);
  await shot(panel, 'realm-buy-currency.png');

  // (c) The operator dashboard's owned realms incl. the bond grace WARNING. Clip to
  //     the "My Realms" (.ro-mine) section so the warning is the focus.
  const mineHandle = await page.evaluateHandle(() =>
    document.querySelector('#realm-operator-body .ro-mine'));
  const mineEl = mineHandle.asElement();
  await shot(mineEl ?? panel, 'realm-operator-bond-warning.png');

  const dsf = 2; // deviceScaleFactor set on the viewport
  console.log('Wrote ' + written.length + ' screenshots:');
  for (const w of written) {
    const px = w.css ? Math.round(w.css.width * dsf) + 'x' + Math.round(w.css.height * dsf) : 'unknown';
    console.log('  ' + path.relative(root, w.file) + '  (' + px + ' px)');
  }
  if (pageErrors.length) {
    console.log('\nScript errors on the page (' + pageErrors.length + '):');
    for (const e of pageErrors) console.log('  ' + e);
  } else {
    console.log('\nNo script errors on the page.');
  }
} finally {
  await browser.close();
}
