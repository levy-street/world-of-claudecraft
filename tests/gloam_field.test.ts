// Gloamveil's floor and smoke layer, driven the way the renderer drives it: one
// call per wearer per frame, then one update. Pins who is tracked and for how
// long, what the entry and the tiers draw, the per-frame bound on ground
// samples, where the floor pieces sit on the floor ladder, the compile gate
// hold, and that the field owns and disposes everything it built.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GLOAM_CUE_ENTER,
  GLOAM_CUE_HIDDEN,
  GLOAM_CUE_PRESENT,
  GLOAM_CUE_REST,
  GLOAM_CUE_STILL,
} from '../src/render/characters/gloam_climb_core';
import { CHARACTER_LOD_RANGE_SQ } from '../src/render/crowd_lod';
import { floorVfxLayerOf } from '../src/render/floor_vfx_layer';
import { gfxInternalsForTest } from '../src/render/gfx';
import { type GloamCloudHost, GloamField } from '../src/render/gloam_field';
import { GLOAM_WEARER_LINGER, type GloamTier } from '../src/render/gloam_field_core';
import { GLOAM_DRAPE_BUDGET } from '../src/render/gloam_pool_core';
import { GLOAM_SMOKE_CAPACITY } from '../src/render/gloam_smoke';

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

function onTier(tier: GloamTier): void {
  restores.push(gfxInternalsForTest.overrideSettings({ effectsTier: tier }));
}

interface Rig {
  scene: THREE.Scene;
  field: GloamField;
  /** Where each wearer stands: the feet. The body anchor is 1.1 above. */
  bodies: Map<number, { x: number; y: number; z: number }>;
  glints: number[];
  samples: { count: number };
  ground: { y: (x: number, z: number) => number };
  quality: { value: number };
}

function rig(gate?: (target: THREE.Object3D) => Promise<unknown>): Rig {
  const scene = new THREE.Scene();
  const bodies = new Map<number, { x: number; y: number; z: number }>();
  const glints: number[] = [];
  const samples = { count: 0 };
  const ground = { y: (_x: number, _z: number) => 0 };
  const quality = { value: 1 };
  const cloud: GloamCloudHost = {
    sprites: [10, 20, 30],
    spawn: (_x, _y, _z, _vx, _vy, _vz, _color, _size, _life, _gravity, sprite) => {
      glints.push(sprite);
    },
    quality: () => quality.value,
  };
  const field = new GloamField(
    scene,
    (id, frac, out) => {
      const body = bodies.get(id);
      if (!body) return null;
      return (out ?? new THREE.Vector3()).set(body.x, body.y + 2.45 * frac, body.z);
    },
    cloud,
    (x, z) => {
      samples.count += 1;
      return ground.y(x, z);
    },
    gate,
  );
  return { scene, field, bodies, glints, samples, ground, quality };
}

/** Where a body touches its floor: what the entity loop hands the field. */
function feetOf(bodies: Rig['bodies'], id: number): number {
  return bodies.get(id)?.y ?? 0;
}

function root(scene: THREE.Scene): THREE.Object3D {
  const found = scene.getObjectByName('gloam_field');
  if (!found) throw new Error('the field root is not in the scene');
  return found;
}

function shown(scene: THREE.Scene, name: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root(scene).traverse((object) => {
    if (object.name === name && object.visible) out.push(object as THREE.Mesh);
  });
  return out;
}

