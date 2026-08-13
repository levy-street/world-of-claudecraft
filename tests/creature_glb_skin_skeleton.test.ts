// The two authored kobold-line bodies must ship VALID skinned GLBs: for every
// skin, the `skeleton` node (when set) must be a common root, an ancestor-or-self
// of every joint. glTF validators flag the violation as SKIN_SKELETON_INVALID.
//
// This shipped broken once, and the cause is worth pinning: three's GLTFExporter
// writes skin.skeleton from skeleton.bones[0], i.e. whatever bone the SOURCE FBX
// happened to bind first. The kobold's v02 T-pose FBX listed mixamorigRightHand
// first, so the shipped skeleton pointer named a hand while 21 of 22 joints sat
// outside its subtree. Nothing in this repo renders wrong from that (three
// ignores skin.skeleton on load and rebuilds from joints + inverse bind
// matrices), which is exactly why only a validator caught it, and why a rebuild
// from a new artist drop can silently reintroduce it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

interface GltfNode {
  name?: string;
  children?: number[];
}
interface GltfSkin {
  joints: number[];
  skeleton?: number;
}
interface GltfDoc {
  nodes?: GltfNode[];
  skins?: GltfSkin[];
}

function glbJson(relPath: string): GltfDoc {
  const glb = readFileSync(join(ROOT, relPath));
  const jsonLen = glb.readUInt32LE(12);
  return JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
}

const CREATURE_GLBS = ['public/models/creatures/kobold.glb', 'public/models/creatures/grix.glb'];

describe.each(CREATURE_GLBS)('%s skin skeleton', (relPath) => {
  it('points skin.skeleton at a common root of every joint', () => {
    const doc = glbJson(relPath);
    const nodes = doc.nodes ?? [];
    const parentOf = (idx: number) => nodes.findIndex((n) => (n.children ?? []).includes(idx));
    const isAncestorOrSelf = (anc: number, idx: number) => {
      for (let cur = idx; cur !== -1; cur = parentOf(cur)) if (cur === anc) return true;
      return false;
    };
    expect(doc.skins?.length, 'ships exactly one skin').toBe(1);
    for (const skin of doc.skins ?? []) {
      // skeleton is optional in glTF; only a WRONG value is a defect. But these
      // two assets deliberately keep it set (their siblings all do), so treat a
      // dropped field as drift too.
      expect(skin.skeleton, 'skin.skeleton is set').toBeDefined();
      const orphans = skin.joints
        .filter((j) => !isAncestorOrSelf(skin.skeleton as number, j))
        .map((j) => nodes[j]?.name ?? `#${j}`);
      expect(orphans, `joints outside the skeleton subtree of ${relPath}`).toEqual([]);
    }
  });
});
