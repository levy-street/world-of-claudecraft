// THE R5 ENVELOPE PROBE (masterwrought Phase 15).
//
// Produces docs/prd/masterwrought/power-verification.md section 9.5 and the
// rogue rows of section 9.2 exactly; the fury and caster rows of 9.2 came from
// a superseded fixture and are marked STALE there (the 9.2 blockquote), so
// this probe deliberately does NOT reproduce them. R5 is the packet's
// defining gate:
//
//   "full kit (2 Perfected pieces + apex enchants + flask + food) at most
//    5 percent total throughput over pre-packet raid BiS, measured via
//    docs/design/spell-balance-framework.md. Heroic raid and S-rift clear
//    difficulty is the protected asset."
//
//   npx tsx scripts/r5_envelope_probe.ts            # the full table
//   npx tsx scripts/r5_envelope_probe.ts fury       # one lane
//   WOC_R5_SEEDS=60 WOC_R5_SECONDS=600 npx tsx scripts/r5_envelope_probe.ts fury
//
// SHAPE, and why it is this shape. The framework's Sustained profile fixes
// seed, level, spec, gear and item level, talents, target armor and level,
// resource rules, rotation and external buffs, and forbids restoring a
// resource each tick. Every one of those is a named constant below. The three
// tools the framework's own "Existing tools" table names cannot accept a gear
// kit at all (each builds its reference character from the class starter kit),
// so this probe is built in the shape of the repo's gear-aware fight probes
// instead: an ambient-free world, an anchored position, an inert target at a
// fixed level and armor, a real rotation, fixed seeds, no refill.
//
// TWO THINGS THAT ARE LOAD-BEARING AND EASY TO GET WRONG:
//
// 1. Damage is summed from the sim's damage EVENTS, never from the target's
//    hp delta. A target that leaves combat regenerates: the caster lane reads
//    2.2 dps by hp delta and 72.7 by event sum on the same fight, because the
//    fixture goes out of mana partway and the dummy heals back up.
// 2. The BASELINE is the epic-only dev best-in-slot pick with the packet's
//    flagged defs removed, spelled out by id below rather than derived, so a
//    later content change cannot silently re-gear the denominator. Excluding
//    legendaries makes it the CONSERVATIVE denominator: a legendary-inclusive
//    baseline is stronger and would report a smaller percentage. Two stated
//    departures carry legendaries the other way, both conservative: the tank
//    arm by its own max-effective-health rule, and the caster set's
//    legendary mainhand (see the caster lane header).
//
// The kit arm is the baseline character plus exactly the packet's own delta,
// applied through the channels an enchant and a Perfected bonus really use
// (instance rolled.stats, and auras), so the two arms differ by the packet
// and nothing else. The tank arm is the one exception and says so at its
// definition: it swaps the two apex pieces in as ITEMS, because its gear term
// is armour rather than a primary stat.
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { ENCHANTS } from '../src/sim/content/enchants';
import { BUILTIN_WORLD, ITEMS, MOBS } from '../src/sim/data';
import type { PlayerEquipment } from '../src/sim/entity';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { RIFT_HEROIC_TUNING, RIFT_S_LEVEL } from '../src/sim/rift/ranks';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { armorReduction } from '../src/sim/types';
import { anchorProbeInOpenField } from './probe_anchor';
import { LA_LUNA_ROGUE_ROWS } from './rogue_dps_probe';
import { WARLOCK_FULL_BIS_GEAR } from './warlock_balance_probe';

type Stats = Partial<Record<string, number>>;
type SlotStats = Record<string, Stats>;

// --- the targets, derived (power-verification.md section 5) ------------------
// EVERY input is read from the live tuning tables, never baked: the boss-arena
// row's level and armorMultiplier, RIFT_S_LEVEL and the S rank's
// armorMultiplier, and the Nythraxis template's armorPerLevel
// (src/sim/content/dungeons.ts). createMob gives a mob
// armorPerLevel * (level - 1) armor. The pinned literals (22/1058, 23/1294)
// live in tests/r5_envelope_probe.test.ts, so a retune of any of these rows
// reds the suite and forces a re-measure, which is the correct failure.
const NYTH_ARMOR_PER_LEVEL = (MOBS.nythraxis_scourge_of_thornpeak as { armorPerLevel: number })
  .armorPerLevel;
const HEROIC_ROW = HEROIC_DUNGEON_TUNING.nythraxis_boss_arena;
if (!HEROIC_ROW) throw new Error('HEROIC_DUNGEON_TUNING lost its nythraxis_boss_arena row');
const SRIFT_ROW = RIFT_HEROIC_TUNING.S;
if (!SRIFT_ROW) throw new Error('RIFT_HEROIC_TUNING lost its S rank row');
export const HEROIC_TARGET = {
  name: `heroic-raid-L${HEROIC_ROW.level}`,
  level: HEROIC_ROW.level,
  armor: Math.round(NYTH_ARMOR_PER_LEVEL * (HEROIC_ROW.level - 1) * HEROIC_ROW.armorMultiplier),
} as const;
export const SRIFT_TARGET = {
  name: `s-rift-L${RIFT_S_LEVEL}`,
  level: RIFT_S_LEVEL,
  armor: Math.round(NYTH_ARMOR_PER_LEVEL * (RIFT_S_LEVEL - 1) * SRIFT_ROW.armorMultiplier),
} as const;