describe('GloamField: who is tracked', () => {
  it('lays a pool under a wearer on the first update and fades it in', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    bodies.set(1, { x: 4, y: 0, z: -3 });
    expect(field.stats().wearers).toBe(0);
    field.wearer(1, GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
    field.update(1 / 60);
    expect(field.stats()).toMatchObject({ wearers: 1, stains: 1 });
    const [pool] = shown(scene, 'gloam_pool');
    expect(pool.position.x).toBe(4);
    expect(pool.position.z).toBe(-3);
    // On the floor it was sampled from, lifted clear of it.
    expect(pool.position.y).toBeGreaterThan(0);
    expect(pool.position.y).toBeLessThan(0.1);
    // No entry for a wearer first seen already in the form: no ring.
    expect(shown(scene, 'gloam_ring')).toEqual([]);
    field.dispose();
  });

  it('follows a wearer that keeps being reported and forgets one that stops', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    bodies.set(1, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 30; i++) {
      bodies.set(1, { x: i * 0.2, y: 0, z: 0 });
      field.wearer(1, GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
      field.update(1 / 60);
    }
    expect(shown(scene, 'gloam_pool')[0].position.x).toBeCloseTo(29 * 0.2, 6);
    // Nobody reports it any more (the form ended, or it left the view): the
    // pool fades out where it lay, then the wearer and its meshes are released.
    field.update(0.3);
    expect(field.stats().wearers).toBe(1);
    expect(shown(scene, 'gloam_pool')).toEqual([]);
    field.update(GLOAM_WEARER_LINGER);
    expect(field.stats()).toMatchObject({ wearers: 0, stains: 0 });
    let left = 0;
    root(scene).traverse((object) => {
      if (object.name === 'gloam_pool' || object.name === 'gloam_wake') left += 1;
    });
    expect(left).toBe(0);
    field.dispose();
  });

  it('drops a ghosted or stealthed wearer at once, with no fade', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    bodies.set(1, { x: 0, y: 0, z: 0 });
    field.wearer(1, GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
    field.update(1 / 60);
    expect(field.stats().wearers).toBe(1);
    field.wearer(1, GLOAM_CUE_HIDDEN, true, 0, feetOf(bodies, 1));
    // Before the frame's update even runs: nothing may mark a stealther.
    expect(field.stats()).toMatchObject({ wearers: 0, stains: 0 });
    expect(shown(scene, 'gloam_pool')).toEqual([]);
    // A hidden cue for someone never tracked is a no-op.
    field.wearer(2, GLOAM_CUE_HIDDEN, true, 0, feetOf(bodies, 2));
    field.update(1 / 60);
    expect(field.stats().wearers).toBe(0);
    field.dispose();
  });

  it('rests a swimming wearer: the pool fades out and nothing new is drawn', () => {
    onTier('high');
    const { scene, field, bodies, samples } = rig();
    bodies.set(1, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 20; i++) {
      field.wearer(1, GLOAM_CUE_PRESENT, true, 0, 0);
      field.update(1 / 60);
    }
    expect(shown(scene, 'gloam_pool').length).toBe(1);
    // Into the water. The wearer is not dropped (no pop): it fades like a
    // form that ended, and costs no ground sample and no puff meanwhile.
    field.wearer(1, GLOAM_CUE_REST, false, 0, -3);
    expect(field.stats().wearers).toBe(1);
    samples.count = 0;
    const puffs = field.stats().puffs;
    for (let i = 0; i < 20; i++) {
      field.wearer(1, GLOAM_CUE_REST, false, 0, -3);
      field.update(1 / 60);
    }
    expect(samples.count).toBe(0);
    expect(field.stats().puffs).toBeLessThanOrEqual(puffs);
    expect(shown(scene, 'gloam_pool')).toEqual([]);
    // Ashore again: it is laid afresh, with no entry.
    field.wearer(1, GLOAM_CUE_PRESENT, true, 0, 0);
    field.update(1 / 60);
    expect(shown(scene, 'gloam_pool').length).toBe(1);
    expect(shown(scene, 'gloam_ring')).toEqual([]);
    field.dispose();
  });

  it("lays the pool where the body touches its floor, never at a rider's saddle", () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    // A rider: the displayed pose (the anchor) sits a saddle above the hooves.
    bodies.set(1, { x: 0, y: 1.9, z: 0 });
    field.wearer(1, GLOAM_CUE_PRESENT, true, 0, 0);
    field.update(1 / 60);
    const pool = shown(scene, 'gloam_pool')[0];
    expect(pool.position.y).toBeGreaterThan(0);
    expect(pool.position.y).toBeLessThan(0.1);
    // A body standing on a deck the ground sampler does not know (a bridge, a
    // dock): the pool lies flat at its feet, far above the sampled ground.
    bodies.set(2, { x: 30, y: 6, z: 0 });
    field.wearer(2, GLOAM_CUE_PRESENT, true, 0, 6);
    field.update(1 / 60);
    const onDeck = shown(scene, 'gloam_pool').find((mesh) => mesh.position.x === 30);
    expect(onDeck?.position.y).toBeGreaterThan(6);
    expect(onDeck?.position.y).toBeLessThan(6.1);
    const y = onDeck?.geometry.getAttribute('position').array as Float32Array;
    for (let i = 1; i < y.length; i += 3) expect(y[i]).toBe(0);
    field.dispose();
  });

  it('ignores a wearer with no live view', () => {
    onTier('high');
    const { field } = rig();
    field.wearer(404, GLOAM_CUE_ENTER, true, 0, 0);
    field.update(1 / 60);
    expect(field.stats()).toMatchObject({ wearers: 0, stains: 0, puffs: 0 });
    field.dispose();
  });
});

