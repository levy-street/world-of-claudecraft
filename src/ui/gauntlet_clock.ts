// A wall-clock estimator for the Gauntlet countdown.
//
// GauntletRunView.endsAt is an ABSOLUTE sim-time deadline, so a countdown is
// endsAt - now. IWorld exposes no sim clock to the client, though (the online
// ClientWorld mirrors none), so this anchors to each new phase deadline as it
// appears in the wire view and ticks down with the local wall clock, then reports
// an estimated sim `time` such that (endsAt - time) is the seconds left. Feeding
// that estimate into gauntletHudModel keeps its endsAt - time math exact while the
// bar/timer animate on both hosts.
//
// It re-anchors when the phase / trial / deadline changes, so latency at a phase
// flip costs at most a small one-time skew, never accumulating drift. If IWorld ever
// exposes a real sim clock, pass that straight into the model and drop this.

import type { GauntletRunView } from '../sim/types';
import { gauntletPhaseWindowSeconds } from './gauntlet_hud_view';

export class GauntletClock {
  private key = '';
  private anchorWallMs = 0;
  private windowS = 0;

  /** Estimated absolute sim time; (run.endsAt - result) is the seconds remaining. */
  estimate(run: GauntletRunView, wallNowMs: number): number {
    const key = `${run.phase}:${run.trialIndex}:${run.endsAt}`;
    if (key !== this.key) {
      this.key = key;
      this.anchorWallMs = wallNowMs;
      this.windowS = gauntletPhaseWindowSeconds(run);
    }
    const elapsed = (wallNowMs - this.anchorWallMs) / 1000;
    const remaining = Math.max(0, this.windowS - elapsed);
    return run.endsAt - remaining;
  }
}