const SEEDS_DEFAULT = [
  4242, 777, 1313, 99, 2024, 555, 31337, 8080, 61, 1201, 3, 17, 4919, 6023, 7331, 8123, 9091, 10007,
  11113, 12227, 13337, 14149, 15161, 16183, 17203, 1000, 1137, 1274, 1411, 1548, 1685, 1822, 1959,
  2096, 2233, 2370, 2507, 2644, 2781, 2918, 3055, 3192, 3329, 3466, 3603, 3740, 3877, 4014, 4151,
  4288, 4425, 4562, 4699, 4836, 4973, 5110, 5247, 5384, 5521, 5658,
] as const;
// THE ENCHANT DELTA IS READ, NEVER BAKED. The flask and the plate terms below
// read their magnitudes off the live defs, and this term must too: it is the
// one the R5 pass TUNED, so a literal here would keep reporting the tuned
// number after someone restored the def, and the probe would hand a false PASS
// to exactly the reader the doc sends here. Derived per axis, apex minus the
// pre-packet best on the same slot.
const enchantBonus = (id: string, axis: 'str' | 'int' | 'agi' | 'sta'): number =>
  (ENCHANTS[id] as { statBonus?: Record<string, number> } | undefined)?.statBonus?.[axis] ?? 0;
export const WEAPON_STR_STEP =
  enchantBonus('enchant_weapon_lucent_might', 'str') -
  enchantBonus('enchant_weapon_greater_might', 'str');
export const WEAPON_INT_STEP =
  enchantBonus('enchant_weapon_lucent_spellpower', 'int') -
  enchantBonus('enchant_weapon_greater_spellpower', 'int');
export const FEET_AGI_STEP =
  enchantBonus('enchant_feet_lucent_agility', 'agi') - enchantBonus('enchant_feet_agility', 'agi');
// The chest rung has two arms: the Perfected-only Lucent Infusion a cloth or
// leather wearer can take, and the plate/mail Lucent Stamina every other class
// falls back to, since no mail or plate apex CHEST ships.
export const CHEST_STA_STEP_PERFECTED =
  enchantBonus('enchant_lucent_infusion', 'sta') -
  enchantBonus('enchant_chest_greater_stamina', 'sta');
export const CHEST_STA_STEP_PLATE =
  enchantBonus('enchant_chest_lucent_stamina', 'sta') -
  enchantBonus('enchant_chest_greater_stamina', 'sta');

const SEED_COUNT = Number(process.env.WOC_R5_SEEDS ?? 25);
const SECONDS = Number(process.env.WOC_R5_SECONDS ?? 180);
// WOC_R5_ARMS restricts which kit arms run, for a PRECISION pass on one number
// rather than the whole table. It gates all three THROUGHPUT lanes by each
// arm's printed label; the tank lane always runs (deterministic, effectively
// free). The baseline always runs (every delta is against it). Unset means
// every arm, which is what the record's tables report.
const WANTED_ARMS = (process.env.WOC_R5_ARMS ?? '').split(',').filter(Boolean);
const WANT = (arm: string): boolean => WANTED_ARMS.length === 0 || WANTED_ARMS.includes(arm);
// Never a SILENT truncation: WOC_R5_SEEDS above the curated list's length used
// to slice down to it and print the smaller sample under the larger label. The
// curated entries stay first so any run at or below their count reproduces the
// record exactly; past that the list extends deterministically.
const SEEDS: number[] = (() => {
  const out: number[] = SEEDS_DEFAULT.slice(0, SEED_COUNT);
  for (let i = out.length; i < SEED_COUNT; i++) out.push(100003 + i * 149);
  return out;
})();

// --- the consumables (power-verification.md section 8.3) --------------------
// Both arms carry the pre-packet consumable ceiling; only the flask and the
// plate are the packet's. No pre-packet elixir or scroll raises attack power
// or intellect: all seven pre-packet carriers (four elixirs, three scrolls)
// are buff_sta, so the two throughput terms are wholly new while the tank's
// nets against the serpent's 12. The value literal below is welded to the
// elixir_of_the_serpent def by tests/r5_envelope_probe.test.ts.
const SERPENT: Aura = {
  id: 'elixir_buff_sta',
  name: 'Might of the Serpent',
  kind: 'buff_sta',
  remaining: 900,
  duration: 900,
  value: 12,
} as unknown as Aura;
// Per-KIND defs, never one def read for every kind. The three flasks and the
// three plates are uniform today, but section 10.4 records "tune only
// warboar_flask and runewater_flask" as an available and un-taken option: if a
// future pass takes it, a single-def read would keep printing the stamina
// value on the attack-power and intellect lanes and report an envelope that is
// not the tree's.
const FLASK_BY_KIND: Record<string, string> = {
  buff_sta: 'ironhusk_flask',
  buff_ap: 'warboar_flask',
  buff_int: 'runewater_flask',
};
const PLATE_BY_KIND: Record<string, string> = {
  buff_sta: 'stonepot_stew',
  buff_ap: 'warspice_skewers',
  buff_int: 'sageleaf_chowder',
};
const defValue = (
  map: Record<string, string>,
  kind: string,
  field: 'elixir' | 'wellFed',
): number => {
  const id = map[kind];
  if (!id) throw new Error(`no ${field} def for kind ${kind}`);
  const payload = (ITEMS[id] as unknown as Record<string, unknown>)[field] as
    | { value?: number }
    | undefined;
  if (typeof payload?.value !== 'number') throw new Error(`${id} carries no ${field} value`);
  return payload.value;
};
const flaskAura = (kind: string, name: string): Aura =>
  ({
    id: `elixir_${kind}`,
    name,
    kind,
    remaining: 1200,
    duration: 1200,
    value: defValue(FLASK_BY_KIND, kind, 'elixir'),
    flask: true,
    undispellable: true,
  }) as unknown as Aura;
