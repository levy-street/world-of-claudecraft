// The Sledge Tusker's Trample readability pass in the renderer: the pure plan
// (src/render/gravewyrm_sanctum_fx/tusker_aim_fx_core.ts) and its painter
// (tusker_aim_fx.ts) on a fake SanctumFxHost and a stub world. The lane says
// whether it ends in the ice by colour AND shape (an ice-shard burst or a
// plain arrowhead), every intact outcrop glows on its circle (pulsing through
// an aim, the aimed one hardest) and a burst one goes dark, and the target
// wears a marker that turns from "lead it" to "step aside" at the lock. Every
// read draws on every density and motion setting and nothing is minted after
// the constructor.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TELEGRAPH_THREAT_COLORS, TelegraphKit } from '../src/render/floor_telegraph';
import type { SanctumFxHost } from '../src/render/gravewyrm_sanctum_fx/sanctum_fx_host';
import { TuskerAimFx } from '../src/render/gravewyrm_sanctum_fx/tusker_aim_fx';
import {
  OUTCROP_CIRCLE_RADIUS,
  outcropCircleLook,
  TARGET_MARKER_COLOR,
  TARGET_MARKER_HEIGHT,
  TRAMPLE_AIM_COLORS,
  TRAMPLE_CAP_SIZE,
  targetMarkerBob,
  targetMarkerMode,
  targetMarkerScale,
  trampleAimLook,
  trampleCapAlong,
} from '../src/render/gravewyrm_sanctum_fx/tusker_aim_fx_core';
import { TuskerBaitFx } from '../src/render/gravewyrm_sanctum_fx/tusker_bait_fx';
import {
  BAIT_RING_RADIUS,
  OUTCROP_FANGS,
} from '../src/render/gravewyrm_sanctum_fx/tusker_bait_fx_core';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  SANCTUM_ICE_OUTCROP,
  SANCTUM_ICE_OUTCROP_BROKEN,
  SANCTUM_ICE_OUTCROP_STRUCK,
  SLEDGE_TUSKER_ID,
  TUSKER_TUNING as T,
  TUSKER_OUTCROPS,
  TUSKER_TRAMPLE,
} from '../src/sim/encounters/gravewyrm_sanctum/ids';
import { planTrampleLane } from '../src/sim/encounters/gravewyrm_sanctum/tusker_road';
import type { IWorld } from '../src/world_api';

const O = instanceOrigin(DUNGEONS.gravewyrm_sanctum.index, 0);

function leg(s: number, side = 0): { x: number; z: number } {
  const d = Math.hypot(42, 21.8);
  return {
    x: -26 + (42 / d) * s + (21.8 / d) * side,
    z: -137.9 + (21.8 / d) * s - (42 / d) * side,
  };
}

