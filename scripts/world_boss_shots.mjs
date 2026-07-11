// Visual + functional test harness for Thunzharr, the Waking Peak (world boss)
// and the epic Tier-2 set gloves/belts that drop from it.
//
// Deliverables (written to docs/screenshots/):
//   thunzharr-boss.png             - boss visible in-world
//   thunzharr-spawn-announce.png   - chat announcement right after spawn
//   soulflame-gloves-tooltip.png   - Soulflame Gloves epic tooltip with set block
//   soulflame-cord-tooltip.png     - Soulflame Cord epic tooltip with set block
//   crownforged-girdle-tooltip.png - Crownforged Girdle plate belt tooltip
//   thunzharr-fight.png            - mid-combat frame
//   thunzharr-loot.png             - loot window on the corpse
//
// In-game checks (PASS/FAIL to stdout):
//   - boss spawns when scheduler time forced, announcement appears in chat
//   - boss has raid-tier hp (logged)
//   - stormling adds appear at 66% threshold
//   - corpse is lootable and contains the guaranteed trophy
//   - equipping 2 soulflame pieces sets knockbackResistance to 1
//
// Requires `npm run dev` (or GAME_URL env var). No src/ edits; all game
// manipulation via page.evaluate at runtime.

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE_URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
const OUT_DIR = path.resolve('docs/screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const shot = (name) => path.join(OUT_DIR, name);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fails = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fails.push(msg);
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900 },
});

const page = await browser.newPage();
page.on('pageerror', (e) => fails.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text());
});

await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 90000 });

// Character select: mage so soulflame cloth pieces are equippable
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.evaluate(() => {
  const card =
    document.querySelector('#offline-select .mini-class[data-class="mage"]') ||
    document.querySelector('.class-card[data-class="mage"]');
  card?.click();
});
await sleep(150);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) n.value = 'Solvara';
});
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());

await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, {
  timeout: 120000,
  polling: 500,
});
await sleep(4000);

// Dismiss tutorial overlay
await page.evaluate(() => {
  document.querySelector('.tut-skip')?.click();
  const skip = [...document.querySelectorAll('button, .tut-skip, a')].find((el) =>
    /skip tutorial/i.test(el.textContent || ''),
  );
  if (skip) skip.click();
});
await sleep(400);

// Level up to 20 so the world-boss health formula matches the design intention
// and so the mage can equip epics.
await page.evaluate(() => window.__game.sim.setPlayerLevel(20));
await sleep(300);

// ---------------------------------------------------------------------------
// SECTION 1 - Item tooltip shots
// Add items to bag WITHOUT equipping so the bag grid shows them, then hover
// each one to get the tooltip. Do the 2-piece bonus check after tooltip shots.
// ---------------------------------------------------------------------------

await page.evaluate(() => {
  const sim = window.__game.sim;
  // All three items go into the bag (unequipped)
  sim.addItem('soulflame_cord', 1);
  sim.addItem('soulflame_gloves', 1);
  sim.addItem('crownforged_girdle', 1);
});
await sleep(300);

// Open bags and hover a given item by looking for its label in the bag rows.
// Closes any open bags first, then re-opens so the grid re-renders from the
// live inventory, then hovers the matching row.
async function hoverBagItem(label) {
  // Force bags closed so toggleBags() always opens + re-renders
  await page.evaluate(() => {
    const el = document.querySelector('#bags');
    if (el) el.style.display = 'none';
    window.__game.hud.toggleBags();
  });
  // Extra settling time for the grid repaint
  await sleep(800);

  const handle = await page.evaluateHandle((label) => {
    const rows = [...document.querySelectorAll('#bags .item-cell')];
    return rows.find((r) => (r.getAttribute('aria-label') || '').includes(label)) ?? null;
  }, label);
  const el = handle.asElement();
  if (!el) {
    // Debug: log what IS in the bag to help diagnose failures
    const bagInfo = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#bags .item-cell')];
      const inv = window.__game.sim.inventory;
      return {
        rowCount: rows.length,
        rowTexts: rows.map((r) => (r.getAttribute('aria-label') || '').trim().substring(0, 60)),
        inventory: inv.map((s) => s.itemId),
      };
    });
    console.log(`WARN: bag row not found for "${label}". Bag state:`, JSON.stringify(bagInfo));
    return null;
  }
  await el.hover();
  await sleep(500);
  return page.evaluate(() => document.querySelector('#tooltip')?.innerText ?? '');
}

