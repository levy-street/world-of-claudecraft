// @vitest-environment happy-dom
// The raid's world markers on the floor: the pure core (src/render/world_markers_core.ts:
// slot folding, the floor drape, pulse, flare flicker, bob, lift, the screen-size band,
// the tier look) and the pooled Three layer (src/render/world_markers.ts: eight slots
// built up front, a mark shows, moves and hides its own slot, an idle frame does
// nothing, every tier draws the circle and the symbol at the same size and height).

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/icons', () => ({
  raidMarkerSprite: () => document.createElement('canvas'),
}));

import { readFileSync } from 'node:fs';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer_core';
import { prewarmResumeIsDebt } from '../src/render/prewarm_policy';
import { WorldMarkerLayer, worldMarkerPrewarmEntry } from '../src/render/world_markers';
import {
  createWorldMarkerSlots,
  createWorldMarkerSymbolPose,
  syncWorldMarkerSlots,
  WORLD_MARKER_BEAM_HEIGHT,
  WORLD_MARKER_CAMERA_FOV,
  WORLD_MARKER_COLORS,
  WORLD_MARKER_COUNT,
  WORLD_MARKER_DRAPE_REACH,
  WORLD_MARKER_LIFT,
  WORLD_MARKER_OUTER,
  WORLD_MARKER_RADIUS,
  WORLD_MARKER_RINGS,
  WORLD_MARKER_SEGMENTS,
  WORLD_MARKER_SYMBOL_BOB,
  WORLD_MARKER_SYMBOL_GLOW_OPACITY,
  WORLD_MARKER_SYMBOL_GLOW_SCALE,
  WORLD_MARKER_SYMBOL_LIFT,
  WORLD_MARKER_SYMBOL_SCREEN_MAX,
  WORLD_MARKER_SYMBOL_SCREEN_MIN,
  WORLD_MARKER_SYMBOL_SIZE_NEAR,
  WORLD_MARKER_VERTS,
  WorldMarkerChange,
  worldMarkerClock,
  worldMarkerDiscIndex,
  worldMarkerFlare,
  worldMarkerLook,
  worldMarkerPulse,
  worldMarkerSymbolLift,
  worldMarkerSymbolPoseInto,
  worldMarkerSymbolSize,
  writeWorldMarkerDrape,
} from '../src/render/world_markers_core';

const mark = (symbol: number, wx: number, y: number, wz: number) => ({ symbol, wx, y, wz });

describe('world markers core: the eight slots', () => {
  it('has one colour per raid marker, matching the target-marker icon fills', () => {
    expect(WORLD_MARKER_COUNT).toBe(8);
    expect(WORLD_MARKER_COLORS).toEqual([
      0xffe23a, 0xff8a2a, 0xd24bff, 0x37d72c, 0xcfe6ff, 0x23b5ff, 0xff3b30, 0xf4f4f4,
    ]);
  });

  it('shows, moves, keeps and hides a slot per symbol', () => {
    const slots = createWorldMarkerSlots();
    const changes: WorldMarkerChange[] = [];
    expect(syncWorldMarkerSlots(slots, [], changes)).toBe(false);
    expect(syncWorldMarkerSlots(slots, [mark(7, 1, 2, 3)], changes)).toBe(true);
    expect(changes[7]).toBe(WorldMarkerChange.Show);
    expect(slots[7]).toEqual({ shown: true, x: 1, y: 2, z: 3 });
    // An unchanged frame changes nothing.
    expect(syncWorldMarkerSlots(slots, [mark(7, 1, 2, 3)], changes)).toBe(false);
    expect(changes.every((c) => c === WorldMarkerChange.None)).toBe(true);
    // A re-placed symbol moves its slot (height included).
    expect(syncWorldMarkerSlots(slots, [mark(7, 1, 2.5, 3), mark(0, 9, 0, 9)], changes)).toBe(true);
    expect(changes[7]).toBe(WorldMarkerChange.Move);
    expect(changes[0]).toBe(WorldMarkerChange.Show);
    // A cleared symbol hides its slot; the other stays.
    expect(syncWorldMarkerSlots(slots, [mark(0, 9, 0, 9)], changes)).toBe(true);
    expect(changes[7]).toBe(WorldMarkerChange.Hide);
    expect(changes[0]).toBe(WorldMarkerChange.None);
    expect(slots[7].shown).toBe(false);
  });

  it('ignores a symbol outside 0..7 and a non-finite point', () => {
    const slots = createWorldMarkerSlots();
    const changes: WorldMarkerChange[] = [];
    const bad = [
      mark(8, 1, 1, 1),
      mark(-1, 1, 1, 1),
      mark(2.5, 1, 1, 1),
      mark(3, Number.NaN, 0, 0),
    ];
    expect(syncWorldMarkerSlots(slots, bad, changes)).toBe(false);
    expect(slots.some((s) => s.shown)).toBe(false);
  });
});