const plateAura = (kind: string): Aura =>
  ({
    id: 'well_fed',
    name: 'Well Fed',
    kind,
    remaining: 900,
    duration: 900,
    value: defValue(PLATE_BY_KIND, kind, 'wellFed'),
  }) as unknown as Aura;

// --- the fixture ------------------------------------------------------------
const PROBE_WORLD = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
type AnySim = Sim & Record<string, never>;

function dress(
  sim: Sim,
  equipment: PlayerEquipment,
  enchants: SlotStats,
  delta: SlotStats,
  auras: Aura[],
): void {
  const s = sim as unknown as {
    player: Entity;
    players: Map<number, Record<string, unknown>>;
    ctx: { applyAura(e: Entity, a: Aura): void; playerMods(m: unknown): unknown };
  };
  const p = s.player;
  const meta = s.players.get(p.id) as Record<string, unknown>;
  meta.equipment = { ...equipment };
  const instances: Record<string, unknown> = {};
  for (const [slot, itemId] of Object.entries(equipment)) {
    const stats: Record<string, number> = { ...(enchants[slot] ?? {}) } as Record<string, number>;
    for (const [k, v] of Object.entries(delta[slot] ?? {})) {
      stats[k] = (stats[k] ?? 0) + (v as number);
    }
    instances[slot] = { itemId, rolled: { stats } };
  }
  meta.equipmentInstance = instances;
  const recalc = () =>
    recalcPlayerStats(
      p,
      meta.cls as never,
      meta.equipment as never,
      s.ctx.playerMods(meta) as never,
      meta.equipmentInstance as never,
    );
  recalc();
  for (const a of auras)
    s.ctx.applyAura(p, { ...a, sourceId: p.id, school: a.school ?? ('nature' as const) });
  recalc();
  p.hp = p.maxHp;
  // Resource is deliberately NOT touched: the sim's own initialization already
  // gives each class the right opening (a warrior starts a fight at 0 rage, a
  // rogue at full energy, a caster at full mana), and refilling it to
  // maxResource would hand a fury warrior 100 rage it has to EARN. That is a
  // refill, which power-verification.md section 9.1 forbids, and it compresses
  // the very rage coupling section 9.3 identifies as why fury is the binding
  // lane: it read 4.34 percent at heroic against the 4.94 the fixture without
  // it measures.
}

function inertTarget(sim: Sim, level: number, armor: number): Entity {
  const s = sim as unknown as {
    player: Entity;
    addEntity(e: Entity): void;
    targetEntity(id: number): void;
  };
  const p = s.player;
  const t = createMob(93001, MOBS.training_dummy, level, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  });
  t.hostile = true;
  t.aiState = 'idle';
  t.moveSpeed = 0;
  t.stats.armor = armor;
  t.maxHp = 2_000_000_000;
  t.hp = t.maxHp;
  t.weapon.min = 0;
  t.weapon.max = 0;
  t.weapon.speed = 100;
  s.addEntity(t);
  s.targetEntity(t.id);
  p.facing = Math.atan2(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
  return t;
}

function fight(sim: Sim, t: Entity, seconds: number, act: () => void): number {
  const p = (sim as unknown as { player: Entity }).player;
  let total = 0;
  for (let i = 0; i < seconds * 20; i++) {
    act();
    for (const e of sim.tick()) {
      if (e.type !== 'damage' || e.targetId !== t.id) continue;
      if (e.sourceId !== p.id && e.sourceOwnerId !== p.id) continue;
      total += e.amount ?? 0;
    }
  }
  return total;
}

