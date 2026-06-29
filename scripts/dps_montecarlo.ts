// Monte Carlo peak-DPS simulator.
//
// For every class it spawns one max-level player specced + geared + self-buffed for
// damage (plus a pet for the pet classes), stands it next to indestructible target
// dummies, drives a greedy damage rotation for a fixed fight, and sums the damage
// the player AND its pet deal. It repeats that over many RNG seeds and reports the
// DPS distribution (mean / median / p95 / peak / stddev), so the spread from
// crit/miss/proc variance is visible, not just a single number.
//
// It drives the REAL deterministic sim (`src/sim/`), so the numbers track whatever
// the live balance is on the branch you run it from. Run:
//     npm run bench:dps
//     npx tsx scripts/dps_montecarlo.ts --runs 200 --seconds 90
//     npx tsx scripts/dps_montecarlo.ts --targets 5      # AoE throughput
//     npx tsx scripts/dps_montecarlo.ts --no-talents --naked --no-buffs   # baseline
//
// "Peak" means the player is set up the way you would for a damage parse:
//  - TALENTS: a full damage-spec build is auto-allocated (the dps spec, filled
//    lowest-row-first respecting gates/prereqs). This grants the spec's signature
//    ability + mastery + damage nodes. (--no-talents to measure untalented.)
//  - SELF-BUFFS: every non-damage buff the class knows (Battle Shout, Aspect of the
//    Hawk, Demon Skin, ...) is cast in a pre-pull phase so it's up for the fight.
//    (--no-buffs to skip.)
//  - GEAR: best-in-slot per slot from ITEMS, respecting requiredClass. (--naked to skip.)
//  - RESOURCE: topped up each tick so the rotation never starves (--sustained to let
//    it regen naturally — the realistic floor).
//
// The rotation is a class-agnostic greedy (not a hand-tuned APL): each global-cooldown
// opening it refreshes a fallen-off DoT, fires off-cooldown nukes, spends a full combo
// bar on a finisher, prioritises AoE when there are multiple targets, else casts its
// highest-average-damage ready ability. Per-class APLs can be layered on later.

import { abilitiesKnownAt, type KnownAbility } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  TALENTS,
  type TalentAllocation,
  talentPointsAtLevel,
} from '../src/sim/content/talents';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { type CharacterState, Sim } from '../src/sim/sim';
import {
  type AbilityEffect,
  ALL_CLASSES,
  DT,
  type Entity,
  EQUIP_SLOTS,
  type EquipSlot,
  type ItemDef,
  MAX_LEVEL,
  type PlayerClass,
  type PlayerEquipment,
} from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// ---- config (CLI overridable) ----
const arg = (flag: string, def: number): number => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};
const has = (flag: string) => process.argv.includes(flag);
const RUNS = arg('--runs', 80);
const SECONDS = arg('--seconds', 60);
const BASE_SEED = arg('--seed', 1000);
const TARGETS = Math.max(1, arg('--targets', 1));
const PEAK = !has('--sustained'); // top up resource each tick
const NAKED = has('--naked'); // skip gear
const NO_TALENTS = has('--no-talents');
const NO_BUFFS = has('--no-buffs');
const bi = process.argv.indexOf('--breakdown');
const BREAKDOWN = bi >= 0 ? (process.argv[bi + 1] as PlayerClass | undefined) : undefined;

const DAMAGE_EFFECTS = new Set<AbilityEffect['type']>([
  'directDamage',
  'dot',
  'aoeDamage',
  'aoeRoot',
  'groundAoE',
  'drainTick',
  'finisherDamage',
]);
const AOE_EFFECTS = new Set<AbilityEffect['type']>(['aoeDamage', 'aoeRoot', 'groundAoE']);

const hasDamage = (k: KnownAbility) => k.effects.some((e) => DAMAGE_EFFECTS.has(e.type));
const isOffensive = (k: KnownAbility) => k.def.targetType !== 'friendly' && hasDamage(k);
const isAoe = (k: KnownAbility) => k.effects.some((e) => AOE_EFFECTS.has(e.type));
// A shapeshift form (druid). Shifting LOCKS the caster kit, so the harness must not
// auto-cast a form during the pre-buff phase or a balance druid would be stuck in
// travel/bear/cat form for the whole fight, unable to nuke (only auto-attack lands).
const isForm = (k: KnownAbility) =>
  k.effects.some(
    (e) =>
      e.type === 'selfBuff' &&
      (e.kind === 'form_bear' || e.kind === 'form_cat' || e.kind === 'form_travel'),
  );
// A buff we want up for the fight: applies an aura, deals no damage, not a form, not
// aimed at an enemy.
const isBuff = (k: KnownAbility) =>
  k.def.targetType !== 'enemy' &&
  !hasDamage(k) &&
  !isForm(k) &&
  k.effects.some((e) => e.type === 'selfBuff' || e.type === 'buffTarget' || e.type === 'imbue');

