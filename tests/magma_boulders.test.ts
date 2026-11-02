import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Vfx's sprite atlas loads through the asset loader; the contract tests below
// build a real Vfx, so stub the loader the way stepped_leader.test.ts does.
vi.mock('../src/render/assets/loader', () => ({
  loadTexture: vi.fn(async () => ({ image: null })),
  releaseTexture: vi.fn(),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn(),
}));

import type { GraphicsSettingsSnapshot } from '../src/game/graphics_rebuild_core';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import {
  BOULDER_RADIUS,
  BOULDER_START_SCALE,
  FIRE_RING_S,
  type MagmaBurstPlan,
  RING_WAVES,
} from '../src/render/ability_vfx/magma_boulder_core';
import { MagmaBoulders } from '../src/render/ability_vfx/magma_boulders';
import { MAGMA_BURST_ABILITY, playMagmaBurst } from '../src/render/ability_vfx/magma_burst';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { abilityVfxFullSpec } from '../src/render/ability_vfx_registry';
import {
  activateGfxProfile,
  GFX,
  type GfxCapabilities,
  type GfxProfile,
  getActiveGfxProfile,
  resolveGfxProfile,
} from '../src/render/gfx';
import { LightPulses, type TrackedLightHost } from '../src/render/light_pulses';
import { buildMagmaBoulderStandIn, MagmaBoulderVisual } from '../src/render/magma_boulder_visual';
import { MAGMA_BURST_VFX_FULL_SPEC } from '../src/render/shaman_vfx_specs';
import { Vfx } from '../src/render/vfx';
import { createVfxAnchor } from '../src/render/vfx_anchor';
import { installCastVfxCanvasStub } from './helpers/cast_vfx_headless';

const FULL: MagmaBurstPlan = { drips: true, fireRing: true };
const LITE: MagmaBurstPlan = { drips: false, fireRing: false };
const DT = 1 / 60;

interface BurstCall {
  x: number;
  y: number;
  z: number;
  color: number;
  count: number;
  power: number;
  kind: string;
  duration?: number;
}

function fakeLights() {
  const writes: Array<{ token: number; x: number; intensity: number; range: number }> = [];
  const released: Array<{ token: number; fade: number }> = [];
  let next = 100;
  let stale = false;
  const host: TrackedLightHost = {
    track: () => next++,
    setTracked: (token, x, _y, _z, intensity, _color, range) => {
      if (stale) return false;
      writes.push({ token, x, intensity, range: range ?? 0 });
      return true;
    },
    releaseTracked: (token, fade) => released.push({ token, fade }),
  };
  return {
    host,
    writes,
    released,
    goStale: () => {
      stale = true;
    },
  };
}

function harness(lights: TrackedLightHost | null = null) {
  const scene = new THREE.Scene();
  const bursts: BurstCall[] = [];
  const anchors = new Map<number, THREE.Vector3>([
    [1, new THREE.Vector3(0, 1.5, 0)],
    [2, new THREE.Vector3(14, 1.2, 0)],
  ]);
  const boulders = new MagmaBoulders(scene, {
    burst: (x, y, z, color, count, power, kind, duration) =>
      bursts.push({ x, y, z, color, count, power, kind, duration }),
    anchor: (id, _frac, out) => {
      const a = anchors.get(id);
      if (!a) return null;
      return (out ?? new THREE.Vector3()).copy(a);
    },
    groundY: () => 0,
  });
  boulders.setLightHost(lights);
  return { scene, boulders, bursts, anchors };
}

/** Fly the head toward `to` at 26 yd/s, advancing the pool each frame. */
function flyTo(
  boulders: MagmaBoulders,
  head: THREE.Vector3,
  to: THREE.Vector3,
  onFrame?: () => void,
  reducedMotion = false,
): number {
  let frames = 0;
  while (head.distanceTo(to) > 0.3 && frames < 600) {
    const step = Math.min(26 * DT, head.distanceTo(to));
    head.addScaledVector(to.clone().sub(head).normalize(), step);
    boulders.advance(DT, reducedMotion);
    onFrame?.();
    frames++;
  }
  return frames;
}

