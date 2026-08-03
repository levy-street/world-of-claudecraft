// The rarity-tier weapon VFX data layer (src/render/weapon_vfx.ts, ported from
// the asset-pipeline viewer's weapon_vfx.js). Pure data + resolution logic:
// importable in plain Node (no DOM/WebGL at module scope).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TUNING,
  SCENE_PRESETS,
  TIERS,
  vfxSpecFor,
  WEAPON_VFX,
} from '../src/render/weapon_vfx';

const KNOWN_FX_KINDS = ['coreSprite', 'motes', 'aurora', 'drift', 'twinkles'];

describe('WEAPON_VFX specs', () => {
  it('has at least 20 weapons and every tier exists in TIERS', () => {
    const entries = Object.entries(WEAPON_VFX);
    expect(entries.length).toBeGreaterThanOrEqual(20);
    const tierNames = Object.keys(TIERS);
    for (const [key, spec] of entries) {
      expect(tierNames, `${key}: unknown tier '${spec.tier}'`).toContain(spec.tier);
    }
  });

  it('keeps every shell power strictly positive, on the tier and on any override', () => {
    // The rim shell raises its fresnel term to this exponent. Since the domain
    // guard landed, that base reaches EXACTLY 0.0 on the silhouette instead of a
    // tiny epsilon, and pow(0.0, y) is undefined for y <= 0 the same way a
    // negative base is: it would NaN a whole rim band into the bloom, which is
    // the black rectangle this pair of pins exists to keep shut. See
    // tests/shader_pow_domain.test.ts for the base half.
    for (const [name, tier] of Object.entries(TIERS)) {
      expect(tier.shell.power, `tier ${name}: shell.power must be > 0`).toBeGreaterThan(0);
    }
    for (const [key, spec] of Object.entries(WEAPON_VFX)) {
      if (spec.shell?.power === undefined) continue;
      expect(spec.shell.power, `${key}: shell.power override must be > 0`).toBeGreaterThan(0);
    }
  });

  it('uses only known fx component kinds', () => {
    for (const [key, spec] of Object.entries(WEAPON_VFX)) {
      expect(spec.fx.length, `${key}: empty fx array`).toBeGreaterThan(0);
      for (const c of spec.fx) {
        expect(KNOWN_FX_KINDS, `${key}: unknown fx kind '${c.kind}'`).toContain(c.kind);
      }
    }
  });
});

describe('vfxSpecFor', () => {
  it('resolves a known weapon asset to its spec (ice_fang is epic)', () => {
    const hit = vfxSpecFor({ name: 'ice_fang', category: 'weapons' });
    expect(hit).not.toBeNull();
    expect(hit?.key).toBe('ice_fang');
    expect(hit?.spec.tier).toBe('epic');
    expect(hit?.spec).toBe(WEAPON_VFX.ice_fang);
  });

  it('resolves a generated job by weaponKey', () => {
    const hit = vfxSpecFor({ name: 'job_123', category: 'generated', weaponKey: 'frostbite' });
    expect(hit?.key).toBe('frostbite');
    expect(hit?.spec.tier).toBe('epic');
  });

  it('returns null for unknown or non-weapon assets', () => {
    expect(vfxSpecFor({ name: 'no_such_weapon', category: 'weapons' })).toBeNull();
    expect(vfxSpecFor({ name: 'ice_fang', category: 'props' })).toBeNull();
    expect(vfxSpecFor(null)).toBeNull();
  });
});

describe('tuning defaults and scene presets', () => {
  it('DEFAULT_TUNING is all numeric multipliers', () => {
    const keys = Object.keys(DEFAULT_TUNING);
    expect(keys.length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(DEFAULT_TUNING)) {
      expect(typeof value, `tuning '${key}' is not a number`).toBe('number');
    }
  });

  it('SCENE_PRESETS includes day and night presets', () => {
    expect(SCENE_PRESETS.day).toBeDefined();
    expect(SCENE_PRESETS.day.label).toBeTruthy();
    expect(SCENE_PRESETS.night).toBeDefined();
    expect(SCENE_PRESETS.night.label).toBeTruthy();
  });
});
