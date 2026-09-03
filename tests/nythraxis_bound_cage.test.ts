import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NYTHRAXIS_CAGE_BASE_RADIUS,
  NYTHRAXIS_CAGE_MIN_RADIUS,
  NYTHRAXIS_CAGE_RISE_SECONDS,
  NYTHRAXIS_CAGE_SINK_SECONDS,
  type NythraxisCageBossLike,
  nythraxisBoundStunOf,
  nythraxisCageLift,
  nythraxisCageRadiusFor,
  nythraxisCageScaleFor,
  nythraxisCageSunk,
} from '../src/render/nythraxis_bound_cage_core';
import {
  buildNythraxisBoundCage,
  buildNythraxisBoundCagePrewarmVisual,
  NYTHRAXIS_CAGE_FALLBACK_NAME,
  NYTHRAXIS_CAGE_VISUAL_NAME,
  NythraxisBoundCageVisuals,
} from '../src/render/nythraxis_bound_cage_visual';
import {
  nythraxisFireAssetInternalsForTest,
  nythraxisPropAsset,
} from '../src/render/nythraxis_fire_assets';
import { buildNythraxisGravePrewarmVisual } from '../src/render/nythraxis_grave_flame_visual';
import { NYTHRAXIS_BOUND_STUN_AURA_ID } from '../src/sim/nythraxis_binding_sigil';
import { NYTHRAXIS_BOSS_ID } from '../src/sim/types';

const FLOOR = 1.5;

function boss(overrides: Partial<NythraxisCageBossLike> = {}): NythraxisCageBossLike {
  return {
    id: 7,
    templateId: NYTHRAXIS_BOSS_ID,
    dead: false,
    scale: 3.1,
    pos: { x: 10, y: FLOOR, z: -20 },
    auras: [],
    ...overrides,
  };
}

function bound(remaining = 10, duration = 10): NythraxisCageBossLike['auras'] {
  return [
    { id: 'something_else', remaining: 3, duration: 5 },
    { id: NYTHRAXIS_BOUND_STUN_AURA_ID, remaining, duration },
  ];
}

function world(...entities: NythraxisCageBossLike[]): {
  entities: Map<number, NythraxisCageBossLike>;
} {
  return { entities: new Map(entities.map((entity) => [entity.id, entity])) };
}

afterEach(() => {
  nythraxisFireAssetInternalsForTest.reset();
});

describe('nythraxis bound cage core', () => {
  it('finds the Bound stun and nothing else, never on a corpse', () => {
    expect(nythraxisBoundStunOf(boss())).toBeNull();
    expect(nythraxisBoundStunOf(boss({ auras: bound(4, 10) }))?.remaining).toBe(4);
    expect(nythraxisBoundStunOf(boss({ auras: bound(), dead: true }))).toBeNull();
  });

  it('rises from the floor over the rise time and sinks over the sink time', () => {
    expect(nythraxisCageLift(0, null)).toBe(0);
    expect(nythraxisCageLift(NYTHRAXIS_CAGE_RISE_SECONDS / 2, null)).toBeGreaterThan(0.5);
    expect(nythraxisCageLift(NYTHRAXIS_CAGE_RISE_SECONDS, null)).toBe(1);
    expect(nythraxisCageLift(60, null)).toBe(1);
    let last = 0;
    for (let t = 0; t <= NYTHRAXIS_CAGE_RISE_SECONDS; t += 0.01) {
      const lift = nythraxisCageLift(t, null);
      expect(lift).toBeGreaterThanOrEqual(last);
      last = lift;
    }
    expect(nythraxisCageLift(60, 0)).toBe(1);
    expect(nythraxisCageLift(60, NYTHRAXIS_CAGE_SINK_SECONDS / 2)).toBeLessThan(0.5);
    expect(nythraxisCageLift(60, NYTHRAXIS_CAGE_SINK_SECONDS)).toBe(0);
    expect(nythraxisCageSunk(NYTHRAXIS_CAGE_SINK_SECONDS - 0.01)).toBe(false);
    expect(nythraxisCageSunk(NYTHRAXIS_CAGE_SINK_SECONDS)).toBe(true);
  });

  it('sizes the ring from the boss scale with a floor, and scales the model to fit', () => {
    expect(nythraxisCageRadiusFor({})).toBe(NYTHRAXIS_CAGE_MIN_RADIUS);
    expect(nythraxisCageRadiusFor({ scale: 0.5 })).toBe(NYTHRAXIS_CAGE_MIN_RADIUS);
    const big = 10;
    expect(nythraxisCageRadiusFor({ scale: big })).toBeCloseTo(NYTHRAXIS_CAGE_BASE_RADIUS * big, 6);
    expect(nythraxisCageScaleFor(5, 2)).toBe(5);
    expect(nythraxisCageScaleFor(5, 0)).toBe(1);
  });
});

