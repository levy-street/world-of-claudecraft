// The Breath vein's painted rebuild (design doc section 5.23): the shipped kit, what stands
// in for what, the promise kept from the Hammer's rebuild (the look only: every placement,
// walk and lip stays, and the lips and hung faces a body can fall past keep their sculpts),
// the paint's share of the mountain, and the loader. Every plan rule here is against the
// same layout the sim reads.

import { existsSync, readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BREATH_ENV_DROPS,
  BREATH_ENV_ROCK,
  BREATH_ENV_ROCK_PAINT,
  BREATH_ENV_ROCK_TILE,
  BREATH_ENV_STONE_H,
  BREATH_OLD_STONE_H,
  breathEnvOwnsRock,
  breathEnvRockGlsl,
  breathEnvRockPiece,
  breathEnvSwap,
  breathEnvWeight,
  breathEnvWeightGlsl,
  fitBreathEnvNeedle,
  fitBreathEnvRock,
} from '../src/render/smith_heart/breath_env_plan_core';
import { BREATH_WALL, planBreathKit } from '../src/render/smith_heart/breath_kit_plan_core';
import { breathRockStormWeight } from '../src/render/smith_heart/breath_rock_storm_core';
import { planBreathFarPeaks } from '../src/render/smith_heart/breath_summit_core';
import { envLookKey } from '../src/render/smith_heart/env_kit_look';
import {
  hammerEnvFrontClear,
  hammerEnvOwnsRock,
  hammerEnvWeight,
} from '../src/render/smith_heart/hammer_env_plan_core';
import { heartRockBreathGlsl } from '../src/render/smith_heart/heart_rock_cutaway';
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
import { breathEnvSolids } from '../src/render/smith_heart/heart_sightline_core';
import {
  BREATH,
  HEART_ROOM,
  RING,
  SMITH_HEART_FIELD,
  smithHeartAreaAt,
} from '../src/sim/content/smith_heart_layout';

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

const KIT = 'public/models/props/smith_heart_breath_env_kit.glb';
const KIT_URL = '/models/props/smith_heart_breath_env_kit.glb';
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

const rock = [...planHeartRock(), ...planHeartRockUnder()];
const swapped = rock.filter(breathEnvOwnsRock);