describe('MagmaBoulderVisual: the rock and its cracks', () => {
  it('is a core under a dozen crust plates, all on the two shared materials', () => {
    const a = new MagmaBoulderVisual();
    const b = new MagmaBoulderVisual();
    expect(a.plateCount).toBe(12);
    const mats = new Set<THREE.Material>();
    const geos = new Set<THREE.BufferGeometry>();
    for (const v of [a, b]) {
      v.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          mats.add(m.material as THREE.Material);
          geos.add(m.geometry);
          expect(m.castShadow).toBe(false);
        }
      });
    }
    expect(mats.size).toBe(2); // crust + core, shared by every boulder
    expect(geos.size).toBe(13); // 12 plates + the core, shared too
  });

  it('pose scales the body and pushes every plate out along its own direction by the gap', () => {
    const v = new MagmaBoulderVisual();
    v.pose(3, 4, 5, 0.6, 0.2, 0, 0);
    expect(v.group.position.toArray()).toEqual([3, 4, 5]);
    const body = v.group.children[0];
    expect(body.scale.x).toBeCloseTo(0.6);
    const plates = body.children.filter((c) => c.name === 'magma-boulder-plate');
    expect(plates.length).toBe(12);
    for (const p of plates) expect(p.position.length()).toBeCloseTo(0.2);
    v.pose(0, 0, 0, 0.6, 0.05, 0, 0);
    for (const p of plates) expect(p.position.length()).toBeCloseTo(0.05);
  });

  it('the prewarm stand-in is one real boulder', () => {
    const g = buildMagmaBoulderStandIn();
    let meshes = 0;
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(13);
  });
});

describe('MagmaBoulders: the boulder rides the projectile and grows', () => {
  it('builds its rocks once, hidden, and shows one per live cast', () => {
    const h = harness();
    const groups = h.scene.children.filter((c) => c.name === 'magma-boulder');
    expect(groups.length).toBe(3);
    expect(h.boulders.visibleCount()).toBe(0);
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = h.boulders.spawn(1, 2, head, FULL);
    expect(handle).toBeGreaterThanOrEqual(0);
    expect(h.boulders.activeCount()).toBe(1);
    expect(h.boulders.visibleCount()).toBe(1);
    // no new scene objects per cast
    expect(h.scene.children.length).toBe(3);
  });

  it('a pebble at the hand swells into a boulder by arrival, its progress tracking the flight', () => {
    const h = harness();
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = h.boulders.spawn(1, 2, head, FULL);
    expect(h.boulders.radiusOfHandle(handle)).toBeCloseTo(BOULDER_RADIUS * BOULDER_START_SCALE);
    const target = h.anchors.get(2) as THREE.Vector3;
    let prevR = 0;
    let midChecked = false;
    flyTo(h.boulders, head, target, () => {
      const r = h.boulders.radiusOfHandle(handle);
      expect(r).toBeGreaterThanOrEqual(prevR - 1e-9);
      prevR = r;
      const p = h.boulders.progressOf(handle);
      if (!midChecked && p > 0.45 && p < 0.55) {
        // the rock follows the head it rides
        const g = h.scene.children.find((c) => c.visible) as THREE.Object3D;
        expect(g.position.distanceTo(head)).toBeLessThan(1e-6);
        midChecked = true;
      }
    });
    expect(midChecked).toBe(true);
    expect(h.boulders.progressOf(handle)).toBeGreaterThan(0.95);
    expect(h.boulders.radiusOfHandle(handle)).toBeGreaterThan(BOULDER_RADIUS * 0.95);
  });

  it('tumbles in flight, but reduced motion keeps it still while it grows', () => {
    for (const reduced of [false, true]) {
      const h = harness();
      const head = new THREE.Vector3(0, 1.5, 0);
      h.boulders.spawn(1, 2, head, FULL);
      const body = () =>
        (h.scene.children.find((c) => c.visible) as THREE.Object3D).children[0].rotation.x;
      const r0 = body();
      for (let i = 0; i < 10; i++) {
        head.x += 0.3;
        h.boulders.advance(DT, reduced);
      }
      if (reduced) expect(body()).toBe(r0);
      else expect(body()).not.toBe(r0);
    }
  });

  it('drips lava on the full plan (more as it grows), none on the lite plan', () => {
    const drips = (plan: MagmaBurstPlan) => {
      const h = harness();
      const head = new THREE.Vector3(0, 1.5, 0);
      h.boulders.spawn(1, 2, head, plan);
      const early: number[] = [];
      const late: number[] = [];
      flyTo(h.boulders, head, h.anchors.get(2) as THREE.Vector3, () => {
        const n = h.bursts.length;
        (head.x < 7 ? early : late).push(n);
      });
      const firstHalf = early.length ? early[early.length - 1] : 0;
      return { total: h.bursts.length, firstHalf, secondHalf: h.bursts.length - firstHalf };
    };
    const full = drips(FULL);
    expect(full.total).toBeGreaterThan(4);
    expect(full.secondHalf).toBeGreaterThan(full.firstHalf);
    expect(drips(LITE).total).toBe(0);
  });
});

