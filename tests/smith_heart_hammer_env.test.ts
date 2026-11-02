// The Hammer vein's painted rebuild (design doc section 5.22): the shipped kit, what
// stands in for what, and the promise the owner set: the look only, nothing tied to a
// mechanic touched. Every plan rule here is against the same layout the sim reads.
import { existsSync, readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  fitHammerEnvLip,
  fitHammerEnvNeedle,
  fitHammerEnvRock,
  HAMMER_ENV_ARCADE,
  HAMMER_ENV_DEPTH,
  HAMMER_ENV_FROZEN,
  HAMMER_ENV_PAVED,
  HAMMER_ENV_QUENCH_SOUTH,
  HAMMER_ENV_ROCK,
  HAMMER_ENV_TREAD,
  hammerEnvDepth,
  hammerEnvDepthGlsl,
  hammerEnvFrontClear,
  hammerEnvNewSolids,
  hammerEnvOwnsRock,
  hammerEnvPathUv,
  hammerEnvRockPiece,
  hammerEnvSwap,
  hammerEnvWalkedHeight,
  hammerEnvWeight,
  hammerEnvWeightGlsl,
  planHammerEnvArena,
  planHammerEnvBraziers,
  planHammerEnvGallery,
  planHammerEnvStairs,
  planHammerEnvWalkLayer,
} from '../src/render/smith_heart/hammer_env_plan_core';
import { planHammerKit } from '../src/render/smith_heart/hammer_kit_plan_core';
import {
  HEART_ROCK_FAR_PAINT,
  heartRockHammerDepthGlsl,
  heartRockHammerGlsl,
} from '../src/render/smith_heart/heart_rock_cutaway';
import {
  heartRockPieceOf,
  planHeartLips,
  planHeartNeedles,
  planHeartRock,
  planHeartUnderCliffs,
} from '../src/render/smith_heart/heart_rock_plan_core';
import {
  GALLERY_LANDINGS,
  HAMMER_PIT,
  HEART_ROOM,
  HEART_ROOM_AREA_R,
  QUARRY_TERRACES,
  QUENCH,
  RING,
  SMITH_HEART_FIELD,
  smithHeartAreaAt,
} from '../src/sim/content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const KIT = 'public/models/props/smith_heart_hammer_env_kit.glb';
const F = SMITH_HEART_FIELD;

interface Shape {
  min: number[];
  max: number[];
  tris: number;
}
const shapes = new Map<string, Shape>();
const textureSizes = new Map<string, [number, number]>();
const mimes = new Set<string>();

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(KIT)));
  for (const texture of doc.getRoot().listTextures()) {
    mimes.add(texture.getMimeType());
    const b = texture.getImage();
    if (!b) continue;
    // A KTX2 header's pixel width and height, little endian, at bytes 20 and 24.
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    textureSizes.set(texture.getName() || texture.getURI(), [
      view.getUint32(20, true),
      view.getUint32(24, true),
    ]);
  }
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (!/^(Env|Tex)_/.test(name)) continue;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let tris = 0;
    const visit = (n: typeof node): void => {
      const m = n.getWorldMatrix();
      for (const prim of n.getMesh()?.listPrimitives() ?? []) {
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
        }
      }
      for (const c of n.listChildren()) visit(c);
    };
    visit(node);
    shapes.set(name, { min, max, tris });
  }
});

