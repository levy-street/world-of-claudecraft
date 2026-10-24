// Leveling time-to-kill bench: how long a solo player takes to kill a same-level
// open-world mob, and how much of their health it costs, at every level 1 to 20.
//
// Every other balance tool measures a level-20 character against a target that
// cannot die (a dummy, a 5000-HP wolf, the Nythraxis shell). This one fights the
// REAL camp templates in the real Sim: the mob runs in, swings back, flees, and
// dies. One leveling damage spec per class, three gear tiers:
//
//  - starter:   the class starting kit only (the floor a fresh character has).
//  - available: the best real gear a solo leveler can own at that level today:
//               quest rewards and open-world drops whose source level is at or
//               below it, plus the World Market's standing stock.
//  - greens:    an uncommon item in every slot at the level's item level, built
//               on the shared stat budget (item_budget.ts). The gear a player
//               would wear if every slot got a level-appropriate quest green.
//
// The bench answers "what does a kill cost at level L". Mobs spawn the way the
// open world spawns them, through the shipped open-world curve
// (src/sim/mob/open_world_tuning.ts); pass `mobTransform`/`mobStamp` to measure
// a candidate curve, or the untuned templates, in its place.
//
// npx tsx scripts/leveling_ttk_report.ts writes the full matrix report.

import { CAMPS, DUNGEONS, ITEMS, MOBS, QUESTS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { canEquipItemInSlot, weaponHand } from '../src/sim/equipment_rules';
import {
  normalizeToStaminaModel,
  primaryStatBudget,
  QUALITY_ILVL_BONUS,
  scaleWeaponDamage,
  TWOHAND_DPS_MULT,
  TWOHAND_STAT_MULT,
  weaponDpsBudget,
} from '../src/sim/item_budget';
import { itemLevel, itemSourceLevel } from '../src/sim/item_level';
import { meetsLevelRequirement } from '../src/sim/item_level_req';
import { MARKET_HOUSE_STOCK } from '../src/sim/market';
import { applyOpenWorldMobTuning, openWorldMobTemplate } from '../src/sim/mob/open_world_tuning';
import { Sim } from '../src/sim/sim';
import type {
  CoreStats,
  Entity,
  EquipSlot,
  ItemDef,
  MobTemplate,
  PlayerClass,
  SimEvent,
} from '../src/sim/types';
import { anchorProbeInOpenField } from './probe_anchor';

type BenchSim = Sim & { nextId: number };

export type LevelingGearTier = 'starter' | 'available' | 'greens';
export const LEVELING_GEAR_TIERS: readonly LevelingGearTier[] = ['starter', 'available', 'greens'];

export const LEVELING_CLASSES: readonly PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

type StatWeights = Partial<Record<keyof CoreStats | 'dps' | 'sp' | 'rating', number>>;

interface LevelingSpec {
  // Talent spec chosen at SPEC_UNLOCK_LEVEL (5). Below it the class fights unspecced.
  spec: string;
  // Choice-row picks by row level; rows above the bench level are dropped. Taken
  // from the class's existing balance probe where one exists; empty otherwise.
  rows: Partial<Record<number, string>>;
  // Stat weights the gear picker scores items with (bench assumption, see the
  // report header): the spec's offense stat first, stamina and armor after.
  weights: StatWeights;
  // The primary-stat identity a level green carries for this spec.
  greenStats: Partial<CoreStats>;
  // A two-handed weapon in the greens tier (else main hand + off hand).
  twoHand: boolean;
}

// One damage spec per class, the usual leveling pick. Row picks come from the
// shipped probes (fury_dps_probe, rogue_dps_probe, owned_class_balance_probe).
export const LEVELING_SPECS: Record<PlayerClass, LevelingSpec> = {
  warrior: {
    spec: 'arms',
    rows: {
      14: 'war_row_anger_management',
      17: 'war_row_recklessness',
      20: 'war_row_colossal_might',
    },
    weights: { str: 2, agi: 1, sta: 0.5, armor: 0.02, dps: 8, rating: 1 },
    greenStats: { str: 2, sta: 1 },
    twoHand: true,
  },
  paladin: {
    spec: 'retribution',
    rows: {},
    weights: { str: 2, agi: 0.5, int: 0.5, sta: 0.5, armor: 0.02, dps: 8, rating: 1 },
    greenStats: { str: 2, sta: 1 },
    twoHand: true,
  },
  hunter: {
    spec: 'beast_mastery',
    rows: {},
    weights: { agi: 2, str: 0.5, sta: 0.5, int: 0.2, armor: 0.01, dps: 6, rating: 1 },
    greenStats: { agi: 2, sta: 1 },
    twoHand: true,
  },
  rogue: {
    spec: 'combat',
    rows: {
      5: 'rog_r5_killers_pace',
      8: 'rog_r8_borrowed_breath',
      11: 'rog_r11_marked_prey',
      14: 'rog_r14_ceaseless_cuts',
      17: 'rog_r17_flurry_of_knives',
      20: 'rog_r20_second_shadow',
    },
    weights: { agi: 2, str: 1, sta: 0.5, armor: 0.01, dps: 8, rating: 1 },
    greenStats: { agi: 2, sta: 1 },
    twoHand: false,
  },
  priest: {
    spec: 'shadow',
    rows: {
      5: 'pri_r5_twisted_faith',
      8: 'pri_r17_inner_fire',
      11: 'pri_r8_psychic_scream',
      14: 'pri_r14_pain_and_suffering',
      17: 'pri_r17_anointing',
      20: 'pri_r20_incarnate_spirit',
    },
    weights: { int: 2, spi: 1, sta: 0.5, sp: 1.5, armor: 0.005, rating: 1 },
    greenStats: { int: 2, spi: 1 },
    twoHand: true,
  },
  shaman: {
    spec: 'enhancement',
    rows: {
      5: 'sha_r5_concussion',
      8: 'sha_r8_shock_efficiency',
      11: 'sha_r11_ancestral_guidance',
      14: 'sha_r14_improved_flame_shock',
      17: 'sha_r17_earthbind',
      20: 'sha_r20_tidal_waves',
    },
    weights: { str: 1.5, agi: 1, int: 0.5, sta: 0.5, armor: 0.015, dps: 8, rating: 1 },
    greenStats: { str: 2, sta: 1 },
    twoHand: true,
  },
  mage: {
    spec: 'frost',
    rows: {},
    weights: { int: 2, spi: 1, sta: 0.5, sp: 1.5, armor: 0.005, rating: 1 },
    greenStats: { int: 2, spi: 1 },
    twoHand: true,
  },
  warlock: {
    spec: 'destruction',
    rows: {
      14: 'wlk_r14_shadow_mastery',
      17: 'wlk_r17_improved_fear',
      20: 'wlk_r20_chaos_bolt',
    },
    weights: { int: 2, spi: 0.8, sta: 0.7, sp: 1.5, armor: 0.005, rating: 1 },
    greenStats: { int: 2, spi: 1 },
    twoHand: true,
  },
  druid: {
    spec: 'feral',
    rows: { 14: 'dru_r14_savage_fury', 20: 'dru_r20_improved_hurricane' },
    weights: { agi: 2, str: 1.5, sta: 0.5, armor: 0.01, dps: 4, rating: 1 },
    greenStats: { agi: 2, sta: 1 },
    twoHand: true,
  },
};

const SPEC_UNLOCK_LEVEL = 5;
const MELEE_START_YARDS = 3;
const RANGED_START_YARDS = 25;
const CHARGE_START_YARDS = 12;
const FIGHT_TIMEOUT_SECONDS = 120;
// Seconds between pulls (loot, walk to the next mob). Cooldowns tick through it
// and are never reset, so a 2-minute burst cooldown lands on roughly one pull in
// four, as it does for a real leveler, instead of on every pull.
const PULL_GAP_SECONDS = 20;
// Mobs measured per level: a deterministic, evenly spread sample of the
// templates that cover that level, so a crowded level-20 band does not dominate.
const MAX_TEMPLATES_PER_LEVEL = 8;

export type MobTransform = (template: MobTemplate, level: number) => MobTemplate;
export type MobStamp = (mob: Entity) => void;

// ---------------------------------------------------------------------------
// Mob roster
// ---------------------------------------------------------------------------

function dungeonMobIds(): Set<string> {
  const ids = new Set<string>();
  for (const def of Object.values(DUNGEONS)) for (const spawn of def.spawns) ids.add(spawn.mobId);
  return ids;
}

function isOrdinaryOpenWorldMob(t: MobTemplate): boolean {
  if (t.elite || t.boss || t.rare || t.worldBoss || t.dummy || t.ambient) return false;
  if (t.friendlyPracticeTarget || t.xpMult === 0 || t.requiresQuestId) return false;
  // Puzzle objects and eggs: a fight that is one swing long measures nothing.
  return t.hpBase > 5 && t.dmgBase > 0;
}

/** Normal open-world camp templates covering `level`, sampled evenly by id. */
export function campTemplatesAt(level: number): MobTemplate[] {
  const seen = new Set<string>();
  const out: MobTemplate[] = [];
  for (const camp of CAMPS) {
    const t = MOBS[camp.mobId];
    if (!t || seen.has(t.id) || !isOrdinaryOpenWorldMob(t)) continue;
    if (level < t.minLevel || level > t.maxLevel) continue;
    seen.add(t.id);
    out.push(t);
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  if (out.length <= MAX_TEMPLATES_PER_LEVEL) return out;
  const step = out.length / MAX_TEMPLATES_PER_LEVEL;
  return Array.from({ length: MAX_TEMPLATES_PER_LEVEL }, (_, i) => out[Math.floor(i * step)]);
}

function tameableBeastAt(level: number): MobTemplate {
  let best: MobTemplate | undefined;
  for (const camp of CAMPS) {
    const t = MOBS[camp.mobId];
    if (!t || t.family !== 'beast' || !isOrdinaryOpenWorldMob(t) || t.untameable) continue;
    if (t.minLevel > level) continue;
    if (!best || t.minLevel > best.minLevel) best = t;
  }
  if (!best) throw new Error(`no tameable beast at or below level ${level}`);
  return best;
}

// ---------------------------------------------------------------------------
// Gear tiers
// ---------------------------------------------------------------------------

const ARMOR_SLOTS: readonly EquipSlot[] = [
  'helmet',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
];
const JEWELRY_SLOTS: readonly EquipSlot[] = ['neck', 'ring1', 'ring2'];

function score(item: ItemDef, w: StatWeights): number {
  const s = item.stats ?? {};
  let total = 0;
  for (const key of ['str', 'agi', 'sta', 'int', 'spi', 'armor'] as const) {
    total += (s[key] ?? 0) * (w[key] ?? 0);
  }
  total += (item.spellPower ?? 0) * (w.sp ?? 0);
  const ratings = (item.critRating ?? 0) + (item.hasteRating ?? 0) + (item.hitRating ?? 0);
  total += ratings * (w.rating ?? 0);
  if (item.kind === 'weapon' && item.weapon) {
    const dps = (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed;
    total += dps * (w.dps ?? 0);
  }
  return total;
}

let openWorldSources: Set<string> | null = null;

// Item ids a solo leveler can own: quest rewards, open-world mob drops, and the
// World Market's standing stock. Dungeon drops are left out on purpose: the
// question is what solo questing provides.
function soloGearSources(): Set<string> {
  if (openWorldSources) return openWorldSources;
  const ids = new Set<string>();
  const inDungeons = dungeonMobIds();
  for (const quest of Object.values(QUESTS)) {
    for (const id of Object.values(quest.itemRewards)) if (id) ids.add(id);
  }
  for (const mob of Object.values(MOBS)) {
    if (inDungeons.has(mob.id) || mob.boss || mob.worldBoss) continue;
    for (const entry of mob.loot ?? []) if (entry.itemId) ids.add(entry.itemId);
  }
  for (const row of MARKET_HOUSE_STOCK) ids.add(row.itemId);
  openWorldSources = ids;
  return ids;
}

function isGear(item: ItemDef | undefined): item is ItemDef {
  return (
    !!item &&
    !!item.slot &&
    (item.kind === 'armor' || item.kind === 'weapon' || item.kind === 'held_offhand')
  );
}

function bestFor(
  cls: PlayerClass,
  spec: string | null,
  level: number,
  slot: EquipSlot,
  pool: readonly ItemDef[],
  weights: StatWeights,
  exclude: ReadonlySet<string> = new Set(),
): ItemDef | undefined {
  let best: ItemDef | undefined;
  let bestScore = 0;
  for (const item of pool) {
    if (exclude.has(item.id) || !canEquipItemInSlot(cls, item, slot, spec)) continue;
    if (!meetsLevelRequirement(level, item)) continue;
    const s = score(item, weights);
    if (s > bestScore) {
      best = item;
      bestScore = s;
    }
  }
  return best;
}

/** Best real solo-obtainable gear at `level`, over the starting kit. */
export function availableLoadout(
  cls: PlayerClass,
  level: number,
  starter: Partial<Record<EquipSlot, string>>,
): Partial<Record<EquipSlot, string>> {
  const spec = level >= SPEC_UNLOCK_LEVEL ? LEVELING_SPECS[cls].spec : null;
  const weights = LEVELING_SPECS[cls].weights;
  const pool: ItemDef[] = [];
  for (const id of soloGearSources()) {
    const item = ITEMS[id];
    if (!isGear(item)) continue;
    const source = itemSourceLevel(id);
    // Unsourced items (market stock) have no source level; they are buyable at any level.
    if (source !== undefined && source > level) continue;
    pool.push(item);
  }
  for (const id of Object.values(starter)) if (id && ITEMS[id]) pool.push(ITEMS[id]);
  const out: Partial<Record<EquipSlot, string>> = {};
  for (const slot of [...ARMOR_SLOTS, 'neck', 'trinket'] as EquipSlot[]) {
    const pick = bestFor(cls, spec, level, slot, pool, weights);
    if (pick) out[slot] = pick.id;
  }
  const ring1 = bestFor(cls, spec, level, 'ring1', pool, weights);
  if (ring1) {
    out.ring1 = ring1.id;
    const ring2 = bestFor(cls, spec, level, 'ring2', pool, weights, new Set([ring1.id]));
    if (ring2) out.ring2 = ring2.id;
  }
  // Weapons: the best main hand, then the best off hand that main hand allows.
  const main = bestFor(cls, spec, level, 'mainhand', pool, weights);
  if (main) out.mainhand = main.id;
  const mainIsTwoHand = main?.kind === 'weapon' && weaponHand(main) === 'twohand';
  if (!mainIsTwoHand) {
    const off = bestFor(cls, spec, level, 'offhand', pool, weights, new Set([main?.id ?? '']));
    if (off) out.offhand = off.id;
  }
  return out;
}

let armorPerIlvl: Map<string, number> | null = null;

// Armor an uncommon piece of this armor type and slot carries per item level,
// read off the shipped catalog (median), so the greens tier takes armor from
// real items rather than an invented table.
function armorPerItemLevel(armorType: string, slot: EquipSlot): number {
  if (!armorPerIlvl) {
    const samples = new Map<string, number[]>();
    for (const item of Object.values(ITEMS)) {
      // Shields carry block armor on their own scale: keep them out of the body-armor fit.
      if (item.kind !== 'armor' || !item.armorType || !item.slot || item.slot === 'offhand')
        continue;
      if (item.quality !== 'uncommon' && item.quality !== 'rare') continue;
      const ilvl = itemLevel(item);
      const armor = item.stats?.armor ?? 0;
      if (!ilvl || armor <= 0) continue;
      const key = `${item.armorType}:${item.slot}`;
      const list = samples.get(key) ?? [];
      list.push(armor / ilvl);
      samples.set(key, list);
    }
    armorPerIlvl = new Map();
    for (const [key, list] of samples) {
      list.sort((a, b) => a - b);
      armorPerIlvl.set(key, list[Math.floor(list.length / 2)]);
    }
  }
  return armorPerIlvl.get(`${armorType}:${slot}`) ?? 0;
}

const BEST_ARMOR: Record<PlayerClass, 'cloth' | 'leather' | 'mail'> = {
  warrior: 'mail',
  paladin: 'mail',
  shaman: 'mail',
  hunter: 'leather',
  rogue: 'leather',
  druid: 'leather',
  mage: 'cloth',
  priest: 'cloth',
  warlock: 'cloth',
};

function greenId(cls: PlayerClass, slot: EquipSlot, level: number): string {
  return `bench_green_${cls}_${slot}_${level}`;
}

// Register (once) and return a synthetic level green for this slot. Weapons
// borrow a real class-legal weapon's shape (type, speed, class lock) and are
// re-priced on the weapon-dps curve; armor and jewelry are built from the
// budget directly.
function greenItem(
  cls: PlayerClass,
  slot: EquipSlot,
  level: number,
  weaponShape?: ItemDef,
): ItemDef {
  const id = greenId(cls, slot, level);
  const cached = ITEMS[id];
  if (cached) return cached;
  const ilvl = level + (QUALITY_ILVL_BONUS.uncommon ?? 1);
  const spec = LEVELING_SPECS[cls];
  const budgetSlot = slot === 'ring1' || slot === 'ring2' ? 'ring' : slot;
  const twoHand = weaponShape?.kind === 'weapon' && weaponHand(weaponShape) === 'twohand';
  const budget = Math.round(
    primaryStatBudget(ilvl, 'uncommon', budgetSlot) * (twoHand ? TWOHAND_STAT_MULT : 1),
  );
  const stats = normalizeToStaminaModel(spec.greenStats, budget);
  let item: ItemDef;
  if (weaponShape) {
    const shape = weaponShape as ItemDef & { weapon?: { min: number; max: number; speed: number } };
    const dps = weaponDpsBudget(ilvl) * (twoHand ? TWOHAND_DPS_MULT : 1);
    item = {
      ...shape,
      id,
      name: id,
      quality: 'uncommon',
      stats,
      requiredLevel: undefined,
      spellPower: undefined,
      healPower: undefined,
      critRating: undefined,
      hasteRating: undefined,
      hitRating: undefined,
      set: undefined,
      ...(shape.weapon
        ? { weapon: { ...shape.weapon, ...scaleWeaponDamage(shape.weapon, dps) } }
        : {}),
    } as ItemDef;
  } else if (ARMOR_SLOTS.includes(slot)) {
    const armorType = BEST_ARMOR[cls];
    const armor = Math.round(armorPerItemLevel(armorType, slot) * ilvl);
    item = {
      id,
      name: id,
      kind: 'armor',
      slot,
      armorType,
      quality: 'uncommon',
      stats: { ...stats, armor },
      sellValue: 0,
    } as ItemDef;
  } else {
    item = {
      id,
      name: id,
      kind: 'armor',
      slot: budgetSlot,
      quality: 'uncommon',
      stats,
      sellValue: 0,
    } as ItemDef;
  }
  ITEMS[id] = item;
  return item;
}

function weaponShapeFor(
  cls: PlayerClass,
  spec: string | null,
  slot: 'mainhand' | 'offhand',
  twoHand: boolean,
): ItemDef | undefined {
  let best: ItemDef | undefined;
  for (const item of Object.values(ITEMS)) {
    if (item.id.startsWith('bench_green_')) continue;
    if (slot === 'mainhand' && item.kind !== 'weapon') continue;
    if (slot === 'offhand' && item.kind !== 'weapon' && item.kind !== 'held_offhand') continue;
    if (
      item.kind === 'weapon' &&
      (weaponHand(item) === 'twohand') !== twoHand &&
      slot === 'mainhand'
    )
      continue;
    if (item.quality !== 'uncommon' && item.quality !== 'common') continue;
    if (!canEquipItemInSlot(cls, item, slot, spec)) continue;
    // Prefer the plainest shape: uncommon over common, then the lowest id for stability.
    if (!best || item.id < best.id) best = item;
  }
  return best;
}

/** An uncommon level green in every slot (trinket excluded: leveling greens have none). */
export function greensLoadout(cls: PlayerClass, level: number): Partial<Record<EquipSlot, string>> {
  const spec = level >= SPEC_UNLOCK_LEVEL ? LEVELING_SPECS[cls].spec : null;
  const out: Partial<Record<EquipSlot, string>> = {};
  for (const slot of [...ARMOR_SLOTS, ...JEWELRY_SLOTS]) out[slot] = greenItem(cls, slot, level).id;
  const twoHand = LEVELING_SPECS[cls].twoHand;
  const mainShape =
    weaponShapeFor(cls, spec, 'mainhand', twoHand) ??
    weaponShapeFor(cls, spec, 'mainhand', !twoHand);
  if (mainShape) out.mainhand = greenItem(cls, 'mainhand', level, mainShape).id;
  const mainTwoHand = mainShape?.kind === 'weapon' && weaponHand(mainShape) === 'twohand';
  if (!mainTwoHand) {
    const offShape = weaponShapeFor(cls, spec, 'offhand', false);
    if (offShape) out.offhand = greenItem(cls, 'offhand', level, offShape).id;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rotations
// ---------------------------------------------------------------------------

interface FightState {
  sim: BenchSim;
  cls: PlayerClass;
  target: Entity;
  openerDone: boolean;
}

function aim(sim: BenchSim, target: Entity): void {
  sim.targetEntity(target.id);
  const p = sim.player;
  p.facing = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
  p.prevFacing = p.facing;
}

function fingerprint(sim: BenchSim, abilityId: string): string {
  const p = sim.player;
  return JSON.stringify([
    p.resource,
    p.gcdRemaining,
    p.castingAbility,
    p.cooldowns.get(abilityId) ?? null,
    p.auras.length,
    p.comboPoints,
  ]);
}

function tryCast(state: FightState, abilityId: string, target: Entity = state.target): boolean {
  const { sim } = state;
  const resolved = sim.resolvedAbility(abilityId);
  if (!resolved || sim.player.resource < resolved.cost) return false;
  if (sim.player.cooldowns.has(resolved.def.id)) return false;
  aim(sim, target);
  const before = fingerprint(sim, resolved.def.id);
  if (resolved.def.targetMode === 'position') {
    sim.castAbility(abilityId, sim.playerId, { x: target.pos.x, z: target.pos.z });
  } else {
    sim.castAbility(abilityId);
  }
  return fingerprint(sim, resolved.def.id) !== before;
}

function selfCast(state: FightState, abilityId: string): boolean {
  return tryCast(state, abilityId, state.sim.player);
}

function ownAura(
  target: Entity,
  id: string,
  sourceId: number,
): Entity['auras'][number] | undefined {
  return target.auras.find((a) => a.id === id && a.sourceId === sourceId);
}

function hasAura(e: Entity, id: string): boolean {
  return e.auras.some((a) => a.id === id);
}

function inMelee(state: FightState): boolean {
  const p = state.sim.player.pos;
  const t = state.target.pos;
  return Math.hypot(p.x - t.x, p.z - t.z) <= 5;
}

function hpFrac(e: Entity): number {
  return e.maxHp > 0 ? e.hp / e.maxHp : 0;
}

const ROTATIONS: Record<PlayerClass, (state: FightState) => void> = {
  warrior(state) {
    const p = state.sim.player;
    if (!state.openerDone) {
      state.openerDone = true;
      if (tryCast(state, 'charge')) return;
    }
    tryCast(state, 'bloodrage');
    if (hpFrac(state.target) < 0.2 && tryCast(state, 'execute')) return;
    if (tryCast(state, 'mortal_strike')) return;
    if (tryCast(state, 'overpower')) return;
    if (tryCast(state, 'breachmaker')) return;
    if (tryCast(state, 'slam')) return;
    if (p.resource >= 30) tryCast(state, 'heroic_strike');
  },
  paladin(state) {
    if (tryCast(state, 'avenging_wrath')) return;
    if (tryCast(state, 'hammer_of_wrath')) return;
    if (tryCast(state, 'final_edict')) return;
    if (tryCast(state, 'crusader_strike')) return;
    if (tryCast(state, 'exorcism')) return;
    if (tryCast(state, 'hammer_of_grace')) return;
    if (tryCast(state, 'holy_shock')) return;
    if (tryCast(state, 'dawnfall')) return;
    tryCast(state, 'consecration');
  },
  hunter(state) {
    const p = state.sim.player;
    if (!state.openerDone) {
      state.openerDone = true;
      state.sim.petAttack();
    }
    if (inMelee(state)) {
      if (tryCast(state, 'raptor_strike')) return;
    }
    if (tryCast(state, 'stampede')) return;
    if (!ownAura(state.target, 'serpent_sting', p.id) && tryCast(state, 'serpent_sting')) return;
    if (tryCast(state, 'pack_command')) return;
    if (tryCast(state, 'arcane_shot')) return;
    tryCast(state, 'concussive_shot');
  },
  rogue(state) {
    const p = state.sim.player;
    tryCast(state, 'adrenaline_rush');
    tryCast(state, 'flurry_of_knives');
    const sliceUp = p.auras.some((a) => a.id === 'slice_and_dice');
    if (!sliceUp && p.comboPoints >= 2 && tryCast(state, 'slice_and_dice')) return;
    if (p.comboPoints >= 5 && tryCast(state, 'eviscerate')) return;
    // A finisher before the mob dies: spend 3+ points on a low target.
    if (p.comboPoints >= 3 && hpFrac(state.target) < 0.25 && tryCast(state, 'eviscerate')) return;
    tryCast(state, 'sinister_strike');
  },
  priest(state) {
    const p = state.sim.player;
    if (!state.openerDone) {
      state.openerDone = true;
      if (selfCast(state, 'power_word_shield')) return;
    }
    if (!ownAura(state.target, 'shadow_word_pain', p.id) && tryCast(state, 'shadow_word_pain'))
      return;
    if (tryCast(state, 'mind_blast')) return;
    if (tryCast(state, 'mind_flay')) return;
    tryCast(state, 'smite');
  },
  shaman(state) {
    const p = state.sim.player;
    if (tryCast(state, 'unleash_weapon')) return;
    if (hasAura(p, 'shaman_stormcast') && tryCast(state, 'lightning_bolt')) return;
    if (tryCast(state, 'stormstrike')) return;
    if (!ownAura(state.target, 'flame_shock', p.id) && tryCast(state, 'flame_shock')) return;
    if (tryCast(state, 'earth_shock')) return;
    // Below the shock levels the kit is Lightning Bolt and the weapon.
    if (!state.sim.resolvedAbility('earth_shock')) tryCast(state, 'lightning_bolt');
  },
  mage(state) {
    const p = state.sim.player;
    if (tryCast(state, 'frozen_orb')) return;
    if (hasAura(p, 'brain_freeze') && tryCast(state, 'flurry')) return;
    const shatterReady = hasAura(p, 'fingers_of_frost') || hasAura(state.target, 'winters_chill');
    if (shatterReady && tryCast(state, 'ice_lance')) return;
    const icicles = p.auras.find((a) => a.id === 'icicles')?.stacks ?? 0;
    if (icicles >= 5 && tryCast(state, 'glacial_spike')) return;
    if (tryCast(state, 'frostbolt')) return;
    tryCast(state, 'fireball');
  },
  warlock(state) {
    const p = state.sim.player;
    if (!state.openerDone) {
      state.openerDone = true;
      state.sim.petAttack();
    }
    if (p.resource < p.maxResource * 0.25 && hpFrac(p) > 0.6 && tryCast(state, 'life_tap')) return;
    if (!ownAura(state.target, 'immolate', p.id) && tryCast(state, 'immolate')) return;
    if (!ownAura(state.target, 'corruption', p.id) && tryCast(state, 'corruption')) return;
    if (!ownAura(state.target, 'curse_of_agony', p.id) && tryCast(state, 'curse_of_agony')) return;
    if (tryCast(state, 'chaos_bolt')) return;
    if (tryCast(state, 'shadowburn')) return;
    tryCast(state, 'shadow_bolt');
  },
  druid(state) {
    const p = state.sim.player;
    if (p.resourceType === 'energy') {
      tryCast(state, 'tigers_fury');
      const rake = ownAura(state.target, 'rake', p.id);
      const rip = ownAura(state.target, 'rip', p.id);
      if (p.comboPoints >= 5 && !rip && hpFrac(state.target) > 0.4 && tryCast(state, 'rip')) return;
      if (!rake && tryCast(state, 'rake')) return;
      if (p.comboPoints >= 5 && tryCast(state, 'ferocious_bite')) return;
      if (p.comboPoints >= 3 && hpFrac(state.target) < 0.25 && tryCast(state, 'ferocious_bite'))
        return;
      tryCast(state, 'claw');
      return;
    }
    if (!ownAura(state.target, 'moonfire', p.id) && tryCast(state, 'moonfire')) return;
    tryCast(state, 'wrath');
  },
};

// Out-of-combat self buffs a leveler keeps up, cast before every pull.
const PULL_BUFFS: Record<PlayerClass, readonly string[]> = {
  warrior: ['battle_shout'],
  paladin: ['seal_of_righteousness', 'blessing_of_might', 'retribution_aura'],
  hunter: ['aspect_of_the_hawk'],
  rogue: ['instant_poison'],
  priest: ['power_word_fortitude', 'shadowform'],
  shaman: ['lightning_shield', 'galeheart_weapon', 'rockbiter_weapon'],
  mage: ['frost_armor', 'arcane_intellect'],
  warlock: ['demon_skin'],
  druid: ['mark_of_the_wild', 'thorns', 'cat_form'],
};

function isRangedOpener(cls: PlayerClass, sim: BenchSim): boolean {
  if (cls === 'hunter' || cls === 'priest' || cls === 'mage' || cls === 'warlock') return true;
  if (cls === 'druid') return sim.player.resourceType !== 'energy';
  return false;
}

// ---------------------------------------------------------------------------
// Fight driver
// ---------------------------------------------------------------------------

export interface LevelingFightResult {
  mobId: string;
  mobHp: number;
  outcome: 'killed' | 'died' | 'timeout';
  seconds: number;
  damageTaken: number;
  // Damage taken as a share of the player's max health.
  damageTakenPct: number;
  // Mana-class cost of the kill as a share of max mana (null for rage/energy/focus).
  manaSpentPct: number | null;
  // Damage dealt to the mob, keyed by ability label (pets fold under their label).
  damageBySource: Record<string, number>;
}

export interface LevelingCellResult {
  cls: PlayerClass;
  level: number;
  tier: LevelingGearTier;
  playerMaxHp: number;
  fights: LevelingFightResult[];
}

function resetPlayer(sim: BenchSim): void {
  const p = sim.player;
  p.dead = false;
  p.hp = p.maxHp;
  p.resource = p.resourceType === 'mana' || p.resourceType === 'energy' ? p.maxResource : 0;
  if (p.resourceType === 'focus') p.resource = p.maxResource;
  p.gcdRemaining = 0;
  p.castingAbility = null;
  p.comboPoints = 0;
  p.inCombat = false;
  p.autoAttack = false;
  p.targetId = null;
  anchorProbeInOpenField(sim);
}

function applyGear(
  sim: BenchSim,
  cls: PlayerClass,
  equipment: Partial<Record<EquipSlot, string>>,
): void {
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('bench player metadata missing');
  meta.equipment = { ...equipment };
  meta.equipmentInstance = {};
  recalcPlayerStats(
    sim.player,
    cls,
    meta.equipment,
    sim.ctx.playerMods(meta),
    meta.equipmentInstance,
  );
}

function tickFor(sim: BenchSim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 20); i++) events.push(...sim.tick());
  return events;
}

// Shapeshifts (Cat Form, Gloamveil) are toggles: casting one again while it is
// up drops the form, so a form that is already up is left alone.
function formAlreadyUp(sim: BenchSim, abilityId: string): boolean {
  const def = sim.resolvedAbility(abilityId)?.def;
  for (const effect of def?.effects ?? []) {
    if (effect.type !== 'selfBuff' || !effect.kind.startsWith('form_')) continue;
    const kind = effect.kind;
    return sim.player.auras.some((a) => a.kind === kind);
  }
  return false;
}

function castPullBuffs(sim: BenchSim, cls: PlayerClass): void {
  const state: FightState = { sim, cls, target: sim.player, openerDone: true };
  for (const id of PULL_BUFFS[cls]) {
    if (!sim.resolvedAbility(id) || formAlreadyUp(sim, id)) continue;
    sim.player.gcdRemaining = 0;
    selfCast(state, id);
    tickFor(sim, 2.5);
  }
}

function ensurePet(sim: BenchSim, cls: PlayerClass, level: number): void {
  const p = sim.player;
  // A beast or elemental that fell last pull keeps its corpse: bring it back the
  // way a leveler does between pulls (Revive Pet), then top it up below.
  const fallen = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.ownerId === p.id && e.dead,
  );
  if (fallen) sim.revivePet();
  const existing = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.ownerId === p.id && !e.dead,
  );
  if (existing) {
    existing.hp = existing.maxHp;
    existing.aggroTargetId = null;
    existing.inCombat = false;
    existing.pos = sim.groundPos(p.pos.x + 2, p.pos.z - 1);
    existing.prevPos = { ...existing.pos };
    sim.rebucket(existing);
    return;
  }
  if (cls === 'hunter') {
    const beast = createMob(sim.nextId++, tameableBeastAt(level), level, {
      x: p.pos.x + 2,
      y: p.pos.y,
      z: p.pos.z + 2,
    });
    sim.addEntity(beast);
    sim.ctx.completeTame(p, beast);
  } else if (cls === 'warlock') {
    const summon = sim.resolvedAbility('summon_voidwalker') ? 'summon_voidwalker' : 'summon_imp';
    if (!sim.resolvedAbility(summon)) return;
    p.resource = p.maxResource;
    sim.castAbility(summon);
    tickFor(sim, 6);
  } else if (cls === 'mage') {
    if (!sim.resolvedAbility('summon_water_elemental')) return;
    p.resource = p.maxResource;
    sim.castAbility('summon_water_elemental');
    tickFor(sim, 3);
  }
  sim.drainEvents();
}

function runFight(
  sim: BenchSim,
  cls: PlayerClass,
  level: number,
  template: MobTemplate,
  mobTransform: MobTransform | undefined,
  mobStamp: MobStamp | undefined,
): LevelingFightResult {
  resetPlayer(sim);
  ensurePet(sim, cls, level);
  tickFor(sim, PULL_GAP_SECONDS);
  castPullBuffs(sim, cls);
  resetPlayer(sim);
  sim.drainEvents();
  const p = sim.player;
  const ranged = isRangedOpener(cls, sim);
  const opensWithCharge = cls === 'warrior' && !!sim.resolvedAbility('charge');
  const yards = ranged
    ? RANGED_START_YARDS
    : opensWithCharge
      ? CHARGE_START_YARDS
      : MELEE_START_YARDS;
  const spawned = (mobTransform ?? openWorldMobTemplate)(template, level);
  const mob = createMob(sim.nextId++, spawned, level, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + yards,
  });
  mob.pos = sim.groundPos(mob.pos.x, mob.pos.z);
  mob.prevPos = { ...mob.pos };
  mob.spawnPos = { ...mob.pos };
  if (mobStamp) mobStamp(mob);
  else if (!mobTransform) applyOpenWorldMobTuning(mob, template);
  sim.addEntity(mob);
  aim(sim, mob);
  if (!ranged || cls === 'hunter') sim.startAutoAttack();
  const state: FightState = { sim, cls, target: mob, openerDone: false };
  const startMana = p.resourceType === 'mana' ? p.resource : null;
  let manaSpent = 0;
  let lastMana = startMana ?? 0;
  let damageTaken = 0;
  const damageBySource: Record<string, number> = {};
  let ticks = 0;
  let outcome: LevelingFightResult['outcome'] = 'timeout';
  for (; ticks < FIGHT_TIMEOUT_SECONDS * 20; ticks++) {
    if (!p.castingAbility && !p.dead) ROTATIONS[cls](state);
    // Melee keeps swinging at the mob even through a flee.
    if (!ranged && !p.autoAttack) sim.startAutoAttack();
    for (const event of sim.tick()) {
      if (event.type !== 'damage' || event.amount <= 0) continue;
      if (event.targetId === p.id) damageTaken += event.amount;
      if (event.targetId === mob.id) {
        const pet = event.sourceId !== p.id ? 'pet ' : '';
        const key = `${pet}${event.ability ?? 'Auto Attack'}`;
        damageBySource[key] = (damageBySource[key] ?? 0) + event.amount;
      }
    }
    if (startMana !== null && p.resourceType === 'mana') {
      if (p.resource < lastMana) manaSpent += lastMana - p.resource;
      lastMana = p.resource;
    }
    if (mob.dead) {
      outcome = 'killed';
      ticks++;
      break;
    }
    if (p.dead) {
      outcome = 'died';
      ticks++;
      break;
    }
  }
  sim.stopAutoAttack();
  sim.ctx.dropEntity(mob.id);
  // The pet and player forget the dropped mob so the next pull starts clean.
  for (const e of sim.entities.values()) e.threat.delete(mob.id);
  return {
    mobId: template.id,
    mobHp: mob.maxHp,
    outcome,
    seconds: ticks / 20,
    damageTaken,
    damageTakenPct: p.maxHp > 0 ? damageTaken / p.maxHp : 0,
    manaSpentPct: startMana !== null && p.maxResource > 0 ? manaSpent / p.maxResource : null,
    damageBySource,
  };
}

