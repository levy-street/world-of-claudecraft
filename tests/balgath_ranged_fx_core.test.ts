// Balgath's ranged-kit presentation: the pure planning core (balgath_ranged_fx_core.ts),
// its weld to the sim, the router's claims, and the Three layer's lifetimes and fairness.
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BalgathFx, routeBalgathSpellfxAt } from '../src/render/balgath_fx';
import {
  BalgathRangedFx,
  balgathRangedMaterials,
  buildBalgathRangedStandIn,
} from '../src/render/balgath_ranged_fx';
import {
  BALGATH_BOULDER_ABILITY,
  BALGATH_BOULDER_RELEASE_SECONDS,
  BALGATH_BURDEN_ABILITY,
  BALGATH_BURDEN_AURA_GRACE,
  BALGATH_BURDEN_AURA_ID,
  BALGATH_BURDEN_RADIUS,
  BALGATH_GLARE_ABILITY,
  BALGATH_GLARE_HALF_WIDTH,
  boulderInFlight,
  boulderPosition,
  burdenProgress,
  burdenVortexPlan,
  cleaveChevronLift,
  cleaveWaveAngle,
  glareRectCorners,
  playersInsideBurden,
  telegraphFill,
  telegraphRimAlpha,
} from '../src/render/balgath_ranged_fx_core';
import { MOBS } from '../src/sim/data';
import {
  BOULDER_ABILITY,
  BURDEN_ABILITY,
  BURDEN_AURA_GRACE,
  BURDEN_AURA_ID,
  GLARE_ABILITY,
} from '../src/sim/mob/boss_ranged_mechanics';

const kit = () => {
  const d = MOBS.balgath_cyclops?.rangedMechanics;
  if (!d) throw new Error('no kit');
  return d;
};

describe('weld to the sim', () => {
  it('agrees on every cue id and the soak mark', () => {
    expect(BALGATH_BOULDER_ABILITY).toBe(BOULDER_ABILITY);
    expect(BALGATH_GLARE_ABILITY).toBe(GLARE_ABILITY);
    expect(BALGATH_BURDEN_ABILITY).toBe(BURDEN_ABILITY);
    expect(BALGATH_BURDEN_AURA_ID).toBe(BURDEN_AURA_ID);
  });
  it('draws the glare and the soak at exactly the size the sim hits', () => {
    expect(BALGATH_GLARE_HALF_WIDTH).toBe(kit().glare.halfWidth);
    expect(BALGATH_BURDEN_RADIUS).toBe(kit().burden.radius);
  });
  it('agrees on the burden mark grace', () => {
    expect(BALGATH_BURDEN_AURA_GRACE).toBe(BURDEN_AURA_GRACE);
  });
  it('releases the boulder inside its wind-up, leaving a real flight', () => {
    expect(BALGATH_BOULDER_RELEASE_SECONDS).toBeLessThan(kit().boulder.windup - 0.4);
  });
});