describe('the painted kit as shipped', () => {
  it('ships, in KTX2, nothing past 1024', () => {
    expect(existsSync(KIT)).toBe(true);
    expect([...mimes]).toEqual(['image/ktx2']);
    expect(textureSizes.size).toBeGreaterThanOrEqual(13);
    for (const [name, [w, h]] of textureSizes) {
      expect(w, name).toBeLessThanOrEqual(1024);
      expect(h, name).toBeLessThanOrEqual(1024);
    }
    // Backgrounds take less than what the eye stands next to.
    const areas = [...textureSizes.values()].map(([w, h]) => w * h);
    expect(areas.filter((a) => a <= 512 * 512).length).toBeGreaterThanOrEqual(6);
  });

  it('holds every piece the plans place, at the measures the plan fits', () => {
    const placed = new Set(
      [
        ...hammerEnvNewSolids(),
        ...hammerEnvSwap(planHammerKit()).swap,
        ...planHeartRock().filter(hammerEnvOwnsRock).map(fitHammerEnvRock),
        ...planHeartLips().filter(hammerEnvOwnsRock).map(fitHammerEnvLip),
        ...planHeartNeedles().filter(hammerEnvOwnsRock).map(fitHammerEnvNeedle),
      ].map((p) => p.piece),
    );
    expect(placed.size).toBeGreaterThan(15);
    for (const piece of placed) expect(shapes.has(piece), piece).toBe(true);
    const measures = { ...HAMMER_ENV_ROCK, Env_Arcade: HAMMER_ENV_ARCADE };
    for (const [piece, m] of Object.entries(measures)) {
      const s = shapes.get(piece);
      if (!s) throw new Error(`no ${piece}`);
      expect(s.max[0] - s.min[0], `${piece} width`).toBeCloseTo(m.w, 0);
      expect(s.max[1] - s.min[1], `${piece} height`).toBeCloseTo(m.h, 0);
      expect(s.max[2] - s.min[2], `${piece} depth`).toBeCloseTo(m.d, 0);
      // Foot on the ground, front plane at z 0, the body behind it.
      expect(s.min[1]).toBeCloseTo(0, 1);
      expect(s.max[2]).toBeCloseTo(0, 1);
    }
  });

  it('stays cheap: the paint carries the look, not the triangles', () => {
    const tris = (p: string) => shapes.get(p)?.tris ?? Infinity;
    for (const p of ['Env_CliffTall', 'Env_CliffWide', 'Env_Outcrop'])
      expect(tris(p), p).toBeLessThanOrEqual(2900);
    for (const p of ['Env_CliffTallFar', 'Env_CliffWideFar', 'Env_OutcropFar'])
      expect(tris(p), p).toBeLessThanOrEqual(1300);
    // A tenth of what these stood in for (2,350, 2,000, 2,180 and 520).
    expect(tris('Env_TierA')).toBeLessThan(500);
    expect(tris('Env_RimA')).toBeLessThan(300);
    expect(tris('Env_ChainRail')).toBeLessThan(500);
    expect(tris('Env_KerbA')).toBeLessThan(100);
  });

  it('keeps the edge modules on the old lip frame: no kerb over a walk, no rail on it', () => {
    const kerb = shapes.get('Env_KerbA');
    const rail = shapes.get('Env_ChainRail');
    const rim = shapes.get('Env_RimA');
    if (!kerb || !rail || !rim) throw new Error('no edge modules');
    // Toward the walk is -Z. A hand's height over it, never out past the lip.
    expect(kerb.max[1]).toBeLessThan(0.4);
    expect(kerb.max[2]).toBeLessThan(0.1);
    // A rail stands wholly past the lip, over the drop.
    expect(rail.min[2]).toBeGreaterThan(0.25);
    expect(rail.max[2]).toBeLessThanOrEqual(1.05);
    // A rim never stands proud of the pit's floor (the plan insets it 0.22).
    expect(rim.max[2]).toBeLessThan(0.45);
  });
});

describe('the look only: what a mechanic hangs on stays', () => {
  const plan = planHammerKit();
  const { keep, swap } = hammerEnvSwap(plan);

  it('never swaps or drops a frozen piece, and keeps it exactly where it stood', () => {
    expect([...HAMMER_ENV_FROZEN].sort()).toEqual([
      'Kit_CollapseOverhang',
      'Kit_ColossusBearer',
      'Kit_ColossusVigil',
      'Kit_ColossusWaking',
      'Kit_PitColumnSocket',
      'Kit_SlabFrame',
    ]);
    for (const name of HAMMER_ENV_FROZEN) {
      const before = plan.filter((p) => p.piece === name);
      expect(before.length, name).toBeGreaterThan(0);
      expect(keep.filter((p) => p.piece === name)).toEqual(before);
      expect(swap.some((p) => p.piece === name)).toBe(false);
    }
    // Only Kit_* pieces stay the old kit's, only Env_* pieces draw painted.
    expect(keep.every((p) => p.piece.startsWith('Kit_'))).toBe(true);
    expect(swap.every((p) => p.piece.startsWith('Env_'))).toBe(true);
  });

  it('keeps the chips at the pillars and off the Gallery', () => {
    const chips = plan.filter((p) => p.piece === 'Kit_ChipScatter');
    const kept = keep.filter((p) => p.piece === 'Kit_ChipScatter');
    expect(kept.length).toBe(5);
    expect(chips.length).toBeGreaterThan(kept.length);
    for (const p of kept) expect(authoredFieldSurfaceAt(F, p.x, p.z)?.id).toBe('hammer_pit');
  });

  it('stands every swapped piece on its old placement', () => {
    const moved = plan.filter((p) => !keep.includes(p));
    const spots = new Set(moved.map((p) => `${p.x}|${p.y}|${p.z}|${p.rot}`));
    expect(swap.length).toBeGreaterThan(100);
    for (const p of swap) expect(spots.has(`${p.x}|${p.y}|${p.z}|${p.rot}`)).toBe(true);
    // The aisles are rare: seats, not a wall of stairs.
    const tiers = swap.filter((p) => p.piece.startsWith('Env_Tier'));
    expect(tiers.filter((p) => p.piece === 'Env_TierB').length).toBeGreaterThan(0);
    expect(tiers.filter((p) => p.piece === 'Env_TierB').length).toBeLessThan(tiers.length / 5);
  });

  it('draws the paved floors apart from the layout, whose grounds stay as they were', () => {
    for (const id of HAMMER_ENV_PAVED) {
      const s = F.surfaces.find((x) => x.id === id);
      expect(s, id).toBeTruthy();
      expect(s?.ground, id).toBe('slate');
    }
  });
});

