// Dungeon Finder catalogue: the explicit, declarative activity registry the
// group finder (src/sim/social/dungeon_finder.ts) and its window read. Every
// fact the finder enforces or previews (level ranges, sizes, role splits,
// encounter order, entrances, lockout kind) is authored HERE, never derived
// from spawn lists, mob names, or wiki heuristics (docs/prd/dungeon-finder.md).
// Loot previews are NOT duplicated here: the UI reads the canonical authored
// tables (MOBS[bossId].loot + HEROIC_BOSS_LOOT[bossId]) keyed by the encounter
// ids this file declares.
//
// Data-as-code: plain exported records, no engine logic (content CLAUDE.md).

import { type DungeonDifficulty, NYTHRAXIS_ADDS_ENABLED, type PlayerClass } from '../types';
import type { Role } from './talents';

// Structured listing tags: the only "description" a premade listing carries.
// Free-form listing text is deliberately unsupported (no moderation surface).
export type FinderListingTag = 'first_run' | 'quest_run' | 'full_clear' | 'learning' | 'fast_run';

export const FINDER_LISTING_TAGS: readonly FinderListingTag[] = [
  'first_run',
  'quest_run',
  'full_clear',
  'learning',
  'fast_run',
];

export function isFinderListingTag(value: unknown): value is FinderListingTag {
  return (FINDER_LISTING_TAGS as readonly unknown[]).includes(value);
}

// Stable slot order for deterministic role assignment and display.
export const FINDER_ROLE_ORDER: readonly Role[] = ['tank', 'healer', 'dps'];

export function isFinderRole(value: unknown): value is Role {
  return (FINDER_ROLE_ORDER as readonly unknown[]).includes(value);
}

// Below FIRST_TALENT_LEVEL there is no specialization, so finder roles come
// from this fixed class-capability table. From the spec unlock (FIRST_TALENT_LEVEL) on, the selected role
// must match the active specialization's role instead (see compatibleFinderRoles
// in ../social/dungeon_finder.ts).
export const FINDER_PRE_SPEC_ROLES: Record<Role, readonly PlayerClass[]> = {
  tank: ['warrior', 'paladin', 'druid'],
  healer: ['paladin', 'priest', 'shaman', 'druid'],
  dps: ['warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid'],
};

export type FinderActivityKind = 'dungeon' | 'raid' | 'solo';

export interface FinderComposition {
  tank: number;
  healer: number;
  dps: number;
}

// One boss-like encounter as the finder previews it, in progression order.
// `mobId` keys the MobTemplate (display name via tEntity, loot via MOBS[id].loot,
// heroic loot via HEROIC_BOSS_LOOT[id]); `mechanics` are stable copy keys the
// window localizes as hudChrome.finder.mech.<key>.
export interface FinderEncounter {
  mobId: string;
  final?: boolean;
  // Spawned by a scripted interaction (crypt relics / ritual circle) rather
  // than standing in the spawn list.
  summoned?: boolean;
  mechanics: readonly string[];
}

