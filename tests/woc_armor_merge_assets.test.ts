// The merged WOC armor (src/render/characters/woc_armor_merge.ts) on the SHIPPED files:
// every armor set of both body fits, attached to its base through the real store and
// dressed in its default kit, then folded and posed by clips of the shipped animation
// library. Pins what the merge promises on real data: a kit draws one mesh per file
// material, every skinned part is copied as stored (it already is in the body's bind),
// every rigid part (the shoulders, a helm) is folded onto its bone, and the merged mesh
// puts every vertex where its part draws it. Textures are stripped before the parse (no
// KTX2 transcoder runs headless): the fold reads geometry, skins and materials only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { describe, expect, it, vi } from 'vitest';

const loads = vi.hoisted(() => ({ pending: new Map<string, (gltf: unknown) => void>() }));
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(
    (url: string) =>
      new Promise((resolve) => {
        loads.pending.set(url, resolve);
      }),
  ),
  releaseGltf: vi.fn(),
}));

import { shareRigSkeleton } from '../src/render/characters/rig_shared_skeleton';
import { optimizeSkinGpuLayout } from '../src/render/characters/skin_gpu_layout';
import { WOC_SHIPPED_SETS, wocSetManifest } from '../src/render/characters/woc_armor_catalog';
import {
  type WocFit,
  wocAnimsUrl,
  wocArmorPackUrl,
  wocBaseUrl,
} from '../src/render/characters/woc_armor_core';
import {
  mergeWocArmorGeometry,
  planWocArmorMerge,
  wocArmorDrawnParts,
  wocArmorMergeBindOf,
} from '../src/render/characters/woc_armor_merge';
import { attachWocArmorPack, ensureWocArmorPack } from '../src/render/characters/woc_armor_packs';
import { applyWocPartVisibility, resolveWocPartNodes } from '../src/render/characters/woc_parts';
import {
  wocDefaultAppearance,
  wocDefaultWorn,
  wocVisibleParts,
} from '../src/render/characters/woc_parts_core';
import { riggedWornFamilyFor } from '../src/render/worn_stone';

const publicFile = (url: string): Buffer =>
  readFileSync(path.resolve(__dirname, '..', 'public', url));

