// The Smith's Quarry's three colossi (public/models/props/smith_heart_hammer_colossi.glb, its
// spec scripts/assets/specs/smith_heart_hammer_colossi.json): Tripo P2 statues from the vein's
// turnaround sheets, painted from them and recoloured to the vein's cliffs
// (scripts/assets/smith_heart_hammer_colossi/), baked by the painted kit's loader
// (hammer_env_kit.ts) and swapped in for the old kit's colossi on their exact spots
// (hammer_env_plan_core.ts KIT_SWAPS). Pinned: the file (three Env_ nodes, one 1024 ETC1S
// painting each, budgets, no name shared with the main kit), each statue's frame (its height,
// sunk a yard, footprint centred, facing +z), nothing of it over a walked floor once placed,
// and the swap with its fallback.
import { readFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { hammerEnvSwap } from '../src/render/smith_heart/hammer_env_plan_core';
import {
  HAMMER_COLOSSI,
  isQuarryStep,
  planHammerKit,
} from '../src/render/smith_heart/hammer_kit_plan_core';
import { SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const GLB = 'public/models/props/smith_heart_hammer_colossi.glb';
const KIT_GLB = 'public/models/props/smith_heart_hammer_env_kit.glb';

/** Each statue, the old colossus it stands in for, its height (the kneeling pair the old
 *  pieces' own; the Waking smith stands, as tall as the Bearer, where the old Waking heaved
 *  himself out of the step at 23), and which way its depth leans (`profile`, below). */
const STATUES = [
  { node: 'Env_ColossusKeeper', old: 'Kit_ColossusVigil', height: 28.8, profile: -1 },
  { node: 'Env_ColossusWaking', old: 'Kit_ColossusWaking', height: 29, profile: -1 },
  { node: 'Env_ColossusBearer', old: 'Kit_ColossusBearer', height: 29, profile: 1 },
];

interface Statue {
  min: number[];
  max: number[];
  tris: number;
  materials: string[];
  maps: number;
  /** Every third vertex in the statue's frame, for the placed checks. */
  points: number[][];
}
const statues = new Map<string, Statue>();
const ktx2: { width: number; height: number; scheme: number }[] = [];

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(GLB)));
  for (const texture of doc.getRoot().listTextures()) {
    const b = texture.getImage();
    if (!b) continue;
    // A KTX2 header: pixel width and height at bytes 20 and 24, supercompression at 44
    // (1 is BasisLZ, the ETC1S codec; 2 is zstd, UASTC).
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    ktx2.push({
      width: view.getUint32(20, true),
      height: view.getUint32(24, true),
      scheme: view.getUint32(44, true),
    });
  }
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let tris = 0;
    let maps = 0;
    const materials: string[] = [];
    const points: number[][] = [];
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      if (material) {
        materials.push(material.getName());
        maps += [
          material.getNormalTexture(),
          material.getMetallicRoughnessTexture(),
          material.getOcclusionTexture(),
          material.getEmissiveTexture(),
        ].filter(Boolean).length;
      }
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      tris += (prim.getIndices()?.getCount() ?? a.getCount()) / 3;
      const e: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        const w = [
          m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
        ];
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], w[k]);
          max[k] = Math.max(max[k], w[k]);
        }
        if (i % 3 === 0) points.push(w);
      }
    }
    statues.set(node.getName(), { min, max, tris, materials, maps, points });
  }
});

describe('the Quarry colossi as shipped', () => {
  it('ships the three statues, each one 1024 ETC1S painting and nothing else', () => {
    expect([...statues.keys()].sort()).toEqual(STATUES.map((s) => s.node).sort());
    for (const { node } of STATUES) {
      const s = statues.get(node);
      // One painting a statue, named off its node: no tripo_ prefix, so the base colour
      // takes the smaller ETC1S codec (scripts/assets/lib/glb_texture_compression_core.mjs).
      const painting = `env_colossus_${node.replace('Env_Colossus', '').toLowerCase()}`;
      expect(s?.materials, node).toEqual([painting]);
      expect(s?.maps, node).toBe(0);
    }
    expect(ktx2).toHaveLength(3);
    for (const t of ktx2) {
      expect([t.width, t.height]).toEqual([1024, 1024]);
      expect(t.scheme).toBe(1);
    }
  });

  it('keeps within its budgets', () => {
    for (const { node } of STATUES)
      expect(statues.get(node)?.tris, node).toBeLessThanOrEqual(12500);
    // Three 1024 ETC1S paintings (about 0.6 MB) and about 36k triangles of meshopt geometry.
    expect(statSync(GLB).size).toBeLessThanOrEqual(1_250_000);
    // Preloaded through the media manifest like every shipped file.
    expect(MEDIA_ASSETS['models/props/smith_heart_hammer_colossi.glb']).toBeDefined();
    // The loader fetches exactly this file.
    const loader = readFileSync('src/render/smith_heart/hammer_env_kit.ts', 'utf8');
    expect(loader).toContain(
      "SMITH_HEART_HAMMER_COLOSSI_URL = '/models/props/smith_heart_hammer_colossi.glb'",
    );
  });

  it('stands each statue in its frame: its height, sunk a yard, centred, facing +z', () => {
    for (const { node, height, profile } of STATUES) {
      const s = statues.get(node);
      if (!s) throw new Error(`${node} missing`);
      expect(s.max[1] - s.min[1], node).toBeCloseTo(height, 0);
      // Sunk a yard into its step.
      expect(s.min[1], node).toBeCloseTo(-1, 1);
      expect(Math.abs((s.min[0] + s.max[0]) / 2), node).toBeLessThan(0.5);
      expect(Math.abs((s.min[2] + s.max[2]) / 2), node).toBeLessThan(0.5);
      // Which way it faces, off the shipped mesh: the middle of its depth band by band up
      // its height, summed. The Keeper's and the Waking smith's bodies sit back of their
      // footprints' middle, the Bearer's bowed head and anvil reach out over his; a statue
      // turned half round flips the sign. A rebuild re-measures it.
      let lean = 0;
      for (let b = 0; b < 10; b++) {
        const lo = s.min[1] + (b / 10) * (s.max[1] - s.min[1]);
        const hi = s.min[1] + ((b + 1) / 10) * (s.max[1] - s.min[1]);
        const zs = s.points.filter((p) => p[1] >= lo && p[1] <= hi).map((p) => p[2]);
        lean += (Math.min(...zs) + Math.max(...zs)) / 2;
      }
      expect(lean * profile, node).toBeGreaterThan(3);
    }
    // The Waking smith's block and the Bearer's anvil are wider than they are deep: a statue
    // turned a quarter off +z would show it here.
    for (const node of ['Env_ColossusWaking', 'Env_ColossusBearer']) {
      const s = statues.get(node);
      if (!s) throw new Error(`${node} missing`);
      expect(s.max[0] - s.min[0], node).toBeGreaterThan(s.max[2] - s.min[2] + 3);
    }
  });

  it('shares no piece name with the main painted kit', () => {
    // Both files bake into one table, first come first kept: a shared name would draw
    // whichever landed first.
    const glb = readFileSync(KIT_GLB);
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
    const names = new Set((json.nodes as { name?: string }[]).map((n) => n.name));
    for (const { node } of STATUES) expect(names.has(node), node).toBe(false);
  });
});