describe('the painted mountain', () => {
  const rock = [...planHeartRock(), ...planHeartUnderCliffs()].filter(hammerEnvOwnsRock);

  it('takes the vein and the skyline facing it, and no wall facing another walk', () => {
    expect(rock.length).toBeGreaterThan(150);
    const all = [...planHeartRock(), ...planHeartLips(), ...planHeartNeedles()];
    const past = all.filter((p) => hammerEnvOwnsRock(p) && smithHeartAreaAt(p.x, p.z) !== 'hammer');
    // The skyline over the arena's east terraces stands past the Quench's line.
    expect(past.filter((p) => smithHeartAreaAt(p.x, p.z) === 'quench').length).toBeGreaterThan(10);
    for (const p of all) {
      if (smithHeartAreaAt(p.x, p.z) === 'hammer') expect(hammerEnvOwnsRock(p)).toBe(true);
      if (smithHeartAreaAt(p.x, p.z) === 'heart') expect(hammerEnvOwnsRock(p)).toBe(false);
    }
    // A wall standing at the Quench's own walks keeps its frost.
    const nearLake = planHeartRock().filter(
      (p) => Math.hypot(p.x - QUENCH.lake.x, p.z - QUENCH.lake.z) < 90,
    );
    expect(nearLake.length).toBeGreaterThan(5);
    for (const p of nearLake) expect(hammerEnvOwnsRock(p)).toBe(false);
  });

  it('never stands a front on a walk, and keeps each spot, foot and height', () => {
    const bad: string[] = [];
    for (const old of rock) {
      const p = fitHammerEnvRock(old);
      const m = HAMMER_ENV_ROCK[p.piece.replace(/Far$/, '')];
      const k = p.scale ?? 1;
      expect([p.x, p.y, p.z]).toEqual([old.x, old.y, old.z]);
      const s = heartRockPieceOf(old.piece);
      expect(m.h * k * (p.rise ?? 1)).toBeCloseTo(s.height * (old.scale ?? 1) * (old.rise ?? 1), 3);
      const half = (m.w * k * (p.stretch ?? 1)) / 2;
      // Never wider than the old piece's whole reach.
      expect(half).toBeLessThanOrEqual(s.reach * (old.scale ?? 1) + 1e-6);
      const oldClear = hammerEnvFrontClear(old.x, old.z, old.rot, s.half * (old.scale ?? 1));
      if (oldClear && !hammerEnvFrontClear(p.x, p.z, p.rot, half))
        bad.push(`${old.piece} (${old.x.toFixed(1)}, ${old.z.toFixed(1)})`);
    }
    expect(bad).toEqual([]);
  });

  it('never draws a rock with a build the plan no longer ships', () => {
    const pieces = [
      ...rock.map(hammerEnvRockPiece),
      ...planHeartNeedles().map((n) => fitHammerEnvNeedle(n).piece),
    ];
    expect(pieces.some((p) => p.includes('Spires'))).toBe(false);
    expect(shapes.has('Env_Spires')).toBe(false);
  });

  it('draws a far band from far builds, a near band from full builds', () => {
    for (const old of rock) {
      const piece = hammerEnvRockPiece(old);
      if (old.piece.endsWith('Far')) expect(piece.endsWith('Far')).toBe(true);
      else expect(piece.endsWith('Far')).toBe(false);
    }
  });

  it('fades its paint out before any other vein, in GLSL as in the plan', () => {
    expect(hammerEnvWeight(GALLERY_LANDINGS.h2.x, GALLERY_LANDINGS.h2.z)).toBe(1);
    for (const [x, z] of [
      [0, 0],
      [0, 200],
      [200, -60],
      [-160, 0],
      [HEART_ROOM.x, HEART_ROOM.z],
    ])
      expect(hammerEnvWeight(x, z), `${x},${z}`).toBe(0);
    for (let x = -300; x <= 300; x += 12)
      for (let z = -300; z <= 300; z += 12)
        if (hammerEnvWeight(x, z) > 0 && z > HAMMER_ENV_QUENCH_SOUTH)
          expect(smithHeartAreaAt(x, z), `${x},${z}`).toBe('hammer');
    const glsl = hammerEnvWeightGlsl();
    for (const n of [
      RING.outerR + 6,
      HEART_ROOM_AREA_R,
      HEART_ROOM.x,
      HEART_ROOM.z,
      HAMMER_ENV_QUENCH_SOUTH,
    ])
      expect(glsl).toContain(n.toFixed(1));
  });
});