describe('world markers core: the floor drape', () => {
  it('lays every vertex on the floor under it, lifted, out to the halo edge', () => {
    const out = new Float32Array(WORLD_MARKER_VERTS * 3);
    // A step: the floor is 0.4 higher east of x = 10.5.
    const floor = (x: number) => (x > 10.5 ? 5.4 : 5);
    writeWorldMarkerDrape(out, 10, 5, 20, floor);
    expect(out[0]).toBe(10);
    expect(out[1]).toBeCloseTo(5 + WORLD_MARKER_LIFT, 6);
    expect(out[2]).toBe(20);
    let farthest = 0;
    for (let i = 0; i < WORLD_MARKER_VERTS; i++) {
      const x = out[i * 3];
      const y = out[i * 3 + 1];
      const z = out[i * 3 + 2];
      expect(y).toBeCloseTo(floor(x) + WORLD_MARKER_LIFT, 5);
      farthest = Math.max(farthest, Math.hypot(x - 10, z - 20));
    }
    expect(farthest).toBeCloseTo(WORLD_MARKER_RADIUS * WORLD_MARKER_OUTER, 4);
  });

  it('holds the mark height where a sample leaves its floor (a wall top, a pit, a hole)', () => {
    const out = new Float32Array(WORLD_MARKER_VERTS * 3);
    const floor = (x: number) =>
      x > 10.5 ? 5 + WORLD_MARKER_DRAPE_REACH + 2 : x < 9.5 ? Number.NaN : 5;
    writeWorldMarkerDrape(out, 10, 5, 20, floor);
    for (let i = 0; i < WORLD_MARKER_VERTS; i++)
      expect(out[i * 3 + 1]).toBeCloseTo(5 + WORLD_MARKER_LIFT, 5);
  });

  it('indexes a closed disc: a centre fan plus a strip per ring', () => {
    const index = worldMarkerDiscIndex();
    const S = WORLD_MARKER_SEGMENTS;
    expect(index.length).toBe(S * 3 + (WORLD_MARKER_RINGS - 1) * S * 6);
    expect(Math.max(...index)).toBe(WORLD_MARKER_VERTS - 1);
    expect(Math.min(...index)).toBe(0);
  });
});