describe('MagmaBoulders: the shatter and the ring of fire', () => {
  it('impact hides the rock, shatters it into debris and embers, then the ring burns on its own clock', () => {
    const h = harness();
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = h.boulders.spawn(1, 2, head, LITE);
    flyTo(h.boulders, head, h.anchors.get(2) as THREE.Vector3);
    h.bursts.length = 0;
    const at = new THREE.Vector3(14, 1.2, 0);
    expect(h.boulders.impact(handle, at)).toBe(true);
    expect(h.boulders.impact(handle, at)).toBe(false); // lands once
    expect(h.boulders.visibleCount()).toBe(0);
    const kinds = h.bursts.map((b) => b.kind);
    expect(kinds).toContain('debris');
    expect(kinds).toContain('embers');
    for (const b of h.bursts) expect(b.x).toBe(14);
    // every burst is immediate: the pool never borrows a delayed-burst slot
    expect(h.bursts.every((b) => b.duration === undefined || b.duration <= 1.2)).toBe(true);
  });

  it(`lights ${RING_WAVES} ring waves around the target over the ring life, then releases`, () => {
    const lights = fakeLights();
    const h = harness(lights.host);
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = h.boulders.spawn(1, 2, head, FULL);
    flyTo(h.boulders, head, h.anchors.get(2) as THREE.Vector3);
    const at = new THREE.Vector3(14, 1.2, 0);
    h.boulders.impact(handle, at);
    h.bursts.length = 0;
    let t = 0;
    while (t < FIRE_RING_S + 0.2) {
      h.boulders.advance(DT, false);
      t += DT;
    }
    // ring points sit on the ground, a ring around the impact
    const ring = h.bursts.filter((b) => b.y === 0.1);
    expect(ring.length).toBe(RING_WAVES * 14);
    for (const b of ring) expect(Math.hypot(b.x - 14, b.z)).toBeCloseTo(2.2);
    expect(h.boulders.activeCount()).toBe(0);
    expect(lights.released.length).toBe(1);
  });

  it('the lite plan skips the ring and ends early', () => {
    const h = harness();
    const head = new THREE.Vector3(14, 1.2, 0);
    const handle = h.boulders.spawn(1, 2, head, LITE);
    h.boulders.impact(handle, head.clone());
    h.bursts.length = 0;
    for (let i = 0; i < 40; i++) h.boulders.advance(DT, false);
    expect(h.bursts.length).toBe(0);
    expect(h.boulders.activeCount()).toBe(0);
  });
});

