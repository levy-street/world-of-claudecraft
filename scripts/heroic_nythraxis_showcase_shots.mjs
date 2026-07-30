// PR showcase shots for the Heroic Nythraxis tier (#1816). Boots the offline
// game and captures, in one session:
//   1. The full phase-2 Deathless Court staged around a wounded boss
//      (Aldren / Malric / Voss), with Malric's heal beam onto the boss.
//   2. A close-up of Malric mid Malric's Mending beside the wounded boss, his
//      overhead channel bar draining.
//   3. Tooltip clips for the loot: a raid set piece as base (item level 29)
//      and as its heroic variant (33, [HEROIC]), the heroic legendary (37,
//      [HEROIC]), and the three heroic-only raid weapons.
//   PORT=5199 node scripts/heroic_nythraxis_showcase_shots.mjs   (needs npm run dev)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const PORT = process.env.PORT ?? '5199';
const URL = process.env.GAME_URL ?? `http://localhost:${PORT}`;
const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 });
const jsClick = (s) => page.evaluate((x) => document.querySelector(x)?.click(), s);
await new Promise((r) => setTimeout(r, 500));
await jsClick('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Scout');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1500));
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 350));
}
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));

// Cap the level up front so the staged court does not flatten the player while
// the channel shot waits for Malric's cast to wind up.
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20, sim.player.id);
  window.__game.hud.optionsHooks?.settings.set('showItemLevel', true);
});

// ---------- Part 1: staged world shots ----------