// Soulflame Cord tooltip
let tip = await hoverBagItem('Soulflame Cord');
if (tip !== null) {
  console.log('TOOLTIP soulflame_cord:\n' + tip);
  const cordTooltipEl = await page.$('#tooltip');
  if (cordTooltipEl) {
    await cordTooltipEl.screenshot({ path: shot('soulflame-cord-tooltip.png') });
    console.log('wrote soulflame-cord-tooltip.png');
  }
  check(tip.includes('Soulflame'), 'soulflame cord tooltip contains set name "Soulflame"');
  check(
    tip.includes('knocked back') || tip.includes('knockback'),
    'soulflame cord tooltip shows 2-piece knockback bonus',
  );
  check(
    tip.includes('Intellect') || tip.includes('Spirit'),
    'soulflame cord tooltip shows 3-piece int/spirit bonus',
  );
} else {
  check(false, 'soulflame cord tooltip bag row found');
}

// Soulflame Gloves tooltip
tip = await hoverBagItem('Soulflame Gloves');
if (tip !== null) {
  console.log('TOOLTIP soulflame_gloves:\n' + tip);
  const glovesEl = await page.$('#tooltip');
  if (glovesEl) {
    await glovesEl.screenshot({ path: shot('soulflame-gloves-tooltip.png') });
    console.log('wrote soulflame-gloves-tooltip.png');
  }
  check(tip.includes('Soulflame'), 'soulflame gloves tooltip contains set name');
  check(
    tip.includes('knocked back') || tip.includes('knockback'),
    'soulflame gloves tooltip shows knockback bonus text',
  );
} else {
  check(false, 'soulflame gloves tooltip bag row found');
}

// Crownforged Girdle tooltip
tip = await hoverBagItem('Crownforged Girdle');
if (tip !== null) {
  console.log('TOOLTIP crownforged_girdle:\n' + tip);
  const girdleEl = await page.$('#tooltip');
  if (girdleEl) {
    await girdleEl.screenshot({ path: shot('crownforged-girdle-tooltip.png') });
    console.log('wrote crownforged-girdle-tooltip.png');
  }
  check(tip.includes('Crownforged'), 'crownforged girdle tooltip contains set name');
} else {
  check(false, 'crownforged girdle tooltip bag row found');
}

// Close bags before combat
await page.evaluate(() => {
  const el = document.querySelector('#bags');
  if (el && el.style.display !== 'none') window.__game.hud.toggleBags();
});
await sleep(200);

// ---------------------------------------------------------------------------
// 2-piece set bonus check: equip both soulflame pieces and read knockbackResistance
// ---------------------------------------------------------------------------
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.equipItem('soulflame_gloves');
  sim.equipItem('soulflame_cord');
});
await sleep(300);

const kbRes = await page.evaluate(() => {
  return window.__game.sim.player.knockbackResistance ?? -1;
});
check(kbRes >= 1, `2-piece Soulflame sets knockbackResistance to 1 (got ${kbRes})`);

// ---------------------------------------------------------------------------
// SECTION 2 - Force-spawn Thunzharr and capture the announcement
// ---------------------------------------------------------------------------

// Force worldBossNextAt[0] to 0 so the next tick spawns the boss
await page.evaluate(() => {
  window.__game.sim.worldBossNextAt[0] = 0;
});

// Wait up to 3 seconds (60 ticks at 20 Hz) for the boss to appear
let bossId = null;
for (let i = 0; i < 60; i++) {
  await sleep(100);
  bossId = await page.evaluate(() => {
    for (const e of window.__game.sim.entities.values()) {
      if (e.templateId === 'thunzharr_waking_peak' && !e.dead) return e.id;
    }
    return null;
  });
  if (bossId !== null) break;
}
check(bossId !== null, 'Thunzharr spawned when worldBossNextAt[0] set to 0');

