import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { StealthFootprintWire } from '../server/stealth_footprint_wire';
import {
  applyStealthFootprintSnapshot,
  decodeStealthFootprints,
  reageStealthFootprints,
} from '../src/net/stealth_footprint_wire';
import { SUN_DIR } from '../src/render/gfx';
import { sceneKeyLightUniform } from '../src/render/scene_sampling';
import {
  FOOTPRINT_CUP_DEPTH,
  FOOTPRINT_CUP_RADIUS,
  FOOTPRINT_FADE_BUCKETS,
  FOOTPRINT_RIM_HEIGHT,
  FOOTPRINT_SIDE_OFFSET,
  footprintCraterHeight,
  footprintCraterNormalInto,
  footprintFadeBucket,
  footprintPlacementInto,
  newFootprintPlacement,
} from '../src/render/stealth_footprint_core';
import {
  FOOTPRINT_RENDER_ORDER,
  StealthFootprintVisual,
} from '../src/render/stealth_footprint_visual';
import { Sim } from '../src/sim/sim';
import {
  FOOTPRINT_LAG,
  FOOTPRINT_LIFETIME,
  FOOTPRINT_MAX,
  FOOTPRINT_READ_RADIUS,
  FOOTPRINT_STRIDE,
  FOOTPRINT_VIEW_CAP,
  type FootprintRoster,
  type FootprintWorld,
  footprintSourceViews,
  recordStealthFootprints,
  stealthFootprintsSeenBy,
  type VisibleFootprint,
  visibleStealthFootprints,
} from '../src/sim/stealth_footprints';
import type { Aura, Entity } from '../src/sim/types';

// Stealth Rework, footprints: a moving stealthed player leaves prints an ENEMY
// can read once they are at least FOOTPRINT_LAG old, within the read radius.

function stealthAura(id = 'stealth'): Aura {
  return {
    id,
    name: 'Duskveil',
    kind: 'stealth',
    remaining: 3600,
    duration: 3600,
    value: 0.5,
    sourceId: 0,
    school: 'physical',
  };
}

// A warrior viewer (the primary player) and an enemy rogue in an active duel.
function duel(): { sim: Sim; viewer: Entity; rogue: Entity } {
  const sim = new Sim({ seed: 21, playerClass: 'warrior', autoEquip: true });
  const rogueId = sim.addPlayer('rogue', 'Sneak');
  const d = {
    a: sim.playerId,
    b: rogueId,
    state: 'active' as const,
    timer: 0,
    controlled: new Map(),
  };
  sim.ctx.duels.set(sim.playerId, d);
  sim.ctx.duels.set(rogueId, d);
  const viewer = sim.player;
  const rogue = sim.entities.get(rogueId)!;
  rogue.pos = { ...viewer.pos };
  return { sim, viewer, rogue };
}

function hide(e: Entity, id = 'stealth'): void {
  e.auras.push(stealthAura(id));
  e.stealthed = true;
}

// Record a straight walk along +z: `steps` moves of `step` yards, one tick apart.
function walk(e: Entity, steps: number, step: number, t0 = 0, dt = 0.05): number {
  let t = t0;
  for (let i = 0; i < steps; i++) {
    e.pos.z += step;
    t += dt;
    recordStealthFootprints(e, t);
  }
  return t;
}

// A hand-built world over a set of players, with a counting hostility check.
function rosterWorld(
  time: number,
  players: Entity[],
  hostile = true,
): FootprintWorld & FootprintRoster & { hostileCalls: number } {
  const entities = new Map(players.map((e) => [e.id, e]));
  const roster = new Map(players.map((e) => [e.id, { entityId: e.id }]));
  const world = {
    time,
    players: roster,
    entities,
    hostileCalls: 0,
    isHostileTo: () => {
      world.hostileCalls++;
      return hostile;
    },
  };
  return world;
}

const seenBy = (world: ReturnType<typeof rosterWorld>, viewer: Entity): VisibleFootprint[] =>
  visibleStealthFootprints(world, viewer, footprintSourceViews(world));

