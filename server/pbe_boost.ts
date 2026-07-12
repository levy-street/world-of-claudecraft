// PBE account boost. When the server runs with PBE_BOOST_ACCOUNTS=1, a freshly
// registered account is pre-populated with one level-20 character per class,
// each wearing the non-heroic best-in-slot kit for its primary role under a
// random generated name, with four best-in-slot bags, 10 gold of pocket money,
// every alternate role's kit carried in the bags (tank, healer, and off-dps
// playstyles included), and the Nythraxis attunement quest chain completed,
// so public-beta testers land straight in endgame raid testing instead of
// leveling, farming gear, or re-running the attunement.
//
// The flag is read live per registration (the PERF_TICK_LOG pattern, not the
// boot-time config object) so tests and operators can flip it without a
// restart. NEVER set it in production: it turns every registration into a
// full character roster.
//
// The character states are built through the real Sim (setPlayerLevel + the
// real equip path + serializeCharacter), never hand-crafted JSONB, so every
// derived field (xp, talents unlocked, known abilities, stats) stays exactly
// consistent with what the game itself would produce.

import { randomInt } from 'node:crypto';
import { BAG_SOCKETS } from '../src/sim/bags';
import { HEROIC_ITEMS } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ITEMS } from '../src/sim/data';
import {
  canDualWield,
  canDualWieldTwoHand,
  canEquipItem,
  canEquipItemInSlot,
  weaponHand,
} from '../src/sim/equipment_rules';
import { meetsLevelRequirement } from '../src/sim/item_level_req';
import { type CharacterState, Sim } from '../src/sim/sim';
import type { EquipSlot, ItemDef, PlayerClass } from '../src/sim/types';
import { normalizeCharName, offensiveName } from './auth';
import { createCharacterCapped, saveCharacterState } from './db';
import { logger } from './http/logger';
import { isUniqueViolation } from './http_util';

export const BOOST_LEVEL = 20;
// Mirrors the per-realm character cap in server/characters.ts (10) and its
// MAX_SKIN (7): one boosted character per class fits under the cap with a
// slot to spare for a hand-made character.
const CHARACTER_LIMIT = 10;
const BOOST_MAX_SKIN = 7;
// Same fixed world seed the normal creation path uses (initialCharacterState
// in server/main.ts): the builder Sim is a throwaway, never ticked.
const BOOST_SEED = 20061;
// Name draws per class before giving up on that class (collisions are rare;
// the generator space is ~10k combos).
const NAME_ATTEMPTS = 8;

export const BOOST_CLASSES: readonly PlayerClass[] = [
  'warrior',
  'warrior_classic',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

export function pbeBoostEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PBE_BOOST_ACCOUNTS === '1';
}

// ---------------------------------------------------------------------------
// Random names. Syllable composition only ever emits letters, so every draw
// already matches the character-name shape rule (server/auth.ts); the
// offensiveName screen still runs as a belt-and-braces filter.

const NAME_STARTS = [
  'Bal',
  'Cael',
  'Dor',
  'El',
  'Fen',
  'Gar',
  'Hal',
  'Isen',
  'Jor',
  'Kel',
  'Lor',
  'Mar',
  'Ner',
  'Or',
  'Pell',
  'Quin',
  'Ral',
  'Sel',
  'Tor',
  'Ul',
  'Vael',
  'Wren',
  'Yor',
  'Zan',
];
const NAME_MIDS = [
  'a',
  'ad',
  'ar',
  'e',
  'en',
  'i',
  'ir',
  'o',
  'or',
  'u',
  'and',
  'eth',
  'is',
  'ol',
  'um',
  'yn',
];
const NAME_ENDS = [
  'bard',
  'dan',
  'dric',
  'fast',
  'gorn',
  'grim',
  'hart',
  'ion',
  'lan',
  'lek',
  'mir',
  'mond',
  'nash',
  'rick',
  'rin',
  'ros',
  'stag',
  'thas',
  'tide',
  'vane',
  'vash',
  'wick',
  'wyn',
  'zar',
];