describe('MagmaBoulders: the light grows with the rock and floods the impact', () => {
  it('borrows one tracked slot, brightens and widens in flight, floods at impact, standing off the body', () => {
    const lights = fakeLights();
    const h = harness(lights.host);
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = h.boulders.spawn(1, 2, head, FULL);
    flyTo(h.boulders, head, h.anchors.get(2) as THREE.Vector3, undefined, true);
    const flight = lights.writes.slice();
    expect(new Set(flight.map((w) => w.token)).size).toBe(1);
    expect(flight[flight.length - 1].intensity).toBeGreaterThan(flight[0].intensity * 2);
    expect(flight[flight.length - 1].range).toBeGreaterThan(flight[0].range * 2);
    const peakFlight = Math.max(...flight.map((w) => w.intensity));
    h.boulders.impact(handle, new THREE.Vector3(14, 1.2, 0));
    lights.writes.length = 0;
    h.boulders.advance(DT, true);
    const flood = lights.writes[0];
    expect(flood.intensity).toBeGreaterThan(peakFlight);
    // stood back toward the caster, not inside the struck body
    expect(flood.x).toBeCloseTo(14 - 1.2);
  });

  it('stops writing once its slot was taken, and draws fine with no light host', () => {
    const lights = fakeLights();
    const h = harness(lights.host);
    const head = new THREE.Vector3(0, 1.5, 0);
    h.boulders.spawn(1, 2, head, FULL);
    h.boulders.advance(DT, true);
    const n = lights.writes.length;
    lights.goStale();
    h.boulders.advance(DT, true);
    h.boulders.advance(DT, true);
    expect(lights.writes.length).toBe(n);
    const bare = harness(null);
    const head2 = new THREE.Vector3(0, 1.5, 0);
    const handle = bare.boulders.spawn(1, 2, head2, FULL);
    flyTo(bare.boulders, head2, bare.anchors.get(2) as THREE.Vector3);
    expect(bare.boulders.impact(handle, head2.clone())).toBe(true);
  });
});

describe('MagmaBoulders: the light survives the one-light tier', () => {
  // The stepped_leader.test.ts rig: a desktop capability set, the low tier
  // forced through the URL (no composer, so the pulse pool is ONE light).
  const capabilities: GfxCapabilities = Object.freeze({
    deviceMemory: 8,
    hardwareConcurrency: 12,
    maxTouchPoints: 0,
    coarsePointer: false,
    narrowViewport: false,
    gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)',
    nativeApp: false,
    tightMemory: false,
    platform: 'other',
    softwareRendering: false,
  });
  const preferences: GraphicsSettingsSnapshot = {
    graphicsPreset: 2,
    terrainDetail: 1,
    foliageDensity: 1,
    surfaceDetail: 1,
    effectsQuality: 1,
    shadowQuality: 1,
    antiAliasing: 1,
    bloomQuality: 1,
    ambientOcclusion: 1,
    viewDistance: 1,
    waterQuality: 1,
    characterDetail: 1,
    dynamicLights: 1,
    particleEffects: 1,
    ghostFade: 0,
  };
  let restore: GfxProfile | null = null;
  beforeEach(() => {
    restore = getActiveGfxProfile();
  });
  afterEach(() => {
    if (restore) activateGfxProfile(restore);
    restore = null;
  });

  it('when the cast flash takes the only light, the rock claims it back once the flash fades', () => {
    activateGfxProfile(resolveGfxProfile(capabilities, preferences, '?gfx=low'));
    expect(GFX.composer).toBe(false);
    const lp = new LightPulses(new THREE.Scene());
    expect(lp.lights.length).toBe(1);
    const h = harness(lp);
    const head = new THREE.Vector3(0, 1.5, 0);
    h.boulders.spawn(1, 2, head, FULL);
    h.boulders.advance(DT, true);
    expect(lp.lights[0].color.getHex()).toBe(0xff5a18);
    // the release flash (an ordinary pulse) takes the one slot
    lp.pulse(new THREE.Vector3(), 'fire', 6, 0.3, 7);
    let reclaimed = -1;
    for (let f = 0; f < 60; f++) {
      head.x += 0.2;
      lp.update(DT);
      h.boulders.advance(DT, true);
      if (reclaimed < 0 && lp.lights[0].color.getHex() === 0xff5a18 && lp.lights[0].intensity > 0)
        reclaimed = f;
    }
    // not during the flash, but well before the rock lands
    expect(reclaimed).toBeGreaterThan(5);
    expect(reclaimed).toBeLessThan(40);
    expect(lp.lights[0].position.x).toBeCloseTo(head.x);
  });
});

