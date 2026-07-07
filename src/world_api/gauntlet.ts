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
}
