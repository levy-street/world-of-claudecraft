// Thatchbound's painter (src/render/thatchbound_fx.ts) headless: with the pool full (four
// held puppets and four cast marks on other victims at once) every sigil draws, nothing
// writes past the pool, and the layer owns no string or bar mesh (owner note 2026-10-18:
// nothing hangs above a cursed player).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { THATCHBOUND_SIGIL_CAP, ThatchboundFx } from '../src/render/thatchbound_fx';
import {
  CAST_MARK_CAP,
  CROW_PUPPET_AURA,
  PUPPET_CAP,
  STRAWLING_PUPPET_AURA,
} from '../src/render/thatchbound_fx_core';
import { THATCHGRIN_KIT } from '../src/sim/content/gourdlight_eve_scarecrow';

interface FakeEntity {
  pos: { x: number; y: number; z: number };
  facing: number;
  dead: boolean;
  auras?: { id: string }[];
  castingAbility?: string | null;
}

function drawn(mesh: THREE.InstancedMesh): number {
  const m = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    scale.setFromMatrixScale(m);
    if (scale.x > 1e-3) n++;
  }
  return n;
}

describe('ThatchboundFx', () => {
  it('draws a sigil under every puppet and every cast mark at once, and no strings', () => {
    expect(THATCHBOUND_SIGIL_CAP).toBe(PUPPET_CAP + CAST_MARK_CAP);
    const scene = new THREE.Scene();
    const entities = new Map<number, FakeEntity>();
    // the boss
    entities.set(1, {
      pos: { x: 0, y: 0, z: 0 },
      facing: 0,
      dead: false,
      castingAbility: THATCHGRIN_KIT.puppet.name,
    });
    for (let i = 0; i < PUPPET_CAP; i++) {
      entities.set(10 + i, {
        pos: { x: 4 + i * 3, y: 0, z: 2 },
        facing: 0,
        dead: false,
        auras: [{ id: i % 2 === 0 ? STRAWLING_PUPPET_AURA : CROW_PUPPET_AURA }],
      });
    }
    for (let i = 0; i < CAST_MARK_CAP; i++) {
      entities.set(20 + i, { pos: { x: -4 - i * 3, y: 0, z: -2 }, facing: 0, dead: false });
    }
    let bursts = 0;
    const fx = new ThatchboundFx(
      scene,
      {
        burst: () => {
          bursts++;
        },
        groundPuff: () => {},
      },
      () => entities,
      (id) => entities.get(id),
    );
    for (let i = 0; i < CAST_MARK_CAP; i++)
      fx.handleMark({ sourceId: 1, targetId: 20 + i, duration: 2.5 });
    // half the cast in: the marks have grown, the puppets are held
    for (let f = 0; f < 25; f++) fx.update(0.05, false, true);
    const root = scene.getObjectByName('thatchbound-fx');
    expect(root).toBeDefined();
    const sigils = scene.getObjectByName('thatchbound-sigils') as THREE.InstancedMesh;
    expect(sigils.count).toBe(THATCHBOUND_SIGIL_CAP);
    expect(drawn(sigils)).toBe(PUPPET_CAP + CAST_MARK_CAP);
    // the swirl and the landing bursts ran through the pooled particles
    expect(bursts).toBeGreaterThan(PUPPET_CAP * 4);
    // nothing above the head: the layer holds only the sigils, the shockwaves and the eyes
    const meshes: string[] = [];
    root?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o.name);
    });
    expect(meshes.sort()).toEqual(['thatchbound-shocks', 'thatchbound-sigils']);
    expect(scene.getObjectByName('thatchbound-strings')).toBeUndefined();
    // a fifth mark never writes past the pool
    fx.handleMark({ sourceId: 1, targetId: 10, duration: 2.5 });
    expect(() => fx.update(0.05, false, true)).not.toThrow();
    expect(drawn(sigils)).toBeLessThanOrEqual(THATCHBOUND_SIGIL_CAP);
    fx.dispose();
    expect(scene.getObjectByName('thatchbound-fx')).toBeUndefined();
  });
});
