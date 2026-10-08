import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  hangWocRigidArmor,
  instantiateWocArmor,
  prepareWocArmor,
  wocRigBindOf,
  wocRigSkeletonOf,
} from '../src/render/characters/woc_armor_bind';
import type { WocCharacterManifest } from '../src/render/characters/woc_character_manifest';
import { resolveWocPartNodes } from '../src/render/characters/woc_parts';

// The bone-name bind of a streamed WOC armor file onto a character's own skeleton (the
// 2026-09-25 character size gameplan, step 6): an armor file carries its own copy of the rig,
// in its own bone order, and its own quantization folded into its inverse bind matrices. The
// prepared part must skin to EXACTLY where the file's own rig puts it, under any pose.

interface Rig {
  root: THREE.Group;
  bones: Record<string, THREE.Bone>;
}

/** root -> spine -> head, the spine a unit up and the head half a unit above it. */
function rig(order: string[] = ['root', 'spine', 'head']): Rig {
  const root = new THREE.Group();
  const bones: Record<string, THREE.Bone> = {};
  for (const name of ['root', 'spine', 'head']) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }
  root.add(bones.root);
  bones.root.add(bones.spine);
  bones.spine.add(bones.head);
  bones.spine.position.set(0, 1, 0);
  bones.head.position.set(0, 0.5, 0.1);
  root.updateMatrixWorld(true);
  void order;
  return { root, bones };
}

/** A small skinned strip: every vertex rides `weights` over the skeleton's bone slots. */
function strip(points: number[][], joints: number[][], weights: number[][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints.flat(), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights.flat(), 4));
  g.setIndex([0, 1, 2]);
  return g;
}

const POINTS = [
  [0.2, 1.2, 0.1],
  [-0.2, 1.4, 0.1],
  [0, 1.6, 0.15],
];

/** The base: a body on the canonical rig (bone order root, spine, head; plain inverses). */
function base(): { r: Rig; body: THREE.SkinnedMesh } {
  const r = rig();
  const body = new THREE.SkinnedMesh(
    strip(
      POINTS,
      POINTS.map(() => [0, 0, 0, 0]),
      POINTS.map(() => [1, 0, 0, 0]),
    ),
    new THREE.MeshBasicMaterial(),
  );
  body.name = 'Character_Body';
  r.root.add(body);
  body.bind(new THREE.Skeleton([r.bones.root, r.bones.spine, r.bones.head]));
  return { r, body };
}

/**
 * The armor file: its OWN rig copy with its bones in another order, and quantized positions
 * whose dequantization (x2 and an offset) is folded into its inverse bind matrices, the way
 * gltf-transform writes a split file.
 */
function pack(material: THREE.Material): { r: Rig; parts: THREE.SkinnedMesh[] } {
  const r = rig();
  const order = [r.bones.head, r.bones.root, r.bones.spine];
  const dequant = new THREE.Matrix4()
    .makeTranslation(0.05, -0.1, 0)
    .multiply(new THREE.Matrix4().makeScale(2, 2, 2));
  const inv = new THREE.Matrix4().copy(dequant).invert();
  const quantized = (p: number[]) => new THREE.Vector3(...p).applyMatrix4(inv).toArray();
  const inverses = order.map((b) =>
    new THREE.Matrix4().copy(b.matrixWorld).invert().multiply(dequant),
  );
  const make = (name: string, points: number[][]) => {
    const part = new THREE.SkinnedMesh(
      strip(
        points.map(quantized),
        // head (slot 0 in this file) and spine (slot 2), blended
        points.map(() => [0, 2, 0, 0]),
        points.map(() => [0.25, 0.75, 0, 0]),
      ),
      material,
    );
    part.name = name;
    r.root.add(part);
    part.bind(new THREE.Skeleton(order, inverses));
    return part;
  };
  const parts = [
    make('Armor_Test_Boot_L', POINTS),
    make(
      'Armor_Test_Boot_R',
      POINTS.map(([x, y, z]) => [-x, y, z]),
    ),
    make(
      'Armor_Test_Helm',
      POINTS.map(([x, y, z]) => [x, y + 0.5, z]),
    ),
  ];
  // a rigid part hanging from the file's own spine bone, as authored (a shoulder pad)
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
  pad.name = 'Armor_Test_Shoulder_L';
  pad.position.set(0.3, 0.2, 0);
  r.bones.spine.add(pad);
  return { r, parts };
}