// Can this ability actually be cast right now? The harness never shapeshifts or
// stealths, so form/stealth-gated abilities (druid cat/bear kit, rogue openers)
// would fail in casting_lifecycle and stall a naive rotation - exclude them up
// front. (A real moonkin/feral parse would pick its form; this harness measures
// the caster/stander build, which is what the dps-role spec implies for druid.)
const castableNow = (k: KnownAbility) => !k.def.requiresForm && !k.def.requiresStealth;

// Average up-front damage of an ability, for greedy ranking (DoT totals included).
function abilityValue(k: KnownAbility): number {
  let v = 0;
  for (const e of k.effects) {
    if (e.type === 'directDamage' || e.type === 'aoeDamage') v += (e.min + e.max) / 2;
    else if (e.type === 'drainTick') v += ((e.min + e.max) / 2) * 3;
    else if (e.type === 'dot') v += e.total;
    else if (e.type === 'finisherDamage') v += e.base + e.perCombo * 5;
    else if (e.type === 'groundAoE') v += (e.min + e.max) / 2;
    else if (e.type === 'aoeRoot') v += (e.min + e.max) / 2;
  }
  return v;
}

// --- best-in-slot gear per class: highest scoring usable item per slot ---
function itemScore(it: ItemDef): number {
  const s = it.stats ?? {};
  let score =
    (s.str ?? 0) +
    (s.agi ?? 0) +
    (s.sta ?? 0) +
    (s.int ?? 0) +
    (s.spi ?? 0) +
    (s.armor ?? 0) * 0.05;
  if (it.weapon) score += ((it.weapon.min + it.weapon.max) / 2 / it.weapon.speed) * 14;
  const rank = { poor: 0, common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 }[
    it.quality ?? 'common'
  ];
  return score + rank * 0.01; // tie-break toward higher rarity
}

function bestInSlot(cls: PlayerClass): PlayerEquipment {
  const eq: PlayerEquipment = {};
  for (const slot of EQUIP_SLOTS) {
    let best: ItemDef | null = null;
    for (const it of Object.values(ITEMS)) {
      if (it.slot !== slot) continue;
      if (slot === 'mainhand' ? it.kind !== 'weapon' : it.kind !== 'armor') continue;
      if (it.requiredClass && !it.requiredClass.includes(cls)) continue;
      if (!best || itemScore(it) > itemScore(best)) best = it;
    }
    if (best) eq[slot as EquipSlot] = best.id;
  }
  return eq;
}

// --- auto-allocate a full DAMAGE-spec talent build (lowest row first, gates honored) ---
function dpsAllocation(cls: PlayerClass): TalentAllocation {
  const alloc: TalentAllocation = { spec: null, ranks: {}, choices: {} };
  const tree = TALENTS[cls];
  if (!tree) return alloc;
  const spec = tree.specs.find((s) => s.role === 'dps') ?? tree.specs[0];
  if (!spec) return alloc;
  alloc.spec = spec.id;
  const nodes = tree.nodes.filter((n) => n.tree === 'spec' && n.specId === spec.id);
  const spent = () =>
    nodes.reduce((s, n) => s + (alloc.ranks[n.id] ?? 0) + (alloc.choices[n.id] ? 1 : 0), 0);
  let budget = talentPointsAtLevel(MAX_LEVEL);
  while (budget > 0) {
    const open = nodes
      .filter((n) => {
        const cur = n.kind === 'choice' ? (alloc.choices[n.id] ? 1 : 0) : (alloc.ranks[n.id] ?? 0);
        if (cur >= n.maxRank) return false;
        if (n.requires?.some((r) => !alloc.ranks[r] && !alloc.choices[r])) return false;
        if (n.pointsGate && spent() < n.pointsGate) return false;
        return true;
      })
      .sort((a, b) => a.row - b.row || a.col - b.col);
    if (open.length === 0) break;
    const n = open[0];
    if (n.kind === 'choice') alloc.choices[n.id] = n.choices?.[0]?.id ?? '';
    else alloc.ranks[n.id] = (alloc.ranks[n.id] ?? 0) + 1;
    budget--;
  }
  return alloc;
}

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = { x, y: terrainHeight(x, z, sim.cfg.seed), z };
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function makeDummy(sim: Sim, x: number, z: number): Entity {
  const d = createMob(sim.nextId++, MOBS.forest_wolf, MAX_LEVEL, { x: 0, y: 0, z: 0 });
  d.maxHp = 1e12;
  d.hp = d.maxHp;
  d.moveSpeed = 0;
  d.weapon = { min: 0, max: 0, speed: 99 }; // never hurts the player
  sim.addEntity(d);
  place(sim, d, x, z);
  d.spawnPos = { ...d.pos };
  return d;
}