describe('MagmaBoulders: failsafes', () => {
  it('a lost projectile drops the rock and its light with no shatter', () => {
    const lights = fakeLights();
    const h = harness(lights.host);
    const head = new THREE.Vector3(0, 1.5, 0);
    const handle = h.boulders.spawn(1, 2, head, LITE);
    h.boulders.advance(DT, false);
    h.boulders.lost(handle);
    expect(h.boulders.activeCount()).toBe(0);
    expect(h.boulders.visibleCount()).toBe(0);
    expect(h.bursts.length).toBe(0);
    expect(lights.released.length).toBe(1);
    // a stale handle is inert
    expect(h.boulders.impact(handle, head)).toBe(false);
  });

  it('an orphan boulder (its projectile went without a callback) stands down', () => {
    const lights = fakeLights();
    const h = harness(lights.host);
    h.boulders.spawn(1, 2, new THREE.Vector3(0, 1.5, 0), FULL);
    for (let i = 0; i < 60 * 4; i++) h.boulders.advance(DT, false);
    expect(h.boulders.activeCount()).toBe(0);
    expect(lights.released.length).toBe(1);
  });

  it('recycles the oldest rock when every slot is busy, and the old handle goes stale', () => {
    const h = harness();
    const first = h.boulders.spawn(1, 2, new THREE.Vector3(0, 1.5, 0), FULL);
    h.boulders.advance(DT, false);
    h.boulders.spawn(1, 2, new THREE.Vector3(0, 1.5, 0), FULL);
    h.boulders.advance(DT, false);
    h.boulders.spawn(1, 2, new THREE.Vector3(0, 1.5, 0), FULL);
    const fourth = h.boulders.spawn(1, 2, new THREE.Vector3(0, 1.5, 0), FULL);
    expect(h.boulders.activeCount()).toBe(3);
    expect(fourth).not.toBe(first);
    expect(h.boulders.progressOf(first)).toBe(-1);
    expect(h.boulders.progressOf(fourth)).toBeGreaterThanOrEqual(0);
  });

  it('clear drops every rock; dispose removes them from the scene and refuses spawns', () => {
    const lights = fakeLights();
    const h = harness(lights.host);
    h.boulders.spawn(1, 2, new THREE.Vector3(0, 1.5, 0), FULL);
    h.boulders.spawn(1, 2, new THREE.Vector3(0, 1.5, 0), FULL);
    h.boulders.clear();
    expect(h.boulders.activeCount()).toBe(0);
    expect(lights.released.length).toBe(2);
    h.boulders.dispose();
    expect(h.scene.children.length).toBe(0);
    expect(h.boulders.spawn(1, 2, new THREE.Vector3(), FULL)).toBe(-1);
  });
});

