// The Quench vein's painted rebuild (design doc section 5.24): the shipped kit, what stands
// in for what, the promise kept from the Hammer's and the Breath's rebuilds (the look only:
// every placement, walk and lip stays, and the lips and hung faces a body can fall past keep
// their sculpts), the one new piece (the great frozen fall) in the sightline plan, the
// paint's share of the mountain, the painted floors, the sky, and the loader. Every plan
// rule here is against the same layout the sim reads.

import { existsSync, readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIELD_GROUND_COLORS } from '../src/render/authored_field/field_mesh_core';
import {
  breathEnvOwnsRock,
  breathEnvRockGlsl,
  breathEnvWeight,
} from '../src/render/smith_heart/breath_env_plan_core';
import { applyEnvLook, envLookKey } from '../src/render/smith_heart/env_kit_look';
import {
  hammerEnvFrontClear,
  hammerEnvOwnsRock,
  hammerEnvWeight,
} from '../src/render/smith_heart/hammer_env_plan_core';
import {
  applyRockCutaway,
  heartRockQuenchGlsl,
  setHeartRockQuenchPaint,
} from '../src/render/smith_heart/heart_rock_cutaway';
import { planHeartGulfWalls } from '../src/render/smith_heart/heart_rock_gulf_core';
import {
  planHeartHangs,
  planHeartRockLips,
  planHeartRockUnder,
} from '../src/render/smith_heart/heart_rock_hang_core';
import {
  HEART_ROCK_NEEDLES,
  heartRockPieceOf,
  planHeartNeedles,
  planHeartRock,
} from '../src/render/smith_heart/heart_rock_plan_core';
import { quenchEnvSolids } from '../src/render/smith_heart/heart_sightline_core';
import { buildHeartSky } from '../src/render/smith_heart/heart_sky';
import { heartFloorClearance, heartOpenAir } from '../src/render/smith_heart/heart_walls_core';
import {
  fitQuenchEnvNeedle,
  fitQuenchEnvRock,
  planQuenchEnvGreatFall,
  planQuenchEnvRing,
  QUENCH_ENV_DROPS,
  QUENCH_ENV_FALL,
  QUENCH_ENV_FALL_BOX,
  QUENCH_ENV_FIELD_BASE,
  QUENCH_ENV_GREAT_FALL,
  QUENCH_ENV_PROPS,
  QUENCH_ENV_RING,
  QUENCH_ENV_ROCK,
  QUENCH_ENV_ROCK_PAINT,
  QUENCH_ENV_ROCK_TILE,
  QUENCH_OLD_FALLS,
  QUENCH_OLD_PROPS,
  quenchEnvOwnsRock,
  quenchEnvRockGlsl,
  quenchEnvRockPiece,
  quenchEnvSwap,
  quenchEnvWeight,
  quenchEnvWeightGlsl,
} from '../src/render/smith_heart/quench_env_plan_core';
import { QUENCH_FROST, quenchFrostWeight } from '../src/render/smith_heart/quench_frost_core';
import { planQuenchKit, QUENCH_WALL } from '../src/render/smith_heart/quench_kit_plan_core';
import {
  LAKE_ICE_PAINTED,
  lakeIceDepthGlsl,
  lakeIceMaterial,
} from '../src/render/smith_heart/quench_lake_ice';
import {
  HEART_ROOM,
  QUENCH,
  RING,
  SMITH_HEART_FIELD,
  smithHeartAreaAt,
} from '../src/sim/content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

// The loader runs against a stubbed fetch (the GLB itself is read straight off disk below).
const fetches = vi.hoisted(() => ({
  pending: new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>(),
}));
vi.mock('../src/render/assets/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/assets/loader')>()),
  loadGltf: (url: string) =>
    new Promise((resolve, reject) => fetches.pending.set(url, { resolve, reject })),
  releaseGltf: () => undefined,
}));

const KIT = 'public/models/props/smith_heart_quench_env_kit.glb';
const KIT_URL = '/models/props/smith_heart_quench_env_kit.glb';
const F = SMITH_HEART_FIELD;

interface Shape {
  min: number[];
  max: number[];
  tris: number;
  points: number[][];
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
    textureSizes.set(texture.getName() || texture.getURI() || `#${textureSizes.size}`, [
      view.getUint32(20, true),
      view.getUint32(24, true),
    ]);
  }
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (!/^(Env|Tex)_/.test(name) || /^(Env|Tex)_/.test(node.getParentNode()?.getName() ?? ''))
      continue;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const points: number[][] = [];
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
          points.push(w);
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], w[k]);
            max[k] = Math.max(max[k], w[k]);
          }
        }
      }
      for (const c of n.listChildren()) visit(c);
    };
    visit(node);
    shapes.set(name, { min, max, tris, points });
  }
});

const shape = (name: string): Shape => {
  const s = shapes.get(name);
  if (!s) throw new Error(`no ${name}`);
  return s;
};

// The bands the rock painter swaps (heart_rock.ts): the gulf's far walls ride with them.
const rock = [...planHeartRock(), ...planHeartRockUnder(), ...planHeartGulfWalls()];
const swapped = rock.filter(quenchEnvOwnsRock);
const reachOf = (s: Shape, below = Infinity) =>
  Math.max(...s.points.filter((p) => p[1] <= below).map((p) => Math.hypot(p[0], p[2])));

