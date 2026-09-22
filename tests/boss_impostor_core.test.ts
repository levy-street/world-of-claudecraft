// The world boss's far sprite (src/render/boss_impostor_core.ts) and the interest widening
// that makes it reachable at all (server/interest_scope.ts).
//
// Both halves are in one file on purpose, because the defect this feature is exposed to is
// the two halves disagreeing. A far sprite the client can draw at 400 yards over an entity
// the server stops sending at 90 is a feature that looks finished in the code, passes every
// single-sided test, and does absolutely nothing in play. That failure is silent in offline
// single-player too, where the whole world is resident, which is exactly where a screenshot
// would have been taken.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { interestLimitSq, LandmarkRoster, landmarkInterestSq } from '../server/interest_policy';
import {
  BOSS_IMPOSTOR_BAKE_KEY,
  BOSS_IMPOSTOR_BAKE_KEY_SHARE,
  BOSS_IMPOSTOR_BAKE_SKY,
  BOSS_IMPOSTOR_FOG_CEILING,
  BOSS_IMPOSTOR_FRAME_MARGIN,
  BOSS_IMPOSTOR_MOON_COOL,
  BOSS_IMPOSTOR_VIEWS,
  type BossImpostorShowInput,
  bossImpostorBearing,
  bossImpostorFogMix,
  bossImpostorFrame,
  bossImpostorFrameMetrics,
  bossImpostorLightGrade,
  bossImpostorQuadPlacement,
  bossImpostorShows,
  rigShownFromView,
} from '../src/render/boss_impostor_core';
import { characterViewOutsideHysteresis } from '../src/render/character_view_core';
import {
  dayNightGrade,
  effectiveDayness,
  NEUTRAL_DAY_GRADE,
  realmLightTint,
} from '../src/render/day_night_core';
import { MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

const BALGATH = 'balgath_cyclops';
const LANDMARK_RANGE = MOBS[BALGATH]?.landmarkRange ?? 0;

/**
 * The renderer's own band edges, read out of its source.
 *
 * Parsed rather than imported because importing renderer.ts drags Three and the whole scene
 * graph into a Node test for two integers; parsed rather than copied because a copy is what
 * lets the two halves silently disagree when someone retunes the draw range.
 */
const rendererRange = (name: string): number => {
  const src = readFileSync('src/render/renderer.ts', 'utf8');
  const m = src.match(new RegExp(`${name} = (\\d+)`));
  if (!m) throw new Error(`renderer.ts no longer declares ${name}`);
  return Number(m[1]);
};
const ENTITY_VIEW_DESTROY_RANGE = rendererRange('ENTITY_VIEW_DESTROY_RANGE');
const ENTITY_DRAW_RANGE = rendererRange('ENTITY_DRAW_RANGE');

const show = (over: Partial<BossImpostorShowInput> = {}): boolean =>
  bossImpostorShows({
    rigShown: false,
    dist: 150,
    landmarkRange: LANDMARK_RANGE,
    dead: false,
    asleep: false,
    ...over,
  });

describe('exactly one of him: the sprite gives way to the rig', () => {
  it('draws nothing while the renderer is drawing his rig, at any distance', () => {
    // The first cut had its own distance curve and overlapped the rig through two bands
    // (a ghost sprite over the rig approaching, sprite AND rig receding). The rig's own
    // visibility is the only input that can never disagree with the rig.
    for (const dist of [0, 40, 79, 80, 88, 95, 96, 120]) {
      expect(show({ rigShown: true, dist })).toBe(false);
    }
  });

  it('draws the sprite the moment the rig is not drawn, anywhere inside the landmark range', () => {
    for (const dist of [0, 81, 96, 97, 200, LANDMARK_RANGE]) {
      expect(show({ rigShown: false, dist })).toBe(true);
    }
  });

  it('never draws a dead, sleeping, or non-landmark mob', () => {
    expect(show({ dead: true })).toBe(false);
    // Folded into his crater he is a landmark at his lair, not a silhouette on the horizon.
    expect(show({ asleep: true })).toBe(false);
    expect(show({ landmarkRange: undefined })).toBe(false);
    expect(show({ landmarkRange: 0 })).toBe(false);
  });

  it('stops at the landmark range, where the server stops sending him anyway', () => {
    expect(show({ dist: LANDMARK_RANGE + 0.01 })).toBe(false);
    expect(show({ dist: 5000 })).toBe(false);
  });

  it('inherits the rig band hysteresis by construction: one representation at every step', () => {
    // Drive the renderer's own visibility rule out past the band and back in, and check the
    // sprite is on exactly when the rig is off. The flips land on the renderer's numbers
    // (hide at 96 receding, show at 80 approaching) without this module knowing either.
    const createSq = ENTITY_DRAW_RANGE ** 2;
    const destroySq = ENTITY_VIEW_DESTROY_RANGE ** 2;
    let rigShown = true;
    const flips: Array<{ dist: number; rigShown: boolean }> = [];
    const step = (dist: number) => {
      const next = !characterViewOutsideHysteresis(rigShown, dist * dist, createSq, destroySq);
      if (next !== rigShown) flips.push({ dist, rigShown: next });
      rigShown = next;
      const sprite = show({ rigShown, dist });
      expect(sprite, `at ${dist} yd`).toBe(!rigShown);
    };
    for (let d = 10; d <= 200; d += 0.5) step(d);
    for (let d = 200; d >= 10; d -= 0.5) step(d);
    expect(flips).toEqual([
      { dist: ENTITY_VIEW_DESTROY_RANGE + 0.5, rigShown: false },
      { dist: ENTITY_DRAW_RANGE, rigShown: true },
    ]);
  });
});

describe('the rig-shown input is the RANGE band, nothing else', () => {
  // The renderer feeds bossImpostorShows from this one predicate over its EntityView, so
  // which of the view's hide reasons count is pinned here rather than in the renderer.
  it('reads range-hidden as the rig not drawn (the sprite takes over)', () => {
    expect(rigShownFromView({ rangeHidden: true, compilePending: false })).toBe(false);
  });
  it('ignores the compile gate and the cull: a hidden-but-in-range rig is still the rig', () => {
    // A boss spawning thirty yards away must not flash as a flat sprite while his shader
    // programs link, so those hide reasons are invisible to the impostor.
    expect(rigShownFromView({ rangeHidden: false, compilePending: true })).toBe(true);
    expect(rigShownFromView({ rangeHidden: false, compilePending: false })).toBe(true);
  });
  it('treats no view at all as no rig (the server-side landmark with nothing built yet)', () => {
    expect(rigShownFromView(undefined)).toBe(false);
  });
});

describe('frame-exact placement: the quad is the rectangle the cells were shot in', () => {
  // A body whose bounds are deliberately off-centre on every axis, so a derivation that
  // silently assumed a centred model (or feet at the box middle) would fail here.
  const bounds = { min: { x: -2, y: 0.4, z: -1 }, max: { x: 3, y: 12.4, z: 6 } };

  it('frames the larger horizontal extent with the shared margin, and the full height', () => {
    const f = bossImpostorFrameMetrics(bounds);
    // z span (7) beats x span (5): he spins inside the frame, so his depth becomes his width.
    expect(f.w).toBeCloseTo(7 * BOSS_IMPOSTOR_FRAME_MARGIN, 9);
    expect(f.h).toBeCloseTo(12 * BOSS_IMPOSTOR_FRAME_MARGIN, 9);
    expect(BOSS_IMPOSTOR_FRAME_MARGIN).toBeGreaterThan(1);
    expect(BOSS_IMPOSTOR_FRAME_MARGIN).toBeLessThan(1.1);
  });

  it('centres on the bounding-box middle, which is where the bake camera looked', () => {
    const f = bossImpostorFrameMetrics(bounds);
    expect(f.cx).toBeCloseTo(0.5, 9);
    expect(f.cy).toBeCloseTo(6.4, 9);
    expect(f.cz).toBeCloseTo(2.5, 9);
  });

  it('scales the frame with the entity, and anchors the centre above the feet by the same scale', () => {
    const f = bossImpostorFrameMetrics(bounds);
    const q = bossImpostorQuadPlacement(f, 2, 0, { x: 100, y: 5, z: -40 });
    expect(q.w).toBeCloseTo(f.w * 2, 9);
    expect(q.h).toBeCloseTo(f.h * 2, 9);
    expect(q.x).toBeCloseTo(100 + 0.5 * 2, 9);
    expect(q.y).toBeCloseTo(5 + 6.4 * 2, 9);
    expect(q.z).toBeCloseTo(-40 + 2.5 * 2, 9);
  });

  it('turns the centre offset with his facing the way three turns the far mesh', () => {
    // Three's Ry: x' = c x + s z, z' = -s x + c z. A quarter turn takes a +z offset to +x.
    const f = bossImpostorFrameMetrics({ min: { x: -1, y: 0, z: 1 }, max: { x: 1, y: 2, z: 3 } });
    expect(f.cx).toBeCloseTo(0, 9);
    expect(f.cz).toBeCloseTo(2, 9);
    const q = bossImpostorQuadPlacement(f, 1, Math.PI / 2, { x: 0, y: 0, z: 0 });
    expect(q.x).toBeCloseTo(2, 9);
    expect(q.z).toBeCloseTo(0, 9);
    const back = bossImpostorQuadPlacement(f, 1, Math.PI, { x: 0, y: 0, z: 0 });
    expect(back.x).toBeCloseTo(0, 9);
    expect(back.z).toBeCloseTo(-2, 9);
  });

  it('is the identity for a centred body at scale one, so a plain model lands on its pivot', () => {
    const f = bossImpostorFrameMetrics({ min: { x: -3, y: 0, z: -3 }, max: { x: 3, y: 10, z: 3 } });
    const q = bossImpostorQuadPlacement(f, 1, 1.23, { x: 7, y: 8, z: 9 });
    expect(q.x).toBeCloseTo(7, 9);
    expect(q.z).toBeCloseTo(9, 9);
    // Feet at the pivot: the centre sits half the (unmargined) height up.
    expect(q.y).toBeCloseTo(8 + 5, 9);
  });
});

describe('night-correct shading', () => {
  const LUMA = [0.2126, 0.7152, 0.0722] as const;
  const luma = (c: readonly [number, number, number]) =>
    LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];
  const midnight = (biome: 'vale' | 'ember') => dayNightGrade(effectiveDayness(0, biome), biome);

  it('is the identity by day, so the noon bake is the authored day look', () => {
    expect(bossImpostorLightGrade(NEUTRAL_DAY_GRADE)).toEqual([1, 1, 1]);
  });

  it('weights the bake lights by their real share, the key at half for a rounded body', () => {
    expect(BOSS_IMPOSTOR_BAKE_KEY_SHARE).toBeCloseTo(
      BOSS_IMPOSTOR_BAKE_KEY / 2 / (BOSS_IMPOSTOR_BAKE_KEY / 2 + BOSS_IMPOSTOR_BAKE_SKY),
      12,
    );
    expect(BOSS_IMPOSTOR_BAKE_KEY_SHARE).toBeGreaterThan(0);
    expect(BOSS_IMPOSTOR_BAKE_KEY_SHARE).toBeLessThan(1);
  });

  it('lands a midnight sprite between the moon key and the ambient floor, as the rig does', () => {
    // The rig's key light is scaled by lightScale and its dome + IBL by ambientScale, so
    // no texel of it can be darker than the key floor or brighter than the ambient floor.
    // The sprite's level has to sit inside the same bracket or it glows against the rig.
    const g = midnight('vale');
    const level = luma(bossImpostorLightGrade(g));
    expect(level).toBeGreaterThan(g.lightScale);
    expect(level).toBeLessThan(g.ambientScale);
    const expected =
      g.ambientScale * (1 - BOSS_IMPOSTOR_BAKE_KEY_SHARE) +
      g.lightScale * BOSS_IMPOSTOR_BAKE_KEY_SHARE;
    // The two hue terms are each luminance-neutral but compound at second order, so the
    // luma sits within a percent of the bare level rather than on it.
    expect(level).toBeCloseTo(expected, 2);
  });

  it('keeps both hue terms luminance-neutral, so level is the only exposure knob', () => {
    expect(luma(BOSS_IMPOSTOR_MOON_COOL)).toBeCloseTo(1, 2);
    const g = midnight('ember');
    const lit = bossImpostorLightGrade(g);
    const level =
      g.ambientScale * (1 - BOSS_IMPOSTOR_BAKE_KEY_SHARE) +
      g.lightScale * BOSS_IMPOSTOR_BAKE_KEY_SHARE;
    // Two neutral tints multiplied are neutral only to first order; a percent is the bound
    // that separates "a hue" from "a second brightness knob".
    expect(luma(lit) / level).toBeCloseTo(1, 1);
  });

  it('carries the realm night hue the renderer puts on its own lights', () => {
    // The Drakelands stay ember-red after dark; the Vale goes moon-blue. Same helper the
    // renderer applies to the key light and the hemisphere, so the sprite cannot drift from
    // the rig's colour by construction.
    const ember = bossImpostorLightGrade(midnight('ember'));
    const vale = bossImpostorLightGrade(midnight('vale'));
    expect(ember[0] / ember[2]).toBeGreaterThan(1);
    expect(vale[2] / vale[0]).toBeGreaterThan(1);
    const emberTint = realmLightTint(midnight('ember').fog, 1);
    expect(emberTint[0]).toBeGreaterThan(emberTint[2]);
  });

  it('darkens monotonically from noon to midnight', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let dayness = 1; dayness >= 0; dayness -= 0.05) {
      const level = luma(bossImpostorLightGrade(dayNightGrade(dayness)));
      expect(level).toBeLessThanOrEqual(prev + 1e-9);
      prev = level;
    }
  });
});