describe('recording', () => {
  it('leaves one print per stride while stealthed, alternating feet, at the feet height', () => {
    const { rogue } = duel();
    hide(rogue);
    rogue.facing = 0;
    recordStealthFootprints(rogue, 0); // anchors the stride, no print yet
    walk(rogue, 30, 0.5); // 15 yd
    const prints = rogue.stealthTrail?.prints ?? [];
    expect(prints.length).toBe(Math.floor(15 / FOOTPRINT_STRIDE));
    expect(prints.map((p) => p.foot).slice(0, 4)).toEqual([0, 1, 0, 1]);
    expect(prints[0].facing).toBe(0);
    expect(prints[0].y).toBe(rogue.pos.y);
  });

  it('leaves nothing standing still, unstealthed, under Vanish, or from a non-finite pose', () => {
    const { rogue } = duel();
    walk(rogue, 20, 0.5); // not stealthed
    expect(rogue.stealthTrail).toBeUndefined();
    hide(rogue);
    for (let i = 0; i < 40; i++) recordStealthFootprints(rogue, i * 0.05); // standing
    expect(rogue.stealthTrail?.prints.length ?? 0).toBe(0);
    rogue.auras = [stealthAura('vanish')];
    walk(rogue, 20, 0.5, 2);
    expect(rogue.stealthTrail?.prints.length ?? 0).toBe(0);
    rogue.auras = [stealthAura()];
    rogue.facing = Number.NaN;
    walk(rogue, 20, 0.5, 4);
    expect(rogue.stealthTrail?.prints.length ?? 0).toBe(0);
  });

  it('keeps a bounded ring and lets prints expire after stealth ends', () => {
    const { rogue } = duel();
    hide(rogue);
    recordStealthFootprints(rogue, 0);
    const end = walk(rogue, 200, 1); // far past the ring capacity
    expect(rogue.stealthTrail?.prints.length).toBe(FOOTPRINT_MAX);
    rogue.auras = [];
    rogue.stealthed = false;
    recordStealthFootprints(rogue, end + 1);
    expect(rogue.stealthTrail?.prints.length).toBeGreaterThan(0); // still readable
    recordStealthFootprints(rogue, end + FOOTPRINT_LIFETIME + 1);
    expect(rogue.stealthTrail).toBeUndefined();
  });
});

describe('what an enemy can read', () => {
  function trail(): { viewer: Entity; rogue: Entity; end: number } {
    const { viewer, rogue } = duel();
    hide(rogue);
    recordStealthFootprints(rogue, 0);
    const end = walk(rogue, 40, 0.5); // 20 yd over 2 sec
    return { viewer, rogue, end };
  }

  it('shows nothing younger than the lag, everything in the window', () => {
    const { viewer, rogue, end } = trail();
    expect(seenBy(rosterWorld(end, [viewer, rogue]), viewer)).toEqual([]);
    const seen = seenBy(rosterWorld(end + FOOTPRINT_LAG, [viewer, rogue]), viewer);
    expect(seen.length).toBe(rogue.stealthTrail?.prints.length);
    for (const p of seen) {
      expect(p.age).toBeGreaterThanOrEqual(FOOTPRINT_LAG);
      expect(p.age).toBeCloseTo(end + FOOTPRINT_LAG - p.bornAt);
    }
    const late = rosterWorld(end + FOOTPRINT_LIFETIME + 1, [viewer, rogue]);
    expect(seenBy(late, viewer)).toEqual([]);
  });

  it('is enemy-only, never the stealther, within the read radius', () => {
    const { viewer, rogue, end } = trail();
    const t = end + FOOTPRINT_LAG;
    expect(seenBy(rosterWorld(t, [viewer, rogue], false), viewer)).toEqual([]);
    expect(seenBy(rosterWorld(t, [viewer, rogue]), rogue)).toEqual([]);
    viewer.pos = { ...viewer.pos, x: viewer.pos.x + FOOTPRINT_READ_RADIUS + 30 };
    expect(seenBy(rosterWorld(t, [viewer, rogue]), viewer)).toEqual([]);
    viewer.dead = true;
    viewer.pos = { ...rogue.pos };
    expect(seenBy(rosterWorld(t, [viewer, rogue]), viewer)).toEqual([]);
  });

  it('caps one viewer at FOOTPRINT_VIEW_CAP prints', () => {
    const { viewer, rogue } = duel();
    // Six stealthers with 13 prints each (20 yd at 1.5 yd a stride): 78 > 64.
    const others = Array.from({ length: 6 }, (_, i) => {
      const e = { ...rogue, id: 9000 + i, pos: { ...rogue.pos }, auras: [] } as Entity;
      hide(e);
      recordStealthFootprints(e, 0);
      walk(e, 50, 0.4); // 20 yd, inside the read radius
      return e;
    });
    expect(seenBy(rosterWorld(5, [viewer, ...others]), viewer).length).toBe(FOOTPRINT_VIEW_CAP);
  });

  it('rejects far trails by their box before any hostility check', () => {
    const { viewer, rogue } = duel();
    // Fifty trails, all far away: none may cost a hostility check.
    const far = Array.from({ length: 50 }, (_, i) => {
      const e = {
        ...rogue,
        id: 9100 + i,
        pos: { ...rogue.pos, x: rogue.pos.x + 200 + i * 10 },
        auras: [],
      } as Entity;
      hide(e);
      recordStealthFootprints(e, 0);
      walk(e, 20, 0.5);
      return e;
    });
    const world = rosterWorld(5, [viewer, ...far]);
    expect(seenBy(world, viewer)).toEqual([]);
    expect(world.hostileCalls).toBe(0);
  });
});

