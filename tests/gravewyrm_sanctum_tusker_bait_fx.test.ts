// The Sledge Tusker's bait rework in the renderer: the pure plan
// (src/render/gravewyrm_sanctum_fx/tusker_bait_fx_core.ts) and its painter
// (tusker_bait_fx.ts) on a fake SanctumFxHost and a stub world. The painter
// mints every mesh and material once in its constructor and nothing after;
// every ACTIONABLE read draws on every density and motion setting (the
// outcrops in their three states, the ring round the outcrop a lane will end
// in, the gold window under a stuck Tusker, a trail's edge, river and flame
// walls); and the lane the renderer paints is the lane the sim plans.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SANCTUM_SLEDGE_TUSKER_LOOK } from '../src/render/characters/sanctum_creature_looks';
import { TelegraphKit } from '../src/render/floor_telegraph';
import { tramplePaintLength } from '../src/render/gravewyrm_sanctum_fx/sanctum_fx_core';
import type { SanctumFxHost } from '../src/render/gravewyrm_sanctum_fx/sanctum_fx_host';
import { TuskerBaitFx } from '../src/render/gravewyrm_sanctum_fx/tusker_bait_fx';
import {
  BAIT_POOLS,
  BAIT_RING_RADIUS,
  OUTCROP_FANGS,
  OUTCROP_FLASH_SECONDS,
  OUTCROP_HEIGHT,
  OUTCROP_STUMPS,
  outcropFlash,
  outcropFootprint,
  outcropPhase,
  STUCK_RING_RADIUS,
  struckOutcrop,
  stuckRing,
  TRAIL_LOOK,
  TUSKER_STRAIN_GESTURE,
  trailPresence,
} from '../src/render/gravewyrm_sanctum_fx/tusker_bait_fx_core';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  SANCTUM_ICE_OUTCROP,
  SANCTUM_ICE_OUTCROP_BROKEN,
  SANCTUM_ICE_OUTCROP_STRUCK,
  SANCTUM_OUTCROP_HELD,
  SANCTUM_SOULFIRE_PATCH,
  SANCTUM_SOULFIRE_TRAIL,
  SANCTUM_TRAIL_BURN,
  SLEDGE_TUSKER_ID,
  TUSKER_TUNING as T,
  TUSKER_BREAKS_FREE,
  TUSKER_OUTCROPS,
  TUSKER_STUCK_EXPOSED,
  TUSKER_TRAMPLE,
  TUSKER_TUSKS_STICK,
} from '../src/sim/encounters/gravewyrm_sanctum/ids';
import { planTrampleLane } from '../src/sim/encounters/gravewyrm_sanctum/tusker_road';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const O = instanceOrigin(DUNGEONS.gravewyrm_sanctum.index, 0);

function leg(s: number, side = 0): { x: number; z: number } {
  const d = Math.hypot(42, 21.8);
  return {
    x: -26 + (42 / d) * s + (21.8 / d) * side,
    z: -137.9 + (21.8 / d) * s - (42 / d) * side,
  };
}