describe('nythraxis bound cage visual', () => {
  it('builds the procedural ring of bars until the model has loaded', () => {
    const built = buildNythraxisBoundCage({ scale: 3.1 });
    expect(built.usesAsset).toBe(false);
    expect(built.group.name).toBe(NYTHRAXIS_CAGE_VISUAL_NAME);
    expect(built.group.getObjectByName(NYTHRAXIS_CAGE_FALLBACK_NAME)).toBeDefined();
    expect(built.height).toBeGreaterThan(0);
    expect(built.group.userData.cageRadius).toBe(nythraxisCageRadiusFor({ scale: 3.1 }));
  });

  it('builds the model, scaled to the wanted radius, once it is prepared', () => {
    const source = new THREE.Group();
    const bars = new THREE.Mesh(
      new THREE.BoxGeometry(2, 3, 2),
      new THREE.MeshStandardMaterial({ color: 0xd9cfb4 }),
    );
    source.add(bars);
    source.updateMatrixWorld(true);
    nythraxisFireAssetInternalsForTest.installSource('cage', source);
    const asset = nythraxisPropAsset('cage');
    if (!asset) throw new Error('cage should be prepared');
    const built = buildNythraxisBoundCage({ scale: 3.1 });
    expect(built.usesAsset).toBe(true);
    const wanted = nythraxisCageRadiusFor({ scale: 3.1 });
    const scale = nythraxisCageScaleFor(wanted, Math.max(asset.width, asset.depth));
    const mesh = built.group.children[0] as THREE.Mesh;
    expect(mesh.isMesh).toBe(true);
    expect(mesh.scale.x).toBeCloseTo(scale, 6);
    expect(mesh.material).not.toBe(asset.parts[0].material);
    expect(built.height).toBeCloseTo(asset.height * scale, 6);
    // The scaled cage's outer diameter matches the wanted ring.
    expect((asset.width * scale) / 2).toBeCloseTo(wanted, 6);
  });

  it('raises a cage around a Bound boss, sinks it when the stun ends, and drops it when sunk', () => {
    const scene = new THREE.Scene();
    const painter = new NythraxisBoundCageVisuals(scene, () => FLOOR);
    const stunned = boss({ auras: bound(10, 10) });
    painter.syncWorld(world(stunned));
    expect(painter.count).toBe(1);
    const cage = scene.getObjectByName(NYTHRAXIS_CAGE_VISUAL_NAME) as THREE.Group;
    expect(cage.position.x).toBe(stunned.pos.x);
    expect(cage.position.z).toBe(stunned.pos.z);
    expect(cage.position.y).toBeLessThan(FLOOR);

    painter.update(NYTHRAXIS_CAGE_RISE_SECONDS / 2);
    const midway = cage.position.y;
    expect(midway).toBeGreaterThan(FLOOR - 10);
    expect(midway).toBeLessThan(FLOOR);
    painter.update(NYTHRAXIS_CAGE_RISE_SECONDS);
    expect(cage.position.y).toBeCloseTo(FLOOR, 6);
    painter.update(5);
    expect(cage.position.y).toBeCloseTo(FLOOR, 6);

    // Same boss, same cage, whatever the stun says about elapsed time.
    painter.syncWorld(world(boss({ auras: bound(2, 10) })));
    expect(painter.count).toBe(1);
    expect(scene.getObjectByName(NYTHRAXIS_CAGE_VISUAL_NAME)).toBe(cage);

    // Stun gone: the cage sinks over the sink time, then disposes itself.
    painter.syncWorld(world(boss()));
    expect(painter.count).toBe(1);
    painter.update(NYTHRAXIS_CAGE_SINK_SECONDS / 2);
    expect(cage.position.y).toBeLessThan(FLOOR);
    expect(cage.parent).toBe(scene);
    painter.update(NYTHRAXIS_CAGE_SINK_SECONDS);
    expect(painter.count).toBe(0);
    expect(cage.parent).toBeNull();
    expect(scene.getObjectByName(NYTHRAXIS_CAGE_VISUAL_NAME)).toBeUndefined();
  });

  it('starts a cage part-way up when the stun is already running (late join)', () => {
    const scene = new THREE.Scene();
    const painter = new NythraxisBoundCageVisuals(scene, () => FLOOR);
    painter.syncWorld(world(boss({ auras: bound(4, 10) })));
    painter.update(0);
    const cage = scene.getObjectByName(NYTHRAXIS_CAGE_VISUAL_NAME) as THREE.Group;
    expect(cage.position.y).toBeCloseTo(FLOOR, 6);
  });

  it('re-raises a sinking cage when a fresh Bound lands', () => {
    const scene = new THREE.Scene();
    const painter = new NythraxisBoundCageVisuals(scene, () => FLOOR);
    painter.syncWorld(world(boss({ auras: bound(10, 10) })));
    painter.update(5);
    painter.syncWorld(world(boss()));
    painter.update(NYTHRAXIS_CAGE_SINK_SECONDS / 2);
    const cage = scene.getObjectByName(NYTHRAXIS_CAGE_VISUAL_NAME) as THREE.Group;
    const sunkTo = cage.position.y;
    painter.syncWorld(world(boss({ auras: bound(10, 10) })));
    painter.update(NYTHRAXIS_CAGE_RISE_SECONDS);
    expect(painter.count).toBe(1);
    expect(cage.position.y).toBeGreaterThan(sunkTo);
    expect(cage.position.y).toBeCloseTo(FLOOR, 6);
  });

  it('ignores stunned non-bosses and drops the cage at once when the boss leaves the roster', () => {
    const scene = new THREE.Scene();
    const painter = new NythraxisBoundCageVisuals(scene, () => FLOOR);
    painter.syncWorld(world(boss({ id: 3, templateId: 'nythraxis_bone_spike', auras: bound() })));
    expect(painter.count).toBe(0);

    painter.syncWorld(world(boss({ auras: bound() })));
    expect(painter.count).toBe(1);
    painter.syncWorld(world());
    expect(painter.count).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it('dispose drops every cage and its resources', () => {
    const scene = new THREE.Scene();
    const painter = new NythraxisBoundCageVisuals(scene, () => FLOOR);
    painter.syncWorld(world(boss({ auras: bound() })));
    const cage = scene.getObjectByName(NYTHRAXIS_CAGE_VISUAL_NAME) as THREE.Group;
    let disposed = 0;
    cage.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.Material;
      const original = material.dispose.bind(material);
      material.dispose = () => {
        disposed++;
        original();
      };
    });
    painter.dispose();
    expect(painter.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    expect(disposed).toBeGreaterThan(0);
  });

  it('is staged by the crypt prewarm alongside the other grave programs', () => {
    const standalone = buildNythraxisBoundCagePrewarmVisual();
    expect(standalone.name).toBe(NYTHRAXIS_CAGE_VISUAL_NAME);
    const prewarm = buildNythraxisGravePrewarmVisual();
    expect(prewarm.getObjectByName(NYTHRAXIS_CAGE_VISUAL_NAME)).toBeDefined();
  });
});
