// Before/after proof screenshot for the locked-material-stack Vault deposit fix.
//
// Bug: locking a stack of 20 (item_lock.ts setItemLocked locks the WHOLE
// stack, one flag over the whole count) then depositing it into the
// Materials Vault split it into 20 separate one-unit rows instead of ONE
// row carrying the full count, because material_stack_packing.ts's
// buildPackingModel treated ANY non-mergeable instance payload (locked
// included) as one-per-fresh-slot, a rule that only actually applies to a
// charge-bearing payload's genuine per-unit identity.
//
// Grants a locked stack of 20 iron_ore directly (the debug-hook precedent
// other before/after proof scripts use, e.g. rift_currency_pipe_shot.mjs),
// stands the player at the banker, opens the real Bank window, buys the
// Vault's rung-0 unlock, switches to the Vault tab, and clicks the REAL
// "Deposit All" button (#bank-window .vault-deposit-all) so the screenshot
// proves the fix through the actual UI path a player uses, not a bare sim call.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { dismissEntryOverlays, enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? 'tmp/vault-locked-stack.png';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Standing capture rule: seed the LOWEST graphics preset before boot.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Ledger',
  gameBootTimeoutMs: 120000,
  selectorTimeoutMs: 60000,
  settleMs: 4000,
});
if (!booted) throw new Error('offline world did not boot');
await dismissEntryOverlays(page);
await awaitWorldPainted();
await sleep(300);

/** Blocks until #loading-screen is not painted over the viewport. The
 *  backdrop can re-raise after a teleport/world-mutation well after
 *  window.__game was published (the charter_store_shot.mjs precedent: a
 *  screenshot taken right after staging can still land mid-curtain even
 *  though every DOM assertion above it already passed). */
async function awaitWorldPainted() {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('loading-screen');
      if (!el) return false;
      const cs = getComputedStyle(el);
      return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
    },
    { timeout: 120000 },
  );
}

async function pollForSize(sel, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rect = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }, sel);
    if (rect && rect.w > 0 && rect.h > 0) return true;
    await sleep(50);
  }
  return false;
}

// Stand at the banker (bank-vault target idiom), grant a locked stack of 20
// iron ore, buy the Vault's rung-0 unlock, and open the Bank window.
const staged = await page.evaluate(() => {
  const sim = window.__game?.sim;
  if (!sim) return { ok: false };
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === 'bursar_fernando') {
      const p = sim.entities.get(sim.playerId);
      p.pos = { ...e.pos };
      p.prevPos = { ...p.pos };
      sim.rebucket(p);
      break;
    }
  }
  const meta = sim.players.get(sim.playerId);
  meta.copper = 200000;
  sim.addItem('iron_ore', 20, sim.playerId);
  const slotIndex = meta.inventory.findIndex((s) => s.itemId === 'iron_ore');
  sim.setItemLocked('iron_ore', true, sim.playerId, slotIndex);
  const lockedOk =
    slotIndex >= 0 &&
    meta.inventory[slotIndex]?.instance?.locked === true &&
    meta.inventory[slotIndex]?.count === 20;
  sim.vaultBuyUpgrade(); // rung 0: the 2g unlock, ceiling 40
  window.__game?.hud?.openBank?.();
  return { ok: true, lockedOk };
});
if (!staged.ok || !staged.lockedOk) {
  throw new Error(`could not stage a whole locked stack of 20: ${JSON.stringify(staged)}`);
}
if (!(await pollForSize('#bank-window'))) throw new Error('bank window did not open');
const tabReady = await pollForSize('#bank-window .bank-tab[data-tab="vault"]');
if (!tabReady) throw new Error('vault tab did not render');
await page.evaluate(() => {
  document.querySelector('#bank-window .bank-tab[data-tab="vault"]')?.click();
});
if (!(await pollForSize('#bank-window .vault-pane'))) {
  throw new Error('vault pane did not render after the tab click');
}
await sleep(200);

// Click the REAL Deposit All button: the exact control a player presses.
const clicked = await page.evaluate(() => {
  const btn = document.querySelector('#bank-window .vault-deposit-all');
  if (!(btn instanceof HTMLButtonElement) || btn.disabled) return false;
  btn.click();
  return true;
});
if (!clicked) throw new Error('could not click the real Deposit All button');
await sleep(400);

const state = await page.evaluate(() => {
  const sim = window.__game?.sim;
  const meta = sim?.players.get(sim.playerId);
  const rows = (meta?.vault.special ?? []).filter((s) => s.itemId === 'iron_ore');
  return {
    carriedIronOre: (meta?.inventory ?? []).filter((s) => s.itemId === 'iron_ore').length,
    vaultRowCount: rows.length,
    vaultRowCounts: rows.map((s) => s.count),
    vaultStoredTotal: rows.reduce((n, s) => n + s.count, 0),
  };
});
console.log('STATE:', JSON.stringify(state));

await awaitWorldPainted();
await sleep(200);
await page.screenshot({ path: OUT });
console.log(`RESULT wrote ${OUT}`);
await browser.close();