describe('picking the baked view', () => {
  it('returns adjacent views and a blend inside them', () => {
    for (let i = 0; i < 40; i++) {
      const f = bossImpostorFrame((i / 40) * Math.PI * 2);
      expect(f.a).toBeGreaterThanOrEqual(0);
      expect(f.a).toBeLessThan(BOSS_IMPOSTOR_VIEWS);
      expect(f.b).toBe((f.a + 1) % BOSS_IMPOSTOR_VIEWS);
      expect(f.blend).toBeGreaterThanOrEqual(0);
      expect(f.blend).toBeLessThan(1);
    }
  });

  it('wraps on the INDEX, so the seam pair is neighbours and not front-to-back', () => {
    // The bug this catches: normalizing the angle into [-pi, pi) first and flooring gives
    // view 11 paired with view -1 at the seam, which cross-fades his face into his back
    // every time he turns through north.
    const turn = (Math.PI * 2) / BOSS_IMPOSTOR_VIEWS;
    const justUnder = bossImpostorFrame(BOSS_IMPOSTOR_VIEWS * turn - 0.001);
    expect(justUnder.a).toBe(BOSS_IMPOSTOR_VIEWS - 1);
    expect(justUnder.b).toBe(0);
    expect(bossImpostorFrame(-0.001).a).toBe(BOSS_IMPOSTOR_VIEWS - 1);
  });

  it('is periodic, so a bearing many turns around lands on the same view', () => {
    const base = bossImpostorFrame(1.1);
    for (const turns of [1, 5, -3]) {
      const f = bossImpostorFrame(1.1 + turns * Math.PI * 2);
      expect(f.a).toBe(base.a);
      expect(f.blend).toBeCloseTo(base.blend, 6);
    }
  });

  it('takes his own facing out, so the view tracks which way he is running', () => {
    // A stationary viewer, a boss who turns 180 degrees: the chosen view must move by half
    // the ring. Without the facing term he would show the same face while running away.
    const front = bossImpostorFrame(bossImpostorBearing(0, 0, 0, 50, 0));
    const back = bossImpostorFrame(bossImpostorBearing(0, 0, 0, 50, Math.PI));
    const delta = Math.abs(front.a - back.a);
    expect(Math.min(delta, BOSS_IMPOSTOR_VIEWS - delta)).toBe(BOSS_IMPOSTOR_VIEWS / 2);
  });
});