describe('telegraph timing curves', () => {
  it('fills from the centre and reaches the rim exactly at the landing', () => {
    expect(telegraphFill(0)).toBeGreaterThan(0);
    expect(telegraphFill(0)).toBeLessThan(0.15);
    expect(telegraphFill(1)).toBeCloseTo(1, 5);
    let prev = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const f = telegraphFill(t);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
  it('keeps the rim bright and steady under reduced motion', () => {
    expect(telegraphRimAlpha(0.5, 12.3, true)).toBe(telegraphRimAlpha(0.9, 1, true));
    expect(telegraphRimAlpha(0.5, 12.3, false)).toBeGreaterThanOrEqual(0.78);
  });
});

describe('the boulder flight', () => {
  const hand = { x: 0, y: 1, z: 2 };
  const over = { x: 0, y: 14, z: 1 };
  const land = { x: 0, y: 0.5, z: 40 };
  it('sits at his hands, rises overhead, and lands on the mark at the end of the wind-up', () => {
    expect(boulderPosition(0.1, 2.2, hand, over, land)).toEqual(hand);
    const lifted = boulderPosition(1.2, 2.2, hand, over, land);
    expect(lifted.y).toBeGreaterThan(13);
    const end = boulderPosition(2.2, 2.2, hand, over, land);
    expect(end.x).toBeCloseTo(land.x);
    expect(end.y).toBeCloseTo(land.y);
    expect(end.z).toBeCloseTo(land.z);
  });
  it('arcs above the straight line mid-flight', () => {
    const mid = boulderPosition((BALGATH_BOULDER_RELEASE_SECONDS + 2.2) / 2, 2.2, hand, over, land);
    const straight = (over.y + land.y) / 2;
    expect(mid.y).toBeGreaterThan(straight + 3);
  });
  it('is in flight only after the release frame', () => {
    expect(boulderInFlight(BALGATH_BOULDER_RELEASE_SECONDS - 0.05, 2.2)).toBe(false);
    expect(boulderInFlight(BALGATH_BOULDER_RELEASE_SECONDS + 0.05, 2.2)).toBe(true);
  });
});

describe('the glare rectangle', () => {
  it('is the width the sim hits and runs the whole length', () => {
    const c = glareRectCorners(0, 0, 0, 1, 40);
    expect(Math.hypot(c[0][0] - c[1][0], c[0][1] - c[1][1])).toBeCloseTo(
      2 * BALGATH_GLARE_HALF_WIDTH,
    );
    expect(Math.hypot(c[1][0] - c[2][0], c[1][1] - c[2][1])).toBeCloseTo(40);
  });
});

describe('the cleave and the burden', () => {
  it('runs the dust wave from one edge of the arc to the other', () => {
    const half = Math.PI / 3;
    expect(cleaveWaveAngle(0, half)).toBeCloseTo(-half);
    expect(cleaveWaveAngle(10, half)).toBeCloseTo(half);
  });
  it('lifts the jump chevrons as the arm comes', () => {
    expect(cleaveChevronLift(1, 0, true)).toBeGreaterThan(cleaveChevronLift(0, 0, true));
  });
  it('winds the vortex lower, tighter and faster as it comes due', () => {
    const a = burdenVortexPlan(0);
    const b = burdenVortexPlan(1);
    expect(b.spin).toBeGreaterThan(a.spin * 3);
    expect(b.height).toBeLessThan(a.height);
    expect(b.radius).toBeLessThan(a.radius);
  });
  it('counts the living players inside the circle', () => {
    const p = (x: number, dead = false) => ({ pos: { x, z: 0 }, dead });
    expect(playersInsideBurden({ x: 0, z: 0 }, [p(0), p(5.9), p(6.1), p(1, true)])).toBe(2);
  });
  it('reads progress off the mark, closing exactly on the landing', () => {
    const d = 6 + BALGATH_BURDEN_AURA_GRACE;
    expect(burdenProgress({ remaining: d, duration: d })).toBe(0);
    expect(burdenProgress({ remaining: 3 + BALGATH_BURDEN_AURA_GRACE, duration: d })).toBeCloseTo(
      0.5,
    );
    expect(burdenProgress({ remaining: BALGATH_BURDEN_AURA_GRACE, duration: d })).toBe(1);
  });
});

// ---- the Three layer --------------------------------------------------------------

function fakeScene() {
  const live = new Set<THREE.Object3D>();
  return {
    live,
    scene: {
      add: (o: THREE.Object3D) => live.add(o),
      remove: (o: THREE.Object3D) => live.delete(o),
    } as unknown as THREE.Scene,
  };
}
const hooks = () => {
  const calls: string[] = [];
  return {
    calls,
    hooks: {
      felt: () => calls.push('felt'),
      ground: () => calls.push('ground'),
      ring: () => calls.push('ring'),
      crater: () => calls.push('crater'),
    },
  };
};

describe('BalgathRangedFx', () => {
  it('draws a boulder mark with its rock, then retires both on the landing', () => {
    const { scene, live } = fakeScene();
    const fx = new BalgathRangedFx(scene, () => 0, hooks().hooks);
    fx.beginFrame();
    fx.note({ id: 7, templateId: 'balgath_cyclops', pos: { x: 0, y: 0, z: 0 }, scale: 4.2 }, true);
    fx.boulderTelegraph(7, 0, 30, 5, 2.2);
    fx.boulderTelegraph(7, 20, 0, 5, 2.2);
    expect(fx.counts().boulders).toBe(2);
    for (let i = 0; i < 20; i++) fx.update(0.1, false);
    fx.boulderLanded(0, 30, 5);
    expect(fx.counts().boulders).toBe(1);
    expect(fx.counts().shatters).toBe(1);
    for (let i = 0; i < 40; i++) fx.update(0.1, false);
    expect(fx.counts()).toEqual({ boulders: 0, glares: 0, cleaves: 0, burdens: 0, shatters: 0 });
    expect(live.size).toBe(0);
  });

  it('draws the glare line, fires the beam, and cleans up after it', () => {
    const { scene, live } = fakeScene();
    const fx = new BalgathRangedFx(scene, () => 0, hooks().hooks);
    fx.glareTelegraph(7, 0, 0, 0, 1, 40, 2.6);
    expect(fx.counts().glares).toBe(1);
    fx.update(1, false);
    fx.glareFired(7, 0, 0, 0, 1, 22);
    expect(fx.counts().glares).toBe(0);
    for (let i = 0; i < 20; i++) fx.update(0.1, false);
    expect(live.size).toBe(0);
  });

  it('keeps a burden marker on its carrier for exactly as long as the mark is on them', () => {
    const { scene, live } = fakeScene();
    const fx = new BalgathRangedFx(scene, () => 0, hooks().hooks);
    const carrier = {
      id: 3,
      kind: 'player',
      pos: { x: 5, y: 0, z: 5 },
      auras: [{ id: BURDEN_AURA_ID, remaining: 4, duration: 6.25, stacks: 4, sourceId: 7 }],
    };
    const frame = (withMark: boolean) => {
      fx.beginFrame();
      fx.note({ id: 7, templateId: 'balgath_cyclops', pos: { x: 0, y: 0, z: 0 } }, true);
      fx.note(withMark ? carrier : { ...carrier, auras: [] }, false);
      fx.update(0.05, false);
    };
    frame(true);
    expect(fx.counts().burdens).toBe(1);
    frame(true);
    expect(fx.counts().burdens).toBe(1);
    frame(false);
    expect(fx.counts().burdens).toBe(0);
    expect(live.size).toBe(0);
  });

  it('drops the burden marker once the boss who laid it is dead', () => {
    const { scene } = fakeScene();
    const fx = new BalgathRangedFx(scene, () => 0, hooks().hooks);
    fx.beginFrame();
    fx.note({ id: 7, templateId: 'balgath_cyclops', dead: true, pos: { x: 0, y: 0, z: 0 } }, true);
    fx.note(
      {
        id: 3,
        kind: 'player',
        pos: { x: 5, y: 0, z: 5 },
        auras: [{ id: BURDEN_AURA_ID, remaining: 4, duration: 6.25, sourceId: 7 }],
      },
      false,
    );
    fx.update(0.05, false);
    expect(fx.counts().burdens).toBe(0);
  });

  it('draws the cleave fan and then a wave along it', () => {
    const { scene, live } = fakeScene();
    const h = hooks();
    const fx = new BalgathRangedFx(scene, () => 0, h.hooks);
    fx.cleaveTelegraph(0, 0, 20, 0, 1.5);
    expect(fx.counts().cleaves).toBe(1);
    fx.cleaveLanded(0, 0, 20, 0);
    expect(fx.counts().cleaves).toBe(0);
    for (let i = 0; i < 30; i++) fx.update(0.05, false);
    expect(h.calls.filter((c) => c === 'ground').length).toBeGreaterThanOrEqual(9);
    for (let i = 0; i < 40; i++) fx.update(0.05, false);
    expect(live.size).toBe(0);
  });
});

describe('fairness: every telegraph on every preset', () => {
  it('draws the boulder, glare and cleave marks at the lowest quality', () => {
    const { scene } = fakeScene();
    const fx = new BalgathFx(scene, () => 0);
    fx.setQuality(0);
    const at = () => [{ id: 7, templateId: 'balgath_cyclops' }];
    const ev = (ability: string, extra: Record<string, number> = {}) => ({
      x: 0,
      z: 30,
      fx: 'runeCircle',
      radius: 5,
      duration: 2.2,
      sourceId: 7,
      ability,
      ...extra,
    });
    expect(routeBalgathSpellfxAt(ev(BOULDER_ABILITY), fx, at)).toBe(true);
    expect(routeBalgathSpellfxAt(ev(GLARE_ABILITY, { dirX: 0, dirZ: 1, radius: 40 }), fx, at)).toBe(
      true,
    );
    expect(
      routeBalgathSpellfxAt(ev('mob_balgath_cleave', { dirX: 0, dirZ: 1, radius: 20 }), fx, at),
    ).toBe(true);
    expect(fx.ranged.counts()).toMatchObject({ boulders: 1, glares: 1, cleaves: 1 });
  });

  it('routes each landing to its own effect', () => {
    const { scene } = fakeScene();
    const fx = new BalgathFx(scene, () => 0);
    const at = () => [{ id: 7, templateId: 'balgath_cyclops' }];
    fx.ranged.boulderTelegraph(7, 0, 30, 5, 2.2);
    const nova = (ability: string, extra: Record<string, number> = {}) => ({
      x: 0,
      z: 30,
      fx: 'nova',
      radius: 5,
      sourceId: 7,
      ability,
      ...extra,
    });
    expect(routeBalgathSpellfxAt(nova(BOULDER_ABILITY), fx, at)).toBe(true);
    expect(fx.ranged.counts().shatters).toBe(1);
    expect(routeBalgathSpellfxAt(nova(BURDEN_ABILITY, { radius: 6 }), fx, at)).toBe(true);
    expect(fx.ranged.counts().shatters).toBe(2);
    expect(
      routeBalgathSpellfxAt(nova(GLARE_ABILITY, { dirX: 0, dirZ: 1, radius: 20 }), fx, at),
    ).toBe(true);
    // Another boss's identical cue is never claimed.
    expect(routeBalgathSpellfxAt({ ...nova(BOULDER_ABILITY), sourceId: 9 }, fx, at)).toBe(false);
  });
});

/** Everything three keys a program on for these pieces: material kind and state, plus
 *  whether the geometry carries normals and colours. */
function programSignature(mesh: THREE.Mesh): string[] {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const g = mesh.geometry;
  return mats.map(
    (m) =>
      `${m.type}|${m.blending}|${m.transparent}|${m.side}|${m.vertexColors}|${m.toneMapped}|` +
      `${(m as THREE.MeshStandardMaterial).flatShading === true}|` +
      `${g.getAttribute('normal') !== undefined}|${g.getAttribute('color')?.itemSize ?? 0}`,
  );
}
function signatures(root: THREE.Object3D): Set<string> {
  const out = new Set<string>();
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) for (const sig of programSignature(o as THREE.Mesh)) out.add(sig);
  });
  return out;
}

