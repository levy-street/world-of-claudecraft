// Character-sheet normalizer: turns a persisted characters row (+ a couple of
// pre-fetched extras) into the public JSON companion apps consume. PURE — no SQL,
// no IO — so it is trivially unit-testable; the route handlers in main.ts fetch
// the row/guild/rank and call this.
//
// Two visibilities share one normalizer:
//   - 'owner'  → full sheet (stats, vitals, gold, exact position)
//   - 'public' → safe subset (OMITS stats, vitals, gold, exact pos, inventory,
//                quest log) so an unauthenticated lookup never leaks a player's
//                build or whereabouts.
//
// Derived numbers reuse the engine, never re-derive: stats/vitals via
// recalcPlayerStats (through characterDerivedStats), zone via zoneAt, spec via
// the talents specLabel, virtualLevel via the types helper.

import { DEEDS } from '../src/sim/content/deeds';
import {
  computeTalentModifiers,
  emptyAllocation,
  specLabel,
  type TalentAllocation,
  type TalentModifiers,
} from '../src/sim/content/talents';
import { zoneAt } from '../src/sim/data';
import { characterDerivedStats } from '../src/sim/entity';
import type { CharacterState } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { virtualLevel, xpToReachLevel } from '../src/sim/types';
import type { CharacterRow } from './db';

export type SheetVisibility = 'owner' | 'public';

export interface SheetRank {
  scope: 'realm';
  rank: number;
  total: number;
}

export interface CharacterSheetInput {
  row: CharacterRow;
  visibility: SheetVisibility;
  realm: string;
  origin: string; // e.g. https://worldofclaudecraft.com ('' = relative)
  guild: string | null;
  rank: SheetRank | null;
  // The character's latest earned deeds (newest first, already limited),
  // pre-fetched from character_deeds like guild/rank are pre-fetched. Absent
  // means the caller fetched none; the block still builds from the state blob.
  deedsRecent?: SheetDeedRecent[];
  // ISO timestamp for the sheet; defaults to now(). Pass the row's updated_at
  // when available so the field reflects the character, not the request time.
  updatedAt?: string;
}

export interface MoneySplit {
  gold: number;
  silver: number;
  copper: number;
}
export interface SheetStats {
  str: number;
  agi: number;
  sta: number;
  int: number;
  spi: number;
  armor: number;
}
export interface SheetVitals {
  hp: number;
  maxHp: number;
  resource: { type: string; value: number; max: number };
}
export interface SheetArenaBracket {
  rating: number;
  wins: number;
  losses: number;
}
export interface SheetDeedRecent {
  deedId: string;
  // ISO 8601. The owner arm carries the exact character_deeds server-clock
  // stamp; the public arm coarsens it to the UTC day ('YYYY-MM-DD') so an
  // unauthenticated reader cannot infer login/activity timing from it (the
  // owner's own Book shows day granularity too, so public never reveals more
  // than the owner surface does).
  earnedAt: string;
}
/** How many recent deeds the sheet's deeds summary lists. Lives here so every
 *  serving arm (both dispatch paths, both visibilities) shares one bound. */
export const SHEET_RECENT_DEEDS = 5;
// The Book of Deeds summary. Deeds are publicly visible by design (titles and
// Renown are the flex surface), so the block rides both visibilities: renown,
// earned count, and the displayed title come straight from the state blob the
// sheet already loads; recent is the pre-fetched character_deeds strip. The
// two sources are DELIBERATELY allowed to diverge transiently (a returning
// veteran's blob back-credits before the fire-and-forget index rows land);
// do not collapse them into one source.
export interface SheetDeeds {
  renown: number;
  earnedCount: number;
  activeTitle: string | null;
  recent: SheetDeedRecent[];
}

/** English display text for a selected title (sheet.deeds.activeTitle, a deed
 *  id from the state blob), or null when unset, stale/content-drifted, or not
 *  a title reward. English by design: the only consumer is the
 *  English-by-design /c/ SSR page; client surfaces localize the id through
 *  deed_i18n instead, and the JSON sheet keeps carrying the raw id. */
export function sheetTitleText(activeTitle: string | null): string | null {
  if (!activeTitle) return null;
  const reward = DEEDS[activeTitle]?.reward;
  return reward?.kind === 'title' ? reward.text : null;
}

export interface CharacterSheet {
  name: string;
  realm: string;
  class: PlayerClass;
  classLabel: string;
  spec: string | null;
  level: number;
  virtualLevel: number;
  prestigeRank: number;
  skin: number;
  avatarUrl: string;
  zone: string;
  guild: string | null;
  arena: Record<string, SheetArenaBracket>;
  deeds: SheetDeeds;
  rank: SheetRank | null;
  profileUrl: string;
  visibility: SheetVisibility;
  updatedAt: string;
  // owner-only fields (absent on the public variant)
  stats?: SheetStats;
  vitals?: SheetVitals;
  gold?: MoneySplit;
  pos?: { x: number; z: number };
}

const CLASS_LABELS: Record<PlayerClass, string> = {
  warrior: 'Warrior',
  paladin: 'Paladin',
  hunter: 'Hunter',
  rogue: 'Rogue',
  priest: 'Priest',
  shaman: 'Shaman',
  mage: 'Mage',
  warlock: 'Warlock',
  druid: 'Druid',
};

