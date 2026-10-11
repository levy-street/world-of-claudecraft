// The pure half of Gloamveil's climbing shadow (the Shadow priest's form):
// where the dark stands on a body, how a cast and the entry drive it, the cue
// the rig gives the floor layer, and the shader text that draws it. The GLSL
// and its CPU twin are generated from one table, so the text pins below are
// what keeps a hand edit of either from drifting the other.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  cancelGloamEntry,
  createGloamSurge,
  GLOAM_CLIMB_FRAGMENT_COLOR,
  GLOAM_CLIMB_FRAGMENT_EMISSIVE,
  GLOAM_CLIMB_FRAGMENT_PARS,
  GLOAM_CLIMB_MARKER,
  GLOAM_CUE_ENTER,
  GLOAM_CUE_HIDDEN,
  GLOAM_CUE_PRESENT,
  GLOAM_CUE_REST,
  GLOAM_DARK_TINT,
  GLOAM_EDGE_SOFT,
  GLOAM_ENTRY_HOLD,
  GLOAM_ENTRY_SURGE,
  GLOAM_HALO_HEIGHT,
  GLOAM_REST_LEVEL,
  GLOAM_REST_REACH,
  GLOAM_RIM_REST,
  GLOAM_RIM_SWELL,
  GLOAM_STILL_CLOCK,
  GLOAM_SURGE_LEVEL,
  GLOAM_SURGE_REACH,
  gloamCue,
  gloamDark,
  gloamEdge,
  gloamEdgeFor,
  gloamHaloTintInto,
  gloamRimBoost,
  gloamTongue,
  patchGloamClimbFragment,
  startGloamSurge,
  stepGloamSurge,
  stopGloamSurge,
} from '../src/render/characters/gloam_climb_core';

const TAU = Math.PI * 2;

describe('the tongues', () => {
  it('stand out by a bounded, uneven amount around the body', () => {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (let clock = 0; clock < 30; clock += 0.37) {
      for (let k = 0; k < 96; k++) {
        const tongue = gloamTongue((k / 96) * TAU, clock);
        low = Math.min(low, tongue);
        high = Math.max(high, tongue);
      }
    }
    // The three family weights sum to 1.05: never below the level, never more
    // than a full reach above it (a little past, when every family peaks).
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1.05 + 1e-9);
    // And it really is uneven: pointed tongues, not a flat rim.
    expect(high - low).toBeGreaterThan(0.5);
  });

  it('move with the clock and hold one shape on the still clock', () => {
    const angle = 1.1;
    expect(gloamTongue(angle, 2)).not.toBeCloseTo(gloamTongue(angle, 2.4), 3);
    // The still clock is one fixed moment, the one a reduced-motion viewer sees.
    expect(GLOAM_STILL_CLOCK).toBe(0);
    // The still shape keeps its points: reduced motion freezes the tongues, it
    // does not flatten them.
    const still = Array.from({ length: 48 }, (_, k) =>
      gloamTongue((k / 48) * TAU, GLOAM_STILL_CLOCK),
    );
    expect(Math.max(...still) - Math.min(...still)).toBeGreaterThan(0.25);
  });
});