export interface FinderActivity {
  // Stable activity id: `${dungeonId}_${difficulty}`. This is the wire token
  // clients select by; append-only once shipped.
  id: string;
  dungeonId: string;
  difficulty: DungeonDifficulty;
  kind: FinderActivityKind;
  // Strict finder eligibility band (both ends inclusive). Every queued member,
  // listing member, and applicant must be inside it; this deliberately narrows
  // the physical door rules (which stay unchanged) to keep finder-made groups
  // boost-free.
  minLevel: number;
  maxLevel: number;
  // Total group size the finder forms (also the listing capacity).
  size: number;
  // Exact role split for automatic matching; null = roles are not enforced
  // (the solo attunement crypt's social listings).
  composition: FinderComposition | null;
  // Whether the automatic role queue serves this activity (the solo crypt is
  // listing-only).
  autoQueue: boolean;
  // The dungeon whose OVERWORLD door is the travel target for "Show on Map".
  // The raid arena has no overworld door (it is entered through the Abandoned
  // Crypt), so its entrance points at the crypt.
  entranceDungeonId: string;
  encounters: readonly FinderEncounter[];
  // Display-only: the quest that gates physical entry, when one exists. The
  // finder never enforces attunement (door rules stay authoritative).
  attunementQuestId?: string;
  // Display-only lockout summary: heroics and the Nythraxis arena lock daily
  // on the final-boss kill; the Ignivar raid rooms lock on the WEEKLY reset
  // boundary (WEEKLY_LOCKOUT_RAID_ROOMS in src/sim/instances/dungeons.ts);
  // normal five-mans and the crypt have no lockout.
  lockout: 'none' | 'daily' | 'weekly';
  // Display-only: the extra dungeon ids whose lockouts this activity reads
  // besides `dungeonId`, for a family that locks per boss room (the Ignivar
  // raid's Inner Crucible). The heroic key derives per id the same way.
  lockoutDungeonIds?: readonly string[];
}

const FIVE_MAN: FinderComposition = { tank: 1, healer: 1, dps: 3 };
const TEN_RAID: FinderComposition = { tank: 2, healer: 2, dps: 6 };

const HOLLOW_CRYPT_ENCOUNTERS: readonly FinderEncounter[] = [
  // The rework's route (hollow_crypt.md): two wing bosses, the choir, the ring.
  // The wing bosses' cores are their encounter modules (encounters/hollow_crypt).
  {
    mobId: 'sexton_marrow',
    mechanics: ['crypt_shovelful', 'crypt_measured_for_the_grave', 'crypt_burial_toll'],
  },
  {
    mobId: 'rimeweb',
    mechanics: [
      'crypt_brides_lament',
      'crypt_frozen_embrace',
      'crypt_rime_path',
      'crypt_bridal_freeze',
    ],
  },
  {
    mobId: 'cantor_ilvane',
    mechanics: [
      'crypt_dirge_of_the_hollow',
      'crypt_harmony',
      'crypt_bone_organ',
      'crypt_crescendo',
    ],
  },
  // Morthen's three-act rite (encounters/hollow_crypt/morthen*.ts).
  {
    mobId: 'morthen',
    final: true,
    mechanics: [
      'crypt_morthen_shadow_pulse',
      'crypt_gravecall',
      'crypt_rite_of_the_unquiet',
      'crypt_reap_the_unquiet',
    ],
  },
];

// The heroic tier adds each boss's heroic twists (its own array, so the
// normal preview never carries them); Morthen's line also carries the
// Knellwyrm's heroic Burning Knell (the wyrm has no finder row of its own).
const HOLLOW_CRYPT_ENCOUNTERS_HEROIC: readonly FinderEncounter[] = [
  {
    mobId: 'sexton_marrow',
    mechanics: [...HOLLOW_CRYPT_ENCOUNTERS[0].mechanics, 'crypt_marrow_heroic'],
  },
  {
    mobId: 'rimeweb',
    mechanics: [...HOLLOW_CRYPT_ENCOUNTERS[1].mechanics, 'crypt_lady_heroic'],
  },
  {
    mobId: 'cantor_ilvane',
    mechanics: [...HOLLOW_CRYPT_ENCOUNTERS[2].mechanics, 'crypt_ilvane_heroic'],
  },
  {
    ...HOLLOW_CRYPT_ENCOUNTERS[3],
    mechanics: [...HOLLOW_CRYPT_ENCOUNTERS[3].mechanics, 'crypt_morthen_heroic'],
  },
];

const SUNKEN_BASTION_ENCOUNTERS: readonly FinderEncounter[] = [
  // The rework's route (sunken_bastion.md): the bastion, the gaol (its
  // Turnkey miniboss, then Ossick), the crown.
  {
    mobId: 'knight_commander_olen',
    mechanics: [
      'hallowed_brine',
      'rebounding_bulwark',
      'tide_sentence',
      'unbroken_oath',
      'reaping_arc',
    ],
  },
  { mobId: 'gaol_turnkey', mechanics: ['iron_cage', 'summons_adds'] },
  { mobId: 'gaoler_ossick', mechanics: ['drowned_anchor', 'shackle_pair', 'summons_adds'] },
  {
    mobId: 'vael_the_mistcaller',
    final: true,
    mechanics: ['fog_veil', 'reaper_behind', 'mist_surge', 'summons_adds'],
  },
];