describe('GloamField: the entry and the tiers', () => {
  it('erupts on a shift seen happening: the ring, the smoke column, the glints', () => {
    onTier('high');
    const { scene, field, bodies, glints } = rig();
    bodies.set(1, { x: 0, y: 0, z: 0 });
    field.wearer(1, GLOAM_CUE_ENTER, true, 0, feetOf(bodies, 1));
    field.update(1 / 60);
    expect(shown(scene, 'gloam_ring').length).toBe(1);
    // 46 column puffs and 20 skirt puffs, plus this frame's ambient smoke.
    expect(field.stats().puffs).toBeGreaterThanOrEqual(66);
    // One soft glow, one flash, 28 sparkles (the host's own atlas cells).
    expect(glints.filter((sprite) => sprite === 20).length).toBe(1);
    expect(glints.filter((sprite) => sprite === 30).length).toBe(28);
    expect(glints.filter((sprite) => sprite === 10).length).toBeGreaterThanOrEqual(1);
    // The ring passes; the entry is not replayed by staying in the form.
    for (let i = 0; i < 90; i++) {
      field.wearer(1, GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
      field.update(1 / 60);
    }
    expect(shown(scene, 'gloam_ring')).toEqual([]);
    expect(glints.filter((sprite) => sprite === 20).length).toBe(1);
    field.dispose();
  });

  it('thins the entry and drops the sparkles on medium, and keeps the ring on low', () => {
    for (const [tier, puffs, sparkles] of [
      ['medium', Math.round(46 * 0.7) + Math.round(20 * 0.7), 0],
      ['low', Math.round(46 * 0.4) + Math.round(20 * 0.4), 0],
    ] as const) {
      onTier(tier);
      const { scene, field, bodies, glints, quality } = rig();
      // No ambient smoke this frame, so the count is the entry's alone.
      quality.value = 0;
      bodies.set(1, { x: 0, y: 0, z: 0 });
      field.wearer(1, GLOAM_CUE_ENTER, true, CHARACTER_LOD_RANGE_SQ * 4, feetOf(bodies, 1));
      field.update(0);
      expect(field.stats().puffs).toBe(puffs);
      expect(glints.filter((sprite) => sprite === 30).length).toBe(sparkles);
      expect(glints.filter((sprite) => sprite === 20).length).toBe(1);
      expect(shown(scene, 'gloam_ring').length).toBe(1);
      field.dispose();
    }
  });

  it('keeps the pool under the feet on every tier', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      onTier(tier);
      const { scene, field, bodies } = rig();
      bodies.set(1, { x: 0, y: 0, z: 0 });
      for (let i = 0; i < 20; i++) {
        field.wearer(1, GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
        field.update(1 / 60);
      }
      expect(shown(scene, 'gloam_pool').length).toBe(1);
      field.dispose();
    }
  });

  it('leaves a wake behind a walking wearer on high, and none on low', () => {
    for (const [tier, wake] of [
      ['high', true],
      ['low', false],
    ] as const) {
      onTier(tier);
      const { scene, field, bodies } = rig();
      for (let i = 0; i < 40; i++) {
        bodies.set(1, { x: i * 0.12, y: 0, z: 0 });
        field.wearer(1, GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
        field.update(1 / 60);
      }
      expect(shown(scene, 'gloam_wake').length > 0).toBe(wake);
      field.dispose();
    }
  });

  it('under reduced motion keeps the still pool and emits nothing that moves', () => {
    onTier('high');
    const { scene, field, bodies, glints } = rig();
    for (let i = 0; i < 60; i++) {
      bodies.set(1, { x: i * 0.12, y: 0, z: 0 });
      // The rig reports the still cue for as long as the setting is on, the
      // frame of the shift included.
      field.wearer(1, GLOAM_CUE_STILL, true, 0, feetOf(bodies, 1));
      field.update(1 / 60);
    }
    expect(shown(scene, 'gloam_pool').length).toBe(1);
    expect(shown(scene, 'gloam_ring')).toEqual([]);
    expect(shown(scene, 'gloam_wake')).toEqual([]);
    expect(field.stats().puffs).toBe(0);
    expect(glints).toEqual([]);
    // The tendril clock is held still.
    const pool = shown(scene, 'gloam_pool')[0];
    const clock = (pool.material as THREE.ShaderMaterial).uniforms.uClock;
    expect(clock.value).toBe(0);
    // The setting comes off: the next frame moves again.
    const live = gfxInternalsForTest.sharedUniforms().uTime;
    const before = live.value;
    live.value = 12.5;
    field.wearer(1, GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
    field.update(1);
    expect(clock.value).toBe(12.5);
    expect(field.stats().puffs).toBeGreaterThan(0);
    live.value = before;
    field.dispose();
  });

  it('thins the smoke rate with the cloud governor and never the pool', () => {
    onTier('high');
    const counts: number[] = [];
    for (const quality of [1, 0]) {
      const { scene, field, bodies, quality: q } = rig();
      q.value = quality;
      bodies.set(1, { x: 0, y: 0, z: 0 });
      let emitted = 0;
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.999);
      for (let i = 0; i < 20; i++) {
        field.wearer(1, GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
        const before = field.stats().puffs;
        field.update(1);
        emitted += Math.max(0, field.stats().puffs - before);
      }
      random.mockRestore();
      counts.push(emitted);
      expect(shown(scene, 'gloam_pool').length).toBe(1);
      field.dispose();
    }
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(0);
  });
});

describe('GloamField: the cost of the floor', () => {
  it('spends a bounded number of ground samples a frame, however many pools move', () => {
    onTier('high');
    const { field, bodies, samples } = rig();
    const wearers = 20;
    for (let frame = 0; frame < 40; frame++) {
      for (let id = 0; id < wearers; id++) {
        // Every wearer runs: every pool wants a fresh lay every frame.
        bodies.set(id, { x: id * 10 + frame * 0.3, y: 0, z: 0 });
        field.wearer(id, GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, id));
      }
      samples.count = 0;
      field.update(1 / 60);
      // One centre sample per wearer, the frame's allowance, and at most one
      // wake stain's centre per wearer: far below a lay per pool (20 x 169).
      expect(samples.count).toBeLessThanOrEqual(GLOAM_DRAPE_BUDGET + wearers * 2);
    }
    field.dispose();
  });

  it('serves every moving pool in turn instead of starving the last ones', () => {
    onTier('high');
    const { scene, field, bodies, ground } = rig();
    // A slope: a pool that is properly laid has vertices off its own plane.
    ground.y = (x) => x * 0.2;
    const wearers = 8;
    for (let frame = 0; frame < 60; frame++) {
      for (let id = 0; id < wearers; id++) {
        bodies.set(id, { x: id * 10 + frame * 0.3, y: (id * 10 + frame * 0.3) * 0.2, z: 0 });
        field.wearer(id, GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, id));
      }
      field.update(1 / 60);
    }
    const pools = shown(scene, 'gloam_pool');
    expect(pools.length).toBe(wearers);
    for (const pool of pools) {
      const y = pool.geometry.getAttribute('position').array as Float32Array;
      let tilt = 0;
      for (let i = 1; i < y.length; i += 3) tilt = Math.max(tilt, Math.abs(y[i]));
      // Draped on the slope, not left flat: it was laid at least once.
      expect(tilt).toBeGreaterThan(0.1);
    }
    field.dispose();
  });

  it('lays a far pool flat and spends one sample on it', () => {
    onTier('high');
    const { scene, field, bodies, samples, ground } = rig();
    ground.y = (x) => x * 0.2;
    for (let frame = 0; frame < 10; frame++) {
      bodies.set(1, { x: frame * 0.3, y: frame * 0.06, z: 0 });
      field.wearer(1, GLOAM_CUE_PRESENT, true, CHARACTER_LOD_RANGE_SQ + 1, feetOf(bodies, 1));
      samples.count = 0;
      field.update(1 / 60);
      expect(samples.count).toBe(1);
    }
    const y = shown(scene, 'gloam_pool')[0].geometry.getAttribute('position').array as Float32Array;
    for (let i = 1; i < y.length; i += 3) expect(y[i]).toBe(0);
    field.dispose();
  });

  it('holds the smoke to its pool, whatever a crowd emits', () => {
    onTier('high');
    const { field, bodies } = rig();
    for (let id = 0; id < 20; id++) bodies.set(id, { x: id * 5, y: 0, z: 0 });
    for (let frame = 0; frame < 30; frame++) {
      for (let id = 0; id < 20; id++)
        field.wearer(id, GLOAM_CUE_ENTER, true, 0, feetOf(bodies, id));
      field.update(1 / 60);
      expect(field.stats().puffs).toBeLessThanOrEqual(GLOAM_SMOKE_CAPACITY);
    }
    field.dispose();
  });
});