describe('the edge of the dark', () => {
  it('sits on the legs at rest and climbs to the chest mid-cast', () => {
    expect(gloamEdgeFor(0, 0)).toBe(GLOAM_REST_LEVEL);
    expect(gloamEdgeFor(1, 0)).toBeCloseTo(GLOAM_REST_LEVEL + GLOAM_REST_REACH, 12);
    expect(gloamEdgeFor(0, 1)).toBe(GLOAM_SURGE_LEVEL);
    expect(gloamEdgeFor(1, 1)).toBeCloseTo(GLOAM_SURGE_LEVEL + GLOAM_SURGE_REACH, 12);
    // At rest the torso and head keep their own colours, on every side.
    for (let k = 0; k < 64; k++) {
      expect(gloamEdge((k / 64) * TAU, 3.3, 0)).toBeLessThan(0.6);
    }
    // Mid-cast it never reaches the head (the head bone is height 1).
    for (let k = 0; k < 64; k++) {
      const edge = gloamEdge((k / 64) * TAU, 3.3, 1);
      expect(edge).toBeGreaterThanOrEqual(GLOAM_SURGE_LEVEL);
      expect(edge).toBeLessThan(1);
    }
  });

  it('closes over the whole body, halo included, at the entry surge', () => {
    for (let k = 0; k < 64; k++) {
      const edge = gloamEdge((k / 64) * TAU, 0.9, GLOAM_ENTRY_SURGE);
      expect(gloamDark(GLOAM_HALO_HEIGHT, edge)).toBe(1);
    }
  });

  it('is fully dark below, the body own colour above, and soft in between', () => {
    const edge = 0.4;
    expect(gloamDark(edge - GLOAM_EDGE_SOFT, edge)).toBe(1);
    expect(gloamDark(0, edge)).toBe(1);
    expect(gloamDark(edge + GLOAM_EDGE_SOFT, edge)).toBe(0);
    expect(gloamDark(1, edge)).toBe(0);
    expect(gloamDark(edge, edge)).toBeCloseTo(0.5, 12);
  });
});

describe('how dark the dark is (literals, not the module own constants)', () => {
  it('leaves a point low on the leg fully dark on every side, at every moment', () => {
    for (let clock = 0; clock < 20; clock += 0.31) {
      for (let k = 0; k < 72; k++) {
        const angle = (k / 72) * TAU;
        // A tenth of the body up: the shin. At rest and mid-cast alike.
        expect(gloamDark(0.1, gloamEdge(angle, clock, 0))).toBe(1);
        expect(gloamDark(0.1, gloamEdge(angle, clock, 1))).toBe(1);
        // The chest keeps its own colours at rest.
        expect(gloamDark(0.62, gloamEdge(angle, clock, 0))).toBe(0);
      }
    }
  });

  it('pins the level, the reach and what the dark leaves of a surface', () => {
    expect(GLOAM_REST_LEVEL).toBe(0.24);
    expect(GLOAM_SURGE_LEVEL).toBe(0.58);
    expect(GLOAM_REST_REACH).toBe(0.3);
    expect(GLOAM_SURGE_REACH).toBe(0.36);
    expect(GLOAM_EDGE_SOFT).toBe(0.03);
    // Near black with a breath of violet: no channel keeps more than six
    // hundredths of the surface, and none is crushed to nothing.
    expect(GLOAM_DARK_TINT).toEqual([0.035, 0.03, 0.06]);
    for (const channel of GLOAM_DARK_TINT) {
      expect(channel).toBeGreaterThan(0.02);
      expect(channel).toBeLessThanOrEqual(0.06);
    }
    // The shader multiplies by exactly that, and stands at exactly those levels.
    expect(GLOAM_CLIMB_FRAGMENT_COLOR).toContain('diffuseColor.rgb * vec3(0.035, 0.03, 0.06)');
    expect(GLOAM_CLIMB_FRAGMENT_PARS).toContain('mix(0.24, 0.58, uGloamState.x)');
    expect(GLOAM_CLIMB_FRAGMENT_PARS).toContain('mix(0.3, 0.36, uGloamState.x)');
    expect(GLOAM_CLIMB_FRAGMENT_PARS).toContain('smoothstep(edge - 0.03, edge + 0.03, h)');
  });
});

describe('the halo tint (the one unlit piece of a priest rig)', () => {
  it('leaves the halo alone at rest and mid-cast, and darkens it only on the entry', () => {
    const tint: [number, number, number] = [0, 0, 0];
    gloamHaloTintInto(0, tint);
    expect(tint).toEqual([1, 1, 1]);
    gloamHaloTintInto(1, tint);
    expect(tint).toEqual([1, 1, 1]);
    gloamHaloTintInto(GLOAM_ENTRY_SURGE, tint);
    for (let c = 0; c < 3; c++) expect(tint[c]).toBeCloseTo(GLOAM_DARK_TINT[c], 12);
  });
});

