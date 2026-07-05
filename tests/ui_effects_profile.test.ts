import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EFFECTS_QUALITY_LOW_CUTOFF,
  resolveUiEffectsProfile,
  type UiEffectsProfile,
  uiEffectsAllowFctCrit,
  uiEffectsProfilesEqual,
  uiEffectsTokens,
} from '../src/game/ui_effects_profile';

// The resolver is the ONLY place the HUD effect precedence lives. These tests pin
// every documented rule so a regression (a dropped clamp, glass dropped under
// reduced-motion, low no longer cutting cost) fails here instead of in the page.

const ULTRA: UiEffectsProfile = {
  tier: 'ultra',
  motion: 'full',
  heavyShadows: true,
  ambientAnim: 'running',
  allowFctCrit: true,
};

// The resolver takes a single object input; a tiny helper keeps the cases terse.
function resolve(
  presetLabel: 'low' | 'medium' | 'high' | 'ultra' | 'advanced',
  effectsQuality: number,
  reduceMotion: boolean,
): UiEffectsProfile {
  return resolveUiEffectsProfile({ presetLabel, effectsQuality, reduceMotion });
}

describe('resolveUiEffectsProfile - base preset mapping', () => {
  it('maps each base preset label straight to its tier at full motion', () => {
    expect(resolve('ultra', 1, false)).toEqual(ULTRA);
    expect(resolve('high', 1, false)).toEqual({ ...ULTRA, tier: 'high' });
    expect(resolve('medium', 1, false)).toEqual({ ...ULTRA, tier: 'medium' });
  });

  it('low preset cuts cost (no heavy shadows, paused ambient, no FCT crit) independent of motion', () => {
    expect(resolve('low', 1, false)).toEqual({
      tier: 'low',
      motion: 'full',
      heavyShadows: false,
      ambientAnim: 'paused',
      allowFctCrit: false,
    });
  });

  it('medium and high keep full effects: only the low tier sheds cost', () => {
    for (const label of ['medium', 'high', 'ultra'] as const) {
      const p = resolve(label, 1, false);
      expect(p.heavyShadows).toBe(true);
      expect(p.ambientAnim).toBe('running');
      expect(p.allowFctCrit).toBe(true);
    }
  });
});

describe('resolveUiEffectsProfile - advanced honors effectsQuality (NOT collapsed to high)', () => {
  it('advanced with effectsQuality at/above the cutoff behaves as ultra', () => {
    expect(resolve('advanced', 1, false)).toEqual(ULTRA);
    expect(resolve('advanced', EFFECTS_QUALITY_LOW_CUTOFF, false)).toEqual(ULTRA);
    // just above the boundary
    expect(resolve('advanced', EFFECTS_QUALITY_LOW_CUTOFF + 0.01, false).tier).toBe('ultra');
  });

  it('advanced with effectsQuality below the cutoff drops to the distinct LOW tier (not high)', () => {
    const p = resolve('advanced', EFFECTS_QUALITY_LOW_CUTOFF - 0.01, false);
    expect(p.tier).toBe('low');
    expect(p.tier).not.toBe('high'); // the expert path sheds HUD cost independently
    expect(p.heavyShadows).toBe(false);
    expect(p.ambientAnim).toBe('paused');
    expect(p.allowFctCrit).toBe(false);
    expect(resolve('advanced', 0, false).tier).toBe('low');
    expect(resolve('advanced', -5, false).tier).toBe('low');
    // NaN < cutoff is false, so a non-numeric effectsQuality falls back to the ultra path.
    expect(resolve('advanced', Number.NaN, false).tier).toBe('ultra');
  });

  it('reuses the same cutoff the renderer uses (0.5), exported for gfx.ts to share', () => {
    expect(EFFECTS_QUALITY_LOW_CUTOFF).toBe(0.5);
  });

  it('effectsQuality only affects the advanced preset, never a fixed preset', () => {
    // A dialed-down effectsQuality must NOT downgrade an explicit ultra/high/medium/low.
    expect(resolve('ultra', 0, false).tier).toBe('ultra');
    expect(resolve('high', 0, false).tier).toBe('high');
    expect(resolve('medium', 0, false).tier).toBe('medium');
    expect(resolve('low', 1, false).tier).toBe('low');
  });
});