describe('the bait plan (pure)', () => {
  it('reads an outcrop state off its template, and nothing else', () => {
    expect(outcropPhase(SANCTUM_ICE_OUTCROP)).toBe('whole');
    expect(outcropPhase(SANCTUM_ICE_OUTCROP_STRUCK)).toBe('struck');
    expect(outcropPhase(SANCTUM_ICE_OUTCROP_BROKEN)).toBe('broken');
    expect(outcropPhase(SANCTUM_SOULFIRE_PATCH)).toBeNull();
    expect(outcropPhase(SANCTUM_SOULFIRE_TRAIL)).toBeNull();
  });

  it('an outcrop stands three players tall on the body the sim tests; its stump is knee high', () => {
    // A player stands 2.6 yd.
    expect(OUTCROP_HEIGHT).toBeGreaterThanOrEqual(2.6 * 2.9);
    expect(Math.max(...OUTCROP_FANGS.map((f) => f.h))).toBe(OUTCROP_HEIGHT);
    expect(OUTCROP_FANGS.length).toBeGreaterThanOrEqual(6);
    expect(outcropFootprint()).toBeLessThanOrEqual(T.outcropRadius + 0.1);
    expect(Math.max(...OUTCROP_STUMPS.map((s) => s.h))).toBeLessThan(OUTCROP_HEIGHT / 4);
    // The ring round a baited outcrop clears its feet.
    expect(BAIT_RING_RADIUS).toBeGreaterThan(outcropFootprint() + 1);
  });

  it('an impact flashes white and is gone in under half a second', () => {
    expect(outcropFlash(0)).toBe(1);
    expect(outcropFlash(OUTCROP_FLASH_SECONDS / 2)).toBeGreaterThan(0);
    expect(outcropFlash(OUTCROP_FLASH_SECONDS / 2)).toBeLessThan(0.5);
    expect(outcropFlash(OUTCROP_FLASH_SECONDS)).toBe(0);
    expect(outcropFlash(-1)).toBe(0);
    expect(OUTCROP_FLASH_SECONDS).toBeLessThan(0.5);
  });

  it('a struck outcrop is shoved by the slam, cracks through the hold and shudders as the beast heaves', () => {
    const slam = struckOutcrop(0, T.stuckSeconds);
    const mid = struckOutcrop(2, 2);
    const heave = struckOutcrop(3.8, 0.2);
    expect(slam.shove).toBeGreaterThan(0.3);
    expect(mid.shove).toBeLessThan(0.02);
    expect(slam.cracks).toBeGreaterThanOrEqual(0.5);
    expect(mid.cracks).toBeGreaterThan(slam.cracks);
    expect(heave.cracks).toBeGreaterThan(mid.cracks);
    expect(heave.cracks).toBeLessThanOrEqual(1);
    expect(heave.jitter).toBeGreaterThan(mid.jitter);
    expect(slam.jitter).toBeGreaterThan(mid.jitter);
  });

  it('the stuck window ring drains with the seconds left and beats faster as it ends', () => {
    expect(stuckRing(T.stuckSeconds, T.stuckSeconds, 0).fill).toBe(1);
    expect(stuckRing(1, T.stuckSeconds, 0).fill).toBeCloseTo(0.25, 9);
    expect(stuckRing(0, T.stuckSeconds, 0).fill).toBe(0);
    expect(stuckRing(1, 0, 0).fill).toBe(0);
    for (let t = 0; t < 3; t += 0.07) {
      const r = stuckRing(2, T.stuckSeconds, t);
      expect(r.fade).toBeGreaterThanOrEqual(0.56 - 1e-9);
      expect(r.fade).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(STUCK_RING_RADIUS).toBeGreaterThan(3.5 + 3);
  });

  it('a trail races down its lane as the charge runs, stands, and gutters; its edge never fades early', () => {
    const total = T.trailSeconds;
    // Just lit: the fire has barely caught.
    expect(trailPresence(0, total, total).front).toBe(0);
    const half = trailPresence(TRAIL_LOOK.igniteSeconds / 2, total - 0.5, total);
    expect(half.front).toBeGreaterThan(0.4);
    expect(half.front).toBeLessThan(1);
    expect(trailPresence(TRAIL_LOOK.igniteSeconds, total - 1, total).front).toBe(1);
    // A view that meets it already burning sees it lit end to end.
    expect(trailPresence(0, total - 10, total).front).toBe(1);
    // Standing: full flames. Guttering: shorter, never out while it burns.
    expect(trailPresence(10, 15, total).flames).toBe(1);
    const dying = trailPresence(29, 1, total);
    expect(dying.flames).toBeLessThan(0.6);
    expect(dying.flames).toBeGreaterThan(0.25);
    expect(dying.edge).toBe(1);
    expect(trailPresence(30, 0, total).edge).toBe(0);
    // The flames stand well over a player.
    expect(TRAIL_LOOK.flameHeight).toBeGreaterThan(2.6 * 1.5);
    expect(TRAIL_LOOK.igniteSeconds).toBeGreaterThanOrEqual(T.trampleRun);
  });

  it('pools every outcrop of the road and the two trails that can burn at once, with a spare', () => {
    expect(BAIT_POOLS.outcrops).toBeGreaterThan(TUSKER_OUTCROPS.length);
    expect(BAIT_POOLS.trails).toBeGreaterThan(Math.ceil(T.trailSeconds / T.trampleEvery));
  });

  it('the lane the renderer paints is the lane the sim plans, outcrop and all', () => {
    const mid = leg(8);
    const behind = leg(27.5, 4.5);
    const yaw = Math.atan2(behind.x - mid.x, behind.z - mid.z);
    const local = TUSKER_OUTCROPS.map((s, i) => ({ id: i, x: s.x, z: s.z }));
    const world = local.map((s) => ({ id: s.id, x: O.x + s.x, z: O.z + s.z }));
    const plan = planTrampleLane(mid.x, mid.z, yaw, local);
    expect(plan.outcropId).toBe(3);
    expect(tramplePaintLength(O.x + mid.x, O.z + mid.z, yaw, world)).toBeCloseTo(plan.reach, 6);
    // With the outcrop gone the paint runs the whole lane again.
    const plain = planTrampleLane(mid.x, mid.z, yaw, []);
    expect(tramplePaintLength(O.x + mid.x, O.z + mid.z, yaw)).toBeCloseTo(plain.reach, 6);
    expect(plain.reach).toBeGreaterThan(plan.reach);
  });

  it('the stuck beast paws the ice: the strain gesture plays its Trample warning clip', () => {
    expect(SANCTUM_SLEDGE_TUSKER_LOOK.clips.attackByAbility?.[TUSKER_STRAIN_GESTURE]).toBe(
      'TrampleWindup',
    );
  });
});

// ---- the painter ----------------------------------------------------------------------

interface StubEntity {
  id: number;
  kind: 'mob' | 'player' | 'object';
  templateId: string;
  pos: { x: number; y: number; z: number };
  facing: number;
  scale: number;
  dead: boolean;
  auras: { id: string; remaining: number; duration: number }[];
  castingAbility: string | null;
  castRemaining: number;
  castTotal: number;
  castTargetId: number | null;
}

function stage() {
  const entities = new Map<number, StubEntity>();
  const add = (e: Partial<StubEntity> & { id: number; templateId: string }): StubEntity => {
    const full: StubEntity = {
      kind: 'object',
      pos: { x: O.x, y: 44, z: O.z },
      facing: 0,
      scale: 1,
      dead: false,
      auras: [],
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      castTargetId: null,
      ...e,
    };
    entities.set(full.id, full);
    return full;
  };
  const outcrops = TUSKER_OUTCROPS.map((s, i) =>
    add({
      id: 200 + i,
      templateId: SANCTUM_ICE_OUTCROP,
      pos: { x: O.x + s.x, y: 44, z: O.z + s.z },
      scale: T.outcropRadius,
    }),
  );
  const mid = leg(8);
  const behind = leg(27.5, 4.5);
  const tusker = add({
    id: 100,
    kind: 'mob',
    templateId: SLEDGE_TUSKER_ID,
    pos: { x: O.x + mid.x, y: 44, z: O.z + mid.z },
    facing: Math.atan2(behind.x - mid.x, behind.z - mid.z),
    scale: 2.8,
  });
  return { world: { entities, playerId: 1 } as unknown as IWorld, add, entities, outcrops, tusker };
}

function fakeHost(density: number, reduced: boolean) {
  const root = new THREE.Group();
  const kitRoot = new THREE.Group();
  const kit = new TelegraphKit(kitRoot, density >= 1);
  let seed = 7;
  const count = { puffs: 0, shards: 0, rings: 0, shakes: 0, gestures: [] as string[] };
  const host: SanctumFxHost = {
    root,
    kit,
    density,
    uTime: { value: 0 },
    groundY: () => 44,
    puff: () => {
      count.puffs++;
    },
    shockRing: () => {
      count.rings++;
    },
    rand: () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    },
    reducedMotion: () => reduced,
    shake: () => {
      count.shakes++;
    },
    gesture: (_id, g) => {
      count.gestures.push(g);
    },
    shards: {
      burst: (_x: number, _y: number, _z: number, n: number) => {
        count.shards += n;
      },
    } as never,
  };
  return { host, root, kitRoot, kit, count };
}