describe('prewarm stand-in', () => {
  it('covers the program of every piece a live boulder, glare, cleave and burden draws', () => {
    const covered = signatures(buildBalgathRangedStandIn());
    const live = new Set<THREE.Object3D>();
    const scene = {
      add: (o: THREE.Object3D) => live.add(o),
      remove: () => {},
    } as unknown as THREE.Scene;
    const fx = new BalgathRangedFx(scene, () => 0, hooks().hooks);
    fx.beginFrame();
    fx.note({ id: 7, templateId: 'balgath_cyclops', pos: { x: 0, y: 0, z: 0 } }, true);
    fx.note(
      {
        id: 3,
        kind: 'player',
        pos: { x: 5, y: 0, z: 5 },
        auras: [{ id: BURDEN_AURA_ID, remaining: 4, duration: 6.25, stacks: 4, sourceId: 7 }],
      },
      false,
    );
    fx.boulderTelegraph(7, 0, 30, 5, 2.2);
    fx.glareTelegraph(7, 0, 0, 0, 1, 40, 2.6);
    fx.cleaveTelegraph(0, 0, 20, 0, 1.5);
    fx.update(0.05, false);
    fx.glareFired(7, 0, 0, 0, 1, 20);
    fx.boulderLanded(0, 30, 5);
    const missing: string[] = [];
    for (const root of live)
      for (const sig of signatures(root)) if (!covered.has(sig)) missing.push(sig);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('draws every bundle material, so no live piece links a program in a combat frame', () => {
    const root = buildBalgathRangedStandIn();
    const drawn = new Set<THREE.Material>();
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) drawn.add(x);
    });
    for (const mat of Object.values(balgathRangedMaterials())) expect(drawn.has(mat)).toBe(true);
    expect(root.visible).toBe(false);
  });
});

describe('the burden tooltip', () => {
  it('prices the split off the mark with the shared-soak sentence', async () => {
    const { auraEffectDescriptor } = await import('../src/ui/aura_effect');
    const d = auraEffectDescriptor({
      id: BURDEN_AURA_ID,
      kind: 'vulnerability',
      value: 0,
      value2: kit().burden.totalFraction,
      stacks: kit().burden.recommended,
    });
    expect(d?.key).toBe('hudChrome.auraEffect.sharedPyre');
    expect(d?.nums?.total).toBeCloseTo(110);
    expect(d?.nums?.players).toBe(4);
    expect(d?.nums?.perPlayer).toBe(28);
  });
});
