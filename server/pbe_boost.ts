// PBE account boost. When the server runs with PBE_BOOST_ACCOUNTS=1:
//
// 1. A freshly registered account is pre-populated with one level-20
//    character per class, each wearing the TRUE best-in-slot PvE kit for its
//    primary role under a random generated name, with four best-in-slot
//    bags, 10 gold of pocket money, every alternate role's kit carried in
//    the bags (tank, healer, and off-dps playstyles included), riding
//    trained, and the Nythraxis attunement quest chain completed, so
//    public-beta testers land straight in endgame testing instead of
//    leveling, farming gear, or re-running the attunement.
// 2. Every EXISTING character is topped up to the same kit once per
//    BOOST_KIT_VERSION at world join (applyBoostKitToPlayer, called from
//    ClaudeGame.join), so a roster created before the boost existed, or
//    before a kit revision, is never stuck in stale gear. Displaced gear
//    and bags land in the (upgraded) bags; nothing is deleted.
//
// "True BiS" spans the whole PvE ladder: dungeon epics, heroic five-man and
// raid drops, the heroic-mark vendor stock, rift clear gear, and the
// legendaries. Only WARFARE (honor vendor) gear is excluded: its stat-light
// PvP budget is exactly what testers should NOT be wearing in PvE (the
// 2026-07-21 S-raid playtest was run in it).
//
// The flag is read live per registration/join (the PERF_TICK_LOG pattern,
// not the boot-time config object) so tests and operators can flip it
// without a restart. NEVER set it in production: it turns every
// registration into a full character roster and re-gears every character.
//
// The character states are built through the real Sim (setPlayerLevel + the
// real equip path + serializeCharacter), never hand-crafted JSONB, so every
// derived field (xp, talents unlocked, known abilities, stats) stays exactly
// consistent with what the game itself would produce.

