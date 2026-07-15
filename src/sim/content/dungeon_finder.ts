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

import type { DungeonDifficulty, PlayerClass } from '../types';
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
// from this fixed class-capability table. From level 10 on, the selected role
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
  // Display-only lockout summary: heroics and the raid lock daily on the
  // final-boss kill; normal five-mans and the crypt have no lockout.
  lockout: 'none' | 'daily';
}

const FIVE_MAN: FinderComposition = { tank: 1, healer: 1, dps: 3 };
const TEN_RAID: FinderComposition = { tank: 2, healer: 2, dps: 6 };

const HOLLOW_CRYPT_ENCOUNTERS: readonly FinderEncounter[] = [
  { mobId: 'sexton_marrow', mechanics: [] },
  { mobId: 'morthen', final: true, mechanics: ['shadow_pulse'] },
];

const SUNKEN_BASTION_ENCOUNTERS: readonly FinderEncounter[] = [
  { mobId: 'knight_commander_olen', mechanics: ['reaping_arc'] },
  { mobId: 'vael_the_mistcaller', final: true, mechanics: ['mist_surge', 'summons_adds'] },
];

const DROWNED_TEMPLE_ENCOUNTERS: readonly FinderEncounter[] = [
  { mobId: 'choirmother_selthe', mechanics: [] },
  { mobId: 'ysolei', final: true, mechanics: ['lunar_tide', 'summons_adds', 'enrage'] },
];

const GRAVEWYRM_SANCTUM_ENCOUNTERS: readonly FinderEncounter[] = [
  { mobId: 'korgath_the_bound', mechanics: ['shuddering_stomp', 'enrage'] },
  { mobId: 'grand_necromancer_velkhar', mechanics: ['summons_adds'] },
  { mobId: 'korzul_the_gravewyrm', final: true, mechanics: ['necrotic_shockwave', 'enrage'] },
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

const NYTHRAXIS_RAID_ENCOUNTERS: readonly FinderEncounter[] = [
  {
    mobId: 'nythraxis_scourge_of_thornpeak',
    final: true,
    mechanics: ['gravebreaker', 'raise_fallen', 'soul_rend', 'deathless_rage', 'wardstones'],
  },
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
    encounters: HOLLOW_CRYPT_ENCOUNTERS,
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
    encounters: GRAVEWYRM_SANCTUM_ENCOUNTERS,
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
    encounters: NYTHRAXIS_RAID_ENCOUNTERS,
    attunementQuestId: 'q_nythraxis_bound_guardian',
    lockout: 'daily',
  },
];

const ACTIVITY_BY_ID = new Map<string, FinderActivity>(FINDER_ACTIVITIES.map((a) => [a.id, a]));

export function finderActivity(id: string): FinderActivity | null {
  return ACTIVITY_BY_ID.get(id) ?? null;
}
