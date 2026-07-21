// Pure, host-agnostic view model for the Vale Cup window (docs/prd/vale-cup.md).
//
// The pure-core half of the pure-core + thin-painter split (arena_window_view.ts
// is the direct template). It decides which state the CupInfo snapshot is in
// (offline vs live), resolves the bracket / nation / role selections against the
// queue and match state, derives the queue affordance (join / leave / in-match /
// Groundskeeper lockout), and shapes the live-match panel and winners board. The
// DOM/i18n side lives in vale_cup_window.ts; rendering is driven entirely off the
// structure here.
//
// `cupInfo === null` is the offline / not-yet-synced state (the painter shows the
// unavailable note). The offline-vs-online shape difference is the classic
// silent-online-misrender trap, so the tests feed both a Sim-shaped stub (extra
// junk fields the core must ignore) and a ClientWorld-mirror-shaped stub.
//
// DOM-free and i18n-free: rows carry raw ids (nation/role/bracket) the painter
// localizes; the render-skip sig is text-independent (ids + numbers only).

import { SPORT_ROLES, VC_NATION_IDS } from '../sim/content/vale_cup';
import type { SportRole, VcBracket, VcNationId } from '../sim/types';
import type { CupInfo, PartyInfo } from '../world_api';

/** The five brackets, in display order. */
export const VC_BRACKETS: readonly VcBracket[] = [1, 2, 3, 4, 5];

export interface VcupBracketTab {
  bracket: VcBracket;
  active: boolean;
  locked: boolean;
  /** Fighters currently waiting in this bracket's queue. */
  waiting: number;
}

export interface VcupNationCell {
  id: VcNationId;
  selected: boolean;
  disabled: boolean;
}

export interface VcupRoleRow {
  id: SportRole;
  selected: boolean;
  disabled: boolean;
}

/** Why the queue button is disabled (the painter maps each to a localized note). */
export type VcupQueueBlock = 'nation' | 'party-size' | 'not-leader' | null;

export type VcupAction =
  | { kind: 'in-match' }
  | { kind: 'deserter'; seconds: number }
  | { kind: 'queued'; bracket: VcBracket; position: number; queueSize: number }
  | { kind: 'idle'; queueDisabled: boolean; block: VcupQueueBlock };

export interface VcupLivePanel {
  nationA: VcNationId;
  nationB: VcNationId;
  awayPalette: boolean;
  scoreA: number;
  scoreB: number;
  bracket: VcBracket;
  /** Elapsed match clock, split for the painter's {minutes}:{seconds} key. */
  minutes: number;
  seconds: number;
  /** This live match is my own (the window also shows the in-match action). */
  mine: boolean;
}

export type VcupView =
  | { kind: 'offline' }
  | {
      kind: 'live';
      /** The resolved bracket (a queue or match pins its bracket). */
      bracket: VcBracket;
      /** True when the resolved selections should be committed by the painter. */
      commitSelections: boolean;
      canSwitchBracket: boolean;
      brackets: VcupBracketTab[];
      nations: VcupNationCell[];
      /** The resolved nation (committed pick while queued, else the local pick). */
      nation: VcNationId | null;
      roles: VcupRoleRow[];
      role: SportRole;
      standing: { wins: number; losses: number; draws: number };
      action: VcupAction;
      live: VcupLivePanel | null;
      board: { name: string; wins: number }[];
      /** Guild leaderboard (online guilds by cup wins), best first. */
      guildBoard: { name: string; wins: number; losses: number }[];
      /** The "enter under my guild banner" toggle, present only when it applies. */
      guildEntry: { guildName: string; on: boolean } | null;
      /** My personal cup record earned under a banner (shown by the toggle). */
      guildStanding: { wins: number; losses: number };
      /** Names of players currently in a private practice instance (region indicator). */
      practicing: string[];
      /** The practice-vs-bots affordance is wired and applicable. */
      practice: boolean;
      /** Identity of the rendered content; the painter skips a rebuild when equal. */
      sig: string;
    };

export interface VcupViewInput {
  info: CupInfo | null;
  /** Painter-owned selections (committed picks override while queued/matched). */
  selectedBracket: VcBracket;
  selectedNation: VcNationId | null;
  selectedRole: SportRole;
  playerId: number;
  party: PartyInfo | null;
  /** The offline practice hook is wired (hidden online). */
  practiceAvailable: boolean;
  /** Painter-owned "enter under my guild banner" toggle (ignored if no guild). */
  enterAsGuild: boolean;
}

function splitClock(totalSeconds: number): { minutes: number; seconds: number } {
  const s = Math.max(0, Math.floor(totalSeconds));
  return { minutes: Math.floor(s / 60), seconds: s % 60 };
}

