// IWorldGauntlet: The Gauntlet survival event surface. The view type lives in
// sim/types.ts (the sim builds it; the facet re-exports it so downstream
// imports stay on the world_api path).

import type { GauntletRunView } from '../sim/types';

export type { GauntletRunView } from '../sim/types';

export interface IWorldGauntlet {
  // The event window: true while the recruiter stands in the town square and
  // gauntletJoin is accepted. Offline mirrors the Sim's host-fed flag; online
  // it rides the `gopen` self-wire key.
  gauntletOpen: boolean;
  // The viewer's live run (lobby through podium), or null outside one. Online
  // this mirrors the `grun` self-wire key; deadlines inside are absolute
  // sim-time, so countdowns derive from `time` client-side.
  gauntletRun: GauntletRunView | null;
  // Join the filling lobby (server-gated to the recruiter's presence and
  // radius); leave the lobby, forfeit a live run, or exit the spectator seats.
  gauntletJoin(): void;
  gauntletLeave(): void;
  // Trial inputs, all validated sim-side against the viewer's LIVE trial (a
  // stale send after a knockout or phase flip drops silently).
  // Sigils: a batch of quantized shape-local trace points, [x0,y0,x1,y1,...].
  gauntletTrace(pts: number[]): void;
  // Pull: claim a beat index (derived client-side from the wire's anchor).
  gauntletPull(beat: number): void;
  // Wager: 'hold' (hide n marbles), 'guess' (n = 1 odd / 0 even), 'wager'
  // (stake n on the round).
  gauntletWager(action: 'hold' | 'guess' | 'wager', n: number): void;
  // Court: throw a shove (resolves in contact range, on cooldown).
  gauntletCourt(): void;
}