describe('playMagmaBurst: Magma Burst routes its cue onto the boulder', () => {
  function fakes(headOut: THREE.Vector3 | null, withOrb = true) {
    const calls: unknown[] = [];
    const fx = {
      magmaBoulder: vi.fn(
        (
          _a: string,
          _spec: unknown,
          _s: number,
          _t: number,
          _head: THREE.Vector3,
          _plan: MagmaBurstPlan,
          _c: number,
          _tier: number,
        ) => 7,
      ),
      magmaBoulderImpact: vi.fn(),
      magmaBoulderLost: vi.fn(),
    };
    let captured: { onImpact?: (p: THREE.Vector3) => void; onLost?: () => void } = {};
    const vfx = withOrb
      ? {
          moltenOrbProjectile: (_s: number, _t: number, _c?: number, opts?: typeof captured) => {
            calls.push(opts);
            captured = opts ?? {};
            return headOut;
          },
        }
      : {};
    return { calls, fx, vfx, captured: () => captured };
  }

  it('is keyed to the lava_burst ability id, whose registered spec holds the orb windup', () => {
    expect(MAGMA_BURST_ABILITY).toBe('lava_burst');
    expect(abilityVfxFullSpec('lava_burst')).toBe(MAGMA_BURST_VFX_FULL_SPEC);
    expect(MAGMA_BURST_VFX_FULL_SPEC.windupStyle).toBe('orb');
  });

  it('launches a molten head and rides it with a boulder; impact and loss route by handle', () => {
    const head = new THREE.Vector3(1, 2, 3);
    const f = fakes(head);
    expect(playMagmaBurst(f.vfx, f.fx, undefined, 1, 2, 0xff7a1a, 0)).toBe(true);
    expect(f.calls.length).toBe(1);
    expect(f.fx.magmaBoulder).toHaveBeenCalledWith(
      'lava_burst',
      undefined,
      1,
      2,
      head,
      FULL,
      0xff7a1a,
      0,
    );
    const at = new THREE.Vector3(9, 9, 9);
    f.captured().onImpact?.(at);
    expect(f.fx.magmaBoulderImpact).toHaveBeenCalledWith(7, at);
    f.captured().onLost?.();
    expect(f.fx.magmaBoulderLost).toHaveBeenCalledWith(7);
  });

  it('tier 1 and low quality reach the plan; the spam floor and an orb-less host decline', () => {
    const f = fakes(new THREE.Vector3());
    playMagmaBurst(f.vfx, f.fx, undefined, 1, 2, 0xff7a1a, 1);
    expect(f.fx.magmaBoulder.mock.calls[0][5]).toEqual(LITE);
    playMagmaBurst(f.vfx, f.fx, undefined, 1, 2, 0xff7a1a, 0, 0.2);
    expect(f.fx.magmaBoulder.mock.calls[1][5]).toEqual({ drips: false, fireRing: true });
    expect(playMagmaBurst(f.vfx, f.fx, undefined, 1, 2, 0xff7a1a, 2)).toBe(false);
    const bare = fakes(new THREE.Vector3(), false);
    expect(playMagmaBurst(bare.vfx, bare.fx, undefined, 1, 2, 0xff7a1a, 0)).toBe(false);
    expect(bare.fx.magmaBoulder).not.toHaveBeenCalled();
  });

  it('a caster with no anchor launches nothing and starts no boulder, yet the cue is handled', () => {
    const f = fakes(null);
    expect(playMagmaBurst(f.vfx, f.fx, undefined, 1, 2, 0xff7a1a, 0)).toBe(true);
    expect(f.fx.magmaBoulder).not.toHaveBeenCalled();
  });
});

describe('the real painter routes Magma Burst onto the boulder', () => {
  function rig() {
    installCastVfxCanvasStub();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
    const place = (id: number) => ({ x: id * 6, z: 0 });
    const anchor = createVfxAnchor((id, pose) => {
      const at = place(id);
      pose.x = at.x;
      pose.y = 0;
      pose.z = at.z;
      pose.height = 2;
      return true;
    });
    const fx = new AbilityVfxFx(
      scene,
      camera,
      anchor,
      () => 0,
      () => 0,
    );
    // the renderer's wiring (renderer_ability_presentation.ts): the pool sits
    // outside fx and is reached through closures
    const boulders = new MagmaBoulders(scene, {
      burst: () => {},
      anchor,
      groundY: () => 0,
    });
    fx.setMagmaBoulderPort({
      spawn: (s, t, head, plan) => boulders.spawn(s, t, head, plan),
      impact: (handle, at) => {
        boulders.impact(handle, at);
      },
      lost: (handle) => boulders.lost(handle),
      advance: (dt, reduced) => boulders.advance(dt, reduced),
      clear: () => boulders.clear(),
      dispose: () => boulders.dispose(),
      count: () => boulders.activeCount(),
    });
    const launches: Array<{ kind: string; args: unknown[] }> = [];
    const record =
      (kind: string) =>
      (...args: unknown[]) => {
        launches.push({ kind, args });
      };
    const painter = new AbilityVfx(
      {
        fx,
        vfx: {
          projectile: record('projectile'),
          lightningProjectile: () => null,
          moltenOrbProjectile: (...args: unknown[]) => {
            launches.push({ kind: 'orb', args });
            return new THREE.Vector3(6, 1.2, 0);
          },
          burst: record('burst'),
          nova: record('nova'),
          tick: record('tick'),
          shoutwave: record('shoutwave'),
          buffSwirl: record('buffSwirl'),
          beam: record('beam'),
        },
        anchor: (id, heightFrac) => ({ ...place(id), y: heightFrac * 2 }),
        spawnAoeRing: () => {},
        triggerAttack: () => {},
        localPlayerId: () => 1,
        isWarrior: () => false,
        isLivingWarrior: () => false,
        isMob: () => false,
        castingAbilityOf: () => null,
        castVfxAdmit: () => true,
        castVfxReady: () => true,
      },
      () => 0,
    );
    return { fx, painter, launches, boulders };
  }
  const cue = (fx: string, ability: string) => ({
    type: 'spellfx' as const,
    sourceId: 1,
    targetId: 2,
    school: 'fire',
    fx,
    ability,
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the Magma Burst heavyBolt cue launches a molten head ridden by a boulder', () => {
    const { fx, painter, launches, boulders } = rig();
    expect(painter.handleSpellfx(cue('heavyBolt', 'lava_burst'))).toBe(true);
    expect(launches.filter((l) => l.kind === 'orb').length).toBe(1);
    expect(launches.filter((l) => l.kind === 'projectile').length).toBe(0);
    expect(fx.magmaBoulderCount()).toBe(1);
    expect(boulders.visibleCount()).toBe(1);
    // the arrival fires the boulder's shatter through fx
    const opts = launches.find((l) => l.kind === 'orb')?.args[3] as {
      onImpact: (at: THREE.Vector3) => void;
    };
    opts.onImpact(new THREE.Vector3(12, 1, 0));
    expect(boulders.visibleCount()).toBe(0);
  });

  it("another ability's heavyBolt cue keeps the generic projectile: no boulder", () => {
    const { fx, painter, launches } = rig();
    painter.handleSpellfx(cue('heavyBolt', 'fireball'));
    expect(fx.magmaBoulderCount()).toBe(0);
    expect(launches.some((l) => l.kind === 'orb')).toBe(false);
  });

  it('fx.clear drops a live boulder', () => {
    const { fx, painter } = rig();
    painter.handleSpellfx(cue('heavyBolt', 'lava_burst'));
    fx.clear();
    expect(fx.magmaBoulderCount()).toBe(0);
  });
});