const DROWNED_TEMPLE_ENCOUNTERS: readonly FinderEncounter[] = [
  // The rework's route (drowned_temple.md): the choir, the prism, the altar.
  { mobId: 'choirmother_selthe', mechanics: ['chorus_and_solo'] },
  { mobId: 'tideglass_colossus', mechanics: ['tideglass_reflections'] },
  {
    mobId: 'ysolei',
    final: true,
    mechanics: ['rising_tide', 'undertow', 'lunar_tide', 'summons_adds', 'enrage'],
  },
];

const GRAVEWYRM_SANCTUM_ENCOUNTERS: readonly FinderEncounter[] = [
  {
    mobId: 'korgath_the_bound',
    mechanics: ['seal_shackles', 'chain_strain', 'korgath_stomp', 'enrage'],
  },
  {
    mobId: 'grand_necromancer_velkhar',
    mechanics: [
      'waking_thaw',
      'summons_adds',
      'unquenched_held',
      'soulfire_trench',
      'shadow_volley',
    ],
  },
  {
    mobId: 'korzul_the_gravewyrm',
    final: true,
    mechanics: ['grave_inferno', 'enrage', 'grave_breath', 'plate_floor', 'wyrm_flights'],
  },
];

// The heroic tier adds each boss's heroic twists (its own array, so the normal
// preview never carries them).
const GRAVEWYRM_SANCTUM_ENCOUNTERS_HEROIC: readonly FinderEncounter[] = [
  {
    mobId: 'korgath_the_bound',
    mechanics: [...GRAVEWYRM_SANCTUM_ENCOUNTERS[0].mechanics, 'rerivet_last_link'],
  },
  {
    mobId: 'grand_necromancer_velkhar',
    mechanics: [...GRAVEWYRM_SANCTUM_ENCOUNTERS[1].mechanics, 'warm_hands_twice_woken'],
  },
  GRAVEWYRM_SANCTUM_ENCOUNTERS[2],
];

const NYTHRAXIS_CRYPT_ENCOUNTERS: readonly FinderEncounter[] = [
  { mobId: 'fallen_captain_aldren', summoned: true, mechanics: ['grave_cleaver'] },
  {
    mobId: 'corrupted_priest_malric',
    summoned: true,
    mechanics: ['shadow_nova', 'profane_mending', 'mana_burn'],
  },
  {
    mobId: 'deathstalker_voss',
    summoned: true,
    mechanics: ['deathstalker_cleave', 'mortal_wound'],
  },
  {
    mobId: 'bound_guardian',
    final: true,
    summoned: true,
    mechanics: ['sealbreak_shockwave', 'summons_adds', 'enrage'],
  },
];

// Every Nythraxis mechanic runs on both difficulties (heroic raises counts and
// damage, see src/sim/encounters/nythraxis.ts); the heroic tier's one addition
// is the court (Aldren, Malric, Voss) that rises after Deathless Rage.
const NYTHRAXIS_RAID_MECHANICS: readonly string[] = [
  'gravebreaker',
  'dread_curse',
  'bone_spike',
  'grave_eruption',
  'binding_sigil',
  // The guard waves and the heroic court ride NYTHRAXIS_ADDS_ENABLED with the
  // encounter, so the finder never advertises adds the fight does not field.
  ...(NYTHRAXIS_ADDS_ENABLED ? ['raise_fallen'] : []),
  'soul_rend',
  'deathless_rage',
  'wardstones',
  'kings_wrath',
  'bone_storm',
  'crown_endures',
];

