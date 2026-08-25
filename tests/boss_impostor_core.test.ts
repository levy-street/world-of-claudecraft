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
import { interestLimitSq, LandmarkRoster, landmarkInterestSq } from '../server/interest_scope';
import {
  BOSS_IMPOSTOR_FADE_END,
  BOSS_IMPOSTOR_FADE_START,
  BOSS_IMPOSTOR_FOG_CEILING,
  BOSS_IMPOSTOR_VIEWS,
  bossImpostorAlpha,
  bossImpostorBearing,
  bossImpostorFogMix,
  bossImpostorFrame,
  bossImpostorQuadSize,
} from '../src/render/boss_impostor_core';
import { MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

const BALGATH = 'balgath_cyclops';

/**
 * The renderer's own band edges, read out of its source.
 *
 * Parsed rather than imported because importing renderer.ts drags Three and the whole scene
 * graph into a Node test for two integers; parsed rather than copied because a copy is what
 * lets the handoff silently open a gap when someone retunes the draw range.
 */
const rendererRange = (name: string): number => {
  const src = readFileSync('src/render/renderer.ts', 'utf8');
  const m = src.match(new RegExp(`${name} = (\\d+)`));
  if (!m) throw new Error(`renderer.ts no longer declares ${name}`);
  return Number(m[1]);
};
const ENTITY_VIEW_DESTROY_RANGE = rendererRange('ENTITY_VIEW_DESTROY_RANGE');
const ENTITY_DRAW_RANGE = rendererRange('ENTITY_DRAW_RANGE');

describe('the handoff from the real rig', () => {
  it('starts before the rig is dropped and finishes after, so neither a gap nor a double', () => {
    // The rig is hidden at the 80/96 yard hysteresis. If the sprite only reached full
    // opacity past 96 there is a band with nothing in it; if it were opaque before the rig
    // stopped drawing there are two Balgaths. The overlap is the correct answer, and it has
    // to be checked against the renderer's own number, not a copy of it.
    expect(BOSS_IMPOSTOR_FADE_START).toBeLessThan(ENTITY_DRAW_RANGE);
    expect(BOSS_IMPOSTOR_FADE_END).toBeLessThanOrEqual(ENTITY_VIEW_DESTROY_RANGE);
    expect(BOSS_IMPOSTOR_FADE_END).toBeGreaterThan(BOSS_IMPOSTOR_FADE_START);
  });

  it('draws nothing at all while the rig is the thing being looked at', () => {
    expect(bossImpostorAlpha(0)).toBe(0);
    expect(bossImpostorAlpha(BOSS_IMPOSTOR_FADE_START)).toBe(0);
  });

  it('is fully opaque past the handoff and stays that way at any distance', () => {
    expect(bossImpostorAlpha(BOSS_IMPOSTOR_FADE_END)).toBe(1);
    expect(bossImpostorAlpha(200)).toBe(1);
    expect(bossImpostorAlpha(5000)).toBe(1);
  });

  it('rises monotonically across the band, without a knee at either end', () => {
    let prev = -1;
    for (let d = BOSS_IMPOSTOR_FADE_START; d <= BOSS_IMPOSTOR_FADE_END; d += 0.5) {
      const a = bossImpostorAlpha(d);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    // smoothstep: the derivative is zero at both ends, so the first and last steps barely move
    const span = BOSS_IMPOSTOR_FADE_END - BOSS_IMPOSTOR_FADE_START;
    expect(bossImpostorAlpha(BOSS_IMPOSTOR_FADE_START + span * 0.05)).toBeLessThan(0.02);
    expect(bossImpostorAlpha(BOSS_IMPOSTOR_FADE_END - span * 0.05)).toBeGreaterThan(0.98);
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

  it('gives the quad margin over the model height so his reach is not cropped', () => {
    const q = bossImpostorQuadSize(10);
    expect(q.h).toBeGreaterThan(10);
    expect(q.w).toBeGreaterThanOrEqual(q.h);
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

  it('reaches at least as far as the client will draw the sprite', () => {
    // The two-sided check. A range under the fade-in distance would mean the client never
    // receives him at any distance where it would have drawn a sprite, and the whole feature
    // would be dead code that typechecks.
    const range = Math.sqrt(interestLimitSq(mob(BALGATH), false));
    expect(range).toBeGreaterThan(BOSS_IMPOSTOR_FADE_END);
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