type RandFn = (maxExclusive: number) => number;

export function randomBoostName(rand: RandFn = randomInt): string {
  for (;;) {
    const mid = rand(2) === 0 ? NAME_MIDS[rand(NAME_MIDS.length)] : '';
    const name = NAME_STARTS[rand(NAME_STARTS.length)] + mid + NAME_ENDS[rand(NAME_ENDS.length)];
    if (normalizeCharName(name) === name && !offensiveName(name)) return name;
  }
}

// ---------------------------------------------------------------------------
// Non-heroic best-in-slot selection. "Non-heroic" excludes the whole bespoke
// heroic item table (HEROIC_ITEMS: the five-man and raid heroic drops, some of
// which predate the heroic flag), the generated heroic dungeon variants
// (heroicOf), and the heroic-mark vendor stock. What remains is the normal
// ladder: item-level-26 dungeon epics, 29 normal-raid epics, and the
// normal-raid legendaries at 33.

const HEROIC_VENDOR_IDS: ReadonlySet<string> = new Set(HEROIC_VENDOR_STOCK.map((o) => o.itemId));

// Test-kit stat heuristics per ROLE, not balance truth: primary stats the role
// scales with (AP/spell power/HP derivations in recalcPlayerStats), sta for
// survivability. Armor and weapon dps mirror itemScore's conversions
// (src/sim/item_level.ts): 12 armor = 1 point, melee roles value weapon dps at
// half weight; caster roles instead value spell power and barely swing.
//
// The role ids follow the class spec identities (src/sim/content/
// talents_classic.ts). The FIRST role is what the character spawns wearing;
// every later role's kit is placed in the bags so hybrid classes (paladin,
// shaman, druid) can test their other playstyle without farming gear.
type WeightableStat = 'str' | 'agi' | 'sta' | 'int' | 'spi';
export interface BoostRole {
  /** Spec identity this kit gears for (matches the talent spec naming). Also
   *  the spec the kit's equip legality is evaluated under: fury's dual wield
   *  is spec-conditional in canDualWield / canEquipItemInSlot. */
  id: string;
  weights: Partial<Record<WeightableStat, number>>;
  /** Melee roles value weapon dps; caster roles value spell power. */
  melee: boolean;
  /** Tank kits: armor always counts as an identity stat and shield block
   *  value scores, so a sta-first kit never discounts the armor it exists
   *  for (sta is deliberately not in IDENTITY_STATS). */
  tank?: boolean;
  /** Hand layout. 'shield' forces the best one-hander plus the best shield
   *  (the overhauled Shieldcrack requiresShield); 'dualWield' fills both
   *  hands with the two best spec-legal weapons (fury / Titan's Grip).
   *  Default: best weapon overall, offhand filled opportunistically. */
  hands?: 'shield' | 'dualWield';
  /** Extra bagged items granted alongside this kit, allowed to DUPLICATE a
   *  worn kit piece: fury carries a second greatsword and a spare epic
   *  one-hander so every dual-wield layout (2H+2H via Titan's Grip, 2H+1H,
   *  1H+1H) is testable without farming. */
  extras?: readonly string[];
}