const NYTHRAXIS_RAID_ENCOUNTERS: readonly FinderEncounter[] = [
  {
    mobId: 'nythraxis_scourge_of_thornpeak',
    final: true,
    mechanics: [...NYTHRAXIS_RAID_MECHANICS],
  },
];

// Its own array, not a mutation of the normal-tier list, so a heroic-only
// entry (the court) never leaks into the normal-tier preview.
const NYTHRAXIS_RAID_ENCOUNTERS_HEROIC: readonly FinderEncounter[] = [
  {
    mobId: 'nythraxis_scourge_of_thornpeak',
    final: true,
    mechanics: [
      ...NYTHRAXIS_RAID_MECHANICS,
      ...(NYTHRAXIS_ADDS_ENABLED ? ['deathless_court'] : []),
    ],
  },
];

// The Wildheart Basin rework (docs/design/dungeon-rework/wildheart_basin.md
// section 5): the three boss cores replace the old trash rows; heroic adds each
// boss's twists (its own array, so the normal preview never carries them).
const WILDHEART_BASIN_ENCOUNTERS: readonly FinderEncounter[] = [
  {
    mobId: 'wildheart_beastmaster',
    mechanics: ['pack_bond', 'stalk', 'shared_health', 'beast_pit_quake'],
  },
  {
    mobId: 'the_gorgebloom',
    mechanics: ['seed_rain', 'pollinate', 'vine_lash', 'gorge'],
  },
  {
    mobId: 'wildheart_high_priest',
    final: true,
    mechanics: ['spirit_of_the_hunt', 'wildheart_pulse', 'jaguar_roar', 'enrage'],
  },
];

const WILDHEART_BASIN_ENCOUNTERS_HEROIC: readonly FinderEncounter[] = [
  {
    mobId: 'wildheart_beastmaster',
    mechanics: [...WILDHEART_BASIN_ENCOUNTERS[0].mechanics, 'heel_frenzied_bond'],
  },
  {
    mobId: 'the_gorgebloom',
    mechanics: [...WILDHEART_BASIN_ENCOUNTERS[1].mechanics, 'burrowing_seeds'],
  },
  {
    mobId: 'wildheart_high_priest',
    final: true,
    mechanics: [...WILDHEART_BASIN_ENCOUNTERS[2].mechanics, 'twin_prey_ambush'],
  },
];

// The Crucible of the Last Spring raid (docs/prd/ignivar-raid.md): two boss
// rooms in one four-room instance family. Ignivar holds the Crucible arena,
// Varkhul the Inner Crucible behind the Molten Assembly; the approach and
// assembly trash rooms carry no finder encounter of their own.
const IGNIVAR_RAID_ENCOUNTERS: readonly FinderEncounter[] = [
  {
    mobId: 'ignivar_herald_of_the_last_flame',
    mechanics: [
      'brand_of_the_pyre',
      'forge_strike',
      'rain_of_cinders',
      'falling_cinders',
      'revolving_inferno',
      'forge_wave',
      'apocalypse_add',
      'judgment_of_the_forge',
      'last_inferno',
    ],
  },
  {
    mobId: 'varkhul_forgefather_of_the_last_flame',
    final: true,
    mechanics: [
      'makers_brand',
      'forgefathers_sweep',
      'tempering_ray',
      'cinder_orbs',
      'forgestorm',
      'shared_pyre',
      'anvils_decree',
      'masters_assembly',
    ],
  },
];

// Heroic adds Chains of the Forge (src/sim/ignivar_forge_chains.ts) to
// Ignivar; its own array, like the Nythraxis heroic list, so the normal-tier
// preview never carries a heroic-only mechanic.
const IGNIVAR_RAID_ENCOUNTERS_HEROIC: readonly FinderEncounter[] = [
  {
    mobId: 'ignivar_herald_of_the_last_flame',
    mechanics: [...IGNIVAR_RAID_ENCOUNTERS[0].mechanics, 'chains_of_the_forge'],
  },
  IGNIVAR_RAID_ENCOUNTERS[1],
];