describe('Vfx: the molten-orb projectile contract the boulder rides', () => {
  function rig() {
    installCastVfxCanvasStub();
    const at = new Map<number, THREE.Vector3>([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(10, 1, 0)],
    ]);
    const vfx = new Vfx(new THREE.Scene(), (id, _frac, out) => {
      const p = at.get(id);
      return p ? (out ?? new THREE.Vector3()).copy(p) : null;
    });
    return { vfx, at };
  }
  afterEach(() => vi.unstubAllGlobals());

  it('returns the live head, moved in place, and calls onImpact once on arrival', () => {
    const { vfx } = rig();
    const onImpact = vi.fn();
    const onLost = vi.fn();
    const head = vfx.moltenOrbProjectile(1, 2, 0xff7a1a, { onImpact, onLost });
    expect(head).toBeInstanceOf(THREE.Vector3);
    const x0 = head?.x ?? 0;
    vfx.update(DT);
    expect(head?.x).toBeGreaterThan(x0);
    for (let i = 0; i < 120 && onImpact.mock.calls.length === 0; i++) vfx.update(DT);
    expect(onImpact).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) vfx.update(DT);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(onLost).not.toHaveBeenCalled();
  });

  it('calls onLost when the target vanishes mid-flight or the pool clears', () => {
    const { vfx, at } = rig();
    const onLost = vi.fn();
    vfx.moltenOrbProjectile(1, 2, 0xff7a1a, { onLost });
    vfx.update(DT);
    at.delete(2);
    vfx.update(DT);
    expect(onLost).toHaveBeenCalledTimes(1);
    at.set(2, new THREE.Vector3(10, 1, 0));
    const onLost2 = vi.fn();
    vfx.moltenOrbProjectile(1, 2, 0xff7a1a, { onLost: onLost2 });
    vfx.clear();
    expect(onLost2).toHaveBeenCalledTimes(1);
  });

  it('returns null and launches nothing for a caster with no anchor', () => {
    const { vfx } = rig();
    expect(vfx.moltenOrbProjectile(9, 2, 0xff7a1a)).toBeNull();
  });
});
