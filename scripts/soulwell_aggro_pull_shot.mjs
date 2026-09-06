// Before/after screenshots for the Soulwell aggro-pull bug: with the "Auto-Attack
// on Ability Use" QoL setting on (the default, src/game/settings.ts
// startAttackOnAbilityUse: { def: true }), a Warlock with a hostile target
// selected who attempts a damaging cast that the sim REFUSES before it ever
// starts (out of range/cost/cooldown/etc, so it never emits castStart) was left
// with the deferred engage armed forever. Casting Soulwell right after (which
// never arms the engage itself: requiresOutOfCombat, summonSoulwell classifies
// 'other' in attack_on_ability.ts) then fired the stale request on ITS OWN
// castStop and pulled whatever the player had targeted.
//
// This script drives the real offline client: Gloom Bolt (shadow_bolt) is
// pressed with the player's mana drained to 0 (a real, server-authoritative
// "Not enough mana!" refusal, chosen over an out-of-range refusal so the
// distance the target sits at cannot itself explain the outcome), mana is
// restored, then Soulwell is pressed (the real hud.castSlot entry point a
// keybind calls) and its 3s cast is let run to completion. Screenshots + a
// real-state comparison card land in tmp/soulwell-aggro-*.png.
//
// Needs `npm run dev` already running (GAME_URL defaults to :5173).
// Usage: SHOT_TAG=before|after node scripts/soulwell_aggro_pull_shot.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const TAG = process.env.SHOT_TAG ?? 'after';
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
  await page.screenshot({ path: `tmp/soulwell-aggro-${TAG}-${name}.png`, clip });
  console.log('shot:', name);
};

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

// Lowest graphics preset before the app boots (standing capture rule).
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 });
const booted = await enterOfflineGame(page, { charClass: 'warlock', charName: 'Soulwelltest' });
check(booted, 'offline world booted');
if (!booted) {
  await browser.close();
  process.exit(1);
}
await page.evaluate(() => document.querySelector('#gpu-notice')?.remove());
// Dismiss the Proving Shore's own Ferryman Odo greeting (a quest-dialog popup,
// not one of the three overlays enterOfflineGame already tracks) so it never
// photobombs a capture.
await page
  .evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    btns.find((b) => b.textContent?.trim().toUpperCase() === 'UNDERSTOOD')?.click();
  })
  .catch(() => {});
await sleep(300);

// 1) Level a Warlock past Soulwell's learnLevel (8), place a hostile mob a
// short, controlled distance out (beyond melee range, so no swing can land and
// contaminate the result with a real hit), and hook sim.startAutoAttack so the
// comparison card can report whether it actually fired. Confirm the QoL
// setting the bug depends on is at its shipped default (on).
const setup = await page.evaluate(() => {
  const { sim, hud } = window.__game;
  const p = sim.player;
  sim.setPlayerLevel(10);
  let target = null;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && e.hostile && !e.dead && e.ownerId === null) {
      target = e;
      break;
    }
  }
  if (!target) return { ok: false, reason: 'no hostile mob found nearby' };
  target.pos.x = p.pos.x + 20;
  target.pos.z = p.pos.z;
  sim.grid.refresh(sim.entities.values());
  sim.targetEntity(target.id);
  p.facing = 0;
  const actions = [...hud.hotbarActions];
  actions[0] = { type: 'ability', id: 'shadow_bolt' };
  actions[1] = { type: 'ability', id: 'soulwell' };
  hud.hotbarActions = actions;
  window.__startAutoAttackCalls = 0;
  const origStartAutoAttack = sim.startAutoAttack.bind(sim);
  sim.startAutoAttack = (...args) => {
    window.__startAutoAttackCalls++;
    return origStartAutoAttack(...args);
  };
  return {
    ok: true,
    targetId: target.id,
    dist: Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z),
    startAttackOnAbilityUse: hud.optionsHooks?.settings.get('startAttackOnAbilityUse') ?? null,
  };
});
console.log('setup:', JSON.stringify(setup));
check(setup.ok, `setup found a hostile target: ${setup.reason ?? 'ok'}`);
check(
  setup.dist > 5,
  `target placed beyond melee range so it is not pulled by proximity alone (dist=${setup.dist})`,
);
check(
  setup.startAttackOnAbilityUse === true,
  `"Auto-Attack on Ability Use" is at its shipped default (on): ${setup.startAttackOnAbilityUse}`,
);
await sleep(400);
await shot('01-setup-target-out-of-range', await hudRegion(['player-frame', 'target-frame']));

// 2) Drain mana to 0 and press Gloom Bolt (barSlot 1): a real, server-
// authoritative "Not enough mana!" refusal, distance-independent so it is not
// entangled with the target's placement. hud.castSlot is the exact call the
// "1" keybind makes (onAbility in main.ts).
const refused = await page.evaluate(() => {
  const { sim, hud } = window.__game;
  const p = sim.player;
  p.resource = 0;
  hud.castSlot(1);
  return {
    castingAbility: sim.player.castingAbility,
    inCombat: sim.player.inCombat,
    err: document.querySelector('#error-msg')?.textContent,
  };
});
console.log('after-gloom-bolt-press:', JSON.stringify(refused));
check(
  refused.castingAbility === '' || refused.castingAbility === null,
  `Gloom Bolt never actually started casting (refused: ${refused.err}): castingAbility=${refused.castingAbility}`,
);
check(refused.inCombat === false, 'the refused cast never engaged combat either');
await sleep(400);