describe('reading on the horizon', () => {
  it('never lets the atmosphere erase him, however far away he is', () => {
    // The whole point of the feature is a silhouette you can see and walk toward. Full scene
    // fog puts him at fog colour well inside the range this covers, which is indistinguishable
    // from not drawing him at all.
    expect(bossImpostorFogMix(1)).toBe(BOSS_IMPOSTOR_FOG_CEILING);
    expect(bossImpostorFogMix(50)).toBe(BOSS_IMPOSTOR_FOG_CEILING);
    expect(BOSS_IMPOSTOR_FOG_CEILING).toBeLessThan(1);
  });

  it('still takes the near-field fog honestly, so he sits in the scene', () => {
    expect(bossImpostorFogMix(0)).toBe(0);
    expect(bossImpostorFogMix(0.3)).toBeCloseTo(0.3, 6);
    // A camera closer than fog.near yields a negative raw factor; clamped, not wrapped.
    expect(bossImpostorFogMix(-2)).toBe(0);
  });
});

describe('the server half: he has to be SENT before he can be drawn', () => {
  const mob = (templateId: string, over: Partial<Entity> = {}) =>
    ({ kind: 'mob', id: 1, templateId, dead: false, pos: { x: 0, y: 0, z: 0 }, ...over }) as Entity;

  it('reads the range off the template, and off nothing else', () => {
    expect(landmarkInterestSq(mob(BALGATH))).toBe((MOBS[BALGATH]?.landmarkRange ?? 0) ** 2);
    expect(landmarkInterestSq(mob('bogtoad'))).toBeNull();
    expect(landmarkInterestSq({ kind: 'player', id: 2 } as Entity)).toBeNull();
  });

  it('keeps him in interest far past where an ordinary mob is dropped', () => {
    // Decisive form: compare against the ordinary limit rather than against a literal, so
    // this stays true if the base radii are retuned.
    const ordinary = interestLimitSq(mob('bogtoad'), true);
    expect(interestLimitSq(mob(BALGATH), false)).toBeGreaterThan(ordinary * 4);
  });

  it('reaches past the rig band, so the sprite has an entity to draw the frame the rig hides', () => {
    // The two-sided check. The sprite draws only once the rig is gone (96 yards receding),
    // so an interest range at or under that would mean the client never receives him at any
    // distance where it would have drawn a sprite: dead code that typechecks.
    const range = Math.sqrt(interestLimitSq(mob(BALGATH), false));
    expect(range).toBeGreaterThan(ENTITY_VIEW_DESTROY_RANGE);
    expect(LANDMARK_RANGE).toBeGreaterThan(ENTITY_VIEW_DESTROY_RANGE);
  });

  it('does not widen interest for every other mob in the game', () => {
    const widened = Object.entries(MOBS).filter(([, m]) => m.landmarkRange);
    expect(widened.map(([id]) => id)).toEqual([BALGATH]);
  });
});

