// The ONE auto-refresh composition every polling admin surface consumes.
//
// Five pages (MarketMetrics, OnlinePlayers, SuspiciousPlayers, TopHolders,
// DetectionCalibration) had each grown the same 30 lines of glue: a
// `requestId` staleness counter, a `mounted` latch, an `$effect` that arms a
// `setInterval`, an `onMount` that reads the stored preference and fires one
// load, a `changeAutoRefresh` that persists and re-arms, and a catch arm that
// consults `auth.handleAuthFailure` before painting a failure. Only the
// endpoint, the payload type and the cadence differed. AutoRefreshToggle
// already shared the control; this shares the machine behind it, and the
// per-page code collapses to a `createAutoRefresh(...)` call plus
// `onMount(() => surface.start())`.
//
// Deliberately imperative rather than `$effect`-driven. Arming the interval
// from an effect means the composition can only be constructed inside a
// component's initialization context, which makes the machine untestable
// except through a page; `start()` returning its own teardown is the same
// behavior with none of that coupling, and it reads the way `onMount` already
// wants to be written. The reactive half stays exactly where reactivity is
// needed: `data`, `failure` and `enabled` are `$state` fields the templates
// read (the `auth.svelte.ts` precedent for a runes class outside a component).
//
// Cadence is the caller's, never this module's: the page passes `intervalMs`
// (its own constant, or one of the shared ones in ./poll) and this only
// honours it. Behavior-identical to the hand-rolled glue it replaces, pinned
// per page by tests/admin/auto_refresh_cadence.test.ts.

import { readAutoRefreshPreference, writeAutoRefreshPreference } from '../auto_refresh_preference';
import { type AdminLoadFailure, classifyAdminLoadFailure } from '../load_failure';
import { auth } from './auth.svelte';

export interface AutoRefreshOptions<T> {
  /** Where this surface's auto-refresh opt-out is remembered. */
  storageKey: string;
  /** Poll cadence in milliseconds, owned by the calling page. */
  intervalMs: number;
  /** One read. Rejections are classified, never thrown at the caller. */
  load: () => Promise<T>;
}

export class AutoRefreshSurface<T> {
  /** The last successful payload. Null until the first read lands. */
  data = $state<T | null>(null);
  /** Quiet, or the classified verdict of the last failed read. */
  failure = $state<AdminLoadFailure>('none');
  /** The live toggle position (defaults ON; only an explicit OFF is stored). */
  enabled = $state(true);

  // Monotonic request stamp. A response whose stamp is no longer current has
  // been superseded (a faster later read landed first) or the surface has been
  // torn down, and is dropped: applying it would show older data than the page
  // already has, or write into an unmounted component.
  #requestId = 0;
  #timer: ReturnType<typeof setInterval> | null = null;
  #started = false;

  constructor(private readonly options: AutoRefreshOptions<T>) {}

  /** The cadence this surface polls at, for the toggle's own label. */
  get intervalMs(): number {
    return this.options.intervalMs;
  }

  /**
   * Mount: adopt the stored preference, fire one read, and arm the interval if
   * auto-refresh is on. Returns the teardown for `onMount` to return.
   *
   * The first read fires whether or not auto-refresh is enabled: an operator
   * who switched polling off still wants the page populated once on arrival.
   */
  start(): () => void {
    if (this.#started) return () => this.#teardown();
    this.#started = true;
    this.enabled = readAutoRefreshPreference(this.options.storageKey);
    this.refresh();
    if (this.enabled) this.#arm();
    return () => this.#teardown();
  }

  /** Operator flipped the toggle: persist it, then cancel or re-arm. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    writeAutoRefreshPreference(this.options.storageKey, enabled);
    this.#disarm();
    if (enabled) {
      // Immediately, then on the cadence: switching polling back on should not
      // leave the operator staring at stale numbers for a whole interval.
      this.refresh();
      this.#arm();
    }
  }

  /** One read now, independent of the toggle (the manual refresh button). */
  refresh(): void {
    void this.#run();
  }

  async #run(): Promise<void> {
    const stamp = ++this.#requestId;
    try {
      const result = await this.options.load();
      if (stamp !== this.#requestId) return;
      this.data = result;
      this.failure = 'none';
    } catch (err) {
      if (stamp !== this.#requestId) return;
      // A 401 has already handed the operator to the login screen; painting a
      // failure panel on top of that would answer one failure twice. Anything
      // else stays inline, and the last good `data` is deliberately kept so a
      // transient blip never blanks a populated dashboard.
      if (!auth.handleAuthFailure(err)) this.failure = classifyAdminLoadFailure(err);
    }
  }

  #arm(): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => this.refresh(), this.options.intervalMs);
  }

  #disarm(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  #teardown(): void {
    this.#disarm();
    this.#started = false;
    // Invalidate anything still in flight: its response must not write into an
    // unmounted component.
    this.#requestId += 1;
  }
}

export function createAutoRefresh<T>(options: AutoRefreshOptions<T>): AutoRefreshSurface<T> {
  return new AutoRefreshSurface<T>(options);
}
