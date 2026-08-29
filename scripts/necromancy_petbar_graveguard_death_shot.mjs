// Visual proof for "Warlock: no Skill Bar for other demons to command when
// Graveguard dies" (fix/warlock-necromancy-petbar-graveguard-death).
//
// Root cause: the pet action bar (src/ui/hud.ts renderPetBar) hid itself
// entirely once the PRIMARY pet (findOwnPet, which excludes the Necromancy
// Dominion's temporary summons on purpose) was dead or gone. For a
// Necromancy (Demonology-spec) Warlock, Graveguard is the primary pet, but
// the Dominion's Skeletal Warrior/Bone Mage/Gravewing keep fighting and
// obey the owner's Attack/Mode commands independent of Graveguard
// (sim/pet/pet_commands.ts combatCommandPetsOf). Losing Graveguard hid the
// ENTIRE bar, including the buttons those survivors still needed.
//
// This script drives the real offline client: a Necromancy Warlock summons
// Graveguard plus a Dominion Skeletal Warrior, Graveguard is killed, and the
// real HUD renders the next real frame. Screenshots land in tmp/necro-petbar-*.png.
//
// Needs `npm run dev` already running (GAME_URL defaults to :5173).

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails.push(msg);
};

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
await page.bringToFront();
page.on('pageerror', (e) => fails.push(`PAGEERROR: ${e.message}`));

const shot = async (name, clip) => {
  await page.screenshot({ path: `tmp/necro-petbar-${name}.png`, clip });
  console.log('shot:', name);
};

// Union bounding box (with padding) of the given element ids, clamped to the
// live viewport. #petbar only exists once a pet is owned, so this is computed
// fresh per shot rather than once up front.
const hudRegion = async (ids, pad = 24) =>
  page.evaluate(
    (ids, pad) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
      }
      if (left === Infinity) return null;
      left = Math.max(0, left - pad);
      top = Math.max(0, top - pad);
      right = Math.min(vw, right + pad);
      bottom = Math.min(vh, bottom + pad);
      return { x: left, y: top, width: right - left, height: bottom - top };
    },
    ids,
    pad,
  );

// Lowest graphics preset before the app boots (standing capture rule): this
// shot is about HUD/pet-bar state, not a graphics comparison.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 });
const booted = await enterOfflineGame(page, { charClass: 'warlock', charName: 'Graveguardtest' });
check(booted, 'offline world booted');
if (!booted) {
  await browser.close();
  process.exit(1);
}
await page.evaluate(() => document.querySelector('#gpu-notice')?.remove());
await sleep(300);

// 1) Necromancy Warlock: level up, spec into Demonology (player-facing name
// "Necromancy"), and raise the persistent Graveguard plus a Dominion Skeletal
// Warrior, mirroring what the real ability casts (raise_graveguard /
// raise_skeletal_warrior) produce (tests/necromancy.test.ts uses the same
// createDemonPet entry point for setup).
const setup = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  sim.setPlayerLevel(20);
  sim.setSpec('demonology');
  const graveguard = sim.createDemonPet(p, 'graveguard', false);
  const warrior = sim.createDemonPet(p, 'necromancy_skeletal_warrior', false);
  graveguard.pos.x = p.pos.x + 2;
  graveguard.pos.z = p.pos.z;
  warrior.pos.x = p.pos.x - 2;
  warrior.pos.z = p.pos.z;
  // A nearby hostile target so Attack has something real to prove against.
  let target = null;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && e.hostile && !e.dead && e.ownerId === null) {
      target = e;
      break;
    }
  }
  if (target) {
    target.pos.x = p.pos.x;
    target.pos.z = p.pos.z + 8;
    sim.targetEntity(target.id);
    p.facing = 0;
  }
  return {
    graveguardId: graveguard.id,
    warriorId: warrior.id,
    targetId: target?.id ?? null,
    spec: sim.talentSpec,
  };
});
console.log('setup:', JSON.stringify(setup));
check(setup.spec === 'demonology', `Necromancy (Demonology) spec active: ${setup.spec}`);
await sleep(600);
await shot(
  '01-graveguard-and-dominion-alive',
  await hudRegion(['bottom-bar', 'petbar', 'pet-frame']),
);