describe('GloamField: the scene it builds', () => {
  it('puts every floor piece in the player band, on leaves, clear of the other modules', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    for (let i = 0; i < 40; i++) {
      bodies.set(1, { x: i * 0.12, y: 0, z: 0 });
      field.wearer(1, i === 0 ? GLOAM_CUE_ENTER : GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
      field.update(1 / 60);
    }
    const orders = new Map<string, number>();
    root(scene).traverse((object) => {
      if ((object as THREE.Group).isGroup) {
        // A Group's renderOrder becomes three's groupOrder and outranks the ladder.
        expect(object.renderOrder).toBe(0);
        return;
      }
      if (object.name.startsWith('gloam_') && object.name !== 'gloam_smoke') {
        expect(floorVfxLayerOf(object.renderOrder)).toBe('player');
        orders.set(object.name.replace(':stand-in', ''), object.renderOrder);
      }
    });
    expect([...orders.keys()].sort()).toEqual(['gloam_pool', 'gloam_ring', 'gloam_wake']);
    // The ring paints over the pool and its wake, which share a rung.
    expect(orders.get('gloam_wake')).toBe(orders.get('gloam_pool'));
    expect(orders.get('gloam_ring')).toBe((orders.get('gloam_pool') as number) + 1);
    field.dispose();
  });

  it('draws every stain with one of two materials and tags every drawable for the boot warm-up', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    for (let id = 0; id < 3; id++) {
      for (let i = 0; i < 30; i++) {
        bodies.set(id, { x: id * 9 + i * 0.12, y: 0, z: 0 });
        field.wearer(
          id,
          i === 0 ? GLOAM_CUE_ENTER : GLOAM_CUE_PRESENT,
          true,
          0,
          feetOf(bodies, id),
        );
        field.update(1 / 60);
      }
    }
    const materials = new Set<THREE.Material>();
    let drawables = 0;
    root(scene).traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.material) return;
      drawables += 1;
      materials.add(mesh.material as THREE.Material);
      // Its OWN tag: the warm-up walk never reads an inherited one.
      expect(mesh.userData.renderCategory).toBe('vfx');
    });
    expect(drawables).toBeGreaterThan(8);
    // The smoke cloud, the pool (and wake) and the ring: three programs.
    expect(materials.size).toBe(3);
    field.dispose();
  });

  it('stays hidden behind the compile gate until its programs are linked', async () => {
    onTier('high');
    let settle: (() => void) | undefined;
    const gated: THREE.Object3D[] = [];
    const { scene, field, bodies } = rig((target) => {
      gated.push(target);
      return new Promise<void>((resolve) => {
        settle = resolve;
      });
    });
    const fieldRoot = root(scene);
    expect(gated).toEqual([fieldRoot]);
    expect(fieldRoot.visible).toBe(false);
    // The gate links all three programs: a stand-in of each floor material and
    // the smoke cloud are under the root before any wearer exists.
    const names: string[] = [];
    fieldRoot.traverse((object) => {
      if ((object as THREE.Mesh).material) names.push(object.name);
    });
    expect(names.sort()).toEqual(['gloam_pool:stand-in', 'gloam_ring:stand-in', 'gloam_smoke']);
    // Work continues behind the hold, drawing nothing.
    bodies.set(1, { x: 0, y: 0, z: 0 });
    field.wearer(1, GLOAM_CUE_ENTER, true, 0, feetOf(bodies, 1));
    field.update(1 / 60);
    expect(fieldRoot.visible).toBe(false);
    settle?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(fieldRoot.visible).toBe(true);
    field.dispose();
  });

  it('goes back behind its gate when the WebGL context is restored', async () => {
    onTier('high');
    const settles: Array<() => void> = [];
    const { scene, field } = rig(
      () =>
        new Promise<void>((resolve) => {
          settles.push(resolve);
        }),
    );
    const fieldRoot = root(scene);
    settles.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(fieldRoot.visible).toBe(true);
    // The programs went with the old context: nothing draws until they relink.
    field.onContextRestored();
    expect(fieldRoot.visible).toBe(false);
    expect(settles.length).toBe(1);
    settles.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(fieldRoot.visible).toBe(true);
    // A gate that rejects still reveals: a late link beats an invisible layer.
    const failing = rig(() => Promise.reject(new Error('gate closed')));
    await Promise.resolve();
    await Promise.resolve();
    failing.field.onContextRestored();
    await Promise.resolve();
    await Promise.resolve();
    expect(root(failing.scene).visible).toBe(true);
    field.dispose();
    failing.field.dispose();
  });

  it('attaches at once where there is no gate, and a context restore changes nothing', () => {
    const { scene, field } = rig();
    expect(root(scene).visible).toBe(true);
    field.onContextRestored();
    expect(root(scene).visible).toBe(true);
    field.dispose();
  });
});