function runFight(cls: PlayerClass, seed: number): { dps: number; petShare: number } {
  const sim = new Sim({ seed, playerClass: cls, noPlayer: true });
  const alloc = NO_TALENTS ? { spec: null, ranks: {}, choices: {} } : dpsAllocation(cls);
  const state: CharacterState = {
    level: MAX_LEVEL,
    xp: 0,
    copper: 0,
    hp: 1,
    resource: 0,
    pos: { x: 0, z: 0 },
    facing: 0,
    equipment: NAKED ? {} : bestInSlot(cls),
    inventory: [],
    questLog: [],
    questsDone: [],
    talents: alloc,
  };
  const pid = sim.addPlayer(cls, cls, { state });
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`no player entity for ${cls}`);
  sim.setPlayerLevel(MAX_LEVEL, pid); // refill hp/mana + refresh known abilities

  // Dummies clustered so AoE hits them all; the first is the focus target.
  const dummies: Entity[] = [];
  for (let i = 0; i < TARGETS; i++) dummies.push(makeDummy(sim, p.pos.x + 2 + i * 0.5, p.pos.z));
  const focus = dummies[0];

  if (cls === 'hunter' || cls === 'warlock') {
    const tpl = cls === 'hunter' ? MOBS.forest_wolf : MOBS.warlock_imp;
    if (tpl) {
      const pet = createMob(sim.nextId++, tpl, MAX_LEVEL, { x: 0, y: 0, z: 0 });
      pet.ownerId = pid;
      pet.hostile = false;
      pet.petMode = 'aggressive';
      pet.aggroTargetId = focus.id;
      pet.hp = pet.maxHp;
      sim.addEntity(pet);
      place(sim, pet, p.pos.x + 1, p.pos.z);
    }
  }

  sim.targetEntity(focus.id, pid);
  const mods = computeTalentModifiers(cls, alloc);
  const known = abilitiesKnownAt(cls, MAX_LEVEL, mods);
  const offensive = known.filter((k) => isOffensive(k) && castableNow(k));
  const buffs = known.filter((k) => isBuff(k) && castableNow(k));

  // Pre-pull: get every self-buff up before the measured window (don't spend measured
  // GCDs on them). Target SELF so friendly self-buffs (Mark of the Wild, Blessing of
  // Might, Battle Shout) land on the caster, cast each buff not already up, ticking
  // between. Then clear any dangling cast/GCD and retarget the dummy so the fight
  // starts clean - leaving a buff mid-cast would otherwise stall the whole rotation
  // (the `!castingAbility` guard below blocks every nuke and only auto-attack runs).
  if (!NO_BUFFS) {
    sim.targetEntity(pid, pid);
    for (let t = 0; t < 120; t++) {
      if (p.gcdRemaining <= 0 && !p.castingAbility) {
        p.resource = p.maxResource;
        const b = buffs.find(
          (k) => (p.cooldowns.get(k.def.id) ?? 0) <= 0 && !p.auras.some((a) => a.id === k.def.id),
        );
        if (!b) break;
        sim.castAbility(b.def.id, pid);
      }
      sim.tick();
    }
    p.castingAbility = null;
    p.gcdRemaining = 0;
    sim.targetEntity(focus.id, pid);
  }
  sim.startAutoAttack(pid);

  const petOwner = new Map<number, number>();
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && e.ownerId !== null) petOwner.set(e.id, e.ownerId);
  }

  let total = 0;
  let petDmg = 0;
  const bySource = new Map<string, number>(); // ability id (or 'auto'/'pet') -> damage
  const ticks = Math.round(SECONDS / DT);
  for (let t = 0; t < ticks; t++) {
    p.facing = Math.atan2(focus.pos.x - p.pos.x, focus.pos.z - p.pos.z);
    if (PEAK) p.resource = p.maxResource;
    if (p.gcdRemaining <= 0 && !p.castingAbility) {
      const ready = offensive.filter(
        (k) => (p.cooldowns.get(k.def.id) ?? 0) <= 0 && p.resource >= k.cost,
      );
      const pick = chooseAbility(ready, p, focus);
      if (pick) sim.castAbility(pick.def.id, pid);
    }
    for (const ev of sim.tick()) {
      if (ev.type === 'damage' && ev.kind === 'hit' && ev.amount > 0) {
        const owner = petOwner.get(ev.sourceId) ?? ev.sourceId;
        if (owner === pid) {
          total += ev.amount;
          const isPet = petOwner.has(ev.sourceId);
          if (isPet) petDmg += ev.amount;
          const key = isPet ? 'pet' : (ev.ability ?? 'auto-attack');
          bySource.set(key, (bySource.get(key) ?? 0) + ev.amount);
        }
      }
    }
  }
  return { dps: total / SECONDS, petShare: total > 0 ? petDmg / total : 0, bySource };
}

