// @vitest-environment happy-dom
// The raid's world markers on the floor: the pure core (src/render/world_markers_core.ts:
// slot folding, the floor drape, pulse, bob, distance scale, the tier look) and the
// pooled Three layer (src/render/world_markers.ts: eight slots built up front, a mark
// shows, moves and hides its own slot, an idle frame does nothing, every tier draws
// the circle and the symbol).

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/icons', () => ({
  raidMarkerSprite: () => document.createElement('canvas'),
}));

import { readFileSync } from 'node:fs';
import { prewarmResumeIsDebt } from '../src/render/prewarm_policy';
import { WorldMarkerLayer, worldMarkerPrewarmEntry } from '../src/render/world_markers';
import {
  createWorldMarkerSlots,
  syncWorldMarkerSlots,
  WORLD_MARKER_COLORS,
  WORLD_MARKER_COUNT,
  WORLD_MARKER_DRAPE_REACH,
  WORLD_MARKER_LIFT,
  WORLD_MARKER_OUTER,
  WORLD_MARKER_RADIUS,
  WORLD_MARKER_RINGS,
  WORLD_MARKER_SEGMENTS,
  WORLD_MARKER_SYMBOL_LIFT,
  WORLD_MARKER_VERTS,
  WorldMarkerChange,
  worldMarkerCss,
  worldMarkerDiscIndex,
  worldMarkerLook,
  worldMarkerPulse,
  worldMarkerSymbolLift,
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
    expect(worldMarkerCss(6, 0.5)).toBe('rgba(255, 59, 48, 0.5)');
    expect(worldMarkerCss(0, 2)).toBe('rgba(255, 226, 58, 1)');
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
  it('pulses softly, out of step per symbol, and holds still under reduced motion', () => {
    const values = Array.from({ length: 40 }, (_, i) => worldMarkerPulse(i * 0.1, 2, false));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.82 - 1e-9);
    expect(Math.max(...values)).toBeLessThanOrEqual(1 + 1e-9);
    expect(worldMarkerPulse(0.3, 0, false)).not.toBeCloseTo(worldMarkerPulse(0.3, 4, false), 3);
    expect(worldMarkerPulse(0.3, 0, true)).toBe(1);
    expect(worldMarkerSymbolLift(1.7, 3, true)).toBe(WORLD_MARKER_SYMBOL_LIFT);
    expect(Math.abs(worldMarkerSymbolLift(1.7, 3, false) - WORLD_MARKER_SYMBOL_LIFT)).toBeLessThan(
      0.1,
    );
  });

  it('grows the symbol with distance so it stays readable, within a clamp', () => {
    expect(worldMarkerSymbolSize(0)).toBeCloseTo(1.2, 6);
    expect(worldMarkerSymbolSize(60)).toBeGreaterThan(worldMarkerSymbolSize(20));
    expect(worldMarkerSymbolSize(10000)).toBe(3.4);
    expect(worldMarkerSymbolSize(Number.NaN)).toBeCloseTo(1.2, 6);
  });

  it('a low tier sheds only the glow, the column and the runes', () => {
    expect(worldMarkerLook(false)).toEqual({ glow: true, runes: true, column: true });
    expect(worldMarkerLook(true)).toEqual({ glow: false, runes: false, column: false });
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
    expect(named(scene, 'world-marker-column-')).toHaveLength(8);
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
    expect(sprite.position.y).toBeGreaterThan(2 + 1.5);
    expect(sprite.position.x).toBe(1);
    const drapes = floor.mock.calls.length;
    expect(drapes).toBe(WORLD_MARKER_VERTS);
    l.update([mark(7, 1, 2, 3)], camera, 0.5, false);
    expect(floor.mock.calls.length).toBe(drapes);
    l.update([mark(7, 5, 2, 3)], camera, 1, false);
    expect(floor.mock.calls.length).toBe(drapes * 2);
    l.update([], camera, 1.5, false);
    expect(disc.visible).toBe(false);
    expect(sprite.visible).toBe(false);
    expect(l.shown).toBe(0);
  });

  it('a low tier still draws the circle and the symbol, without the column', () => {
    const { scene, l, camera } = layer(true);
    expect(named(scene, 'world-marker-column-')).toHaveLength(0);
    l.update([mark(3, 0, 0, 0)], camera, 0, false);
    expect(scene.getObjectByName('world-marker-disc-3')?.visible).toBe(true);
    expect(scene.getObjectByName('world-marker-symbol-3')?.visible).toBe(true);
    const mat = (scene.getObjectByName('world-marker-disc-3') as THREE.Mesh)
      .material as THREE.ShaderMaterial;
    expect(mat.uniforms.uGlow.value).toBe(0);
    expect(mat.uniforms.uRunes.value).toBe(0);
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

  it('has a prewarm home: a visible staged twin of every piece, and every symbol texture', async () => {
    const { l } = layer(false);
    const root = l.prewarmRoot();
    expect(root.parent).toBeNull();
    expect(root.children).toHaveLength(24);
    expect(root.children.every((c) => c.visible)).toBe(true);
    const live = new Set<THREE.Material>();
    l.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) live.add(m);
    });
    const staged = new Set(root.children.map((o) => (o as THREE.Mesh).material as THREE.Material));
    expect(staged).toEqual(live);
    expect(l.prewarmTextures()).toHaveLength(8);
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
    expect(uploaded).toHaveLength(8);
    expect(compiled).toEqual([root]);
    expect(entry.resumeUnits()).toHaveLength(8);
    expect(entry.resumeProgramUnits()).toHaveLength(1);
    // A dropped entry's program links resume as debt, never as cosmetic work.
    expect(prewarmResumeIsDebt(`programs.${entry.id}`)).toBe(true);
    const renderer = readFileSync(`${process.cwd()}/src/render/renderer.ts`, 'utf8');
    expect(renderer).toContain('worldMarkerPrewarmEntry(this.worldMarkers, {');
    expect(renderer).toContain('bestEffort(() => this.worldMarkers.dispose());');
  });
});
