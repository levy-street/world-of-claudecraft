// Last Flame's Zeal uptime probe: the shared melee-enchant buff's uptime and
// trigger count for a Wildfang cat, a feral bear, and a Bloodrush warrior, each
// with the enchant on its mainhand against a single training dummy. Reports the
// landed melee hits that actually ROLL the enchant (the meleeSwing shell: autos
// and weaponStrike specials) next to the per-roll chance, so a gap between the
// specs reads as "fewer rolls" or "smaller chance per roll".
// Run: npx tsx scripts/zeal_uptime_probe.ts [seconds] [seeds]
import { ENCHANTS } from '../src/sim/content/enchants';
import { MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { OWNED_CLASS_PBE_LOADOUTS, runOwnedClassDpsProbe } from './owned_class_balance_probe';
import { anchorProbeInOpenField } from './probe_anchor';

const ZEAL = 'enchant_weapon_lastflame_zeal';
const SECONDS = Number(process.argv[2] ?? 300);
const SEEDS = Number(process.argv[3] ?? 8);
const BEAR_RAGE_PER_SEC = Number(process.env.BEAR_RAGE_PER_SEC ?? 12);
const ONLY = process.env.ZEAL_ONLY;
const DURATION = ENCHANTS[ZEAL].weaponProc?.duration ?? 15;

type AnySim = Sim & Record<string, any>;

interface Tally {
  ticks: number;
  upTicks: number;
  triggers: number;
  rollsBySource: Record<string, number>;
}

function enchantMainhand(sim: Sim): void {
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('no meta');
  meta.equipmentInstance.mainhand = { ...(meta.equipmentInstance.mainhand ?? {}), enchant: ZEAL };
  recalcPlayerStats(sim.player, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
}

// Wrap sim.tick so every tick samples the buff: up/down, and a trigger whenever
// the aura appears or its timer jumps back up (a refresh).
function instrument(sim: Sim, tally: Tally, isRoll: (ev: SimEvent) => string | null): void {
  const original = sim.tick.bind(sim);
  let lastRemaining = 0;
  (sim as AnySim).tick = () => {
    const events = original();
    const aura = sim.player.auras.find((a) => a.id === ZEAL);
    const remaining = aura?.remaining ?? 0;
    tally.ticks++;
    if (remaining > 0) tally.upTicks++;
    if (remaining > lastRemaining + 0.06) tally.triggers++;
    lastRemaining = remaining;
    for (const ev of events) {
      const key = isRoll(ev);
      if (key) tally.rollsBySource[key] = (tally.rollsBySource[key] ?? 0) + 1;
    }
    return events;
  };
}

// A landed melee hit from the player (a 'hit' or crit outcome with damage).
function landedFrom(sim: Sim, ev: SimEvent): ev is Extract<SimEvent, { type: 'damage' }> {
  return (
    ev.type === 'damage' &&
    ev.sourceId === sim.playerId &&
    (ev.kind === 'hit' || ev.kind === 'block') &&
    ev.amount > 0
  );
}

function newTally(): Tally {
  return { ticks: 0, upTicks: 0, triggers: 0, rollsBySource: {} };
}

function runCat(seed: number): Tally {
  const tally = newTally();
  runOwnedClassDpsProbe(
    'wildfang',
    { targets: 1, seconds: SECONDS as 120, window: 'sustained' },
    seed,
    'zeal',
    undefined,
    'pbe',
    (sim) => {
      enchantMainhand(sim);
      instrument(sim, tally, (ev) => (landedFrom(sim, ev) ? (ev.ability ?? 'Auto Attack') : null));
    },
  );
  return tally;
}

function dummyFor(sim: Sim, id: number): Entity {
  const p = sim.player;
  const dummy = createMob(id, MOBS.training_dummy, 20, { x: p.pos.x, y: p.pos.y, z: p.pos.z + 2 });
  dummy.hostile = true;
  dummy.maxHp = 50_000_000;
  dummy.hp = dummy.maxHp;
  sim.addEntity(dummy);
  sim.targetEntity(dummy.id);
  p.facing = 0;
  return dummy;
}

function runBear(seed: number): Tally {
  const tally = newTally();
  const sim = new Sim({ seed, playerClass: 'druid', autoEquip: false }) as AnySim;
  sim.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  if (!sim.applyTalents({ spec: 'feral', rows: {} })) throw new Error('feral talents');
  const mainhand = OWNED_CLASS_PBE_LOADOUTS.wildfang.mainhand;
  if (!mainhand) throw new Error('no wildfang mainhand');
  sim.addItem(mainhand, 1);
  sim.equipItemToSlot(mainhand, 'mainhand');
  enchantMainhand(sim);
  sim.castAbility('bear_form');
  sim.tick();
  dummyFor(sim, 93001);
  sim.startAutoAttack();
  instrument(sim, tally, (ev) => (landedFrom(sim, ev) ? (ev.ability ?? 'Auto Attack') : null));
  // Maul is also Marrowbreak's button at 3 Old Blood (actionReplacement).
  const ROTATION = ['enrage', 'maul', 'swipe'];
  // A training dummy never swings back, and a bear's rage comes from the hits
  // it takes, so the dummy alone leaves a bear rage-starved and idle. Feed a
  // steady tanking-shaped income instead (BEAR_RAGE_PER_SEC, a probe knob,
  // not a balance claim) so the rotation actually presses its strikes.
  for (let i = 0; i < SECONDS * 20; i++) {
    if (i % 20 === 0)
      sim.player.resource = Math.min(
        sim.player.maxResource,
        sim.player.resource + BEAR_RAGE_PER_SEC,
      );
    for (const id of ROTATION) sim.castAbility(id);
    sim.tick();
  }
  return tally;
}

function runWarrior(seed: number): Tally {
  const tally = newTally();
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true }) as AnySim;
  sim.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  if (!sim.setSpec('fury')) throw new Error('setSpec fury failed');
  sim.tick();
  for (const [level, row] of [
    [14, 'war_row_anger_management'],
    [17, 'war_row_recklessness'],
    [20, 'war_row_colossal_might'],
  ] as const) {
    if (!sim.selectTalentRow(level, row)) throw new Error(`row pick failed: ${row}`);
  }
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('no meta');
  meta.equipment.mainhand = 'deathless_greatblade';
  meta.equipment.offhand = 'bonewrought_greatsword';
  enchantMainhand(sim);
  dummyFor(sim, 93002);
  sim.player.autoAttack = true;
  instrument(sim, tally, (ev) => (landedFrom(sim, ev) ? (ev.ability ?? 'Auto Attack') : null));
  const ROTATION = ['recklessness', 'red_harvest', 'bloodthirst', 'raging_gale', 'whirlwind'];
  sim.castAbility('battle_shout');
  for (let i = 0; i < SECONDS * 20; i++) {
    for (const id of ROTATION) {
      if (id === 'red_harvest' && sim.player.resource < 80) continue;
      sim.castAbility(id);
    }
    sim.tick();
  }
  return tally;
}

function report(label: string, run: (seed: number) => Tally): void {
  const totals = newTally();
  for (let s = 0; s < SEEDS; s++) {
    const t = run(41_000 + s * 7);
    totals.ticks += t.ticks;
    totals.upTicks += t.upTicks;
    totals.triggers += t.triggers;
    for (const [k, v] of Object.entries(t.rollsBySource))
      totals.rollsBySource[k] = (totals.rollsBySource[k] ?? 0) + v;
  }
  const minutes = totals.ticks / 20 / 60;
  const landed = Object.entries(totals.rollsBySource)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${(v / minutes).toFixed(1)}`)
    .join(', ');
  console.log(
    `${label.padEnd(10)} uptime ${((100 * totals.upTicks) / totals.ticks).toFixed(1)}%  ` +
      `triggers/min ${(totals.triggers / minutes).toFixed(2)}  (buff ${DURATION}s, ${SEEDS} x ${SECONDS}s)\n` +
      `           landed player damage events/min: ${landed}`,
  );
}

for (const [label, run] of [
  ['cat', runCat],
  ['bear', runBear],
  ['warrior', runWarrior],
] as const) {
  if (!ONLY || ONLY === label) report(label, run);
}
