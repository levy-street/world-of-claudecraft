// neutral_morph_merge.ts: the body-slider morph parts of a composed body fold
// back into the merged body draw when every body slider is at neutral, and
// the face parts keep their live morphs. The GLB-backed cases pin the win
// against the asset actually shipped, since the whole point is the draw and
// skeleton count a real composed body costs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  bodyNeutral,
  classArmorSet,
  DEFAULT_APPEARANCE,
  fullSet,
  MODULAR_WARRIOR_KEY,
  type ModularAppearance,
  modularBuildSignature,
  modularGeometryKey,
  modularPartNames,
  NEUTRAL_BODY,
  NEUTRAL_FACE,
  normalizeAppearance,
} from '../src/render/characters/modular';
import {
  disposeOrphanedGeometries,
  isBodySliderTarget,
  stripNeutralBodyMorphs,
} from '../src/render/characters/neutral_morph_merge';
import { mergeSkinnedParts } from '../src/render/characters/rig_merge';

// ---------------------------------------------------------------------------
// Synthetic rig: two body parts and one face part on one skeleton + material
// ---------------------------------------------------------------------------

function skeleton(): THREE.Skeleton {
  const a = new THREE.Bone();
  const b = new THREE.Bone();
  a.add(b);
  a.updateMatrixWorld(true);
  return new THREE.Skeleton([a, b]);
}

function part(
  name: string,
  skel: THREE.Skeleton,
  mat: THREE.Material,
  targets: Record<string, number[]>,
): THREE.SkinnedMesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4),
  );
  geo.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  geo.setIndex([0, 1, 2]);
  const names = Object.keys(targets);
  if (names.length) {
    geo.morphAttributes.position = names.map((n) => {
      const attr = new THREE.Float32BufferAttribute(targets[n], 3);
      attr.name = n; // updateMorphTargets keys the dictionary off the attribute name
      return attr;
    });
    geo.morphTargetsRelative = true;
  }
  const sm = new THREE.SkinnedMesh(geo, mat);
  sm.name = name;
  sm.bind(skel, new THREE.Matrix4());
  sm.updateMorphTargets();
  return sm;
}

function synthRoot(): {
  root: THREE.Group;
  torso: THREE.SkinnedMesh;
  arm: THREE.SkinnedMesh;
  head: THREE.SkinnedMesh;
} {
  const root = new THREE.Group();
  root.add(...skeleton().bones.slice(0, 1));
  const skel = skeleton();
  root.add(skel.bones[0]);
  const skin = new THREE.MeshStandardMaterial({ name: 'mod_skin_detail' });
  const zeros = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const torso = part('M_Torso', skel, skin, { body_chest_up: zeros, body_chest_dn: zeros });
  const arm = part('M_ArmL', skel, skin, { body_elbows_up: zeros, body_elbows_dn: zeros });
  const head = part('M_Head', skel, skin, { nose_up: zeros, cheeks_up: zeros });
  root.add(torso, arm, head);
  root.updateMatrixWorld(true);
  return { root, torso, arm, head };
}

function skinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh);
  });
  return out;
}

describe('bodyNeutral', () => {
  it('is true for the default look, a missing body, and an all-zero body', () => {
    expect(bodyNeutral(DEFAULT_APPEARANCE)).toBe(true);
    const noBody = { ...DEFAULT_APPEARANCE } as Partial<ModularAppearance>;
    delete noBody.body; // a look saved before the body sliders existed
    expect(bodyNeutral(noBody as ModularAppearance)).toBe(true);
    expect(bodyNeutral({ ...DEFAULT_APPEARANCE, body: { ...NEUTRAL_BODY } })).toBe(true);
  });

  it('is false the moment any body slider leaves zero', () => {
    expect(bodyNeutral({ ...DEFAULT_APPEARANCE, body: { ...NEUTRAL_BODY, hips: 0.2 } })).toBe(
      false,
    );
    expect(bodyNeutral({ ...DEFAULT_APPEARANCE, body: { ...NEUTRAL_BODY, feet: -1 } })).toBe(false);
  });

  it('reaches the geometry key and the build signature, so a body slider crossing neutral rebuilds', () => {
    // The in-place slider path runs exactly when the build signature is
    // unchanged, and it writes influences by name onto whatever targets the
    // body carries. A body-neutral variant has none for the body regions, so
    // the neutral/live bit must fork the key the signature is composed from.
    const neutral = { ...DEFAULT_APPEARANCE, body: { ...NEUTRAL_BODY } };
    const authored = { ...DEFAULT_APPEARANCE, body: { ...NEUTRAL_BODY, shoulders: 0.2 } };
    expect(modularGeometryKey(authored)).not.toBe(modularGeometryKey(neutral));
    expect(modularBuildSignature(authored)).not.toBe(modularBuildSignature(neutral));
    // ...while the VALUE of an authored slider stays out of both, like the face
    const authoredMore = { ...DEFAULT_APPEARANCE, body: { ...NEUTRAL_BODY, shoulders: 0.6 } };
    expect(modularGeometryKey(authoredMore)).toBe(modularGeometryKey(authored));
    expect(modularBuildSignature(authoredMore)).toBe(modularBuildSignature(authored));
    // ...and a face slider alone still shares the neutral body's geometry
    const shaped = { ...neutral, face: { ...NEUTRAL_FACE, jaw: 1 } };
    expect(modularGeometryKey(shaped)).toBe(modularGeometryKey(neutral));
  });

  it('names exactly the body slider targets', () => {
    expect(isBodySliderTarget('body_shoulders_up')).toBe(true);
    expect(isBodySliderTarget('body_feet_dn')).toBe(true);
    expect(isBodySliderTarget('nose_up')).toBe(false);
    expect(isBodySliderTarget('mouth_open')).toBe(false);
  });
});

