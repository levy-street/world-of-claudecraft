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
  // The viewer's live run (lobby through podium), or null outside one. A
  // free-roaming spectator gets the watched run's board here too. Online this
  // mirrors the `grun` self-wire key; deadlines inside are absolute sim-time, so
  // countdowns derive from `time` client-side.
  gauntletRun: GauntletRunView | null;
  // The viewer's 1-based place in the rolling queue (0 = not queued), and whether
  // they are currently free-roaming as a spectator. Online these mirror the `gq`
  // and `gsp` self-wire keys.
  gauntletQueuePosition: number;
  gauntletSpectating: boolean;
  // The instant walk-up join (offline + tests): join the filling lobby directly.
  // The player-facing "Join Queue" button online is gauntletQueueJoin.
  gauntletJoin(): void;
  // The three rolling-event join modes (all server-gated to the recruiter's
  // presence and radius; Practice ignores the event window). Join the fair FIFO
  // queue; drop into the stands as a free spectator; start an instant solo run vs
  // NPC bots; or, from the podium, rejoin the queue at the BACK.
  gauntletQueueJoin(): void;
  gauntletSpectate(): void;
  gauntletPractice(): void;
  gauntletRejoin(): void;
  // Leave whatever gauntlet state the player is in: dequeue, stop spectating,
  // withdraw from the lobby, forfeit a live run, or exit the podium.
  gauntletLeave(): void;
  // Trial inputs, all validated sim-side against the viewer's LIVE trial (a
  // stale send after a knockout or phase flip drops silently).
  // Sigils: a batch of quantized shape-local trace points, [x0,y0,x1,y1,...].
  gauntletTrace(pts: number[]): void;
  // Pull: click the viewer's live shrinking circle by id (graded sim-side by
  // the size at receipt; a stale id after a resolve drops silently).
  gauntletPullCircle(id: number): void;
  // Echo: tap a rune stone (0..stones-1) during the answer window.
  gauntletEcho(stone: number): void;
  // The Final Court is plain vanilla combat: no command. The player targets a foe
  // (click or tab), auto-attacks, and casts abilities as in the open world; the
  // server resolves the swings on the shared hp pool.
}

// True while the viewer is fighting the live Final Court (a standard-combat
// free-for-all, the last trial in the run). The client uses this so every live
// fellow contestant reads as a foe: the attack cursor, right-click-to-engage, and
// the red selection reticle, exactly like open-world combat. The court is always
// the last trial, so an active last trial IS the court.
export function isActiveFinalCourt(run: GauntletRunView | null | undefined): boolean {
  return !!run && run.phase === 'trial' && run.trialIndex === run.trialCount - 1;
}