// 3) Restore mana (Soulwell must actually succeed to prove the bug is about the
// STALE request, not a second refusal) and press Soulwell (barSlot 2). Waiting
// on castingAbility clearing (rather than a fixed sleep) is robust to headless
// SwiftShader frame-rate drift stretching real time per sim tick.
const pressedSoulwell = await page.evaluate(() => {
  const { sim, hud } = window.__game;
  sim.player.resource = sim.player.maxResource;
  hud.castSlot(2);
  return { castingAbility: sim.player.castingAbility };
});
console.log('after-soulwell-press:', JSON.stringify(pressedSoulwell));
check(pressedSoulwell.castingAbility === 'soulwell', 'Soulwell actually started casting (3s cast)');
await page
  .waitForFunction(() => !window.__game.sim.player.castingAbility, { timeout: 8000 })
  .catch(() => {});

const outcome = await page.evaluate((targetId) => {
  const { sim } = window.__game;
  const target = sim.entities.get(targetId);
  return {
    playerAutoAttack: sim.player.autoAttack,
    playerInCombat: sim.player.inCombat,
    targetInCombat: target?.inCombat ?? null,
    startAutoAttackCalls: window.__startAutoAttackCalls,
    soulwellSpawned: [...sim.entities.values()].some(
      (e) =>
        e.kind === 'object' &&
        e.objectItemId === 'soulwell' &&
        e.soulwell?.ownerId === sim.player.id,
    ),
  };
}, setup.targetId);
console.log('outcome:', JSON.stringify(outcome));
check(outcome.soulwellSpawned, 'Soulwell itself was actually summoned (the cast succeeded)');
check(
  outcome.playerInCombat === false && outcome.targetInCombat === false,
  `the still-distant target is not pulled into combat by the cast itself (playerInCombat=${outcome.playerInCombat})`,
);
check(
  outcome.startAutoAttackCalls === 0,
  `sim.startAutoAttack() was never spuriously called by a stale request (calls=${outcome.startAutoAttackCalls})`,
);
check(
  outcome.playerAutoAttack === false,
  // Even with the target still out of melee range (so no combat state change is
  // visible YET), a mis-armed player.autoAttack silently primes a real pull for
  // the moment the player next comes within melee range of ANY hostile
  // target they have selected, with no further Attack or ability press at all
  // (src/sim/combat/auto_attack.ts updatePlayerAutoAttack runs this check every
  // tick while the flag is set). This is the decisive, uncontaminated signal:
  // it is set the instant the bug fires, before proximity to any other nearby
  // mob could produce the same combat state through ordinary gameplay.
  `player.autoAttack was not silently armed by a stale request (autoAttack=${outcome.playerAutoAttack})`,
);

await shot('02-after-soulwell-cast', await hudRegion(['player-frame', 'target-frame']));

// 4) Debug overlay summarizing the before/after fix behavior from real captured state.
await page.evaluate((d) => {
  const card = document.createElement('div');
  card.id = 'soulwell-debug-card';
  card.style.cssText =
    'position:fixed;left:50%;top:8%;transform:translateX(-50%);z-index:99999;width:900px;font:14px/1.5 system-ui,sans-serif;color:#eee;background:rgba(12,14,20,.95);border:1px solid #3a4256;border-radius:10px;padding:20px 24px;box-shadow:0 10px 40px rgba(0,0,0,.6)';
  const row = (label, v, ok) =>
    `<div style="margin:6px 0"><b style="color:${ok ? '#7fdc7f' : '#ff8a8a'}">${label}</b><br><span style="color:#cfd6e6">${v}</span></div>`;
  card.innerHTML =
    '<div style="font-size:17px;font-weight:700;margin-bottom:4px">Cast Soulwell after a refused Gloom Bolt (mana), with an enemy still targeted</div>' +
    row(
      'BEFORE fix (src/ui/hud.ts, pendingAutoAttackOnCastEnd):',
      'armed unconditionally when Gloom Bolt was pressed; the "Not enough mana!" refusal never reaches castStart to clear it, so it stays armed. Soulwell\'s own successful castStop then fires this.sim.startAutoAttack() against the still-targeted mob: player.autoAttack silently flips true even though nothing was ever actually attacked, priming a pull the instant the player is next in melee range of it, no further Attack or ability press at all.',
      false,
    ) +
    row(
      'AFTER fix (this PR, confirmPendingAutoAttackEngage):',
      `the request only arms once castStart CONFIRMS the same ability began; Soulwell's own castStart drops the stale Gloom Bolt request instead. sim.startAutoAttack() calls=${d.startAutoAttackCalls}, player.autoAttack=${d.playerAutoAttack}: never silently armed.`,
      d.startAutoAttackCalls === 0 && d.playerAutoAttack === false,
    );
  document.body.appendChild(card);
}, outcome);
await sleep(300);
await shot('03-fix-comparison-card');

console.log(fails.length === 0 ? 'ALL CHECKS PASSED' : `FAILURES: ${fails.length}`);
for (const f of fails) console.log(' -', f);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