// 2) Kill Graveguard outright: the primary pet is now dead/gone, exactly the
// state the bug report describes ("the main demon of the Necromancy spec
// dies").
const killed = await page.evaluate((graveguardId) => {
  const sim = window.__game.sim;
  const graveguard = sim.entities.get(graveguardId);
  sim.dealDamage(sim.player, graveguard, graveguard.hp + 1000, false, 'shadow', 'Test Kill', 'hit');
  return { dead: graveguard.dead, primaryPet: sim.petOf(sim.playerId) };
}, setup.graveguardId);
console.log('killed:', JSON.stringify(killed));
check(killed.dead === true, 'Graveguard is dead');
check(killed.primaryPet === null, 'the primary-pet resolver now sees nothing (findOwnPet/petOf)');
await sleep(700); // let a real HUD frame repaint the pet bar

await shot('02-after-graveguard-death', await hudRegion(['bottom-bar', 'petbar', 'pet-frame']));

// 3) Prove the bar is not just visible but FUNCTIONAL: click the real Attack
// button and confirm the surviving Skeletal Warrior actually engages.
const attackClicked = await page.evaluate(() => {
  const btn = document.querySelector('[data-focus-key="pet_attack"]');
  if (!btn) return false;
  btn.click();
  return true;
});
check(attackClicked, 'the Attack button exists in the DOM and was clicked');
await sleep(600);

const after = await page.evaluate((warriorId) => {
  const sim = window.__game.sim;
  const warrior = sim.entities.get(warriorId);
  return {
    warriorAggroTargetId: warrior?.aggroTargetId ?? null,
    warriorInCombat: warrior?.inCombat ?? null,
    barDisplay: document.getElementById('petbar')?.style.display ?? null,
  };
}, setup.warriorId);
console.log('after-attack:', JSON.stringify(after));
check(
  attackClicked && after.warriorInCombat === true,
  'the surviving Skeletal Warrior engaged the target from the pet bar Attack button',
);
check(after.barDisplay !== 'none', 'the pet bar itself stays visible (display !== none)');

await shot('03-after-attack-command', await hudRegion(['bottom-bar', 'petbar', 'pet-frame']));

// 4) Debug overlay summarizing the before/after fix behavior from real captured state.
await page.evaluate((d) => {
  const card = document.createElement('div');
  card.id = 'petbar-debug-card';
  card.style.cssText =
    'position:fixed;left:50%;top:8%;transform:translateX(-50%);z-index:99999;width:820px;font:14px/1.5 system-ui,sans-serif;color:#eee;background:rgba(12,14,20,.95);border:1px solid #3a4256;border-radius:10px;padding:20px 24px;box-shadow:0 10px 40px rgba(0,0,0,.6)';
  const row = (label, v, ok) =>
    `<div style="margin:6px 0"><b style="color:${ok ? '#7fdc7f' : '#ff8a8a'}">${label}</b><br><span style="color:#cfd6e6">${v}</span></div>`;
  card.innerHTML =
    '<div style="font-size:17px;font-weight:700;margin-bottom:4px">Pet bar after Graveguard dies (Dominion Skeletal Warrior still alive)</div>' +
    row(
      'BEFORE fix (src/ui/hud.ts renderPetBar, pre-fix):',
      'the bar hides entirely because findOwnPet only ever resolves the primary Graveguard; the surviving Skeletal Warrior has no Attack/Mode buttons left to command it',
      false,
    ) +
    row(
      'AFTER fix (this PR):',
      `bar display = ${d.barDisplay}, Skeletal Warrior in combat = ${d.warriorInCombat}: the bar falls back to a living Necromancy summon so Attack/Mode still reach it`,
      d.barDisplay !== 'none' && d.warriorInCombat === true,
    );
  document.body.appendChild(card);
}, after);
await sleep(300);
await shot('04-fix-comparison-card');

// 5) Mobile (landscape, the only in-game orientation).
await page.evaluate(() => document.getElementById('petbar-debug-card')?.remove());
await page.emulate({
  viewport: { width: 844, height: 390, isMobile: true, hasTouch: true },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
await sleep(500);
await shot('05-mobile-after-graveguard-death');

console.log(fails.length === 0 ? 'ALL CHECKS PASSED' : `FAILURES: ${fails.length}`);
for (const f of fails) console.log(' -', f);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