describe('the colossi placed', () => {
  it('hangs nothing over a walked floor', () => {
    // Every statue vertex on its real spot: the terraces it kneels on are dressing floors
    // nobody reaches, and nothing of it reaches out over the pit or a walk at any height
    // (the old Waking hung over the pit floor).
    const { swap } = hammerEnvSwap(planHammerKit());
    const placed = swap.filter((q) => q.piece.startsWith('Env_Colossus'));
    expect(placed.length).toBeGreaterThanOrEqual(STATUES.length);
    /** The first point of a statue over a walked floor, with it pushed `ahead` yards on. */
    const overWalk = (p: (typeof placed)[number], ahead: number): string | null => {
      const s = statues.get(p.piece);
      if (!s) throw new Error(`${p.piece} missing`);
      const c = Math.cos(p.rot);
      const n = Math.sin(p.rot);
      const k = p.scale ?? 1;
      for (const [lx, , lz] of s.points) {
        const x = p.x + (lx * c + (lz + ahead) * n) * k;
        const z = p.z + (-lx * n + (lz + ahead) * c) * k;
        const surface = authoredFieldSurfaceAt(SMITH_HEART_FIELD, x, z);
        if (surface && !isQuarryStep(surface.id))
          return `${p.piece} over ${surface.id} at (${x.toFixed(1)}, ${z.toFixed(1)})`;
      }
      return null;
    };
    expect(placed.map((p) => overWalk(p, 0)).filter(Boolean)).toEqual([]);
    // The check can see one: the same statue pushed a dozen yards toward the pit hangs over
    // its floor (its front faces the pit, so the push is along its own +z).
    for (const p of placed) {
      const over = overWalk(p, 12);
      expect(over, p.piece).not.toBeNull();
      const at = /at \((-?[\d.]+), (-?[\d.]+)\)/.exec(over ?? '');
      expect(authoredFieldHeight(SMITH_HEART_FIELD, Number(at?.[1]), Number(at?.[2]))).toBeTypeOf(
        'number',
      );
    }
  });
});

describe('the colossi swap', () => {
  const plan = planHammerKit();

  it('stands each statue exactly where its old colossus knelt', () => {
    const { keep, swap } = hammerEnvSwap(plan);
    expect([...HAMMER_COLOSSI].sort()).toEqual(STATUES.map((s) => s.old).sort());
    for (const { node, old } of STATUES) {
      const was = plan.filter((p) => p.piece === old);
      expect(was.length, old).toBeGreaterThan(0);
      expect(
        keep.some((p) => p.piece === old),
        old,
      ).toBe(false);
      expect(swap.filter((p) => p.piece === node)).toEqual(was.map((p) => ({ ...p, piece: node })));
    }
  });

  it('keeps the old colossi when their kit has not landed, and nothing else changes', () => {
    const all = hammerEnvSwap(plan);
    const noColossi = hammerEnvSwap(plan, (piece) => !piece.startsWith('Env_Colossus'));
    for (const { node, old } of STATUES) {
      expect(
        noColossi.swap.some((p) => p.piece === node),
        node,
      ).toBe(false);
      expect(noColossi.keep.filter((p) => p.piece === old)).toEqual(
        plan.filter((p) => p.piece === old),
      );
    }
    const others = (list: typeof all.swap) =>
      list.filter((p) => !p.piece.startsWith('Env_Colossus'));
    expect(others(noColossi.swap)).toEqual(others(all.swap));
  });
});