// ============================================================================
// LANE 1: rogue. AP = str + agi, and it DUAL WIELDS, so every weapon term
// lands twice: a one-hand weapon declares slot 'mainhand' and is legal in the
// offhand, and the enchant slot gate compares itemDef.slot.
// ============================================================================
const ROGUE_BIS: PlayerEquipment = {
  mainhand: 'mistcallers_fang',
  offhand: 'heroic_duskwhisper',
  helmet: 'heroic_nighttalon_crown',
  neck: 'medallion_of_endless_profit',
  shoulder: 'heroic_nighttalon_shoulderguards',
  chest: 'basin_stalkers_tunic',
  waist: 'bonechill_cord',
  legs: 'heroic_wyrmshadow_legguards',
  gloves: 'heroic_wyrmshadow_talongrips',
  feet: 'heroic_wyrmshadow_treads',
  ring1: 'abysswrought_band',
  ring2: 'architects_cornerstone',
};
// Pre-packet best enchant per slot for an AP-maximising rogue. The offhand
// holds a 'mainhand'-kind weapon, so it takes a MAINHAND enchant (str 5 beats
// agi 2 on AP), never enchant_offhand_stamina.
const ROGUE_ENCH: SlotStats = {
  mainhand: { str: 5 },
  offhand: { str: 5 },
  chest: { sta: 7 },
  feet: { agi: 2 },
  gloves: { agi: 6 },
  helmet: { sta: 6 },
  legs: { agi: 4 },
  neck: { agi: 2 },
  ring1: { agi: 2 },
  ring2: { agi: 2 },
  shoulder: { agi: 2 },
  waist: { agi: 3 },
};
const ROGUE_GEAR: SlotStats = { chest: { agi: 2 } };
const ROGUE_ENCH_D: SlotStats = {
  mainhand: { str: WEAPON_STR_STEP },
  offhand: { str: WEAPON_STR_STEP },
  feet: { agi: FEET_AGI_STEP },
  chest: { sta: CHEST_STA_STEP_PERFECTED },
};
// IMPORTED, never re-typed: section 9.1 fixes the rogue build as the La Luna
// build from scripts/rogue_dps_probe.ts, so this must BE that object (the
// same reasoning as the CASTER_BIS import below). The fury rotation below is
// the one deliberate re-type: scripts/fury_dps_probe.ts executes at import
// (a top-level script with no main guard), so importing its ROTATION would
// run the whole probe.
const ROGUE_ROWS = LA_LUNA_ROGUE_ROWS;

const merge = (...ds: SlotStats[]): SlotStats => {
  const out: SlotStats = {};
  for (const d of ds) {
    for (const [slot, st] of Object.entries(d)) {
      const acc: Record<string, number> = { ...(out[slot] ?? {}) } as Record<string, number>;
      for (const [k, v] of Object.entries(st)) acc[k] = (acc[k] ?? 0) + (v as number);
      out[slot] = acc;
    }
  }
  return out;
};

export type Arm = 'base' | 'gear' | 'ench' | 'full' | 'apexChest' | 'equipped';

// Each lane accepts only the arms it defines. Without this, a wrong
// (lane, arm) pair fell into the catch-all else branch and silently measured
// gear+ench under the wrong label; a bad pair now throws instead.
const laneArms = (lane: string, supported: readonly Arm[], arm: Arm): void => {
  if (!supported.includes(arm)) {
    throw new Error(`arm ${arm} unsupported in the ${lane} lane`);
  }
};

export function rogueLane(
  seed: number,
  spec: string,
  arm: Arm,
  level: number,
  armor: number,
): number {
  laneArms('rogue', ['base', 'gear', 'ench', 'full'], arm);
  const sim = new Sim({
    seed,
    playerClass: 'rogue',
    autoEquip: false,
    world: PROBE_WORLD,
  }) as AnySim;
  const s = sim as unknown as {
    setPlayerLevel(n: number): void;
    applyTalents(a: unknown): boolean;
    castAbility(id: string): unknown;
    startAutoAttack(): void;
    player: Entity;
  };
  s.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  if (!s.applyTalents({ spec, rows: ROGUE_ROWS })) throw new Error('rogue talents failed');
  const delta = arm === 'base' ? {} : arm === 'gear' ? ROGUE_GEAR : merge(ROGUE_GEAR, ROGUE_ENCH_D);
  const auras =
    arm === 'full'
      ? [SERPENT, flaskAura('buff_ap', 'Warboar Might'), plateAura('buff_ap')]
      : [SERPENT];
  dress(sim, ROGUE_BIS, ROGUE_ENCH, delta, auras);
  const p = s.player;
  s.castAbility('deadly_poison');
  for (let i = 0; i < 40; i++) sim.tick();
  const t = inertTarget(sim, level, armor);
  s.startAutoAttack();
  return (
    fight(sim, t, SECONDS, () => {
      const sndUp = p.auras.some((a) => a.kind === 'buff_haste' && a.id === 'slice_and_dice');
      if (!p.cooldowns.has('adrenaline_rush')) s.castAbility('adrenaline_rush');
      if (!p.cooldowns.has('flurry_of_knives')) s.castAbility('flurry_of_knives');
      if (spec === 'combat' && !p.cooldowns.has('blade_flurry')) s.castAbility('blade_flurry');
      const redline = p.auras.find((a) => a.id === 'redline');
      if (spec === 'combat' && redline) {
        const pips = redline.stacks ?? 1;
        const closing = redline.remaining < 1.6;
        if (p.comboPoints >= 5 && (pips >= 4 || closing)) s.castAbility('eviscerate');
        else if (p.comboPoints >= 4 && closing) s.castAbility('eviscerate');
        else s.castAbility('sinister_strike');
      } else if (!sndUp && p.comboPoints >= 2) s.castAbility('slice_and_dice');
      else if (p.comboPoints >= 5) {
        if (spec !== 'combat' || p.resource >= 70) s.castAbility('eviscerate');
      } else s.castAbility('sinister_strike');
    }) / SECONDS
  );
}