describe('the Quench painted kit as shipped', () => {
  it('ships, in KTX2, nothing past 1024, the backgrounds smaller', () => {
    expect(existsSync(KIT)).toBe(true);
    expect([...mimes]).toEqual(['image/ktx2']);
    expect(textureSizes.size).toBeGreaterThanOrEqual(15);
    for (const [name, [w, h]] of textureSizes) {
      expect(w, name).toBeLessThanOrEqual(1024);
      expect(h, name).toBeLessThanOrEqual(1024);
    }
    const small = [...textureSizes.values()].filter(([w, h]) => w * h <= 512 * 512);
    expect(small.length).toBeGreaterThanOrEqual(8);
    expect(readFileSync(KIT).length).toBeLessThan(9 * 1024 * 1024);
  });

  it('holds every piece the plans place, at the measures the plan fits', () => {
    const placed = new Set(
      [
        ...swapped.map(fitQuenchEnvRock),
        ...planHeartNeedles().filter(quenchEnvOwnsRock).map(fitQuenchEnvNeedle),
        ...quenchEnvSwap(planQuenchKit()).swap,
        ...planQuenchEnvGreatFall(),
      ].map((p) => p.piece),
    );
    expect(placed.size).toBeGreaterThanOrEqual(10);
    for (const piece of placed) expect(shapes.has(piece), piece).toBe(true);
    // The fight's own pieces (smith_heart_fx/quench_blades_fx.ts draws them).
    for (const piece of ['Env_IceSword', 'Env_IceCollar'])
      expect(shapes.has(piece), piece).toBe(true);
    for (const [piece, m] of Object.entries(QUENCH_ENV_ROCK)) {
      const s = shape(piece);
      expect(s.max[0] - s.min[0], `${piece} width`).toBeCloseTo(m.w, 0);
      expect(s.max[1] - s.min[1], `${piece} height`).toBeCloseTo(m.h, 0);
      expect(s.max[2] - s.min[2], `${piece} depth`).toBeCloseTo(m.d, 0);
      // Foot on the ground, front plane at z 0, the body behind it.
      expect(s.min[1]).toBeCloseTo(0, 1);
      expect(s.max[2]).toBeCloseTo(0, 1);
    }
    for (const [piece, h] of Object.entries(QUENCH_ENV_PROPS)) {
      const s = shape(piece);
      expect(s.min[1], piece).toBeCloseTo(0, 1);
      expect(s.max[1], piece).toBeCloseTo(h, 1);
    }
    // The carriers of the floors', the rock paint's and the sky's paintings. The cliff is read
    // only through uniforms an onBeforeCompile adds, which the gate's upload lane cannot see:
    // its carrier puts it in a material's map slot, so the warmers upload it behind the curtain.
    for (const tex of [
      'Tex_Lake',
      'Tex_LakeN',
      'Tex_Rime',
      'Tex_RimeN',
      'Tex_Cliff',
      'Tex_Block',
      'Tex_Snow',
      'Tex_Sky',
    ])
      expect(shapes.has(tex), tex).toBe(true);
  });

  it('stays cheap: the paint carries the look, not the triangles', () => {
    for (const p of ['Env_GlacierTall', 'Env_GlacierWide', 'Env_IceSpires'])
      expect(shape(p).tris, p).toBeLessThanOrEqual(3200);
    for (const p of ['Env_GlacierTallFar', 'Env_GlacierWideFar', 'Env_IceSpiresFar'])
      expect(shape(p).tris, p).toBeLessThanOrEqual(1600);
    // The old kit's pieces: a bowl 4,694 triangles, a stone 4,455, a fall 5,230, a heap of
    // ice 6,749, a blade 5,204, a wall 1,022.
    expect(shape('Env_FireBowl').tris).toBeLessThanOrEqual(2800);
    expect(shape('Env_ChevronStone').tris).toBeLessThanOrEqual(2800);
    expect(shape('Env_FrozenFall').tris).toBeLessThanOrEqual(3100);
    expect(shape('Env_IcePlates').tris).toBeLessThanOrEqual(2400);
    expect(shape('Env_IceSword').tris).toBeLessThanOrEqual(4400);
    expect(shape('Env_IceCollar').tris).toBeLessThan(300);
    expect(shape('Env_QuenchWallA').tris).toBeLessThan(400);
    expect(shape('Env_SteamVent').tris).toBeLessThan(200);
  });

  it('stands each prop inside the old piece it replaces (and its collider, a body allowed)', () => {
    // The fire bowl inside its brazier's collider (r 1.5), the standing stone inside its
    // frost stone's (r 1.6), the Singing Ice's crystal inside the old cluster's span.
    expect(reachOf(shape('Env_FireBowl'))).toBeLessThanOrEqual(1.5 + 0.5);
    for (const p of F.props.filter((x) => x.kind === 'sh_brazier')) expect(p.r).toBe(1.5);
    const k = QUENCH_OLD_PROPS.Kit_FrostStone / QUENCH_ENV_PROPS.Env_ChevronStone;
    expect(reachOf(shape('Env_ChevronStone')) * k).toBeLessThanOrEqual(1.6 + 0.5);
    for (const p of F.props.filter((x) => x.kind === 'sh_frost_stone')) expect(p.r).toBe(1.6);
    // The old Kit_IceBlade spanned x -1.36 to 1.07, z -1.2 to 1.3.
    expect(reachOf(shape('Env_IceCluster'))).toBeLessThanOrEqual(Math.hypot(1.36, 1.3));
    // The heap of old ice in the old heap's box (21 by 12.4).
    const plates = shape('Env_IcePlates');
    expect(Math.max(-plates.min[0], plates.max[0])).toBeLessThanOrEqual(10.51);
    expect(Math.max(-plates.min[2], plates.max[2])).toBeLessThanOrEqual(6.45);
    // The frozen fall in the old falls' frame: hung from its head, its back in the rock.
    const fall = shape('Env_FrozenFall');
    const B = QUENCH_ENV_FALL_BOX;
    expect(fall.max[1]).toBeCloseTo(B.y1, 1);
    expect(fall.min[1]).toBeCloseTo(B.y0, 1);
    expect(fall.max[1] - fall.min[1]).toBeCloseTo(QUENCH_ENV_FALL.height, 1);
    expect(Math.max(-fall.min[0], fall.max[0])).toBeLessThanOrEqual(B.hw + 0.01);
    expect(fall.min[2]).toBeGreaterThanOrEqual(B.z0 - 0.01);
    expect(fall.max[2]).toBeLessThanOrEqual(B.z1 + 0.01);
    // The vent flat, under a hand.
    expect(shape('Env_SteamVent').max[1]).toBeLessThan(0.2);
  });

  it('stands the fight sword in the old sunk blade frame, its own point under the ice', () => {
    const s = shape('Env_IceSword');
    // Its point 3.2 under the lake's face (quench_fight_fx_core.ts BLADE_TIP: what a risen
    // blade shows), its crown about the old blade's 12.8 over it.
    expect(s.min[1]).toBeCloseTo(-3.2, 0);
    expect(s.max[1]).toBeGreaterThan(11.5);
    expect(s.max[1]).toBeLessThan(13.5);
    // Leaning toward +x (the old piece's lean the fight takes out as it rises).
    expect(s.max[0]).toBeGreaterThan(-s.min[0]);
    // Its foot inside the blade's footprint (QUENCH_BLADE_R 1.6), a body allowed, as the
    // old piece's was (inside r 2.05 under 3 yd).
    expect(reachOf(s, 3)).toBeLessThanOrEqual(2.1);
    // The collar of heaved plates round its foot, in the lake.
    const c = shape('Env_IceCollar');
    // (The old piece's snow pillows reached as far: r 1.7, a yard long.)
    expect(reachOf(c)).toBeLessThanOrEqual(2.3);
    expect(c.max[1]).toBeLessThan(0.6);
  });

  it('keeps the walls in the old modules frame', () => {
    for (const v of ['A', 'B']) {
      const s = shape(`Env_QuenchWall${v}`);
      // Over the walk (the lip's inner side, game -Z) nothing rises past it; above the walk
      // the wall stands inside the old module's span past the lip, a knee high.
      for (const p of s.points) {
        if (p[2] < 0.04) expect(p[1], v).toBeLessThan(0.05);
        if (p[1] > 0.05) expect(p[2], v).toBeLessThanOrEqual(QUENCH_WALL.far + 0.1);
      }
      expect(s.max[1], v).toBeGreaterThan(0.8);
      expect(s.max[1], v).toBeLessThanOrEqual(QUENCH_WALL.height);
      expect(s.max[2], v).toBeLessThanOrEqual(1.2);
      expect(Math.abs(s.min[0] + 3)).toBeLessThan(0.1);
      expect(Math.abs(s.max[0] - 3)).toBeLessThan(0.15);
    }
  });
});