describe('resolveUiEffectsProfile - reduced-motion is the strongest motion authority', () => {
  it('forces motion:none and pauses ambient on any tier', () => {
    for (const label of ['low', 'medium', 'high', 'ultra'] as const) {
      const p = resolve(label, 1, true);
      expect(p.motion).toBe('none');
      expect(p.ambientAnim).toBe('paused');
    }
  });

  it('preserves the tier cost (glass tier + shadows + FCT crit) under reduced-motion on every NON-low tier', () => {
    // Guards the asymmetry: reduced-motion must lose ONLY motion, never drop shadows
    // or crit on medium/high/ultra (a regression like `heavyShadows: !lowCost && !reduceMotion`).
    for (const label of ['medium', 'high', 'ultra'] as const) {
      const p = resolve(label, 1, true);
      expect(p.tier).toBe(label);
      expect(p.heavyShadows).toBe(true);
      expect(p.allowFctCrit).toBe(true);
    }
  });

  it('does NOT drop glass by itself: an Ultra reduced-motion player keeps the heavy tier', () => {
    const p = resolve('ultra', 1, true);
    expect(p.tier).toBe('ultra'); // glass-bearing tier preserved
    expect(p.heavyShadows).toBe(true); // shadows preserved
    expect(p.allowFctCrit).toBe(true); // crit emphasis preserved
    expect(p.motion).toBe('none'); // only motion is lost
    expect(p.ambientAnim).toBe('paused');
  });

  it('motion and tier are independent axes: low + reduced-motion cuts BOTH cost and motion', () => {
    const p = resolve('low', 1, true);
    expect(p.tier).toBe('low');
    expect(p.heavyShadows).toBe(false);
    expect(p.allowFctCrit).toBe(false);
    expect(p.motion).toBe('none');
    expect(p.ambientAnim).toBe('paused');
  });

  it('advanced clamped to low under reduced-motion still cuts cost and motion', () => {
    const p = resolve('advanced', 0.2, true);
    expect(p.tier).toBe('low');
    expect(p.heavyShadows).toBe(false);
    expect(p.motion).toBe('none');
  });
});

describe('resolveUiEffectsProfile - purity (same input -> same output)', () => {
  it('is deterministic: same inputs yield an equal profile', () => {
    const a = resolve('high', 0.7, false);
    const b = resolve('high', 0.7, false);
    expect(a).toEqual(b);
    // Object identity differs (fresh object) but value is equal: a pure mapping.
    expect(a).not.toBe(b);
  });
});

describe('uiEffectsTokens - the flat --fx-* custom-property map the applier loops', () => {
  it('maps an Ultra profile to the full-effect token values', () => {
    expect(uiEffectsTokens(resolve('ultra', 1, false))).toEqual({
      '--fx-shadow': '1',
      '--fx-ambient-anim': 'running',
      '--motion-scale': '1',
    });
  });

  it('maps a low profile to the cost-cut token values (shadow off, ambient paused)', () => {
    expect(uiEffectsTokens(resolve('low', 1, false))).toEqual({
      '--fx-shadow': '0',
      '--fx-ambient-anim': 'paused',
      '--motion-scale': '1', // low cuts cost but does not, by itself, calm motion
    });
  });

  it('writes a CALM near-zero --motion-scale (0.001, never 0) under reduced-motion so animationend still fires', () => {
    const tk = uiEffectsTokens(resolve('ultra', 1, true));
    expect(tk['--motion-scale']).toBe('0.001');
    expect(tk['--motion-scale']).not.toBe('0');
    expect(Number(tk['--motion-scale'])).toBeGreaterThan(0);
    // Ultra + reduced-motion still keeps glass-tier + shadows; only motion + ambient are cut.
    expect(tk['--fx-shadow']).toBe('1');
    expect(tk['--fx-ambient-anim']).toBe('paused');
  });

  it('maps the worst-case low + reduced-motion profile to ALL three cost+motion cuts at once', () => {
    // The only combination where shadow off AND ambient paused AND motion calmed coincide:
    // the exact token strings the applier stamps for a low-tier reduced-motion player.
    expect(uiEffectsTokens(resolve('low', 1, true))).toEqual({
      '--fx-shadow': '0',
      '--fx-ambient-anim': 'paused',
      '--motion-scale': '0.001',
    });
    // Advanced clamped to low under reduced-motion resolves to the same worst-case tokens.
    expect(uiEffectsTokens(resolve('advanced', 0.2, true))).toEqual({
      '--fx-shadow': '0',
      '--fx-ambient-anim': 'paused',
      '--motion-scale': '0.001',
    });
  });

  it('never emits a data-fx-level key: the applier stamps the tier as an attribute, not a token', () => {
    const tk = uiEffectsTokens(resolve('low', 1, false));
    expect(Object.keys(tk)).toEqual(['--fx-shadow', '--fx-ambient-anim', '--motion-scale']);
  });
});

