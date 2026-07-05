// Live-client demo and screenshots for the Talents 2.0 PR2 sim primitives.
// The primitives are content-unused, so this script stages them with synthetic
// resolved abilities and test-style talent modifiers, then asserts the real
// offline client behavior before each screenshot. Needs `npm run dev` on :5173
// or GAME_URL. Shots land in tmp/ as pr2_*.png.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => {
  pageErrors.push(e.message);
  console.log('PAGEERROR:', e.message);
});
await page.bringToFront();

const jsClick = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await jsClick('#btn-offline');
await sleep(400);
await page.waitForSelector('#char-name', { timeout: 30000 });
await page.type('#char-name', 'Prtwo');
await jsClick('#offline-select .mini-class[data-class="mage"]');
await sleep(300);
await jsClick('#btn-start-offline');
await page.bringToFront();
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await sleep(1500);

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20);
  document.querySelector('#tutorial-hint .btn, #tutorial-hint button')?.click();
  window.__pr2 = {
    aura(kind, id, name, school = 'arcane') {
      return {
        id,
        name,
        kind,
        remaining: 60,
        duration: 60,
        value: 0,
        sourceId: 0,
        school,
      };
    },
    emptyAbilityMod(addEffects = []) {
      return {
        dmgPct: 0,
        flatDmg: 0,
        costPct: 0,
        cooldownPct: 0,
        castPct: 0,
        buffPct: 0,
        castWhileMoving: false,
        addEffects,
      };
    },
    nearestWolf() {
      const me = sim.player;
      let best = Infinity;
      let mob = null;
      for (const e of sim.entities.values()) {
        if (e.id === me.id || e.dead || !e.hostile) continue;
        const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
        if (d < best) {
          best = d;
          mob = e;
        }
      }
      return mob;
    },
    stageWolf() {
      const me = sim.player;
      const mob = window.__pr2.nearestWolf();
      if (!mob) return null;
      const d = Math.hypot(mob.pos.x - me.pos.x, mob.pos.z - me.pos.z);
      if (d > 15) {
        const t = (d - 13) / d;
        me.pos.x += (mob.pos.x - me.pos.x) * t;
        me.pos.z += (mob.pos.z - me.pos.z) * t;
        me.prevPos = { ...me.pos };
      }
      me.facing = Math.atan2(mob.pos.x - me.pos.x, mob.pos.z - me.pos.z);
      sim.targetEntity(mob.id);
      if (window.__game.input) window.__game.input.targetId = mob.id;
      mob.maxHp = 50000;
      mob.hp = 50000;
      mob.dead = false;
      mob.hostile = true;
      mob.aiState = 'idle';
      mob.auras = [];
      return mob;
    },
    meta() {
      const me = sim.player;
      const meta = sim.players.get(me.id);
      if (!meta) throw new Error(`missing player meta for ${me.id}`);
      return meta;
    },
    resolved(id, name, school, effects) {
      return {
        def: {
          id,
          name,
          class: 'mage',
          learnLevel: 1,
          cost: 0,
          castTime: 0,
          cooldown: 0,
          range: 30,
          school,
          requiresTarget: true,
          effects,
          description: '',
        },
        rank: 1,
        cost: 0,
        castTime: 0,
        cooldown: 0,
        effects,
        threatFlat: 0,
        threatMult: 1,
      };
    },
    damageEventsSince(start, abilityId) {
      return sim.events
        .slice(start)
        .filter(
          (ev) => ev.type === 'damage' && ev.sourceId === sim.player.id && ev.ability === abilityId,
        );
    },
  };
});
await sleep(500);
await page.click('canvas').catch(() => {});

const fails = [];

const scene1 = await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.player;
  const meta = window.__pr2.meta();
  const wolf = window.__pr2.stageWolf();
  if (!wolf) return { fail: 'no wolf' };
  me.stats.int = -62.5;
  me.spellPower = 0;
  me.critChance = 0;
  const res = window.__pr2.resolved('test_ice_lance', 'Ice Lance', 'frost', [
    { type: 'directDamage', min: 30, max: 30, vsRootedMult: 3 },
  ]);
  const hp0 = wolf.hp;
  sim.ctx.runEffects(me, meta, wolf, res);
  const unrootedAmount = hp0 - wolf.hp;
  wolf.auras.push(window.__pr2.aura('root', 'test_root', 'Test Root', 'frost'));
  const hp1 = wolf.hp;
  sim.ctx.runEffects(me, meta, wolf, res);
  const rootedAmount = hp1 - wolf.hp;
  return {
    unrootedAmount,
    rootedAmount,
    exactTriple: unrootedAmount > 0 && rootedAmount === unrootedAmount * 3,
    rootVisible: wolf.auras.some((a) => a.id === 'test_root' && a.kind === 'root'),
  };
});
console.log('scene1 vs-rooted triple damage:', JSON.stringify(scene1));
if (scene1.fail || !scene1.exactTriple || !scene1.rootVisible) {
  fails.push(`scene1: vs-rooted damage wrong (${JSON.stringify(scene1)})`);
}
await sleep(250);
await page.screenshot({ path: 'tmp/pr2_vs_rooted_triple_damage.png' });
await sleep(900);