describe('the surge', () => {
  it('leaps up with a cast and sinks back slowly', () => {
    const state = createGloamSurge();
    startGloamSurge(state, false);
    let surge = 0;
    for (let i = 0; i < 12; i++) surge = stepGloamSurge(state, 1 / 60, true, false);
    // 0.2 s into a cast it is most of the way up.
    expect(surge).toBeGreaterThan(0.8);
    for (let i = 0; i < 12; i++) surge = stepGloamSurge(state, 1 / 60, false, false);
    // 0.2 s after it, it has barely sunk.
    expect(surge).toBeGreaterThan(0.6);
    for (let i = 0; i < 300; i++) surge = stepGloamSurge(state, 1 / 60, false, false);
    expect(surge).toBeLessThan(0.01);
  });

  it('holds the entry at full for a beat, then recedes to rest', () => {
    const state = createGloamSurge();
    startGloamSurge(state, true);
    expect(stepGloamSurge(state, 0, false, false)).toBe(GLOAM_ENTRY_SURGE);
    // Inside the hold nothing decays.
    expect(stepGloamSurge(state, GLOAM_ENTRY_HOLD * 0.9, false, false)).toBe(GLOAM_ENTRY_SURGE);
    let surge = GLOAM_ENTRY_SURGE;
    let last = surge;
    for (let i = 0; i < 60; i++) {
      surge = stepGloamSurge(state, 1 / 60, false, false);
      expect(surge).toBeLessThanOrEqual(last);
      last = surge;
    }
    // A second later the dark is back near the legs, and it ends at rest.
    expect(surge).toBeLessThan(1);
    for (let i = 0; i < 600; i++) surge = stepGloamSurge(state, 1 / 60, false, false);
    expect(surge).toBeLessThan(1e-6);
  });

  it('starts at rest for a body first seen already in the form', () => {
    const state = createGloamSurge();
    startGloamSurge(state, false);
    expect(stepGloamSurge(state, 1 / 60, false, false)).toBe(0);
  });

  it('drops the entry under reduced motion and keeps the cast response', () => {
    const state = createGloamSurge();
    startGloamSurge(state, true);
    expect(stepGloamSurge(state, 1 / 60, false, true)).toBe(0);
    // Dropped for good, not paused: turning the setting off mid-form replays nothing.
    expect(stepGloamSurge(state, 1 / 60, false, false)).toBe(0);
    let surge = 0;
    for (let i = 0; i < 30; i++) surge = stepGloamSurge(state, 1 / 60, true, true);
    expect(surge).toBeGreaterThan(0.9);
  });

  it('takes the larger of the cast and the entry, and survives a bad frame time', () => {
    const state = createGloamSurge();
    startGloamSurge(state, true);
    for (let i = 0; i < 90; i++) stepGloamSurge(state, 1 / 60, true, false);
    // The entry has receded under 1 by now; the cast holds the dark at the chest.
    expect(state.entry).toBeLessThan(1);
    expect(stepGloamSurge(state, 1 / 60, true, false)).toBeCloseTo(1, 3);
    const before = { ...state };
    for (const dt of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) {
      stepGloamSurge(state, dt, true, false);
      expect(state).toEqual(before);
    }
    stopGloamSurge(state);
    expect(state).toEqual({ cast: 0, entry: 0, age: 0 });
  });

  it('calls an entry off and leaves the cast response running', () => {
    const state = createGloamSurge();
    startGloamSurge(state, true);
    expect(stepGloamSurge(state, 0, false, false)).toBe(GLOAM_ENTRY_SURGE);
    cancelGloamEntry(state);
    expect(stepGloamSurge(state, 0, false, false)).toBe(0);
    // Not replayed by time passing, and a cast still drives it.
    expect(stepGloamSurge(state, 5, false, false)).toBe(0);
    let surge = 0;
    for (let i = 0; i < 30; i++) surge = stepGloamSurge(state, 1 / 60, true, false);
    expect(surge).toBeGreaterThan(0.9);
    expect(surge).toBeLessThanOrEqual(1);
  });
});