describe('stripNeutralBodyMorphs', () => {
  it('strips only the parts whose every target is a body slider', () => {
    const { root, torso, arm, head } = synthRoot();
    const minted = stripNeutralBodyMorphs(root);
    expect(minted).toHaveLength(2);
    for (const sm of [torso, arm]) {
      expect(sm.geometry.morphAttributes.position).toBeUndefined();
      expect(sm.morphTargetDictionary).toBeUndefined();
      expect(sm.morphTargetInfluences).toBeUndefined();
      expect(minted).toContain(sm.geometry);
    }
    // the face part is untouched: same geometry object, morphs live
    expect(head.geometry.morphAttributes.position).toHaveLength(2);
    expect(head.morphTargetDictionary).toEqual({ nose_up: 0, cheeks_up: 1 });
  });

  it('lets mergeSkinnedParts fold the stripped parts into one draw, face left alone', () => {
    const { root, head } = synthRoot();
    const minted = stripNeutralBodyMorphs(root);
    mergeSkinnedParts(root);
    const meshes = skinnedMeshes(root);
    expect(meshes).toHaveLength(2);
    expect(meshes).toContain(head);
    const merged = meshes.find((m) => m !== head);
    expect(merged?.name).toBe('M_Torso_bodymerged');
    expect(merged?.geometry.getAttribute('position').count).toBe(6);
    // both minted copies left the tree with the merge and are freed
    expect(disposeOrphanedGeometries(root, minted)).toBe(2);
  });

  it('is a no-op on a rig with no morph parts', () => {
    const root = new THREE.Group();
    const skel = skeleton();
    root.add(skel.bones[0]);
    root.add(part('plain', skel, new THREE.MeshStandardMaterial(), {}));
    expect(stripNeutralBodyMorphs(root)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The shipped GLB: what a composed body actually costs, before and after
// ---------------------------------------------------------------------------

/** Parse the modular GLB in Node with its textures removed (nothing here
 *  needs an image, and Node cannot decode one). */
async function loadModularScene(): Promise<THREE.Group> {
  await MeshoptDecoder.ready;
  const def = VISUALS[MODULAR_WARRIOR_KEY];
  const bytes = readFileSync(path.join(process.cwd(), 'public', def.url));
  const jsonLen = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLen));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    delete m.extensions;
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  }
  const dropBasisu = (list: string[] | undefined) =>
    (list ?? []).filter((e) => e !== 'KHR_texture_basisu');
  json.extensionsRequired = dropBasisu(json.extensionsRequired);
  json.extensionsUsed = dropBasisu(json.extensionsUsed);
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jsonBuf = Buffer.from(text, 'utf8');
  const rest = bytes.subarray(20 + jsonLen);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + jsonBuf.length + rest.length, 8);
  header.writeUInt32LE(jsonBuf.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const packed = Buffer.concat([header, jsonBuf, rest]);
  const ab = packed.buffer.slice(
    packed.byteOffset,
    packed.byteOffset + packed.byteLength,
  ) as ArrayBuffer;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return await new Promise<THREE.Group>((resolve, reject) =>
    loader.parse(ab, '', (g) => resolve(g.scene), reject),
  );
}

/** The prune modularVariant (assets.ts) performs, on a fresh clone. */
function composeParts(scene: THREE.Group, app: ModularAppearance, cls: string): THREE.Object3D {
  const keep = new Set(modularPartNames(app, fullSet(classArmorSet(cls))));
  const root = cloneSkinned(scene);
  const drop: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (!(o as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (keep.has(o.name)) return;
    if (o.parent && keep.has(o.parent.name)) return;
    drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
  return root;
}

function census(root: THREE.Object3D): {
  draws: number;
  skeletons: number;
  byMaterial: Record<string, number>;
  morphed: string[];
} {
  const byMaterial: Record<string, number> = {};
  const skeletons = new Set<THREE.Skeleton>();
  const morphed: string[] = [];
  const meshes = skinnedMeshes(root);
  for (const sm of meshes) {
    skeletons.add(sm.skeleton);
    const mat = (sm.material as THREE.Material).name;
    byMaterial[mat] = (byMaterial[mat] ?? 0) + 1;
    if (sm.geometry.morphAttributes.position) morphed.push(sm.name);
  }
  return { draws: meshes.length, skeletons: skeletons.size, byMaterial, morphed };
}

/** The nine body-region part nodes per gender, the ONLY parts the strip may
 *  touch (BODY_BY_SLOT in modular.ts names them by armour slot; spelled out
 *  here so the pin does not read its expectation off the table under test). */
const BODY_REGIONS = {
  male: [
    'M_ArmL',
    'M_ArmR',
    'M_FootL',
    'M_FootR',
    'M_HandL',
    'M_HandR',
    'M_LegL',
    'M_LegR',
    'M_Torso',
  ],
  female: [
    'F_ArmL',
    'F_ArmR',
    'F_FootL',
    'F_FootR',
    'F_HandL',
    'F_HandR',
    'F_LegL',
    'F_LegR',
    'F_Torso',
  ],
} as const;

/** The parts that carried morphs as shipped and no longer do after the strip
 *  and merge: exactly the set the strip took, sorted for a stable comparison. */
function stripped(before: ReturnType<typeof census>, after: ReturnType<typeof census>): string[] {
  const kept = new Set(after.morphed);
  return before.morphed.filter((name) => !kept.has(name)).sort();
}

describe('the shipped modular GLB', () => {
  let scene: THREE.Group;
  beforeAll(async () => {
    scene = await loadModularScene();
  }, 30000);

  it('folds the nine body-region parts into one skin-detail draw, face morphs live', () => {
    const asShipped = composeParts(scene, DEFAULT_APPEARANCE, 'warrior');
    mergeSkinnedParts(asShipped);
    const before = census(asShipped);
    // the cost this module exists for: nine body regions each its own draw
    // and its own skeleton, refused by the merge for their body morphs
    expect(before.byMaterial.mod_skin_detail).toBe(9);
    expect(before.skeletons).toBe(before.draws);

    const merged = composeParts(scene, DEFAULT_APPEARANCE, 'warrior');
    const minted = stripNeutralBodyMorphs(merged);
    expect(minted).toHaveLength(9);
    mergeSkinnedParts(merged);
    disposeOrphanedGeometries(merged, minted);
    const after = census(merged);
    expect(after.byMaterial.mod_skin_detail).toBe(1);
    expect(after.draws).toBe(before.draws - 8);
    expect(after.skeletons).toBe(before.skeletons - 8);
    // WHICH parts lost their morphs, not just how many: exactly the nine body
    // regions, so a GLB that hands the merge the wrong nine cannot pass
    expect(stripped(before, after)).toEqual(BODY_REGIONS.male);
    // every face part still carries its morphs: the head's 17, the eye's 8...
    expect(after.morphed).toContain('M_Head');
    expect(after.morphed).toContain('M_Eye_almond');
    // the merged body carries the union of the regions' vertices, nothing lost
    const body = skinnedMeshes(merged).find((m) => m.name === 'M_ArmL_bodymerged');
    expect(body).toBeDefined();
    const regionVerts = skinnedMeshes(asShipped)
      .filter((m) => (m.material as THREE.Material).name === 'mod_skin_detail')
      .reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
    expect(body?.geometry.getAttribute('position').count).toBe(regionVerts);
  });

  it('does the same for the female body under a helmless kit', () => {
    const app = normalizeAppearance({ ...DEFAULT_APPEARANCE, gender: 'female', hair: 'layered' });
    const asShipped = composeParts(scene, app, 'druid');
    mergeSkinnedParts(asShipped);
    const before = census(asShipped);
    const root = composeParts(scene, app, 'druid');
    const minted = stripNeutralBodyMorphs(root);
    expect(minted).toHaveLength(9);
    mergeSkinnedParts(root);
    disposeOrphanedGeometries(root, minted);
    const after = census(root);
    expect(after.byMaterial.mod_skin_detail).toBe(1);
    expect(stripped(before, after)).toEqual(BODY_REGIONS.female);
    expect(after.morphed).toContain('F_Head');
    expect(after.morphed).toContain('F_Ear_round');
  });
});