describe('GloamField: ownership', () => {
  it('disposes its three materials and every geometry, and leaves the scene', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    for (let i = 0; i < 40; i++) {
      bodies.set(1, { x: i * 0.12, y: 0, z: 0 });
      field.wearer(1, i === 0 ? GLOAM_CUE_ENTER : GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
      field.update(1 / 60);
    }
    const disposed = new Set<unknown>();
    const owned = new Set<unknown>();
    root(scene).traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.material) return;
      for (const resource of [mesh.geometry, mesh.material as THREE.Material]) {
        owned.add(resource);
        resource.addEventListener('dispose', () => disposed.add(resource));
      }
    });
    expect(owned.size).toBeGreaterThan(10);
    field.dispose();
    expect(disposed.size).toBe(owned.size);
    expect(scene.getObjectByName('gloam_field')).toBeUndefined();
    // Inert afterwards, and a second dispose is a no-op.
    field.wearer(1, GLOAM_CUE_ENTER, true, 0, feetOf(bodies, 1));
    field.update(1 / 60);
    expect(field.stats()).toMatchObject({ wearers: 0, stains: 0, puffs: 0 });
    expect(() => field.dispose()).not.toThrow();
  });

  it('releases every pool and puff on clear, and can be used again', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    bodies.set(1, { x: 0, y: 0, z: 0 });
    field.wearer(1, GLOAM_CUE_ENTER, true, 0, feetOf(bodies, 1));
    field.update(1 / 60);
    expect(field.stats().puffs).toBeGreaterThan(0);
    field.clear();
    expect(field.stats()).toMatchObject({ wearers: 0, stains: 0, puffs: 0 });
    expect(shown(scene, 'gloam_pool')).toEqual([]);
    field.wearer(1, GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
    field.update(1 / 60);
    expect(field.stats().wearers).toBe(1);
    field.dispose();
  });

  it('never revealed after a dispose that lands while its gate is pending', async () => {
    let settle: (() => void) | undefined;
    const { scene, field } = rig(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const fieldRoot = root(scene);
    field.dispose();
    settle?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(fieldRoot.visible).toBe(false);
    expect(fieldRoot.parent).toBeNull();
  });
});