// One kit per DISTINCT gear identity, not per spec: specs that share a gear
// profile share a kit (hunter/rogue/mage/warlock specs all wear their class
// kit; priest shadow/discipline wear the holy kit because the caster cloth
// pool is undifferentiated, a tripwire in the boost test re-checks that;
// shaman restoration wears the elemental kit; druid restoration wears the
// balance kit and feral covers both cat and bear). The classic warrior got
// equal weapon footing 2026-07-11 (always dual-wields one-handers, equips
// shields, no Titan's Grip), so it mirrors the warrior's fury/prot kits with
// a one-hand pair instead of the Titan's Grip layout.
export const CLASS_ROLES: Record<PlayerClass, readonly BoostRole[]> = {
  warrior: [
    { id: 'arms', weights: { str: 1, sta: 0.8, agi: 0.4 }, melee: true },
    {
      id: 'fury',
      weights: { str: 1, sta: 0.8, agi: 0.4 },
      melee: true,
      hands: 'dualWield',
      // The second extra must BE one-handed (the 1H+1H layout with the
      // bagged Thronebane); wyrmfang_greatblade left this slot when PR #1762
      // declared it two-handed, and emberfang_warblade is the best remaining
      // warrior-legal non-heroic one-hander below the legendary.
      extras: ['bonewrought_greatsword', 'emberfang_warblade'],
    },
    {
      id: 'prot',
      weights: { sta: 1, str: 0.6, agi: 0.3 },
      melee: true,
      tank: true,
      hands: 'shield',
    },
  ],
  warrior_classic: [
    { id: 'arms', weights: { str: 1, sta: 0.8, agi: 0.4 }, melee: true },
    { id: 'fury', weights: { str: 1, sta: 0.8, agi: 0.4 }, melee: true, hands: 'dualWield' },
    {
      id: 'prot',
      weights: { sta: 1, str: 0.6, agi: 0.3 },
      melee: true,
      tank: true,
      hands: 'shield',
    },
  ],
  paladin: [
    { id: 'retribution', weights: { str: 1, sta: 0.8, int: 0.3, spi: 0.2 }, melee: true },
    { id: 'holy', weights: { int: 1, spi: 0.8, sta: 0.4 }, melee: false },
    {
      id: 'protection',
      weights: { sta: 1, str: 0.5, int: 0.2 },
      melee: true,
      tank: true,
      hands: 'shield',
    },
  ],
  hunter: [{ id: 'marksmanship', weights: { agi: 1, sta: 0.6, int: 0.2 }, melee: true }],
  rogue: [{ id: 'combat', weights: { agi: 1, sta: 0.6, str: 0.4 }, melee: true }],
  priest: [{ id: 'holy', weights: { int: 1, spi: 0.8, sta: 0.4 }, melee: false }],
  shaman: [
    { id: 'elemental', weights: { int: 1, spi: 0.7, sta: 0.5 }, melee: false },
    { id: 'enhancement', weights: { agi: 1, str: 0.8, sta: 0.6 }, melee: true },
  ],
  mage: [{ id: 'frost', weights: { int: 1, spi: 0.6, sta: 0.4 }, melee: false }],
  warlock: [{ id: 'demonology', weights: { int: 1, sta: 0.6, spi: 0.5 }, melee: false }],
  druid: [
    { id: 'balance', weights: { int: 1, spi: 0.7, sta: 0.5 }, melee: false },
    { id: 'feral', weights: { agi: 1, str: 0.6, sta: 0.6 }, melee: true },
  ],
};

const ARMOR_PER_POINT = 12;
const MELEE_DPS_WEIGHT = 0.5;
const CASTER_DPS_WEIGHT = 0.1;
const SPELL_POWER_WEIGHT = 0.9;
const RATING_WEIGHT = 0.3;
// Flat damage a shield's block prevents per blocked hit; only tank roles care.
const BLOCK_VALUE_WEIGHT = 0.5;
// Armor on a piece with NONE of the role's identity stats (the weighted
// str/agi/int/spi, or spell power for casters; sta is universal so it never
// counts as identity) is heavily discounted: without this a healer role picks
// dead-stat plate purely for its armor pool, and a melee role hoards int mail.
const DEAD_STAT_ARMOR_FACTOR = 0.3;
const IDENTITY_STATS: readonly WeightableStat[] = ['str', 'agi', 'int', 'spi'];