describe('the aim plan (pure)', () => {
  it('a lane into the ice reads ice blue with a shard burst; any other, red with an arrowhead', () => {
    const bait = trampleAimLook(7, T.trampleCast);
    expect(bait.baited).toBe(true);
    expect(bait.color).toBe(TRAMPLE_AIM_COLORS.bait);
    expect(bait.cap).toBe('shard');
    const miss = trampleAimLook(null, T.trampleCast);
    expect(miss.baited).toBe(false);
    expect(miss.color).toBe(TRAMPLE_AIM_COLORS.miss);
    expect(miss.color).toBe(TELEGRAPH_THREAT_COLORS.lethal);
    expect(miss.cap).toBe('arrow');
    // Never colour alone: the two answers differ in shape too.
    expect(bait.cap).not.toBe(miss.cap);
    expect(bait.color).not.toBe(miss.color);
  });

  it('the look locks with the sim: following before the lock, locked for its last seconds', () => {
    expect(trampleAimLook(null, T.trampleCast).locked).toBe(false);
    expect(trampleAimLook(null, T.trampleLock + 0.05).locked).toBe(false);
    expect(trampleAimLook(null, T.trampleLock).locked).toBe(true);
    expect(trampleAimLook(3, 0.1).locked).toBe(true);
  });

  it('the cap stands on the outcrop face for a bait, at the strike end for a plain lane', () => {
    const plan = planTrampleLane(leg(8).x, leg(8).z, 0, []);
    expect(trampleCapAlong(plan)).toBeCloseTo(plan.reach - TRAMPLE_CAP_SIZE / 2, 9);
    const bait = { length: 12, reach: 20, outcropId: 4 };
    expect(trampleCapAlong(bait)).toBeCloseTo(12 + T.tuskReach, 9);
  });

  it('an intact circle glows all fight, pulses through an aim, hardest on the aimed one', () => {
    let idleMax = 0;
    let idleMin = 9;
    let aimingMin = 9;
    let aimingMax = 0;
    let aimedMin = 9;
    for (let t = 0; t < 4; t += 0.01) {
      const idle = outcropCircleLook('whole', false, false, t).glow;
      const aiming = outcropCircleLook('whole', true, false, t).glow;
      const aimed = outcropCircleLook('whole', true, true, t).glow;
      idleMax = Math.max(idleMax, idle);
      idleMin = Math.min(idleMin, idle);
      aimingMin = Math.min(aimingMin, aiming);
      aimingMax = Math.max(aimingMax, aiming);
      aimedMin = Math.min(aimedMin, aimed);
      expect(outcropCircleLook('whole', false, false, t).spent).toBe(0);
    }
    expect(idleMin).toBeGreaterThan(0.4);
    // Lit through an aim: brighter than idle at every instant, and pulsing.
    expect(aimingMin).toBeGreaterThan(idleMax);
    expect(aimingMax - aimingMin).toBeGreaterThan(0.3);
    // The aimed one: brighter than any other at every instant.
    expect(aimedMin).toBeGreaterThan(aimingMax - 0.1);
    expect(aimedMin).toBeGreaterThan(idleMax);
  });

  it('a burst outcrop goes dark and broken; a struck one burns white-blue while it holds', () => {
    for (const aiming of [false, true]) {
      const spent = outcropCircleLook('broken', aiming, false, 1.3);
      expect(spent.glow).toBe(0);
      expect(spent.spent).toBe(1);
    }
    const held = outcropCircleLook('struck', false, false, 0.5);
    expect(held.spent).toBe(0);
    expect(held.glow).toBeGreaterThan(1);
    expect(held.color).not.toBe(outcropCircleLook('whole', false, false, 0.5).color);
  });

  it('the circle sits outside the fangs and inside the aimed ring', () => {
    let foot = 0;
    for (const f of OUTCROP_FANGS) foot = Math.max(foot, Math.hypot(f.x, f.z) + f.r);
    expect(OUTCROP_CIRCLE_RADIUS * 0.85).toBeGreaterThan(foot);
    expect(OUTCROP_CIRCLE_RADIUS).toBeLessThan(BAIT_RING_RADIUS);
  });

  it('the target marker wears its own gold, far from both lane answers and the ice', () => {
    const rgb = (hex: number): [number, number, number] => [
      (hex >> 16) & 255,
      (hex >> 8) & 255,
      hex & 255,
    ];
    const distance = (a: number, b: number): number => {
      const [ar, ag, ab] = rgb(a);
      const [br, bg, bb] = rgb(b);
      return Math.hypot(ar - br, ag - bg, ab - bb);
    };
    // Far (in 0..255 RGB) from the bait lane, the miss lane, a live circle and
    // the white-blue of a held one: it never reads as part of the lane.
    for (const other of [
      TRAMPLE_AIM_COLORS.bait,
      TRAMPLE_AIM_COLORS.miss,
      outcropCircleLook('whole', true, true, 0).color,
      outcropCircleLook('struck', false, false, 0).color,
    ])
      expect(distance(TARGET_MARKER_COLOR, other)).toBeGreaterThan(150);
    // Warm: red and green high, blue low (gold, not the ice's blue).
    const [r, g, b] = rgb(TARGET_MARKER_COLOR);
    expect(Math.min(r, g)).toBeGreaterThan(180);
    expect(b).toBeLessThan(110);
  });

  it('the target marker: lead it, then step aside; it stays a readable size from afar', () => {
    expect(targetMarkerMode(T.trampleCast)).toBe(0);
    expect(targetMarkerMode(T.trampleLock)).toBe(1);
    expect(targetMarkerScale(5)).toBe(1);
    expect(targetMarkerScale(52)).toBeCloseTo(2, 9);
    expect(targetMarkerScale(500)).toBe(3);
    expect(targetMarkerBob(1, 0.3)).toBe(0);
    expect(targetMarkerBob(0, 0.3)).toBeGreaterThan(0);
    // Over a player's head (2.6 yd), never in it.
    expect(TARGET_MARKER_HEIGHT).toBeGreaterThan(3.5);
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
  const player = add({
    id: 1,
    kind: 'player',
    templateId: '',
    pos: { x: O.x + behind.x, y: 44, z: O.z + behind.z },
  });
  const tusker = add({
    id: 100,
    kind: 'mob',
    templateId: SLEDGE_TUSKER_ID,
    pos: { x: O.x + mid.x, y: 44, z: O.z + mid.z },
    facing: Math.atan2(behind.x - mid.x, behind.z - mid.z),
    scale: 2.8,
  });
  return { world: { entities, playerId: 1 } as unknown as IWorld, outcrops, tusker, player };
}

function fakeHost(density: number, reduced: boolean): { host: SanctumFxHost; root: THREE.Group } {
  const root = new THREE.Group();
  const kit = new TelegraphKit(new THREE.Group(), density >= 1);
  let seed = 7;
  const host: SanctumFxHost = {
    root,
    kit,
    density,
    uTime: { value: 0 },
    groundY: () => 44,
    puff: () => {},
    shockRing: () => {},
    rand: () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    },
    reducedMotion: () => reduced,
    shake: () => {},
    gesture: () => {},
    shards: { burst: () => {} } as never,
  };
  return { host, root };
}

function shown(root: THREE.Object3D, name: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverseVisible((o) => {
    if (o.name === name) out.push(o as THREE.Mesh);
  });
  return out;
}

function u(m: THREE.Mesh, name: string): unknown {
  return (m.material as THREE.ShaderMaterial).uniforms[name].value;
}

function counters() {
  const id = (x: object) => (x as { id: number }).id;
  return {
    material: id(new THREE.MeshBasicMaterial()),
    texture: id(new THREE.Texture()),
    geometry: id(new THREE.BufferGeometry()),
  };
}

const SETTINGS: [number, boolean][] = [
  [1, false],
  [1, true],
  [0.4, false],
  [0.4, true],
];

describe('the aim painter', () => {
  for (const [density, reduced] of SETTINGS) {
    it(`draws the circles, the lane end and the target marker on every tier (density ${density}, reduced motion ${reduced})`, () => {
      const { world, outcrops, tusker, player } = stage();
      const { host, root } = fakeHost(density, reduced);
      const bait = new TuskerBaitFx(host, world);
      const aim = new TuskerAimFx(host, world);
      const children = root.children.length;
      const before = counters();
      let clock = 0;
      const step = (n = 1) => {
        for (let i = 0; i < n; i++) {
          clock += 1 / 60;
          host.uTime.value = clock;
          bait.beginScan();
          for (const e of world.entities.values()) {
            if (e.kind === 'object') bait.scanObject(e);
            else if (e.templateId === SLEDGE_TUSKER_ID) bait.scanTusker(e);
          }
          bait.endScan();
          bait.update(1 / 60, clock);
          aim.update(clock, bait.currentTusker(), bait.outcropViews());
        }
      };
      const glowOf = (id: number): number => {
        const o = outcrops.find((x) => x.id === id);
        const c = shown(root, 'sanctum-outcrop-circle').find(
          (m) => Math.abs(m.position.x - (o?.pos.x ?? 0)) < 1e-6,
        );
        return c ? (u(c, 'uGlow') as number) : -1;
      };

      // Out of a Trample: five circles, one under each outcrop, all lit.
      step();
      const circles = shown(root, 'sanctum-outcrop-circle');
      expect(circles).toHaveLength(5);
      for (const o of outcrops) {
        const c = circles.find((m) => Math.abs(m.position.x - o.pos.x) < 1e-6);
        expect(c?.position.z).toBeCloseTo(o.pos.z, 6);
        expect(c?.scale.x).toBeCloseTo(OUTCROP_CIRCLE_RADIUS, 9);
        expect(u(c as THREE.Mesh, 'uGlow') as number).toBeGreaterThan(0.4);
        expect(u(c as THREE.Mesh, 'uSpent')).toBe(0);
      }
      const idle = glowOf(outcrops[0].id);
      expect(shown(root, 'sanctum-trample-cap')).toHaveLength(0);
      expect(shown(root, 'sanctum-trample-target-marker')).toHaveLength(0);

      // A Trample at the player behind the fourth outcrop, still aiming: the
      // lane ends in the ice (blue, a shard burst), the circles pulse, the
      // fourth hardest, and a down arrow floats over the player.
      Object.assign(tusker, {
        castingAbility: TUSKER_TRAMPLE,
        castTotal: T.trampleCast,
        castRemaining: T.trampleCast - 0.3,
        castTargetId: player.id,
      });
      step();
      const cap = shown(root, 'sanctum-trample-cap');
      expect(cap).toHaveLength(1);
      expect(u(cap[0], 'uShard')).toBe(1);
      expect((u(cap[0], 'uColor') as THREE.Color).getHex()).toBe(TRAMPLE_AIM_COLORS.bait);
      const aimed = glowOf(outcrops[3].id);
      for (const o of outcrops) if (o !== outcrops[3]) expect(glowOf(o.id)).toBeLessThan(aimed);
      expect(glowOf(outcrops[0].id)).toBeGreaterThan(idle);
      const marker = shown(root, 'sanctum-trample-target-marker');
      expect(marker).toHaveLength(1);
      expect(marker[0].position.x).toBeCloseTo(player.pos.x, 6);
      expect(marker[0].position.y).toBeGreaterThanOrEqual(44 + TARGET_MARKER_HEIGHT);
      expect(u(marker[0], 'uMode')).toBe(0);
      // The marker is its own gold, never the lane's ice blue it would melt into.
      expect((u(marker[0], 'uColor') as THREE.Color).getHex()).toBe(TARGET_MARKER_COLOR);
      const reticle = shown(root, 'sanctum-trample-target-reticle');
      expect((u(reticle[0], 'uColor') as THREE.Color).getHex()).toBe(TARGET_MARKER_COLOR);
      // Drawn over everything, so it reads from across the road.
      expect((marker[0].material as THREE.Material).depthTest).toBe(false);
      expect(shown(root, 'sanctum-trample-target-reticle')).toHaveLength(1);

      // The player walks out to open road and the beast turns with them: the
      // lane misses the ice (red, a plain arrowhead); the marker stays gold.
      tusker.facing += 0.9;
      step();
      expect(u(cap[0], 'uShard')).toBe(0);
      expect((u(cap[0], 'uColor') as THREE.Color).getHex()).toBe(TRAMPLE_AIM_COLORS.miss);
      expect((u(marker[0], 'uColor') as THREE.Color).getHex()).toBe(TARGET_MARKER_COLOR);

      // The lock: the marker says step aside.
      tusker.castRemaining = T.trampleLock - 0.1;
      step();
      expect(u(marker[0], 'uMode')).toBe(1);

      // The charge: the aim marks go.
      tusker.castingAbility = null;
      tusker.castTargetId = null;
      step();
      expect(shown(root, 'sanctum-trample-cap')).toHaveLength(0);
      expect(shown(root, 'sanctum-trample-target-marker')).toHaveLength(0);
      expect(shown(root, 'sanctum-trample-target-reticle')).toHaveLength(0);

      // Struck, then burst: the fourth's circle burns white, then goes dark.
      outcrops[3].templateId = SANCTUM_ICE_OUTCROP_STRUCK;
      step();
      expect(glowOf(outcrops[3].id)).toBeGreaterThan(1);
      outcrops[3].templateId = SANCTUM_ICE_OUTCROP_BROKEN;
      step();
      const dark = shown(root, 'sanctum-outcrop-circle').filter((m) => u(m, 'uSpent') === 1);
      expect(dark).toHaveLength(1);
      expect(dark[0].position.x).toBeCloseTo(outcrops[3].pos.x, 6);
      expect(u(dark[0], 'uGlow')).toBe(0);
      // Four lit, one dark: the baits left are countable.
      expect(
        shown(root, 'sanctum-outcrop-circle').filter((m) => (u(m, 'uGlow') as number) > 0.4),
      ).toHaveLength(4);

      // Nothing minted after the constructor; everything under the host root.
      expect(root.children.length).toBe(children);
      const after = counters();
      expect(after.material - before.material).toBe(1);
      expect(after.texture - before.texture).toBe(1);
      expect(after.geometry - before.geometry).toBe(1);

      aim.hideAll();
      expect(shown(root, 'sanctum-outcrop-circle')).toHaveLength(0);
      aim.dispose();
      bait.dispose();
    });
  }

  it('builds a circle for every outcrop slot, the cap, the marker and the reticle, all on the host root', () => {
    const { world } = stage();
    const { host, root } = fakeHost(1, false);
    const before = root.children.length;
    const aim = new TuskerAimFx(host, world);
    const names = root.children.slice(before).map((o) => o.name);
    expect(names.filter((n) => n === 'sanctum-outcrop-circle')).toHaveLength(6);
    expect(names).toContain('sanctum-trample-cap');
    expect(names).toContain('sanctum-trample-target-marker');
    expect(names).toContain('sanctum-trample-target-reticle');
    aim.dispose();
  });
});
