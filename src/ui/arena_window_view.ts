// Pure, host-agnostic view model for the Ashen Coliseum (arena) window.
//
// The pure-core half of the pure-core + thin-painter split (root CLAUDE.md
// Conventions; reference market_view.ts / vendor_view.ts). It models the one
// thing the arena window decides that is worth testing without a DOM: which state
// the snapshot is in (offline vs live), the resolved bracket, who can queue, and
// what each ladder / party / action section shows. The DOM/i18n + network side
// lives in arena_window.ts; rendering is driven entirely off the structure here.
//
// The arena is an online ranked feature: `arenaInfo === null` is the offline /
// not-yet-synced state (the painter shows the unavailable note). Otherwise the
// live panel is derived. The offline-vs-online shape difference is exactly the
// silent-online-misrender trap the parity tests exist to catch, so both states are
// fed both a Sim-shaped and a ClientWorld-mirror-shaped stub in the tests.
//
// DOM-free and i18n-free: rows carry the raw class id plus a `knownClass` flag the
// painter localizes (CLASSES is read here only to decide that flag), never the
// resolved display name.

import { CLASSES } from '../sim/data';
import type { PlayerClass } from '../sim/types';
import type { ArenaFormat, ArenaInfo, ArenaStanding, PartyInfo } from '../world_api';

/** The three brackets, in display order. */
const ARENA_BRACKETS: readonly ArenaFormat[] = ['1v1', '2v2', 'fiesta'];

/** One all-time ladder entry as the HUD caches it (server-fetched, online only). */
export interface ArenaAllTimeEntry {
  name: string;
  class: string;
  level: number;
  rating: number;
  wins: number;
  losses: number;
}

/** A live-ladder row: rank + the raw class id (painter localizes when known). */
export interface ArenaLadderRow {
  rank: number;
  me: boolean;
  name: string;
  cls: string;
  /** CLASSES has this id, so the painter resolves a localized class name. */
  knownClass: boolean;
  rating: number;
  wins: number;
  losses: number;
}

/** An all-time ladder row: a ladder row plus the player level the title shows. */
export interface ArenaAllTimeRow extends ArenaLadderRow {
  level: number;
}

/** One bracket tab's state. */
export interface ArenaBracketTab {
  fmt: ArenaFormat;
  active: boolean;
  locked: boolean;
}

/** A 2v2/Fiesta party member row on the pre-queue party panel. */
export interface ArenaPartyMember {
  name: string;
  me: boolean;
  cls: PlayerClass;
  knownClass: boolean;
  level: number;
}

/** The pre-queue party section: hidden, a 2-member roster, or an over-size warn. */
export type ArenaPartySection =
  | { kind: 'none' }
  | { kind: 'members'; members: ArenaPartyMember[] }
  | { kind: 'warn' };

/** The main action affordance for the current state. */
export type ArenaAction =
  | { kind: 'in-match'; oppName: string }
  | { kind: 'queued'; queueSize: number }
  | { kind: 'idle'; queueDisabled: boolean };

/** The full arena view-model: the offline notice, or the live panel. */
export type ArenaView =
  | { kind: 'offline' }
  | {
      kind: 'live';
      /** The resolved bracket (a match/queue forces its bracket). */
      bracket: ArenaFormat;
      /** True when the resolved bracket should be committed as the selection (a
       *  queue/match pins the bracket the painter shows next). */
      commitBracket: boolean;
      canSwitchBracket: boolean;
      standing: ArenaStanding;
      brackets: ArenaBracketTab[];
      isTeamBracket: boolean;
      party: ArenaPartySection;
      action: ArenaAction;
      /** The offline Fiesta-vs-bots practice affordance is available + applicable. */
      practice: boolean;
      ladder: ArenaLadderRow[];
      allTime: ArenaAllTimeRow[] | null;
      /** Identity of the rendered content; the painter skips a rebuild when equal. */
      sig: string;
    };

/** Inputs the painter feeds the builder each render. `selectedBracket` is the
 *  painter's current bracket selection; the builder resolves the actual bracket. */
