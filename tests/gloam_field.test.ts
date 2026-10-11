// Gloamveil's floor and smoke layer, driven the way the renderer drives it: one
// call per wearer per frame, then one update carrying the viewer's
// reduced-motion setting. Pins who is tracked and for how long, what the entry
// and the tiers draw, the per-frame bound on ground samples, where the floor
// pieces sit on the floor ladder (under every player effect), the compile gate
// hold, and that the field owns, reuses and disposes everything it built.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GLOAM_CUE_ENTER,
  GLOAM_CUE_HIDDEN,
  GLOAM_CUE_PRESENT,
  GLOAM_CUE_REST,
} from '../src/render/characters/gloam_climb_core';
import { CHARACTER_LOD_RANGE_SQ } from '../src/render/crowd_lod';
import {
  floorVfxLayerOf,
  floorVfxLayerTopOrder,
  floorVfxRenderOrder,
} from '../src/render/floor_vfx_layer';
import { GATED_ATTACH_WATCHDOG_MS } from '../src/render/gated_scene_attach';
import { gfxInternalsForTest } from '../src/render/gfx';
import { type GloamCloudHost, GloamField } from '../src/render/gloam_field';
import {
  GLOAM_MAX_WEARERS,
  GLOAM_SPARE_POOLS,
  GLOAM_WEARER_LINGER,
  type GloamTier,
} from '../src/render/gloam_field_core';
import { GLOAM_BREAK_HEIGHT, GLOAM_DRAPE_BUDGET } from '../src/render/gloam_pool_core';
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
    field.update(1 / 60, false);
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
      field.update(1 / 60, false);
    }
    expect(shown(scene, 'gloam_pool')[0].position.x).toBeCloseTo(29 * 0.2, 6);
    // Nobody reports it any more (the form ended, or it left the view): the
    // pool fades out where it lay, then the wearer and its meshes are released.
    field.update(0.3, false);
    expect(field.stats().wearers).toBe(1);
    expect(shown(scene, 'gloam_pool')).toEqual([]);
    field.update(GLOAM_WEARER_LINGER, false);
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
    field.update(1 / 60, false);
    expect(field.stats().wearers).toBe(1);
    field.wearer(1, GLOAM_CUE_HIDDEN, true, 0, feetOf(bodies, 1));
    // Before the frame's update even runs: nothing may mark a stealther.
    expect(field.stats()).toMatchObject({ wearers: 0, stains: 0 });
    expect(shown(scene, 'gloam_pool')).toEqual([]);
    // A hidden cue for someone never tracked is a no-op.
    field.wearer(2, GLOAM_CUE_HIDDEN, true, 0, feetOf(bodies, 2));
    field.update(1 / 60, false);
    expect(field.stats().wearers).toBe(0);
    field.dispose();
  });

  it('rests a swimming wearer: the pool fades out and nothing new is drawn', () => {
    onTier('high');
    const { scene, field, bodies, samples } = rig();
    bodies.set(1, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 20; i++) {
      field.wearer(1, GLOAM_CUE_PRESENT, true, 0, 0);
      field.update(1 / 60, false);
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
      field.update(1 / 60, false);
    }
    expect(samples.count).toBe(0);
    expect(field.stats().puffs).toBeLessThanOrEqual(puffs);
    expect(shown(scene, 'gloam_pool')).toEqual([]);
    // Ashore again: it is laid afresh, with no entry.
    field.wearer(1, GLOAM_CUE_PRESENT, true, 0, 0);
    field.update(1 / 60, false);
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
    field.update(1 / 60, false);
    const pool = shown(scene, 'gloam_pool')[0];
    expect(pool.position.y).toBeGreaterThan(0);
    expect(pool.position.y).toBeLessThan(0.1);
    // A body standing on a deck the ground sampler does not know (a bridge, a
    // dock): the pool lies flat at its feet, far above the sampled ground.
    bodies.set(2, { x: 30, y: 6, z: 0 });
    field.wearer(2, GLOAM_CUE_PRESENT, true, 0, 6);
    field.update(1 / 60, false);
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
    field.update(1 / 60, false);
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
    field.update(1 / 60, false);
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
      field.update(1 / 60, false);
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
      field.update(0, false);
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
        field.update(1 / 60, false);
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
        field.update(1 / 60, false);
      }
      expect(shown(scene, 'gloam_wake').length > 0).toBe(wake);
      field.dispose();
    }
  });

  it('under reduced motion keeps the still pool and emits nothing that moves', () => {
    onTier('high');
    const { scene, field, bodies, glints } = rig();
    const live = gfxInternalsForTest.sharedUniforms().uTime;
    const before = live.value;
    live.value = 12.5;
    restores.push(() => {
      live.value = before;
    });
    for (let i = 0; i < 60; i++) {
      bodies.set(1, { x: i * 0.12, y: 0, z: 0 });
      // The rig reports its plain cues, the entry included: the setting comes
      // with the frame, not with the cue.
      field.wearer(1, i === 0 ? GLOAM_CUE_ENTER : GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
      field.update(1 / 60, true);
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
    field.wearer(1, GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
    field.update(1, false);
    expect(clock.value).toBe(12.5);
    expect(field.stats().puffs).toBeGreaterThan(0);
    field.dispose();
  });

  it('keeps a fading pool still under reduced motion once its wearer stops reporting', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    const live = gfxInternalsForTest.sharedUniforms().uTime;
    const before = live.value;
    live.value = 31.25;
    restores.push(() => {
      live.value = before;
    });
    bodies.set(1, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 30; i++) {
      field.wearer(1, GLOAM_CUE_PRESENT, true, 0, 0);
      field.update(1 / 60, true);
    }
    const pool = shown(scene, 'gloam_pool')[0];
    const clock = (pool.material as THREE.ShaderMaterial).uniforms.uClock;
    expect(clock.value).toBe(0);
    // The form ends (or the body leaves the view, or dives): nobody reports,
    // and the pool fades over the next frames. Its tendrils must not start to
    // move for the length of the fade.
    let faded = 0;
    for (let i = 0; i < 20; i++) {
      field.update(1 / 60, true);
      expect(clock.value).toBe(0);
      if (pool.visible) faded += 1;
    }
    // The fade really was drawn for some of those frames, then ended.
    expect(faded).toBeGreaterThan(3);
    expect(faded).toBeLessThan(20);
    field.dispose();
  });

  it('emits no haze and no bubble on low, and both on high', () => {
    for (const [tier, rich] of [
      ['low', false],
      ['high', true],
    ] as const) {
      onTier(tier);
      const { field, bodies, glints } = rig();
      bodies.set(1, { x: 0, y: 0, z: 0 });
      // Every draw says yes: the haze rate rounds up and the bubble fires on
      // each frame the tier allows one.
      const random = vi.spyOn(Math, 'random').mockReturnValue(0);
      let most = 0;
      for (let i = 0; i < 30; i++) {
        field.wearer(1, GLOAM_CUE_PRESENT, true, 0, 0);
        const puffs = field.stats().puffs;
        field.update(1 / 60, false);
        most = Math.max(most, field.stats().puffs - puffs);
      }
      random.mockRestore();
      // The soft glow is the haze mote and the bubble's core; a sparkle only
      // ever follows a bubble. Low draws neither.
      expect(glints.filter((sprite) => sprite === 10).length > 0, tier).toBe(rich);
      expect(glints.filter((sprite) => sprite === 30).length > 0, tier).toBe(rich);
      // A bubble is a burst of eight puffs or more in one frame; the thin
      // smoke alone never emits more than one.
      expect(most >= 8, tier).toBe(rich);
      field.dispose();
    }
  });

  it('drapes the pool on the grid its tier asks for and caps the wake', () => {
    for (const [tier, cells, wake] of [
      ['high', 12, 8],
      ['medium', 8, 4],
      ['low', 6, 0],
    ] as const) {
      onTier(tier);
      const { scene, field, bodies } = rig();
      let most = 0;
      for (let i = 0; i < 240; i++) {
        // A run: a wake stain every few frames, far more drops than the cap.
        bodies.set(1, { x: i * 0.2, y: 0, z: 0 });
        field.wearer(1, GLOAM_CUE_PRESENT, true, 0, 0);
        field.update(1 / 60, false);
        most = Math.max(most, shown(scene, 'gloam_wake').length);
      }
      const pool = shown(scene, 'gloam_pool')[0];
      expect(pool.geometry.getAttribute('position').count, tier).toBe((cells + 1) ** 2);
      expect(most, tier).toBeLessThanOrEqual(wake);
      if (wake > 0) expect(most, tier).toBeGreaterThan(wake / 2);
      field.dispose();
    }
  });

  it('replaces a pool laid on another tier grid when the preset changes', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    bodies.set(1, { x: 0, y: 0, z: 0 });
    field.wearer(1, GLOAM_CUE_PRESENT, true, 0, 0);
    field.update(1 / 60, false);
    expect(shown(scene, 'gloam_pool')[0].geometry.getAttribute('position').count).toBe(169);
    onTier('low');
    field.wearer(1, GLOAM_CUE_PRESENT, true, 0, 0);
    field.update(1 / 60, false);
    const pools = shown(scene, 'gloam_pool');
    expect(pools.length).toBe(1);
    expect(pools[0].geometry.getAttribute('position').count).toBe(49);
    // The old grid is gone, not parked for a tier that no longer asks for it.
    expect(field.stats().spares).toBe(0);
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
        field.update(1, false);
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
      field.update(1 / 60, false);
      // One centre sample per wearer, the frame's allowance, and at most one
      // wake stain's centre per wearer: a twentieth of what a sample per
      // vertex per pool cost (20 x 169).
      expect(samples.count).toBeLessThanOrEqual(GLOAM_DRAPE_BUDGET + wearers * 2);
      expect(GLOAM_DRAPE_BUDGET + wearers * 2).toBeLessThan((wearers * 169) / 20);
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
      field.update(1 / 60, false);
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

  it('lays a moving pool from remembered ground: its grid once, then only the nodes it reaches', () => {
    onTier('high');
    const { scene, field, bodies, samples, ground } = rig();
    const plane = (x: number, z: number) => x * 0.2 + z * 0.05;
    ground.y = plane;
    const place = (x: number) => {
      bodies.set(1, { x, y: plane(x, 0), z: 0 });
      field.wearer(1, GLOAM_CUE_PRESENT, true, 0, plane(x, 0));
      samples.count = 0;
      field.update(1 / 60, false);
      return samples.count;
    };
    /** How far the laid pool is from the plane it lies on, at worst. */
    const offPlane = (pool: THREE.Mesh, x: number) => {
      const at = pool.geometry.getAttribute('position');
      let worst = 0;
      for (let i = 0; i < at.count; i++) {
        const rise = plane(x + at.getX(i), at.getZ(i)) - plane(x, 0);
        worst = Math.max(worst, Math.abs(at.getY(i) - rise));
      }
      return worst;
    };
    // A pool that has just appeared learns its grid at the frame's allowance:
    // the centre under the feet, then as many nodes as one frame may sample.
    const fill = [place(0), place(0), place(0), place(0)];
    expect(fill[0]).toBe(1 + GLOAM_DRAPE_BUDGET);
    const learned = fill.reduce((a, b) => a + b, 0) - fill.length;
    // Thirteen vertices a side stand on fourteen or fifteen nodes a side.
    expect(learned).toBeGreaterThanOrEqual(14 * 14);
    expect(learned).toBeLessThanOrEqual(15 * 15);
    expect(field.stats().groundNodes).toBe(learned);
    // Whole: standing still costs the centre sample and nothing else.
    expect(fill[3]).toBe(1);
    const pool = shown(scene, 'gloam_pool')[0];
    expect(offPlane(pool, 0)).toBeLessThan(1e-4);
    // A run, a frame at a time (seven yards a second at sixty frames): the
    // pool is laid on every frame, exactly, and samples only the nodes it has
    // just reached. It used to cost one sample a vertex a frame: 169.
    let x = 0;
    let most = 0;
    let total = 0;
    for (let frame = 0; frame < 60; frame++) {
      x += 0.117;
      const spent = place(x);
      most = Math.max(most, spent);
      total += spent;
      expect(pool.position.x).toBe(x);
      expect(pool.position.y).toBeCloseTo(plane(x, 0) + 0.04, 6);
      expect(offPlane(pool, x)).toBeLessThan(1e-4);
    }
    // The centre, at most one new row of nodes, and a wake stain's own centre.
    expect(most).toBeLessThanOrEqual(1 + 15 + 1);
    expect(total / 60).toBeLessThan(9);
    // A crawl under the step: the mesh follows, nothing is laid or sampled.
    const heights = Array.from(pool.geometry.getAttribute('position').array as Float32Array);
    for (let i = 0; i < 6; i++) {
      x += 0.01;
      expect(place(x)).toBe(1);
      expect(pool.position.x).toBe(x);
    }
    expect(Array.from(pool.geometry.getAttribute('position').array as Float32Array)).toEqual(
      heights,
    );
    // Walking back over ground it has already learned costs the centre alone.
    for (let frame = 0; frame < 30; frame++) {
      x -= 0.117;
      expect(place(x)).toBeLessThanOrEqual(2);
      expect(offPlane(pool, x)).toBeLessThan(1e-4);
    }
    field.dispose();
  });

  it('lays the entry ring outward ahead of its front, a few samples a frame, never its corners', () => {
    onTier('high');
    const { scene, field, bodies, samples, ground } = rig();
    // Gentle enough that nothing of the ring breaks away from its floor.
    ground.y = (x) => x * 0.1;
    bodies.set(1, { x: 0, y: 0, z: 0 });
    const frames: number[] = [];
    let behind = 0;
    let checked = 0;
    for (let frame = 0; frame < 70; frame++) {
      field.wearer(1, frame === 0 ? GLOAM_CUE_ENTER : GLOAM_CUE_PRESENT, true, 0, 0);
      samples.count = 0;
      field.update(1 / 60, false);
      frames.push(samples.count);
      const [ring] = shown(scene, 'gloam_ring');
      if (!ring) continue;
      // The front as this frame draws it.
      (ring.onBeforeRender as unknown as () => void)();
      const front = (ring.material as THREE.ShaderMaterial).uniforms.uGrow.value as number;
      const at = ring.geometry.getAttribute('position');
      for (let i = 0; i < at.count; i++) {
        const radius = Math.hypot(at.getX(i), at.getZ(i)) / 7.5;
        if (radius > front) continue;
        checked += 1;
        // Everything the darkness has reached lies on the slope.
        if (Math.abs(at.getY(i) - at.getX(i) * 0.1) > 1e-4) behind += 1;
      }
    }
    // On screen on the frame of the shift, inside the frame's allowance.
    expect(frames[0]).toBeLessThanOrEqual(1 + GLOAM_DRAPE_BUDGET);
    expect(checked).toBeGreaterThan(2000);
    expect(behind).toBe(0);
    // Once the pool has learned its grid the ring is all that samples: a
    // handful of vertices a frame, where one lay used to take all 361 at once.
    const ringFrames = frames.slice(4, 57);
    expect(Math.max(...ringFrames)).toBeLessThanOrEqual(1 + 28);
    // The frame of the shift pays the lead: a few dozen, not the whole grid.
    expect(frames[0] + frames[1] + frames[2] + frames[3]).toBeLessThan(4 + 225 + 90);
    const total = frames.reduce((a, b) => a + b, 0) - frames.length - field.stats().groundNodes;
    expect(total).toBeGreaterThan(200);
    expect(total).toBeLessThan(330);
    // Nothing more once it has passed.
    expect(frames[69]).toBe(1);
    field.dispose();
  });

  it('keeps the ring laid ahead of its front on a slow client too', () => {
    onTier('high');
    // Twelve frames a second: the front covers more than a yard a frame early on.
    const { scene, field, bodies, ground } = rig();
    ground.y = (x) => x * 0.1;
    bodies.set(1, { x: 0, y: 0, z: 0 });
    let behind = 0;
    let checked = 0;
    for (let frame = 0; frame < 14; frame++) {
      field.wearer(1, frame === 0 ? GLOAM_CUE_ENTER : GLOAM_CUE_PRESENT, true, 0, 0);
      field.update(1 / 12, false);
      const [ring] = shown(scene, 'gloam_ring');
      if (!ring) continue;
      (ring.onBeforeRender as unknown as () => void)();
      const front = (ring.material as THREE.ShaderMaterial).uniforms.uGrow.value as number;
      const at = ring.geometry.getAttribute('position');
      for (let i = 0; i < at.count; i++) {
        // What the band draws: everything up to its soft outer edge.
        if (Math.hypot(at.getX(i), at.getZ(i)) / 7.5 > front + 0.03) continue;
        checked += 1;
        if (Math.abs(at.getY(i) - at.getX(i) * 0.1) > 1e-4) behind += 1;
      }
    }
    expect(checked).toBeGreaterThan(800);
    expect(behind).toBe(0);
    field.dispose();
  });

  it('shows two rings on the frame both priests shift, inside one allowance', () => {
    onTier('high');
    const { scene, field, bodies, samples, ground } = rig();
    ground.y = (x) => x * 0.1;
    for (const id of [1, 2]) {
      bodies.set(id, { x: id * 40, y: id * 4, z: 0 });
      field.wearer(id, GLOAM_CUE_ENTER, true, 0, id * 4);
    }
    samples.count = 0;
    field.update(1 / 60, false);
    expect(shown(scene, 'gloam_ring').length).toBe(2);
    // One centre sample a wearer, and the frame's allowance between them.
    expect(samples.count).toBeLessThanOrEqual(GLOAM_DRAPE_BUDGET + 2);
    // Both are draped behind their fronts a moment later, whoever was served first.
    for (let frame = 0; frame < 20; frame++) {
      for (const id of [1, 2]) field.wearer(id, GLOAM_CUE_PRESENT, true, 0, id * 4);
      samples.count = 0;
      field.update(1 / 60, false);
      expect(samples.count).toBeLessThanOrEqual(GLOAM_DRAPE_BUDGET + 2);
    }
    for (const ring of shown(scene, 'gloam_ring')) {
      const at = ring.geometry.getAttribute('position');
      let tilt = 0;
      for (let i = 0; i < at.count; i++) tilt = Math.max(tilt, Math.abs(at.getY(i)));
      expect(tilt).toBeGreaterThan(0.2);
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
      field.update(1 / 60, false);
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
      field.update(1 / 60, false);
      expect(field.stats().puffs).toBeLessThanOrEqual(GLOAM_SMOKE_CAPACITY);
    }
    field.dispose();
  });
});

describe('GloamField: the scene it builds', () => {
  it('puts every floor piece on the top ground rung, on leaves, under every player effect', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    for (let i = 0; i < 40; i++) {
      bodies.set(1, { x: i * 0.12, y: 0, z: 0 });
      field.wearer(1, i === 0 ? GLOAM_CUE_ENTER : GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
      field.update(1 / 60, false);
    }
    const orders = new Map<string, number>();
    root(scene).traverse((object) => {
      if ((object as THREE.Group).isGroup) {
        // A Group's renderOrder becomes three's groupOrder and outranks the ladder.
        expect(object.renderOrder).toBe(0);
        return;
      }
      if (object.name.startsWith('gloam_') && object.name !== 'gloam_smoke') {
        expect(floorVfxLayerOf(object.renderOrder)).toBe('ground');
        orders.set(object.name.replace(':stand-in', ''), object.renderOrder);
      }
    });
    expect([...orders.keys()].sort()).toEqual(['gloam_pool', 'gloam_ring', 'gloam_wake']);
    // One rung for all three: the top of the ground band, which is the literal
    // order 9, one under the lowest rung a player effect can take. A near-black
    // stain that painted over a Consecration, a Ring of Frost or a meteor's
    // footprint would hide ground a player reacts to.
    for (const order of orders.values()) {
      expect(order).toBe(9);
      expect(order).toBe(floorVfxLayerTopOrder('ground'));
      expect(order).toBeLessThan(floorVfxRenderOrder('player', 0));
      expect(order).toBeLessThan(floorVfxRenderOrder('encounter', 0));
    }
    // Over every rung the world's own marks use (blob shadows, torch pools,
    // scorch decals), so plain ground reads as it did.
    expect(floorVfxLayerTopOrder('ground')).toBeGreaterThan(floorVfxRenderOrder('ground', 7));
    field.dispose();
  });

  it('writes each stain own opacity, growth and seed just before it draws', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    for (let i = 0; i < 40; i++) {
      bodies.set(1, { x: i * 0.2, y: 0, z: 0 });
      field.wearer(1, i === 0 ? GLOAM_CUE_ENTER : GLOAM_CUE_PRESENT, true, 0, 0);
      field.update(1 / 60, false);
    }
    const pool = shown(scene, 'gloam_pool')[0];
    const wake = shown(scene, 'gloam_wake');
    const ring = shown(scene, 'gloam_ring')[0];
    expect(wake.length).toBeGreaterThan(1);
    // The pool and the wake share ONE material; what differs is written here.
    expect(wake[0].material).toBe(pool.material);
    const draw = (mesh: THREE.Mesh) => {
      const material = mesh.material as THREE.ShaderMaterial;
      material.uniformsNeedUpdate = false;
      (mesh.onBeforeRender as unknown as () => void)();
      expect(material.uniformsNeedUpdate).toBe(true);
      const u = material.uniforms;
      return {
        alpha: u.uAlpha.value as number,
        grow: u.uGrow.value as number,
        seed: u.uSeed.value,
      };
    };
    const first = draw(pool);
    // Faded in under its wearer, and settling back from the eruption (which
    // peaks at half again the rest size).
    expect(first.alpha).toBe(1);
    expect(first.grow).toBeGreaterThanOrEqual(1);
    expect(first.grow).toBeLessThan(1.1);
    expect(first.seed).toBe(1.7);
    const a = draw(wake[0]);
    const b = draw(wake[1]);
    // A wake stain is thinner and smaller than the pool, and no two share a seed.
    expect(a.alpha).toBeGreaterThan(0);
    expect(a.alpha).toBeLessThan(0.8);
    expect(a.grow).toBeGreaterThanOrEqual(0.55);
    expect(a.grow).toBeLessThan(1);
    expect(a.seed).not.toBe(b.seed);
    expect(a.seed).not.toBe(first.seed);
    // Drawing the wake did not leave its values on the pool's next draw.
    expect(draw(pool)).toEqual(first);
    // The ring has its own material and is on its way out.
    expect(ring.material).not.toBe(pool.material);
    const front = draw(ring);
    expect(front.seed).toBe(3.1);
    expect(front.grow).toBeGreaterThan(0.5);
    expect(front.alpha).toBeGreaterThan(0);
    expect(front.alpha).toBeLessThan(1);
    field.dispose();
  });

  it('fades a draped pool out over a ledge instead of hanging it in the air', () => {
    onTier('high');
    const { scene, field, bodies, ground } = rig();
    // A cliff edge one yard east of the wearer: the floor drops ten yards.
    ground.y = (x) => (x > 1 ? -10 : 0);
    bodies.set(1, { x: 0, y: 0, z: 0 });
    // A few frames: a new pool learns its grid over two or three.
    for (let i = 0; i < 4; i++) {
      field.wearer(1, GLOAM_CUE_PRESENT, true, 0, 0);
      field.update(1 / 60, false);
    }
    const geometry = shown(scene, 'gloam_pool')[0].geometry;
    const position = geometry.getAttribute('position');
    const fade = geometry.getAttribute('aFade');
    let over = 0;
    let on = 0;
    for (let i = 0; i < position.count; i++) {
      if (position.getX(i) > 1) {
        over += 1;
        // Past the edge: invisible, and held one break height below the floor
        // rather than stretched ten yards down the cliff.
        expect(fade.getX(i)).toBe(0);
        expect(position.getY(i)).toBeCloseTo(-GLOAM_BREAK_HEIGHT, 6);
      } else {
        on += 1;
        expect(fade.getX(i)).toBe(1);
        // (a 32-bit vertex a rounding error past its node reads a hair of the drop)
        expect(position.getY(i)).toBeCloseTo(0, 4);
      }
    }
    expect(over).toBeGreaterThan(20);
    expect(on).toBeGreaterThan(20);
    // Both are rewritten on every lay: dynamic buffers, not static ones.
    expect((position as THREE.BufferAttribute).usage).toBe(THREE.DynamicDrawUsage);
    expect((fade as THREE.BufferAttribute).usage).toBe(THREE.DynamicDrawUsage);
    field.dispose();
  });

  it('never shows a vertex over the drop, wherever the pool lies against the grid', () => {
    onTier('high');
    const { scene, field, bodies, ground } = rig();
    ground.y = (x) => (x > 1 ? -10 : 0);
    // Off the grid by a third of a cell and more: the floor is read between
    // nodes, so the fade may start up to one cell before the edge, never after.
    for (const x of [0.11, 0.2, -0.07]) {
      bodies.set(1, { x, y: 0, z: 0.13 });
      for (let i = 0; i < 4; i++) {
        field.wearer(1, GLOAM_CUE_PRESENT, true, 0, 0);
        field.update(1 / 60, false);
      }
      const geometry = shown(scene, 'gloam_pool')[0].geometry;
      const position = geometry.getAttribute('position');
      const fade = geometry.getAttribute('aFade');
      let solid = 0;
      for (let i = 0; i < position.count; i++) {
        const wx = x + position.getX(i);
        if (wx > 1) expect(fade.getX(i)).toBe(0);
        if (wx <= 1 - 0.325) {
          expect(fade.getX(i)).toBe(1);
          expect(position.getY(i)).toBeCloseTo(0, 4);
          solid += 1;
        }
      }
      expect(solid).toBeGreaterThan(80);
    }
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
        field.update(1 / 60, false);
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
    field.update(1 / 60, false);
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
    await Promise.resolve();
    expect(root(failing.scene).visible).toBe(true);
    field.dispose();
    failing.field.dispose();
  });

  it('is revealed by the attach watchdog when a restore gate never settles', async () => {
    onTier('high');
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    restores.push(() => {
      warn.mockRestore();
      vi.useRealTimers();
    });
    let calls = 0;
    const { scene, field } = rig(() => {
      calls += 1;
      // The boot link settles; the one after the context restore never does.
      return calls === 1 ? Promise.resolve() : new Promise<void>(() => undefined);
    });
    await vi.advanceTimersByTimeAsync(0);
    const fieldRoot = root(scene);
    expect(fieldRoot.visible).toBe(true);
    field.onContextRestored();
    expect(calls).toBe(2);
    expect(fieldRoot.visible).toBe(false);
    expect(fieldRoot.parent).toBe(scene);
    await vi.advanceTimersByTimeAsync(GATED_ATTACH_WATCHDOG_MS - 1);
    expect(fieldRoot.visible).toBe(false);
    // The pool and smoke are not lost for the session: revealed, with a trace.
    await vi.advanceTimersByTimeAsync(2);
    expect(fieldRoot.visible).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][1])).toBe('gloam_field');
    field.dispose();
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
      field.update(1 / 60, false);
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
    field.update(1 / 60, false);
    expect(field.stats()).toMatchObject({ wearers: 0, stains: 0, spares: 0, puffs: 0 });
    expect(() => field.dispose()).not.toThrow();
  });

  it('releases every pool and puff on clear, and can be used again', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    bodies.set(1, { x: 0, y: 0, z: 0 });
    field.wearer(1, GLOAM_CUE_ENTER, true, 0, feetOf(bodies, 1));
    field.update(1 / 60, false);
    expect(field.stats().puffs).toBeGreaterThan(0);
    field.clear();
    expect(field.stats()).toMatchObject({ wearers: 0, stains: 0, puffs: 0 });
    expect(shown(scene, 'gloam_pool')).toEqual([]);
    field.wearer(1, GLOAM_CUE_PRESENT, true, 0, feetOf(bodies, 1));
    field.update(1 / 60, false);
    expect(field.stats().wearers).toBe(1);
    field.dispose();
  });

  it('parks the pool of a wearer that left and hands it to the next one', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    bodies.set(1, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 40; i++) {
      bodies.set(1, { x: i * 0.2, y: 0, z: 0 });
      field.wearer(1, i === 0 ? GLOAM_CUE_ENTER : GLOAM_CUE_PRESENT, true, 0, 0);
      field.update(1 / 60, false);
    }
    const geometries = new Set<THREE.BufferGeometry>();
    root(scene).traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry && !object.name.includes('stand-in') && object.name !== 'gloam_smoke') {
        geometries.add(mesh.geometry);
      }
    });
    // The pool, its ring and a wake of stains.
    expect(geometries.size).toBeGreaterThan(4);
    const disposed = new Set<THREE.BufferGeometry>();
    for (const geometry of geometries) {
      geometry.addEventListener('dispose', () => disposed.add(geometry));
    }
    // The camera turns away: nobody reports the wearer, and it is forgotten.
    field.update(GLOAM_WEARER_LINGER + 0.1, false);
    expect(field.stats()).toMatchObject({ wearers: 0, stains: 0, spares: 1 });
    // Nothing of it is left in the scene, and nothing of it was freed.
    let left = 0;
    root(scene).traverse((object) => {
      if (['gloam_pool', 'gloam_ring', 'gloam_wake'].includes(object.name)) left += 1;
    });
    expect(left).toBe(0);
    expect(disposed.size).toBe(0);
    // The camera turns back, onto another priest as it happens: the parked
    // pool is the one it gets, as a pool that was never laid.
    bodies.set(2, { x: 500, y: 3, z: 9 });
    field.wearer(2, GLOAM_CUE_PRESENT, true, 0, 3);
    field.update(1 / 60, false);
    expect(field.stats()).toMatchObject({ wearers: 1, spares: 0 });
    const [pool] = shown(scene, 'gloam_pool');
    expect(geometries.has(pool.geometry)).toBe(true);
    expect(pool.position.x).toBe(500);
    expect(pool.position.z).toBe(9);
    // No ring and no wake from its last wearer.
    expect(shown(scene, 'gloam_ring')).toEqual([]);
    expect(shown(scene, 'gloam_wake')).toEqual([]);
    // It fades in from nothing, like a new one.
    const alpha = () => {
      (pool.onBeforeRender as unknown as () => void)();
      return (pool.material as THREE.ShaderMaterial).uniforms.uAlpha.value as number;
    };
    expect(alpha()).toBeLessThan(0.2);
    for (let i = 0; i < 30; i++) {
      field.wearer(2, GLOAM_CUE_PRESENT, true, 0, 3);
      field.update(1 / 60, false);
    }
    expect(alpha()).toBe(1);
    expect(disposed.size).toBe(0);
    field.dispose();
    expect(disposed.size).toBe(geometries.size);
  });

  it('keeps a bounded number of parked pools and frees them on dispose and on a restore', () => {
    onTier('high');
    const { field, bodies } = rig();
    const crowd = GLOAM_SPARE_POOLS + 5;
    for (let id = 0; id < crowd; id++) {
      bodies.set(id, { x: id * 10, y: 0, z: 0 });
      field.wearer(id, GLOAM_CUE_PRESENT, true, 0, 0);
    }
    field.update(1 / 60, false);
    expect(field.stats().wearers).toBe(crowd);
    field.update(GLOAM_WEARER_LINGER + 0.1, false);
    // The crowd left the view: a few pools are kept, the rest are freed.
    expect(field.stats()).toMatchObject({ wearers: 0, spares: GLOAM_SPARE_POOLS });
    // A context restore lets the parked ones go: nothing of theirs survived it.
    field.onContextRestored();
    expect(field.stats().spares).toBe(0);
    // A zone change keeps them (bounded); dispose frees them.
    bodies.set(1, { x: 0, y: 0, z: 0 });
    field.wearer(1, GLOAM_CUE_PRESENT, true, 0, 0);
    field.update(1 / 60, false);
    field.clear();
    expect(field.stats()).toMatchObject({ wearers: 0, spares: 1 });
    field.dispose();
    expect(field.stats().spares).toBe(0);
  });

  it('gives the pools to the nearest wearers when more are in view than it tracks', () => {
    onTier('high');
    const { scene, field, bodies } = rig();
    // The far crowd is reported first and fills the roster.
    for (let id = 0; id < GLOAM_MAX_WEARERS; id++) {
      bodies.set(id, { x: 100 + id * 10, y: 0, z: 0 });
      field.wearer(id, GLOAM_CUE_PRESENT, true, 400 + id, 0);
    }
    // Then one at the viewer's feet, and one farther than everyone.
    bodies.set(900, { x: -50, y: 0, z: 0 });
    field.wearer(900, GLOAM_CUE_PRESENT, true, 4, 0);
    bodies.set(901, { x: -90, y: 0, z: 0 });
    field.wearer(901, GLOAM_CUE_PRESENT, true, 99999, 0);
    field.update(1 / 60, false);
    expect(field.stats().wearers).toBe(GLOAM_MAX_WEARERS);
    const xs = shown(scene, 'gloam_pool').map((pool) => pool.position.x);
    // The near one has its pool; the farthest of the first crowd gave it up,
    // and the one beyond everybody never got one.
    expect(xs).toContain(-50);
    expect(xs).not.toContain(-90);
    expect(xs).not.toContain(100 + (GLOAM_MAX_WEARERS - 1) * 10);
    expect(xs).toContain(100);
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