import { randomInt } from 'node:crypto';
import { BAG_SOCKETS } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import {
  canDualWield,
  canEquipItem,
  canEquipItemInSlot,
  isShieldItem,
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

/** Every grant the boost makes is a SYSTEM SEED, not something the world handed
 *  the player, so none of it counts toward Reliquary obtain tallies (policy
 *  call, 2026-08-08). It mirrors the join-time retro fill, which deliberately
 *  never counts either: a boosted character starts holding gear it did not
 *  earn. Discovery is unaffected, exactly as on every other movement path.
 *
 *  The offline /dev kit (src/sim/dev_kit.ts) deliberately DIFFERS and still
 *  counts: it is ALLOW_DEV_COMMANDS-gated so it cannot reach a real player,
 *  and its DevKitApplyCtx.addItem carries no opts to thread a flag through.
 *  The server `dev_give` command (server/game.ts) is the same family: also
 *  ALLOW_DEV_COMMANDS-gated, also counts, so the two dev arms agree with
 *  each other. The seed policy recorded here is server-boost-only, on
 *  purpose. */
const MOVEMENT = { movement: true } as const;
const BOOST_MAX_SKIN = 7;
// Same fixed world seed the normal creation path uses (initialCharacterState
// in server/main.ts): the builder Sim is a throwaway, never ticked.
const BOOST_SEED = 20061;
// Name draws per class before giving up on that class (collisions are rare;
// the generator space is ~10k combos).
const NAME_ATTEMPTS = 8;

export const BOOST_CLASSES: readonly PlayerClass[] = [
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
// True best-in-slot selection over the whole PvE ladder: dungeon epics, the
// heroic five-man and raid drops, the heroic-mark vendor stock, rift clear
// gear, and the legendaries all compete on the same score. Only WARFARE
// (honor vendor) pieces are excluded: their stat budget is 60 percent PvE
// stats plus dead-in-PvE WARFARE ratings, so they can never be a PvE kit.

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
}

// One kit per DISTINCT gear identity, not per spec: specs that share a gear
// profile share a kit (hunter/rogue/mage/warlock specs all wear their class
// kit; priest shadow/discipline wear the holy kit because the caster cloth
// pool is undifferentiated, a tripwire in the boost test re-checks that;
// shaman restoration wears the elemental kit; druid restoration wears the
// balance kit and feral covers both cat and bear).
export const CLASS_ROLES: Record<PlayerClass, readonly BoostRole[]> = {
  warrior: [
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
    // Ret weights are PURE physical: with the heroic pool open, even a small
    // int/spi weight let the giant heroic healer staff outscore the 2H swords
    // and a retribution paladin spawned holding a resto stick.
    { id: 'retribution', weights: { str: 1, sta: 0.8, agi: 0.2 }, melee: true },
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
  priest: [
    { id: 'holy', weights: { int: 1, spi: 0.8, sta: 0.4 }, melee: false },
    // The heroic/raid cloth pool differentiates healer (spi-heavy) from
    // shadow (sta/int) pieces, so shadow earns its own bagged kit (the old
    // single-kit tripwire fired the moment the heroic pool opened).
    { id: 'shadow', weights: { int: 1, sta: 0.6, spi: 0.1 }, melee: false },
  ],
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
  if (role.tank && isShieldItem(item)) score += (item.blockValue ?? 0) * BLOCK_VALUE_WEIGHT;
  score += ((item.critRating ?? 0) + (item.hasteRating ?? 0)) * RATING_WEIGHT;
  return score;
}

/** The class's PRIMARY (spawn-equipped) role score; kept for the kit tests. */
export function classItemScore(cls: PlayerClass, item: ItemDef): number {
  return roleItemScore(CLASS_ROLES[cls][0], item);
}

function eligibleForBoost(cls: PlayerClass, item: ItemDef): boolean {
  if (!item.slot) return false;
  // Shields are kind 'armor' with shield=true on this branch (isShieldItem).
  if (item.kind !== 'weapon' && item.kind !== 'armor' && item.kind !== 'held_offhand') {
    return false;
  }
  // WARFARE (honor vendor) gear only: PvP-budgeted pieces are never PvE BiS.
  if (item.pvpOffenseRating !== undefined || item.pvpDefenseRating !== undefined) return false;
  if (item.priceHonor !== undefined) return false;
  if (!canEquipItem(cls, item)) return false;
  // canEquipItem checks requiredClass for weapons only; class-locked armor
  // (the tier sets) declares intent through requiredClass too, so honor it.
  if (item.requiredClass && !item.requiredClass.includes(cls)) return false;
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
    if (isShieldItem(item)) shields.push({ id: item.id, score });
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
    // Both hands get the best distinct spec-legal weapons; under Titan's
    // Grip (fury) canEquipItemInSlot admits two-handers in either hand.
    const main = weapons.find((w) => canEquipItemInSlot(cls, ITEMS[w.id], 'mainhand', role.id));
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
export function bisKit(cls: PlayerClass): Partial<Record<EquipSlot, string>> {
  return bisKitForRole(cls, CLASS_ROLES[cls][0]);
}

/** The best bag in the game: strictly the most slots (no tiebreak needed; the
 *  content has a single largest bag, and the test pins its id). */
export function bestBoostBag(): string {
  let best: ItemDef | null = null;
  for (const item of Object.values(ITEMS)) {
    if (item.kind !== 'bag') continue;
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

/** Bump when the kit rules change (new gear pools, new roles) so every
 *  existing character re-kits at its next world join. v2: true BiS across the
 *  whole PvE ladder incl. heroic/raid/rift gear, riding trained. v3: ret
 *  paladin weights go pure physical (the heroic healer staff outscored the
 *  2H swords through the old int/spi weights). */
export const BOOST_KIT_VERSION = 3;

/**
 * Bring one live player up to the current boost kit: level 20, four
 * best-in-game bags, the primary role's true-BiS kit equipped, every
 * alternate role's kit carried in the bags, riding trained, and the
 * Nythraxis attunement completed. Idempotent per BOOST_KIT_VERSION through
 * the persisted meta stamp; returns whether anything was applied. Shared by
 * the fresh-roster builder below and the world-join top-up (server/game.ts),
 * so a character created before the boost existed, or before a kit revision
 * (the PvP-geared pbe2 roster), is re-kitted at its next login. Displaced
 * gear and bags land in the (upgraded) bags; nothing is ever deleted.
 */
export function applyBoostKitToPlayer(sim: Sim, pid: number): boolean {
  const meta = sim.ctx.resolve(pid)?.meta;
  const e = sim.entities.get(pid);
  if (!meta || !e) return false;
  if ((meta.pbeBoostKit ?? 0) >= BOOST_KIT_VERSION) return false;
  const cls = meta.cls;
  if (e.level < BOOST_LEVEL) sim.setPlayerLevel(BOOST_LEVEL, pid);
  // Bags first so the pooled capacity exists before the kits land. Equipping
  // over an occupied socket swaps the old bag into the pool (src/sim/bags.ts)
  // and the boost bag is the largest in the game, so capacity only grows.
  const bagId = bestBoostBag();
  for (let socket = 0; socket < BOOST_BAG_SOCKETS; socket++) {
    if (meta.bags[socket] === bagId) continue;
    sim.addItem(bagId, 1, pid, MOVEMENT);
    sim.equipBag(bagId, socket, pid);
  }
  // Nythraxis attunement: run the chain through the real quest cores (accept,
  // satisfy objectives, turn in), never by poking questsDone, so XP, copper,
  // and the signet memento land exactly as a real attunement would. The chain
  // is in prerequisite order; already-done quests are skipped so a re-kit
  // never double-rewards.
  for (const questId of NYTHRAXIS_ATTUNEMENT_QUESTS) {
    if (!meta.questsDone.has(questId)) sim.completeQuestForDev(questId, pid);
  }
  const [primary, ...altRoles] = CLASS_ROLES[cls];
  const kit = bisKitForRole(cls, primary);
  const equipped = new Set(Object.values(kit));
  // Clear both hands first so the kit weapons route to their intended slots
  // (with the mainhand occupied, a one-hand upgrade would auto-route to a
  // dual-wielder's empty OFFHAND and the old weapon would keep the strong
  // hand). Displaced weapons land in the pool like every other swap.
  sim.unequipItem('mainhand', pid);
  sim.unequipItem('offhand', pid);
  for (const slot of KIT_SLOTS) {
    const itemId = kit[slot];
    if (!itemId || meta.equipment[slot] === itemId) continue;
    if (sim.countItem(itemId, pid) <= 0) sim.addItem(itemId, 1, pid, MOVEMENT);
    sim.equipItem(itemId, pid);
  }
  // Alternate-role kits ride in the bags (e.g. the shaman wears caster gear
  // and carries the enhancement melee kit); pieces the primary kit already
  // wears or the player already owns are not duplicated.
  const bagged = new Set<string>();
  for (const role of altRoles) {
    for (const itemId of Object.values(bisKitForRole(cls, role))) {
      if (!itemId || equipped.has(itemId) || bagged.has(itemId)) continue;
      if (sim.countItem(itemId, pid) > 0) continue;
      bagged.add(itemId);
      sim.addItem(itemId, 1, pid, MOVEMENT);
    }
  }
  // Riding: the mounts overhaul gates every mount on the trained skill; a
  // boost tester never grinds the 80g fee.
  meta.ridingTrained = true;
  meta.pbeBoostKit = BOOST_KIT_VERSION;
  return true;
}

export function buildBoostedCharacterState(
  cls: PlayerClass,
  name: string,
  skin: number,
): CharacterState {
  const sim = new Sim({ seed: BOOST_SEED, playerClass: cls, playerName: name });
  const pid = sim.playerId;
  sim.setPlayerSkin(pid, skin);
  if (!applyBoostKitToPlayer(sim, pid)) {
    throw new Error(`boost kit did not apply for ${cls}`);
  }
  const kit = bisKitForRole(cls, CLASS_ROLES[cls][0]);
  const bagId = bestBoostBag();
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
  saveState: async (characterId, level, state) => {
    await saveCharacterState(characterId, level, state);
  },
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
