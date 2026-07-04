// Pure, host-agnostic view model for the Battlegrounds (Gravemarch) window.
//
// The pure-core half of the pure-core + thin-painter split, cloned
// structurally from arena_window_view.ts. It models what the window decides
// that is worth testing without a DOM: which state the snapshot is in
// (offline-unsynced vs live), who may queue (party leadership + size, the
// Deserter's Knell), what the queue/action section shows, the live-match Watch
// list, the online ladder rows, and the spectate affordance. The DOM/i18n side
// lives in battleground_window.ts.
//
// `bgInfo === null` is the online not-yet-synced state (the offline Sim
// returns a real object, so offline players see the live panel with the
// Practice affordance). The offline-vs-online shape trap is why the tests feed
// both a Sim-shaped and a ClientWorld-mirror-shaped stub.
//
// DOM-free and i18n-free: rows carry raw class ids plus a `knownClass` flag
// the painter localizes, and raw seconds the painter formats.

import { CLASSES } from '../sim/data';
import type { PlayerClass } from '../sim/types';
import type { BgInfo, BgStanding, PartyInfo } from '../world_api';

/** 5v5: the largest party the leader may queue. */
export const BG_MAX_PARTY = 5;

/** An online ladder row (rated players online, best first). */
export interface BgLadderRow {
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

/** One live match in the Watch list. */
export interface BgLiveRow {
  id: number;
  elapsed: number;
  killsA: number;
  killsB: number;
  players: number;
  /** Watching THIS match right now (the row shows Stop watching instead). */
  watching: boolean;
  /** Watch is offered (not in a match, not queued, not already spectating). */
  canWatch: boolean;
}

/** The main action affordance for the current state. */
export type BgAction =
  | { kind: 'in-match' }
  | { kind: 'queued'; position: number; waitSec: number; queueSize: number }
  | { kind: 'deserter'; seconds: number }
  | { kind: 'idle'; queueDisabled: boolean; partySize: number; isLeader: boolean };

/** The full battleground view-model: the offline notice, or the live panel. */
export type BgWindowView =
  | { kind: 'offline' }
  | {
      kind: 'live';
      standing: BgStanding;
      action: BgAction;
      /** Spectating a match: the window offers Stop watching. */
      spectating: number | null;
      liveMatches: BgLiveRow[];
      ladder: BgLadderRow[];
      /** The offline vs-bots Practice affordance is wired + applicable. */
      practice: boolean;
      /** Identity of the rendered content; the painter skips a rebuild when equal. */
      sig: string;
    };

/** Inputs the painter feeds the builder each render. */
export interface BgWindowViewInput {
  info: BgInfo | null;
  playerId: number;
  party: PartyInfo | null;
  /** The offline Practice hook is wired (offline only, hidden online). */
  practiceAvailable: boolean;
}

/**
 * Build the battleground window view-model. Reads only IWorld-mirrored data
 * (the BgInfo snapshot, party, ids), so the offline Sim and the online
 * ClientWorld mirror produce identical output.
 */
export function buildBgWindowView(input: BgWindowViewInput): BgWindowView {
  const { info, playerId: myPid, party } = input;
  if (!info) return { kind: 'offline' };

  const inMatch = info.match !== null;
  const partySize = party?.members.length ?? 1;
  const isLeader = !party || party.leader === myPid;

  let action: BgAction;
  if (inMatch) {
    action = { kind: 'in-match' };
  } else if (info.queued) {
    action = {
      kind: 'queued',
      position: info.position,
      waitSec: info.waitSec,
      queueSize: info.queueSize,
    };
  } else if (info.deserterFor > 0) {
    action = { kind: 'deserter', seconds: info.deserterFor };
  } else {
    // The leader queues the party (solo counts as a party of one); an
    // over-size party cannot queue at all. Spectators must stop watching first.
    const queueDisabled = !isLeader || partySize > BG_MAX_PARTY || info.spectating !== null;
    action = { kind: 'idle', queueDisabled, partySize, isLeader };
  }

  const canWatch = !inMatch && !info.queued && info.spectating === null;
  const liveMatches: BgLiveRow[] = info.liveMatches.map((m) => ({
    id: m.id,
    elapsed: m.elapsed,
    killsA: m.killsA,
    killsB: m.killsB,
    players: m.players,
    watching: info.spectating === m.id,
    canWatch,
  }));

  const ladder: BgLadderRow[] = info.ladder.map((r, i) => ({
    rank: i + 1,
    me: r.pid === myPid,
    name: r.name,
    cls: r.cls,
    knownClass: Boolean(CLASSES[r.cls as PlayerClass]),
    rating: r.rating,
    wins: r.wins,
    losses: r.losses,
  }));

  const practice = input.practiceAvailable && !inMatch && !info.queued;

  // Text-independent render-skip signature (raw source rows, ids + numbers).
  const sig = JSON.stringify([
    info.standing,
    action,
    info.spectating,
    info.liveMatches,
    info.ladder,
    practice,
  ]);

  return {
    kind: 'live',
    standing: info.standing,
    action,
    spectating: info.spectating,
    liveMatches,
    ladder,
    practice,
    sig,
  };
}
