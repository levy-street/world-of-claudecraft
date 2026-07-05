import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { UiEffectsTier } from '../src/game/ui_effects_profile';
import {
  AURA_REFRESH_INTERVAL_LOW_MS,
  AURA_VISIBLE_CAP_FULL,
  AURA_VISIBLE_CAP_LOW,
  auraRefreshIntervalMs,
  auraVisibleCap,
  cadenceDue,
  coerceFxTier,
  FCT_MAX_CONCURRENT_LOW,
  FCT_TTL_SCALE_FULL,
  FCT_TTL_SCALE_LOW,
  fctDropNonCrit,
  fctMaxConcurrent,
  fctTtlScale,
  MINIMAP_REDRAW_INTERVAL_LOW_MS,
  minimapRedrawIntervalMs,
  NAMEPLATE_INTERVAL_FULL_SEC,
  NAMEPLATE_INTERVAL_LOW_SEC,
  nameplateIntervalSec,
  nonSelfRepaintDue,
  TARGET_FRAME_NONSELF_INTERVAL_LOW_MS,
  targetFrameNonSelfIntervalMs,
} from '../src/game/ui_tier_knobs';

// Per-element graphics-tier knobs. The headline gate is the two-controller hazard:
// every knob is a pure function of the STATIC tier and NEVER reads the FPS governor, so
// only the static preset can move a knob. These tests pin that (import-absence +
// behavioral), the no-op-on-full invariant (medium/high/ultra are byte-equivalent to
// pre-tiering), and that low measurably sheds on every knob.

// The four published tiers and the three that must stay at full effects (only low sheds).
const ALL_TIERS: readonly UiEffectsTier[] = ['low', 'medium', 'high', 'ultra'];
const FULL_TIERS: readonly UiEffectsTier[] = ['medium', 'high', 'ultra'];

const FCT_POOL_CAP = 64; // the painter's pre-allocated pool size (fct_painter.ts)

describe('ui_tier_knobs - determinism (pure: same input, same output)', () => {
  it('every knob returns an identical value on repeated calls', () => {
    for (const tier of ALL_TIERS) {
      expect(fctMaxConcurrent(tier, FCT_POOL_CAP)).toBe(fctMaxConcurrent(tier, FCT_POOL_CAP));
      expect(fctTtlScale(tier)).toBe(fctTtlScale(tier));
      expect(fctDropNonCrit(tier)).toBe(fctDropNonCrit(tier));
      expect(minimapRedrawIntervalMs(tier)).toBe(minimapRedrawIntervalMs(tier));
      expect(auraVisibleCap(tier)).toBe(auraVisibleCap(tier));
      expect(auraRefreshIntervalMs(tier)).toBe(auraRefreshIntervalMs(tier));
      expect(targetFrameNonSelfIntervalMs(tier)).toBe(targetFrameNonSelfIntervalMs(tier));
    }
  });
});