// Stage the wounded boss plus any subset of the three court adds a short
// distance in front of the camera. Returns the staged ids by templateId.
async function stageCourt(addIds, targetTid, extraTicks, bossHpFrac, closeUp) {
  return await page.evaluate(
    ({ addIds, targetTid, extraTicks, bossHpFrac, closeUp }) => {
      const sim = window.__game.sim;
      const ctx = sim.ctx;
      const p = sim.player;
      for (const e of [...ctx.entities.values()]) {
        if (
          e.kind === 'mob' &&
          (String(e.templateId).startsWith('nythraxis_heroic_') ||
            e.templateId === 'nythraxis_scourge_of_thornpeak')
        ) {
          ctx.entities.delete(e.id);
        }
      }
      const base = [...ctx.entities.values()].find((e) => e.kind === 'mob');
      if (!base) return null;
      // Open grassland north of the starting town: no NPC nameplates or buildings
      // in frame. The player looks straight down +z at the staged court.
      const g = sim.groundPos(60, 40);
      p.pos = { x: g.x, y: g.y, z: g.z };
      p.prevPos = { ...p.pos };
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
      p.facing = 0;
      p.inCombat = false;
      p.hp = p.maxHp;
      // Clear wandering field mobs near the stage so only the court is in frame.
      for (const e of [...ctx.entities.values()]) {
        if (e.kind !== 'mob' || e === base) continue;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (d < 70) ctx.entities.delete(e.id);
      }
      const spawn = (templateId, name, dx, dz, scale, hp, engage) => {
        const m = structuredClone(base);
        m.id = ctx.nextId++;
        m.templateId = templateId;
        m.name = name;
        m.scale = scale;
        m.level = 22;
        m.maxHp = hp;
        m.hp = hp;
        m.dead = false;
        m.hostile = true;
        m.auras = [];
        m.nythraxis = undefined;
        m.summonedIds = [];
        m.threat = new Map();
        // The clone source is an arbitrary world mob: zero the channel-heal
        // machinery explicitly or NaN poisons Malric's cast bar.
        m.channelTimer = 0;
        m.channelRamp = 0;
        m.healProtecteeId = null;
        m.castingAbility = null;
        m.castRemaining = 0;
        m.castTotal = 0;
        m.channeling = false;
        // Engaged mobs run the combat-profile AI (Malric's heal-hold needs it);
        // the rest stay idle so the staging holds its pose.
        if (engage) {
          m.threat.set(p.id, 1000);
          m.aggroTargetId = p.id;
          m.inCombat = true;
          m.aiState = 'attack';
        }
        const bx = p.pos.x + dx;
        const bz = p.pos.z + dz;
        const mg = sim.groundPos(bx, bz);
        m.pos = { x: bx, y: mg.y, z: bz };
        m.prevPos = { ...m.pos };
        m.spawnPos = { ...m.pos };
        m.facing = Math.atan2(p.pos.x - bx, p.pos.z - bz);
        m.prevFacing = m.facing;
        ctx.addEntity(m);
        return m.id;
      };
      const ids = {};
      const bossId = spawn(
        'nythraxis_scourge_of_thornpeak',
        'Nythraxis, Scourge of Thornpeak',
        0,
        closeUp ? 13 : 17,
        2.4,
        300000,
      );
      const boss = ctx.entities.get(bossId);
      // Wounded, so Malric channels. The Malric close-up stages ABOVE the
      // phase-2 threshold: an engaged boss at 40% starts his transition, whose
      // stun breaks the channel mid-shot.
      if (boss) boss.hp = Math.floor(boss.maxHp * bossHpFrac);
      ids.nythraxis_scourge_of_thornpeak = bossId;
      // Malric spawns already inside his 6-unit heal standoff of the boss so the
      // channel starts without pathing (terrain colliders can pin a staged walk).
      const layout = closeUp
        ? { nythraxis_heroic_priest_add: { name: 'Spirit of Malric', dx: -2, dz: 9 } }
        : {
            nythraxis_heroic_warrior_add: { name: 'Spirit of Aldren', dx: -8, dz: 11 },
            nythraxis_heroic_priest_add: { name: 'Spirit of Malric', dx: -1.5, dz: 13.5 },
            nythraxis_heroic_rogue_add: { name: 'Spirit of Voss', dx: 8, dz: 11 },
          };
      for (const tid of addIds) {
        const l = layout[tid];
        ids[tid] = spawn(tid, l.name, l.dx, l.dz, 1.7, 6000, tid === 'nythraxis_heroic_priest_add');
      }
      const targetId = targetTid ? ids[targetTid] : null;
      p.targetId = targetId;
      if (targetId !== null && sim.setTarget) {
        try {
          sim.setTarget(p.id, targetId);
        } catch {}
      }
      // The headless renderer starves the live loop (swiftshader terrain builds),
      // so drive the sim by hand: tick until Malric's channel is up and a heal
      // beam has fired, then a few more so the cast bar reads mid-channel. Only
      // a handful of ticks pass, so the posed adds barely move.
      const malric = [...ctx.entities.values()].find(
        (e) => e.templateId === 'nythraxis_heroic_priest_add' && !e.dead,
      );
      const bossEnt = ctx.entities.get(ids.nythraxis_scourge_of_thornpeak);
      // Pin the boss at his mark every tick: left free he aggros the player and
      // walks out of Malric's heal standoff, which clears the channel.
      const pinBoss = () => {
        if (!bossEnt) return;
        bossEnt.pos = { ...bossEnt.spawnPos };
        bossEnt.prevPos = { ...bossEnt.spawnPos };
        bossEnt.aiState = 'idle';
        bossEnt.aggroTargetId = null;
        bossEnt.inCombat = false;
        bossEnt.threat.clear();
        bossEnt.facing = Math.atan2(p.pos.x - bossEnt.pos.x, p.pos.z - bossEnt.pos.z);
        bossEnt.prevFacing = bossEnt.facing;
      };
      let started = false;
      let healed = false;
      for (let i = 0; i < 400 && !(started && healed); i++) {
        const before = bossEnt?.hp ?? 0;
        pinBoss();
        sim.tick();
        if (malric?.castingAbility === 'nythraxis_spirit_mending') started = true;
        if ((bossEnt?.hp ?? 0) > before) healed = true;
      }
      for (let i = 0; i < extraTicks; i++) {
        pinBoss();
        sim.tick();
      }
      pinBoss();
      p.hp = p.maxHp;
      return { ids, started, healed };
    },
    { addIds, targetTid, extraTicks, bossHpFrac, closeUp },
  );
}

// Shot 1: the full Deathless Court around the wounded boss, boss targeted.
{
  const res = await stageCourt(
    ['nythraxis_heroic_warrior_add', 'nythraxis_heroic_priest_add', 'nythraxis_heroic_rogue_add'],
    'nythraxis_scourge_of_thornpeak',
    8,
    0.4,
    false,
  );
  console.log('court stage:', JSON.stringify({ started: res?.started, healed: res?.healed }));
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/heroic_nyth_deathless_court.png` });
  console.log('shot heroic_nyth_deathless_court.png');
}

// Shot 2: untargeted close-up of Malric mid Malric's Mending beside the wounded
// boss, his overhead channel bar draining. Untargeted on purpose: the target
// frame's cast bar prints the raw cast id (a pre-existing gap), which would
// read verbatim in a close-up.
{
  const res = await stageCourt(['nythraxis_heroic_priest_add'], null, 40, 0.8, true);
  console.log('malric stage:', JSON.stringify({ started: res?.started, healed: res?.healed }));
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/heroic_nyth_malric_mending.png` });
  console.log('shot heroic_nyth_malric_mending.png');
}