describe('the offline Sim', () => {
  it('answers through IWorld.stealthFootprints, one list per tick', () => {
    const { sim, rogue } = duel();
    expect(sim.stealthFootprints).toEqual([]);
    expect(sim.stealthFootprints).toBe(sim.stealthFootprints); // the shared empty list
    hide(rogue);
    for (let i = 0; i < 20 * 3; i++) {
      rogue.pos.z += 0.15; // a 3 yd/s crawl
      sim.tick();
    }
    const seen = sim.stealthFootprints;
    expect(seen.length).toBeGreaterThan(0);
    for (const p of seen) expect(p.age).toBeGreaterThanOrEqual(FOOTPRINT_LAG);
    // Two reads inside one tick are the same list (the visual's relay skip).
    expect(sim.stealthFootprints).toBe(seen);
    // The memo is the projection itself.
    const fresh = visibleStealthFootprints(sim.ctx, sim.player, footprintSourceViews(sim.ctx));
    expect(seen).toEqual(fresh);
    expect(stealthFootprintsSeenBy(sim.ctx, sim.playerId)).toBe(seen);
  }, 60_000); // three seconds of full-world ticks
});

describe('the wire', () => {
  it('ships a changed set once, nothing while it is unchanged, and [] to clear', () => {
    const { sim, viewer, rogue } = duel();
    const wire = new StealthFootprintWire(sim);
    const lastSent: Record<string, string> = {};
    expect(wire.beginBroadcast().suffixFor(viewer, lastSent)).toBe('');
    hide(rogue);
    for (let i = 0; i < 20 * 3; i++) {
      rogue.pos.z += 0.15;
      sim.tick();
    }
    const suffix = wire.beginBroadcast().suffixFor(viewer, lastSent);
    expect(suffix.startsWith(',"sfp":[')).toBe(true);
    const decoded = decodeStealthFootprints(JSON.parse(`{${suffix.slice(1)}}`).sfp, sim.time);
    expect(decoded.length).toBe(sim.stealthFootprints.length);
    // Same set on the next pass: nothing is sent.
    expect(wire.beginBroadcast().suffixFor(viewer, lastSent)).toBe('');
    // The stealther never reads their own prints.
    expect(wire.suffixFor(rogue, {})).toBe('');
    // The trail expires: one explicit clear, then silence.
    rogue.stealthTrail = undefined;
    expect(wire.beginBroadcast().suffixFor(viewer, lastSent)).toBe(',"sfp":[]');
    expect(wire.beginBroadcast().suffixFor(viewer, lastSent)).toBe('');
  }, 60_000); // three seconds of full-world ticks

  it('drops malformed rows; an absent key re-ages the held list, [] clears it', () => {
    expect(decodeStealthFootprints(undefined, 10)).toEqual([]);
    const rows = [
      [1, 0, 2, 0, 7, 0],
      [1, 0, 2, 0, 7],
      ['x', 0, 2, 0, 7, 1],
      [1, 0, 2, 0, 11, 0], // born in the future
      [1, 0, 2, 0, 7, 2],
    ];
    expect(decodeStealthFootprints(rows, 10)).toEqual([
      { x: 1, y: 0, z: 2, facing: 0, bornAt: 7, age: 3, foot: 0 },
    ]);
    const world = { stealthFootprints: decodeStealthFootprints(rows, 10) };
    applyStealthFootprintSnapshot(world, { time: 12 });
    expect(world.stealthFootprints[0].age).toBe(5);
    applyStealthFootprintSnapshot(world, { time: 7 + FOOTPRINT_LIFETIME + 1 });
    expect(world.stealthFootprints).toEqual([]);
    world.stealthFootprints = decodeStealthFootprints(rows, 10);
    applyStealthFootprintSnapshot(world, { time: 10, sfp: [] });
    expect(world.stealthFootprints).toEqual([]);
    expect(reageStealthFootprints([], 5)).toEqual([]);
  });
});