export function splitCopper(copper: number): MoneySplit {
  const c = Math.max(0, Math.floor(copper));
  return { gold: Math.floor(c / 10000), silver: Math.floor(c / 100) % 100, copper: c % 100 };
}

function normalizeAllocation(state: CharacterState): TalentAllocation {
  const a = state.talents;
  if (!a || typeof a !== 'object') return emptyAllocation();
  return {
    spec: typeof a.spec === 'string' ? a.spec : null,
    ranks: a.ranks && typeof a.ranks === 'object' ? a.ranks : {},
    choices: a.choices && typeof a.choices === 'object' ? a.choices : {},
  };
}

function talentMods(cls: PlayerClass, state: CharacterState): TalentModifiers | undefined {
  try {
    return computeTalentModifiers(cls, normalizeAllocation(state));
  } catch {
    return undefined; // never let a malformed allocation break a public read
  }
}

function arenaBrackets(state: CharacterState): Record<string, SheetArenaBracket> {
  const out: Record<string, SheetArenaBracket> = {};
  // Legacy single-rating saves are treated as 1v1 (mirrors serializeCharacter).
  const r1 = state.arena1v1Rating ?? state.arenaRating;
  const w1 = state.arena1v1Wins ?? state.arenaWins;
  const l1 = state.arena1v1Losses ?? state.arenaLosses;
  if (r1 !== undefined || w1 !== undefined || l1 !== undefined) {
    out['1v1'] = { rating: r1 ?? 0, wins: w1 ?? 0, losses: l1 ?? 0 };
  }
  if (
    state.arena2v2Rating !== undefined ||
    state.arena2v2Wins !== undefined ||
    state.arena2v2Losses !== undefined
  ) {
    out['2v2'] = {
      rating: state.arena2v2Rating ?? 0,
      wins: state.arena2v2Wins ?? 0,
      losses: state.arena2v2Losses ?? 0,
    };
  }
  return out;
}

export function characterSheet(input: CharacterSheetInput): CharacterSheet {
  const { row, visibility, realm, origin, guild, rank } = input;
  const cls = row.class as PlayerClass;
  const state: CharacterState = row.state ?? ({} as CharacterState);
  const level = row.level ?? state.level ?? 1;
  const skin = Math.max(0, Math.min(7, Math.floor(state.skin ?? 0)));
  const lifetimeXp = state.lifetimeXp ?? xpToReachLevel(level);
  const copper = state.copper ?? 0;
  const zPos = state.pos?.z ?? 0;

  const base = origin.replace(/\/+$/, '');
  const avatarUrl = `${base}/avatar/${cls}/${skin}.png`;
  const profileUrl = `${base}/c/${encodeURIComponent(row.name)}`;

  const sheet: CharacterSheet = {
    name: row.name,
    realm,
    class: cls,
    classLabel: CLASS_LABELS[cls] ?? cls,
    spec: specLabel(cls, normalizeAllocation(state)),
    level,
    virtualLevel: virtualLevel(lifetimeXp),
    prestigeRank: state.prestigeRank ?? 0,
    skin,
    avatarUrl,
    zone: zoneAt(zPos).name,
    guild: guild ?? null,
    arena: arenaBrackets(state),
    deeds: {
      renown: state.renown ?? 0,
      earnedCount: Object.keys(state.deeds ?? {}).length,
      activeTitle: state.activeTitle ?? null,
      // Hidden deeds are invisible until earned, existence included, so the
      // PUBLIC arm strips them (a third-party viewer who has not earned one
      // must not learn its id here); the owner HAS earned theirs, so the owner
      // arm keeps them, matching the Book's own shelf. The public arm fails
      // CLOSED: it also drops any id with no live DeedDef, because a
      // mixed-version fleet (or a binary rollback) can surface a NEWER hidden
      // deed's descriptive slug through an older process, which a current
      // client would resolve to full name and description. Kept INLINE rather
      // than shared with deeds_records so this db-free module never pulls the
      // deeds-db graph into its import graph (a known partial-mock breakage
      // class), and the rule of three is not yet met. The strip can shorten
      // the fetched window below its limit; hidden earns are rare by design.
      // The public arm also coarsens earnedAt to the UTC day: exact stamps on
      // an unauthenticated surface leak activity timing (see SheetDeedRecent).
      recent:
        visibility === 'public'
          ? (input.deedsRecent ?? [])
              .filter((r) => {
                const def = DEEDS[r.deedId];
                return def !== undefined && def.hidden !== true;
              })
              .map((r) => ({ deedId: r.deedId, earnedAt: r.earnedAt.slice(0, 10) }))
          : (input.deedsRecent ?? []),
    },
    rank: rank ?? null,
    profileUrl,
    visibility,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };

  if (visibility === 'owner') {
    const derived = characterDerivedStats(
      cls,
      level,
      state.equipment ?? {},
      talentMods(cls, state),
      state.equipmentInstance ?? {},
    );
    sheet.stats = { ...derived.stats };
    sheet.vitals = {
      hp: state.hp ?? derived.maxHp,
      maxHp: derived.maxHp,
      resource: {
        type: derived.resourceType ?? 'mana',
        value: state.resource ?? 0,
        max: derived.maxResource,
      },
    };
    sheet.gold = splitCopper(copper);
    sheet.pos = { x: state.pos?.x ?? 0, z: zPos };
  }

  return sheet;
}
