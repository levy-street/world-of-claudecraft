// Pure decision core for the daily-rewards chest-launcher poll. While the
// window is closed the launcher needs only a slow status poll, because every
// window open, close, and spin delivers or forces a fresh status through the
// onStatus/onClose wiring in hud.ts; the predicate lives here, host-agnostic,
// so the throttle arithmetic and force bypass are unit-tested directly
// instead of buried in the Hud coordinator.
//
// The hud stamps BEFORE its fetch resolves, so a failed fetch also waits out
// the window before an unforced retry. Deliberate: resetting the stamp on
// failure would retry every slow tick for every client during a server
// outage, and the conservative face of a missed status is a missing glow,
// never a wrong one (open, close, and spin still force freshness).

import type { DailyRewardStatus } from '../world_api';

/** Closed-window launcher poll floor; interactions bypass it via force. */
export const DAILY_REWARDS_LAUNCHER_THROTTLE_MS = 300_000;

/**
 * Whether a launcher refresh may fetch now: forced refreshes always may,
 * unforced ones at most once per throttle window since the last stamp.
 * The very first unforced tick after boot is inside the window (a zero
 * stamp), which is fine: boot wiring issues a forced refresh itself.
 */
export function shouldRefreshDailyRewardsLauncher(
  force: boolean,
  now: number,
  lastRefreshAt: number,
  throttleMs: number = DAILY_REWARDS_LAUNCHER_THROTTLE_MS,
): boolean {
  return force || now - lastRefreshAt >= throttleMs;
}

/** What the poll needs from its host. Every one is a closure, so the controller
 *  itself stays DOM-free and a Vitest drives the whole state machine directly. */
export interface DailyRewardsLauncherPollDeps {
  /** The feature flag; a disabled launcher fetches nothing and paints nothing. */
  enabled(): boolean;
  /** Whether either launcher button exists yet (desktop chest, mobile tray row). */
  mounted(): boolean;
  /** Re-apply the buttons' hidden state before any fetch decision. */
  syncVisibility(): void;
  /** The status read, whatever the host's world is. */
  fetch(): Promise<DailyRewardStatus>;
  /** Paint a status onto the launcher. */
  applyStatus(status: DailyRewardStatus): void;
  /** The fetch failed: clear the glow rather than leave a stale one. */
  onFailure(): void;
  now(): number;
}

/**
 * The launcher's status poll: the sequence guard, the throttle stamp and the
 * fetch chain around the predicate above. Extracted from the Hud coordinator
 * (which sits at a zero-margin monolith ceiling) as the direct twin of
 * ClaudiumLauncherBalance, the launcher-adjacent controller already living in
 * its own module; the HUD keeps the DOM wiring and nothing else.
 *
 * The sequence guard is what makes a slow response harmless: any fresher status,
 * from a later poll or pushed in by the window itself, invalidates the ones
 * still in flight so an older answer can never overwrite a newer one.
 */
export class DailyRewardsLauncherPoll {
  private seq = 0;
  private lastRefreshAt = 0;

  constructor(private readonly deps: DailyRewardsLauncherPollDeps) {}

  /** A status that arrived WITHOUT this poll asking (the window's own render or
   *  spin delivered it). It is as fresh as a fetch, so it invalidates anything in
   *  flight and stamps the throttle: the next unforced tick has nothing to add. */
  observeFresh(status: DailyRewardStatus): void {
    this.seq++;
    this.lastRefreshAt = this.deps.now();
    this.deps.applyStatus(status);
  }

  /** Refresh the launcher. `force` bypasses the throttle window (every open,
   *  close and spin does). The stamp is taken BEFORE the fetch resolves, so a
   *  failed fetch also waits out the window before an unforced retry: the reason
   *  is argued at the top of this file. */
  refresh(force = false): void {
    if (!this.deps.enabled() || !this.deps.mounted()) return;
    this.deps.syncVisibility();
    const now = this.deps.now();
    if (!shouldRefreshDailyRewardsLauncher(force, now, this.lastRefreshAt)) return;
    this.lastRefreshAt = now;
    const seq = ++this.seq;
    void this.deps
      .fetch()
      .then((status) => {
        if (seq !== this.seq) return;
        this.deps.applyStatus(status);
      })
      .catch(() => {
        if (seq !== this.seq) return;
        this.deps.onFailure();
      });
  }
}