describe('render placement', () => {
  it('fades newest to oldest across the readable window', () => {
    expect(footprintFadeBucket(FOOTPRINT_LAG)).toBe(0);
    expect(footprintFadeBucket(FOOTPRINT_LIFETIME)).toBe(FOOTPRINT_FADE_BUCKETS - 1);
    const mid = (FOOTPRINT_LAG + FOOTPRINT_LIFETIME) / 2;
    expect(footprintFadeBucket(mid)).toBe(FOOTPRINT_FADE_BUCKETS / 2);
  });

  it('puts the right foot to the right of the path, the left to the left', () => {
    const out = newFootprintPlacement();
    const print = { x: 0, y: 0, z: 0, facing: 0, bornAt: 0, age: 3, foot: 1 as const };
    // Facing +z (f = 0): right is (-cos 0, sin 0) = -x.
    footprintPlacementInto(out, print);
    expect(out.x).toBeCloseTo(-FOOTPRINT_SIDE_OFFSET);
    expect(out.z).toBeCloseTo(0);
    footprintPlacementInto(out, { ...print, foot: 0 });
    expect(out.x).toBeCloseTo(FOOTPRINT_SIDE_OFFSET);
    expect(out.yaw).toBe(0);
  });
});

describe('the visual', () => {
  const print = (age: number, y = 3): VisibleFootprint => ({
    x: 0,
    y,
    z: 0,
    facing: 0,
    bornAt: 0,
    age,
    foot: 0,
  });

  it('is a dent, not a stain: a cup down to the cup radius, a lip, then flat', () => {
    expect(footprintCraterHeight(0)).toBeCloseTo(-FOOTPRINT_CUP_DEPTH);
    expect(footprintCraterHeight(FOOTPRINT_CUP_RADIUS)).toBeCloseTo(0);
    const lipPeak = (FOOTPRINT_CUP_RADIUS + 1) / 2;
    expect(footprintCraterHeight(lipPeak)).toBeCloseTo(FOOTPRINT_RIM_HEIGHT);
    expect(footprintCraterHeight(1)).toBe(0);
    const n = { x: 0, y: 0, z: 0 };
    // Flat at the centre and outside the print.
    expect(footprintCraterNormalInto(n, 0, 0)).toEqual({ x: 0, y: 1, z: 0 });
    expect(footprintCraterNormalInto(n, 1.2, 0)).toEqual({ x: 0, y: 1, z: 0 });
    // A cup wall faces the centre; the lip's outer side faces away from it.
    footprintCraterNormalInto(n, 0.5, 0);
    expect(n.x).toBeLessThan(0);
    footprintCraterNormalInto(n, 0, -0.5);
    expect(n.z).toBeGreaterThan(0);
    footprintCraterNormalInto(n, 0.95, 0);
    expect(n.x).toBeGreaterThan(0);
    // Every normal is a unit vector pointing up.
    for (const [u, v] of [
      [0.3, 0.2],
      [0.7, -0.1],
      [-0.6, 0.6],
      [0.1, 0.9],
    ]) {
      footprintCraterNormalInto(n, u, v);
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1);
      expect(n.y).toBeGreaterThan(0.5);
    }
  });

  it('shades from the scene key light that moves with the day, and has no colour of its own', () => {
    const scene = new THREE.Scene();
    const visual = new StealthFootprintVisual(scene, () => 0);
    const mesh = visual.group.children[0] as THREE.InstancedMesh;
    const material = mesh.material as THREE.ShaderMaterial;
    // The very uniform object the renderer rewrites each frame (sun, then moon).
    expect(material.uniforms.uSunDir).toBe(sceneKeyLightUniform(scene));
    for (const m of visual.group.children as THREE.InstancedMesh[]) {
      expect((m.material as THREE.ShaderMaterial).uniforms.uSunDir).toBe(
        sceneKeyLightUniform(scene),
      );
    }
    // A root that is not a scene (no renderer) falls back to the fixed sun.
    const bare = new StealthFootprintVisual(new THREE.Group(), () => 0);
    const bareMat = (bare.group.children[0] as THREE.InstancedMesh)
      .material as THREE.ShaderMaterial;
    expect(bareMat.uniforms.uSunDir.value.equals(SUN_DIR)).toBe(true);
    // The baked normals tilt inside the print (a dent), flat at its centre.
    const normals = mesh.geometry.getAttribute('normal');
    expect(normals.getY(0)).toBe(1);
    let tilted = 0;
    for (let i = 0; i < normals.count; i++) if (normals.getY(i) < 0.999) tilted++;
    expect(tilted).toBeGreaterThan(normals.count / 2);
    // No colour of its own: it multiplies the ground already drawn,
    // ground * (src.rgb + src.a), so a print wears the ground's palette.
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.blendEquation).toBe(THREE.AddEquation);
    expect(material.blendSrc).toBe(THREE.DstColorFactor);
    expect(material.blendDst).toBe(THREE.SrcAlphaFactor);
    expect(material.blendSrcAlpha).toBe(THREE.ZeroFactor);
    expect(material.blendDstAlpha).toBe(THREE.OneFactor);
    // Flat dent (factor 1) leaves the ground exactly as it was.
    expect(material.fragmentShader).toContain('gl_FragColor = vec4(vec3(f * 0.5), f * 0.5)');
  });

  it('attaches hidden through the compile gate and reveals when it settles', async () => {
    const scene = new THREE.Scene();
    let settle: () => void = () => {};
    const gate = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    const visual = new StealthFootprintVisual(scene, () => 0, gate);
    expect(gate).toHaveBeenCalledWith(visual.group);
    expect(visual.group.parent).toBe(scene);
    expect(visual.group.visible).toBe(false);
    settle();
    await visual.readyForEntry;
    expect(visual.group.visible).toBe(true);
  });

  it('lays prints into fade buckets, skips an unchanged list, and stays program-stable', () => {
    const visual = new StealthFootprintVisual(new THREE.Scene(), () => 0);
    const meshes = visual.group.children as THREE.InstancedMesh[];
    expect(meshes.length).toBe(FOOTPRINT_FADE_BUCKETS);
    for (const [i, mesh] of meshes.entries()) {
      expect(mesh.renderOrder).toBe(FOOTPRINT_RENDER_ORDER);
      expect((mesh.material as THREE.Material).name).toBe(`stealth-footprints:fade-${i}`);
    }
    const list = [print(FOOTPRINT_LAG), print(FOOTPRINT_LAG + 0.1), print(FOOTPRINT_LIFETIME)];
    visual.update(list);
    expect(meshes[0].count).toBe(2);
    expect(meshes[FOOTPRINT_FADE_BUCKETS - 1].count).toBe(1);
    // On a bridge (y above the ground) the print sits on the bridge.
    const m = new THREE.Matrix4();
    meshes[0].getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).y).toBeCloseTo(3.05);
    const version = meshes[0].instanceMatrix.version;
    visual.update(list); // same reference: nothing touched
    expect(meshes[0].instanceMatrix.version).toBe(version);
    // No per-instance colour: that would change the program key after the gate.
    for (const mesh of meshes) expect(mesh.instanceColor).toBeNull();
    visual.update([]);
    expect(meshes.every((mesh) => mesh.count === 0)).toBe(true);
  });

  it('stays within the view cap and disposes once', () => {
    const scene = new THREE.Scene();
    const visual = new StealthFootprintVisual(scene, () => 0);
    visual.update(Array.from({ length: FOOTPRINT_VIEW_CAP * 2 }, () => print(FOOTPRINT_LAG)));
    const meshes = visual.group.children as THREE.InstancedMesh[];
    expect(meshes[0].count).toBe(FOOTPRINT_VIEW_CAP);
    visual.dispose();
    visual.dispose();
    expect(visual.group.parent).toBeNull();
    visual.update([print(FOOTPRINT_LAG)]); // a late update after dispose does nothing
  });
});