describe('the Breath painted kit as shipped', () => {
  it('ships, in KTX2, nothing past 1024, the backgrounds smaller', () => {
    expect(existsSync(KIT)).toBe(true);
    expect([...mimes]).toEqual(['image/ktx2']);
    expect(textureSizes.size).toBe(9);
    for (const [name, [w, h]] of textureSizes) {
      expect(w, name).toBeLessThanOrEqual(1024);
      expect(h, name).toBeLessThanOrEqual(1024);
    }
    const small = [...textureSizes.values()].filter(([w, h]) => w * h <= 512 * 512);
    expect(small.length).toBeGreaterThanOrEqual(4);
    expect(readFileSync(KIT).length).toBeLessThan(6 * 1024 * 1024);
  });

  it('holds every piece the plans place, at the measures the plan fits', () => {
    const placed = new Set(
      [
        ...swapped.map(fitBreathEnvRock),
        ...planHeartNeedles().filter(breathEnvOwnsRock).map(fitBreathEnvNeedle),
        ...planBreathFarPeaks().map(fitBreathEnvNeedle),
        ...breathEnvSwap(planBreathKit()).swap,
      ].map((p) => p.piece),
    );
    expect(placed.size).toBeGreaterThanOrEqual(9);
    for (const piece of placed) expect(shapes.has(piece), piece).toBe(true);
    for (const [piece, m] of Object.entries(BREATH_ENV_ROCK)) {
      const s = shape(piece);
      expect(s.max[0] - s.min[0], `${piece} width`).toBeCloseTo(m.w, 0);
      expect(s.max[1] - s.min[1], `${piece} height`).toBeCloseTo(m.h, 0);
      expect(s.max[2] - s.min[2], `${piece} depth`).toBeCloseTo(m.d, 0);
      // Foot on the ground, front plane at z 0, the body behind it.
      expect(s.min[1]).toBeCloseTo(0, 1);
      expect(s.max[2]).toBeCloseTo(0, 1);
    }
    // The Tex_* carriers of the floor's, the rock paint's and the sky's paintings. The cliff
    // is read only through uniforms an onBeforeCompile adds (the strokes, the rock's and the
    // heightfield's paint), which the gate's upload lane cannot see: its carrier puts it in a
    // material's map slot, so the warmers upload it behind the curtain.
    for (const tex of ['Tex_Slab', 'Tex_SlabN', 'Tex_Cliff', 'Tex_Block', 'Tex_Sky'])
      expect(shapes.has(tex), tex).toBe(true);
  });

  it('stays cheap: the paint carries the look, not the triangles', () => {
    for (const p of ['Env_StormSpire', 'Env_StormBluff', 'Env_StormArch'])
      expect(shape(p).tris, p).toBeLessThanOrEqual(3400);
    for (const p of ['Env_StormSpireFar', 'Env_StormBluffFar', 'Env_StormArchFar'])
      expect(shape(p).tris, p).toBeLessThanOrEqual(1600);
    // The old stone was 2,378 triangles, the walls 730 and 824, the shelter 1,500.
    expect(shape('Env_StormStone').tris).toBeLessThanOrEqual(2800);
    expect(shape('Env_BreathWallA').tris).toBeLessThan(400);
    expect(shape('Env_WindShelter').tris).toBeLessThan(200);
  });

  it('stands the stone inside its collider, as tall as the old one', () => {
    const s = shape('Env_StormStone');
    expect(s.min[1]).toBeCloseTo(0, 1);
    expect(s.max[1]).toBeCloseTo(BREATH_ENV_STONE_H, 1);
    const k = BREATH_OLD_STONE_H / BREATH_ENV_STONE_H;
    const reach = Math.max(...s.points.map((p) => Math.hypot(p[0], p[2])));
    // The layout's stones' colliders are 1.6 yd round, a body's width allowed.
    expect(reach * k).toBeLessThanOrEqual(1.6 + 0.5);
    for (const p of F.props.filter((x) => x.kind === 'sh_storm_stone'))
      expect(p.r ?? 0).toBeGreaterThanOrEqual(1.6);
  });

  it('keeps the walls and the shelter in the old pieces frames', () => {
    for (const v of ['A', 'B']) {
      const s = shape(`Env_BreathWall${v}`);
      // Over the walk (the lip's inner side, game -Z) nothing rises past it; above the walk
      // the wall stands inside the old module's span past the lip, a knee high.
      for (const p of s.points) {
        if (p[2] < 0.04) expect(p[1], v).toBeLessThan(0.05);
        if (p[1] > 0.05) expect(p[2], v).toBeLessThanOrEqual(BREATH_WALL.far + 0.05);
      }
      expect(s.max[1], v).toBeGreaterThan(0.8);
      expect(s.max[1], v).toBeLessThan(1.1);
      // Its cliff under the lip a little further out, over the void.
      expect(s.max[2], v).toBeLessThanOrEqual(1.2);
      expect(Math.abs(s.min[0] + 3)).toBeLessThan(0.1);
      expect(Math.abs(s.max[0] - 3)).toBeLessThan(0.1);
    }
    const shelter = shape('Env_WindShelter');
    expect(shelter.min[1]).toBeGreaterThan(-0.05);
    expect(shelter.max[1]).toBeLessThan(2.1);
    for (const k of [0, 2]) {
      expect(Math.max(-shelter.min[k], shelter.max[k])).toBeLessThanOrEqual(k === 0 ? 2.45 : 0.75);
    }
  });
});

describe('the look only: every placement, walk and lip stays', () => {
  const plan = planBreathKit();
  const { keep, swap } = breathEnvSwap(plan);

  it('stands every swapped piece on its old placement, and drops only the flat inlays', () => {
    const spots = new Set(plan.map((p) => `${p.x}|${p.y}|${p.z}|${p.rot}`));
    expect(swap.length).toBeGreaterThan(100);
    for (const p of swap) expect(spots.has(`${p.x}|${p.y}|${p.z}|${p.rot}`)).toBe(true);
    const dropped = plan.filter(
      (p) => !keep.includes(p) && !swap.some((s) => s.x === p.x && s.z === p.z && s.rot === p.rot),
    );
    for (const p of dropped) expect(BREATH_ENV_DROPS.has(p.piece), p.piece).toBe(true);
    // The Wind Bridge's arch stays the old kit's: the field keeps a shallow keel under it.
    expect(keep.some((p) => p.piece === 'Kit_WindBridge')).toBe(true);
    expect(keep.every((p) => p.piece.startsWith('Kit_'))).toBe(true);
    expect(swap.every((p) => p.piece.startsWith('Env_'))).toBe(true);
  });

  it('stands each stone as tall as the old one, a chip as small as its chip', () => {
    const olds = plan.filter((p) => p.piece === 'Kit_StormStone');
    const news = swap.filter((p) => p.piece === 'Env_StormStone');
    expect(news.length).toBe(olds.length);
    for (const p of news) {
      const old = olds.find((o) => o.x === p.x && o.z === p.z);
      expect(old).toBeTruthy();
      expect((p.scale ?? 1) * BREATH_ENV_STONE_H).toBeCloseTo(
        (old?.scale ?? 1) * BREATH_OLD_STONE_H,
        6,
      );
    }
  });

  it('keeps a swap whose piece did not bake on the old kit', () => {
    const none = breathEnvSwap(plan, () => false);
    expect(none.swap).toEqual([]);
    expect(none.keep.length + plan.filter((p) => BREATH_ENV_DROPS.has(p.piece)).length).toBe(
      plan.length,
    );
  });

  it('leaves the lips and the hung faces to the rock kit (the Cornice rim tuck holds)', () => {
    // Nothing of the plan swaps a lip or a hang: the rock kit draws them all, painted.
    const lipsAndHangs = [...planHeartRockLips(), ...planHeartHangs()];
    expect(
      lipsAndHangs.filter((p) => smithHeartAreaAt(p.x, p.z) === 'breath').length,
    ).toBeGreaterThan(20);
    for (const p of lipsAndHangs) expect(p.piece.startsWith('Kit_')).toBe(true);
  });
});