// ============================================================================
// LANE 2: warrior, fury. AP = str * 2, and Titan's Grip dual-wields two
// two-handers, so the weapon enchant lands twice here too. This is the binding
// lane: highest physical throughput, the doubled weapon term, and rage income
// that rises with attack power, so its delta is superlinear.
// ============================================================================
const WAR_BIS: PlayerEquipment = {
  mainhand: 'deathless_greatblade',
  offhand: 'bonewrought_greatsword',
  helmet: 'heroic_crownforged_dreadhelm',
  neck: 'medallion_of_endless_profit',
  shoulder: 'heroic_crownforged_warspaulders',
  chest: 'emberforged_bulwark',
  waist: 'gravescale_girdle',
  legs: 'bloodmane_war_legguards',
  gloves: 'gravewyrm_claws',
  feet: 'tideworn_warboots',
  ring1: 'abysswrought_band',
  ring2: 'architects_cornerstone',
};
const WAR_ENCH: SlotStats = {
  mainhand: { str: 5 },
  offhand: { str: 5 },
  chest: { sta: 7 },
  feet: { str: 2 },
  gloves: { str: 3 },
  helmet: { sta: 6 },
  legs: { sta: 6 },
  neck: { agi: 2 },
  ring1: { str: 2 },
  ring2: { str: 2 },
  shoulder: { str: 2 },
  waist: { str: 3 },
};
// The gear term is the upper bound a strength archetype can reach with two
// Perfected pieces (+1 lead stat each), applied to the highest-throughput
// strength spec. A fury warrior's own best realisable pair is smaller: the
// only mail or plate apex armour piece it can use is forgefold_legguards, and
// the apex two-hander is a weapon-dps loss against deathless_greatblade.
// The chest step is +3 rather than +6 because no mail or plate apex CHEST
// ships, so enchant_lucent_infusion (requiresPerfected) is unreachable here.
const WAR_GEAR: SlotStats = { legs: { str: 2 } };
// THE EQUIPPED ARM, and it exists because the modelled term above is NOT the
// upper bound section 8.1 claims on this lane. WAR_BIS carries 355 hit rating
// against a need of 190 at the heroic target and 260 at S-rift, so its
// effective SPECIAL-attack miss is already zero (white swings additionally
// carry the flat dual-wield 10 percent penalty, which no hit reduces) and 95
// to 165 rating is DEAD. forgefold_legguards is a stat-and-armour identical
// twin of the baseline legs except that its 40 HIT is 40 CRIT, so equipping
// it converts dead rating into live rating, a gain "+2 lead stat" scores as
// nothing. warhewn_signet is the second Perfected piece this arm equips (the
// lane's best realisable pair). Both are swapped as ITEMS with their real
// Perfecting bonuses, which is what a player would actually hold.
export const WAR_EQUIPPED_ITEMS: Record<string, string> = {
  legs: 'forgefold_legguards',
  ring2: 'warhewn_signet',
};
const WAR_EQUIPPED_DELTA: SlotStats = {
  legs: { str: 1 },
  ring2: { str: 1 },
  mainhand: { str: WEAPON_STR_STEP },
  offhand: { str: WEAPON_STR_STEP },
  chest: { sta: CHEST_STA_STEP_PLATE },
};
const WAR_ENCH_D: SlotStats = {
  mainhand: { str: WEAPON_STR_STEP },
  offhand: { str: WEAPON_STR_STEP },
  chest: { sta: CHEST_STA_STEP_PLATE },
};

interface FurySim {
  sim: AnySim;
  s: {
    setPlayerLevel(n: number): void;
    setSpec(id: string): boolean;
    selectTalentRow(level: number, row: string): boolean;
    castAbility(id: string): unknown;
    player: Entity;
  };
  p: Entity;
}

function furyDress(seed: number, arm: Arm): FurySim {
  laneArms('fury', ['base', 'gear', 'ench', 'full', 'equipped'], arm);
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: false,
    world: PROBE_WORLD,
  }) as AnySim;
  const s = sim as unknown as FurySim['s'];
  s.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  if (!s.setSpec('fury')) throw new Error('setSpec fury failed');
  sim.tick();
  for (const [lvl, row] of [
    [14, 'war_row_anger_management'],
    [17, 'war_row_recklessness'],
    [20, 'war_row_colossal_might'],
  ] as Array<[number, string]>) {
    if (!s.selectTalentRow(lvl, row)) throw new Error(`row pick failed: ${row}`);
  }
  const delta =
    arm === 'base'
      ? {}
      : arm === 'gear'
        ? WAR_GEAR
        : arm === 'equipped'
          ? WAR_EQUIPPED_DELTA
          : merge(WAR_GEAR, WAR_ENCH_D);
  const auras =
    arm === 'full' || arm === 'equipped'
      ? [SERPENT, flaskAura('buff_ap', 'Warboar Might'), plateAura('buff_ap')]
      : [SERPENT];
  const equipment: PlayerEquipment = { ...WAR_BIS };
  if (arm === 'equipped') {
    for (const [slot, id] of Object.entries(WAR_EQUIPPED_ITEMS)) {
      (equipment as Record<string, string>)[slot] = id;
    }
  }
  dress(sim, equipment, WAR_ENCH, delta, auras);
  return { sim, s, p: s.player };
}