export interface ArenaViewInput {
  info: ArenaInfo | null;
  selectedBracket: ArenaFormat;
  playerId: number;
  playerName: string;
  party: PartyInfo | null;
  /** The all-time ladder cache, by bracket (painter-owned, server-fetched). */
  allTime: Partial<Record<ArenaFormat, ArenaAllTimeEntry[]>>;
  /** The offline Fiesta practice hook is wired (offline only, hidden online). */
  practiceAvailable: boolean;
}

/**
 * Build the arena view-model. `info === null` is the offline / not-yet-synced
 * state. Otherwise the resolved bracket drives every section. Reads only IWorld-
 * mirrored data (the ArenaInfo snapshot, party, ids) plus the painter-owned
 * all-time cache, so the offline Sim and the online ClientWorld mirror produce
 * identical output.
 */
export function buildArenaView(input: ArenaViewInput): ArenaView {
  const { info: a, selectedBracket, playerId: myPid, playerName, party, allTime } = input;
  if (!a) return { kind: 'offline' };

  const inMatch = a.match !== null;
  const queuedFmt = a.queued ? a.format : null;
  const bracket = a.match?.format ?? queuedFmt ?? selectedBracket;
  const commitBracket = Boolean(queuedFmt || a.match);
  const canSwitchBracket = !a.queued && !inMatch;
  const standing = a.standings[bracket];
  const ladderRows = a.ladders[bracket];
  const partySize = party?.members.length ?? 1;
  const isLeader = !party || party.leader === myPid;
  const isTeamBracket = bracket === '2v2' || bracket === 'fiesta';

  const ladder: ArenaLadderRow[] = ladderRows.map((r, i) => ({
    rank: i + 1,
    me: r.pid === myPid,
    name: r.name,
    cls: r.cls,
    knownClass: Boolean(CLASSES[r.cls]),
    rating: r.rating,
    wins: r.wins,
    losses: r.losses,
  }));

  const brackets: ArenaBracketTab[] = ARENA_BRACKETS.map((fmt) => ({
    fmt,
    active: bracket === fmt,
    locked: !canSwitchBracket && bracket !== fmt,
  }));

  let partySection: ArenaPartySection = { kind: 'none' };
  if (isTeamBracket && !inMatch && !a.queued) {
    if (party && partySize === 2) {
      partySection = {
        kind: 'members',
        members: party.members.map((m) => ({
          name: m.name,
          me: m.pid === myPid,
          cls: m.cls,
          knownClass: Boolean(CLASSES[m.cls]),
          level: m.level,
        })),
      };
    } else if (party && partySize > 2) {
      partySection = { kind: 'warn' };
    }
  }

  let action: ArenaAction;
  if (inMatch) {
    action = { kind: 'in-match', oppName: a.match?.oppName ?? '' };
  } else if (a.queued) {
    action = { kind: 'queued', queueSize: a.queueSize };
  } else {
    let queueDisabled = false;
    if (isTeamBracket && party && partySize === 2 && !isLeader) queueDisabled = true;
    else if (isTeamBracket && party && partySize > 2) queueDisabled = true;
    else if (bracket === '1v1' && party && partySize > 1) queueDisabled = true;
    action = { kind: 'idle', queueDisabled };
  }

  const practice = bracket === 'fiesta' && input.practiceAvailable && !inMatch;

  const allTimeRows = allTime[bracket] ?? null;
  const allTimeView: ArenaAllTimeRow[] | null = allTimeRows
    ? allTimeRows.map((r, i) => ({
        rank: i + 1,
        me: r.name === playerName,
        name: r.name,
        cls: r.class,
        knownClass: Boolean(CLASSES[r.class as PlayerClass]),
        rating: r.rating,
        wins: r.wins,
        losses: r.losses,
        level: r.level,
      }))
    : null;

  // Matches the inline render-skip signature verbatim (raw rows, not derived), so
  // the painter rebuilds the panel exactly when the source data changed.
  const sig = JSON.stringify([
    standing,
    a.queued,
    a.queueSize,
    inMatch,
    ladderRows,
    allTimeRows,
    bracket,
    party,
    canSwitchBracket,
  ]);

  return {
    kind: 'live',
    bracket,
    commitBracket,
    canSwitchBracket,
    standing,
    brackets,
    isTeamBracket,
    party: partySection,
    action,
    practice,
    ladder,
    allTime: allTimeView,
    sig,
  };
}
