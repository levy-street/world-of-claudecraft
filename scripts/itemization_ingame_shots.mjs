// Real in-game visual proof for the itemization epic (PR #1471). Boots the
// OFFLINE game client, spawns and equips the actual set/legendary items, and
// captures the live HUD surfaces (character window + item tooltips) rather than
// a mocked-up HTML panel. Writes tight element crops to docs/screenshots/.
//
//   node scripts/itemization_ingame_shots.mjs   (needs `npm run dev` on :5173)
//
// Shots:
//   rating-stats-ingame.png       hunter with 3 Direfang pieces -> Crit + Haste Rating cells
//   set-4pc-ingame.png            priest with 4 Mournweave pieces -> item-set tooltip incl the 4-set
//   legendary-thronebane-ingame.png   Thronebane legendary sword tooltip (Chain Arc proc)
//   legendary-heartwood-ingame.png    Heartwood legendary staff tooltip (Deathbloom / Lifebloom)
//   epic-set-names-ingame.png     paperdoll of the equipped Mournweave set (names match the set)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});

async function boot(cls, name) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  const jsClick = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) throw new Error(`missing ${s}`);
      el.click();
    }, sel);
  await wait(400);
  await jsClick('#btn-offline');
  await wait(300);
  await page.type('#char-name', name);
  await jsClick(`#offline-select .mini-class[data-class="${cls}"]`);
  await jsClick('#btn-start-offline');
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 40000 });
  await wait(1500);
  // A freshly created character plays a first-spawn intro cinematic that keeps
  // the HUD (#ui) hidden until the camera lands; Escape skips it.
  await page.keyboard.press('Escape');
  await wait(600);
  // Dismiss the new-adventurer tutorial overlay (it intercepts input).
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /skip tutorial/i.test(b.textContent || ''),
    );
    btn?.click();
  });
  await wait(400);
  // Wait for the HUD to actually reveal (intro fully finished).
  await page
    .waitForFunction(
      () => {
        const ui = document.getElementById('ui');
        return ui && getComputedStyle(ui).display !== 'none';
      },
      { timeout: 15000 },
    )
    .catch(() => console.log('WARN: #ui still hidden after intro skip'));
  await wait(300);
  return page;
}

// Give + equip a list of item ids on the offline player. Raid gear carries a
// level requirement, so bump the offline character to max level first.
async function equip(page, ids) {
  return page.evaluate((list) => {
    const sim = window.__game.sim;
    const pid = sim.player.id;
    sim.setPlayerLevel(99, pid); // clamps to MAX_LEVEL
    for (const id of list) {
      sim.addItem(id, 1, pid);
      sim.equipItem(id, pid);
    }
    return {
      level: sim.player.level,
      equipment: { ...sim.equipment },
      crit: sim.player.critRating,
      haste: sim.player.hasteRating,
    };
  }, ids);
}

// Ensure the character window is open (its minimap button toggles it; a
// just-equipped level-up can steal focus, so verify and retry).
async function openChar(page) {
  for (let i = 0; i < 4; i++) {
    const open = await page.evaluate(() => {
      const cw = document.querySelector('#char-window');
      return cw && getComputedStyle(cw).display !== 'none';
    });
    if (open) return true;
    await page.evaluate(() => document.querySelector('#mm-char')?.click());
    await wait(600);
  }
  return false;
}

async function closeChar(page) {
  const open = await page.evaluate(() => {
    const cw = document.querySelector('#char-window');
    return cw && getComputedStyle(cw).display !== 'none';
  });
  if (open) {
    await page.evaluate(() => document.querySelector('#mm-char')?.click());
    await wait(400);
  }
}

async function bagItems(page, ids) {
  return page.evaluate((list) => {
    const sim = window.__game.sim;
    const pid = sim.player.id;
    for (const id of list) sim.addItem(id, 1, pid);
    return sim.inventory.map((s) => s?.itemId).filter(Boolean);
  }, ids);
}

