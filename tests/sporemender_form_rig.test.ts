// Sporemender Form's rig contract: the shoulder shelves ride their own level bones in every
// clip, and the clips are timed to the form's slower move speed.
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { SPOREMENDER_MOVE_SPEED_MULT } from '../src/sim/combat/druid_sporemender';
import { RUN_SPEED } from '../src/sim/types';

interface GltfJson {
  nodes: { name?: string }[];
  skins: { joints: number[]; inverseBindMatrices: number }[];
  animations: { name: string; channels: { target: { node: number; path: string } }[] }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
}

const FLOAT = 5126;
const COMPONENT_BYTES: Record<number, number> = { 5121: 1, 5123: 2, 5126: 4 };

/** A binary glTF split into its JSON chunk and its binary chunk. */
function readGlb(path: string): { json: GltfJson; bin: Buffer } {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  return {
    json: JSON.parse(bytes.toString('utf8', 20, 20 + length)) as GltfJson,
    bin: bytes.subarray(20 + length + 8),
  };
}

/** One accessor as rows of `size` numbers. */
function readRows({ json, bin }: ReturnType<typeof readGlb>, index: number, size: number) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const width = COMPONENT_BYTES[accessor.componentType];
  const stride = view.byteStride ?? width * size;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const rows: number[][] = [];
  for (let i = 0; i < accessor.count; i++) {
    const row: number[] = [];
    for (let k = 0; k < size; k++) {
      const at = start + i * stride + k * width;
      if (accessor.componentType === FLOAT) row.push(bin.readFloatLE(at));
      else row.push(width === 2 ? bin.readUInt16LE(at) : bin.readUInt8(at));
    }
    rows.push(row);
  }
  return rows;
}

describe('Sporemender Form rig', () => {
  const glb = readGlb('public/models/creatures/sporemender_form.glb');
  const gltf = glb.json;
  const shelves = ['L_ShoulderShelf', 'R_ShoulderShelf'].map((name) =>
    gltf.nodes.findIndex((node) => node.name === name),
  );

  it('keeps everything past the elbow off the upper arm, or the arm cannot bend', () => {
    const [skin] = gltf.skins;
    const jointNames = skin.joints.map((node) => gltf.nodes[node].name ?? '');
    const { attributes } = gltf.meshes[0].primitives[0];
    const positions = readRows(glb, attributes.POSITION, 3);
    const joints = readRows(glb, attributes.JOINTS_0, 4);
    const weights = readRows(glb, attributes.WEIGHTS_0, 4);
    const inverseBind = readRows(glb, skin.inverseBindMatrices, 16);
    const bindAt = (name: string) =>
      new Vector3()
        .setFromMatrixPosition(
          new Matrix4().fromArray(inverseBind[jointNames.indexOf(name)]).invert(),
        )
        .toArray();
    const ARM_FLOOR = 0.47;
    const BLEND = 0.041;
    for (const side of ['L', 'R']) {
      const elbow = bindAt(`${side}_Forearm`);
      const hand = bindAt(`${side}_Hand`);
      const span = [hand[0] - elbow[0], hand[1] - elbow[1], hand[2] - elbow[2]];
      const length = Math.hypot(...span);
      let pastElbow = 0;
      let onUpperArm = 0;
      positions.forEach((p, v) => {
        if (Math.sign(p[2]) !== Math.sign(hand[2]) || p[1] < ARM_FLOOR) return;
        const past =
          ((p[0] - elbow[0]) * span[0] +
            (p[1] - elbow[1]) * span[1] +
            (p[2] - elbow[2]) * span[2]) /
          length;
        if (past <= BLEND) return;
        pastElbow++;
        joints[v].forEach((joint, k) => {
          if (weights[v][k] > 0 && jointNames[joint].startsWith(`${side}_Upperarm`)) onUpperArm++;
        });
      });
      expect(pastElbow, `${side} arm verts past the elbow`).toBeGreaterThan(100);
      expect(onUpperArm, `${side} arm verts past the elbow on the upper arm`).toBe(0);
    }
  });

  it('skins a shelf bone on each shoulder', () => {
    for (const node of shelves) {
      expect(node).toBeGreaterThanOrEqual(0);
      expect(gltf.skins[0].joints).toContain(node);
    }
  });

  it('keys both shelf bones in every clip, or they would tip with the arm', () => {
    expect(gltf.animations.map((clip) => clip.name).sort()).toEqual(
      ['Cast', 'Death', 'Hit', 'Idle', 'Run', 'Walk'].sort(),
    );
    for (const clip of gltf.animations) {
      for (const node of shelves) {
        expect(
          clip.channels.some((c) => c.target.node === node && c.target.path === 'rotation'),
          `${clip.name} keys ${gltf.nodes[node].name}`,
        ).toBe(true);
      }
    }
  });

  it('plays Run slower than authored at the form speed, inside the cadence floor', () => {
    const { runRef, walkRef } = VISUALS.form_sporemender;
    expect(runRef).toBeDefined();
    expect(walkRef).toBeDefined();
    const rate = (RUN_SPEED * SPOREMENDER_MOVE_SPEED_MULT) / (runRef ?? 1);
    expect(rate).toBeCloseTo(0.84, 2);
  });
});