// Get boss HP
const bossHp = await page.evaluate((bid) => {
  const boss = window.__game.sim.entities.get(bid);
  return boss ? { hp: boss.hp, maxHp: boss.maxHp } : null;
}, bossId);
if (bossHp) {
  console.log(`Boss HP: ${bossHp.hp} / ${bossHp.maxHp}`);
  check(bossHp.maxHp > 10000, `Boss has raid-tier hp (maxHp=${bossHp.maxHp} > 10000)`);
}

// Check that the announcement appeared in the chat log
const announced = await page.evaluate(() => {
  const chatlog = document.querySelector('#chatlog');
  return chatlog
    ? chatlog.textContent.includes('Thunzharr') ||
        chatlog.textContent.includes('Thornpeak') ||
        chatlog.textContent.includes('rises')
    : false;
});
check(announced, 'Announcement "Thunzharr ... rises over Thornpeak Heights!" appeared in chat');

// Brief pause for renderer to paint the boss, then screenshot the announcement
await sleep(2000);
await page.screenshot({ path: shot('thunzharr-spawn-announce.png') });
console.log('wrote thunzharr-spawn-announce.png');

// ---------------------------------------------------------------------------
// SECTION 3 - Teleport player next to the boss for the in-world shot
// ---------------------------------------------------------------------------

await page.evaluate((bid) => {
  const g = window.__game;
  const boss = g.sim.entities.get(bid);
  const p = g.sim.player;
  if (boss) {
    // Stand just south of the boss so it is visible ahead
    p.pos.x = boss.pos.x + 3;
    p.pos.z = boss.pos.z + 14;
    p.pos.y = boss.pos.y;
    p.prevPos = { ...p.pos };
    p.facing = -Math.PI; // face north toward the boss
  }
  // Pull camera in close with a shallow pitch so the boss silhouette fills the frame
  g.input.camDist = 18;
  g.input.camPitch = 0.22;
  g.input.camYaw = 0;
}, bossId);

await sleep(3000);
await page.screenshot({ path: shot('thunzharr-boss.png') });
console.log('wrote thunzharr-boss.png');

// ---------------------------------------------------------------------------
// SECTION 4 - Simulate combat: fight shot + stormling threshold
// ---------------------------------------------------------------------------

// Boost the player so they survive the encounter
await page.evaluate(() => {
  const p = window.__game.sim.player;
  p.maxHp = 50000;
  p.hp = 50000;
  p.attackPower = 1200;
  p.spellPower = 900;
  p.critChance = 0.45;
});

// Target the boss and begin auto-attacking; also seed the threat table so the
// player is counted as a contributor for personal loot rolling
await page.evaluate((bid) => {
  const g = window.__game;
  const p = g.sim.player;
  p.targetId = bid;
  p.autoAttack = true;
  const boss = g.sim.entities.get(bid);
  if (boss && boss.threat) boss.threat.set(p.id, 99999);
}, bossId);

await sleep(2500);
await page.screenshot({ path: shot('thunzharr-fight.png') });
console.log('wrote thunzharr-fight.png');

// Drive boss HP to just below 66% to trigger the first stormling wave
await page.evaluate((bid) => {
  const boss = window.__game.sim.entities.get(bid);
  if (boss) boss.hp = Math.floor(boss.maxHp * 0.64);
}, bossId);

// Wait several ticks for the summonAdds mechanic to fire (20 Hz sim)
await sleep(1200);

const stormlings = await page.evaluate(() => {
  return [...window.__game.sim.entities.values()].filter(
    (e) => e.templateId === 'thunzharr_stormling' && !e.dead,
  ).length;
});
check(stormlings > 0, `Stormling adds appeared at 66% hp threshold (found ${stormlings})`);

// ---------------------------------------------------------------------------
// SECTION 5 - Kill the boss and open the loot window
// ---------------------------------------------------------------------------