// Screenshot the visible panel behind `sel`. Some windows are a 0-size wrapper
// whose real panel is a child, so measure the largest visible box and clip the
// page to it (falling back to a full-viewport shot).
async function shotEl(page, sel, file) {
  const box = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    let r = el.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) {
      let best = null;
      for (const c of el.querySelectorAll('*')) {
        const cr = c.getBoundingClientRect();
        if (
          cr.width > 5 &&
          cr.height > 5 &&
          (!best || cr.width * cr.height > best.width * best.height)
        )
          best = cr;
      }
      if (best) r = best;
    }
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, sel);
  if (!box) {
    console.log('MISSING element for shot:', sel, file);
    return false;
  }
  if (box.width < 5 || box.height < 5) {
    await page.screenshot({ path: `${OUT}/${file}` });
    console.log('wrote (fullpage fallback)', file);
    return true;
  }
  const clip = {
    x: Math.max(0, box.x - 8),
    y: Math.max(0, box.y - 8),
    width: Math.min(1600 - Math.max(0, box.x - 8), box.width + 16),
    height: Math.min(900 - Math.max(0, box.y - 8), box.height + 16),
  };
  await page.screenshot({ path: `${OUT}/${file}`, clip });
  console.log('wrote', file, JSON.stringify(clip));
  return true;
}

// Hover an equipped paperdoll slot (#equip-slot-<slot>) and screenshot its item
// tooltip. The char window repaints each frame (which can drop the hovered row
// and hide #tooltip), so we jiggle to re-fire mouseenter/mousemove, confirm the
// tooltip is visible, and capture immediately in the same tight loop.
async function shotSlotTooltip(page, slot, file) {
  const sel = `#equip-slot-${slot}`;
  const box = await page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), ok: r.width > 2 };
  }, sel);
  if (!box || !box.ok) {
    console.log('slot not laid out:', sel);
    return false;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.mouse.move(8, 8);
    await wait(120);
    await page.mouse.move(box.x, box.y, { steps: 4 });
    await wait(160);
    await page.mouse.move(box.x + 3, box.y + 1); // jiggle -> mousemove keeps it up
    await wait(140);
    const shown = await page.evaluate(() => {
      const tt = document.querySelector('#tooltip');
      return !!tt && getComputedStyle(tt).display !== 'none' && (tt.innerText || '').length > 10;
    });
    if (shown) {
      const ok = await shotEl(page, '#tooltip', file);
      if (ok) return true;
    }
  }
  console.log('WARN: tooltip never stayed visible for', sel, file);
  return false;
}

// ---- Shot 1: rating stats (hunter, 3 Direfang / nighttalon leather pieces) ----
{
  const page = await boot('hunter', 'Ranger');
  const r = await equip(page, ['nighttalon_grips', 'nighttalon_waistband', 'nighttalon_crown']);
  console.log('rating equip ->', JSON.stringify(r));
  await wait(600); // let level-up/equip events settle
  console.log('char opened:', await openChar(page));
  await shotEl(page, '#char-window', 'rating-stats-ingame.png');
  await page.close();
}

// ---- Shots 2 + 4: caster (priest) with 4 Mournweave + the Heartwood staff ----
{
  const page = await boot('priest', 'Cleric');
  const r = await equip(page, [
    'necromancers_starshroud',
    'necromancers_soulspire_mantle',
    'necromancers_legwraps',
    'necromancers_soulsteps',
    'deathless_heartwood', // legendary staff (mainhand) - priest can wield it
  ]);
  console.log('mournweave equip ->', JSON.stringify(r.equipment));
  await wait(600);
  // Epic-set names: the equipped paperdoll shows every slot named for the set.
  console.log('char opened:', await openChar(page));
  await shotEl(page, '#char-window', 'epic-set-names-ingame.png');
  // 4-set tooltip: hover the equipped Mournweave chest -> item + set block (2/3/4).
  await shotSlotTooltip(page, 'chest', 'set-4pc-ingame.png');
  // Legendary staff tooltip: hover the equipped mainhand.
  await shotSlotTooltip(page, 'mainhand', 'legendary-heartwood-ingame.png');
  await page.close();
}

// ---- Shot 3: warrior with the Thronebane legendary sword equipped ----
{
  const page = await boot('warrior', 'Warblade');
  const r = await equip(page, ['kingsbane_last_oath']); // legendary sword (mainhand)
  console.log('thronebane equip ->', JSON.stringify(r.equipment));
  await wait(600);
  console.log('char opened:', await openChar(page));
  await shotSlotTooltip(page, 'mainhand', 'legendary-thronebane-ingame.png');
  await page.close();
}

await browser.close();
console.log('done');
