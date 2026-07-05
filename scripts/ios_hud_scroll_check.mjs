// Verifies the iOS HUD touch-scroll fix: the mobile HUD overlay (#ui) must
// permit one-finger panning so the Bag / Market scroll containers can scroll.
// On iOS, `body.mobile-touch #ui { touch-action: none }` blocked panning for the
// whole HUD subtree (Safari intersects touch-action down the ancestor chain, so
// a child's own pan-y can't re-enable it). This proves the shipped CSS resolves
// to a scrollable value while the old rule resolved to `none`, and screenshots
// an overflowing Bag + Market list under the mobile HUD skin.
//
// Boots the offline game on a desktop viewport (the headless mobile-emulated
// boot hangs on asset init), then activates `body.mobile-touch` + a landscape
// phone viewport (the only in-world orientation; portrait is blocked by the
// #rotate-device nudge) so the real mobile CSS applies. Needs `npm run dev`.
// Writes PNGs to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1280, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await page.waitForSelector('#offline-select .mini-class[data-class="warrior"]', { visible: true, timeout: 20000 });
await wait(200);
await page.evaluate(() => {
  document.querySelector('#char-name').value = 'Packrat';
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, { timeout: 20000, polling: 200 });
await wait(1500);

// Flood the bag (so it overflows) and the market (stand on the Merchant, list).
await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player; p.maxHp = 99999; p.hp = 99999;
  const bagItems = ['worn_sword', 'gnarled_staff', 'rusty_dagger', 'training_mace', 'rusty_hatchet',
    'recruit_tunic', 'apprentice_robe', 'footpad_jerkin', 'redbrook_blade', 'apprentice_staff',
    'keen_dirk', 'militia_vest', 'woven_robe', 'shadow_jerkin', 'oiled_boots', 'quilted_trousers',
    'greyjaw_pelt_cloak', 'greyjaw_hide_boots', 'bristleback_maul', 'sableweb_slippers',
    'cryptbone_greaves', 'cryptbone_helm', 'cryptbone_pauldrons', 'mistveil_cord', 'mistveil_grips',
    'boundstone_helm', 'boundstone_girdle', 'gravewyrm_mantle', 'gravewyrm_gauntlets', 'baked_bread',
    'minor_healing_potion', 'minor_mana_potion', 'lesser_healing_potion', 'healing_potion', 'mana_potion'];
  for (const id of bagItems) { try { sim.addItem(id, 3); } catch {} }
  try {
    const merchant = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant');
    if (merchant) {
      const at = (e, x, z) => { const q = sim.groundPos(x, z); e.pos = q; e.prevPos = { ...q }; };
      at(p, merchant.pos.x, merchant.pos.z - 3.2); p.facing = 0; p.prevFacing = 0;
      const goods = ['wolf_fang', 'wolf_pelt', 'spider_leg', 'keen_dirk', 'oiled_boots'];
      for (let i = 0; i < 6; i++) {
        const pid = sim.addPlayer(['mage', 'rogue', 'priest', 'hunter'][i % 4], 'Seller' + 'ABCDEF'[i]);
        for (let j = 0; j < 10; j++) {
          const id = goods[(i + j) % goods.length];
          sim.addItem(id, 1, pid);
          sim.marketList?.(id, 1, 100 + j * 10, pid);
        }
      }
    }
  } catch {}
});

// Switch to the mobile HUD skin + a LANDSCAPE phone viewport. In-world play is
// landscape-only (portrait shows the full-screen #rotate-device nudge), so this
// is the real orientation a player opens the Market / Bag in.
await page.setViewport({ width: 844, height: 390 });
await page.evaluate(() => document.body.classList.add('mobile-touch'));
await wait(200);

const touchActionOf = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? getComputedStyle(el).touchAction : '(missing)';
}, sel);
const overflowsOf = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? el.scrollHeight > el.clientHeight + 1 : false;
}, sel);

const after = {};

// AFTER (shipped fix), Market: open it first (Browse tab) on a clean HUD so no
// other window overlaps. Measure its scroll body + screenshot.
await page.evaluate(() => window.__game.hud.openMarket?.());
await wait(500);
after.uiTouchAction = await touchActionOf('#ui');
after.marketBodyTouchAction = await touchActionOf('#market-body');
after.marketOverflows = await overflowsOf('#market-body');
// openMarket() opens the Bag alongside (drag-to-sell); hide it so the Market
// list is the focus of this screenshot.
await page.evaluate(() => { document.querySelector('#bags').style.display = 'none'; });
await wait(100);
await page.screenshot({ path: 'tmp/ios_market_after.png' });

// AFTER, Bag: close the market, open the Bag. toggleBags() reads the inline
// style.display (initially '' → treated as open), so force a closed baseline
// first, then toggle to genuinely open it.
await page.evaluate(() => { window.__game.hud.closeMarket?.(); });
await wait(150);
await page.evaluate(() => {
  document.querySelector('#bags').style.display = 'none';
  window.__game.hud.toggleBags();
});
await wait(400);
after.bagGridTouchAction = await touchActionOf('#bags .bag-grid');
after.bagOverflows = await overflowsOf('#bags .bag-grid');
await page.screenshot({ path: 'tmp/ios_bag_after.png' });

// BEFORE (bug): re-inject the old blocking rule on the same Bag view.
await page.evaluate(() => {
  const s = document.createElement('style');
  s.id = 'repro-old-rule';
  s.textContent = 'body.mobile-touch #ui { touch-action: none !important; }';
  document.head.appendChild(s);
});
await wait(150);
const before = { uiTouchAction: await touchActionOf('#ui') };
await page.screenshot({ path: 'tmp/ios_bag_before.png' });
await page.evaluate(() => document.querySelector('#repro-old-rule')?.remove());

console.log('BEFORE (old `none` rule):', JSON.stringify(before));
console.log('AFTER  (shipped fix):    ', JSON.stringify(after));
// The fix is the touch-action flip on the shared #ui ancestor + non-blocking
// values on each scroll body. Overflow is logged as supporting context.
const pass = before.uiTouchAction === 'none'
  && after.uiTouchAction !== 'none'
  && after.bagGridTouchAction !== 'none'
  && after.marketBodyTouchAction !== 'none';
console.log(pass
  ? `PASS: HUD overlay permits touch panning (bag overflows=${after.bagOverflows}, market overflows=${after.marketOverflows}).`
  : 'FAIL: see values above.');
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
console.log('wrote tmp/ios_bag_before.png, tmp/ios_bag_after.png, tmp/ios_market_after.png');
await browser.close();
process.exit(pass ? 0 : 1);
