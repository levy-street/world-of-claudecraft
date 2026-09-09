import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { roachBodyContactProbe, roachPoseFailures } from '../scripts/lib/roach_king_pose_probe.mjs';

function fixture(torn = false, supportImpostor = 'paw_tip') {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -1, 2, -1, 0, 2, -1, 1, 2, -1, -1, 2, 0, 0, 2, 0, 1, 2, 0, -1, 2, 1, 0, 2, 1, 1, 2, 1, 2, 0,
        0, 3, 0, 0, 2, 0, 1,
      ],
      3,
    ),
  );
  geometry.setIndex([
    0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4, 3, 4, 6, 4, 7, 6, 4, 5, 7, 5, 8, 7, 9, 10, 11,
  ]);
  const joints = [];
  const weights = [];
  for (let i = 0; i < 12; i++) {
    joints.push(i >= 9 ? 1 : torn && i === 8 ? 2 : 0, 0, 0, 0);
    weights.push(1, 0, 0, 0);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const bones = ['tripo0_Left_Limb_0', supportImpostor, 'wrong_paw_tip'].map((name) => {
    const bone = new THREE.Bone();
    bone.name = name;
    mesh.add(bone);
    return bone;
  });
  mesh.bind(new THREE.Skeleton(bones));
  if (torn) bones[2].position.y = 20;
  const modelWrap = new THREE.Group();
  modelWrap.add(mesh);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial());
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'actual_arena_floor';
  floor.updateMatrixWorld(true);
  vi.stubGlobal('window', {
    __game: {
      renderer: {
        views: new Map([[1, { visualKey: 'mob_roach_king', visual: { modelWrap } }]]),
        mageGroundFx: { groundY: () => 0 },
        riftInteriorGroups: new Map([['arena', floor]]),
        raycaster: new THREE.Raycaster(),
      },
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Roach corpse and skin diagnostic', () => {
  it.each(['paw_tip', 'tripoSpine_0'])(
    'rejects %s contact as proof of shell support',
    (supportImpostor) => {
      fixture(false, supportImpostor);
      const probe = roachBodyContactProbe(1);
      expect(probe.allClearance.min).toBe(0);
      expect(probe.bodyVertices).toBe(9);
      expect(probe.bodyClearance.min).toBe(2);
      expect(probe.bodyContactFraction).toBe(0);
      expect(
        roachPoseFailures({ 'death-end': { boss: { visualKey: 'mob_roach_king' }, pose: probe } }),
      ).toContain('Corpse shell does not contact the rendered arena');
      for (const sample of probe.renderedFloor) {
        expect(sample.floorY).toBeCloseTo(0);
        expect(sample.clearance).toBeCloseTo(2);
      }
      expect(probe.edgeStretch.max).toBeCloseTo(1);
    },
  );

  it('detects a stretched weighted triangle while the lowest toe remains unchanged', () => {
    fixture(true);
    const probe = roachBodyContactProbe(1);
    expect(probe.allClearance.min).toBe(0);
    expect(probe.edgeStretch.max).toBeGreaterThan(10);
    expect(
      roachPoseFailures({ 'death-end': { boss: { visualKey: 'mob_roach_king' }, pose: probe } }),
    ).toContain('death-end: stretched king skin triangles');
    expect(probe.edgeStretch.median).toBeCloseTo(1);
  });
});

describe('Mixer sample-boundary validation', () => {
  it('keeps raw callback weights but catches a sampled pose deficit or persistent overweight', () => {
    const failure = 'king: animation transition loses normalized pose weight';
    const check = (frames) => roachPoseFailures({}, { king: { frames } });
    expect(
      check([
        { weight: 1.3186, pendingActionSample: true },
        { weight: 1, pendingActionSample: false },
      ]),
    ).not.toContain(failure);
    expect(check([{ weight: 0.7, pendingActionSample: false }])).toContain(failure);
    expect(
      check([
        { weight: 1.3186, pendingActionSample: true },
        { weight: 1.3, pendingActionSample: false },
      ]),
    ).toContain(failure);
  });
});