// Dress-only readout of the fury lane's derived stats, deterministic (no
// fight, no seeds), so the suite can pin the escalation's MECHANISM: the base
// arm's 355 hit rating, the equipped arm's dead-hit-to-live-crit conversion,
// and that effective special miss is zero on both arms at both targets.
export interface FuryBody {
  str: number;
  sta: number;
  hitRating: number;
  hitBonus: number;
  critRating: number;
  hasteRating: number;
}

export function furyBody(arm: Arm): FuryBody {
  const { p } = furyDress(4242, arm);
  return {
    str: p.stats.str,
    sta: p.stats.sta,
    hitRating: p.hitRating,
    hitBonus: p.hitBonus,
    critRating: p.critRating,
    hasteRating: p.hasteRating,
  };
}

export function furyLane(seed: number, arm: Arm, level: number, armor: number): number {
  const { sim, s, p } = furyDress(seed, arm);
  const t = inertTarget(sim, level, armor);
  p.autoAttack = true;
  s.castAbility('battle_shout');
  const rotation = ['recklessness', 'red_harvest', 'bloodthirst', 'raging_gale', 'whirlwind'];
  return (
    fight(sim, t, SECONDS, () => {
      for (const id of rotation) {
        if (id === 'red_harvest' && p.resource < 80) continue;
        s.castAbility(id);
      }
    }) / SECONDS
  );
}

// ============================================================================
// LANE 3: caster. A MAGE (spell power is int * 0.5, and frostbolt is its
// band-matched nuke) wearing the maintained set-complete caster best-in-slot
// kit, which the repo happens to name WARLOCK_FULL_BIS_GEAR: nine pieces list
// mage in requiredClass and the neck and both rings are unrestricted, and
// using a set-complete kit matters because a set-incomplete caster benches
// 21 to 33 percent under this one. NOTE: this maintained set carries the
// LEGENDARY mainhand heroic_deathless_heartwood, the one departure from the
// epic-only baseline rule (a stronger denominator, so the caster rows read
// LOWER, the safe direction; recorded in section 3).
// Both arms drink sunpetal_mana_draught on cooldown. The framework forbids
// restoring a resource each tick, and this is not that: it is a real
// consumable both arms carry.
// ============================================================================
// IMPORTED, never re-typed. Section 3 fixes the caster baseline as the repo's
// maintained set-complete caster BiS, so this must BE that list: a hand-copy
// would leave the probe measuring a stale denominator, with nothing red, the
// next time the maintained set is re-anchored (which the warlock viability
// record shows has happened before).
const CASTER_BIS: PlayerEquipment = { ...WARLOCK_FULL_BIS_GEAR } as PlayerEquipment;
const CASTER_ENCH: SlotStats = {
  mainhand: { int: 5 },
  chest: { sta: 7 },
  feet: { sta: 2 },
  gloves: { int: 3 },
  helmet: { int: 4 },
  legs: { int: 4 },
  neck: { int: 2 },
  offhand: { sta: 3 },
  ring1: { int: 2 },
  ring2: { int: 2 },
  shoulder: { int: 2 },
  waist: { sta: 3 },
};
const CASTER_GEAR: SlotStats = { chest: { int: 1 }, gloves: { int: 1 } };
const CASTER_ENCH_D: SlotStats = {
  mainhand: { int: WEAPON_INT_STEP },
  chest: { sta: CHEST_STA_STEP_PERFECTED },
};

// THE MAXIMAL CASTER KIT, measured as its own arm rather than modelled. The
// 'full' arm above takes the caster's two Perfected pieces as a stat delta,
// which is the conservative reading: it assumes the caster keeps its set
// bonuses. A caster could instead spend one Perfected slot on the apex cloth
// CHEST, which breaks the Mournweave 3-piece but brings a 40-rating line and
// unlocks the Perfected-only Lucent Infusion on that slot. Whether that is a
// gain is not a thing to reason about; it is measured here.
const CASTER_APEX_CHEST_ITEMS: Record<string, string> = { chest: 'sunspun_vestments' };
const CASTER_APEX_CHEST_DELTA: SlotStats = {
  chest: { int: 1, spi: 1, sta: CHEST_STA_STEP_PERFECTED },
  gloves: { int: 1 },
  mainhand: { int: WEAPON_INT_STEP },
};

export function casterLane(
  seed: number,
  arm: Arm,
  level: number,
  armor: number,
  seconds: number,
): number {
  laneArms('caster', ['base', 'gear', 'ench', 'full', 'apexChest'], arm);
  const sim = new Sim({
    seed,
    playerClass: 'mage',
    autoEquip: false,
    world: PROBE_WORLD,
  }) as AnySim;
  const s = sim as unknown as {
    setPlayerLevel(n: number): void;
    addItem(id: string, n: number): unknown;
    useItem(id: string): unknown;
    castAbility(id: string): unknown;
    player: Entity;
  };
  s.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  const delta =
    arm === 'base'
      ? {}
      : arm === 'gear'
        ? CASTER_GEAR
        : arm === 'apexChest'
          ? CASTER_APEX_CHEST_DELTA
          : merge(CASTER_GEAR, CASTER_ENCH_D);
  const auras =
    arm === 'full' || arm === 'apexChest'
      ? [SERPENT, flaskAura('buff_int', 'Runewater Clarity'), plateAura('buff_int')]
      : [SERPENT];
  const equipment: PlayerEquipment = { ...CASTER_BIS };
  if (arm === 'apexChest') {
    for (const [slot, id] of Object.entries(CASTER_APEX_CHEST_ITEMS)) {
      (equipment as Record<string, string>)[slot] = id;
    }
  }
  dress(sim, equipment, CASTER_ENCH, delta, auras);
  const p = s.player;
  s.addItem('sunpetal_mana_draught', 5);
  const t = inertTarget(sim, level, armor);
  return (
    fight(sim, t, seconds, () => {
      if (p.resource < p.maxResource * 0.45) s.useItem('sunpetal_mana_draught');
      if (!p.castingAbility && p.gcdRemaining <= 0.001) s.castAbility('frostbolt');
    }) / seconds
  );
}