describe('world markers core: motion, scale and tiers', () => {
  const samples = (f: (t: number) => number) => Array.from({ length: 400 }, (_, i) => f(i * 0.037));

  it('pulses softly, out of step per symbol, and holds still under reduced motion', () => {
    const values = samples((t) => worldMarkerPulse(t, 2, false));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.82 - 1e-9);
    expect(Math.max(...values)).toBeLessThanOrEqual(1 + 1e-9);
    expect(worldMarkerPulse(0.3, 0, false)).not.toBeCloseTo(worldMarkerPulse(0.3, 4, false), 3);
    expect(worldMarkerPulse(0.3, 0, true)).toBe(1);
  });

  it('flickers the flare between 0.86 and 1, out of step per symbol, steady under reduced motion', () => {
    const values = samples((t) => worldMarkerFlare(t, 5, false));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.86 - 1e-9);
    expect(Math.max(...values)).toBeLessThanOrEqual(1 + 1e-9);
    // It really moves (a flare, not a steady lamp).
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.08);
    expect(worldMarkerFlare(0, 0, false)).toBeCloseTo(0.93, 9);
    expect(worldMarkerFlare(0.4, 0, false)).not.toBeCloseTo(worldMarkerFlare(0.4, 3, false), 3);
    expect(worldMarkerFlare(1.3, 6, true)).toBe(1);
  });

  it('floats the symbol over a tall head, bobbing gently, and holds still under reduced motion', () => {
    expect(WORLD_MARKER_SYMBOL_LIFT).toBe(3.2);
    expect(WORLD_MARKER_SYMBOL_BOB).toBe(0.14);
    expect(worldMarkerSymbolLift(1.7, 3, true)).toBe(WORLD_MARKER_SYMBOL_LIFT);
    const lifts = samples((t) => worldMarkerSymbolLift(t, 3, false));
    expect(Math.min(...lifts)).toBeGreaterThanOrEqual(WORLD_MARKER_SYMBOL_LIFT - 0.14 - 1e-9);
    expect(Math.max(...lifts)).toBeLessThanOrEqual(WORLD_MARKER_SYMBOL_LIFT + 0.14 + 1e-9);
    expect(Math.max(...lifts) - Math.min(...lifts)).toBeGreaterThan(0.2);
    // A symbol grown with distance rises by 0.45 of its extra size; a smaller
    // one (up close) keeps the base lift.
    expect(worldMarkerSymbolLift(0, 0, true, WORLD_MARKER_SYMBOL_SIZE_NEAR + 2)).toBeCloseTo(
      WORLD_MARKER_SYMBOL_LIFT + 0.9,
      9,
    );
    expect(worldMarkerSymbolLift(0, 0, true, 0.6)).toBe(WORLD_MARKER_SYMBOL_LIFT);
    expect(worldMarkerSymbolLift(0, 0, true, Number.NaN)).toBe(WORLD_MARKER_SYMBOL_LIFT);
    // The symbol floats inside the beam, under its top.
    expect(WORLD_MARKER_SYMBOL_LIFT).toBeLessThan(WORLD_MARKER_BEAM_HEIGHT);
  });

  it('holds the symbol inside a screen-size band: never huge up close, never tiny far off', () => {
    expect(WORLD_MARKER_SYMBOL_SIZE_NEAR).toBe(1.75);
    expect(WORLD_MARKER_SYMBOL_SCREEN_MIN).toBe(0.0635);
    expect(WORLD_MARKER_SYMBOL_SCREEN_MAX).toBe(0.15);
    expect(WORLD_MARKER_SYMBOL_GLOW_SCALE).toBe(2.1);
    expect(WORLD_MARKER_CAMERA_FOV).toBe(60);
    // The near size holds at a middling camera distance.
    expect(worldMarkerSymbolSize(15)).toBe(1.75);
    expect(worldMarkerSymbolSize(25)).toBe(1.75);
    // Up close it shrinks with distance (screen cap), far off it grows (screen floor).
    expect(worldMarkerSymbolSize(6)).toBeCloseTo(0.9, 9);
    expect(worldMarkerSymbolSize(80)).toBeCloseTo(5.08, 9);
    expect(worldMarkerSymbolSize(Number.NaN)).toBe(0);
    expect(worldMarkerSymbolSize(0)).toBe(0);
    // The share of the screen's height the symbol fills (the screen's height
    // at d is 2 d tan(fov / 2)) stays between about 5% and 13%, at the default
    // field of view and at both ends of the player's field-of-view slider.
    for (const fov of [55, 60, 100]) {
      const half = Math.tan((fov * Math.PI) / 360);
      const screen = (d: number) => worldMarkerSymbolSize(d, fov) / (2 * d * half);
      for (let d = 0.5; d <= 250; d += 0.75) {
        expect(screen(d)).toBeGreaterThanOrEqual(0.054);
        expect(screen(d)).toBeLessThanOrEqual(0.131);
      }
    }
    // A non-finite field of view reads as the default.
    expect(worldMarkerSymbolSize(80, Number.NaN)).toBe(worldMarkerSymbolSize(80));
    // Bigger than the circle-era symbol (1.2 yards) at a normal camera distance.
    expect(worldMarkerSymbolSize(15)).toBeGreaterThan(1.2 * 1.4);
  });

  it('poses the symbol from the camera: size by distance, lift by size, glow by flicker', () => {
    const pose = createWorldMarkerSymbolPose();
    const slot = { x: 10, y: 2, z: -4 };
    // A camera 40 yards out, level with the symbol's resting point.
    const out = worldMarkerSymbolPoseInto(pose, 50, 2 + 3.2, -4, 60, slot, 0.7, 2, false);
    expect(out).toBe(pose);
    expect(pose.size).toBe(worldMarkerSymbolSize(40));
    expect(pose.y).toBe(2 + worldMarkerSymbolLift(0.7, 2, false, pose.size));
    expect(pose.glowSize).toBe(pose.size * WORLD_MARKER_SYMBOL_GLOW_SCALE);
    expect(WORLD_MARKER_SYMBOL_GLOW_OPACITY).toBe(0.85);
    expect(pose.glowOpacity).toBe(0.85 * worldMarkerFlare(0.7, 2, false));
    // A wider field of view draws it larger in the world (same screen share).
    worldMarkerSymbolPoseInto(pose, 50, 5.2, -4, 100, slot, 0.7, 2, false);
    expect(pose.size).toBeGreaterThan(worldMarkerSymbolSize(40));
    // Reduced motion: no bob, a steady glow.
    worldMarkerSymbolPoseInto(pose, 50, 5.2, -4, 60, slot, 0.7, 2, true);
    expect(pose.glowOpacity).toBe(0.85);
    expect(pose.y).toBe(2 + worldMarkerSymbolLift(0, 0, true, pose.size));
    expect(worldMarkerClock(3.5, false)).toBe(3.5);
    expect(worldMarkerClock(3.5, true)).toBe(0);
  });

  it('a low tier sheds only cosmetic light, never the circle, the beam or the symbol', () => {
    expect(worldMarkerLook(false)).toEqual({ glow: true, runes: true, beam: 1, motes: true });
    expect(worldMarkerLook(true)).toEqual({ glow: false, runes: false, beam: 0.5, motes: false });
  });
});

