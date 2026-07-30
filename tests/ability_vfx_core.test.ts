// The per-ability spell VFX planning core (src/render/ability_vfx_core.ts) and
// its authored spec table (src/render/ability_vfx_specs.ts): spec keys stay
// real ability ids, colors parse, plans are deterministic and clamped to their
// documented bounds, and the spam-guard budget degrades and recovers on pure
// injected time.
import { describe, expect, it } from 'vitest';
import {
  ABILITY_VFX_ACCENT_CAP,
  ABILITY_VFX_CASTER_CAP,
  ABILITY_VFX_GLOBAL_CAP,
  AbilityVfxBudget,
  abilityVfxColor,
  BURST_COUNT_MAX,
  BURST_COUNT_MIN,
  BURST_POWER_MAX,
  localCasterTier,
  PROJ_SCALE_MAX,
  PROJ_SCALE_MIN,
  planCast,
  planImpact,
  TIER2_BURST_COUNT_MAX,
  VOLLEY_MAX,
} from '../src/render/ability_vfx_core';
import { ABILITY_VFX_SPECS } from '../src/render/ability_vfx_specs';
import { ABILITIES } from '../src/sim/data';

// Pet-management commands with authored visuals but no ABILITIES record.
const NON_ABILITY_SPEC_IDS = new Set(['feed_pet', 'abandon_pet']);

