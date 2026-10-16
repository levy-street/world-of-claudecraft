// Wake of the Fallen Star on screen (src/render/balgath_starwake_fx_core.ts, the curves;
// src/render/balgath_starwake_fx.ts, the Three half; the router in balgath_fx.ts).
//
// What is pinned is what a player acts on: every hazard mark and pool is drawn on every
// quality level and at full strength until the moment it stops hurting, its timing agrees
// with the sim, and every program a live cast draws is linked by the boot stand-in.

import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type BalgathFx, routeBalgathSpellfxAt } from '../src/render/balgath_fx';
import {
  BalgathStarwakeFx,
  balgathStarwakeMaterials,
  buildBalgathStarwakeStandIn,
} from '../src/render/balgath_starwake_fx';
import {
  BALGATH_STARWAKE_CAST_ID,
  BALGATH_STARWAKE_FISSURE_ABILITY,
  BALGATH_STARWAKE_GEYSER_ABILITY,
  BALGATH_STARWAKE_METEOR_ABILITY,
  BALGATH_STARWAKE_METEOR_RADIUS,
  BALGATH_STARWAKE_WAKE_ABILITY,
  chunkBudget,
  crackJag,
  crawlFraction,
  fissureHeat,
  poolStrength,
  STARWAKE_CRAWL_SECONDS,
  STARWAKE_FISSURE_HALF_WIDTH,
  STARWAKE_GEYSER_TRAUMA,
  STARWAKE_METEOR_TRAUMA,
  STARWAKE_SPEW_LINGER,
  STARWAKE_STAR_AFTERGLOW,
  spoutBudget,
  spoutDelay,
  spoutDistances,
  spoutShape,
  starGlow,
  starPulseDue,
} from '../src/render/balgath_starwake_fx_core';
import { MOBS } from '../src/sim/data';
import { IGNIVAR_METEOR_RADIUS } from '../src/sim/ignivar_meteors';
import {
  STARWAKE_FISSURE_ABILITY,
  STARWAKE_GEYSER_ABILITY,
  STARWAKE_WAKE_ABILITY,
} from '../src/sim/mob/boss_starwake';

const def = () => {
  const d = MOBS.balgath_cyclops?.starwake;
  if (!d) throw new Error('no starwake');
  return d;
};

describe('agreed with the sim', () => {
  it('uses the sim cue ids, the crawl, the strip width and the cast name', () => {
    expect(BALGATH_STARWAKE_WAKE_ABILITY).toBe(STARWAKE_WAKE_ABILITY);
    expect(BALGATH_STARWAKE_FISSURE_ABILITY).toBe(STARWAKE_FISSURE_ABILITY);
    expect(BALGATH_STARWAKE_GEYSER_ABILITY).toBe(STARWAKE_GEYSER_ABILITY);
    expect(STARWAKE_CRAWL_SECONDS).toBe(def().crawl);
    expect(STARWAKE_FISSURE_HALF_WIDTH).toBe(def().fissures.halfWidth);
    expect(BALGATH_STARWAKE_CAST_ID).toBe(def().name);
    expect(BALGATH_STARWAKE_METEOR_ABILITY).toBe(def().meteors.name);
    expect(BALGATH_STARWAKE_METEOR_RADIUS).toBe(IGNIVAR_METEOR_RADIUS);
  });
});

