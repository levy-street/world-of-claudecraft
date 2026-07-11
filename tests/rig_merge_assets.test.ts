// The rig merge is only sound because of a property of the SHIPPED character
// GLBs: every body part carries its own `skin` (its own inverseBindMatrices),
// but those differ from any canonical part by ONE constant transform T -- the
// per-primitive dequantization the `KHR_mesh_quantization` pipeline bakes in.
//
// This test reads the real committed GLBs and pins that property. If an artist
// re-exports a rig with genuinely different per-bone bind poses, this fails and
// tells us the merge would silently skip that rig (rig_merge.ts refuses to merge
// parts it cannot prove safe, so the game stays correct -- it just gets slower).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { REBIND_EPS, solveRebindTransform } from '../src/render/characters/rig_merge';

interface Glb {
  json: Record<string, any>;
  bin: Uint8Array;
}

function readGlb(path: string): Glb {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 12; // magic, version, length
  let json: Record<string, any> | null = null;
  let bin: Uint8Array | null = null;
  while (off < buf.byteLength) {
    const chunkLen = dv.getUint32(off, true);
    const chunkType = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (chunkType === 0x4e4f534a)
      json = JSON.parse(new TextDecoder().decode(buf.subarray(start, start + chunkLen)));
    else if (chunkType === 0x004e4942) bin = buf.subarray(start, start + chunkLen);
    off = start + chunkLen;
  }
  if (!json || !bin) throw new Error(`bad glb: ${path}`);
  return { json, bin };
}

/** Raw bytes of a bufferView, transparently decoding EXT_meshopt_compression. */
function bufferViewBytes(glb: Glb, index: number): Uint8Array {
  const bv = glb.json.bufferViews[index];
  const meshopt = bv.extensions?.EXT_meshopt_compression;
  if (!meshopt) {
    const start = bv.byteOffset ?? 0;
    return glb.bin.subarray(start, start + bv.byteLength);
  }
  const source = glb.bin.subarray(
    meshopt.byteOffset ?? 0,
    (meshopt.byteOffset ?? 0) + meshopt.byteLength,
  );
  const out = new Uint8Array(meshopt.count * meshopt.byteStride);
  MeshoptDecoder.decodeGltfBuffer(
    out,
    meshopt.count,
    meshopt.byteStride,
    source,
    meshopt.mode,
    meshopt.filter,
  );
  return out;
}

/** The inverse bind matrices of `skin`, as THREE.Matrix4 (glTF stores column-major). */
function inverseBindMatrices(glb: Glb, skinIndex: number): THREE.Matrix4[] {
  const skin = glb.json.skins[skinIndex];
  const acc = glb.json.accessors[skin.inverseBindMatrices];
  const bytes = bufferViewBytes(glb, acc.bufferView);
  const base = acc.byteOffset ?? 0;
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset + base, acc.count * 16);
  const out: THREE.Matrix4[] = [];
  for (let i = 0; i < acc.count; i++) {
    const m = new THREE.Matrix4();
    m.fromArray(floats, i * 16); // fromArray reads column-major, which is glTF's layout
    out.push(m);
  }
  return out;
}

// `optimizedScene` runs the merge per URL, so EVERY multi-skin character asset
// goes through it, not just the player classes. The skeleton mobs are the ones
// that actually fill a dungeon crowd, so they are exactly what the saving is for
// and exactly what a bad re-export would silently switch off.
const RIGS = [
  'players/barbarian',
  'players/druid',
  'players/knight',
  'players/mage',
  'players/paladin',
  'players/ranger',
  'players/rogue',
  'players/rogue_hooded',
  'enemies/necromancer',
  'enemies/skeleton_golem',
  'enemies/skeleton_mage',
  'enemies/skeleton_minion',
  'enemies/skeleton_rogue',
  'enemies/skeleton_warrior',
];

describe('shipped character rigs satisfy the single-transform rebind law', () => {
  beforeAll(async () => {
    await MeshoptDecoder.ready;
  });

  it.each(RIGS)('%s: every skin rebinds onto the canonical one', (name) => {
    const glb = readGlb(`public/models/chars/${name}.glb`);
    const skins: any[] = glb.json.skins ?? [];
    expect(skins.length).toBeGreaterThan(1); // otherwise there is nothing to merge

    // Every part rides the SAME joints, in the same order: a precondition of sharing
    // one skeleton at all.
    const joints0: number[] = skins[0].joints;
    for (const s of skins) expect(s.joints).toEqual(joints0);

    const canon = inverseBindMatrices(glb, 0);
    expect(canon.length).toBe(joints0.length);

    let distinctBindData = 0;
    for (let i = 1; i < skins.length; i++) {
      const part = inverseBindMatrices(glb, i);
      const t = solveRebindTransform(canon, part);
      expect(t, `${name} skin ${i} has bind data no single transform explains`).not.toBeNull();

      // measure the residual explicitly, so a drift toward the tolerance is visible
      let maxErr = 0;
      const probe = new THREE.Matrix4();
      for (let b = 0; b < canon.length; b++) {
        probe.copy(canon[b]).multiply(t as THREE.Matrix4);
        for (let k = 0; k < 16; k++)
          maxErr = Math.max(maxErr, Math.abs(probe.elements[k] - part[b].elements[k]));
      }
      expect(maxErr, `${name} skin ${i} residual`).toBeLessThan(REBIND_EPS);

      // and confirm these really ARE different bind data (else the test proves nothing)
      let differs = false;
      for (let b = 0; b < canon.length && !differs; b++)
        for (let k = 0; k < 16; k++)
          if (Math.abs(canon[b].elements[k] - part[b].elements[k]) > 1e-6) {
            differs = true;
            break;
          }
      if (differs) distinctBindData++;
    }
    // The whole point: the parts DO carry per-primitive bind data (that is why the
    // naive equality check never merged them).
    expect(distinctBindData).toBeGreaterThan(0);
  });

  // rig_merge refuses to merge a part with morph targets (the rebake would drop
  // them silently), so a rig that grows one quietly loses the saving. No shipped
  // rig has any today: this is the canary that tells us the day one does.
  it.each(RIGS)('%s: carries no morph targets, so nothing blocks the merge', (name) => {
    const glb = readGlb(`public/models/chars/${name}.glb`);
    const prims = (glb.json.meshes ?? []).flatMap((m: any) => m.primitives ?? []);
    expect(prims.length).toBeGreaterThan(0);
    expect(prims.filter((p: any) => p.targets?.length).length).toBe(0);
  });
});