describe('the storm mountain', () => {
  it('takes the vein and the skyline facing it, never the Hammer or the Heart', () => {
    expect(swapped.length).toBeGreaterThan(60);
    const all = [...rock, ...planHeartNeedles()];
    for (const p of all) {
      if (hammerEnvOwnsRock(p)) expect(breathEnvOwnsRock(p)).toBe(false);
      if (smithHeartAreaAt(p.x, p.z) === 'heart') expect(breathEnvOwnsRock(p)).toBe(false);
      if (smithHeartAreaAt(p.x, p.z) === 'breath') expect(breathEnvOwnsRock(p)).toBe(true);
    }
  });

  it('never stands a front on a walk, and keeps each spot, foot and height', () => {
    const bad: string[] = [];
    for (const old of swapped) {
      const p = fitBreathEnvRock(old);
      const m = BREATH_ENV_ROCK[p.piece.replace(/Far$/, '')];
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
    for (const old of swapped) {
      const piece = breathEnvRockPiece(old);
      expect(piece.endsWith('Far')).toBe(old.piece.endsWith('Far'));
    }
  });

  it('stands a spire where each needle stood, as tall, never wider than its foot', () => {
    for (const old of [...planBreathFarPeaks(), ...planHeartNeedles().filter(breathEnvOwnsRock)]) {
      const p = fitBreathEnvNeedle(old);
      const n = HEART_ROCK_NEEDLES[old.piece];
      const m = BREATH_ENV_ROCK.Env_StormSpire;
      const k = p.scale ?? 1;
      expect(p.y).toBe(old.y);
      expect(m.h * k * (p.rise ?? 1)).toBeCloseTo(n.height * (old.scale ?? 1), 3);
      expect((m.w * k * (p.stretch ?? 1)) / 2).toBeCloseTo(n.half * (old.scale ?? 1), 3);
      // Its body centred on the needle's foot: the front half its depth forward.
      const back = Math.hypot(p.x - old.x, p.z - old.z);
      expect(back).toBeCloseTo((m.d * k) / 2, 3);
    }
    expect(planBreathFarPeaks().length).toBeGreaterThan(4);
    // The crest's spires join the sightline pin (heart_sightline_core.ts): never vacuous.
    const crest = planHeartNeedles().filter(breathEnvOwnsRock);
    expect(crest.length).toBeGreaterThan(0);
    expect(breathEnvSolids().length).toBe(crest.length);
  });

  it('paints where the storm granite held, fading out before the Ring, the Heart and the Hammer', () => {
    expect(breathEnvWeight(BREATH.b2.x, BREATH.b2.z)).toBeCloseTo(1, 6);
    expect(breathEnvWeight(BREATH.cornice.x, BREATH.cornice.z)).toBeCloseTo(1, 6);
    for (const [x, z] of [
      [0, 0],
      [RING.x, RING.z + RING.outerR],
      [HEART_ROOM.x, HEART_ROOM.z],
      [0, -150],
      [180, 0],
    ])
      expect(breathEnvWeight(x, z), `${x},${z}`).toBe(0);
    for (let x = -300; x <= 300; x += 12)
      for (let z = -300; z <= 300; z += 12) {
        expect(breathEnvWeight(x, z)).toBeCloseTo(breathRockStormWeight(x, z), 9);
        // The two veins' paints never both hold at full strength.
        expect(breathEnvWeight(x, z) + hammerEnvWeight(x, z), `${x},${z}`).toBeLessThanOrEqual(
          1.0001,
        );
      }
    const glsl = breathEnvWeightGlsl();
    for (const n of [RING.outerR, HEART_ROOM.x, HEART_ROOM.z]) expect(glsl).toContain(n.toFixed(2));
  });

  it('keeps each surface its own value under the painting, its gradients explicit', () => {
    const glsl = breathEnvRockGlsl();
    const P = BREATH_ENV_ROCK_PAINT;
    // Every read takes its gradients from the caller: none may read an implicit derivative
    // behind the per-fragment weight.
    expect(glsl).not.toMatch(/texture2D\(|texture\(/);
    expect(glsl.match(/textureGrad\(/g)?.length).toBe(7);
    expect(glsl).toContain(`kA = ${(1 / BREATH_ENV_ROCK_TILE.a).toFixed(5)}`);
    expect(glsl).toContain(P.mean.toFixed(3));
    expect(glsl).toContain('dot( base, lumaW )');
    // The rock kit's material reads it behind the painted flag, the gradients taken there.
    const rockGlsl = heartRockBreathGlsl();
    expect(rockGlsl).toContain('uBreathPainted > 0.5');
    expect(rockGlsl.indexOf('dFdx')).toBeLessThan(rockGlsl.indexOf('breathEnvWeight'));
  });
});

// ---- the loader ---------------------------------------------------------------------

type Kit = typeof import('../src/render/smith_heart/breath_env_kit');

/** A loaded file holding one top-level piece of one painting. */
function gltf(node: string, material: string) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
  );
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ name: material }));
  const piece = new THREE.Object3D();
  piece.name = node;
  piece.add(mesh);
  const scene = new THREE.Group();
  scene.add(piece);
  return { scene };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function freshKit(): Promise<{ kit: Kit; ready: Promise<void> }> {
  vi.resetModules();
  fetches.pending.clear();
  const kit = await import('../src/render/smith_heart/breath_env_kit');
  const ready = kit.ensureBreathEnvKit();
  await settle();
  return { kit, ready };
}