describe('the cue a rig gives the floor and smoke layer', () => {
  it('names four distinct states', () => {
    const cues = [GLOAM_CUE_HIDDEN, GLOAM_CUE_PRESENT, GLOAM_CUE_ENTER, GLOAM_CUE_REST];
    expect(new Set(cues).size).toBe(4);
  });

  it('hides under a ghost or stealth body and outside the form, whatever else holds', () => {
    for (const swimming of [false, true]) {
      expect(gloamCue(false, false, false, swimming)).toBe(GLOAM_CUE_HIDDEN);
      expect(gloamCue(false, false, true, swimming)).toBe(GLOAM_CUE_HIDDEN);
      expect(gloamCue(true, true, false, swimming)).toBe(GLOAM_CUE_HIDDEN);
      // A shift under a ghost body is still hidden: nothing may mark a stealther.
      expect(gloamCue(true, true, true, swimming)).toBe(GLOAM_CUE_HIDDEN);
    }
  });

  it('reports the entry only while one is pending', () => {
    expect(gloamCue(true, false, true, false)).toBe(GLOAM_CUE_ENTER);
    expect(gloamCue(true, false, false, false)).toBe(GLOAM_CUE_PRESENT);
  });

  it('rests the layer for a swimming body: no floor to stain', () => {
    expect(gloamCue(true, false, false, true)).toBe(GLOAM_CUE_REST);
    expect(gloamCue(true, false, true, true)).toBe(GLOAM_CUE_REST);
  });
});

describe('the rim breath', () => {
  it('breathes between its rest and its swell, and holds at rest under reduced motion', () => {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (let t = 0; t < 12; t += 0.05) {
      const boost = gloamRimBoost(t, false);
      low = Math.min(low, boost);
      high = Math.max(high, boost);
    }
    expect(low).toBeGreaterThanOrEqual(GLOAM_RIM_REST);
    expect(high).toBeLessThanOrEqual(GLOAM_RIM_REST + GLOAM_RIM_SWELL);
    expect(high - low).toBeGreaterThan(GLOAM_RIM_SWELL * 0.9);
    for (const t of [0, 0.8, 1.6, 7.3]) expect(gloamRimBoost(t, true)).toBe(GLOAM_RIM_REST);
  });
});