describe('the look only: every placement, walk and lip stays', () => {
  const plan = planQuenchKit();
  const { keep, swap } = quenchEnvSwap(plan);

  it('stands every swapped piece on its old placement, and drops only the flat inlays and drifts', () => {
    const spots = new Set(plan.map((p) => `${p.x}|${p.y}|${p.z}|${p.rot}`));
    expect(swap.length).toBeGreaterThan(60);
    for (const p of swap) expect(spots.has(`${p.x}|${p.y}|${p.z}|${p.rot}`)).toBe(true);
    const dropped = plan.filter(
      (p) => !keep.includes(p) && !swap.some((s) => s.x === p.x && s.z === p.z && s.rot === p.rot),
    );
    expect(dropped.length).toBeGreaterThan(10);
    for (const p of dropped) expect(QUENCH_ENV_DROPS.has(p.piece), p.piece).toBe(true);
    // Every old piece of the vein is swapped or dropped: nothing old is left.
    expect(keep).toEqual([]);
    expect(swap.every((p) => p.piece.startsWith('Env_'))).toBe(true);
  });

  it('stands each prop as tall as the old one and hangs each fall as far', () => {
    const tall = (p: { piece: string; scale?: number }) => p.scale ?? 1;
    const pairs: [string, string, number, number][] = [
      [
        'Kit_LakeBrazier',
        'Env_FireBowl',
        QUENCH_OLD_PROPS.Kit_LakeBrazier,
        QUENCH_ENV_PROPS.Env_FireBowl,
      ],
      [
        'Kit_FrostStone',
        'Env_ChevronStone',
        QUENCH_OLD_PROPS.Kit_FrostStone,
        QUENCH_ENV_PROPS.Env_ChevronStone,
      ],
      [
        'Kit_IceBlade',
        'Env_IceCluster',
        QUENCH_OLD_PROPS.Kit_IceBlade,
        QUENCH_ENV_PROPS.Env_IceCluster,
      ],
    ];
    for (const [from, to, oldH, newH] of pairs) {
      const olds = plan.filter((p) => p.piece === from);
      const news = swap.filter((p) => p.piece === to);
      expect(news.length, to).toBe(olds.length);
      expect(news.length, to).toBeGreaterThan(0);
      for (const p of news) {
        const old = olds.find((o) => o.x === p.x && o.z === p.z);
        expect(old).toBeTruthy();
        expect(tall(p) * newH).toBeCloseTo(tall(old ?? p) * oldH, 6);
      }
    }
    const falls = plan.filter((p) => p.piece.startsWith('Kit_FrozenFall'));
    expect(falls.length).toBeGreaterThan(3);
    for (const old of falls) {
      const p = swap.find((s) => s.x === old.x && s.z === old.z && s.piece === 'Env_FrozenFall');
      expect(p).toBeTruthy();
      expect((p?.scale ?? 1) * QUENCH_ENV_FALL.height).toBeCloseTo(
        (old.scale ?? 1) * (QUENCH_OLD_FALLS[old.piece] ?? 0),
        6,
      );
    }
  });

  it('stands each old piece in its own painted piece, every kind', () => {
    const want: Record<string, string> = {
      Kit_LakeBrazier: 'Env_FireBowl',
      Kit_FrostStone: 'Env_ChevronStone',
      Kit_IceShelfA: 'Env_IcePlates',
      Kit_IceShelfB: 'Env_IcePlates',
      Kit_IceBlade: 'Env_IceCluster',
      Kit_SteamVent: 'Env_SteamVent',
      Kit_QuenchWallA: 'Env_QuenchWallA',
      Kit_QuenchWallB: 'Env_QuenchWallB',
      Kit_FrozenFallA: 'Env_FrozenFall',
      Kit_FrozenFallB: 'Env_FrozenFall',
    };
    const kept = new Set([
      'Kit_IceShelfA',
      'Kit_IceShelfB',
      'Kit_SteamVent',
      'Kit_QuenchWallA',
      'Kit_QuenchWallB',
    ]);
    for (const [from, to] of Object.entries(want)) {
      const olds = plan.filter((p) => p.piece === from);
      const news = swap.filter((p) =>
        olds.some((o) => o.x === p.x && o.z === p.z && o.rot === p.rot),
      );
      expect(news.length, from).toBe(olds.length);
      for (const p of news) {
        expect(p.piece, from).toBe(to);
        // The pieces drawn in the old frame keep the old placement's own scale.
        const old = olds.find((o) => o.x === p.x && o.z === p.z);
        if (kept.has(from)) expect(p.scale ?? 1).toBe(old?.scale ?? 1);
      }
    }
    // Every kind of the old kit's plan is listed (or dropped): none left unconsidered.
    for (const p of plan)
      expect(p.piece in want || QUENCH_ENV_DROPS.has(p.piece), p.piece).toBe(true);
  });

  it('keeps a swap whose piece did not bake on the old kit', () => {
    const none = quenchEnvSwap(plan, () => false);
    expect(none.swap).toEqual([]);
    expect(none.keep.length + plan.filter((p) => QUENCH_ENV_DROPS.has(p.piece)).length).toBe(
      plan.length,
    );
    // A partial bake: only the bowls swap, every other old piece keeps its own look.
    const bowls = quenchEnvSwap(plan, (piece) => piece === 'Env_FireBowl');
    expect(bowls.swap.length).toBe(plan.filter((p) => p.piece === 'Kit_LakeBrazier').length);
    expect(bowls.swap.every((p) => p.piece === 'Env_FireBowl')).toBe(true);
    expect(bowls.keep.some((p) => p.piece === 'Kit_FrostStone')).toBe(true);
  });

  it('leaves the lips and the hung faces to the rock kit', () => {
    const lipsAndHangs = [...planHeartRockLips(), ...planHeartHangs()];
    expect(
      lipsAndHangs.filter((p) => smithHeartAreaAt(p.x, p.z) === 'quench').length,
    ).toBeGreaterThan(10);
    // None of them is among the bands the glacier stands in for (the rock painter swaps
    // only those; a lip a body can fall past keeps its sculpt).
    const swappedSpots = new Set(swapped.map((p) => `${p.x}|${p.z}|${p.rot}`));
    for (const p of lipsAndHangs) expect(swappedSpots.has(`${p.x}|${p.z}|${p.rot}`)).toBe(false);
  });

  it('measures the old pieces as the old kit shipped them', async () => {
    // The heights the swaps keep, read off the old kit's own GLB (glTF y up).
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.readBinary(
      new Uint8Array(readFileSync('public/models/props/smith_heart_quench_kit.glb')),
    );
    const height = (name: string) => {
      const node = doc
        .getRoot()
        .listNodes()
        .find((n) => n.getName() === name);
      if (!node) throw new Error(name);
      let lo = Infinity;
      let hi = -Infinity;
      node.traverse((n) => {
        const m = n.getWorldMatrix();
        for (const prim of n.getMesh()?.listPrimitives() ?? []) {
          const a = prim.getAttribute('POSITION');
          const e: number[] = [];
          for (let i = 0; a && i < a.getCount(); i++) {
            a.getElement(i, e);
            const y = m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13];
            lo = Math.min(lo, y);
            hi = Math.max(hi, y);
          }
        }
      });
      return { lo, hi };
    };
    expect(height('Kit_LakeBrazier').hi).toBeCloseTo(QUENCH_OLD_PROPS.Kit_LakeBrazier, 1);
    expect(height('Kit_FrostStone').hi).toBeCloseTo(QUENCH_OLD_PROPS.Kit_FrostStone, 1);
    expect(height('Kit_IceBlade').hi).toBeCloseTo(QUENCH_OLD_PROPS.Kit_IceBlade, 1);
    for (const fall of ['Kit_FrozenFallA', 'Kit_FrozenFallB']) {
      const h = height(fall);
      expect(h.hi - h.lo, fall).toBeCloseTo(QUENCH_OLD_FALLS[fall], 0);
    }
    // Both falls are in the plan, so both heights are spent.
    expect(plan.some((p) => p.piece === 'Kit_FrozenFallB')).toBe(true);
  });
});