export function roleItemScore(role: BoostRole, item: ItemDef): number {
  let score = 0;
  for (const [stat, weight] of Object.entries(role.weights) as [WeightableStat, number][]) {
    score += (item.stats?.[stat] ?? 0) * weight;
  }
  let identity = 0;
  for (const stat of IDENTITY_STATS) {
    identity += (item.stats?.[stat] ?? 0) * (role.weights[stat] ?? 0);
  }
  if (!role.melee) identity += item.spellPower ?? 0;
  // Tanks exist for armor: it is their identity stat, never a dead stat.
  if (role.tank) identity += item.stats?.armor ?? 0;
  score +=
    ((item.stats?.armor ?? 0) / ARMOR_PER_POINT) * (identity > 0 ? 1 : DEAD_STAT_ARMOR_FACTOR);
  if (item.weapon) {
    const dps = (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed;
    score += dps * (role.melee ? MELEE_DPS_WEIGHT : CASTER_DPS_WEIGHT);
  }
  if (!role.melee) score += (item.spellPower ?? 0) * SPELL_POWER_WEIGHT;
  if (role.tank && item.kind === 'shield') score += (item.blockValue ?? 0) * BLOCK_VALUE_WEIGHT;
  score += ((item.critRating ?? 0) + (item.hasteRating ?? 0)) * RATING_WEIGHT;
  return score;
}

/** The class's PRIMARY (spawn-equipped) role score; kept for the kit tests. */
export function classItemScore(cls: PlayerClass, item: ItemDef): number {
  return roleItemScore(CLASS_ROLES[cls][0], item);
}

function eligibleForBoost(cls: PlayerClass, item: ItemDef): boolean {
  if (!item.slot) return false;
  if (
    item.kind !== 'weapon' &&
    item.kind !== 'armor' &&
    item.kind !== 'shield' &&
    item.kind !== 'held_offhand'
  ) {
    return false;
  }
  if (item.heroic || item.heroicOf) return false;
  if (item.id in HEROIC_ITEMS) return false;
  if (HEROIC_VENDOR_IDS.has(item.id)) return false;
  if (!canEquipItem(cls, item)) return false;
  // canEquipItem checks requiredClass for weapons only; class-locked armor
  // (the tier sets) declares intent through requiredClass too, so honor it
  // (the classic warrior counts as a warrior for authored gear locks).
  const gearCls = cls === 'warrior_classic' ? 'warrior' : cls;
  if (item.requiredClass && !item.requiredClass.includes(gearCls)) return false;
  return meetsLevelRequirement(BOOST_LEVEL, item);
}

/** The slot order the kit is equipped in: mainhand before offhand (a shield or
 *  a rogue's second weapon routes to the offhand once the mainhand is filled);
 *  rings resolve ring1 then ring2. */
const KIT_SLOTS: readonly EquipSlot[] = [
  'mainhand',
  'offhand',
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
  'ring1',
  'ring2',
];

export function bisKitForRole(
  cls: PlayerClass,
  role: BoostRole,
): Partial<Record<EquipSlot, string>> {
  const bestBySlot = new Map<string, { id: string; score: number }>();
  const rings: { id: string; score: number }[] = [];
  const weapons: { id: string; score: number; twoHand: boolean }[] = [];
  const shields: { id: string; score: number }[] = [];
  for (const item of Object.values(ITEMS)) {
    if (!eligibleForBoost(cls, item)) continue;
    const score = roleItemScore(role, item);
    if (item.kind === 'weapon') {
      weapons.push({ id: item.id, score, twoHand: weaponHand(item) === 'twohand' });
      continue;
    }
    if (item.slot === 'ring') {
      rings.push({ id: item.id, score });
      continue;
    }
    if (item.kind === 'shield') shields.push({ id: item.id, score });
    // Shields and held offhands declare slot 'offhand' and land in that bucket.
    const slot = item.slot as string;
    const best = bestBySlot.get(slot);
    if (!best || score > best.score) bestBySlot.set(slot, { id: item.id, score });
  }
  rings.sort((a, b) => b.score - a.score);
  weapons.sort((a, b) => b.score - a.score);
  shields.sort((a, b) => b.score - a.score);
  const kit: Partial<Record<EquipSlot, string>> = {};
  for (const slot of KIT_SLOTS) {
    if (slot === 'mainhand' || slot === 'offhand' || slot === 'ring1' || slot === 'ring2') {
      continue;
    }
    const best = bestBySlot.get(slot);
    if (best) kit[slot] = best.id;
  }
  fillHands(cls, role, kit, weapons, shields, bestBySlot.get('offhand'));
  if (rings[0]) kit.ring1 = rings[0].id;
  if (rings[1]) kit.ring2 = rings[1].id;
  return kit;
}

type ScoredItem = { id: string; score: number };
type ScoredWeapon = ScoredItem & { twoHand: boolean };

/** Resolve the weapon slots by the role's hand layout. Alternate-role kits
 *  ride in the bags and are equipped AFTER the tester commits the spec, so
 *  their legality is checked under role.id; the default layout keeps the
 *  spec-less check because the primary kit is equipped at spawn, before any
 *  spec exists. Every layout falls back to the default when its pieces do
 *  not exist, so a content change can never produce a weaponless kit. */
function fillHands(
  cls: PlayerClass,
  role: BoostRole,
  kit: Partial<Record<EquipSlot, string>>,
  weapons: readonly ScoredWeapon[],
  shields: readonly ScoredItem[],
  held: ScoredItem | undefined,
): void {
  if (role.hands === 'shield') {
    // A tank holds the best one-hander plus the best shield (Shieldcrack
    // requiresShield; a two-hander would displace the shield on equip).
    const main = weapons.find((w) => !w.twoHand);
    const shield = shields[0];
    if (main && shield) {
      kit.mainhand = main.id;
      kit.offhand = shield.id;
      return;
    }
  }
  if (role.hands === 'dualWield') {
    // Both hands get the best distinct spec-legal weapons. Under Titan's
    // Grip (the Bloodrush warrior) canEquipItemInSlot admits two-handers in
    // either hand; without it (the classic warrior) the PAIR must be two
    // one-handers, so a two-handed mainhand candidate cannot anchor it (the
    // equip path would displace the offhand).
    const titanGrip = canDualWieldTwoHand(cls, role.id);
    const main = weapons.find(
      (w) => (titanGrip || !w.twoHand) && canEquipItemInSlot(cls, ITEMS[w.id], 'mainhand', role.id),
    );
    const off = weapons.find(
      (w) => w.id !== main?.id && canEquipItemInSlot(cls, ITEMS[w.id], 'offhand', role.id),
    );
    if (main && off) {
      kit.mainhand = main.id;
      kit.offhand = off.id;
      return;
    }
  }
  const mainhand = weapons[0];
  if (mainhand) kit.mainhand = mainhand.id;
  // A two-handed mainhand occupies both hands (equipping any offhand would
  // displace it, src/sim/items.ts equipItem); otherwise the offhand takes the
  // best of a shield / held offhand, or, for a dual-wielder (rogue at spawn:
  // no spec is chosen yet), the second-best one-hand weapon.
  if (mainhand && !mainhand.twoHand) {
    // The second weapon must be offhand-legal (canEquipItemInSlot excludes
    // two-handers and mainhand-only weapons for a spec-less dual-wielder);
    // anything else would displace the mainhand pick on equip.
    const second = canDualWield(cls, null)
      ? weapons.find(
          (w) => w.id !== mainhand.id && canEquipItemInSlot(cls, ITEMS[w.id], 'offhand', null),
        )
      : undefined;
    const off = [held, second]
      .filter((c): c is ScoredItem => c !== undefined)
      .sort((a, b) => b.score - a.score)[0];
    if (off) kit.offhand = off.id;
  }
}

/** The class's PRIMARY (spawn-equipped) role kit. */
export function nonHeroicBisKit(cls: PlayerClass): Partial<Record<EquipSlot, string>> {
  return bisKitForRole(cls, CLASS_ROLES[cls][0]);
}

/** The best non-heroic bag: strictly the most slots (no tiebreak needed; the
 *  content has a single largest bag, and the test pins its id). */
export function bestBoostBag(): string {
  let best: ItemDef | null = null;
  for (const item of Object.values(ITEMS)) {
    if (item.kind !== 'bag') continue;
    if (item.heroic || item.heroicOf || item.id in HEROIC_ITEMS) continue;
    if (HEROIC_VENDOR_IDS.has(item.id)) continue;
    if (!best || (item.bagSlots ?? 0) > (best.bagSlots ?? 0)) best = item;
  }
  if (!best) throw new Error('no bag items in content');
  return best.id;
}

// ---------------------------------------------------------------------------
// Character state construction: the same throwaway-Sim shape as
// initialCharacterState (server/main.ts), plus level, bags, gear, gold, and
// the alternate-role kits. The Sim is never ticked, so nothing in the world
// can interact with the player.

export const BOOST_BAG_SOCKETS = BAG_SOCKETS;
/** Pocket money for consumables, repairs, and the auction house: 10 gold. */
export const BOOST_COPPER = 100_000;
/** The Nythraxis attunement chain, in prerequisite order. The raid door
 *  (canEnterNythraxisRaid, src/sim/instances/dungeons.ts) opens on the final
 *  quest, so boosted characters walk straight into the raid. Completed via
 *  the real accept/turn-in cores (completeQuestForDev reuses them), so the
 *  rewards match a genuinely attuned player. */
export const NYTHRAXIS_ATTUNEMENT_QUESTS: readonly string[] = [
  'q_nythraxis_restless_dead',
  'q_nythraxis_graves',
  'q_nythraxis_sealed_crypt',
  'q_nythraxis_bound_guardian',
];

export function buildBoostedCharacterState(
  cls: PlayerClass,
  name: string,
  skin: number,
): CharacterState {
  const sim = new Sim({ seed: BOOST_SEED, playerClass: cls, playerName: name });
  const pid = sim.playerId;
  sim.setPlayerSkin(pid, skin);
  sim.setPlayerLevel(BOOST_LEVEL, pid);
  // Bags first so the pooled capacity exists before the alternate kits land.
  const bagId = bestBoostBag();
  for (let socket = 0; socket < BOOST_BAG_SOCKETS; socket++) {
    sim.addItem(bagId, 1, pid);
    sim.equipBag(bagId, socket, pid);
  }
  // Nythraxis attunement: run the whole chain through the real quest cores
  // (accept, satisfy objectives, turn in), never by poking questsDone, so XP,
  // copper, and the signet memento land exactly as a real attunement would.
  // The chain is in prerequisite order; each completion unlocks the next.
  for (const questId of NYTHRAXIS_ATTUNEMENT_QUESTS) {
    sim.completeQuestForDev(questId, pid);
  }
  const [primary, ...altRoles] = CLASS_ROLES[cls];
  const kit = bisKitForRole(cls, primary);
  const equipped = new Set(Object.values(kit));
  // Fresh characters spawn holding a starter weapon: clear both hands first so
  // the kit weapons route to their intended slots (with the mainhand occupied,
  // a one-hand upgrade would auto-route to a dual-wielder's empty OFFHAND and
  // the starter would keep the strong hand).
  sim.unequipItem('mainhand', pid);
  sim.unequipItem('offhand', pid);
  for (const slot of KIT_SLOTS) {
    const itemId = kit[slot];
    if (!itemId) continue;
    sim.addItem(itemId, 1, pid);
    sim.equipItem(itemId, pid);
  }
  // Alternate-role kits ride in the bags (e.g. the shaman spawns in caster
  // gear and carries the enhancement melee kit); pieces the primary kit
  // already wears are not duplicated.
  const bagged = new Set<string>();
  for (const role of altRoles) {
    for (const itemId of Object.values(bisKitForRole(cls, role))) {
      if (!itemId || equipped.has(itemId) || bagged.has(itemId)) continue;
      bagged.add(itemId);
      sim.addItem(itemId, 1, pid);
    }
  }
  // Deliberate extras (see BoostRole.extras) skip the equipped-dedup on
  // purpose: a WORN kit piece may still earn one bagged spare copy (fury's
  // second greatsword). Only an already-bagged copy short-circuits.
  for (const role of CLASS_ROLES[cls]) {
    for (const extraId of role.extras ?? []) {
      if (bagged.has(extraId)) continue;
      bagged.add(extraId);
      sim.addItem(extraId, 1, pid);
    }
  }
  const meta = sim.ctx.resolve(pid)?.meta;
  if (meta) meta.copper += BOOST_COPPER;
  const state = sim.serializeCharacter(pid);
  if (!state) throw new Error('failed to serialize boosted character');
  // Fail loud (caught and logged per class upstream) rather than persist a
  // half-equipped roster if a content change ever breaks an equip silently.
  for (const slot of KIT_SLOTS) {
    const want = kit[slot];
    if (want && state.equipment[slot] !== want) {
      throw new Error(`boost equip failed for ${cls} ${slot}: ${want}`);
    }
  }
  const bags = state.bags ?? [];
  if (bags.length !== BOOST_BAG_SOCKETS || bags.some((b) => b !== bagId)) {
    throw new Error(`boost bag equip failed for ${cls}`);
  }
  for (const questId of NYTHRAXIS_ATTUNEMENT_QUESTS) {
    if (!state.questsDone.includes(questId)) {
      throw new Error(`boost attunement failed for ${cls}: ${questId}`);
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Orchestration: one character per class on the fresh account. Injected deps
// keep the db seam testable; the defaults hit the real characters table.

export type BoostCreateResult = { id: number } | 'name_taken' | null;

export interface BoostDeps {
  /** Insert the character row (null = account at the slot cap: stop). */
  createCharacter(
    accountId: number,
    name: string,
    cls: PlayerClass,
    state: CharacterState,
  ): Promise<BoostCreateResult>;
  /** Persist the level column + state blob (charselect reads the column). */
  saveState(characterId: number, level: number, state: CharacterState): Promise<void>;
  rand?: RandFn;
}

const defaultDeps: BoostDeps = {
  createCharacter: async (accountId, name, cls, state) => {
    try {
      const row = await createCharacterCapped(accountId, name, cls, CHARACTER_LIMIT, state);
      return row ? { id: row.id } : null;
    } catch (err) {
      if (isUniqueViolation(err)) return 'name_taken';
      throw err;
    }
  },
  saveState: (characterId, level, state) => saveCharacterState(characterId, level, state),
};

/**
 * Create the boosted roster for a freshly registered account: one level-20,
 * BiS-geared character per class under a random name. Per-class failures are
 * logged and skipped so one bad apple never blocks the rest; returns how many
 * characters were created.
 */
export async function boostAccountCharacters(
  accountId: number,
  deps: BoostDeps = defaultDeps,
): Promise<number> {
  const rand = deps.rand ?? randomInt;
  const triedNames = new Set<string>();
  let created = 0;
  for (const cls of BOOST_CLASSES) {
    // Yield between world builds so the 20 Hz world loop keeps breathing.
    await new Promise((resolve) => setImmediate(resolve));
    try {
      for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
        const name = randomBoostName(rand);
        if (triedNames.has(name)) continue;
        triedNames.add(name);
        const state = buildBoostedCharacterState(cls, name, rand(BOOST_MAX_SKIN + 1));
        const result = await deps.createCharacter(accountId, name, cls, state);
        if (result === 'name_taken') continue;
        if (result === null) return created;
        await deps.saveState(result.id, BOOST_LEVEL, state);
        created++;
        break;
      }
    } catch (err) {
      logger.error({ err, cls, accountId }, 'pbe boost character creation failed');
    }
  }
  return created;
}
