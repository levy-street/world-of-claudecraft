// Vael's staging visuals on the Beacon Crown (src/render/sunken_bastion/
// bastion_vael_stage_core.ts, the reveal half of bastion_boss_fx_core.ts and
// bastion_shade_ghost_core.ts) and the manifest rows that play his entrance:
// the pure plans every painter reads, pinned to the sim's own beats.

import { describe, expect, it } from 'vitest';
import { castClipSyncs } from '../src/render/characters/anim_state';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  auraReveal,
  beaconVeilBoost,
  beamPoolOpacity,
  REVEAL_RING_RADIUS,
  revealRingRadius,
} from '../src/render/sunken_bastion/bastion_boss_fx_core';
import { VAEL_VEIL_RISE_CLIP_RATE } from '../src/render/sunken_bastion/bastion_gaol_reaper_core';
import { bastionShadeGhosted } from '../src/render/sunken_bastion/bastion_shade_ghost_core';
import {
  ERUPTION_SECONDS,
  eruptionFlash,
  eruptionPillar,
  eruptionShake,
  eruptionShockwave,
  gatherGlow,
  gatherProgress,
  gatherVortex,
  isVaelHome,
  isVaelRiseCast,
  SHOCKWAVE_SECONDS,
  sweepFlash,
} from '../src/render/sunken_bastion/bastion_vael_stage_core';
import {
  CROWN,
  FOG_SHADE_ID,
  VAEL_BEACON_LIT,
  VAEL_DROWNING_HYMN,
  VAEL_HOME,
  VAEL_ID,
  VAEL_INTRO_RISE,
  VAEL_INTRO_STOPS,
  VAEL_REAPING_SCYTHE,
  VAEL_SHADE_HOLLOW,
  VAEL_SHADOWSTEP,
  VAEL_SINK,
  VAEL_TUNING,
  VAEL_VEIL_GATHER,
  VAEL_VEIL_RISE,
} from '../src/sim/encounters/sunken_bastion/ids';
import type { Entity } from '../src/sim/types';

const def = VISUALS[visualKeyFor({ kind: 'mob', templateId: VAEL_ID } as Entity)];

describe('Vael entrance: the manifest plays it on the bars', () => {
  it('rises with Emerge at the veil pace, sinks with Vanish, sings the fog in with Hymn', () => {
    const by = def.clips.castByAbility ?? {};
    expect(by[VAEL_INTRO_RISE]).toBe('Emerge');
    expect(by[VAEL_SINK]).toBe('Vanish');
    expect(by[VAEL_VEIL_GATHER]).toBe('Hymn');
    expect(def.clips.castTimeScaleByAbility?.[VAEL_INTRO_RISE]).toBeCloseTo(
      VAEL_VEIL_RISE_CLIP_RATE,
      9,
    );
    // The rise and the sink follow their bars; the gathering song loops.
    for (const id of [VAEL_INTRO_RISE, VAEL_SINK])
      expect(castClipSyncs(def.castClipSync, id)).toBe(true);
    for (const id of [VAEL_VEIL_GATHER, VAEL_DROWNING_HYMN])
      expect(castClipSyncs(def.castClipSync, id)).toBe(false);
  });

  it('every rise out of the roof is a rise (the boil and fog), nothing else is', () => {
    expect(isVaelRiseCast(VAEL_VEIL_RISE)).toBe(true);
    expect(isVaelRiseCast(VAEL_INTRO_RISE)).toBe(true);
    for (const c of [
      VAEL_SINK,
      VAEL_SHADOWSTEP,
      VAEL_REAPING_SCYTHE,
      VAEL_VEIL_GATHER,
      null,
      undefined,
    ])
      expect(isVaelRiseCast(c)).toBe(false);
  });

  it('only the last stop is his place', () => {
    const last = VAEL_INTRO_STOPS[VAEL_INTRO_STOPS.length - 1];
    expect(isVaelHome(last.x, last.z)).toBe(true);
    expect(isVaelHome(VAEL_HOME.x, VAEL_HOME.z)).toBe(true);
    for (const s of VAEL_INTRO_STOPS.slice(0, -1)) expect(isVaelHome(s.x, s.z)).toBe(false);
  });
});