const scene2 = await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.player;
  const meta = window.__pr2.meta();
  const wolf = window.__pr2.stageWolf();
  if (!wolf) return { fail: 'no wolf' };
  me.stats.int = -62.5;
  me.spellPower = 0;
  me.critChance = 0;
  meta.talentMods.global.critVsRooted = 1;
  const res = window.__pr2.resolved('test_shatter', 'Shatter Spike', 'frost', [
    { type: 'directDamage', min: 30, max: 30 },
  ]);
  const hp0 = wolf.hp;
  sim.ctx.runEffects(me, meta, wolf, res);
  const unrootedAmount = hp0 - wolf.hp;
  wolf.auras.push(window.__pr2.aura('root', 'test_root', 'Test Root', 'frost'));
  const hp1 = wolf.hp;
  sim.ctx.runEffects(me, meta, wolf, res);
  const rootedAmount = hp1 - wolf.hp;
  // crit is inferred from the fixed 30-damage nuke: spells crit for 1.5x
  return {
    unrootedCrit: unrootedAmount === Math.round(unrootedAmount / 30) * 30 ? false : true,
    rootedCrit: rootedAmount === 45,
    unrootedAmount,
    rootedAmount,
    critVsRooted: meta.talentMods.global.critVsRooted,
    rootVisible: wolf.auras.some((a) => a.id === 'test_root' && a.kind === 'root'),
  };
});
console.log('scene2 shatter crit-vs-rooted:', JSON.stringify(scene2));
if (
  scene2.fail ||
  scene2.unrootedAmount !== 30 ||
  scene2.rootedCrit !== true ||
  scene2.critVsRooted !== 1 ||
  !scene2.rootVisible
) {
  fails.push(`scene2: crit-vs-rooted wrong (${JSON.stringify(scene2)})`);
}
await sleep(250);
await page.screenshot({ path: 'tmp/pr2_shatter_crit_vs_rooted.png' });
await sleep(900);

const scene3 = await page.evaluate(async () => {
  const sim = window.__game.sim;
  const me = sim.player;
  const meta = window.__pr2.meta();
  const wolf = window.__pr2.stageWolf();
  if (!wolf) return { fail: 'no wolf' };
  me.stats.int = -62.5;
  me.spellPower = 0;
  me.critChance = 0;
  const { abilitiesKnownAt } = await import('/src/sim/content/classes.ts');
  const { emptyModifiers } = await import('/src/sim/content/talents.ts');
  const added = { type: 'dot', total: 30, duration: 9, interval: 3 };
  const mods = emptyModifiers();
  mods.abilities.fireball = window.__pr2.emptyAbilityMod([added]);
  const fireball = abilitiesKnownAt('mage', 20, mods).find((k) => k.def.id === 'fireball');
  if (!fireball) return { fail: 'missing fireball' };
  const appended = fireball.effects.at(-1);
  const copied = appended && appended !== added;
  const start = sim.events.length;
  sim.ctx.runEffects(me, meta, wolf, fireball);
  const events = window.__pr2.damageEventsSince(start, 'fireball');
  const rider = wolf.auras.find(
    (a) =>
      a.kind === 'dot' &&
      a.id === 'fireball' &&
      a.duration === 9 &&
      a.tickInterval === 3 &&
      a.value === 10,
  );
  return {
    resolvedEffectCount: fireball.effects.length,
    appendedType: appended?.type ?? null,
    appendedTotal: appended?.total ?? null,
    appendedDuration: appended?.duration ?? null,
    appendedInterval: appended?.interval ?? null,
    copied: !!copied,
    damageEvents: events.length,
    riderVisible: !!rider,
    riderDuration: rider?.duration ?? null,
    riderInterval: rider?.tickInterval ?? null,
    riderTick: rider?.value ?? null,
  };
});
console.log('scene3 addEffects dot rider:', JSON.stringify(scene3));
if (
  scene3.fail ||
  scene3.appendedType !== 'dot' ||
  scene3.appendedTotal !== 30 ||
  scene3.appendedDuration !== 9 ||
  scene3.appendedInterval !== 3 ||
  !scene3.copied ||
  !scene3.riderVisible
) {
  fails.push(`scene3: addEffects dot rider wrong (${JSON.stringify(scene3)})`);
}
await sleep(250);
await page.screenshot({ path: 'tmp/pr2_addeffects_dot_rider.png' });

await browser.close();
for (const f of fails) console.error('FAIL:', f);
if (pageErrors.length) console.error('PAGE ERRORS:', pageErrors);
if (fails.length || pageErrors.length) process.exit(1);
console.log('PASS: all three PR2 primitive scenes verified live; shots in tmp/pr2_*.png');