// ============================================================================
// LANE 4: the tank effective-health arm. No fight: effective health is the
// measured value, maxHp / (1 - armorReduction(armor, attackerLevel)).
//
// This lane is the ONE that swaps ITEMS rather than adding a stat delta,
// because its gear term is armour and stamina rather than a lead primary. Its
// baseline is the max-effective-health pre-packet pick per slot; its kit swaps
// in the only two apex pieces a protection warrior can wear (the shield and
// the mail legs) and takes the Perfected bonus each carries. Its chest enchant
// step is +3, not +6: no mail or plate apex chest ships, so the Perfected-only
// Lucent Infusion is unreachable for a plate wearer. Its flask REPLACES the
// serpent elixir rather than riding beside it (same aura id, and the flask
// refuses the elixir downward), which is why the tank's consumable term nets
// to +7 stamina where the throughput lanes' are wholly new.
// ============================================================================
const TANK_BIS: PlayerEquipment = {
  mainhand: 'heroic_kingsbane_last_oath',
  offhand: 'heroic_bonewrought_bulwark',
  helmet: 'heroic_crownforged_dreadhelm',
  neck: 'heart_of_the_rift',
  shoulder: 'heroic_crownforged_warspaulders',
  chest: 'furyforged_warplate',
  waist: 'furyforged_girdle',
  legs: 'furyforged_legguards',
  gloves: 'furyforged_gauntlets',
  feet: 'deathlord_sabatons',
  ring1: 'abysswrought_band',
  ring2: 'abysswrought_band',
};
const TANK_ENCH: SlotStats = {
  mainhand: { str: 5 },
  chest: { sta: 7 },
  feet: { sta: 2 },
  gloves: { str: 3 },
  helmet: { sta: 6 },
  legs: { sta: 6 },
  neck: { spi: 3 },
  offhand: { sta: 3 },
  ring1: { str: 2 },
  ring2: { str: 2 },
  shoulder: { str: 2 },
  waist: { sta: 3 },
};
export const TANK_KIT_ITEMS: Record<string, string> = {
  offhand: 'duskforged_bulwark',
  legs: 'forgefold_legguards',
};
export const TANK_KIT_DELTA: SlotStats = {
  offhand: { str: 1, sta: 1 },
  legs: { str: 1 },
  chest: { sta: CHEST_STA_STEP_PLATE },
};

export interface TankBody {
  hp: number;
  armor: number;
  sta: number;
}

export function tankBody(arm: 'base' | 'consumables' | 'consumablesEnchant' | 'full'): TankBody {
  const sim = new Sim({
    seed: 4242,
    playerClass: 'warrior',
    autoEquip: false,
    world: PROBE_WORLD,
  }) as AnySim;
  const s = sim as unknown as {
    setPlayerLevel(n: number): void;
    setSpec(id: string): boolean;
    player: Entity;
  };
  s.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  if (!s.setSpec('prot')) throw new Error('setSpec prot failed');
  sim.tick();
  const equipment: PlayerEquipment = { ...TANK_BIS };
  if (arm === 'full') {
    for (const [slot, id] of Object.entries(TANK_KIT_ITEMS)) {
      (equipment as Record<string, string>)[slot] = id;
    }
  }
  const delta: SlotStats =
    arm === 'full'
      ? TANK_KIT_DELTA
      : arm === 'consumablesEnchant'
        ? { chest: { sta: CHEST_STA_STEP_PLATE } }
        : {};
  const auras =
    arm === 'base' ? [SERPENT] : [flaskAura('buff_sta', 'Ironhusk Vigor'), plateAura('buff_sta')];
  dress(sim, equipment, TANK_ENCH, delta, auras);
  const p = s.player;
  return { hp: p.maxHp, armor: p.stats.armor, sta: p.stats.sta };
}

// --- report -----------------------------------------------------------------
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const se = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(
    xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1) / xs.length,
  );
};
// PAIRED, not unpaired. Every arm runs the SAME seed list as the baseline, so
// the seed-driven variation is common to both and cancels inside each pair. The
// first version of this reporter combined each arm's independent standard error
// (sqrt(se_kit^2 + se_base^2)), which throws that pairing away: it inflated the
// interval by roughly a factor of five on the fury lane and left the binding
// number reading as noise. The statistic is the mean of the per-seed relative
// deltas and its own standard error; `spread` prints the extreme per-seed
// deltas so a reader can see the distribution rather than trust one interval.
const pct = (b: number, k: number) => ((k - b) / b) * 100;