describe('Vael entrance: the eruption plan', () => {
  it('the pillar bursts up, burns through the rise and dies after it', () => {
    expect(eruptionPillar(-0.1, false).alpha).toBe(0);
    expect(eruptionPillar(0.25, false).alpha).toBeCloseTo(1, 5);
    expect(eruptionPillar(VAEL_TUNING.veilRiseSeconds, false).alpha).toBeCloseTo(1, 5);
    expect(eruptionPillar(ERUPTION_SECONDS - 0.05, false).alpha).toBeLessThan(0.15);
    expect(eruptionPillar(ERUPTION_SECONDS, false).alpha).toBe(0);
    // His place: taller and wider than any stop on the way.
    const stop = eruptionPillar(0.6, false);
    const home = eruptionPillar(0.6, true);
    expect(home.height).toBeGreaterThan(stop.height * 1.4);
    expect(home.radius).toBeGreaterThan(stop.radius);
  });

  it('the shockwave races out and thins away; the flash is brief; the home quake is the big one', () => {
    let prev = 0;
    for (let t = 0; t < SHOCKWAVE_SECONDS; t += 0.05) {
      const w = eruptionShockwave(t, false);
      expect(w.radius).toBeGreaterThanOrEqual(prev);
      prev = w.radius;
    }
    expect(eruptionShockwave(0.7, true).radius).toBeGreaterThan(
      eruptionShockwave(0.7, false).radius,
    );
    expect(eruptionShockwave(SHOCKWAVE_SECONDS, false).alpha).toBe(0);
    expect(eruptionFlash(0, true)).toBeGreaterThan(eruptionFlash(0, false));
    expect(eruptionFlash(0.5, true)).toBe(0);
    expect(eruptionShake(true)).toBeGreaterThan(eruptionShake(false) * 2);
  });
});

describe('the fog gathering before the veil', () => {
  it('closes from the rim onto the crown over the bar and the sink, darker as it closes', () => {
    const total = VAEL_TUNING.veilGatherSeconds + VAEL_TUNING.vanishSeconds;
    expect(gatherProgress(0)).toBe(0);
    expect(gatherProgress(total)).toBe(1);
    const start = gatherVortex(0.05);
    const end = gatherVortex(1);
    expect(start.outer).toBeGreaterThan(CROWN.r);
    expect(end.outer).toBeLessThan(CROWN.r / 2);
    expect(end.inner).toBeLessThan(start.inner);
    expect(end.alpha).toBeGreaterThan(start.alpha);
    expect(end.swirl).toBeGreaterThan(start.swirl);
    for (let p = 0; p <= 1; p += 0.05)
      expect(gatherVortex(p).inner).toBeLessThan(gatherVortex(p).outer);
    expect(gatherGlow(0)).toBe(0);
    expect(gatherGlow(1)).toBe(1);
    expect(gatherGlow(0.5)).toBeLessThan(gatherGlow(0.8));
  });

  it('the scythe flash lands full and is gone in a third of a second', () => {
    expect(sweepFlash(0)).toBe(1);
    expect(sweepFlash(0.4)).toBe(0);
  });
});

describe('the beacon reveal: keyed on what the sim left on each figure', () => {
  it('the real Vael reads Beacon-Lit, a shade reads Hollow, nothing else reads at all', () => {
    expect(auraReveal(VAEL_ID, [{ id: VAEL_BEACON_LIT }])).toBe('real');
    expect(auraReveal(FOG_SHADE_ID, [{ id: VAEL_SHADE_HOLLOW }])).toBe('shade');
    // The wrong tell on the wrong body never counts.
    expect(auraReveal(VAEL_ID, [{ id: VAEL_SHADE_HOLLOW }])).toBeNull();
    expect(auraReveal(FOG_SHADE_ID, [{ id: VAEL_BEACON_LIT }])).toBeNull();
    expect(auraReveal('drowned_thrall', [{ id: VAEL_BEACON_LIT }])).toBeNull();
    expect(auraReveal(VAEL_ID, undefined)).toBeNull();
  });

  it('a hollow shade ghosts its whole body; the real one never does', () => {
    expect(
      bastionShadeGhosted({ templateId: FOG_SHADE_ID, auras: [{ id: VAEL_SHADE_HOLLOW }] }),
    ).toBe(true);
    expect(bastionShadeGhosted({ templateId: FOG_SHADE_ID, auras: [] })).toBe(false);
    expect(bastionShadeGhosted({ templateId: VAEL_ID, auras: [{ id: VAEL_SHADE_HOLLOW }] })).toBe(
      false,
    );
    expect(bastionShadeGhosted({ templateId: VAEL_ID, auras: [{ id: VAEL_BEACON_LIT }] })).toBe(
      false,
    );
  });

  it('the beam flares up fast for the veil and settles slowly after; the lit sector reads bright', () => {
    let b = 0;
    for (let i = 0; i < 10; i++) b = beaconVeilBoost(b, true, 0.05);
    expect(b).toBeGreaterThan(0.99);
    b = beaconVeilBoost(b, false, 0.05);
    expect(b).toBeGreaterThan(0.9);
    for (let i = 0; i < 40; i++) b = beaconVeilBoost(b, false, 0.05);
    expect(b).toBe(0);
    for (let t = 0; t < 2; t += 0.07) expect(beamPoolOpacity(t)).toBeGreaterThanOrEqual(0.45);
    expect(revealRingRadius(1, 0)).toBeCloseTo(REVEAL_RING_RADIUS, 5);
    expect(revealRingRadius(0, 0)).toBeLessThan(REVEAL_RING_RADIUS);
  });
});