describe('the new ruins', () => {
  it('stand on terraces nobody reaches, clear of the colossi', () => {
    const arena = [...planHammerEnvArena(), ...planHammerEnvBraziers()];
    expect(arena.filter((p) => p.piece === 'Env_Arcade').length).toBeGreaterThanOrEqual(6);
    expect(arena.filter((p) => p.piece.startsWith('Env_Banner')).length).toBeGreaterThanOrEqual(3);
    expect(arena.filter((p) => p.piece === 'Env_Brazier').length).toBeGreaterThanOrEqual(2);
    const colossi = F.props.filter((p) => p.kind === 'sh_quarry_colossus');
    for (const p of arena) {
      if (p.piece.startsWith('Env_Banner')) continue;
      const id = authoredFieldSurfaceAt(F, p.x, p.z)?.id ?? '';
      expect(id.startsWith('quarry_step_'), `${p.piece} on ${id}`).toBe(true);
      if (p.piece !== 'Env_Arcade')
        for (const c of colossi)
          expect(Math.hypot(p.x - c.x, p.z - c.z), p.piece).toBeGreaterThan(14);
    }
    // Never on the pit's own floor, where the fight is.
    expect(arena.some((p) => authoredFieldSurfaceAt(F, p.x, p.z)?.id === 'hammer_pit')).toBe(false);
  });

  it('sheds on the low tier, but for the fire bowls', () => {
    for (const p of planHammerEnvArena()) expect(p.cosmetic, p.piece).toBe(true);
    for (const p of planHammerEnvGallery()) expect(p.cosmetic, p.piece).toBe(true);
  });

  it('stands the Gallery piers past the lip, over the drop', () => {
    const piers = planHammerEnvGallery();
    expect(piers.length).toBe(Object.keys(GALLERY_LANDINGS).length);
    for (const p of piers) expect(authoredFieldSurfaceAt(F, p.x, p.z)).toBeFalsy();
  });
});