function row(name: string, base: number[], arms: Record<string, number[]>): void {
  const b = mean(base);
  const parts = Object.entries(arms).map(([k, xs]) => {
    const d = xs.map((v, i) => ((v - base[i]) / base[i]) * 100);
    const lo = Math.min(...d);
    const hi = Math.max(...d);
    return `${k} ${mean(d).toFixed(2)}% (+/-${(2 * se(d)).toFixed(2)}, per-seed ${lo.toFixed(1)} to ${hi.toFixed(1)})`;
  });
  console.log(`${name}: base ${b.toFixed(2)} | ${parts.join(' | ')}`);
}

export function main(): void {
  const only = process.argv[2];
  if (SECONDS > 900) {
    // The always-on consumable premise breaks past the plate's 900 s duration
    // (the flask holds to 1200): auras are applied once at dress time and
    // never refreshed, so a longer fight quietly measures a kit that fell
    // off mid-run. Re-apply the auras inside act() before raising this.
    throw new Error('WOC_R5_SECONDS above 900 breaks the always-on consumable premise');
  }
  console.log(
    `TARGETS ${HEROIC_TARGET.name} armor=${HEROIC_TARGET.armor} DR=${(armorReduction(HEROIC_TARGET.armor, 20) * 100).toFixed(2)}% | ` +
      `${SRIFT_TARGET.name} armor=${SRIFT_TARGET.armor} DR=${(armorReduction(SRIFT_TARGET.armor, 20) * 100).toFixed(2)}%`,
  );
  console.log(`${SEEDS.length} seeds, ${SECONDS} s sustained\n`);

  for (const target of [HEROIC_TARGET, SRIFT_TARGET]) {
    const { name, level, armor } = target;
    if (!only || only === 'rogue') {
      for (const spec of ['combat', 'assassination', 'subtlety']) {
        const base = SEEDS.map((s) => rogueLane(s, spec, 'base', level, armor));
        const all: Record<string, number[]> = {
          gear: WANT('gear') ? SEEDS.map((s) => rogueLane(s, spec, 'gear', level, armor)) : [],
          'gear+ench': WANT('gear+ench')
            ? SEEDS.map((s) => rogueLane(s, spec, 'ench', level, armor))
            : [],
          FULL: WANT('FULL') ? SEEDS.map((s) => rogueLane(s, spec, 'full', level, armor)) : [],
        };
        row(
          `${name} rogue-${spec}`,
          base,
          Object.fromEntries(Object.entries(all).filter(([, xs]) => xs.length > 0)),
        );
      }
    }
    if (!only || only === 'fury') {
      const base = SEEDS.map((s) => furyLane(s, 'base', level, armor));
      const all: Record<string, number[]> = {
        gear: WANT('gear') ? SEEDS.map((s) => furyLane(s, 'gear', level, armor)) : [],
        'gear+ench': WANT('gear+ench') ? SEEDS.map((s) => furyLane(s, 'ench', level, armor)) : [],
        FULL: WANT('FULL') ? SEEDS.map((s) => furyLane(s, 'full', level, armor)) : [],
        'FULL+equipped': WANT('FULL+equipped')
          ? SEEDS.map((s) => furyLane(s, 'equipped', level, armor))
          : [],
      };
      row(
        `${name} warrior-fury`,
        base,
        Object.fromEntries(Object.entries(all).filter(([, xs]) => xs.length > 0)),
      );
    }
    if (!only || only === 'caster') {
      for (const secs of [60, SECONDS]) {
        const base = SEEDS.map((s) => casterLane(s, 'base', level, armor, secs));
        const all: Record<string, number[]> = {
          gear: WANT('gear') ? SEEDS.map((s) => casterLane(s, 'gear', level, armor, secs)) : [],
          'gear+ench': WANT('gear+ench')
            ? SEEDS.map((s) => casterLane(s, 'ench', level, armor, secs))
            : [],
          FULL: WANT('FULL') ? SEEDS.map((s) => casterLane(s, 'full', level, armor, secs)) : [],
          'FULL+apexChest': WANT('FULL+apexChest')
            ? SEEDS.map((s) => casterLane(s, 'apexChest', level, armor, secs))
            : [],
        };
        row(
          `${name} caster-${secs}s`,
          base,
          Object.fromEntries(Object.entries(all).filter(([, xs]) => xs.length > 0)),
        );
      }
    }
  }

  if (!only || only === 'tank') {
    const b = tankBody('base');
    const arms: Array<[string, TankBody]> = [
      ['consumables only', tankBody('consumables')],
      ['consumables+enchant', tankBody('consumablesEnchant')],
      ['kit (full)', tankBody('full')],
    ];
    for (const lvl of [22, 23]) {
      const ehp = (x: TankBody) => x.hp / (1 - armorReduction(x.armor, lvl));
      console.log(
        `\ntank vs L${lvl} baseline hp=${b.hp} armor=${b.armor} sta=${b.sta} EHP=${ehp(b).toFixed(0)}`,
      );
      for (const [name, x] of arms) {
        console.log(
          `  ${name.padEnd(22)} hp=${x.hp} armor=${x.armor} sta=${x.sta} EHP=${ehp(x).toFixed(0)} dEHP=${pct(ehp(b), ehp(x)).toFixed(3)}%`,
        );
      }
    }
  }
}

if (process.argv[1]?.endsWith('r5_envelope_probe.ts')) main();