function chooseAbility(ready: KnownAbility[], p: Entity, target: Entity): KnownAbility | null {
  if (ready.length === 0) return null;
  // 1) refresh a fallen-off damage DoT on the focus target (skip pure-CC roots).
  for (const k of ready) {
    const isDamageDot =
      k.effects.some((e) => e.type === 'dot') && !k.effects.some((e) => e.type === 'aoeRoot');
    if (isDamageDot && !target.auras.some((a) => a.id === k.def.id)) return k;
  }
  let best: KnownAbility | null = null;
  let bestScore = -1;
  for (const k of ready) {
    const isFinisher = k.effects.some((e) => e.type === 'finisherDamage');
    if (isFinisher && p.comboPoints < 4) continue; // don't waste a weak finisher
    if (k.effects.some((e) => e.type === 'dot') && target.auras.some((a) => a.id === k.def.id)) {
      continue; // DoT already ticking (handled in step 1)
    }
    let score = abilityValue(k);
    if (k.cooldown > 0) score += 1000 + k.cooldown; // use cooldown abilities on cooldown
    if (isFinisher) score += 500;
    if (TARGETS > 1 && isAoe(k)) score += 2000; // multi-target: lead with AoE
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best ?? ready[0];
}

// ---- Monte Carlo + reporting ----
function stats(xs: number[]): { mean: number; p50: number; p95: number; peak: number; sd: number } {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { mean, p50: q(0.5), p95: q(0.95), peak: s[s.length - 1], sd };
}

const pad = (s: string, n: number) => s.padEnd(n);
const num = (x: number) => x.toFixed(1).padStart(7);

// --- single-class damage breakdown: where does the DPS come from? ---
if (BREAKDOWN) {
  if (!ALL_CLASSES.includes(BREAKDOWN)) {
    console.error(`unknown class "${BREAKDOWN}"; one of: ${ALL_CLASSES.join(', ')}`);
    process.exit(1);
  }
  const agg = new Map<string, number>();
  let dpsSum = 0;
  for (let r = 0; r < RUNS; r++) {
    const { dps, bySource } = runFight(BREAKDOWN, BASE_SEED + r);
    dpsSum += dps;
    for (const [k, v] of bySource) agg.set(k, (agg.get(k) ?? 0) + v);
  }
  const grand = [...agg.values()].reduce((a, b) => a + b, 0) || 1;
  console.log(`\n${BREAKDOWN} damage breakdown  -  ${RUNS} runs x ${SECONDS}s\n`);
  console.log(`${pad('source', 18)} ${pad('% of total', 11)} dps`);
  console.log('-'.repeat(40));
  for (const [k, v] of [...agg].sort((a, b) => b[1] - a[1])) {
    const pct = `${((v / grand) * 100).toFixed(1)}%`;
    console.log(`${pad(k, 18)} ${pct.padStart(10)} ${num(v / RUNS / SECONDS)}`);
  }
  console.log('-'.repeat(40));
  console.log(`${pad('mean DPS', 18)} ${'100.0%'.padStart(10)} ${num(dpsSum / RUNS)}\n`);
  process.exit(0);
}

const setup = [
  NO_TALENTS ? 'no talents' : 'dps-spec talents',
  NO_BUFFS ? 'no buffs' : 'self-buffed',
  NAKED ? 'no gear' : 'best-in-slot',
  PEAK ? 'peak (resource-capped)' : 'sustained',
  `${TARGETS} target${TARGETS > 1 ? 's' : ''}`,
].join(' / ');
console.log(`\nPeak-DPS Monte Carlo  -  ${RUNS} runs x ${SECONDS}s per class\n${setup}\n`);
console.log(
  `${pad('class', 9)} ${pad('mean', 7)} ${pad('median', 7)} ${pad('p95', 7)} ${pad('peak', 7)} ${pad('stddev', 7)}  pet%`,
);
console.log('-'.repeat(64));
for (const cls of ALL_CLASSES) {
  const samples: number[] = [];
  let petShareSum = 0;
  for (let r = 0; r < RUNS; r++) {
    const { dps, petShare } = runFight(cls, BASE_SEED + r);
    samples.push(dps);
    petShareSum += petShare;
  }
  const st = stats(samples);
  const petPct = ((petShareSum / RUNS) * 100).toFixed(0);
  console.log(
    `${pad(cls, 9)} ${num(st.mean)} ${num(st.p50)} ${num(st.p95)} ${num(st.peak)} ${num(st.sd)}  ${petPct.padStart(3)}%`,
  );
}
console.log('');