/** A GLB with every texture reference taken out of its JSON (the binary chunk as is). */
function withoutTextures(file: Buffer): ArrayBuffer {
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8'));
  delete json.textures;
  delete json.images;
  delete json.samplers;
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
  }
  const keep = (list?: string[]): string[] =>
    (list ?? []).filter((name) => name !== 'KHR_texture_basisu');
  json.extensionsUsed = keep(json.extensionsUsed);
  json.extensionsRequired = keep(json.extensionsRequired);
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const chunk = Buffer.from(text);
  const rest = file.subarray(20 + jsonLength);
  const out = Buffer.alloc(20 + chunk.length + rest.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(chunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(out, 20);
  rest.copy(out, 20 + chunk.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

async function parse(url: string) {
  await MeshoptDecoder.ready;
  return new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(withoutTextures(publicFile(url)), '');
}

const _direction = new THREE.Vector4();
const _world = new THREE.Matrix3();

/** Where a mesh draws vertex `i` (skinned as three's skinning chunk skins it). */
function drawnPosition(mesh: THREE.Mesh, i: number, out: THREE.Vector3): THREE.Vector3 {
  return mesh.getVertexPosition(i, out).applyMatrix4(mesh.matrixWorld);
}

/** The normal a mesh draws at vertex `i`: skinned by the skin matrix itself, as a
 *  direction, then through the inverse transpose of the mesh's world matrix. */
function drawnNormal(mesh: THREE.Mesh, i: number, out: THREE.Vector3): THREE.Vector3 {
  out.fromBufferAttribute(mesh.geometry.getAttribute('normal'), i);
  const skinned = mesh as THREE.SkinnedMesh;
  if (skinned.isSkinnedMesh) {
    skinned.applyBoneTransform(i, _direction.set(out.x, out.y, out.z, 0));
    out.set(_direction.x, _direction.y, _direction.z);
  }
  return out.applyMatrix3(_world.getNormalMatrix(mesh.matrixWorld)).normalize();
}

/** The clips a kit is posed by: a gait (its leg bones carry scale tracks), a two-handed
 *  swing (the shoulders and the head turn hard) and the death fall. */
const CLIPS = ['Run', '2H_Chop', 'Death'];

describe.each(['male', 'female'] as const)('the shipped %s armor sets, merged', (fit: WocFit) => {
  it('draw one mesh per file material, every vertex where its part draws it', async () => {
    const base = await parse(wocBaseUrl(fit));
    const anims = await parse(wocAnimsUrl(fit));
    // the base as assets.ts prepares it: one Skeleton for the rig, its whole palette kept
    shareRigSkeleton(base.scene);
    optimizeSkinGpuLayout(base.scene, { keepPalette: true });
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    // the nine class sets ship for each fit: a catalog that came back empty proves nothing
    expect(WOC_SHIPPED_SETS.length).toBeGreaterThanOrEqual(9);
    let twoBatchKits = 0;
    for (const set of WOC_SHIPPED_SETS) {
      const manifest = wocSetManifest(fit, set);
      if (!manifest) throw new Error(`${fit} ${set}: no manifest`);
      // the low tier: a tier changes a set's textures, never its meshes or materials
      const url = wocArmorPackUrl(fit, set, 'low');
      const kit = `${fit} ${set}`;
      ensureWocArmorPack(url);
      loads.pending.get(url)?.(await parse(url));
      await Promise.resolve();
      await Promise.resolve();
      const model = cloneSkinned(base.scene);
      shareRigSkeleton(model);
      expect(attachWocArmorPack(model, url, set, manifest), kit).not.toBeNull();
      applyWocPartVisibility(
        resolveWocPartNodes(model, manifest),
        manifest,
        wocVisibleParts(manifest, wocDefaultAppearance(manifest), wocDefaultWorn(manifest)),
      );
      const bind = wocArmorMergeBindOf(model);
      if (!bind) throw new Error(`${kit}: no rig`);
      const drawn = wocArmorDrawnParts(model);
      const plan = planWocArmorMerge(model, bind, drawn);
      if (!plan) throw new Error(`${kit}: nothing folds`);
      // a full kit is at least the seven meshes the 2026-10-02 measure counted...
      expect(drawn.length, kit).toBeGreaterThanOrEqual(7);
      // ...and folds to ONE draw per file material: every material two or more parts
      // share is one merged mesh, and a material with one part keeps its one mesh
      const folded = new Set(plan.sources);
      const draws = plan.batches.length + drawn.filter((c) => !folded.has(c.mesh)).length;
      expect(draws, kit).toBe(new Set(drawn.map((c) => c.material)).size);
      expect(draws, kit).toBeLessThan(drawn.length);
      const parts = plan.batches.flatMap((batch) => batch.parts);
      // the attach bound every skinned part to the body's own Skeleton in its bind: copied
      // as stored, nothing converted
      for (const part of parts.filter((p) => p.bone === null)) {
        expect((part.mesh as THREE.SkinnedMesh).skeleton, `${kit} ${part.mesh.name}`).toBe(
          bind.skeleton,
        );
        expect(part.toBind, `${kit} ${part.mesh.name}`).toBeNull();
        expect(part.joints, `${kit} ${part.mesh.name}`).toBeNull();
      }
      // the rigid parts (the shoulders, a helm) fold with the rest, each onto the bone its
      // wrapper hangs on
      const rigid = parts.filter((p) => p.bone !== null);
      expect(rigid.length, kit).toBeGreaterThanOrEqual(2);
      for (const part of rigid) {
        let bone: THREE.Object3D | null = part.mesh;
        while (bone && !(bone as THREE.Bone).isBone) bone = bone.parent;
        expect(bind.skeleton.bones[part.bone as number], `${kit} ${part.mesh.name}`).toBe(bone);
      }
      // ...on every graphics tier: no rigid part hangs with a material the tier derivation
      // gives the object-space worn layer (assets.ts buildTintedClone routes by NAME), the
      // one thing that keeps a rigid part out of a fold in game and not here
      for (const c of drawn.filter((c) => !(c.mesh as THREE.SkinnedMesh).isSkinnedMesh)) {
        expect(riggedWornFamilyFor(c.material.name), `${kit} ${c.mesh.name}`).toBeNull();
      }
      if (plan.batches.length > 1) twoBatchKits++;

      const merged = plan.batches.map((batch) => {
        const mesh = new THREE.SkinnedMesh(
          mergeWocArmorGeometry(batch.parts, bind.skeleton.bones.length),
          batch.material,
        );
        mesh.bind(bind.skeleton, bind.bindMatrix);
        model.add(mesh);
        return mesh;
      });
      const mixer = new THREE.AnimationMixer(model);
      let worstPosition = 0;
      let worstSkinnedNormal = 0;
      let worstRigidNormal = 0;
      for (const name of CLIPS) {
        const clip = anims.animations.find((c) => c.name === name);
        if (!clip) throw new Error(`${fit}: no clip ${name}`);
        const action = mixer.clipAction(clip);
        action.play();
        mixer.setTime(clip.duration * 0.37);
        model.position.set(3, 1, -2);
        model.rotation.set(0.1, 1.2, 0);
        model.scale.setScalar(1.3);
        model.updateMatrixWorld(true);
        for (const [n, batch] of plan.batches.entries()) {
          let at = 0;
          for (const part of batch.parts) {
            // three flips the front face of a mesh whose world matrix mirrors (a male left
            // shoulder is its right one under a negative scale): the fold flipped exactly
            // those parts' winding, and no skinned one's
            const mirrored =
              part.mesh.matrixWorld.determinant() < 0 !== merged[n].matrixWorld.determinant() < 0;
            expect(part.flip, `${kit} ${part.mesh.name} winding`).toBe(
              part.bone !== null && mirrored,
            );
            const count = part.mesh.geometry.getAttribute('position').count;
            for (let i = 0; i < count; i++) {
              worstPosition = Math.max(
                worstPosition,
                drawnPosition(merged[n], at + i, a).distanceTo(drawnPosition(part.mesh, i, b)),
              );
              const normal = drawnNormal(merged[n], at + i, a).distanceTo(
                drawnNormal(part.mesh, i, b),
              );
              if (part.bone === null) worstSkinnedNormal = Math.max(worstSkinnedNormal, normal);
              else worstRigidNormal = Math.max(worstRigidNormal, normal);
            }
            at += count;
          }
          expect(merged[n].geometry.getAttribute('position').count, kit).toBe(at);
        }
        action.stop();
      }
      // every part keeps its own triangles in the merged buffer, offset to where its
      // vertices landed, a flipped part's with its winding turned, and nothing more
      for (const [n, batch] of plan.batches.entries()) {
        const want: number[] = [];
        let at = 0;
        for (const part of batch.parts) {
          const own = part.mesh.geometry.index;
          if (!own) throw new Error(`${kit} ${part.mesh.name}: no index`);
          for (let k = 0; k < own.count; k += 3) {
            const [i, j, l] = [own.getX(k), own.getX(k + 1), own.getX(k + 2)];
            want.push(at + i, at + (part.flip ? l : j), at + (part.flip ? j : l));
          }
          at += part.mesh.geometry.getAttribute('position').count;
        }
        const index = merged[n].geometry.index;
        expect(index?.count, `${kit} batch ${n} triangles`).toBe(want.length);
        expect([...(index?.array ?? [])], `${kit} batch ${n} triangles`).toEqual(want);
      }
      // a character stands about 1.2 units tall: float rounding, nothing more
      expect(worstPosition, `${kit} position`).toBeLessThan(1e-6);
      // a skinned part's normals are the very numbers its own mesh skins
      expect(worstSkinnedNormal, `${kit} skinned normal`).toBe(0);
      // a rigid part's differ only by what the library's quantized rotations (not quite
      // unit quaternions) put between a skin matrix and its inverse transpose: far under
      // anything a pixel can show
      expect(worstRigidNormal, `${kit} rigid normal`).toBeLessThan(1e-4);
    }
    // some kits carry two materials with parts to fold: more than one merged mesh is real
    expect(twoBatchKits).toBeGreaterThan(0);
  }, 120_000);
});