// ---------- Part 2: loot tooltip clips ----------

// Clear the staged mobs so nothing chews on the player during the bag shots,
// then grant the showcase loot.
const inv = await page.evaluate(() => {
  const sim = window.__game.sim;
  const ctx = sim.ctx;
  for (const e of [...ctx.entities.values()]) {
    if (
      e.kind === 'mob' &&
      (String(e.templateId).startsWith('nythraxis_heroic_') ||
        e.templateId === 'nythraxis_scourge_of_thornpeak')
    ) {
      ctx.entities.delete(e.id);
    }
  }
  const p = sim.player;
  p.targetId = null;
  p.inCombat = false;
  p.hp = p.maxHp;
  const pid = p.id;
  const ids = [
    'soulflame_cowl', // base raid set piece, item level 29
    'heroic_soulflame_cowl', // raid-tier heroic variant, item level 33, [HEROIC]
    'heroic_kingsbane_last_oath', // heroic legendary variant, item level 37, [HEROIC]
    'deathless_greatblade', // the three heroic-only raid weapons
    'scepter_of_the_deathless_court',
    'stormcallers_focus',
  ];
  for (const id of ids) sim.addItem(id, 1, pid);
  sim.tick();
  return sim.inventory.map((s) => s.itemId);
});
console.log('inventory:', JSON.stringify(inv));

await page.keyboard.press('b');
await new Promise((r) => setTimeout(r, 700));

// Hover the bag row whose name matches and whose tooltip does/does not contain
// a probe string (the base set piece and its heroic variant share one name).
async function hoverShot(match, file, { need, avoid } = {}) {
  const hoverRow = (nm, idx) =>
    page.evaluate(
      ({ nm, idx }) => {
        const rows = [...document.querySelectorAll('#bags .bag-item')].filter((r) =>
          (r.getAttribute('aria-label') || '').includes(nm),
        );
        const row = rows[idx];
        if (!row) return false;
        const b = row.getBoundingClientRect();
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        for (const type of ['mouseenter', 'mouseover', 'mousemove'])
          row.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
        return true;
      },
      { nm, idx },
    );
  const readTip = () =>
    page.evaluate(() => {
      const tt = document.querySelector('#tooltip');
      return {
        shown: tt && tt.style.display === 'block',
        text: tt?.innerText?.replace(/\n/g, ' | '),
      };
    });
  let tip = { shown: false };
  for (let idx = 0; idx < 8; idx++) {
    await page.mouse.move(10, 10);
    await new Promise((r) => setTimeout(r, 120));
    const ok = await hoverRow(match, idx);
    if (!ok) break;
    await new Promise((r) => setTimeout(r, 320));
    tip = await readTip();
    const text = tip.text || '';
    if (need && !text.includes(need)) continue;
    if (avoid && text.includes(avoid)) continue;
    break;
  }
  if (!tip.shown) {
    console.log('row not found:', match, JSON.stringify({ need, avoid }));
    return;
  }
  console.log(`tooltip[${match}]:`, JSON.stringify(tip));
  const box = await page.evaluate(() => {
    const b = document.querySelector('#tooltip').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const pad = 10;
  await page.screenshot({
    path: `${OUT}/${file}`,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.w + pad * 2,
      height: box.h + pad * 2,
    },
  });
  console.log('shot', file);
}

await hoverShot('Wraithfire Cowl', 'heroic_nyth_set_base_tooltip.png', { avoid: '[HEROIC]' });
await hoverShot('Wraithfire Cowl', 'heroic_nyth_set_heroic_tooltip.png', { need: '[HEROIC]' });
await hoverShot('Thronebane, Last Oath of Thornpeak', 'heroic_nyth_legendary_heroic_tooltip.png', {
  need: '[HEROIC]',
});
await hoverShot('Deathless Greatblade', 'heroic_nyth_weapon_greatblade_tooltip.png');
await hoverShot('Scepter of the Deathless Court', 'heroic_nyth_weapon_scepter_tooltip.png');
await hoverShot("Stormcaller's Focus", 'heroic_nyth_weapon_focus_tooltip.png');

await browser.close();
console.log('done');