export interface LevelingCellOptions {
  cls: PlayerClass;
  level: number;
  tiers?: readonly LevelingGearTier[];
  repetitions?: number;
  seed?: number;
  mobTransform?: MobTransform;
  mobStamp?: MobStamp;
  templates?: readonly MobTemplate[];
}

/** One class at one level: every tier against the level's camp sample. */
export function runLevelingCells(opts: LevelingCellOptions): LevelingCellResult[] {
  const { cls, level } = opts;
  const tiers = opts.tiers ?? LEVELING_GEAR_TIERS;
  const reps = opts.repetitions ?? 2;
  const sim = new Sim({ seed: opts.seed ?? 4242, playerClass: cls, autoEquip: false }) as BenchSim;
  // An empty world: the bench pulls one mob at a time, so no camp may wander in.
  for (const e of [...sim.entities.values()]) {
    if (e.kind === 'mob' && e.ownerId === null) sim.ctx.dropEntity(e.id);
  }
  sim.setPlayerLevel(level);
  anchorProbeInOpenField(sim);
  if (level >= SPEC_UNLOCK_LEVEL) {
    const spec = LEVELING_SPECS[cls];
    const rows = Object.fromEntries(
      Object.entries(spec.rows).filter(([rowLevel]) => Number(rowLevel) <= level),
    );
    if (!sim.applyTalents({ spec: spec.spec, rows })) {
      throw new Error(`could not apply ${cls} ${spec.spec} talents at level ${level}`);
    }
  }
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('bench player metadata missing');
  const starter = { ...meta.equipment };
  const templates = opts.templates ?? campTemplatesAt(level);
  const results: LevelingCellResult[] = [];
  for (const tier of tiers) {
    const equipment =
      tier === 'starter'
        ? starter
        : tier === 'available'
          ? availableLoadout(cls, level, starter)
          : greensLoadout(cls, level);
    applyGear(sim, cls, equipment);
    const fights: LevelingFightResult[] = [];
    // One discarded warm-up pull so the first measured fight does not open with
    // every cooldown fresh.
    if (templates.length > 0)
      runFight(sim, cls, level, templates[0], opts.mobTransform, opts.mobStamp);
    for (const template of templates) {
      for (let r = 0; r < reps; r++) {
        fights.push(runFight(sim, cls, level, template, opts.mobTransform, opts.mobStamp));
      }
    }
    results.push({ cls, level, tier, playerMaxHp: sim.player.maxHp, fights });
  }
  return results;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
