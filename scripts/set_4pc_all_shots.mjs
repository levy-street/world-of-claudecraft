// Real in-game visual proof for the "4-piece bonuses for every epic set" PR.
// Boots the OFFLINE game client, equips 4 pieces of the new proc sets, and
// captures the live item-set tooltips (the (4) line with its % chance).
//
//   node scripts/set_4pc_all_shots.mjs   (needs `npm run dev`; GAME_URL overrides)
//
// Shots:
//   set-4pc-barrowlord-ingame.png   warrior, 4 Barrowlord pieces -> Gravemight (4) line
//   set-4pc-direfang-ingame.png     hunter, 4 Direfang pieces -> Ragged Gash (4) line
//   own-aura-target-strip.png       the target strip leading with the player's own
//                                   (enlarged, gold-glowed) bleed among the mob's auras
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

// ---- Shot 1: Barrowlord (plate) 4-piece tooltip with the Gravemight proc ----
{
  const page = await boot('warrior', 'Barrowzug');
  const r = await equip(page, [
    'deathlord_warplate',
    'deathlord_legguards',
    'deathlord_sabatons',
    'deathlords_dread_visage',
  ]);
  console.log('barrowlord equip ->', JSON.stringify(r.equipment));
  await wait(600);
  console.log('char opened:', await openChar(page));
  await shotSlotTooltip(page, 'chest', 'set-4pc-barrowlord-ingame.png');
  await closeChar(page);
  await page.close();
}

// ---- Shot 2: Direfang (leather) 4-piece tooltip with the Bared Fangs proc ----
{
  const page = await boot('hunter', 'Fangora');
  const r = await equip(page, [
    'nighttalon_grips',
    'nighttalon_waistband',
    'nighttalon_crown',
    'nighttalon_shoulderguards',
  ]);
  console.log('direfang equip ->', JSON.stringify(r.equipment));
  await wait(600);
  console.log('char opened:', await openChar(page));
  await shotSlotTooltip(page, 'gloves', 'set-4pc-direfang-ingame.png');
  await closeChar(page);
  await page.close();
}

// ---- Shot 3: the target strip with the player's own bleed enlarged + first ----
{
  const page = await boot('warrior', 'Critgar');
  await equip(page, [
    'crownforged_gauntlets',
    'crownforged_girdle',
    'crownforged_dreadhelm',
    'crownforged_warspaulders',
  ]);
  await wait(400);
  // Spawn a tough wolf next to the player, target it, crit it (guaranteed) so the
  // Bonesplinter bleed applies and the strip leads with the enlarged own aura.
  const applied = await page.evaluate(() => {
    const g = window.__game;
    const sim = g.sim;
    const p = sim.player;
    p.gm = true;
    p.critChance = 1;
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
    if (!mob) return { ok: false };
    mob.pos = { x: p.pos.x + 2, y: p.pos.y, z: p.pos.z };
    mob.prevPos = { ...mob.pos };
    mob.maxHp = 100000;
    mob.hp = 100000;
    sim.targetEntity(mob.id, p.id);
    p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
    for (let i = 0; i < 6; i++) sim.meleeSwing(p, mob, 0, null, {});
    return { ok: true, bleed: mob.auras.some((a) => a.id === 'set_bonesplinter') };
  });
  console.log('own-aura scene ->', JSON.stringify(applied));
  await wait(800); // let the HUD paint the strip
  // The aura strip renders below the frame body, so extend the clip past the
  // frame rect instead of shooting the (strip-less) element box.
  const frameBox = await page.evaluate(() => {
    const el = document.querySelector('#target-frame');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (frameBox) {
    await page.screenshot({
      path: `${OUT}/own-aura-target-strip.png`,
      clip: {
        x: Math.max(0, frameBox.x - 8),
        y: Math.max(0, frameBox.y - 8),
        width: frameBox.width + 16,
        height: frameBox.height + 96, // room for the aura strip below the frame
      },
    });
    console.log('wrote own-aura-target-strip.png (extended clip)');
  }
  await page.close();
}

await browser.close();
console.log('done; shots in', OUT);