describe('curves', () => {
  it('the crawl races out and reaches the tip exactly at the crawl time', () => {
    expect(crawlFraction(0)).toBe(0);
    expect(crawlFraction(STARWAKE_CRAWL_SECONDS)).toBe(1);
    expect(crawlFraction(STARWAKE_CRAWL_SECONDS * 3)).toBe(1);
    let prev = -1;
    for (let t = 0; t <= STARWAKE_CRAWL_SECONDS; t += 0.1) {
      const f = crawlFraction(t);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('the strip heats up to full on the eruption, never down', () => {
    const total = def().crawl + def().hold;
    let prev = -1;
    for (let t = 0; t <= total + 1e-9; t += 0.05) {
      const h = fissureHeat(t, total);
      expect(h).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = h;
    }
    expect(fissureHeat(total, total)).toBeCloseTo(1, 9);
  });

  it('a pool is at full strength through its last burn, and only then fades', () => {
    const life = def().pool.seconds;
    for (let t = 0.3; t <= life; t += 0.1) expect(poolStrength(t, life)).toBe(1);
    // The sim's last burn lands AT `life`: the pool is still whole on that tick.
    expect(poolStrength(life, life)).toBe(1);
    expect(poolStrength(life + 0.15, life)).toBeLessThan(1);
    expect(poolStrength(life + 1, life)).toBe(0);
  });

  it('the cast-clip remap in the character manifest keys on the template cast name', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync('src/render/characters/manifest.ts', 'utf-8');
    expect(text).toContain(`castByAbility: { '${def().name}': 'Balgath_Starwake' }`);
    expect(text).toContain(`castTimeScaleByAbility: { '${def().name}': 0.56 }`);
  });

  it('the star kindles, stays lit through the wind-up, and dies away after', () => {
    const total = 7.5;
    expect(starGlow(0, total, false)).toBe(0);
    for (let t = 0.6; t <= total; t += 0.25) expect(starGlow(t, total, false)).toBeGreaterThan(0.4);
    expect(starGlow(total + 10, total, false)).toBe(0);
    // Reduced motion: no beat, still lit.
    expect(starGlow(3, total, true)).toBeGreaterThan(0.4);
    expect(starGlow(3, total, true)).toBe(starGlow(3, total, true));
  });

  it('a shower keeps the star blazing, then the same afterglow; no shower is unchanged', () => {
    const total = 7.5;
    for (let t = 0; t <= total + 4; t += 0.05) {
      expect(starGlow(t, total, false, 0)).toBe(starGlow(t, total, false));
      expect(starGlow(t, total, true, 0)).toBe(starGlow(t, total, true));
    }
    const spew = 8.8;
    for (let t = total + 0.05; t <= total + spew; t += 0.1) {
      expect(starGlow(t, total, false, spew)).toBeGreaterThanOrEqual(0.8);
      expect(starGlow(t, total, true, spew)).toBeGreaterThanOrEqual(0.8);
    }
    // The afterglow runs from the end of the shower exactly as it ran from the eruption.
    for (const after of [0.3, 0.9, 1.5]) {
      expect(starGlow(total + spew + after, total, false, spew)).toBeCloseTo(
        starGlow(total + after, total, false),
        12,
      );
    }
    expect(starGlow(total + spew + STARWAKE_STAR_AFTERGLOW, total, false, spew)).toBe(0);
  });

  it('pulses the star faster as the eruption nears', () => {
    const total = 7.5;
    const count = (from: number, to: number) => {
      let n = 0;
      for (let t = from; t < to; t += 0.02) if (starPulseDue(t, t + 0.02, total)) n++;
      return n;
    };
    expect(count(5, 7)).toBeGreaterThan(count(0, 2));
    expect(starPulseDue(total + 0.1, total + 0.2, total)).toBe(false);
  });

  it('spouts rise, hold and drain, and run down the crack like a fuse', () => {
    const out = { height: -1, width: -1 };
    expect(spoutShape(0, 1, out).height).toBe(0);
    expect(spoutShape(0.4, 1, out).height).toBe(1);
    expect(spoutShape(1, 1, out).height).toBeCloseTo(0, 9);
    // Writes the caller's scratch: no allocation in the frame loop.
    expect(spoutShape(0.4, 1, out)).toBe(out);
    const ds = spoutDistances(40);
    expect(ds.length).toBeGreaterThan(4);
    expect(spoutDelay(ds[0], 40)).toBeLessThan(spoutDelay(ds[ds.length - 1], 40));
  });

  it('quality trims the cosmetic spouts and chunks, never to nothing', () => {
    expect(spoutBudget(9, 1)).toBe(9);
    expect(spoutBudget(9, 0)).toBeGreaterThanOrEqual(4);
    expect(spoutBudget(1, 0)).toBe(1);
    expect(chunkBudget(0)).toBe(2);
    expect(chunkBudget(1)).toBeGreaterThan(chunkBudget(0));
  });

  it('draws the same jagged crack every time', () => {
    for (let i = 0; i < 50; i++) {
      const j = crackJag(i, 123);
      expect(j).toBeGreaterThanOrEqual(-1);
      expect(j).toBeLessThanOrEqual(1);
      expect(crackJag(i, 123)).toBe(j);
    }
  });
});

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

function hooks() {
  const felt: number[] = [];
  return {
    felt,
    hooks: {
      felt: (t: number) => felt.push(t),
      ground: () => {},
      ring: () => {},
    },
  };
}

describe('hazards are drawn on every preset', () => {
  it.each([[0], [0.35], [1]])(
    'quality %s: every fissure, geyser and pool is on the ground',
    (q) => {
      const { scene, live } = fakeScene();
      const fx = new BalgathStarwakeFx(scene, () => 0, hooks().hooks);
      fx.setQuality(q);
      fx.wake(7, 149.5, 295, 7.5);
      for (let i = 0; i < 4; i++) fx.fissureTelegraph(7, 0, 0, Math.sin(i), Math.cos(i), 40, 5);
      fx.geyserTelegraph(7, 10, 10, 4.5, 5);
      expect(fx.liveTelegraphs()).toBe(5);
      // Through the whole telegraph, reduced motion too: still on the ground.
      for (let t = 0; t < 4.9; t += 0.1) fx.update(0.1, true);
      expect(fx.liveTelegraphs()).toBe(5);
      fx.geyserErupted(7, 10, 10, 4.5, 8);
      expect(fx.livePools()).toBe(1);
      // The pool stays through its whole life (and its short fade after).
      for (let t = 0; t < 7.95; t += 0.1) fx.update(0.1, false);
      expect(fx.livePools()).toBe(1);
      for (let t = 0; t < 0.6; t += 0.1) fx.update(0.1, false);
      expect(fx.livePools()).toBe(0);
      fx.geyserTelegraph(7, 0, 0, 4, 5);
      expect(live.size).toBeGreaterThan(0);
      fx.clear();
      expect(live.size).toBe(0);
    },
  );

  it('a felled Foreman takes his pools and marks with him', () => {
    const { scene } = fakeScene();
    const fx = new BalgathStarwakeFx(scene, () => 0, hooks().hooks);
    fx.fissureTelegraph(7, 0, 0, 0, 1, 30, 5);
    fx.geyserErupted(7, 5, 5, 4, 8);
    fx.beginFrame();
    fx.note({ id: 7, dead: true });
    fx.update(0.05, false);
    expect(fx.livePools()).toBe(0);
    expect(fx.liveTelegraphs()).toBe(0);
  });

  it('rides the Star Debris shower: the star spews while waves are called, landings jolt', () => {
    const { scene } = fakeScene();
    const h = hooks();
    const fx = new BalgathStarwakeFx(scene, () => 0, h.hooks);
    const total = 7.5;
    fx.wake(7, 149.5, 295, total);
    // To the eruption, then a wave called every 0.6 s for eight seconds.
    let t = 0;
    const step = (to: number) => {
      while (t < to - 1e-9) {
        fx.beginFrame();
        fx.update(0.05, false);
        t += 0.05;
      }
    };
    step(total);
    for (let w = 0; w < 14; w++) {
      fx.meteorCalled(7);
      step(total + (w + 1) * 0.6);
    }
    // Still lit after the unridden star would long have gone out.
    expect(t).toBeGreaterThan(total + STARWAKE_STAR_AFTERGLOW + 4);
    expect(fx.liveStars()).toBe(1);
    // Then it sleeps within the linger plus the afterglow.
    step(t + STARWAKE_SPEW_LINGER + STARWAKE_STAR_AFTERGLOW + 0.1);
    expect(fx.liveStars()).toBe(0);
    // Another boss's wave never touches this star.
    fx.wake(7, 149.5, 295, 1);
    fx.meteorCalled(9);
    step(t + 1 + STARWAKE_STAR_AFTERGLOW + 0.1);
    expect(fx.liveStars()).toBe(0);
    // Each landing jolts the camera, lighter than a geyser.
    const before = h.felt.length;
    fx.meteorLanded(3, 4, BALGATH_STARWAKE_METEOR_RADIUS);
    expect(h.felt.slice(before)).toEqual([STARWAKE_METEOR_TRAUMA]);
    expect(STARWAKE_METEOR_TRAUMA).toBeLessThan(STARWAKE_GEYSER_TRAUMA);
  });

  it('shakes the camera on the eruptions', () => {
    const { scene } = fakeScene();
    const h = hooks();
    const fx = new BalgathStarwakeFx(scene, () => 0, h.hooks);
    fx.fissureErupted(7, 0, 0, 0, 1, 30);
    fx.geyserErupted(7, 5, 5, 4, 8);
    expect(h.felt.length).toBe(2);
  });
});

describe('the router', () => {
  it('sends each Starwake cue to its layer, and only for a Balgath', () => {
    const calls: string[] = [];
    const fx = {
      starwake: {
        wake: () => calls.push('wake'),
        fissureTelegraph: () => calls.push('fissure'),
        fissureErupted: () => calls.push('fissureErupt'),
        geyserTelegraph: () => calls.push('geyser'),
        geyserErupted: (_s: number, _x: number, _z: number, _r: number, pool: number) =>
          calls.push(`geyserErupt:${pool}`),
      },
    } as unknown as BalgathFx;
    const at = () => [{ id: 7, templateId: 'balgath_cyclops' }];
    const base = { x: 0, z: 0, radius: 30, sourceId: 7, dirX: 0, dirZ: 1, duration: 5 };
    expect(
      routeBalgathSpellfxAt({ ...base, fx: 'burst', ability: STARWAKE_WAKE_ABILITY }, fx, at),
    ).toBe(true);
    expect(
      routeBalgathSpellfxAt(
        { ...base, fx: 'runeCircle', ability: STARWAKE_FISSURE_ABILITY },
        fx,
        at,
      ),
    ).toBe(true);
    expect(
      routeBalgathSpellfxAt({ ...base, fx: 'nova', ability: STARWAKE_FISSURE_ABILITY }, fx, at),
    ).toBe(true);
    expect(
      routeBalgathSpellfxAt(
        { ...base, fx: 'runeCircle', ability: STARWAKE_GEYSER_ABILITY },
        fx,
        at,
      ),
    ).toBe(true);
    expect(
      routeBalgathSpellfxAt(
        { ...base, fx: 'nova', ability: STARWAKE_GEYSER_ABILITY, duration: 8 },
        fx,
        at,
      ),
    ).toBe(true);
    expect(calls).toEqual(['wake', 'fissure', 'fissureErupt', 'geyser', 'geyserErupt:8']);
    // The Star Debris meteors are ridden, never consumed: the meteor layer still draws them.
    calls.length = 0;
    const meteor = { x: 3, z: 4, sourceId: 7, ability: BALGATH_STARWAKE_METEOR_ABILITY };
    const riders = {
      starwake: {
        meteorCalled: (id: number) => calls.push(`called:${id}`),
        meteorLanded: (x: number, z: number, r: number) => calls.push(`landed:${x},${z},${r}`),
      },
    } as unknown as BalgathFx;
    expect(routeBalgathSpellfxAt({ ...meteor, fx: 'meteorFall', radius: 2.4 }, riders, at)).toBe(
      false,
    );
    expect(routeBalgathSpellfxAt({ ...meteor, fx: 'meteorImpact' }, riders, at)).toBe(false);
    expect(routeBalgathSpellfxAt({ ...meteor, fx: 'meteorImpact', sourceId: 9 }, riders, at)).toBe(
      false,
    );
    expect(
      routeBalgathSpellfxAt(
        { ...meteor, fx: 'meteorFall', ability: 'Falling Cinders', radius: 2.4 },
        riders,
        at,
      ),
    ).toBe(false);
    expect(calls).toEqual(['called:7', `landed:3,4,${BALGATH_STARWAKE_METEOR_RADIUS}`]);
    // Another boss's identical cue is never claimed.
    expect(
      routeBalgathSpellfxAt(
        { ...base, fx: 'burst', ability: STARWAKE_WAKE_ABILITY, sourceId: 9 },
        fx,
        at,
      ),
    ).toBe(false);
  });
});

/** Everything three keys a program on for these pieces. */
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
  it('covers the program of every piece a live cast draws', () => {
    const covered = signatures(buildBalgathStarwakeStandIn());
    const { scene, live } = fakeScene();
    const fx = new BalgathStarwakeFx(scene, () => 0, hooks().hooks);
    fx.wake(7, 149.5, 295, 7.5);
    fx.fissureTelegraph(7, 0, 0, 0, 1, 30, 5);
    fx.geyserTelegraph(7, 10, 10, 4.5, 5);
    for (let t = 0; t < 2; t += 0.05) fx.update(0.05, false);
    fx.fissureErupted(7, 0, 0, 0, 1, 30);
    fx.geyserErupted(7, 10, 10, 4.5, 8);
    fx.update(0.05, false);
    const missing: string[] = [];
    for (const root of live)
      for (const sig of signatures(root)) if (!covered.has(sig)) missing.push(sig);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('draws every bundle material and stays hidden', () => {
    const root = buildBalgathStarwakeStandIn();
    const drawn = new Set<THREE.Material>();
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) drawn.add(x);
    });
    for (const mat of Object.values(balgathStarwakeMaterials())) expect(drawn.has(mat)).toBe(true);
    expect(root.visible).toBe(false);
  });
});