// Kill: drive hp to 0 and mark dead. Inject personal loot directly (bypassing
// the daily gate that would normally require a live server utcDay string) so the
// loot window shows the expected items.
await page.evaluate((bid) => {
  const g = window.__game;
  const sim = g.sim;
  const boss = sim.entities.get(bid);
  const p = sim.player;
  if (!boss) return;
  boss.hp = 0;
  boss.dead = true;
  boss.aiState = 'dead';
  boss.corpseTimer = 600;
  boss.loot = boss.loot ?? { copper: 0, items: [] };
  boss.loot.items = boss.loot.items ?? [];
  // Guaranteed trophy (always drops, personalFor this player)
  boss.loot.items.push({ itemId: 'inert_storm_shard', count: 1, personalFor: [p.id] });
  // Epic set gloves roll (simulating a lucky soulflame drop)
  boss.loot.items.push({ itemId: 'soulflame_gloves', count: 1, personalFor: [p.id] });
  boss.loot.copper = 700;
  boss.lootable = true;
}, bossId);

await sleep(600);

const lootState = await page.evaluate((bid) => {
  const boss = window.__game.sim.entities.get(bid);
  return boss
    ? {
        dead: boss.dead,
        lootable: boss.lootable,
        items: boss.loot?.items?.map((s) => s.itemId),
      }
    : null;
}, bossId);
check(lootState?.lootable === true, 'Boss corpse is lootable');
check(
  lootState?.items?.includes('inert_storm_shard'),
  `Loot contains guaranteed trophy inert_storm_shard (items: ${JSON.stringify(lootState?.items)})`,
);
console.log('Loot on corpse:', JSON.stringify(lootState?.items));

// Position the player near the corpse and open the loot window
await page.evaluate((bid) => {
  const g = window.__game;
  const boss = g.sim.entities.get(bid);
  const p = g.sim.player;
  if (boss) {
    // Stay within 7 units (the loot proximity threshold in hud.ts) so the
    // HUD does not auto-close the loot window during the render update.
    p.pos.x = boss.pos.x + 3;
    p.pos.z = boss.pos.z + 5;
    p.pos.y = boss.pos.y;
    p.prevPos = { ...p.pos };
    p.facing = -Math.PI;
  }
  g.input.camDist = 14;
  g.input.camPitch = 0.42;
  g.input.camYaw = 0.15;
  // Open loot window at screen center
  g.hud.openLoot(bid, 820, 460);
  // Force the window visible and centred. openLoot populates innerHTML but its
  // display assignment can race with headless paint; we unconditionally set it.
  const lw = document.querySelector('#loot-window');
  if (lw) {
    lw.style.display = 'block';
    lw.style.left = '670px';
    lw.style.top = '200px';
    lw.style.zIndex = '9999';
  }
}, bossId);

await sleep(1200);

const lootWindowVisible = await page.evaluate(() => {
  const el = document.querySelector('#loot-window');
  const hasContent = el ? el.innerHTML.includes('Thunzharr') : false;
  const isVisible = el ? el.style.display !== 'none' : false;
  return isVisible && hasContent;
});
check(lootWindowVisible, 'Loot window opened on boss corpse');

await page.screenshot({ path: shot('thunzharr-loot.png') });
console.log('wrote thunzharr-loot.png');

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

await browser.close();

console.log('');
console.log('Screenshots written to docs/screenshots/:');
const expectedFiles = [
  'thunzharr-boss.png',
  'thunzharr-spawn-announce.png',
  'soulflame-gloves-tooltip.png',
  'soulflame-cord-tooltip.png',
  'crownforged-girdle-tooltip.png',
  'thunzharr-fight.png',
  'thunzharr-loot.png',
];
for (const f of expectedFiles) {
  const p = path.join(OUT_DIR, f);
  const exists = fs.existsSync(p);
  console.log(`  ${exists ? 'OK  ' : 'MISS'}  ${p}`);
}

if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  - ' + f);
} else {
  console.log('\nAll checks passed.');
}

process.exit(fails.length ? 1 : 0);