describe('the laid stone', () => {
  it('runs the flags down each walk, with no stretch on a slope', () => {
    const s = F.surfaces.find((x) => x.id === 'gallery_lower');
    if (s?.kind !== 'path') throw new Error('no gallery_lower');
    const [a, b] = [s.points[1], s.points[2]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const uva = hammerEnvPathUv('gallery_lower', a[0], a[1]);
    const uvb = hammerEnvPathUv('gallery_lower', b[0], b[1]);
    if (!uva || !uvb) throw new Error('no uv');
    expect(uvb[0] - uva[0]).toBeCloseTo(len, 4);
    expect(uvb[1] - uva[1]).toBeCloseTo(0, 4);
    // Across the walk only v moves.
    const nx = (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nz = -(b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const across = hammerEnvPathUv('gallery_lower', mx + nx * 3, mz + nz * 3);
    const mid = hammerEnvPathUv('gallery_lower', mx, mz);
    if (!across || !mid) throw new Error('no uv');
    expect(across[0]).toBeCloseTo(mid[0], 4);
    expect(Math.abs(across[1] - mid[1])).toBeCloseTo(3, 4);
    // Every other floor keeps the world's.
    expect(hammerEnvPathUv('hammer_pit', 0, -170)).toBeNull();
  });

  it('stands every tread on the sim own ramp, the step never past half a rise', () => {
    const treads = planHammerEnvStairs();
    expect(treads.length).toBeGreaterThan(30);
    for (const p of treads) {
      const walked = hammerEnvWalkedHeight(p.x, p.z);
      expect(Math.abs(p.y - walked), `${p.x},${p.z}`).toBeLessThan(HAMMER_ENV_TREAD.rise);
    }
    const tread = shapes.get('Env_StairTread');
    if (!tread) throw new Error('no tread');
    expect(tread.max[1]).toBeLessThan(0.05);
    // A flat run's long slab sits under the floor it meets, so it can't lie on top.
    for (const p of treads.filter((t) => (t.scale ?? 1) > 2))
      expect(p.y + tread.max[1] * (p.scale ?? 1) * (p.rise ?? 1)).toBeLessThan(
        hammerEnvWalkedHeight(p.x, p.z),
      );
  });

  it('lets the far skyline fall away with distance, and keeps its near rock whole', () => {
    const D = HAMMER_ENV_DEPTH;
    // A neighbour's rock close by keeps its full light.
    expect(hammerEnvDepth(0)).toEqual([1, 1, 1]);
    expect(hammerEnvDepth(D.near)).toEqual([1, 1, 1]);
    // The far wall takes the full fall, and past it nothing falls further.
    for (const d of [D.far, D.far * 3])
      hammerEnvDepth(d).forEach((v, i) => expect(v).toBeCloseTo(D.dark[i], 9));
    for (let d = D.near; d < D.far; d += 6)
      expect(hammerEnvDepth(d + 6)[0]).toBeLessThan(hammerEnvDepth(d)[0]);
    // Darker, never black: a far rock keeps its shape against the sky.
    for (const v of D.dark) {
      expect(v).toBeGreaterThan(0.25);
      expect(v).toBeLessThan(0.6);
    }
    // The shaders read the same numbers.
    const glsl = hammerEnvDepthGlsl();
    expect(glsl).toContain(`smoothstep( ${D.near.toFixed(1)}, ${D.far.toFixed(1)}, d )`);
    for (const v of D.dark) expect(glsl).toContain(v.toFixed(3));
  });

  it("quiets and darkens the neighbours' rock on the skyline, only for that camera", () => {
    const P = HEART_ROCK_FAR_PAINT;
    expect(P.tile).toBeGreaterThan(50);
    expect(P.contrast).toBeLessThan(0.6);
    const paint = heartRockHammerGlsl();
    expect(paint).toContain(`hL / ${P.tile.toFixed(1)}`);
    expect(paint).toContain(P.contrast.toFixed(2));
    // Off the vein the blend is zero: the other veins draw as they did.
    const depth = heartRockHammerDepthGlsl();
    expect(depth).toContain('hammerEnvDepth( length( vViewPosition ) )');
    expect(depth).toContain('uHammerCam');
  });

  it('rails the arena over its open drop like the Gallery', () => {
    const { swap } = hammerEnvSwap(planHammerKit());
    const on = (piece: string) =>
      swap.filter(
        (p) => p.piece === piece && authoredFieldSurfaceAt(F, p.x, p.z)?.id === 'hammer_pit',
      );
    expect(on('Env_ChainRail').length).toBeGreaterThanOrEqual(8);
    expect(on('Env_KerbA').length + on('Env_KerbB').length).toBeGreaterThan(8);
    expect(
      planHammerEnvWalkLayer().filter(
        (p) => authoredFieldSurfaceAt(F, p.x, p.z)?.id === 'hammer_pit',
      ).length,
    ).toBeGreaterThan(8);
  });

  it('keeps the walk layer past the lip and under the walk', () => {
    const layer = shapes.get('Env_WalkLayer');
    if (!layer) throw new Error('no layer');
    expect(layer.max[1]).toBeLessThanOrEqual(0.05);
    expect(layer.max[2]).toBeLessThan(1.1);
    expect(planHammerEnvWalkLayer().length).toBeGreaterThan(30);
  });

  it('lays the arena border flat, under the telegraphs lift', () => {
    const border = shapes.get('Env_ArenaBorder');
    if (!border) throw new Error('no border');
    expect(border.max[1] - border.min[1]).toBeLessThan(0.001);
    const floorDrop = QUARRY_TERRACES.steps[0].h - HAMMER_PIT.h;
    expect(border.max[1] + floorDrop).toBeLessThan(0.06);
    expect(border.max[1] + floorDrop).toBeGreaterThan(0);
  });
});
