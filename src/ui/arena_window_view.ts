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
import type { ArenaMapId } from '../sim/dungeon_layout';
import { ARENA_MIN_LEVEL } from '../sim/social/arena';
import type { PlayerClass } from '../sim/types';
import type { ArenaFormat, ArenaInfo, ArenaStanding, PartyInfo } from '../world_api';

/** Premade-party cap per team bracket (1v1 is partyless). */
function bracketTeamCap(fmt: ArenaFormat): number {
  return fmt === 'yumi5' ? 5 : fmt === 'yumi3' ? 3 : fmt === '2v2' || fmt === 'fiesta' ? 2 : 1;
}

/** One all-time ladder entry as the HUD caches it (server-fetched, online only). */
export interface ArenaAllTimeEntry {
  name: string;
  class: string;
  level: number;
  rating: number;
  wins: number;
  losses: number;
  /** Absent on a board served by a realm that predates the W-L-D
   *  change, so the consumer defaults it rather than rendering NaN. */
  draws?: number;
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
  /** Matches that ended level, the third figure of the W-L-D record. */
  draws: number;
}

/** An all-time ladder row: a ladder row plus the player level the title shows. */
export interface ArenaAllTimeRow extends ArenaLadderRow {
  level: number;
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
  | {
      kind: 'idle';
      queueDisabled: boolean;
      /** Ranked (1v1/2v2) only: the player is below ARENA_MIN_LEVEL, so the
       *  painter shows the level requirement instead of the generic queue note. */
      belowMinLevel: boolean;
    };

/** The full arena view-model: the offline notice, or the live panel. */
export type ArenaView =
  | { kind: 'offline' }
  | {
      kind: 'live';
      /** The resolved bracket (a match/queue forces its bracket). */
      bracket: ArenaFormat;
      standing: ArenaStanding;
      isTeamBracket: boolean;
      party: ArenaPartySection;
      action: ArenaAction;
      /** The fixed map of the live bout's slot; null outside a match and for
       *  the Protect Yumi brackets (their maze band has no arena map). */
      matchMap: ArenaMapId | null;
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
  /** The local character's level, checked against ARENA_MIN_LEVEL for the
   *  ranked (1v1/2v2) brackets; Fiesta and Protect Yumi need no floor. */
  playerLevel: number;
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
  // The resolved bracket (a match/queue forces its own); the merged PvP strip
  // (pvp_tabs_view.ts) owns tab pinning and locking, fed by the same snapshot.
  const bracket = a.match?.format ?? queuedFmt ?? selectedBracket;
  const canSwitchBracket = !a.queued && !inMatch;
  // Defaulted HERE rather than at each reader: `standings` is mirrored straight
  // off the server snapshot, so a client talking to a server that predates the
  // draws field would otherwise render NaN in the rating-summary line. Every
  // other draws consumer in this file already defaults; this is the one that
  // reaches painters through `view.standing`, so one site covers them all.
  const rawStanding = a.standings[bracket];
  const standing = { ...rawStanding, draws: rawStanding.draws ?? 0 };
  const ladderRows = a.ladders[bracket];
  const partySize = party?.members.length ?? 1;
  const isLeader = !party || party.leader === myPid;
  const teamCap = bracketTeamCap(bracket);
  const isTeamBracket = teamCap > 1;

  const ladder: ArenaLadderRow[] = ladderRows.map((r, i) => ({
    rank: i + 1,
    me: r.pid === myPid,
    name: r.name,
    cls: r.cls,
    knownClass: Boolean(CLASSES[r.cls]),
    rating: r.rating,
    wins: r.wins,
    losses: r.losses,
    // `?? 0` for the rolling-deploy reason the map guard below records: a
    // snapshot from a server predating this field carries no draws, and an
    // undefined would render as NaN in the W-L-D record.
    draws: r.draws ?? 0,
  }));

  let partySection: ArenaPartySection = { kind: 'none' };
  if (isTeamBracket && !inMatch && !a.queued) {
    if (party && partySize >= 2 && partySize <= teamCap) {
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
    } else if (party && partySize > teamCap) {
      partySection = { kind: 'warn' };
    }
  }

  let action: ArenaAction;
  if (inMatch) {
    action = { kind: 'in-match', oppName: a.match?.oppName ?? '' };
  } else if (a.queued) {
    action = { kind: 'queued', queueSize: a.queueSize };
  } else {
    // 2v2 is a premade queue: the server rejects the whole team if any queued
    // member is below the floor, so a level-eligible leader with a below-level
    // teammate must see the same disabled affordance, not just their own level.
    const partyBelowMinLevel =
      bracket === '2v2' && isTeamBracket && party && partySize >= 2 && partySize <= teamCap
        ? party.members.some((m) => m.level < ARENA_MIN_LEVEL)
        : false;
    const belowMinLevel =
      ((bracket === '1v1' || bracket === '2v2') && input.playerLevel < ARENA_MIN_LEVEL) ||
      partyBelowMinLevel;
    let queueDisabled = belowMinLevel;
    if (isTeamBracket && party && partySize >= 2 && partySize <= teamCap && !isLeader)
      queueDisabled = true;
    else if (isTeamBracket && party && partySize > teamCap) queueDisabled = true;
    else if (bracket === '1v1' && party && partySize > 1) queueDisabled = true;
    action = { kind: 'idle', queueDisabled, belowMinLevel };
  }

  // The bout's map, shown from queue pop (countdown) through the aftermath;
  // yumi brackets play in their own maze band, so no map row for them. The
  // `?? null` guards a mirrored snapshot from an older server without the
  // field (the row simply stays hidden).
  const matchMap =
    a.match && a.match.format !== 'yumi3' && a.match.format !== 'yumi5'
      ? (a.match.map ?? null)
      : null;

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
        draws: r.draws ?? 0,
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
    matchMap,
    ladderRows,
    allTimeRows,
    bracket,
    party,
    canSwitchBracket,
    input.playerLevel,
  ]);

  return {
    kind: 'live',
    bracket,
    standing,
    isTeamBracket,
    party: partySection,
    action,
    matchMap,
    ladder,
    allTime: allTimeView,
    sig,
  };
}