/**
 * Build the Vale Cup view-model. Reads only IWorld-mirrored data (the CupInfo
 * snapshot, party, ids) plus the painter-owned selections, so the offline Sim
 * and the online ClientWorld mirror produce identical output.
 */
export function buildVcupView(input: VcupViewInput): VcupView {
  const { info, playerId, party } = input;
  if (!info) return { kind: 'offline' };

  const inMatch = info.match !== null;
  const queuedBracket = info.queued ? info.bracket : null;
  const matchBracket = info.match ? (bracketOfRoster(info) ?? null) : null;
  const bracket = matchBracket ?? queuedBracket ?? input.selectedBracket;
  const commitSelections = Boolean(queuedBracket || inMatch);
  const canSwitchBracket = !info.queued && !inMatch;

  // Committed picks (while queued) override the painter's local selection.
  const nation = (info.queued ? info.nation : null) ?? input.selectedNation;
  const role = (info.queued || inMatch ? info.role : null) ?? input.selectedRole;

  const brackets: VcupBracketTab[] = VC_BRACKETS.map((b) => ({
    bracket: b,
    active: b === bracket,
    locked: !canSwitchBracket && b !== bracket,
    waiting: info.queueSizes[b] ?? 0,
  }));

  const picksLocked = info.queued || inMatch;
  const nations: VcupNationCell[] = VC_NATION_IDS.map((id) => ({
    id,
    selected: id === nation,
    disabled: picksLocked,
  }));

  // Every role is allowed in every bracket (a 1v1 keeper is a legitimate,
  // if brave, choice); the role stays changeable while waiting in the queue.
  const roles: VcupRoleRow[] = SPORT_ROLES.map((id) => ({
    id,
    selected: id === role,
    disabled: inMatch,
  }));

  const partySize = party?.members.length ?? 1;
  const isLeader = !party || party.leader === playerId;

  let action: VcupAction;
  if (inMatch) {
    action = { kind: 'in-match' };
  } else if (info.deserterFor > 0) {
    action = { kind: 'deserter', seconds: Math.ceil(info.deserterFor) };
  } else if (info.queued && info.bracket !== null) {
    action = {
      kind: 'queued',
      bracket: info.bracket,
      position: info.position,
      queueSize: info.queueSizes[info.bracket] ?? 0,
    };
  } else {
    let block: VcupQueueBlock = null;
    if (nation === null) block = 'nation';
    else if (partySize > bracket) block = 'party-size';
    else if (party && !isLeader) block = 'not-leader';
    action = { kind: 'idle', queueDisabled: block !== null, block };
  }

  let live: VcupLivePanel | null = null;
  if (info.live) {
    const clock = splitClock(info.live.clock);
    live = {
      nationA: info.live.nationA,
      nationB: info.live.nationB,
      awayPalette: info.live.nationA === info.live.nationB,
      scoreA: info.live.scoreA,
      scoreB: info.live.scoreB,
      bracket: info.live.bracket,
      minutes: clock.minutes,
      seconds: clock.seconds,
      mine: info.match !== null && info.match.id === info.live.id,
    };
  }

  const practice = input.practiceAvailable && !inMatch && !info.queued;

  // The guild-banner toggle: offered only when idle (a queued/matched entry is
  // already locked in) and the player is in a guild. Once queued the recorded
  // choice is fixed, so it is not shown again.
  const guildEntry =
    !inMatch && !info.queued && info.myGuild
      ? { guildName: info.myGuild, on: input.enterAsGuild }
      : null;

  // Text-independent identity of the rendered content (raw ids + numbers), so a
  // language switch never moves it and relocalize() can force one rebuild.
  const sig = JSON.stringify([
    info.standing,
    info.queued,
    info.bracket,
    info.position,
    info.queueSizes,
    Math.ceil(info.deserterFor),
    inMatch,
    nation,
    role,
    bracket,
    info.live && [
      info.live.id,
      info.live.scoreA,
      info.live.scoreB,
      info.live.nationA,
      info.live.nationB,
      Math.floor(info.live.clock),
    ],
    info.board,
    info.guildBoard,
    guildEntry,
    info.practicing,
    party && [party.leader, partySize],
    practice,
  ]);

  return {
    kind: 'live',
    bracket,
    commitSelections,
    canSwitchBracket,
    brackets,
    nations,
    nation,
    roles,
    role,
    standing: info.standing,
    action,
    live,
    board: info.board,
    guildBoard: info.guildBoard,
    guildEntry,
    guildStanding: info.guildStanding,
    practicing: info.practicing,
    practice,
    sig,
  };
}

/** My match's bracket = my roster size (max of the two sides for backfilled play). */
function bracketOfRoster(info: CupInfo): VcBracket | null {
  const m = info.match;
  if (!m) return null;
  const size = Math.max(m.teamA.length, m.teamB.length);
  return size >= 1 && size <= 5 ? (size as VcBracket) : null;
}