describe('the Breath painted kit loader', () => {
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
    expect(kit.breathEnvKitReady()).toBe(false);
    fetches.pending.get(KIT_URL)?.resolve(gltf('Env_StormSpire', 'tripo_material_env_storm_spire'));
    await ready;
    expect(kit.breathEnvKitReady()).toBe(true);
    expect(kit.breathEnvHas('Env_StormSpire')).toBe(true);
    expect(kit.breathEnvHas('Env_StormBluff')).toBe(false);
  });

  it('is not ready when its file fails, and the old look draws', async () => {
    const { kit, ready } = await freshKit();
    fetches.pending.get(KIT_URL)?.reject(new Error('404'));
    await ready;
    expect(kit.breathEnvKitReady()).toBe(false);
    expect(kit.breathEnvHas('Env_StormSpire')).toBe(false);
    expect(kit.breathEnvProgramWarmers().children.length).toBe(0);
  });

  it('warms one hidden instanced carrier per landed painting, in the shape the pieces draw', async () => {
    const { kit, ready } = await freshKit();
    fetches.pending.get(KIT_URL)?.resolve(gltf('Env_StormStone', 'tripo_material_env_storm_stone'));
    await ready;
    const warm = kit.breathEnvProgramWarmers();
    const carriers = warm.children.filter((o) => o instanceof THREE.InstancedMesh);
    expect(carriers.map((m) => m.name)).toEqual(['smithHeartBreathEnvWarmer:storm_stone']);
    // What a late build draws: the same material object, instanced, the same attributes,
    // so the program the warmer linked behind the curtain is the one it draws with.
    const drawn = kit
      .instanceBreathEnv([{ piece: 'Env_StormStone', x: 0, y: 0, z: 0, rot: 0 }], false, 't')
      .children.filter((o) => o instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
    expect(drawn.length).toBe(1);
    for (const m of carriers as THREE.InstancedMesh[]) {
      expect(m.material).toBe(kit.breathEnvMaterial('storm_stone'));
      expect(m.material).toBe(drawn[0].material);
      expect(Object.keys(m.geometry.attributes).sort()).toEqual(
        Object.keys(drawn[0].geometry.attributes).sort(),
      );
      expect(m.receiveShadow).toBe(drawn[0].receiveShadow);
      expect(m.visible).toBe(false);
    }
  });

  it('cuts the stacks away round the camera and lights every painted crystal', async () => {
    const { kit } = await freshKit();
    const key = (painting: string) => kit.breathEnvMaterial(painting).customProgramCacheKey();
    for (const stack of ['storm_spire', 'storm_bluff', 'storm_arch']) {
      expect(key(stack)).toContain('smith-heart-env-rock');
      expect(key(stack)).toContain('crystal');
      expect(key(stack)).toBe(key('storm_spire'));
    }
    expect(key('storm_stone')).toContain('smith-heart-env-stone');
    expect(key('storm_stone')).toContain('crystal');
    // The masonry draws no glow and takes no strokes.
    expect(key('block')).toBe(
      envLookKey({ cutaway: false, strokes: null, shade: kit.BREATH_ENV_SHADE_FLOOR, crystal: 0 }),
    );
  });
});