describe('ABILITY_VFX_SPECS table', () => {
  it('keys every spec by a real ability id (or a known pet command)', () => {
    const unknown = Object.keys(ABILITY_VFX_SPECS).filter(
      (id) => ABILITIES[id] === undefined && !NON_ABILITY_SPEC_IDS.has(id),
    );
    expect(unknown, `spec ids missing from ABILITIES:\n${unknown.join('\n')}`).toEqual([]);
  });

  it('every spec color parses as #rrggbb', () => {
    for (const [id, spec] of Object.entries(ABILITY_VFX_SPECS)) {
      expect(spec.c, `${id}: bad color '${spec.c}'`).toMatch(/^#[0-9a-fA-F]{6}$/);
      const value = abilityVfxColor(spec);
      expect(value, `${id}: color out of range`).toBeGreaterThanOrEqual(0);
      expect(value, `${id}: color out of range`).toBeLessThanOrEqual(0xffffff);
      expect(value, `${id}: cached parse drifted`).toBe(abilityVfxColor(spec));
    }
  });
});

describe('planCast / planImpact', () => {
  const qualities = [0, 1];
  const tiers = [0, 1, 2] as const;

  it('is deterministic: same spec, quality, and tier gives the same plan', () => {
    for (const spec of Object.values(ABILITY_VFX_SPECS)) {
      for (const q of qualities) {
        for (const tier of tiers) {
          expect(planCast(spec, q, tier)).toEqual(planCast(spec, q, tier));
          expect(planImpact(spec, true, q, tier)).toEqual(planImpact(spec, true, q, tier));
          expect(planImpact(spec, false, q, tier)).toEqual(planImpact(spec, false, q, tier));
        }
      }
    }
  });

  it('clamps every plan within the documented bounds at quality 0 and 1', () => {
    for (const [id, spec] of Object.entries(ABILITY_VFX_SPECS)) {
      for (const q of qualities) {
        for (const tier of tiers) {
          for (const plan of [
            planCast(spec, q, tier),
            planImpact(spec, true, q, tier),
            planImpact(spec, false, q, tier),
          ]) {
            const label = `${id} q=${q} tier=${tier}`;
            expect(plan.projScale, label).toBeGreaterThanOrEqual(PROJ_SCALE_MIN);
            expect(plan.projScale, label).toBeLessThanOrEqual(PROJ_SCALE_MAX);
            expect(plan.volley, label).toBeGreaterThanOrEqual(1);
            expect(plan.volley, label).toBeLessThanOrEqual(VOLLEY_MAX);
            expect(plan.burstCount, label).toBeGreaterThanOrEqual(BURST_COUNT_MIN);
            expect(plan.burstCount, label).toBeLessThanOrEqual(BURST_COUNT_MAX);
            expect(plan.burstPower, label).toBeGreaterThan(0);
            expect(plan.burstPower, label).toBeLessThanOrEqual(BURST_POWER_MAX);
            expect(plan.ringScale, label).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('scales burst counts down with the quality dial', () => {
    const spec = ABILITY_VFX_SPECS.execute; // sp: 60, the densest authored burst
    expect(planCast(spec, 0).burstCount).toBeLessThan(planCast(spec, 1).burstCount);
    expect(planCast(spec, 1).burstCount).toBe(60);
    expect(planCast(spec, 0).burstCount).toBe(24); // 60 * 0.4
  });

  it('tier 1 halves counts; tier 2 is color-only minimal but every tier keeps the ring', () => {
    const spec = ABILITY_VFX_SPECS.whirlwind; // sp: 34, rg: 1.6
    const full = planCast(spec, 1, 0);
    const reduced = planCast(spec, 1, 1);
    const minimal = planCast(spec, 1, 2);
    expect(full.ringScale).toBeGreaterThan(0);
    expect(reduced.burstCount).toBe(Math.round(full.burstCount / 2));
    // The area telegraph is actionable, so NO degrade tier may drop it: a
    // player whose client is busy (or on a lower preset, once the cap is
    // preset-scaled) must still see where the ground effect lands.
    expect(reduced.ringScale).toBe(full.ringScale);
    expect(minimal.ringScale).toBe(full.ringScale);
    expect(minimal.burstCount).toBeLessThanOrEqual(TIER2_BURST_COUNT_MAX);
    expect(minimal.color).toBe(full.color);
    // impacts degrade the same way and never flash the area ring
    expect(planImpact(spec, true, 1, 2).burstCount).toBeLessThanOrEqual(TIER2_BURST_COUNT_MAX);
    expect(planImpact(spec, true, 1, 0).ringScale).toBe(0);
  });

  it('derives the marquee fields from the compact keys', () => {
    const storm = planCast(ABILITY_VFX_SPECS.lightning_bolt, 1); // b: {j: 1}
    expect(storm.jagged).toBe(true);
    const missiles = planCast(ABILITY_VFX_SPECS.arcane_missiles, 1); // b: {vl: 4}
    expect(missiles.volley).toBe(4);
    const rapid = planCast(ABILITY_VFX_SPECS.rapid_fire, 1); // b: {vl: 5} caps at 4
    expect(rapid.volley).toBe(VOLLEY_MAX);
    const spike = planCast(ABILITY_VFX_SPECS.glacial_spike, 1); // b: {h: 2}, pw 1.45
    expect(spike.projScale).toBe(PROJ_SCALE_MAX);
    const storm2 = planCast(ABILITY_VFX_SPECS.bladestorm, 1); // spin: 1
    expect(storm2.whirl).toBe(true);
    expect(planCast(ABILITY_VFX_SPECS.fireball, 1).whirl).toBe(false);
  });
});

describe('AbilityVfxBudget', () => {
  it('admits the global cap per rolling second, then degrades, then recovers', () => {
    const budget = new AbilityVfxBudget();
    // Casters spread under the per-caster cap: exactly the global cap of
    // casts, all full fidelity.
    for (let i = 0; i < ABILITY_VFX_GLOBAL_CAP; i++) {
      expect(budget.admit(100 + Math.floor(i / ABILITY_VFX_CASTER_CAP), 0.1)).toBe(0);
    }
    // Over the global cap: reduced tier for fresh casters (up to double the cap).
    expect(budget.admit(900, 0.2)).toBe(1);
    for (let i = 0; i < ABILITY_VFX_GLOBAL_CAP - 1; i++) {
      expect(budget.admit(901 + Math.floor(i / ABILITY_VFX_CASTER_CAP), 0.2)).toBe(1);
    }
    // Past double the cap: color-only minimal.
    expect(budget.admit(999, 0.3)).toBe(2);
    // A second later the window has rolled off: full fidelity again.
    expect(budget.admit(999, 1.31)).toBe(0);
  });

  it('caps a single caster at the per-caster cap of full-fidelity casts per rolling second', () => {
    const budget = new AbilityVfxBudget();
    for (let i = 0; i < ABILITY_VFX_CASTER_CAP; i++) expect(budget.admit(7, 0.1)).toBe(0);
    expect(budget.admit(7, 0.2)).toBe(1); // over the per-caster cap
    expect(budget.admit(8, 0.2)).toBe(0); // other casters unaffected
    for (let i = 0; i < ABILITY_VFX_CASTER_CAP - 1; i++) expect(budget.admit(7, 0.2)).toBe(1);
    expect(budget.admit(7, 0.3)).toBe(2); // past double the per-caster cap
    expect(budget.admit(7, 1.31)).toBe(0); // recovered after the window rolls
  });

  it('peek reads the tier without recording a cast', () => {
    const budget = new AbilityVfxBudget();
    // Heavy peeking (unknown casters included) never charges either window.
    for (let i = 0; i < 50; i++) expect(budget.peek(7, 0.1)).toBe(0);
    for (let i = 0; i < ABILITY_VFX_CASTER_CAP; i++) expect(budget.admit(7, 0.1)).toBe(0);
    expect(budget.peek(7, 0.2)).toBe(1); // matches what admit would return
    expect(budget.peek(7, 0.2)).toBe(1); // and repeated peeks never escalate
    expect(budget.peek(8, 0.2)).toBe(0); // unseen caster peeks clean
    expect(budget.peek(7, 1.31)).toBe(0); // window rolls off for peek too
  });

  it('accents ride their own window and never consume cast slots', () => {
    const budget = new AbilityVfxBudget();
    for (let i = 0; i < ABILITY_VFX_ACCENT_CAP; i++) expect(budget.admitAccent(0.1)).toBe(true);
    expect(budget.admitAccent(0.2)).toBe(false); // accent window saturated
    // A full accent window leaves the cast budget untouched.
    for (let i = 0; i < ABILITY_VFX_CASTER_CAP; i++) expect(budget.admit(7, 0.2)).toBe(0);
    // And a busy cast window leaves accents available after it rolls.
    expect(budget.admitAccent(1.31)).toBe(true);
  });

  it('a solo rotation of 2 casts + 2 hits + 2 autos per second stays tier 0', () => {
    const budget = new AbilityVfxBudget();
    for (let s = 0; s < 6; s++) {
      for (let i = 0; i < 2; i++) expect(budget.admit(7, s + i * 0.45)).toBe(0);
      // landed hits and plain autos are accents: they peek and take accent
      // slots, so they can never push the caster over the cast cap
      for (let i = 0; i < 4; i++) {
        expect(budget.peek(7, s + 0.1 + i * 0.2)).toBe(0);
        expect(budget.admitAccent(s + 0.1 + i * 0.2)).toBe(true);
      }
    }
  });

  it('localCasterTier biases the local player one tier up, never exempt', () => {
    expect(localCasterTier(0)).toBe(0);
    expect(localCasterTier(1)).toBe(0);
    expect(localCasterTier(2)).toBe(1);
  });
});