export const FINDER_ACTIVITIES: readonly FinderActivity[] = [
  {
    id: 'hollow_crypt_normal',
    dungeonId: 'hollow_crypt',
    difficulty: 'normal',
    kind: 'dungeon',
    minLevel: 7,
    maxLevel: 10,
    size: 5,
    composition: FIVE_MAN,
    autoQueue: true,
    entranceDungeonId: 'hollow_crypt',
    encounters: HOLLOW_CRYPT_ENCOUNTERS,
    lockout: 'none',
  },
  {
    id: 'sunken_bastion_normal',
    dungeonId: 'sunken_bastion',
    difficulty: 'normal',
    kind: 'dungeon',
    minLevel: 12,
    maxLevel: 13,
    size: 5,
    composition: FIVE_MAN,
    autoQueue: true,
    entranceDungeonId: 'sunken_bastion',
    encounters: SUNKEN_BASTION_ENCOUNTERS,
    lockout: 'none',
  },
  {
    id: 'drowned_temple_normal',
    dungeonId: 'drowned_temple',
    difficulty: 'normal',
    kind: 'dungeon',
    minLevel: 16,
    maxLevel: 18,
    size: 5,
    composition: FIVE_MAN,
    autoQueue: true,
    entranceDungeonId: 'drowned_temple',
    encounters: DROWNED_TEMPLE_ENCOUNTERS,
    lockout: 'none',
  },
  {
    id: 'gravewyrm_sanctum_normal',
    dungeonId: 'gravewyrm_sanctum',
    difficulty: 'normal',
    kind: 'dungeon',
    minLevel: 19,
    maxLevel: 20,
    size: 5,
    composition: FIVE_MAN,
    autoQueue: true,
    entranceDungeonId: 'gravewyrm_sanctum',
    encounters: GRAVEWYRM_SANCTUM_ENCOUNTERS,
    lockout: 'none',
  },
  {
    id: 'hollow_crypt_heroic',
    dungeonId: 'hollow_crypt',
    difficulty: 'heroic',
    kind: 'dungeon',
    minLevel: 20,
    maxLevel: 20,
    size: 5,
    composition: FIVE_MAN,
    autoQueue: true,
    entranceDungeonId: 'hollow_crypt',
    encounters: HOLLOW_CRYPT_ENCOUNTERS_HEROIC,
    lockout: 'daily',
  },
  {
    id: 'sunken_bastion_heroic',
    dungeonId: 'sunken_bastion',
    difficulty: 'heroic',
    kind: 'dungeon',
    minLevel: 20,
    maxLevel: 20,
    size: 5,
    composition: FIVE_MAN,
    autoQueue: true,
    entranceDungeonId: 'sunken_bastion',
    encounters: SUNKEN_BASTION_ENCOUNTERS,
    lockout: 'daily',
  },
  {
    id: 'drowned_temple_heroic',
    dungeonId: 'drowned_temple',
    difficulty: 'heroic',
    kind: 'dungeon',
    minLevel: 20,
    maxLevel: 20,
    size: 5,
    composition: FIVE_MAN,
    autoQueue: true,
    entranceDungeonId: 'drowned_temple',
    encounters: DROWNED_TEMPLE_ENCOUNTERS,
    lockout: 'daily',
  },
  {
    id: 'gravewyrm_sanctum_heroic',
    dungeonId: 'gravewyrm_sanctum',
    difficulty: 'heroic',
    kind: 'dungeon',
    minLevel: 20,
    maxLevel: 20,
    size: 5,
    composition: FIVE_MAN,
    autoQueue: true,
    entranceDungeonId: 'gravewyrm_sanctum',
    encounters: GRAVEWYRM_SANCTUM_ENCOUNTERS_HEROIC,
    lockout: 'daily',
  },
  {
    id: 'wildheart_basin_normal',
    dungeonId: 'wildheart_basin',
    difficulty: 'normal',
    kind: 'dungeon',
    minLevel: 20,
    maxLevel: 20,
    size: 5,
    composition: FIVE_MAN,
    autoQueue: true,
    entranceDungeonId: 'wildheart_basin',
    encounters: WILDHEART_BASIN_ENCOUNTERS,
    lockout: 'none',
  },
  {
    id: 'wildheart_basin_heroic',
    dungeonId: 'wildheart_basin',
    difficulty: 'heroic',
    kind: 'dungeon',
    minLevel: 20,
    maxLevel: 20,
    size: 5,
    composition: FIVE_MAN,
    autoQueue: true,
    entranceDungeonId: 'wildheart_basin',
    encounters: WILDHEART_BASIN_ENCOUNTERS_HEROIC,
    lockout: 'daily',
  },
  {
    // The solo attunement instance: catalogued for discovery and social
    // listings (up to five may group for it), but never role-queued.
    id: 'nythraxis_crypt_normal',
    dungeonId: 'nythraxis_crypt',
    difficulty: 'normal',
    kind: 'solo',
    minLevel: 20,
    maxLevel: 20,
    size: 5,
    composition: null,
    autoQueue: false,
    entranceDungeonId: 'nythraxis_crypt',
    encounters: NYTHRAXIS_CRYPT_ENCOUNTERS,
    lockout: 'none',
  },
  {
    id: 'nythraxis_boss_arena_normal',
    dungeonId: 'nythraxis_boss_arena',
    difficulty: 'normal',
    kind: 'raid',
    minLevel: 20,
    maxLevel: 20,
    size: 10,
    composition: TEN_RAID,
    autoQueue: true,
    entranceDungeonId: 'nythraxis_crypt',
    encounters: NYTHRAXIS_RAID_ENCOUNTERS,
    attunementQuestId: 'q_nythraxis_bound_guardian',
    lockout: 'daily',
  },
  {
    id: 'nythraxis_boss_arena_heroic',
    dungeonId: 'nythraxis_boss_arena',
    difficulty: 'heroic',
    kind: 'raid',
    minLevel: 20,
    maxLevel: 20,
    size: 10,
    composition: TEN_RAID,
    autoQueue: true,
    entranceDungeonId: 'nythraxis_crypt',
    encounters: NYTHRAXIS_RAID_ENCOUNTERS_HEROIC,
    attunementQuestId: 'q_nythraxis_bound_guardian',
    lockout: 'daily',
  },
  {
    // The Ignivar raid family is entered through the Forge-Lift (the keep
    // tower door on Forgefather's Isle); the activity is keyed on the Crucible
    // arena, whose lockout id is the family's first boss room.
    id: 'ignivar_raid_arena_normal',
    dungeonId: 'ignivar_raid_arena',
    difficulty: 'normal',
    kind: 'raid',
    minLevel: 20,
    maxLevel: 20,
    size: 10,
    composition: TEN_RAID,
    autoQueue: true,
    entranceDungeonId: 'ignivar_forge_lift',
    encounters: IGNIVAR_RAID_ENCOUNTERS,
    lockout: 'weekly',
    lockoutDungeonIds: ['ignivar_inner_crucible'],
  },
  {
    id: 'ignivar_raid_arena_heroic',
    dungeonId: 'ignivar_raid_arena',
    difficulty: 'heroic',
    kind: 'raid',
    minLevel: 20,
    maxLevel: 20,
    size: 10,
    composition: TEN_RAID,
    autoQueue: true,
    entranceDungeonId: 'ignivar_forge_lift',
    encounters: IGNIVAR_RAID_ENCOUNTERS_HEROIC,
    lockout: 'weekly',
    lockoutDungeonIds: ['ignivar_inner_crucible'],
  },
];

const ACTIVITY_BY_ID = new Map<string, FinderActivity>(FINDER_ACTIVITIES.map((a) => [a.id, a]));

export function finderActivity(id: string): FinderActivity | null {
  return ACTIVITY_BY_ID.get(id) ?? null;
}