function drawn(roots: THREE.Object3D[], name: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const r of roots)
    r.traverseVisible((o) => {
      if (o.name === name) out.push(o);
    });
  return out;
}

function scan(fx: TuskerBaitFx, world: IWorld): void {
  fx.beginScan();
  for (const e of world.entities.values()) {
    if (e.kind === 'object') fx.scanObject(e);
    else if (e.templateId === SLEDGE_TUSKER_ID) fx.scanTusker(e);
  }
  fx.endScan();
}

function counters() {
  const id = (x: object) => (x as { id: number }).id;
  return {
    material: id(new THREE.MeshBasicMaterial()),
    texture: id(new THREE.Texture()),
    geometry: id(new THREE.BufferGeometry()),
  };
}

function uniform(o: THREE.Object3D, name: string): number {
  return ((o as THREE.Mesh).material as THREE.ShaderMaterial).uniforms[name].value as number;
}

const SETTINGS: [number, boolean][] = [
  [1, false],
  [1, true],
  [0.4, false],
  [0.4, true],
];

describe('the bait painter', () => {
  for (const [density, reduced] of SETTINGS) {
    it(`draws every actionable read and mints nothing after the constructor (density ${density}, reduced motion ${reduced})`, () => {
      const { world, add, entities, outcrops, tusker } = stage();
      const { host, root, kitRoot, kit, count } = fakeHost(density, reduced);
      const fx = new TuskerBaitFx(host, world);
      const roots = [root, kitRoot];
      const fan = vi.spyOn(kit, 'fan');
      const lane = vi.spyOn(kit, 'lane');
      const children = root.children.length + kitRoot.children.length;
      const before = counters();
      let clock = 0;
      const step = (n = 1) => {
        for (let i = 0; i < n; i++) {
          clock += 1 / 60;
          host.uTime.value = clock;
          scan(fx, world);
          fx.update(1 / 60, clock);
        }
      };
      const whole = () =>
        drawn(roots, 'sanctumIceOutcrop').filter((g) => g.children[0].visible).length;
      const stumps = () =>
        drawn(roots, 'sanctumIceOutcrop').filter((g) => g.children[1].visible).length;

      // Five outcrops stand whole on the road, each where the sim put it.
      step();
      expect(drawn(roots, 'sanctumIceOutcrop')).toHaveLength(5);
      expect(whole()).toBe(5);
      expect(stumps()).toBe(0);
      expect(fx.standing()).toHaveLength(5);
      expect(drawn(roots, 'sanctum-tusker-bait-ring')).toHaveLength(0);
      expect(drawn(roots, 'sanctum-tusker-stuck-ring')).toHaveLength(0);

      // A Trample aimed at the fourth: its ring draws and its ice glows
      // hardest; every other intact outcrop glows a little through the aim.
      Object.assign(tusker, {
        castingAbility: TUSKER_TRAMPLE,
        castTotal: T.trampleCast,
        castRemaining: T.trampleCast / 2,
      });
      step(20);
      const ring = drawn(roots, 'sanctum-tusker-bait-ring');
      expect(ring).toHaveLength(1);
      expect(ring[0].position.x).toBeCloseTo(outcrops[3].pos.x, 6);
      expect(ring[0].position.z).toBeCloseTo(outcrops[3].pos.z, 6);
      const armed = drawn(roots, 'sanctumIceOutcrop').map((g) => uniform(g.children[0], 'uArmed'));
      expect(armed.filter((a) => a > 0.5)).toHaveLength(1);
      expect(armed.filter((a) => a > 0.2 && a < 0.4)).toHaveLength(4);

      // The tusks go in: shards, the shock, the shake, the flash; the outcrop
      // cracks and the gold window opens under the beast.
      tusker.castingAbility = null;
      outcrops[3].templateId = SANCTUM_ICE_OUTCROP_STRUCK;
      Object.assign(outcrops[3], {
        castingAbility: SANCTUM_OUTCROP_HELD,
        castTotal: T.stuckSeconds,
        castRemaining: T.stuckSeconds - 0.5,
      });
      tusker.auras.push({ id: TUSKER_STUCK_EXPOSED, remaining: 3.5, duration: T.stuckSeconds });
      const shardsBefore = count.shards;
      expect(
        fx.handleEvent(
          {
            type: 'spellfx',
            ability: TUSKER_TUSKS_STICK,
            fx: 'nova',
            sourceId: tusker.id,
            targetId: outcrops[3].id,
            school: 'frost',
          } as never,
          tusker as unknown as Entity,
        ),
      ).toBe(true);
      expect(count.shards - shardsBefore).toBeGreaterThan(20);
      expect(count.rings).toBeGreaterThan(0);
      expect(count.shakes > 0).toBe(!reduced);
      step();
      expect(drawn(roots, 'sanctum-tusker-bait-ring')).toHaveLength(0);
      const window = drawn(roots, 'sanctum-tusker-stuck-ring');
      expect(window).toHaveLength(1);
      expect(window[0].position.x).toBeCloseTo(tusker.pos.x, 6);
      const struck = drawn(roots, 'sanctumIceOutcrop')
        .map((g) => g.children[0])
        .filter((m) => uniform(m, 'uStruck') > 0);
      expect(struck).toHaveLength(1);
      expect(uniform(struck[0], 'uFlash')).toBeGreaterThan(0);
      expect(count.gestures).toContain(TUSKER_STRAIN_GESTURE);
      expect(fx.standing()).toHaveLength(4);

      // It wrenches free: the burst, and a stump where the outcrop stood.
      outcrops[3].templateId = SANCTUM_ICE_OUTCROP_BROKEN;
      outcrops[3].castingAbility = null;
      tusker.auras.length = 0;
      const burstBefore = count.shards;
      fx.handleEvent(
        {
          type: 'spellfx',
          ability: TUSKER_BREAKS_FREE,
          fx: 'nova',
          sourceId: tusker.id,
          targetId: outcrops[3].id,
          school: 'frost',
        } as never,
        tusker as unknown as Entity,
      );
      expect(count.shards - burstBefore).toBeGreaterThan(60);
      step();
      expect(whole()).toBe(4);
      expect(stumps()).toBe(1);
      expect(drawn(roots, 'sanctum-tusker-stuck-ring')).toHaveLength(0);

      // A soulfire trail: its edge, its river and its flame walls, laid down
      // the lane, lit end to end once the fire has run it.
      const start = leg(4);
      const yaw = Math.atan2(42, 21.8);
      const trail = add({
        id: 300,
        templateId: SANCTUM_SOULFIRE_TRAIL,
        pos: { x: O.x + start.x, y: 44, z: O.z + start.z },
        facing: yaw,
        scale: 30,
        castingAbility: SANCTUM_TRAIL_BURN,
        castTotal: T.trailSeconds,
        castRemaining: T.trailSeconds,
      });
      step();
      const river = drawn(roots, 'sanctumSoulfireTrailRiver');
      const walls = drawn(roots, 'sanctumSoulfireTrailWalls');
      expect(river).toHaveLength(1);
      expect(walls).toHaveLength(1);
      expect(uniform(river[0], 'uLength')).toBe(30);
      expect(uniform(walls[0], 'uFront')).toBeLessThan(0.1);
      expect(river[0].scale.x).toBeCloseTo(T.trailHalfWidth * 2, 6);
      expect(river[0].scale.z).toBeCloseTo(30, 6);
      expect(walls[0].scale.y).toBe(TRAIL_LOOK.flameHeight);
      // The flame walls overlap down the lane: laid over (never added), so
      // they keep the soulfire's green and violet instead of burning out to
      // white on the snow; the river under them still glows (added).
      expect(((walls[0] as THREE.Mesh).material as THREE.Material).blending).toBe(
        THREE.NormalBlending,
      );
      expect(((river[0] as THREE.Mesh).material as THREE.Material).blending).toBe(
        THREE.AdditiveBlending,
      );
      expect(river[0].rotation.y).toBeCloseTo(yaw, 6);
      trail.castRemaining = T.trailSeconds - 3;
      step(4);
      expect(uniform(walls[0], 'uFront')).toBe(1);
      expect(uniform(river[0], 'uFlames')).toBe(1);
      // A second trail takes its own slot.
      add({
        id: 301,
        templateId: SANCTUM_SOULFIRE_TRAIL,
        pos: { x: O.x + leg(20).x, y: 44, z: O.z + leg(20).z },
        facing: yaw + 0.4,
        scale: 12,
        castingAbility: SANCTUM_TRAIL_BURN,
        castTotal: T.trailSeconds,
        castRemaining: T.trailSeconds,
      });
      step();
      expect(drawn(roots, 'sanctumSoulfireTrailRiver')).toHaveLength(2);
      // Gone from the world: gone from the road.
      entities.delete(300);
      entities.delete(301);
      step();
      expect(drawn(roots, 'sanctumSoulfireTrailRiver')).toHaveLength(0);
      expect(drawn(roots, 'sanctumSoulfireTrailWalls')).toHaveLength(0);

      // A wipe stands the fourth outcrop up again.
      outcrops[3].templateId = SANCTUM_ICE_OUTCROP;
      step();
      expect(whole()).toBe(5);
      expect(stumps()).toBe(0);

      // Nothing was minted after the constructor.
      expect(fan).not.toHaveBeenCalled();
      expect(lane).not.toHaveBeenCalled();
      expect(root.children.length + kitRoot.children.length).toBe(children);
      const after = counters();
      expect(after.material - before.material).toBe(1);
      expect(after.texture - before.texture).toBe(1);
      expect(after.geometry - before.geometry).toBe(1);

      fx.hideAll();
      expect(drawn(roots, 'sanctumIceOutcrop')).toHaveLength(0);
      fx.dispose();
    });
  }

  it('every mesh it adds rides the host root (the gated attach), none loose in the scene', () => {
    const { world } = stage();
    const { host, root } = fakeHost(1, false);
    const fx = new TuskerBaitFx(host, world);
    let meshes = 0;
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    // Two meshes an outcrop, two a trail.
    expect(meshes).toBe(BAIT_POOLS.outcrops * 2 + BAIT_POOLS.trails * 2);
    fx.dispose();
  });
});
