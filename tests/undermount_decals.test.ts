import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { UndermountDecals } from '../src/render/undermount_decals';
import {
  isVolzharrEruptionWindup,
  UNDERMOUNT_DECAL,
  type UndermountDecalKind,
  type UndermountFxLevel,
  undermountDecalColor,
  undermountEntityDecalMask,
} from '../src/render/undermount_decals_core';

describe('Undermount actionable decal contract', () => {
  it('keeps one fixed hue per meaning at every fx tier and under reduced motion', () => {
    const expectedByKind: Record<UndermountDecalKind, number> = {
      ventRing: 0xff4b16,
      ventCore: 0x050100,
      forgeheat: 0xffc928,
      scorched: 0xff6a1a,
      chilled: 0x5d8fb8,
      eruption: 0xff4b16,
    };
    const tiers: UndermountFxLevel[] = ['low', 'medium', 'high', 'ultra'];
    for (const [kind, expected] of Object.entries(expectedByKind) as [
      UndermountDecalKind,
      number,
    ][]) {
      expect(undermountDecalColor(kind)).toBe(expected);
      for (const fxLevel of tiers) {
        expect(undermountDecalColor(kind, { fxLevel, reducedMotion: false })).toBe(expected);
        expect(undermountDecalColor(kind, { fxLevel, reducedMotion: true })).toBe(expected);
      }
    }
    expect(undermountDecalColor('scorched')).not.toBe(undermountDecalColor('chilled'));
  });

  it('derives mark and Forgeheat glyphs only from mirrored aura ids', () => {
    expect(
      undermountEntityDecalMask([{ id: 'odrenn_scorched' }, { id: 'volzharr_forgeheat' }]),
    ).toBe(UNDERMOUNT_DECAL.scorched | UNDERMOUNT_DECAL.forgeheat);
    expect(undermountEntityDecalMask([{ id: 'odrenn_chilled' }])).toBe(UNDERMOUNT_DECAL.chilled);
    expect(undermountEntityDecalMask([{ id: 'unrelated' }])).toBe(0);
  });

  it('keys the Eruption flash only to Volzharr windup events', () => {
    const windup = { type: 'spellfx', fx: 'windup' };
    expect(isVolzharrEruptionWindup(windup, 'volzharr_buried_furnace')).toBe(true);
    expect(isVolzharrEruptionWindup(windup, 'other_caster')).toBe(false);
    expect(
      isVolzharrEruptionWindup({ type: 'spellfx', fx: 'projectile' }, 'volzharr_buried_furnace'),
    ).toBe(false);
    expect(
      isVolzharrEruptionWindup({ type: 'damage', fx: 'windup' }, 'volzharr_buried_furnace'),
    ).toBe(false);
  });

  it('creates, updates, and removes authoritative vent geometry', () => {
    const scene = new THREE.Scene();
    const decals = new UndermountDecals(scene, (x, z) => x + z);

    decals.syncVents([{ id: '7:0', x: 2, z: 3, radius: 4 }]);
    const group = scene.getObjectByName('undermount-vent-decal') as THREE.Group;
    const ring = group.getObjectByName('undermount-vent-ring') as THREE.Mesh;
    const core = group.getObjectByName('undermount-vent-core') as THREE.Mesh;
    expect(group.position).toMatchObject({ x: 2, y: 5.09, z: 3 });
    expect(group.scale).toMatchObject({ x: 4, y: 4, z: 4 });
    expect((ring.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xff4b16);
    expect((core.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x050100);

    decals.syncVents([{ id: '7:0', x: -2, z: 1, radius: 2 }]);
    expect(scene.getObjectByName('undermount-vent-decal')).toBe(group);
    expect(scene.children.filter((child) => child.name === 'undermount-vent-decal')).toHaveLength(
      1,
    );
    expect(group.position).toMatchObject({ x: -2, y: -0.91, z: 1 });
    expect(group.scale).toMatchObject({ x: 2, y: 2, z: 2 });

    decals.syncVents([]);
    expect(scene.getObjectByName('undermount-vent-decal')).toBeUndefined();
    decals.dispose();
  });

  it('mirrors Forgeheat and mark auras onto visible entity views', () => {
    const scene = new THREE.Scene();
    const decals = new UndermountDecals(scene, () => 0);
    const view = new THREE.Group();
    view.position.set(4, 2, 8);
    const camera = new THREE.PerspectiveCamera();
    camera.quaternion.setFromEuler(new THREE.Euler(0.2, 0.4, 0));
    const entity = {
      id: 11,
      scale: 2,
      auras: [{ id: 'volzharr_forgeheat' }, { id: 'odrenn_scorched' }],
    };

    decals.syncEntities([entity as never], new Map([[11, { group: view }]]), camera);
    const group = scene.getObjectByName('undermount-entity-decals') as THREE.Group;
    const forgeheat = group.getObjectByName('undermount-forgeheat-ring') as THREE.Mesh;
    const scorched = group.getObjectByName('undermount-scorched-glyph') as THREE.LineLoop;
    const chilled = group.getObjectByName('undermount-chilled-glyph') as THREE.LineLoop;
    expect(group.position).toMatchObject({ x: 4, y: 2, z: 8 });
    expect(forgeheat.visible).toBe(true);
    expect(forgeheat.scale.x).toBeCloseTo(3.1);
    expect(scorched.visible).toBe(true);
    expect(chilled.visible).toBe(false);
    expect(scorched.position.y).toBeCloseTo(5.6);
    expect(scorched.quaternion.equals(camera.quaternion)).toBe(true);

    entity.auras = [{ id: 'odrenn_chilled' }];
    decals.syncEntities([entity as never], new Map([[11, { group: view }]]), camera);
    expect(forgeheat.visible).toBe(false);
    expect(scorched.visible).toBe(false);
    expect(chilled.visible).toBe(true);
    decals.syncEntities([], new Map(), camera);
    expect(scene.getObjectByName('undermount-entity-decals')).toBeUndefined();
    decals.dispose();
  });

  it('shows the Eruption flash for the full windup and holds steady under reduced motion', () => {
    const scene = new THREE.Scene();
    const decals = new UndermountDecals(scene, () => 2);
    const ring = scene.getObjectByName('undermount-eruption-telegraph') as THREE.Mesh;

    decals.beginEruption(3, 5);
    expect(ring.visible).toBe(true);
    expect(ring.position).toMatchObject({ x: 3, y: 2.135, z: 5 });
    expect(ring.scale.x).toBe(34);
    decals.update(0.6, false);
    const animatedOpacity = (ring.material as THREE.MeshBasicMaterial).opacity;
    expect(animatedOpacity).toBeGreaterThanOrEqual(0.42);
    expect(animatedOpacity).toBeLessThanOrEqual(0.9);
    expect(animatedOpacity).not.toBe(0.9);
    expect(ring.visible).toBe(true);

    decals.beginEruption(3, 5);
    decals.update(1, true);
    expect((ring.material as THREE.MeshBasicMaterial).opacity).toBe(0.9);
    decals.update(1.99, true);
    expect(ring.visible).toBe(true);
    decals.update(0.01, true);
    expect(ring.visible).toBe(false);
    decals.dispose();
    expect(scene.getObjectByName('undermount-eruption-telegraph')).toBeUndefined();
  });

  it('wires the painter into prewarm, live render, and the Volzharr windup event', () => {
    const path = fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('this.undermountDecals = new UndermountDecals(');
    expect(source.match(/this\.undermountDecals\.syncVents\(/g)).toHaveLength(2);
    expect(source.match(/this\.undermountDecals\.syncEntities\(/g)).toHaveLength(2);
    expect(
      source.match(/this\.undermountDecals\.update\(dt, this\.reducedMotion\(\)\)/g),
    ).toHaveLength(2);
    expect(source).toContain(
      'this.undermountDecals.beginEruption(undermountSource.pos.x, undermountSource.pos.z)',
    );
  });
});
