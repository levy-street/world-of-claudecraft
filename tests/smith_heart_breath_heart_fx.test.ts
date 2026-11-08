// The Knotted Gale's look (breath_heart_fx_core.ts): what the sim's numbers paint, the
// floor rungs untied, the throw's arc, the burst. And BreathFightFx really takes the
// mechanic's objects and marks: the same fight state a player acts on.

import { describe, expect, it } from 'vitest';
import {
  burstLook,
  FLIGHT_LOOK,
  FLIGHT_TRAIL,
  flightGhost,
  flightScale,
  HEART_COLORS,
  HEART_FLOOR,
  HEART_POOLS,
  HEART_SIDES,
  heartObjectKind,
  heartRungs,
  knotLook,
  LINK_R,
  LINK_Y,
  liveFuse,
  markFill,
  markSideOf,
  portalLink,
  portalSideLook,
  portalSideOfKind,
  THROW_ARC,
  throwHeading,
  throwOffset,
} from '../src/render/smith_heart_fx/breath_heart_fx_core';
import { PORTAL_LINK_FRAG, PORTAL_LINK_VERT } from '../src/render/smith_heart_fx/breath_heart_glsl';
import {
  BREATH_AURAS,
  BREATH_OBJECTS,
  knotTemplate,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart/breath_ids';

describe('Knotted Gale: the look', () => {
  it('knows its objects and nothing else', () => {
    expect(heartObjectKind(knotTemplate('held', 3))).toBe('knot');
    expect(heartObjectKind(BREATH_OBJECTS.portalA)).toBe('portalA');
    expect(heartObjectKind(BREATH_OBJECTS.portalB)).toBe('portalB');
    expect(heartObjectKind(BREATH_OBJECTS.portalC)).toBe('portalC');
    expect(heartObjectKind(BREATH_OBJECTS.portalD)).toBe('portalD');
    expect(heartObjectKind(BREATH_OBJECTS.vortex)).toBeNull();
  });

  it('the ring shrinks to the pick-up as the ball grows and rages', () => {
    const full = knotLook(T.heartFuse);
    const end = knotLook(0);
    expect(end.ringR).toBeCloseTo(T.heartPickR, 5);
    expect(full.ringR).toBeGreaterThan(end.ringR + 4);
    expect(end.radius).toBeGreaterThan(full.radius);
    expect(end.crackle).toBeGreaterThan(full.crackle);
    expect(end.spin).toBeGreaterThan(full.spin);
    expect(full.danger).toBe(0);
    expect(end.danger).toBe(1);
    expect(full.throb).toBe(0);
    expect(knotLook(1).throb).toBeGreaterThan(0);
    let last = Number.POSITIVE_INFINITY;
    for (let f = T.heartFuse; f >= 0; f -= 1) {
      const r = knotLook(f).ringR;
      expect(r).toBeLessThan(last);
      last = r;
    }
    expect(liveFuse(10, 0.25)).toBeCloseTo(9.75, 6);
    expect(liveFuse(0.5, 3)).toBe(0);
  });

  it('every floor rung is its own, above the fight footprints', () => {
    const rungs = heartRungs();
    expect(new Set(rungs).size).toBe(rungs.length);
    for (const r of rungs) expect(r).toBeGreaterThan(30);
    expect(HEART_FLOOR.ring).toBeGreaterThan(HEART_FLOOR.disc);
  });

  it('the link, the marks, the throw and the burst', () => {
    const l = portalLink(0, 0, 0, 10);
    expect(l.len).toBe(10);
    expect(l.mz).toBe(5);
    expect(markFill(5, 5)).toBe(0);
    expect(markFill(0, 5)).toBe(1);
    const h = throwHeading(14, 221);
    expect(Math.hypot(h.x, h.z)).toBeCloseTo(1, 6);
    expect(h.z).toBeGreaterThan(0);
    const out = { x: 0, y: 0, z: 0 };
    expect(throwOffset(THROW_ARC.seconds * 0.3, h, out)).toBe(true);
    expect(out.y).toBeGreaterThan(0);
    expect(throwOffset(THROW_ARC.seconds * 0.95, h, out)).toBe(true);
    expect(out.y).toBeLessThan(0);
    expect(throwOffset(THROW_ARC.seconds, h, out)).toBe(false);
    const a = burstLook(0.1);
    const b = burstLook(1);
    expect(b?.radius ?? 0).toBeGreaterThan(a?.radius ?? 0);
    expect(burstLook(5)).toBeNull();
  });

  it('the thrown ball reads in flight: held large, haloed, a wake along its arc', () => {
    // Never the old pale orb shrinking to 0.4: it stays at least the size of a ball
    // ripe in a carrier's hands (knotLook's radius runs 0.85 to 1.6) the whole way.
    expect(flightScale(0)).toBe(FLIGHT_LOOK.start);
    expect(flightScale(THROW_ARC.seconds)).toBe(FLIGHT_LOOK.end);
    expect(flightScale(THROW_ARC.seconds * 2)).toBe(FLIGHT_LOOK.end);
    for (let t = 0; t <= THROW_ARC.seconds; t += 0.1)
      expect(flightScale(t)).toBeGreaterThanOrEqual(1);
    // Its halo is wider than the ball, so its dark rim shows round it.
    expect(FLIGHT_LOOK.halo).toBeGreaterThan(1.2);
    // The wake: each ghost further back along the arc, smaller and fainter, never
    // past a visible alpha or the ball's own size.
    let last = { lag: 0, scale: 1, alpha: 1 };
    for (let i = 0; i < FLIGHT_TRAIL.ghosts; i++) {
      const g = flightGhost(i);
      expect(g.lag).toBeGreaterThan(last.lag);
      expect(g.scale).toBeLessThan(last.scale);
      expect(g.alpha).toBeLessThan(last.alpha);
      expect(g.alpha).toBeGreaterThan(0);
      last = g;
    }
    // The whole wake trails a short stretch of the arc, not the whole throw.
    expect(flightGhost(FLIGHT_TRAIL.ghosts - 1).lag).toBeLessThan(THROW_ARC.seconds / 3);
  });

  it('the second pair reads apart from the first: colour, pattern, link and letter', () => {
    const looks = HEART_SIDES.map((side) => portalSideLook(side));
    // Four colours, none shared.
    expect(new Set(looks.map((l) => l.color)).size).toBe(4);
    expect(looks.map((l) => l.color)).toEqual([
      HEART_COLORS.a,
      HEART_COLORS.b,
      HEART_COLORS.c,
      HEART_COLORS.d,
    ]);
    // Neither second-pair colour is the load's gold or the fuse's red.
    for (const c of [HEART_COLORS.c, HEART_COLORS.d]) {
      expect(c).not.toBe(HEART_COLORS.load);
      expect(c).not.toBe(HEART_COLORS.danger);
    }
    // Each pair one pattern: the second turns the other way, three arms, doubled rim.
    expect(looks.map((l) => l.pair)).toEqual([0, 0, 1, 1]);
    expect(looks.map((l) => l.slot)).toEqual([0, 1, 2, 3]);
    for (const l of looks) {
      expect(l.spin).toBe(l.pair === 0 ? 1 : -1);
      expect(l.arms).toBe(l.pair === 0 ? 4 : 3);
      expect(l.ring2).toBe(l.pair);
    }
    // The pools hold both pairs and both links; the braid rides above the beam.
    expect(HEART_POOLS.portals).toBe(4);
    expect(HEART_POOLS.links).toBe(2);
    expect(HEART_POOLS.marks).toBeGreaterThanOrEqual(4);
    expect(LINK_Y[1]).toBeGreaterThan(LINK_Y[0]);
    // Each link is a tube of light nearly a yard across (the audit's point 15: the
    // flat ribbon read as a faint line), the braid wound a little wider.
    expect(LINK_R[0]).toBeGreaterThanOrEqual(0.4);
    expect(LINK_R[1]).toBeGreaterThan(LINK_R[0]);
    expect(PORTAL_LINK_VERT).toContain('vFace');
    expect(PORTAL_LINK_FRAG).toContain('core');
    // The objects and the marks name their side.
    expect(portalSideOfKind('portalC')).toBe('C');
    expect(portalSideOfKind('knot')).toBeNull();
    expect(markSideOf(BREATH_AURAS.portalA)).toBe('A');
    expect(markSideOf(BREATH_AURAS.portalD)).toBe('D');
    expect(markSideOf(BREATH_AURAS.laden)).toBeNull();
  });
});

describe('Knotted Gale: the portal letters read upright', () => {
  it('the mouth letter turns on the floor to the camera, never a fixed decal', async () => {
    const glsl = await import('../src/render/smith_heart_fx/breath_heart_glsl');
    // Laid flat (one height for every vertex), turned by the camera's bearing.
    expect(glsl.FLOOR_FACING_VERT).toContain('cameraPosition.xz');
    expect(glsl.FLOOR_FACING_VERT).toContain('wocCamRelView(vec3(xz.x, c.y, xz.y))');
  });
});