describe('the glacier round the realm', () => {
  it('takes the vein and the skyline facing it, never the Hammer, the Breath or the Heart', () => {
    expect(swapped.length).toBeGreaterThan(40);
    // The walls north of the lake stand in the Heart's area but face the Quench: glacier.
    const facing = (p: { x: number; z: number }) => {
      const c = heartFloorClearance(p.x, p.z);
      if (!Number.isFinite(c.d)) return null;
      return smithHeartAreaAt(p.x + c.toX * (c.d + 4), p.z + c.toZ * (c.d + 4));
    };
    const north = rock.filter(
      (p) => smithHeartAreaAt(p.x, p.z) === 'heart' && facing(p) === 'quench',
    );
    expect(north.length).toBeGreaterThan(3);
    for (const p of [...rock, ...planHeartNeedles()]) {
      if (hammerEnvOwnsRock(p) || breathEnvOwnsRock(p)) expect(quenchEnvOwnsRock(p)).toBe(false);
      // Rock facing the Heart's own floors stays the Heart's.
      if (smithHeartAreaAt(p.x, p.z) === 'heart' && facing(p) !== 'quench')
        expect(quenchEnvOwnsRock(p)).toBe(false);
      if (facing(p) === 'heart') expect(quenchEnvOwnsRock(p)).toBe(false);
      if (
        smithHeartAreaAt(p.x, p.z) === 'quench' &&
        facing(p) !== 'heart' &&
        !hammerEnvOwnsRock(p) &&
        !breathEnvOwnsRock(p)
      )
        expect(quenchEnvOwnsRock(p)).toBe(true);
    }
    for (const p of north) expect(quenchEnvOwnsRock(p)).toBe(true);
  });

  it('never stands a front on a walk, and keeps each spot, foot and height', () => {
    const bad: string[] = [];
    for (const old of swapped) {
      const p = fitQuenchEnvRock(old);
      const m = QUENCH_ENV_ROCK[p.piece.replace(/Far$/, '')];
      const k = p.scale ?? 1;
      expect([p.x, p.y, p.z]).toEqual([old.x, old.y, old.z]);
      const s = heartRockPieceOf(old.piece);
      expect(m.h * k * (p.rise ?? 1)).toBeCloseTo(s.height * (old.scale ?? 1) * (old.rise ?? 1), 3);
      expect(m.d * k).toBeCloseTo(s.depth * (old.scale ?? 1), 3);
      const half = (m.w * k * (p.stretch ?? 1)) / 2;
      expect(half).toBeLessThanOrEqual(s.reach * (old.scale ?? 1) + 1e-6);
      const oldClear = hammerEnvFrontClear(old.x, old.z, old.rot, s.half * (old.scale ?? 1));
      if (oldClear && !hammerEnvFrontClear(p.x, p.z, p.rot, half))
        bad.push(`${old.piece} (${old.x.toFixed(1)}, ${old.z.toFixed(1)})`);
    }
    expect(bad).toEqual([]);
  });

  it('draws a far band from far builds, a near band from full builds', () => {
    for (const old of swapped)
      expect(quenchEnvRockPiece(old).endsWith('Far')).toBe(old.piece.endsWith('Far'));
  });

  it('stands spires where each needle stood, as tall, never wider than its foot', () => {
    for (const old of planHeartNeedles().filter(quenchEnvOwnsRock)) {
      const p = fitQuenchEnvNeedle(old);
      const n = HEART_ROCK_NEEDLES[old.piece];
      const m = QUENCH_ENV_ROCK.Env_IceSpires;
      const k = p.scale ?? 1;
      expect(p.y).toBe(old.y);
      expect(m.h * k * (p.rise ?? 1)).toBeCloseTo(n.height * (old.scale ?? 1), 3);
      expect((m.w * k * (p.stretch ?? 1)) / 2).toBeCloseTo(n.half * (old.scale ?? 1), 3);
      expect(Math.hypot(p.x - old.x, p.z - old.z)).toBeCloseTo((m.d * k) / 2, 3);
    }
  });

  it('hangs the great frozen fall on tall rock across the lake, in the sightline pin', () => {
    const G = QUENCH_ENV_GREAT_FALL;
    const [fall, ...rest] = planQuenchEnvGreatFall();
    expect(rest).toEqual([]);
    expect(fall.piece).toBe('Env_FrozenFall');
    expect(fall.scale).toBe(G.scale);
    // On a band of the Quench's rock facing the shelf, east of the lake.
    const host = planHeartRock().find(
      (p) =>
        Math.abs(p.x + Math.sin(p.rot) * G.out - fall.x) < 1e-6 &&
        Math.abs(p.z + Math.cos(p.rot) * G.out - fall.z) < 1e-6,
    );
    expect(host).toBeTruthy();
    if (!host) return;
    expect(smithHeartAreaAt(host.x, host.z)).toBe('quench');
    const c = heartFloorClearance(host.x, host.z);
    const faced = authoredFieldSurfaceAt(F, host.x + c.toX * (c.d + 3), host.z + c.toZ * (c.d + 3));
    expect(faced?.id).toBe('lake_shelf');
    expect(host.x).toBeGreaterThan(QUENCH.lake.x + QUENCH.lake.rx);
    // Its notch under the rock's crest, its head well over the shelf.
    const m = heartRockPieceOf(host.piece);
    const crest = host.y + m.height * (host.scale ?? 1) * (host.rise ?? 1);
    expect(fall.y + QUENCH_ENV_FALL_BOX.y1 * G.scale).toBeLessThanOrEqual(crest);
    expect(fall.y).toBeGreaterThan(c.floor + 30);
    // Its front behind the rock's own front plane: never over the shelf.
    expect(QUENCH_ENV_FALL_BOX.z1 * G.scale + G.out).toBeLessThan(0);
    // Of every band of the Quench's rock facing the shelf and climbing past the fall's head,
    // the host is the one nearest east of the lake.
    const bearingOff = (p: { x: number; z: number }) => {
      let off =
        Math.abs(
          (Math.atan2(p.x - QUENCH.lake.x, p.z - QUENCH.lake.z) * 180) / Math.PI - G.bearing,
        ) % 360;
      if (off > 180) off = 360 - off;
      return off;
    };
    for (const p of planHeartRock()) {
      if (p.cosmetic || smithHeartAreaAt(p.x, p.z) !== 'quench') continue;
      const cc = heartFloorClearance(p.x, p.z);
      if (!Number.isFinite(cc.d) || cc.d > G.maxBack) continue;
      const f = authoredFieldSurfaceAt(F, p.x + cc.toX * (cc.d + 3), p.z + cc.toZ * (cc.d + 3));
      if (f?.id !== 'lake_shelf') continue;
      const mm = heartRockPieceOf(p.piece);
      if (p.y + mm.height * (p.scale ?? 1) * (p.rise ?? 1) < cc.floor + G.head + 4) continue;
      expect(bearingOff(p)).toBeGreaterThanOrEqual(bearingOff(host));
    }
    // The sightline plan holds it, the crest's spires and the ring (heart_sightline_core.ts).
    const crestSpires = planHeartNeedles().filter(quenchEnvOwnsRock);
    expect(quenchEnvSolids().length).toBe(crestSpires.length + 1 + planQuenchEnvRing().length);
  });

  it('rings the basin with snow-capped stacks on the mountain, clear of every walk', () => {
    const R = QUENCH_ENV_RING;
    const L = QUENCH.lake;
    const ring = planQuenchEnvRing();
    expect(ring.length).toBeGreaterThanOrEqual(10);
    const [fall] = planQuenchEnvGreatFall();
    const fallDeg = (Math.atan2(fall.x - L.x, fall.z - L.z) * 180) / Math.PI;
    const m = QUENCH_ENV_ROCK[R.piece];
    for (const p of ring) {
      expect(p.piece).toBe(R.piece);
      const k = p.scale ?? 1;
      expect(k).toBeGreaterThanOrEqual(R.minScale);
      expect(k).toBeLessThanOrEqual(R.maxScale);
      // Its face to the lake, on the ring.
      expect(Math.hypot(p.x - L.x, p.z - L.z)).toBeCloseTo(R.r, 6);
      expect(Math.cos(p.rot - Math.atan2(L.x - p.x, L.z - p.z))).toBeCloseTo(1, 6);
      // Its whole front clear of every walk, its foot sunk under the shelf.
      expect(hammerEnvFrontClear(p.x, p.z, p.rot, (m.w * k) / 2)).toBe(true);
      expect(p.y).toBeLessThan(QUENCH.shelf.h);
      // Never in front of the great frozen fall.
      const deg = (Math.atan2(p.x - L.x, p.z - L.z) * 180) / Math.PI;
      let off = Math.abs(deg - fallDeg) % 360;
      if (off > 180) off = 360 - off;
      expect(off).toBeGreaterThanOrEqual(R.fallGap);
    }
    // No stack's footprint over a walk or the open air (sampled finer than the plan does):
    // the way in down the lake descent stays open.
    for (const p of ring) {
      const k = p.scale ?? 1;
      const ux = Math.cos(p.rot);
      const uz = -Math.sin(p.rot);
      for (let s = -1; s <= 1; s += 0.25)
        for (let b = 0; b <= 1; b += 0.25) {
          const x = p.x + ux * ((m.w * k) / 2) * s - Math.sin(p.rot) * m.d * k * b;
          const z = p.z + uz * ((m.w * k) / 2) * s - Math.cos(p.rot) * m.d * k * b;
          expect(authoredFieldSurfaceAt(F, x, z), `${p.x.toFixed(0)},${p.z.toFixed(0)}`).toBeNull();
          expect(heartOpenAir(x, z, 0)).toBe(false);
        }
    }
  });
});

