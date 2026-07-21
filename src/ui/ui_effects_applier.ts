// The thin DOM host for the graphics-tier UI effects profile. It publishes the
// pure resolver's profile (src/game/ui_effects_profile) to the page as the
// `data-fx-level` attribute + the `--fx-*` tokens, mirroring how main.ts's
// applyTheme() loops theme.ts's token map onto documentElement. It owns the three
// host-only concerns the pure core deliberately does not: a diff-guard cache (so a
// no-op never re-stamps), a debounce for the effectsQuality slider, and the OS
// `prefers-reduced-motion` matchMedia channel. The pure core stays stateless and
// DOM-free; this is the only place that touches the document.
//
// Driven by the STATIC graphics preset only, never the FPS governor (the
// two-controller hazard: the gfx.ts `ui` bucket stays governable:false because the
// governor cannot measure compositor blur cost). `data-fx-level` + `--fx-*` are
// INTERNAL strings, never a t() key.

import {
  type UiEffectsProfile,
  uiEffectsProfilesEqual,
  uiEffectsTokens,
} from '../game/ui_effects_profile';

/** The effectsQuality slider fires rapidly while dragging and only ever flips the
 *  tier at the advanced cutoff, so its apply is debounced so a drag does not thrash
 *  data-fx-level. Discrete changes (preset, reduce-motion, boot) apply immediately. */
export const EFFECTS_QUALITY_DEBOUNCE_MS = 180;

export interface UiEffectsApplierOptions {
  /** Resolve the profile from the live settings, given the current OS reduced-motion
   *  state. The applier owns the matchMedia channel and passes its value in; the
   *  callback ORs it with the in-game reduceMotion setting so motion has a single
   *  source of truth (OS query OR setting -> the resolver's reduceMotion input). */
  resolve: (osReducedMotion: boolean) => UiEffectsProfile;
}

export class UiEffectsApplier {
  private readonly resolve: (osReducedMotion: boolean) => UiEffectsProfile;
  private last: UiEffectsProfile | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly reducedMotionQuery: MediaQueryList | null;

  constructor(opts: UiEffectsApplierOptions) {
    this.resolve = opts.resolve;
    this.reducedMotionQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    // OS reduced-motion is a discrete, system-level change: re-resolve + apply now
    // (the resolver folds the new OS state into the same single motion source).
    this.reducedMotionQuery?.addEventListener?.('change', this.applyNow);
  }

  /** Immediate, diff-guarded apply for discrete changes (preset, reduce-motion, boot,
   *  the OS matchMedia change). An arrow property so it binds for addEventListener. */
  applyNow = (): void => {
    this.commit(this.resolve(this.reducedMotionQuery?.matches ?? false));
  };

  /** Debounced apply for the effectsQuality slider (trailing edge lands the final
   *  correct apply; the diff-guard makes a same-profile result a no-op anyway). */
  applyDebounced(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.applyNow();
    }, EFFECTS_QUALITY_DEBOUNCE_MS);
  }

  private commit(profile: UiEffectsProfile): void {
    // A tier switch forces a one-time large style recalc, so never re-stamp on a
    // no-op. The 5-field compare lives in the pure module so it cannot regress.
    if (uiEffectsProfilesEqual(this.last, profile)) return;
    this.last = profile;
    const root = document.documentElement;
    root.dataset.fxLevel = profile.tier; // internal string, no t()
    const tokens = uiEffectsTokens(profile);
    for (const name of Object.keys(tokens)) root.style.setProperty(name, tokens[name]);
  }
}