describe('uiEffectsProfilesEqual - the applier diff-guard (no-op short-circuit)', () => {
  const base = resolve('ultra', 1, false);

  it('is true for two equal profiles (a same-profile re-apply is a no-op)', () => {
    expect(uiEffectsProfilesEqual(base, resolve('ultra', 1, false))).toBe(true);
  });

  it('is false for a null/undefined previous profile (boot must apply once)', () => {
    expect(uiEffectsProfilesEqual(null, base)).toBe(false);
    expect(uiEffectsProfilesEqual(undefined, base)).toBe(false);
  });

  it('is false when ANY single stamped field differs (each of the 5 axes flips the guard)', () => {
    // Each mutation below is a profile the resolver can actually produce, isolating one field.
    expect(uiEffectsProfilesEqual(base, resolve('high', 1, false))).toBe(false); // tier
    expect(uiEffectsProfilesEqual(base, resolve('ultra', 1, true))).toBe(false); // motion + ambient
    expect(uiEffectsProfilesEqual(base, resolve('low', 1, false))).toBe(false); // tier + heavyShadows + ambient + allowFctCrit
    // Hand-built single-field deltas to prove EVERY field is compared independently.
    expect(uiEffectsProfilesEqual(base, { ...base, heavyShadows: false })).toBe(false);
    expect(uiEffectsProfilesEqual(base, { ...base, ambientAnim: 'paused' })).toBe(false);
    expect(uiEffectsProfilesEqual(base, { ...base, allowFctCrit: false })).toBe(false);
    expect(uiEffectsProfilesEqual(base, { ...base, motion: 'none' })).toBe(false);
    expect(uiEffectsProfilesEqual(base, { ...base, tier: 'medium' })).toBe(false);
  });

  it('agrees with the applier contract: equal profile -> skip, any change -> apply', () => {
    // A profile is equal to itself (skip) but never to a profile with a different setting.
    const reduced = resolve('ultra', 1, true);
    expect(uiEffectsProfilesEqual(reduced, reduced)).toBe(true);
    expect(uiEffectsProfilesEqual(base, reduced)).toBe(false);
  });
});

describe('uiEffectsAllowFctCrit - the single FCT-crit gate rule', () => {
  it('skips the crit emphasis ONLY at the low tier', () => {
    expect(uiEffectsAllowFctCrit('low')).toBe(false);
    expect(uiEffectsAllowFctCrit('medium')).toBe(true);
    expect(uiEffectsAllowFctCrit('high')).toBe(true);
    expect(uiEffectsAllowFctCrit('ultra')).toBe(true);
  });

  it('allows crit when data-fx-level is unset (pre-boot / no-JS = full Ultra)', () => {
    expect(uiEffectsAllowFctCrit(undefined)).toBe(true);
    expect(uiEffectsAllowFctCrit(null)).toBe(true);
    expect(uiEffectsAllowFctCrit('')).toBe(true);
  });

  it('agrees with the resolver: allowFctCrit === uiEffectsAllowFctCrit(tier)', () => {
    for (const label of ['low', 'medium', 'high', 'ultra'] as const) {
      const p = resolve(label, 1, false);
      expect(p.allowFctCrit).toBe(uiEffectsAllowFctCrit(p.tier));
    }
  });
});

describe('ui_effects_profile - import absence (two-controller hazard + render/ui isolation)', () => {
  // The load-bearing acceptance: the resolver reads the STATIC preset, never the FPS
  // governor, and is a render-importable LEAF (gfx.ts imports it), so it must import
  // NOTHING from src/render or src/ui and must never touch governor state. Proven by
  // reading the source: the architecture guard forbids render/game/net/three/painter
  // imports for a UI_PURE_CORE, but does NOT forbid a ui/ import, so this pins it too.
  const src = readFileSync(
    fileURLToPath(new URL('../src/game/ui_effects_profile.ts', import.meta.url)),
    'utf8',
  );
  // Blank out comments so prose (which legitimately names the governor + render/ui)
  // cannot create a false positive; only real code is scanned.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('imports nothing at all (a pure leaf: no governor, no render, no ui, no three)', () => {
    expect(code).not.toMatch(/\bimport\b[^;]*\bfrom\b/);
    expect(code).not.toMatch(/\bimport\s*\(/); // no dynamic import either
  });

  it('never reads the FPS governor state (the two-controller hazard)', () => {
    expect(code).not.toMatch(/governor/i);
    expect(code).not.toMatch(/\.state\s*\(/);
    expect(code).not.toMatch(/\.levels\b/);
  });

  it('never reaches into src/render or src/ui', () => {
    expect(code).not.toMatch(/['"][^'"]*\/render\//);
    expect(code).not.toMatch(/['"][^'"]*\/ui\//);
  });
});
