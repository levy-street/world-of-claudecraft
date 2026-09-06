// ---------------------------------------------------------------------------
// Buddies: cosmetic followers, the declarative catalog.
//
// A buddy has zero GAMEPLAY effect: no stats, no abilities, no combat, no
// riding-skill gate, no summon channel, no stat recompute. It IS a real
// server-simulated owned mob entity (src/sim/content/buddy_mobs.ts's
// MobTemplate per key, spawned/despawned by src/sim/buddies.ts and heeled by
// src/sim/pet/buddy_ai.ts using the same A*-pathed locomotion as a hunter
// pet), which is the "AI" this catalog has: purely locomotion, never combat.
// Collection model mirrors ground mounts (src/sim/content/mounts.ts): every
// catalog buddy is owned while its summon-whistle item (ItemDef kind
// 'buddy') sits in bags or bank, not soulbound, so ownership travels with
// the item. Summoning is an instant identity flip on Entity.buddyKey
// (src/sim/buddies.ts), which every write site pairs with the matching
// entity spawn/despawn.
//
// Used by the authoritative Sim (ownership + the active-buddy flip + the
// entity itself), the renderer (key -> body via the normal per-mob path,
// MOB_KEYS in src/render/characters/manifest.ts keyed on buddyTemplateId),
// and any future HUD picker. Lives in sim/ so it carries no DOM/render
// imports and runs unchanged on the server, offline, and headless.
// ---------------------------------------------------------------------------

export type BuddyKey =
  | 'ember_fox'
  | 'moss_hare'
  | 'frog'
  | 'crimson_claw_crab'
  | 'golden_sentinel'
  | 'nightfang'
  | 'tuskhorn_boar'
  | 'emerald_wolf'
  | 'tiger'
  | 'cate_coin'
  | 'alon'
  | 'trollface'
  | 'ansem'
  | 'triple_t'
  | 'kekius'
  | 'solbot'
  | 'frostfire'
  | 'rocky'
  | 'proud_grunt'
  | 'loot_goblin'
  | 'penny_goldspark'
  | 'stag'
  | 'alpaca'
  | 'bull'
  | 'spider'
  | 'raptor'
  | 'skeleton'
  | 'crystal_lich'
  | 'forgemaw'
  | 'crystal_tide'
  | 'phantom';

/** How the Hunting window groups a companion. Mostly the follower's own mob
 *  family says it (a wolf is a beast), but two groups are editorial and no
 *  creature type carries them: 'elemental' for the rigs that are made of a
 *  substance rather than of flesh, and 'celebrity' for the guest characters,
 *  who are beasts to the sim and something else entirely to a collector.
 *  Authored here rather than forced into MobFamily: bending a sim type to
 *  carry a display label would corrupt it for everything else that reads it. */
export type BuddyKind = 'beast' | 'elemental' | 'humanoid' | 'undead' | 'celebrity';

export interface BuddyDef {
  key: BuddyKey;
  /** Canonical English display name (the HUD localizes via entities.mobs.buddy_<key>.name, src/ui/world_entity_i18n.ts). */
  name: string;
  /** Overrides the family-derived grouping. Absent for every companion the
   *  family already places correctly, which is most of them. */
  kind?: BuddyKind;
}