/** Pose both rigs the same way (a bent spine, a turned head). */
function pose(r: Rig): void {
  r.bones.spine.rotation.set(0.4, 0.2, -0.3);
  r.bones.head.rotation.set(-0.2, 0.7, 0.1);
  r.root.updateMatrixWorld(true);
}

function skinnedWorld(mesh: THREE.SkinnedMesh): THREE.Vector3[] {
  mesh.skeleton.update();
  const out: THREE.Vector3[] = [];
  const pos = mesh.geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    out.push(v.applyMatrix4(mesh.matrixWorld));
  }
  return out;
}

describe('WOC armor bound to a character skeleton by bone name', () => {
  it('reads the canonical bind off the base and ignores attached parts', () => {
    const { r, body } = base();
    const bind = wocRigBindOf(r.root);
    expect(bind?.boneNames).toEqual(['root', 'spine', 'head']);
    expect(bind?.boneInverses).toBe(body.skeleton.boneInverses);
    expect(wocRigSkeletonOf(r.root)).toBe(body.skeleton);
  });

  it('skins every prepared part exactly where its own file rig puts it, under any pose', () => {
    const material = new THREE.MeshBasicMaterial();
    const { r: baseRig } = base();
    const file = pack(material);
    const bind = wocRigBindOf(baseRig.root);
    if (!bind) throw new Error('no rig');
    // what the file itself draws, posed
    pose(file.r);
    const expected = file.parts.map((p) => skinnedWorld(p));
    const prepared = prepareWocArmor(file.r.root, bind, (mesh) =>
      /Boot/.test(mesh.name) ? 'item:boots' : `item:${mesh.name}`,
    );
    expect(prepared.refused).toEqual([]);
    // the two boots share a material and an item: one merged draw; the helm stays its own
    expect(prepared.templates).toHaveLength(2);
    const boots = prepared.templates.find((t) => /Boot/.test(t.name));
    expect(boots?.userData.mergedSkinnedPartNames).toEqual([
      'Armor_Test_Boot_L',
      'Armor_Test_Boot_R',
    ]);
    // joint indices are the base's bone order now
    const skeleton = wocRigSkeletonOf(baseRig.root);
    if (!skeleton) throw new Error('no skeleton');
    const meshes = instantiateWocArmor(prepared.templates, skeleton, bind.bindMatrix);
    for (const m of meshes) baseRig.root.add(m);
    pose(baseRig);
    const helm = meshes.find((m) => /Helm/.test(m.name));
    const bootMesh = meshes.find((m) => /Boot/.test(m.name));
    if (!helm || !bootMesh) throw new Error('missing parts');
    expect(helm.skeleton).toBe(skeleton);
    expect(helm.userData.wocArmorPart).toBe(true);
    const near = (a: THREE.Vector3[], b: THREE.Vector3[]) => {
      expect(a).toHaveLength(b.length);
      for (const [i, v] of a.entries()) {
        expect(v.distanceTo(b[i]), `vertex ${i}`).toBeLessThan(1e-5);
      }
    };
    near(skinnedWorld(helm), expected[2]);
    near(skinnedWorld(bootMesh), [...expected[0], ...expected[1]]);
    // shared geometry: a second wearer draws the same buffers
    const again = instantiateWocArmor(prepared.templates, skeleton, bind.bindMatrix);
    expect(again[0].geometry).toBe(meshes[0].geometry);
    expect(again[0].material).toBe(meshes[0].material);
  });

  it('re-hangs a rigid part on the character bone of the same name, over shared geometry', () => {
    const material = new THREE.MeshBasicMaterial();
    const { r: baseRig } = base();
    const file = pack(material);
    const bind = wocRigBindOf(baseRig.root);
    if (!bind) throw new Error('no rig');
    const prepared = prepareWocArmor(file.r.root, bind);
    expect(prepared.rigid.map((p) => [p.bone, p.node.name])).toEqual([
      ['spine', 'Armor_Test_Shoulder_L'],
    ]);
    const wrappers = hangWocRigidArmor(prepared.rigid, baseRig.root);
    expect(wrappers).toHaveLength(1);
    expect(wrappers[0].parent).toBe(baseRig.bones.spine);
    const pad = wrappers[0].getObjectByName('Armor_Test_Shoulder_L') as THREE.Mesh;
    expect(pad.userData.wocArmorPart).toBe(true);
    expect(pad.geometry).toBe((prepared.rigid[0].node as THREE.Mesh).geometry);
    pose(baseRig);
    const world = new THREE.Vector3().setFromMatrixPosition(pad.matrixWorld);
    const expected = new THREE.Vector3(0.3, 0.2, 0).applyMatrix4(baseRig.bones.spine.matrixWorld);
    expect(world.distanceTo(expected)).toBeLessThan(1e-6);
    // a bone the character lacks leaves that part off
    const lone = new THREE.Group();
    expect(hangWocRigidArmor(prepared.rigid, lone)).toEqual([]);
  });

  it('leaves off (and names) a part riding a bone the base rig does not have', () => {
    const { r: baseRig } = base();
    const bind = wocRigBindOf(baseRig.root);
    if (!bind) throw new Error('no rig');
    const file = rig();
    const tail = new THREE.Bone();
    tail.name = 'tail';
    file.bones.root.add(tail);
    file.root.updateMatrixWorld(true);
    const part = new THREE.SkinnedMesh(
      strip(
        POINTS,
        POINTS.map(() => [0, 0, 0, 0]),
        POINTS.map(() => [1, 0, 0, 0]),
      ),
      new THREE.MeshBasicMaterial(),
    );
    part.name = 'Armor_Test_Tail';
    file.root.add(part);
    part.bind(new THREE.Skeleton([tail]));
    const prepared = prepareWocArmor(file.root, bind);
    expect(prepared.templates).toEqual([]);
    expect(prepared.refused).toEqual(['Armor_Test_Tail']);
  });

  it('finds a part drawn with several materials, whose meshes carry the glTF mesh name', () => {
    // The shipped female boots (and the female warrior's gauntlets): the NODE is named for the
    // part and holds one mesh per primitive, named after the glTF MESH, which no manifest names.
    const { r: baseRig } = base();
    const bind = wocRigBindOf(baseRig.root);
    const skeleton = wocRigSkeletonOf(baseRig.root);
    if (!bind || !skeleton) throw new Error('no rig');
    const file = rig();
    const skin = new THREE.Skeleton([file.bones.root, file.bones.spine, file.bones.head]);
    const part = (name: string, parent: THREE.Object3D, material: THREE.Material) => {
      const mesh = new THREE.SkinnedMesh(
        strip(
          POINTS,
          POINTS.map(() => [1, 0, 0, 0]),
          POINTS.map(() => [1, 0, 0, 0]),
        ),
        material,
      );
      mesh.name = name;
      parent.add(mesh);
      mesh.bind(skin);
    };
    const left = new THREE.Group();
    left.name = 'Armor_Test_Boot_L';
    file.root.add(left);
    part('Test_Boot_L_|_Mesh001', left, new THREE.MeshBasicMaterial());
    part('Test_Boot_L_|_Mesh001_1', left, new THREE.MeshBasicMaterial());
    const right = new THREE.Group();
    right.name = 'Armor_Test_Boot_R';
    file.root.add(right);
    part('Test_Boot_R_|_Mesh001_bodymerged', right, new THREE.MeshBasicMaterial());
    file.root.updateMatrixWorld(true);
    const prepared = prepareWocArmor(file.root, bind);
    expect(prepared.refused).toEqual([]);
    for (const m of instantiateWocArmor(prepared.templates, skeleton, bind.bindMatrix)) {
      baseRig.root.add(m);
    }
    const manifest = {
      rigId: 'bind-fixture',
      fit: 'female',
      baseNodes: ['Character_Body'],
      appearance: {},
      items: {
        boots: {
          label: 'Boots',
          slot: 'feet',
          set: 'test',
          nodes: ['Armor_Test_Boot_L', 'Armor_Test_Boot_R'],
        },
      },
    } as unknown as WocCharacterManifest;
    const found = resolveWocPartNodes(baseRig.root, manifest);
    expect(found.get('Armor_Test_Boot_L')).toHaveLength(2);
    expect(found.get('Armor_Test_Boot_R')).toHaveLength(1);
  });
});