describe('the landmark roster', () => {
  const roster = () => new LandmarkRoster();
  const world = (...es: Entity[]) => es;
  const boss = (id: number, dead = false) =>
    ({ kind: 'mob', id, templateId: BALGATH, dead, pos: { x: 0, y: 0, z: 0 } }) as Entity;
  const toad = (id: number) =>
    ({ kind: 'mob', id, templateId: 'bogtoad', dead: false, pos: { x: 0, y: 0, z: 0 } }) as Entity;

  it('finds the landmarks and nothing else', () => {
    const r = roster();
    expect(r.refresh(0, world(toad(1), boss(2), toad(3))).map((e) => e.id)).toEqual([2]);
  });

  it('does not rescan the whole world every tick', () => {
    // The reason the cadence exists: this runs inside the broadcast pass, and an O(entities)
    // walk per tick to find an entity that changes once an hour is exactly the per-tick cost
    // server/CLAUDE.md's hot-path rule exists to prevent.
    const r = roster();
    let walks = 0;
    const entities = {
      *[Symbol.iterator]() {
        walks++;
        yield boss(2);
      },
    } as Iterable<Entity>;
    r.refresh(0, entities);
    for (let t = 1; t < 20; t++) r.refresh(t, entities);
    expect(walks).toBe(1);
  });

  it('drops a dead boss immediately rather than waiting out the cadence', () => {
    // A corpse must stop being force-fed to every viewer in the zone the moment he dies,
    // not up to a second later, because the kill is exactly when everyone is looking.
    const r = roster();
    const live = boss(2);
    expect(r.refresh(0, world(live)).length).toBe(1);
    live.dead = true;
    expect(r.refresh(1, world(live)).length).toBe(0);
  });

  it('picks a newly risen boss up on the next scan', () => {
    const r = roster();
    expect(r.refresh(0, world(toad(1))).length).toBe(0);
    expect(r.refresh(100, world(toad(1), boss(2))).map((e) => e.id)).toEqual([2]);
  });
});