describe('ui_tier_knobs - no-op on full tiers (ultra byte-equivalent to pre-tiering)', () => {
  it('FCT: full pool cap, TTL scale 1, no drop-non-crit on medium/high/ultra', () => {
    for (const tier of FULL_TIERS) {
      expect(fctMaxConcurrent(tier, FCT_POOL_CAP)).toBe(FCT_POOL_CAP);
      expect(fctTtlScale(tier)).toBe(FCT_TTL_SCALE_FULL);
      expect(fctTtlScale(tier)).toBe(1); // 1250 * 1 = 1250, exactly the descriptor ttl
      expect(fctDropNonCrit(tier)).toBe(false);
    }
  });

  it('cadence knobs return 0 (no extra throttle) on medium/high/ultra', () => {
    for (const tier of FULL_TIERS) {
      expect(minimapRedrawIntervalMs(tier)).toBe(0);
      expect(auraRefreshIntervalMs(tier)).toBe(0);
      expect(targetFrameNonSelfIntervalMs(tier)).toBe(0);
    }
  });

  it('aura visible-count is uncapped on medium/high/ultra', () => {
    for (const tier of FULL_TIERS) {
      expect(auraVisibleCap(tier)).toBe(AURA_VISIBLE_CAP_FULL);
      expect(auraVisibleCap(tier)).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it('a 0-interval cadence is ALWAYS due, so the full-tier path is the unchanged path', () => {
    // cadenceDue with the full-tier interval (0) is due regardless of elapsed time, even
    // for a future-dated lastAt: there is no extra throttle on medium/high/ultra.
    expect(cadenceDue(0, 0, minimapRedrawIntervalMs('ultra'))).toBe(true);
    expect(cadenceDue(1_000_000, 0, targetFrameNonSelfIntervalMs('high'))).toBe(true);
    expect(cadenceDue(0, 0, auraRefreshIntervalMs('medium'))).toBe(true);
  });
});

describe('ui_tier_knobs - low sheds cost on every knob', () => {
  it('FCT: tighter live cap, shorter TTL, drops non-crit', () => {
    expect(fctMaxConcurrent('low', FCT_POOL_CAP)).toBe(FCT_MAX_CONCURRENT_LOW);
    expect(fctMaxConcurrent('low', FCT_POOL_CAP)).toBeLessThan(FCT_POOL_CAP);
    expect(fctTtlScale('low')).toBe(FCT_TTL_SCALE_LOW);
    expect(fctTtlScale('low')).toBeLessThan(1);
    expect(fctDropNonCrit('low')).toBe(true);
  });

  it('FCT live cap never exceeds the pre-allocated pool (small-pool clamp)', () => {
    expect(fctMaxConcurrent('low', 3)).toBe(3);
    expect(fctMaxConcurrent('low', FCT_MAX_CONCURRENT_LOW + 10)).toBe(FCT_MAX_CONCURRENT_LOW);
  });

  it('minimap redraw throttles, auras cap + coarsen, target frame slows on low', () => {
    expect(minimapRedrawIntervalMs('low')).toBe(MINIMAP_REDRAW_INTERVAL_LOW_MS);
    expect(minimapRedrawIntervalMs('low')).toBeGreaterThan(0);
    expect(auraVisibleCap('low')).toBe(AURA_VISIBLE_CAP_LOW);
    expect(auraVisibleCap('low')).toBeLessThan(AURA_VISIBLE_CAP_FULL);
    expect(auraRefreshIntervalMs('low')).toBe(AURA_REFRESH_INTERVAL_LOW_MS);
    expect(targetFrameNonSelfIntervalMs('low')).toBe(TARGET_FRAME_NONSELF_INTERVAL_LOW_MS);
  });
});

describe('ui_tier_knobs - LOW shed magnitudes are pinned to literals (perf-gate bounds)', () => {
  // The full-tier values are literal-pinned above (1, +Infinity, 0). Pin the LOW shed
  // amounts to literals too, so retuning how much low sheds (e.g. a tighter aura cap that
  // would hide more, or a shorter TTL) is a DELIBERATE change that must edit this test,
  // not a silent drift the self-referential `toBe(CONST)` assertions would pass. These are
  // also the values the per-tier perf gate and the fairness review reasoned about.
  it('pins each low-tier constant', () => {
    expect(FCT_MAX_CONCURRENT_LOW).toBe(24);
    expect(FCT_TTL_SCALE_LOW).toBe(0.6);
    expect(AURA_VISIBLE_CAP_LOW).toBe(8);
    expect(MINIMAP_REDRAW_INTERVAL_LOW_MS).toBe(250);
    expect(AURA_REFRESH_INTERVAL_LOW_MS).toBe(250);
    expect(TARGET_FRAME_NONSELF_INTERVAL_LOW_MS).toBe(100);
  });
});

describe('ui_tier_knobs - nameplate refresh cadence (static-preset tiered, seconds)', () => {
  // Replaces the renderer's old mobile-vs-desktop runtime fork (isMobileRuntime()
  // ? 1/15 : 1/24) with a static-tier read. Unlike the shed-on-low knobs, this is
  // a BASE cadence that throttles on EVERY tier, so it always returns a positive
  // interval (never the 0 = always-due the ms knobs use). Seconds, not ms: the
  // renderer compares it directly against accumulated dt.
  it('is deterministic and always positive on every tier', () => {
    for (const tier of ALL_TIERS) {
      expect(nameplateIntervalSec(tier)).toBe(nameplateIntervalSec(tier));
      expect(nameplateIntervalSec(tier)).toBeGreaterThan(0);
    }
  });

  it('the lowest tier holds the old mobile 1/15s cadence; richer tiers the 1/24s desktop one', () => {
    expect(nameplateIntervalSec('low')).toBe(NAMEPLATE_INTERVAL_LOW_SEC);
    for (const tier of FULL_TIERS) {
      expect(nameplateIntervalSec(tier)).toBe(NAMEPLATE_INTERVAL_FULL_SEC);
    }
  });

  // STALENESS FLOOR (not a device cost cap): no tier may refresh SLOWER than the
  // pre-extraction 1/15s, so a nameplate never lags more than it used to. Interval
  // is in seconds, so "no slower" means <= 1/15s for EVERY tier. This guards only
  // the SLOW direction. The old isMobileRuntime() fork capped EVERY mobile device
  // at 1/15s (a weak-GPU cost ceiling, the PR901 lesson); the preset axis now binds
  // 1/15s to the LOW tier alone, so a mobile device on a non-low preset runs the
  // faster/costlier 1/24s. That accepted axis change (restoring the mobile cost
  // ceiling) is tracked for the mobile-perf gate; this test does NOT assert a
  // mobile device receives 1/15s.
  it('never refreshes slower than the 1/15s staleness floor: every tier interval is <= 1/15s', () => {
    const FLOOR_SEC = 1 / 15;
    for (const tier of ALL_TIERS) {
      expect(nameplateIntervalSec(tier)).toBeLessThanOrEqual(FLOOR_SEC);
    }
    // the slowest tier (the largest interval) is exactly the floor, not slower.
    const slowest = Math.max(...ALL_TIERS.map(nameplateIntervalSec));
    expect(slowest).toBe(NAMEPLATE_INTERVAL_LOW_SEC);
    expect(slowest).toBeLessThanOrEqual(FLOOR_SEC);
  });

  it('pins the per-tier interval literals (retuning is a deliberate, test-touching change)', () => {
    expect(NAMEPLATE_INTERVAL_LOW_SEC).toBe(1 / 15);
    expect(NAMEPLATE_INTERVAL_FULL_SEC).toBe(1 / 24);
    // a slower cadence is a LARGER number of seconds: the low/floor interval is the
    // larger of the two (mobile refreshes less often than desktop).
    expect(NAMEPLATE_INTERVAL_LOW_SEC).toBeGreaterThan(NAMEPLATE_INTERVAL_FULL_SEC);
  });
});

describe('ui_tier_knobs - nonSelfRepaintDue (a target SWAP bypasses the tier throttle)', () => {
  // The load-bearing fairness rule for the target frame + target debuff strip: a target
  // SWAP must repaint immediately so a throttled low player never sees the PREVIOUS
  // target's HP / debuffs; otherwise the tier cadence governs. Lifted out of hud.update()
  // so the swap-bypass is unit-testable (a `||`->`&&` typo here would strand a stale
  // target on low).
  it('repaints immediately on a subject change even when the cadence is NOT due', () => {
    // intervalMs 100, only 10ms elapsed -> cadence not due, but the subject changed.
    expect(nonSelfRepaintDue(true, 1000, 1010, 100)).toBe(true);
  });

  it('honors the throttle when the subject did NOT change', () => {
    expect(nonSelfRepaintDue(false, 1000, 1010, 100)).toBe(false); // not due yet
    expect(nonSelfRepaintDue(false, 1000, 1100, 100)).toBe(true); // exactly due
    expect(nonSelfRepaintDue(false, 1000, 2000, 100)).toBe(true); // past due
  });

  it('on the full tiers (interval 0) always repaints, swap or not', () => {
    expect(nonSelfRepaintDue(false, 1000, 1000, targetFrameNonSelfIntervalMs('ultra'))).toBe(true);
    expect(nonSelfRepaintDue(false, 9999, 1000, auraRefreshIntervalMs('high'))).toBe(true);
  });
});

describe('ui_tier_knobs - cadenceDue semantics', () => {
  it('a positive interval throttles to that spacing', () => {
    expect(cadenceDue(1000, 1000, 250)).toBe(false); // 0ms elapsed
    expect(cadenceDue(1000, 1249, 250)).toBe(false); // 249ms elapsed
    expect(cadenceDue(1000, 1250, 250)).toBe(true); // exactly 250ms elapsed
    expect(cadenceDue(1000, 2000, 250)).toBe(true); // well past
  });

  it('a 0 or negative interval is always due', () => {
    expect(cadenceDue(1000, 1000, 0)).toBe(true);
    expect(cadenceDue(5000, 1000, 0)).toBe(true); // even a future lastAt
    expect(cadenceDue(1000, 1000, -1)).toBe(true);
  });

  it('a future / rewound lastAt under a positive interval SUPPRESSES (does not force) a fire', () => {
    // now < lastAt (a non-monotonic or rewound clock): now - lastAt is negative, so a
    // positive interval is not yet due. Pins the chosen behavior (suppress, not fire) so a
    // sign flip in cadenceDue would be caught.
    expect(cadenceDue(5000, 1000, 250)).toBe(false);
  });
});

describe('ui_tier_knobs - coerceFxTier (the static data-fx-level -> tier read)', () => {
  it('passes through every valid tier string', () => {
    for (const tier of ALL_TIERS) expect(coerceFxTier(tier)).toBe(tier);
  });

  it('defaults to ultra (full effects) for an unset / unknown value', () => {
    // A missing or garbage stamp must never silently shed HUD cost.
    expect(coerceFxTier(undefined)).toBe('ultra');
    expect(coerceFxTier(null)).toBe('ultra');
    expect(coerceFxTier('')).toBe('ultra');
    expect(coerceFxTier('LOW')).toBe('ultra'); // case-sensitive: not a published tier
    expect(coerceFxTier('reduced')).toBe('ultra');
    expect(coerceFxTier('advanced')).toBe('ultra'); // a PRESET label, not a published tier
  });
});

describe('ui_tier_knobs - import absence + two-controller hazard (source scan)', () => {
  // The headline acceptance: the mapping reads the STATIC tier ONLY and never the FPS
  // governor, so flipping the static preset is the only thing that can move a knob.
  // Proven by reading the source (the architecture purity guard forbids render/game/net/
  // three/painter imports for a UI_PURE_CORE; this pins the governor + DOM rules too).
  const src = readFileSync(
    fileURLToPath(new URL('../src/game/ui_tier_knobs.ts', import.meta.url)),
    'utf8',
  );
  // Blank out comments so prose (which legitimately names the governor + the static
  // preset) cannot create a false positive; only real code is scanned.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('imports ONLY the UiEffectsTier type from the sibling resolver, nothing else', () => {
    const froms = [...code.matchAll(/\bimport\b[^;]*\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(froms).toEqual(['./ui_effects_profile']);
    expect(code).not.toMatch(/\bimport\s*\(/); // no dynamic import either
  });

  it('never reads the FPS governor state (the two-controller hazard)', () => {
    expect(code).not.toMatch(/governor/i);
    expect(code).not.toMatch(/render_budget/);
    expect(code).not.toMatch(/\.state\s*\(/);
    expect(code).not.toMatch(/\.levels\b/);
  });

  it('never reaches into src/render, src/ui, or src/net', () => {
    expect(code).not.toMatch(/['"][^'"]*\/render\//);
    expect(code).not.toMatch(/['"][^'"]*\/ui\//);
    expect(code).not.toMatch(/['"][^'"]*\/net\//);
  });

  it('touches no DOM global and no nondeterministic clock/random (purity)', () => {
    expect(code).not.toMatch(/\b(document|window|navigator|localStorage|sessionStorage)\s*[.[]/);
    expect(code).not.toMatch(/\b(Math\.random|Date\.now|performance\.now)\b/);
  });
});

describe('ui_tier_knobs - behavioral: only the tier moves a knob', () => {
  it('the only input that changes a knob is the tier argument (no hidden state)', () => {
    // Capture the full knob vector for each tier, then re-read after arbitrary unrelated
    // work: the vectors are identical, so nothing outside the tier argument (e.g. a
    // governor, a clock) can move a knob.
    const snapshot = (tier: UiEffectsTier) => ({
      fctCap: fctMaxConcurrent(tier, FCT_POOL_CAP),
      fctTtl: fctTtlScale(tier),
      fctDrop: fctDropNonCrit(tier),
      minimap: minimapRedrawIntervalMs(tier),
      auraCap: auraVisibleCap(tier),
      auraRefresh: auraRefreshIntervalMs(tier),
      target: targetFrameNonSelfIntervalMs(tier),
    });
    const before = ALL_TIERS.map(snapshot);
    // Unrelated churn that a governor-driven knob would react to (it must not here).
    for (let i = 0; i < 1000; i++) cadenceDue(i, i * 2, i % 3);
    const after = ALL_TIERS.map(snapshot);
    expect(after).toEqual(before);
    // And low is strictly cheaper than ultra on the knobs that compare (the gate's point).
    expect(before[0].fctCap).toBeLessThan(before[3].fctCap);
    expect(before[0].auraCap).toBeLessThan(before[3].auraCap);
    expect(before[0].minimap).toBeGreaterThan(before[3].minimap);
  });
});

describe('ui_tier_knobs - two-controller WIRING: Hud.fxTier reads the static stamp, not the governor', () => {
  // The pure source scan above proves the KNOB module never reads a governor. But the
  // actual two-controller seam is Hud.fxTier(): the knobs only stay governor-free if the
  // Hud feeds them the STATIC data-fx-level stamp (written solely by the preset applier)
  // and never an FPS-governor level. The painter/cadence unit tests inject the tier
  // directly, so they would all stay green if fxTier() were rewired to the governor. This
  // scans the actual fxTier() method body in hud.ts to pin that wiring.
  const hudSrc = readFileSync(fileURLToPath(new URL('../src/ui/hud.ts', import.meta.url)), 'utf8');
  // Isolate the fxTier() method body (private fxTier(): UiEffectsTier { ... }).
  const fxTierMatch = hudSrc.match(
    /private\s+fxTier\s*\(\s*\)\s*:\s*UiEffectsTier\s*\{([\s\S]*?)\n\s{2}\}/,
  );

  it('Hud defines a fxTier() method', () => {
    expect(fxTierMatch).not.toBeNull();
  });

  it('fxTier() resolves the STATIC data-fx-level stamp via coerceFxTier', () => {
    const body = fxTierMatch?.[1] ?? '';
    expect(body).toMatch(/document\.documentElement\.dataset\.fxLevel/);
    expect(body).toMatch(/coerceFxTier/);
  });

  it('fxTier() never reads the FPS governor (the two-controller hazard)', () => {
    const body = fxTierMatch?.[1] ?? '';
    expect(body).not.toMatch(/governor/i);
    expect(body).not.toMatch(/\.state\s*\(/);
    expect(body).not.toMatch(/\.levels\b/);
  });
});

describe('ui_tier_knobs - party frames are deliberately NOT tiered (a healer signal stays full-rate)', () => {
  // The senior review removed the party-frame throttle: party-member HP is a healer's
  // only actionable signal (no self-dispel), so it stays on the 4Hz mediumHud band for
  // EVERY tier. Pin that decision by source scan so re-adding a party tier knob (the exact
  // deleted names) is a conscious, test-touching change, not a silent re-handicap of low.
  const knobSrc = readFileSync(
    fileURLToPath(new URL('../src/game/ui_tier_knobs.ts', import.meta.url)),
    'utf8',
  );
  const hudSrc = readFileSync(fileURLToPath(new URL('../src/ui/hud.ts', import.meta.url)), 'utf8');

  it('the tier-knobs module exposes NO party-frame interval knob', () => {
    expect(knobSrc).not.toMatch(/partyFrameNonSelfIntervalMs/);
    expect(knobSrc).not.toMatch(/PARTY_FRAME_NONSELF_INTERVAL_LOW_MS/);
  });

  it('hud calls updatePartyFrames() with no party tier gate', () => {
    expect(hudSrc).toMatch(/this\.updatePartyFrames\(\)/);
    expect(hudSrc).not.toMatch(/partyFrameNonSelfIntervalMs/);
    expect(hudSrc).not.toMatch(/lastPartyFramesAt/);
  });
});