describe('the frozen cliff painting on the rock it keeps', () => {
  it('paints where the frost held, fading out before the Ring, the Heart and the other veins', () => {
    expect(quenchEnvWeight(QUENCH.lake.x, QUENCH.lake.z)).toBeCloseTo(1, 6);
    expect(quenchEnvWeight(QUENCH.q1.x, QUENCH.q1.z)).toBeCloseTo(1, 6);
    for (const [x, z] of [
      [0, 0],
      [RING.x, RING.z],
      [HEART_ROOM.x, HEART_ROOM.z],
      [-180, 0],
      [0, 150],
    ])
      expect(quenchEnvWeight(x, z), `${x},${z}`).toBe(0);
    for (let x = -300; x <= 300; x += 12)
      for (let z = -300; z <= 300; z += 12) {
        // Where the frost held, but for the skyline the Hammer's own paint holds.
        expect(quenchEnvWeight(x, z)).toBeCloseTo(
          quenchFrostWeight(x, z) * (1 - hammerEnvWeight(x, z)),
          9,
        );
        // No two veins' paints both hold at full strength.
        expect(
          quenchEnvWeight(x, z) + breathEnvWeight(x, z) + hammerEnvWeight(x, z),
          `${x},${z}`,
        ).toBeLessThanOrEqual(1.0001);
      }
    // The GLSL twin carries the same edges, its Heart side faded by the caller's core, the
    // Hammer's share under its own name (never a second `hammerEnvWeight` on one shader).
    const glsl = quenchEnvWeightGlsl();
    expect(glsl).toContain('float quenchEnvWeight( vec2 p, float core )');
    expect(glsl).toContain(', core )');
    expect(glsl).toContain('float quenchHammerShare(');
    expect(glsl).not.toContain('float hammerEnvWeight(');
    // Every edge of the frost's reach, as the weight's twin spells it.
    const F1 = QUENCH_FROST;
    for (const v of [
      F1.x0,
      F1.x1,
      F1.ring0,
      F1.ring1,
      F1.heart0,
      F1.heart1,
      F1.heartX,
      F1.heartZ,
      F1.breathZ0,
      F1.breathZ1,
      F1.breathX0,
      F1.breathX1,
    ])
      expect(glsl).toContain(v.toFixed(1));
  });

  it('keeps each surface its own value under the painting, its gradients explicit, snow on its ledges', () => {
    const glsl = quenchEnvRockGlsl();
    const P = QUENCH_ENV_ROCK_PAINT;
    expect(glsl).not.toMatch(/texture2D\(|texture\(/);
    expect(glsl.match(/textureGrad\(/g)?.length).toBe(7);
    expect(glsl).toContain(`kA = ${(1 / QUENCH_ENV_ROCK_TILE.a).toFixed(5)}`);
    expect(glsl).toContain(P.mean.toFixed(3));
    expect(glsl).toContain('dot( base, lumaW )');
    // The ledges' snow, the one term the Breath's paint does not carry.
    expect(P.ledge).toBeTruthy();
    expect(glsl).toContain('smoothstep( 0.55, 0.85, n.y )');
    // The rock kit's material reads it behind the painted flag, the gradients taken there.
    const rockGlsl = heartRockQuenchGlsl();
    expect(rockGlsl).toContain('uQuenchPainted > 0.5');
    expect(rockGlsl.indexOf('dFdx')).toBeLessThan(rockGlsl.indexOf('quenchEnvWeight'));
    expect(rockGlsl).toContain('uHeartCore');
    // The Breath's paint never takes the ledges' snow (its GLSL from the same core).
    expect(breathEnvRockGlsl()).not.toContain('smoothstep( 0.55, 0.85, n.y )');
  });

  it('splices the paint into the rock kit material, lit by the painted flag', () => {
    const m = new THREE.MeshStandardMaterial();
    applyRockCutaway(m);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader:
        '#include <common>\n#include <clipping_planes_fragment>\n#include <color_fragment>\n#include <lights_physical_fragment>\n#include <emissivemap_fragment>\n#include <opaque_fragment>',
    };
    m.onBeforeCompile(shader as never, {} as never);
    expect(shader.fragmentShader).toContain(heartRockQuenchGlsl());
    expect(shader.fragmentShader).toContain('vec3 quenchEnvRock(');
    // After the frost: the painting lays over the frosted granite.
    expect(shader.fragmentShader.indexOf('uQuenchPainted > 0.5')).toBeGreaterThan(
      shader.fragmentShader.indexOf('rockFrostNoise( qP )'),
    );
    expect(m.customProgramCacheKey()).toContain('quenchPaint');
    const tex = new THREE.Texture();
    setHeartRockQuenchPaint(tex);
    expect(shader.uniforms.uQuenchPainted.value).toBe(1);
    expect(shader.uniforms.uQuenchPaint.value).toBe(tex);
    setHeartRockQuenchPaint(null);
    expect(shader.uniforms.uQuenchPainted.value).toBe(0);
  });
});

describe('the painted lake', () => {
  const compile = (m: THREE.Material) => {
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader:
        '#include <common>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <emissivemap_fragment>\n#include <lights_fragment_end>',
    };
    m.onBeforeCompile(shader as never, {} as never);
    return shader.fragmentShader;
  };

  it('builds the old frost lake as it was, and the painted lake on the painting', () => {
    const pair = { map: new THREE.Texture(), normalMap: new THREE.Texture() } as never;
    const paint = { map: new THREE.Texture(), normalMap: new THREE.Texture() };
    const frost = lakeIceMaterial(pair, false) as THREE.MeshStandardMaterial;
    const painted = lakeIceMaterial(pair, false, paint as never) as THREE.MeshStandardMaterial;
    expect(painted).not.toBe(frost);
    expect(frost.map).toBe((pair as { map: THREE.Texture }).map);
    expect(painted.map).toBe(paint.map);
    expect(painted.normalMap).toBe(paint.normalMap);
    expect(painted.customProgramCacheKey()).not.toBe(frost.customProgramCacheKey());
    // The field's vertex paint's base divided out, at the painting's level.
    const B = FIELD_GROUND_COLORS.lake_ice;
    expect(painted.color.r).toBeCloseTo(LAKE_ICE_PAINTED.gain / B[0], 6);
    expect(painted.color.b).toBeCloseTo(LAKE_ICE_PAINTED.gain / B[2], 6);
    expect(frost.color.r).toBe(1);
    const f = compile(frost);
    const pf = compile(painted);
    // The frost lake keeps three's map read and its full graze; the painted reads its
    // painting at its own tile, twice, and keeps the night's lake dark at grazing angles.
    expect(f).toContain('#include <map_fragment>');
    expect(f).toContain('iceGraze * 0.50');
    expect(pf).not.toContain('#include <map_fragment>');
    expect(pf).toContain(`vMapUv * ${LAKE_ICE_PAINTED.repeat.toFixed(2)}`);
    expect(pf).toContain('iceTileB');
    expect(pf).toContain(`iceGraze * ${LAKE_ICE_PAINTED.graze.toFixed(2)}`);
  });

  it('lays the painting as the ice face, the depth under its clear ice, and keeps the old lake as it was', () => {
    const painted = lakeIceDepthGlsl(3, true, true);
    const frost = lakeIceDepthGlsl(3, true, false);
    expect(painted).not.toBe(frost);
    expect(painted).toContain(`smoothstep( ${LAKE_ICE_PAINTED.skin[0].toFixed(2)}`);
    expect(painted).toContain(`* ${LAKE_ICE_PAINTED.depth.toFixed(2)};`);
    // The old frost lake keeps its own skin threshold and its water base.
    expect(frost).toContain('smoothstep( 0.4, 0.72, m )');
    expect(frost).not.toContain(`* ${LAKE_ICE_PAINTED.depth.toFixed(2)};`);
    // The snow at every edge and the crazed Singing Ice are both kept.
    for (const g of [painted, frost]) {
      expect(g).toContain('iceSnow');
      expect(g).toContain('craze');
    }
  });
});

describe('the painted look layers the Quench adds', () => {
  const frag = (look: Parameters<typeof applyEnvLook>[1]) => {
    const m = new THREE.MeshStandardMaterial();
    applyEnvLook(m, look);
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader:
        '#include <common>\n#include <clipping_planes_fragment>\n#include <color_fragment>\n#include <emissivemap_fragment>',
    };
    m.onBeforeCompile(shader as never, {} as never);
    return { glsl: shader.fragmentShader, key: m.customProgramCacheKey() };
  };
  const shade = ['0.16', '0.18', '0.24'] as const;

  it('lights the cyan crystal, the ice and the snow only when asked, and keys each', () => {
    const plain = frag({ cutaway: false, strokes: null, shade, crystal: 1.6 });
    const quench = frag({
      cutaway: false,
      strokes: null,
      shade,
      crystal: 2,
      crystalHue: 'cyan',
      ice: 1.3,
      snow: 0.9,
    });
    // The Breath's sky-blue crystal by default; the Quench's cyan, ice and snow only on ask.
    expect(plain.glsl).toContain('diffuseColor.g * 0.92');
    expect(plain.glsl).not.toContain('envIce');
    expect(plain.glsl).not.toContain('envSnow');
    expect(quench.glsl).toContain('min( diffuseColor.g, diffuseColor.b ) - diffuseColor.r');
    expect(quench.glsl).toContain('envIce * 1.30');
    expect(quench.glsl).toContain('envSnow * 0.90');
    expect(quench.key).toContain('crystal:2:cyan');
    expect(quench.key).toContain('ice:1.3');
    expect(quench.key).toContain('snow:0.9');
    // A look without them keeps its key as it was (no new segments).
    expect(plain.key.split('|').length).toBe(4);
  });
});