describe('world markers layer (Three)', () => {
  function layer(lowTier: boolean) {
    const scene = new THREE.Scene();
    const floor = vi.fn((_x: number, _z: number, refY: number) => refY);
    const l = new WorldMarkerLayer(scene, { floor, lowTier, boost: 1 });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 10, 30);
    return { scene, l, floor, camera };
  }
  const named = (scene: THREE.Scene, prefix: string) =>
    scene.getObjectByName('world-markers')?.children.filter((c) => c.name.startsWith(prefix)) ?? [];

  it('builds all eight slots up front, hidden, and adds nothing later', () => {
    const { scene, l, camera } = layer(false);
    expect(named(scene, 'world-marker-disc-')).toHaveLength(8);
    expect(named(scene, 'world-marker-symbol-')).toHaveLength(8);
    expect(named(scene, 'world-marker-pool-')).toHaveLength(8);
    expect(named(scene, 'world-marker-beam-')).toHaveLength(8);
    expect(named(scene, 'world-marker-glow-')).toHaveLength(8);
    expect(named(scene, 'world-marker-').every((c) => !c.visible)).toBe(true);
    const before = scene.getObjectByName('world-markers')?.children.length;
    l.update([mark(7, 1, 2, 3), mark(0, -4, 2, 6)], camera, 0, false);
    expect(scene.getObjectByName('world-markers')?.children.length).toBe(before);
    expect(l.shown).toBe(2);
  });

  it('shows a mark on the floor with its symbol above, re-drapes only on a move, hides on clear', () => {
    const { scene, l, floor, camera } = layer(false);
    l.update([mark(7, 1, 2, 3)], camera, 0, false);
    const disc = scene.getObjectByName('world-marker-disc-7') as THREE.Mesh;
    const sprite = scene.getObjectByName('world-marker-symbol-7') as THREE.Sprite;
    expect(disc.visible).toBe(true);
    expect(sprite.visible).toBe(true);
    // Clearly over a tall head, on its glow, inside its beam.
    expect(sprite.position.y).toBeGreaterThan(2 + 3);
    expect(sprite.position.x).toBe(1);
    const glow = scene.getObjectByName('world-marker-glow-7') as THREE.Sprite;
    expect(glow.visible).toBe(true);
    expect(glow.position.equals(sprite.position)).toBe(true);
    expect(glow.scale.x).toBeCloseTo(sprite.scale.x * WORLD_MARKER_SYMBOL_GLOW_SCALE, 9);
    // Same position, so three breaks the transparent sort tie by id: the glow
    // must be the older object so it paints first, under the symbol.
    expect(glow.id).toBeLessThan(sprite.id);
    const beam = scene.getObjectByName('world-marker-beam-7') as THREE.Mesh;
    expect(beam.visible).toBe(true);
    expect([beam.position.x, beam.position.y, beam.position.z]).toEqual([1, 2, 3]);
    const pool = scene.getObjectByName('world-marker-pool-7') as THREE.Mesh;
    expect(pool.visible).toBe(true);
    // The pool rides the disc's own drape, one ground rung over it.
    expect(pool.geometry).toBe(disc.geometry);
    expect(pool.renderOrder).toBe(disc.renderOrder + 1);
    const drapes = floor.mock.calls.length;
    expect(drapes).toBe(WORLD_MARKER_VERTS);
    l.update([mark(7, 1, 2, 3)], camera, 0.5, false);
    expect(floor.mock.calls.length).toBe(drapes);
    l.update([mark(7, 5, 2, 3)], camera, 1, false);
    expect(floor.mock.calls.length).toBe(drapes * 2);
    l.update([], camera, 1.5, false);
    expect(disc.visible).toBe(false);
    expect(sprite.visible).toBe(false);
    expect(glow.visible).toBe(false);
    expect(beam.visible).toBe(false);
    expect(pool.visible).toBe(false);
    expect(l.shown).toBe(0);
  });

  it('a low tier draws the circle, a dimmer beam and the same symbol, without motes or runes', () => {
    const { scene, l, camera } = layer(true);
    l.update([mark(3, 0, 0, 0)], camera, 0.4, false);
    expect(scene.getObjectByName('world-marker-disc-3')?.visible).toBe(true);
    const beam = scene.getObjectByName('world-marker-beam-3') as THREE.Mesh;
    const pool = scene.getObjectByName('world-marker-pool-3') as THREE.Mesh;
    expect(beam.visible).toBe(true);
    expect(pool.visible).toBe(true);
    const beamMat = beam.material as THREE.ShaderMaterial;
    expect(beamMat.uniforms.uMotes.value).toBe(0);
    expect(beamMat.uniforms.uFlare.value).toBeCloseTo(0.5 * worldMarkerFlare(0.4, 3, false), 12);
    expect((pool.material as THREE.ShaderMaterial).uniforms.uFlare.value).toBeCloseTo(
      0.5 * worldMarkerFlare(0.4, 3, false),
      12,
    );
    const lowSprite = scene.getObjectByName('world-marker-symbol-3') as THREE.Sprite;
    expect(lowSprite.visible).toBe(true);
    expect(scene.getObjectByName('world-marker-glow-3')?.visible).toBe(true);
    const high = layer(false);
    high.l.update([mark(3, 0, 0, 0)], high.camera, 0.4, false);
    const highSprite = high.scene.getObjectByName('world-marker-symbol-3') as THREE.Sprite;
    expect(lowSprite.position.equals(highSprite.position)).toBe(true);
    expect(lowSprite.scale.equals(highSprite.scale)).toBe(true);
    // The symbol's glow is part of its legibility: the same on every tier.
    const lowGlow = (scene.getObjectByName('world-marker-glow-3') as THREE.Sprite).material;
    const highGlow = (high.scene.getObjectByName('world-marker-glow-3') as THREE.Sprite).material;
    expect(lowGlow.opacity).toBe(highGlow.opacity);
    const highBeam = high.scene.getObjectByName('world-marker-beam-3') as THREE.Mesh;
    expect((highBeam.material as THREE.ShaderMaterial).uniforms.uMotes.value).toBe(1);
    const mat = (scene.getObjectByName('world-marker-disc-3') as THREE.Mesh)
      .material as THREE.ShaderMaterial;
    expect(mat.uniforms.uGlow.value).toBe(0);
    expect(mat.uniforms.uRunes.value).toBe(0);
  });

  it('draws the beam under the circle and the symbol over both, on the ground band', () => {
    const { scene } = layer(false);
    const order = (name: string) => (scene.getObjectByName(name) as THREE.Object3D).renderOrder;
    expect(order('world-marker-beam-0')).toBe(floorVfxRenderOrder('ground', 5));
    expect(order('world-marker-disc-0')).toBe(floorVfxRenderOrder('ground', 6));
    expect(order('world-marker-pool-0')).toBe(floorVfxRenderOrder('ground', 7));
    expect(order('world-marker-glow-0')).toBe(floorVfxRenderOrder('ground', 7));
    expect(order('world-marker-symbol-0')).toBe(floorVfxRenderOrder('ground', 7));
    // Everything stays under the player band (and so under every telegraph).
    expect(order('world-marker-symbol-0')).toBeLessThan(floorVfxRenderOrder('player', 0));
  });

  it('keeps the symbol a readable size from far off', () => {
    const { scene, l, camera } = layer(false);
    l.update([mark(1, 0, 0, 0)], camera, 0, false);
    const near = (scene.getObjectByName('world-marker-symbol-1') as THREE.Sprite).scale.x;
    camera.position.set(0, 10, 120);
    l.update([mark(1, 0, 0, 0)], camera, 0.1, false);
    const far = (scene.getObjectByName('world-marker-symbol-1') as THREE.Sprite).scale.x;
    expect(far).toBeGreaterThan(near);
  });

  it('flickers the beacon each frame and lays every light piece additively, without depth writes', () => {
    const { scene, l, camera } = layer(false);
    const beam = scene.getObjectByName('world-marker-beam-4') as THREE.Mesh;
    const pool = scene.getObjectByName('world-marker-pool-4') as THREE.Mesh;
    const glow = scene.getObjectByName('world-marker-glow-4') as THREE.Sprite;
    for (const piece of [beam, pool, glow]) {
      const m = piece.material as THREE.Material;
      expect(m.blending).toBe(THREE.AdditiveBlending);
      expect(m.depthWrite).toBe(false);
    }
    const beamMat = beam.material as THREE.ShaderMaterial;
    const poolMat = pool.material as THREE.ShaderMaterial;
    for (const t of [0.2, 0.55, 1.1]) {
      l.update([mark(4, 0, 0, 0)], camera, t, false);
      expect(beamMat.uniforms.uFlare.value).toBe(worldMarkerFlare(t, 4, false));
      expect(poolMat.uniforms.uFlare.value).toBe(worldMarkerFlare(t, 4, false));
      // Not frozen: the flicker really reaches the GPU each frame.
      expect(beamMat.uniforms.uFlare.value).not.toBe(1);
      expect(beamMat.uniforms.uTime.value).toBe(t);
      expect(glow.material.opacity).toBeCloseTo(0.85 * worldMarkerFlare(t, 4, false), 9);
    }
    // Reduced motion: a steady beacon and a frozen beam.
    l.update([mark(4, 0, 0, 0)], camera, 2.4, true);
    expect(beamMat.uniforms.uFlare.value).toBe(1);
    expect(beamMat.uniforms.uTime.value).toBe(0);
    // The floor pool stays in the ground band, under every player effect and
    // every boss telegraph (the player band starts at 10).
    expect(pool.renderOrder).toBeLessThan(10);
  });

  it('stages every live material and texture for the prewarm, on both tiers', () => {
    for (const lowTier of [false, true]) {
      const { l } = layer(lowTier);
      const live = new Set<THREE.Material>();
      const liveTextures = new Set<THREE.Texture>();
      l.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (!m) return;
        live.add(m);
        const map = (m as THREE.SpriteMaterial).map;
        if (map) liveTextures.add(map);
      });
      const staged = new Set<THREE.Material>();
      l.prewarmRoot().traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) staged.add(m);
      });
      expect(staged).toEqual(live);
      expect(live.size).toBe(40);
      expect(new Set(l.prewarmTextures())).toEqual(liveTextures);
      expect(l.prewarmTextures()).toHaveLength(9);
    }
  });

  it('a disposed layer stages nothing and its prewarm units do nothing', async () => {
    const { l } = layer(false);
    const uploaded: THREE.Texture[] = [];
    const compiled: THREE.Object3D[] = [];
    const entry = worldMarkerPrewarmEntry(l, {
      prewarmTexture: (t) => uploaded.push(t),
      compileColor: async (r) => {
        compiled.push(r);
      },
    });
    const units = entry.resumeUnits();
    l.dispose();
    expect(l.isDisposed).toBe(true);
    expect(l.prewarmTextures()).toEqual([]);
    for (const u of units) u.run();
    await entry.resumeProgramUnits()[0].run();
    await entry.run();
    expect(uploaded).toEqual([]);
    expect(compiled).toEqual([]);
  });

  it('has a prewarm home: a visible staged twin of every piece, and every symbol texture', async () => {
    const { l } = layer(false);
    const root = l.prewarmRoot();
    expect(root.parent).toBeNull();
    // Disc, pool, beam, glow and symbol for each of the eight slots.
    expect(root.children).toHaveLength(40);
    expect(root.children.every((c) => c.visible)).toBe(true);
    const live = new Set<THREE.Material>();
    l.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) live.add(m);
    });
    const staged = new Set(root.children.map((o) => (o as THREE.Mesh).material as THREE.Material));
    expect(staged).toEqual(live);
    // The eight symbols plus the one glow they share.
    expect(l.prewarmTextures()).toHaveLength(9);
    const uploaded: THREE.Texture[] = [];
    const compiled: THREE.Object3D[] = [];
    const entry = worldMarkerPrewarmEntry(l, {
      prewarmTexture: (t) => uploaded.push(t),
      compileColor: async (r) => {
        compiled.push(r);
      },
    });
    expect(entry.id).toBe('vfx.world-markers');
    await entry.run();
    expect(uploaded).toHaveLength(9);
    expect(compiled).toEqual([root]);
    expect(entry.resumeUnits()).toHaveLength(9);
    expect(entry.resumeProgramUnits()).toHaveLength(1);
    // A dropped entry's program links resume as debt, never as cosmetic work.
    expect(prewarmResumeIsDebt(`programs.${entry.id}`)).toBe(true);
    const renderer = readFileSync(`${process.cwd()}/src/render/renderer.ts`, 'utf8');
    expect(renderer).toContain('worldMarkerPrewarmEntry(this.worldMarkers, {');
    expect(renderer).toContain('bestEffort(() => this.worldMarkers.dispose());');
  });
});
