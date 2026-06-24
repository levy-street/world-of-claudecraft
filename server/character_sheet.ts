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