describe('the aurora night over the Quench', () => {
  it('wraps the painting on the dome only once its kit has landed', () => {
    const noop = () => undefined;
    const plain = buildHeartSky({ lowGfx: false, onFrame: noop });
    const sky = new THREE.Texture();
    const painted = buildHeartSky({ lowGfx: false, quenchSky: sky, onFrame: noop });
    const u = (s: typeof plain) => (s.mesh.material as THREE.ShaderMaterial).uniforms;
    expect(u(plain).uQuenchPainted.value).toBe(0);
    expect(u(painted).uQuenchPainted.value).toBe(1);
    expect(u(painted).uQuenchSky.value).toBe(sky);
    const frag = (plain.mesh.material as THREE.ShaderMaterial).fragmentShader;
    expect(frag).toContain('quenchPaintedSky');
    expect(frag).toContain('if (uQuenchPainted > 0.5) return quenchPaintedSky(d, up);');
  });
});

// ---- the loader ---------------------------------------------------------------------

type Kit = typeof import('../src/render/smith_heart/quench_env_kit');

/** A loaded file holding one top-level piece per (node, material) pair. */
function gltf(...pieces: [string, string][]) {
  const scene = new THREE.Group();
  for (const [node, material] of pieces) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ name: material, map: new THREE.Texture() }),
    );
    const piece = new THREE.Object3D();
    piece.name = node;
    piece.add(mesh);
    scene.add(piece);
  }
  return { scene };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function freshKit(): Promise<{ kit: Kit; ready: Promise<void> }> {
  vi.resetModules();
  fetches.pending.clear();
  const kit = await import('../src/render/smith_heart/quench_env_kit');
  const ready = kit.ensureQuenchEnvKit();
  await settle();
  return { kit, ready };
}

