import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { hasHunterTrapRestraint, hunterJawAngle } from '../src/render/hunter_trap_core';
import { HunterTrapVisuals } from '../src/render/hunter_trap_visual';
import { resetStudioPresentation } from '../src/render/studio_presentation';

const TRAP = {
  id: '1:1:frostjaw_trap',
  sourceId: 1,
  abilityId: 'frostjaw_trap',
  x: 3,
  z: 7,
  radius: 4,
  duration: 30,
  remaining: 30,
  armTime: 0.75,
  armRemaining: 0.75,
};
const ROOT = { id: 'frostjaw_trap_freeze', kind: 'root', remaining: 2 };

describe('Hunter trap hardware and authoritative restraints', () => {
  it('opens both jaws through arming, resets same-tick replacement and keeps true reach', () => {
    const scene = new THREE.Scene();
    const fx = new HunterTrapVisuals(scene, (x, z) => x * 0.02 + z * 0.03);
    fx.sync([TRAP]);
    expect(fx.jaws.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 32 }]);
    expect(fx.plates.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 16 }]);
    expect(
      (fx.boundary.geometry.attributes.position as THREE.BufferAttribute).updateRanges,
    ).toEqual([{ start: 0, count: 288 }]);
    const boundaryVersion = (fx.boundary.geometry.attributes.position as THREE.BufferAttribute)
      .version;
    const first = new THREE.Matrix4();
    fx.jaws.getMatrixAt(0, first);
    const buffer = fx.jaws.instanceMatrix.array;
    fx.sync([{ ...TRAP, armRemaining: 0, remaining: 29 }]);
    const armed = new THREE.Matrix4();
    fx.jaws.getMatrixAt(0, armed);
    expect(first.equals(armed)).toBe(false);
    fx.sync([TRAP]);
    const reset = new THREE.Matrix4();
    fx.jaws.getMatrixAt(0, reset);
    expect(reset.equals(first)).toBe(true);
    expect(fx.jaws.instanceMatrix.array).toBe(buffer);
    expect((fx.boundary.geometry.attributes.position as THREE.BufferAttribute).version).toBe(
      boundaryVersion,
    );
    const vertices = fx.boundary.geometry.attributes.position;
    for (let i = 0; i < 96; i += 6) {
      expect(Math.hypot(vertices.getX(i) - TRAP.x, vertices.getZ(i) - TRAP.z)).toBeCloseTo(4, 5);
      expect(vertices.getY(i)).toBeCloseTo(
        vertices.getX(i) * 0.02 + vertices.getZ(i) * 0.03 + 0.055,
        5,
      );
    }
    expect(hunterJawAngle(0.75, 0)).toBe(0);
    expect(hunterJawAngle(0.75, 0.75)).toBeGreaterThan(0.9);
    fx.dispose();
  });

  it('retires live hardware and cached terrain placements through the Studio reset seam', () => {
    const scene = new THREE.Scene();
    const ground = vi.fn(() => 0);
    const fx = new HunterTrapVisuals(scene, ground);
    fx.sync([TRAP]);
    ground.mockClear();
    const owner = {
      views: new Map(),
      removeView: vi.fn(),
      abilityVfx: { resetPresentation: vi.fn() },
      hunterTrapVisuals: fx,
      paladinConsecrationVisuals: { dispose: vi.fn() },
      temporalHourglassGroundVisuals: { sync: vi.fn() },
      riftDeathZoneVisuals: { sync: vi.fn() },
      waterJetVisualChannels: new Map(),
      snapshotDrainVisualChannels: new Set(),
      snapshotDemonicDrainVisualChannels: new Set(),
      healGlowAt: new Map(),
      selfRender: { ready: true },
      selectionRing: new THREE.Group(),
      aoeRings: [],
    };
    for (const field of [
      'abilityVfxFx',
      'vfx',
      'needleOfFateVfx',
      'sentenceVfx',
      'frozenOrbFx',
      'mageGroundFx',
      'warlockMeteorFx',
      'necromancyGroundFx',
      'necromancyArmyPortalFx',
      'abyssalRiftFx',
      'ringOfFrostVisuals',
      'glacialFrontVisual',
      'lightPulses',
      'cameraImpact',
      'drainChannelStopLatch',
    ])
      Object.assign(owner, { [field]: { clear: vi.fn() } });
    resetStudioPresentation(owner);
    expect(fx.group.visible).toBe(false);
    expect(fx.jaws.count).toBe(0);
    fx.sync([TRAP]);
    expect(ground).toHaveBeenCalled();
    fx.dispose();
  });

  it('draws the actual victim root, follows displayed position and never infers a catch from trap loss', () => {
    const scene = new THREE.Scene(),
      body = new THREE.Group();
    body.position.set(8, 2, -4);
    scene.add(body);
    const fx = new HunterTrapVisuals(scene, () => 0);
    const entity = { dead: false, auras: [ROOT] };
    const entities = new Map([[2, entity]]),
      bodies = new Map([[2, { group: body, height: 1.8 }]]);
    fx.sync([], entities, bodies);
    expect(fx.jaws.count).toBe(2);
    expect(fx.boundary.geometry.drawRange.count).toBe(0);
    const matrix = new THREE.Matrix4();
    fx.plates.getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([8, 2, -4]);
    body.position.x = 11;
    fx.sync([], entities, bodies);
    fx.plates.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBe(11);
    entity.auras = [];
    fx.sync([], entities, bodies);
    expect(fx.group.visible).toBe(false);
    fx.sync([TRAP]);
    fx.sync([], entities, bodies);
    expect(fx.jaws.count).toBe(0);
    expect(hasHunterTrapRestraint({ dead: true, auras: [ROOT] })).toBe(false);
    expect(hasHunterTrapRestraint({ dead: false, auras: [{ ...ROOT, remaining: 0 }] })).toBe(false);
    expect(
      hasHunterTrapRestraint({ dead: false, auras: [{ ...ROOT, id: 'frost_nova_root' }] }),
    ).toBe(false);
    fx.dispose();
  });

  it('batches raid-sized trap and restraint fields without per-cast objects or disposing shared assets', () => {
    const scene = new THREE.Scene();
    const fx = new HunterTrapVisuals(scene, () => 0);
    const geometry = fx.jaws.geometry,
      material = fx.jaws.material as THREE.Material;
    const geometryDispose = vi.spyOn(geometry, 'dispose'),
      materialDispose = vi.spyOn(material, 'dispose');
    const traps = Array.from({ length: 40 }, (_, i) => ({ ...TRAP, id: `trap:${i}`, x: i * 5 }));
    fx.sync(traps);
    expect(fx.group.children).toHaveLength(3);
    expect(fx.jaws.count).toBe(80);
    fx.clear();
    fx.sync(traps);
    expect(fx.group.children).toHaveLength(3);
    fx.dispose();
    fx.dispose();
    expect(scene.children).toHaveLength(0);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
  });
});
