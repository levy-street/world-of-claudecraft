import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(__dirname, '..');
const ASSET_PATH = path.join(REPO_ROOT, 'public/models/chars/forms/metamorphosis.glb');
// Re-pinned for the KTX2 texture conversion (scripts/assets/
// compress_glb_textures.mjs): larger on disk, ~8x smaller resident on GPU.
const ASSET_BYTES = 500_172;
const ASSET_SHA256 = '7d722a6a0a9b5116449497135b4fffbc33956a9197cffc1100a74bb3ab93e449';

async function readAsset() {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(ASSET_PATH);
}

describe('Warlock Metamorphosis asset', () => {
  it('pins the approved generated Lich form artifact', () => {
    const bytes = readFileSync(ASSET_PATH);
    expect(bytes.length).toBe(ASSET_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ASSET_SHA256);
    expect(bytes.length).toBeLessThanOrEqual(1.8 * 1024 * 1024);
  });

  it('ships a dedicated winged rig with the exact gameplay clip set', async () => {
    const document = await readAsset();
    const root = document.getRoot();
    const nodes = new Map(root.listNodes().map((node) => [node.getName(), node]));
    expect(
      root
        .listExtensionsUsed()
        .map((extension) => extension.extensionName)
        .sort(),
    ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu']);

    for (const name of [
      'Armature',
      'Root',
      'Spine02',
      'Head',
      'L_Hand',
      'R_Hand',
      'metamorph_wing_left_hinge',
      'metamorph_wing_right_hinge',
    ]) {
      expect(nodes.has(name), name).toBe(true);
    }
    expect([...nodes.keys()].some((name) => name.startsWith('Rogue_'))).toBe(false);

    const skins = root.listSkins();
    expect(skins).toHaveLength(1);
    const jointNames = new Set(skins[0].listJoints().map((joint) => joint.getName()));
    expect(jointNames.has('metamorph_wing_left_hinge')).toBe(true);
    expect(jointNames.has('metamorph_wing_right_hinge')).toBe(true);
    expect(jointNames.size).toBe(43);

    const clips = root.listAnimations();
    expect(clips.map((clip) => clip.getName())).toEqual([
      'Idle',
      'Walk',
      'Run',
      'Attack',
      'Hit',
      'Death',
      'Cast',
    ]);
    for (const clip of clips) {
      const targets = new Set(
        clip
          .listChannels()
          .map((channel) => channel.getTargetNode()?.getName())
          .filter((name): name is string => !!name),
      );
      expect(targets.has('metamorph_wing_left_hinge'), clip.getName()).toBe(false);
      expect(targets.has('metamorph_wing_right_hinge'), clip.getName()).toBe(false);
    }
  });

  it('keeps one compact textured skinned mesh and the cleaned silhouette', async () => {
    const document = await readAsset();
    const root = document.getRoot();
    const meshes = root.listMeshes();
    const primitives = meshes.flatMap((mesh) => mesh.listPrimitives());
    expect(meshes).toHaveLength(1);
    expect(primitives).toHaveLength(1);

    const primitive = primitives[0];
    expect(primitive.getIndices()).not.toBeNull();
    const positions = primitive.getAttribute('POSITION')?.getArray();
    const texcoords = primitive.getAttribute('TEXCOORD_0')?.getArray();
    const jointIndices = primitive.getAttribute('JOINTS_0')?.getArray();
    const jointWeights = primitive.getAttribute('WEIGHTS_0')?.getArray();
    expect(positions).toBeDefined();
    expect(texcoords).toBeDefined();
    expect(jointIndices).toBeDefined();
    expect(jointWeights).toBeDefined();
    expect(primitive.getAttribute('POSITION')?.getCount()).toBe(9_274);
    expect((primitive.getIndices()?.getCount() ?? 0) / 3).toBe(6_004);
    expect(Array.from(positions ?? []).every(Number.isFinite)).toBe(true);
    expect(Array.from(texcoords ?? []).every(Number.isFinite)).toBe(true);

    const materials = root.listMaterials();
    expect(materials).toHaveLength(1);
    expect(primitive.getMaterial()).toBe(materials[0]);
    expect(materials[0].getBaseColorTexture()).not.toBeNull();
    expect(materials[0].getNormalTexture()).not.toBeNull();
    expect(materials[0].getMetallicRoughnessTexture()).not.toBeNull();
    expect(root.listTextures().map((texture) => texture.getMimeType())).toEqual([
      'image/ktx2',
      'image/ktx2',
      'image/ktx2',
    ]);

    const joints = root.listSkins()[0].listJoints();
    const wingInfluenceCount = (name: string) => {
      const joint = joints.findIndex((candidate) => candidate.getName() === name);
      let vertices = 0;
      for (let vertex = 0; vertex < (jointIndices?.length ?? 0) / 4; vertex++) {
        for (let influence = 0; influence < 4; influence++) {
          const offset = vertex * 4 + influence;
          if (jointIndices?.[offset] === joint && (jointWeights?.[offset] ?? 0) > 0.99) {
            vertices++;
            break;
          }
        }
      }
      return vertices;
    };
    expect(wingInfluenceCount('metamorph_wing_left_hinge')).toBe(1_144);
    expect(wingInfluenceCount('metamorph_wing_right_hinge')).toBe(1_272);
  });
});