export const BUDDIES: Record<BuddyKey, BuddyDef> = {
  ember_fox: {
    key: 'ember_fox',
    name: 'Ember Fox',
  },
  moss_hare: {
    key: 'moss_hare',
    name: 'Moss Hare',
  },
  // -- rarity-tiered follower set (whistle quality mirrors BuddyKey rarity
  // in src/sim/content/items.ts) -------------------------------------------
  frog: {
    key: 'frog',
    name: 'Frog',
  },
  crimson_claw_crab: {
    key: 'crimson_claw_crab',
    name: 'Crimson Claw Crab',
  },
  golden_sentinel: {
    key: 'golden_sentinel',
    name: 'Golden Sentinel',
  },
  nightfang: {
    key: 'nightfang',
    name: 'Nightfang',
  },
  tuskhorn_boar: {
    key: 'tuskhorn_boar',
    name: 'Tuskhorn Boar',
  },
  emerald_wolf: {
    key: 'emerald_wolf',
    name: 'Emerald Wolf',
  },
  tiger: {
    key: 'tiger',
    name: 'Tiger',
  },
  // rare
  cate_coin: {
    key: 'cate_coin',
    name: 'Cate Coin',
  },
  // rare
  alon: {
    key: 'alon',
    name: 'Alon',
    kind: 'humanoid',
  },
  trollface: {
    key: 'trollface',
    name: 'Trollface',
    kind: 'celebrity',
  },
  // epic
  ansem: {
    key: 'ansem',
    name: 'Ansem',
    kind: 'celebrity',
  },
  triple_t: {
    key: 'triple_t',
    name: 'Triple T',
    kind: 'celebrity',
  },
  // rare
  kekius: {
    key: 'kekius',
    name: 'Kekius',
    kind: 'celebrity',
  },
  solbot: {
    key: 'solbot',
    name: 'Solbot',
    kind: 'humanoid',
  },
  // uncommon
  frostfire: {
    key: 'frostfire',
    name: 'Frostfire',
    kind: 'elemental',
  },
  rocky: {
    key: 'rocky',
    name: 'Rocky',
    kind: 'elemental',
  },
  // rare, currency vendors only: these three are the first buddies with a
  // named acquisition source that is NOT the global whistle drop (see
  // src/sim/loot/global_drops.ts, where rare and epic sit at chance 0). Proud
  // Grunt comes from the Warfare stores for honor, Loot Goblin from the
  // Heroic Quartermaster for marks, Penny Goldspark from Armorer Hode for
  // gold; all three placements are the Highwatch vendor row in
  // src/sim/content/zone3.ts.
  proud_grunt: {
    key: 'proud_grunt',
    name: 'Proud Grunt',
  },
  loot_goblin: {
    key: 'loot_goblin',
    name: 'Loot Goblin',
  },
  penny_goldspark: {
    key: 'penny_goldspark',
    name: 'Penny Goldspark',
  },
  // common, the shipped beast rigs the roster had not drawn on yet (one buddy
  // per distinct species, so nothing here repeats a body the catalog already
  // has: the fox, hare, frog, crab, boar, wolf and tiger are taken above).
  // Each gets its own buddy-sized VISUALS entry rather than reusing the
  // full-grown mob rig, so a pet stag is a pet, not a mob following you.
  stag: {
    key: 'stag',
    name: 'Stag',
  },
  alpaca: {
    key: 'alpaca',
    name: 'Alpaca',
  },
  bull: {
    key: 'bull',
    name: 'Bull',
  },
  spider: {
    key: 'spider',
    name: 'Spider',
  },
  raptor: {
    key: 'raptor',
    name: 'Raptor',
  },
  // The one undead in the common tier: the KayKit skeleton rig, unarmed.
  skeleton: {
    key: 'skeleton',
    name: 'Skeleton',
  },
  // epic, and the only buddy with a raid source: Nythraxis drops it on both
  // difficulties (src/sim/content/dungeons.ts and content/heroic_loot.ts).
  crystal_lich: {
    key: 'crystal_lich',
    name: 'Crystal Lich',
  },
  // epic, and the only companion gated behind HEROIC difficulty: both
  // Crucible bosses drop it, and neither drops it on Normal
  // (content/heroic_loot.ts, whose tables only roll under a heroic claim).
  forgemaw: {
    key: 'forgemaw',
    name: 'Forgemaw The Molten',
    kind: 'elemental',
  },
  // rare, and the only companion that comes out of the water: a 0.5% share of
  // every landed catch, in any zone (src/sim/professions/fishing.ts, riding
  // the same single draw the catch table rides).
  crystal_tide: {
    key: 'crystal_tide',
    name: 'Crystal Tide',
  },
  // uncommon, on the ordinary green drop: nothing names it, so it rides the
  // global whistle table like every other uncommon (loot/global_drops.ts).
  phantom: {
    key: 'phantom',
    name: 'Phantom',
    kind: 'elemental',
  },
};

/** Catalog order: declaration order. */
export const BUDDY_KEYS = Object.keys(BUDDIES) as readonly BuddyKey[];

export function buddyDef(key: string): BuddyDef | null {
  return (BUDDIES as Record<string, BuddyDef | undefined>)[key] ?? null;
}

/** Coerce a persisted/wire string back to a valid catalog key ('' when
 *  unknown, so a save/wire value from a build that removed a buddy loads
 *  cleanly with none out), mirroring normalizeMountKey. */
export function normalizeBuddyKey(key: string | undefined | null): BuddyKey | '' {
  return key && buddyDef(key) ? (key as BuddyKey) : '';
}