describe('the shader layer', () => {
  it('is written from the same tables as the CPU twin', () => {
    // Levels and reaches, as GLSL literals.
    expect(GLOAM_CLIMB_FRAGMENT_PARS).toContain(
      `mix(${GLOAM_REST_LEVEL}, ${GLOAM_SURGE_LEVEL}, uGloamState.x)`,
    );
    expect(GLOAM_CLIMB_FRAGMENT_PARS).toContain(
      `mix(${GLOAM_REST_REACH}, ${GLOAM_SURGE_REACH}, uGloamState.x)`,
    );
    expect(GLOAM_CLIMB_FRAGMENT_PARS).toContain(
      `smoothstep(edge - ${GLOAM_EDGE_SOFT}, edge + ${GLOAM_EDGE_SOFT}, h)`,
    );
    // The three families, each on its own clock (the approved shape).
    for (const family of [
      'sin(a * 3.0 + t * 0.6 + 0.0), 0.0, 1.0), 3.0) * (0.55 + 0.45 * sin(t * 1.7 + a * 2.0 + 0.0)) * 0.5;',
      'sin(a * 5.0 + t * -0.9 + 1.7), 0.0, 1.0), 4.0) * (0.55 + 0.45 * sin(t * 2.3 + a * -3.0 + 0.6)) * 0.35;',
      'sin(a * 8.0 + t * 1.3 + 4.1), 0.0, 1.0), 5.0) * (0.5 + 0.5 * sin(t * 3.1 + a * 1.0 + 0.0)) * 0.2;',
    ]) {
      expect(GLOAM_CLIMB_FRAGMENT_PARS).toContain(family);
    }
    expect(GLOAM_CLIMB_FRAGMENT_COLOR).toContain(`vec3(${GLOAM_DARK_TINT.join(', ')})`);
    // The twin agrees with those literals at a point where each family is read.
    const expected =
      Math.max(0, 0.5 + 0.5 * Math.sin(0.7 * 3 + 2 * 0.6)) ** 3 *
        (0.55 + 0.45 * Math.sin(2 * 1.7 + 0.7 * 2)) *
        0.5 +
      Math.max(0, 0.5 + 0.5 * Math.sin(0.7 * 5 - 2 * 0.9 + 1.7)) ** 4 *
        (0.55 + 0.45 * Math.sin(2 * 2.3 - 0.7 * 3 + 0.6)) *
        0.35 +
      Math.max(0, 0.5 + 0.5 * Math.sin(0.7 * 8 + 2 * 1.3 + 4.1)) ** 5 *
        (0.5 + 0.5 * Math.sin(2 * 3.1 + 0.7)) *
        0.2;
    expect(gloamTongue(0.7, 2)).toBeCloseTo(expected, 12);
  });

  it('costs a body out of the form one branch: the whole climb sits behind it', () => {
    const color = GLOAM_CLIMB_FRAGMENT_COLOR;
    const guard = color.indexOf('if (uGloamBody.w > 0.0) {');
    expect(guard).toBeGreaterThan(-1);
    expect(color.indexOf('gloamClimb(')).toBeGreaterThan(guard);
    expect(color.indexOf('diffuseColor.rgb = mix(')).toBeGreaterThan(guard);
    // Outside the branch the shader only declares the amount as zero.
    expect(color.slice(0, guard).trim()).toBe('float gloam = 0.0;');
    expect(GLOAM_CLIMB_FRAGMENT_EMISSIVE.trim().startsWith('if (gloam > 0.0) {')).toBe(true);
  });

  it('measures camera-relative, so it needs no varying and holds far from the origin', () => {
    expect(GLOAM_CLIMB_FRAGMENT_COLOR).toContain(
      '(-vViewPosition) * mat3(viewMatrix) + (cameraPosition - uGloamBody.xyz)',
    );
    expect(GLOAM_CLIMB_FRAGMENT_PARS).not.toMatch(/\bvarying\b/);
    // atan(0, 0) is undefined: the angle is guarded.
    expect(GLOAM_CLIMB_FRAGMENT_PARS).toContain('atan(fromFeet.z, fromFeet.x + 1e-6)');
  });

  it("splices into three's lit shaders once, at all three anchors", () => {
    for (const lib of ['standard', 'physical', 'lambert'] as const) {
      const source = THREE.ShaderLib[lib].fragmentShader;
      const patched = patchGloamClimbFragment(source);
      expect(patched).not.toBe(source);
      expect(patched.split(GLOAM_CLIMB_MARKER).length - 1).toBe(1);
      // Declarations after <common>, the darkening right after the surface
      // colour is final, the ember line after the emissive map.
      expect(patched).toContain(`#include <common>${GLOAM_CLIMB_FRAGMENT_PARS}`);
      expect(patched).toContain(`#include <color_fragment>${GLOAM_CLIMB_FRAGMENT_COLOR}`);
      expect(patched).toContain(`#include <emissivemap_fragment>${GLOAM_CLIMB_FRAGMENT_EMISSIVE}`);
      expect(patched.indexOf('float gloam = 0.0;')).toBeLessThan(
        patched.indexOf('if (gloam > 0.0) {'),
      );
      // Idempotent: a second pass over a patched shader changes nothing.
      expect(patchGloamClimbFragment(patched)).toBe(patched);
    }
  });

  it('leaves an unlit shader alone', () => {
    const basic = THREE.ShaderLib.basic.fragmentShader;
    expect(patchGloamClimbFragment(basic)).toBe(basic);
    expect(patchGloamClimbFragment('void main() {}')).toBe('void main() {}');
  });
});