describe('the Quench painted kit loader', () => {
  beforeEach(() => {
    // The loader runs only in a page: the kit is never fetched under Node otherwise.
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches its one file at the raid door and is ready once it lands', async () => {
    const { kit, ready } = await freshKit();
    expect([...fetches.pending.keys()]).toEqual([KIT_URL]);
    expect(kit.quenchEnvKitReady()).toBe(false);
    expect(kit.quenchEnvPieceParts('Env_IceSword')).toBeNull();
    fetches.pending
      .get(KIT_URL)
      ?.resolve(
        gltf(
          ['Env_GlacierTall', 'tripo_material_env_glacier_tall'],
          ['Env_IceSword', 'tripo_material_env_ice_sword'],
        ),
      );
    await ready;
    expect(kit.quenchEnvKitReady()).toBe(true);
    expect(kit.quenchEnvHas('Env_GlacierTall')).toBe(true);
    expect(kit.quenchEnvHas('Env_GlacierWide')).toBe(false);
    expect([...(kit.quenchEnvPieceParts('Env_IceSword')?.keys() ?? [])]).toEqual(['ice_sword']);
  });

  it('is not ready when its file fails, and the old look draws', async () => {
    const { kit, ready } = await freshKit();
    fetches.pending.get(KIT_URL)?.reject(new Error('404'));
    await ready;
    expect(kit.quenchEnvKitReady()).toBe(false);
    expect(kit.quenchEnvHas('Env_GlacierTall')).toBe(false);
    expect(kit.quenchEnvProgramWarmers().children.length).toBe(0);
    expect(kit.quenchEnvLakePair()).toBeNull();
    expect(kit.quenchEnvSkyTexture()).toBeNull();
  });

  it('warms one hidden instanced carrier per landed painting, never the fight strips', async () => {
    const { kit, ready } = await freshKit();
    fetches.pending
      .get(KIT_URL)
      ?.resolve(
        gltf(
          ['Env_FireBowl', 'tripo_material_env_fire_bowl'],
          ['Env_IceSword', 'tripo_material_env_glow'],
        ),
      );
    await ready;
    const warm = kit.quenchEnvProgramWarmers();
    const carriers = warm.children.filter((o) => o instanceof THREE.InstancedMesh);
    expect(carriers.map((m) => m.name)).toEqual(['smithHeartQuenchEnvWarmer:fire_bowl']);
    // What a late build draws: the same material object, instanced, the same attributes.
    const drawn = kit
      .instanceQuenchEnv([{ piece: 'Env_FireBowl', x: 0, y: 0, z: 0, rot: 0 }], false, 't')
      .children.filter((o) => o instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
    expect(drawn.length).toBe(1);
    for (const m of carriers as THREE.InstancedMesh[]) {
      expect(m.material).toBe(kit.quenchEnvMaterial('fire_bowl'));
      expect(m.material).toBe(drawn[0].material);
      expect(Object.keys(m.geometry.attributes).sort()).toEqual(
        Object.keys(drawn[0].geometry.attributes).sort(),
      );
      expect(m.visible).toBe(false);
    }
  });

  it('paints the heightfield by the painting own value, handing the Heart its walls by the camera', async () => {
    const { ready } = await freshKit();
    fetches.pending.get(KIT_URL)?.resolve(gltf(['Tex_Cliff', 'tripo_material_env_cliff']));
    await ready;
    const { quenchRockPaintLayer } = await import(
      '../src/render/smith_heart/quench_env_rock_paint'
    );
    const layer = quenchRockPaintLayer();
    expect(layer).toBeTruthy();
    const m = new THREE.MeshStandardMaterial();
    layer?.(m);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader:
        '#include <common>\n#include <color_fragment>\n#include <emissivemap_fragment>',
    };
    m.onBeforeCompile(shader as never, {} as never);
    expect(shader.fragmentShader).toContain('quenchEnvWeight( vQuenchPaintLocal.xz, uQuenchCore )');
    expect(shader.fragmentShader).toContain(`vec3( ${QUENCH_ENV_FIELD_BASE.join(', ')} )`);
    // The same uniform object the rock kit's material reads (the frame driver sets it): the
    // module graph's own, reset with the kit.
    const cutaway = await import('../src/render/smith_heart/heart_rock_cutaway');
    expect(shader.uniforms.uQuenchCore).toBe(cutaway.heartRockCoreUniform());
  });

  it('cuts the glacier away round the camera, lights its cyan crystal, tiles its floors twice', async () => {
    const { kit } = await freshKit();
    const key = (painting: string) => kit.quenchEnvMaterial(painting).customProgramCacheKey();
    for (const stack of ['glacier_tall', 'glacier_wide', 'ice_spires', 'frozen_fall']) {
      expect(key(stack)).toContain('smith-heart-env-rock');
      expect(key(stack)).toContain('crystal');
      expect(key(stack)).toContain(':cyan');
      expect(key(stack)).toBe(key('glacier_tall'));
    }
    for (const prop of ['ice_plates', 'chevron_stone', 'ice_sword']) {
      expect(key(prop)).toContain('smith-heart-env-stone');
      expect(key(prop)).toContain(':cyan');
    }
    // The fight's swords keep the full light (the owner's note: brighter ice, like the
    // concept); the backdrop's bright highlights are pulled well down so the guardian pops off
    // it (the owner's note of 2026-11-09). The snow painting lifts, the masonry never.
    expect(key('ice_sword')).toContain(`crystal:${kit.QUENCH_ENV_CRYSTAL_GLOW}:cyan`);
    expect(key('ice_sword')).toContain(`ice:${kit.QUENCH_ENV_ICE_GLOW}`);
    expect(key('ice_sword')).toContain(`snow:${kit.QUENCH_ENV_SNOW_LIFT}`);
    const back = kit.QUENCH_ENV_BACKDROP_GLOW;
    for (const p of ['glacier_tall', 'frozen_fall', 'ice_spires', 'ice_plates', 'chevron_stone']) {
      expect(key(p)).toContain(`crystal:${back.crystal}:cyan`);
      expect(key(p)).toContain(`ice:${back.ice}`);
      expect(key(p)).toContain(`snow:${back.snow}`);
    }
    expect(back.crystal).toBeLessThan(kit.QUENCH_ENV_CRYSTAL_GLOW / 2);
    expect(back.ice).toBeLessThan(kit.QUENCH_ENV_ICE_GLOW / 2);
    expect(back.snow).toBeLessThan(kit.QUENCH_ENV_SNOW_LIFT / 2);
    expect(key('lake')).toContain(`ice:${back.ice}`);
    expect(key('snow')).toContain(`snow:${back.snow}`);
    // The backdrop's ice and snow a step darker than the realm's value; the swords and the
    // masonry keep it.
    const value = (painting: string) =>
      (kit.quenchEnvMaterial(painting) as THREE.MeshStandardMaterial).color.toArray();
    for (const p of ['glacier_tall', 'frozen_fall', 'lake', 'snow']) {
      expect(value(p)).toEqual([...kit.QUENCH_ENV_BACKDROP_ALBEDO]);
    }
    expect(value('ice_sword')).toEqual([...kit.QUENCH_ENV_ALBEDO]);
    expect(value('block')).toEqual([...kit.QUENCH_ENV_ALBEDO]);
    for (let c = 0; c < 3; c++)
      expect(kit.QUENCH_ENV_BACKDROP_ALBEDO[c]).toBeLessThan(kit.QUENCH_ENV_ALBEDO[c]);
    expect(key('block')).not.toContain('ice:');
    // The masonry draws no glow and takes no strokes.
    expect(key('block')).toBe(
      envLookKey({ cutaway: false, strokes: null, shade: kit.QUENCH_ENV_SHADE_FLOOR, crystal: 0 }),
    );
    // The rime floor reads its painting twice, turned (never a grid across the shelf).
    const floor = kit.quenchEnvFloorMaterial();
    expect(floor.customProgramCacheKey()).toContain('antiTile');
    const shader = {
      uniforms: {},
      vertexShader: '',
      fragmentShader: '#include <common>\n#include <map_fragment>',
    };
    floor.onBeforeCompile(shader as never, {} as never);
    expect(shader.fragmentShader).toContain('qvAntiTile( map, vMapUv )');
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
  });
});
