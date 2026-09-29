import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  CANNON_SMOKE_OCCLUSION_MAX,
  type CannonPuff,
  cannonBlastPower,
  cannonBlastPuffs,
  cannonPuffInto,
  newCannonPuff,
  newCannonPuffFrame,
  PUFF,
} from '../src/render/cannon_puff_core';
import { cannonShotCounts } from '../src/render/cannon_shell_core';
import {
  newTurretBarrelFuseFrame,
  newTurretShard,
  TURRET_BARREL_FIRE_PUFFS,
  TURRET_BARREL_FIREBALLS,
  TURRET_BARREL_FLAMES,
  TURRET_BARREL_LOOK,
  TURRET_BARREL_MODEL_URL,
  TURRET_BARREL_SHARDS,
  TURRET_FUSE_FIXED_PUFFS,
  TURRET_FUSE_PUFFS,
  TURRET_KEG_BARE_ASPECT,
  TURRET_KEG_BOMB,
  TURRET_KEG_MARK,
  TURRET_KEG_MARK_FRAME,
  TURRET_KEG_SHAPE,
  TURRET_KEG_WICK,
  TURRET_KEG_WOOD,
  TURRET_SHARD_BAND_SHADE,
  type TurretKegPoint,
  type TurretShardFrame,
  turretBarrelCounts,
  turretBarrelFireInto,
  turretBarrelFirePuffs,
  turretBarrelFuseInto,
  turretBarrelPop,
  turretBarrelRingRadius,
  turretFuseSparksInto,
  turretKegBombTriangles,
  turretKegFacetNormalInto,
  turretKegMarkLayout,
  turretKegMarkTexels,
  turretKegWickInto,
  turretKegWickTipInto,
  turretKegWoodInto,
  turretKegYaw,
  turretPuffsEnd,
  turretShardInto,
  turretShardLaunch,
} from '../src/render/turret_barrel_core';
import { TURRET_CONTACT_PUFFS } from '../src/render/turret_contact_dust_core';
import { TURRET_EXPLOSIVE_BARREL } from '../src/sim/content/turret_defense';
import {
  occlusionTargets,
  smokeOcclusionPeak,
  TURRET_CAMERA_EYE,
} from './helpers/cannon_smoke_occlusion';

const pool = (n: number): CannonPuff[] => Array.from({ length: n }, newCannonPuff);
const flat = () => 0;
const FUSE = TURRET_EXPLOSIVE_BARREL.fuseTicks / 20;
const H = TURRET_EXPLOSIVE_BARREL.height;
const point = (): TurretKegPoint => ({ x: 0, y: 0, z: 0 });

interface KegModel {
  /** Vertices in shares of its height, its foot at 0; triangles; uvs; normals; the atlas's KTX2 bytes; its primitives and materials. */
  v: number[][];
  tris: number[][];
  uv: number[][];
  n: number[][];
  atlas: Uint8Array;
  primitives: number;
  materials: number;
}

let kegModelRead: Promise<KegModel> | null = null;

/** hex_barrel.glb as its one mesh and its palette atlas. */
function kegModel(): Promise<KegModel> {
  kegModelRead ??= readKegModel();
  return kegModelRead;
}

async function readKegModel(): Promise<KegModel> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const root = (await io.read(`public${TURRET_BARREL_MODEL_URL}`)).getRoot();
  const nodes = root.listNodes().filter((n) => n.getMesh());
  expect(nodes).toHaveLength(1);
  const node = nodes[0];
  const prim = node.getMesh()?.listPrimitives()[0];
  const position = prim?.getAttribute('POSITION');
  const texcoord = prim?.getAttribute('TEXCOORD_0');
  const normal = prim?.getAttribute('NORMAL');
  const indices = prim?.getIndices();
  const atlas = prim?.getMaterial()?.getBaseColorTexture()?.getImage();
  if (!position || !texcoord || !normal || !indices || !atlas) {
    throw new Error('the keg has no textured triangles');
  }
  const m = node.getWorldMatrix();
  const raw: number[][] = [];
  const uv: number[][] = [];
  const n: number[][] = [];
  const e: number[] = [];
  for (let i = 0; i < position.getCount(); i++) {
    position.getElement(i, e);
    raw.push([
      m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
      m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
      m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
    ]);
    uv.push(texcoord.getElement(i, []));
    const d = normal.getElement(i, []);
    const len = Math.hypot(d[0], d[1], d[2]);
    n.push([d[0] / len, d[1] / len, d[2] / len]);
  }
  const lo = Math.min(...raw.map((p) => p[1]));
  const height = Math.max(...raw.map((p) => p[1])) - lo;
  const v = raw.map(([x, y, z]) => [x / height, (y - lo) / height, z / height]);
  const tris: number[][] = [];
  for (let i = 0; i < indices.getCount(); i += 3) {
    tris.push([indices.getScalar(i), indices.getScalar(i + 1), indices.getScalar(i + 2)]);
  }
  return {
    v,
    tris,
    uv,
    n,
    atlas,
    primitives: node.getMesh()?.listPrimitives().length ?? 0,
    materials: root.listMaterials().length,
  };
}

/** The painted facet's triangles: flat, upright, facing its bearing, across the bare staves. */
function facetTriangles({ v, tris }: KegModel): number[][] {
  const k = TURRET_KEG_SHAPE;
  return tris.filter(([a, b, c]) => {
    const e1 = [0, 1, 2].map((i) => v[b][i] - v[a][i]);
    const e2 = [0, 1, 2].map((i) => v[c][i] - v[a][i]);
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const len = Math.hypot(n[0], n[1], n[2]);
    const along = (n[0] * Math.sin(k.markFacet) + n[2] * Math.cos(k.markFacet)) / len;
    const lowY = Math.min(v[a][1], v[b][1], v[c][1]);
    return along > 0.9999 && Math.abs(lowY - k.bareLow) < 1e-3;
  });
}

interface BasisFile {
  startTranscoding(): boolean;
  getWidth(): number;
  getHeight(): number;
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number;
  transcodeImage(
    dst: Uint8Array,
    level: number,
    layer: number,
    face: number,
    format: number,
    flags: number,
    rowPitch: number,
    outputRows: number,
  ): boolean;
  close(): void;
  delete(): void;
}

type BasisFactory = (opts: { wasmBinary: Buffer }) => Promise<{
  initializeBasis(): void;
  KTX2File: new (data: Uint8Array) => BasisFile;
}>;

const TRANSCODE_RGBA32 = 13;

/** The atlas as the shipped transcoder decodes its top level, rows from the top (glTF v down). */
async function decodeAtlas(ktx2: Uint8Array): Promise<{ size: number; rgba: Uint8Array }> {
  const dir = path.resolve('public', 'basis');
  const file = path.join(dir, 'basis_transcoder.js');
  // The shipped transcoder is a UMD script and the package is ESM, so it
  // cannot be required: it runs with a CommonJS module handed in, as in
  // tests/basis_transcoder_csp.test.ts.
  const shim = { exports: {} as unknown };
  new Function(
    'module',
    'exports',
    'require',
    '__filename',
    '__dirname',
    readFileSync(file, 'utf8'),
  )(shim, shim.exports, createRequire(file), file, dir);
  const basis = await (shim.exports as BasisFactory)({
    wasmBinary: readFileSync(path.join(dir, 'basis_transcoder.wasm')),
  });
  basis.initializeBasis();
  const ktx = new basis.KTX2File(ktx2);
  expect(ktx.startTranscoding()).toBeTruthy();
  const size = ktx.getWidth();
  expect(ktx.getHeight()).toBe(size);
  const rgba = new Uint8Array(ktx.getImageTranscodedSizeInBytes(0, 0, 0, TRANSCODE_RGBA32));
  expect(ktx.transcodeImage(rgba, 0, 0, 0, TRANSCODE_RGBA32, 0, -1, -1)).toBeTruthy();
  ktx.close();
  ktx.delete();
  return { size, rgba };
}

const LAYOUT = turretKegMarkLayout(TURRET_KEG_MARK.texels);
const MARK_ROWS = LAYOUT.height - LAYOUT.markRow;
const ASPECT = TURRET_KEG_BARE_ASPECT;
const lum = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The mark texture's texel under facet point (x, y) in mark units, as RGBA bytes. */
function markTexel(data: Uint8Array, x: number, y: number): number[] {
  const i = Math.min(LAYOUT.width - 1, Math.max(0, Math.floor(((x + 1) / 2) * LAYOUT.width)));
  const j = Math.min(MARK_ROWS - 1, Math.max(0, Math.floor(((y / ASPECT + 1) / 2) * MARK_ROWS)));
  const at = ((LAYOUT.markRow + j) * LAYOUT.width + i) * 4;
  return [data[at], data[at + 1], data[at + 2], data[at + 3]];
}

/** The keg's wood at mark height y, rounded as the texture stores it. */
function woodAt(y: number): number[] {
  return turretKegWoodInto([0, 0, 0], y).map((c) => Math.round(c));
}

/** The bomb's fuse as a fine polyline in mark units, with the distance along it at each point. */
function fuseLine(): { x: number; y: number; s: number }[] {
  const f = TURRET_KEG_BOMB.fuse;
  const out: { x: number; y: number; s: number }[] = [];
  for (let curve = 0; curve < 2; curve++) {
    const o = curve * 6;
    for (let k = curve === 0 ? 0 : 1; k <= 400; k++) {
      const t = k / 400;
      const u = 1 - t;
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      const x = w[0] * f[o] + w[1] * f[o + 2] + w[2] * f[o + 4] + w[3] * f[o + 6];
      const y = w[0] * f[o + 1] + w[1] * f[o + 3] + w[2] * f[o + 5] + w[3] * f[o + 7];
      const prev = out[out.length - 1];
      out.push({ x, y, s: prev ? prev.s + Math.hypot(x - prev.x, y - prev.y) : 0 });
    }
  }
  return out;
}

/** Whether (x, y) lies in one of the mesh's triangles (wound counter-clockwise). */
function inMesh(tris: readonly number[], x: number, y: number): boolean {
  for (let t = 0; t < tris.length; t += 6) {
    const [ax, ay, bx, by, cx, cy] = tris.slice(t, t + 6);
    if (
      (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0 &&
      (cx - bx) * (y - by) - (cy - by) * (x - bx) >= 0 &&
      (ax - cx) * (y - cy) - (ay - cy) * (x - cx) >= 0
    ) {
      return true;
    }
  }
  return false;
}

describe('a standing barrel', () => {
  it('pops up to its size with a little overshoot, then holds', () => {
    expect(turretBarrelPop(0)).toBe(0);
    expect(turretBarrelPop(-1)).toBe(0);
    const samples = Array.from({ length: 36 }, (_, i) =>
      turretBarrelPop((i + 1) * (TURRET_BARREL_LOOK.popSeconds / 36)),
    );
    expect(Math.max(...samples)).toBeGreaterThan(1.02);
    expect(Math.max(...samples)).toBeLessThan(1.15);
    expect(samples[0]).toBeGreaterThan(0);
    expect(turretBarrelPop(TURRET_BARREL_LOOK.popSeconds)).toBe(1);
    expect(turretBarrelPop(10)).toBe(1);
  });

  it('breathes its warning ring gently while unlit and throbs it wide once lit', () => {
    const { ringRadius, ringPulse, litRingPulse } = TURRET_BARREL_LOOK;
    let lo = Number.POSITIVE_INFINITY;
    let hi = 0;
    let litHi = 0;
    for (let t = 0; t < 3; t += 0.01) {
      const r = turretBarrelRingRadius(t, null, 5);
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
      const lit = turretBarrelRingRadius(t, t * 0.1, 5);
      expect(lit).toBeGreaterThanOrEqual(ringRadius - 1e-9);
      litHi = Math.max(litHi, lit);
    }
    expect(lo).toBeGreaterThanOrEqual(ringRadius * (1 - ringPulse) - 1e-9);
    expect(hi).toBeLessThanOrEqual(ringRadius * (1 + ringPulse) + 1e-9);
    expect(litHi).toBeCloseTo(ringRadius * (1 + litRingPulse), 3);
    // Readable at the clearing's far side: never smaller than the keg it sits under.
    expect(lo * TURRET_BARREL_LOOK.ringInner).toBeGreaterThan(TURRET_EXPLOSIVE_BARREL.radius);
  });

  it('rattles harder and swells as its fuse burns down, the same way every time', () => {
    const f = newTurretBarrelFuseFrame();
    const { shakeOffset, shakeTilt, swell } = TURRET_BARREL_LOOK;
    let early = 0;
    let late = 0;
    for (let i = 0; i <= 50; i++) {
      const age = (i / 50) * FUSE;
      turretBarrelFuseInto(f, age, FUSE, 7);
      expect(Math.abs(f.dx)).toBeLessThanOrEqual(shakeOffset + 1e-12);
      expect(Math.abs(f.dz)).toBeLessThanOrEqual(shakeOffset + 1e-12);
      expect(Math.abs(f.tiltX)).toBeLessThanOrEqual(shakeTilt + 1e-12);
      expect(Math.abs(f.tiltZ)).toBeLessThanOrEqual(shakeTilt + 1e-12);
      const size = Math.hypot(f.dx, f.dz);
      if (i < 10) early = Math.max(early, size);
      if (i > 40) late = Math.max(late, size);
    }
    expect(late).toBeGreaterThan(early);
    expect(turretBarrelFuseInto(f, 0, FUSE, 7).swell).toBe(1);
    expect(turretBarrelFuseInto(f, FUSE, FUSE, 7).swell).toBeCloseTo(1 + swell, 12);
    const a = { ...turretBarrelFuseInto(f, 0.1, FUSE, 7) };
    expect(turretBarrelFuseInto(newTurretBarrelFuseFrame(), 0.1, FUSE, 7)).toEqual(a);
    expect(turretBarrelFuseInto(newTurretBarrelFuseFrame(), 0.1, FUSE, 8)).not.toEqual(a);
  });
});

describe('the fuse', () => {
  it('glows on the wick tip for the whole fuse and sprays its sparks from it, onto the ground', () => {
    const out = pool(TURRET_CONTACT_PUFFS);
    expect(TURRET_FUSE_PUFFS).toBeLessThanOrEqual(TURRET_CONTACT_PUFFS);
    const sparks = turretBarrelCounts(false).fuseSparks;
    const tip = turretKegWickTipInto(point(), 10, 2, 20, 0.7);
    const n = turretFuseSparksInto(out, 3, tip.x, tip.y, tip.z, 2, FUSE, sparks);
    expect(n).toBe(TURRET_FUSE_FIXED_PUFFS + sparks);
    expect(out[0]).toMatchObject({ kind: PUFF.glow, x: tip.x, z: tip.z });
    expect(out[0].y - tip.y).toBeGreaterThanOrEqual(0);
    expect(out[0].y - tip.y).toBeLessThan(0.1);
    expect(out[0].life).toBeGreaterThanOrEqual(FUSE);
    expect(out.slice(1, 3).every((p) => p.kind === PUFF.flame)).toBe(true);
    const sprayed = out.slice(TURRET_FUSE_FIXED_PUFFS, n);
    expect(sprayed.every((p) => p.kind === PUFF.spark && p.vy > 0 && p.floorY === 2.05)).toBe(true);
    // The keg swells from its foot through the fuse, lifting the tip: every
    // puff starts on the tip as it stands at its delay, the glow rising with it.
    const tipAt = (age: number) =>
      2 + (tip.y - 2) * turretBarrelFuseInto(newTurretBarrelFuseFrame(), age, FUSE, 3).swell;
    expect(tipAt(FUSE) - tip.y).toBeGreaterThan(0.1);
    for (const p of sprayed) {
      expect(Math.hypot(p.x - tip.x, p.z - tip.z)).toBeLessThan(0.05);
      expect(p.y).toBeCloseTo(tipAt(p.delay), 9);
    }
    for (const p of out.slice(1, 3)) expect(p.y - tipAt(p.delay)).toBeCloseTo(0.02, 9);
    const glow = newCannonPuffFrame();
    for (let i = 0; i <= 20; i++) {
      const age = (i / 20) * FUSE;
      expect(cannonPuffInto(out[0], age, glow)).toBe(true);
      expect(glow.y - tipAt(age)).toBeGreaterThanOrEqual(0);
      expect(glow.y - tipAt(age)).toBeLessThan(0.1);
    }
    const delays = sprayed.map((p) => p.delay);
    expect(Math.min(...delays)).toBe(0);
    expect(Math.max(...delays)).toBeLessThan(FUSE);
    expect(turretPuffsEnd(out, n)).toBeGreaterThanOrEqual(FUSE);
    // The low preset keeps the glow and the licks and sheds sparks only.
    const lowN = turretFuseSparksInto(
      out,
      3,
      10,
      3.3,
      20,
      2,
      FUSE,
      turretBarrelCounts(true).fuseSparks,
    );
    expect(lowN).toBe(TURRET_FUSE_FIXED_PUFFS + turretBarrelCounts(true).fuseSparks);
    expect(lowN).toBeLessThan(n);
  });
});

describe('the blast', () => {
  const embers = turretBarrelCounts(false).embers;

  function column(seed = 9, per = TURRET_CONTACT_PUFFS): CannonPuff[] {
    const out: CannonPuff[] = [];
    const total = turretBarrelFirePuffs(embers);
    for (let first = 0; first < total; first += per) {
      const burst = pool(per);
      const n = turretBarrelFireInto(burst, first, total - first, seed, 0, 0, 30, 0, embers);
      out.push(...burst.slice(0, n));
    }
    return out;
  }

  it('fills its fire column across bursts as one recipe, whatever the burst size', () => {
    const whole = pool(64);
    const total = turretBarrelFirePuffs(embers);
    expect(total).toBe(TURRET_BARREL_FIRE_PUFFS);
    expect(turretBarrelFireInto(whole, 0, 64, 9, 0, 0, 30, 0, embers)).toBe(total);
    expect(column(9, TURRET_CONTACT_PUFFS)).toEqual(whole.slice(0, total));
    expect(column(9, 7)).toEqual(whole.slice(0, total));
    expect(turretBarrelFireInto(pool(5), total, 5, 9, 0, 0, 30, 0, embers)).toBe(0);
    const count = (kind: number) => whole.slice(0, total).filter((p) => p.kind === kind).length;
    expect(count(PUFF.fireball)).toBe(TURRET_BARREL_FIREBALLS);
    expect(count(PUFF.flame)).toBe(TURRET_BARREL_FLAMES);
    expect(count(PUFF.spark)).toBe(embers);
    expect(turretBarrelFirePuffs(turretBarrelCounts(true).embers)).toBeLessThan(total);
  });

  it('rises in a tall column, well above a shell fireball', () => {
    const puffs = column();
    const f = newCannonPuffFrame();
    let top = 0;
    for (const p of puffs) {
      if (p.kind !== PUFF.fireball) continue;
      for (let t = 0; t < 2; t += 0.05) if (cannonPuffInto(p, t, f)) top = Math.max(top, f.y);
    }
    const shell = pool(80);
    const n = cannonBlastPuffs(
      shell,
      9,
      0,
      0,
      30,
      6,
      1.3,
      { dust: 8, dirt: 24, sparks: 16, smoke: 0 },
      flat,
      0,
    );
    let shellTop = 0;
    for (let i = 0; i < n; i++) {
      if (shell[i].kind !== PUFF.fireball) continue;
      for (let t = 0; t < 2; t += 0.05)
        if (cannonPuffInto(shell[i], t, f)) shellTop = Math.max(shellTop, f.y);
    }
    expect(top).toBeGreaterThan(5);
    expect(top).toBeGreaterThan(shellTop * 1.5);
  });

  it('never lets a barrel blast hide more than the cap of a monster behind it, on high or on low', () => {
    const worst = (low: boolean): number => {
      const counts = cannonShotCounts(low);
      const barrel = turretBarrelCounts(low);
      const puffs = pool(260);
      let peak = 0;
      for (const seed of [3, 7, 19]) {
        for (const hit of [0, 1]) {
          for (const d of [16, 30]) {
            const power = cannonBlastPower([{ falloff: hit }]) * TURRET_BARREL_LOOK.blastScale;
            const n = cannonBlastPuffs(
              puffs,
              -seed,
              0,
              0,
              d,
              TURRET_EXPLOSIVE_BARREL.blastRadius,
              power,
              { ...counts, smoke: 0 },
              flat,
              0,
            );
            const fire = pool(turretBarrelFirePuffs(barrel.embers));
            const k = turretBarrelFireInto(fire, 0, fire.length, seed, 0, 0, d, 0, barrel.embers);
            const all = [...puffs.slice(0, n), ...fire.slice(0, k)];
            const at = occlusionTargets(0, d);
            peak = Math.max(peak, smokeOcclusionPeak(all, all.length, TURRET_CAMERA_EYE, at, 2.2));
          }
        }
      }
      return peak;
    };
    const high = worst(false);
    const lowest = worst(true);
    expect(high).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
    expect(lowest).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
  });
});

describe('the shards', () => {
  it('fly out all around and high, the lid highest, then land and lie on the floor', () => {
    const count = TURRET_BARREL_SHARDS.perBlast;
    const shards = Array.from({ length: count }, (_, i) =>
      turretShardLaunch(newTurretShard(), 4, i, count, 5, 1, 7, () => 1),
    );
    const bearings = shards.map((s) => Math.atan2(s.vx, s.vz));
    const sorted = [...bearings].sort((a, b) => a - b);
    expect(sorted[sorted.length - 1] - sorted[0]).toBeGreaterThan(Math.PI);
    expect(shards[0].lift).toBe(Math.max(...shards.map((s) => s.lift)));
    expect(shards[0].shade).toBe(0);
    expect(shards.slice(1).every((s) => s.shade > 0.1)).toBe(true);
    const f: TurretShardFrame = { x: 0, y: 0, z: 0, angle: 0, scale: 0 };
    for (const s of shards) {
      expect(s.floorY).toBeCloseTo(1 + s.sy * 0.5, 12);
      expect(turretShardInto(s, s.landAt / 2, f)).toBe(true);
      expect(f.y).toBeGreaterThan(s.floorY);
      expect(turretShardInto(s, s.landAt + 0.3, f)).toBe(true);
      expect(f.y).toBe(s.floorY);
      const resting = f.angle;
      turretShardInto(s, s.landAt + 0.6, f);
      expect(f.angle).toBe(resting);
      expect(turretShardInto(s, TURRET_BARREL_SHARDS.life - 1e-3, f)).toBe(true);
      expect(f.scale).toBeLessThan(0.01);
      expect(turretShardInto(s, TURRET_BARREL_SHARDS.life, f)).toBe(false);
      expect(turretShardInto(s, -0.1, f)).toBe(false);
    }
    expect(turretShardLaunch(newTurretShard(), 4, 3, count, 5, 1, 7, () => 1)).toEqual(shards[3]);
  });
});

describe('the powder keg', () => {
  it('matches hex_barrel.glb: one surface, eight staves, the painted facet, the bare staves between the bands, the bung', async () => {
    const model = await kegModel();
    // The mark copies the kit's first material as the keg's own surface: it must be the only one.
    expect(model.primitives).toBe(1);
    expect(model.materials).toBe(1);
    const { v } = model;
    const k = TURRET_KEG_SHAPE;
    // The staves' corners at the edges of the bare stretch, on the kit's eight bearings.
    const corner = k.facetApothem / Math.cos(Math.PI / 8);
    const at = (y: number) => v.filter((p) => Math.abs(p[1] - y) < 1e-3);
    for (const y of [k.bareLow, k.bareHigh]) {
      const ring = at(y).filter((p) => Math.abs(Math.hypot(p[0], p[2]) - corner) < 2e-3);
      const bearings = new Set(
        ring.map((p) => Math.round((Math.atan2(p[0], p[2]) / (Math.PI / 4) + 8) % 8)),
      );
      expect(bearings.size).toBe(8);
    }
    expect(k.facetWidth).toBeCloseTo(2 * corner * Math.sin(Math.PI / 8), 3);
    // Nothing between the bands but flat staves; the bands stand proud of them.
    expect(v.some((p) => p[1] > k.bareLow + 1e-3 && p[1] < k.bareHigh - 1e-3)).toBe(false);
    const band = Math.max(...v.map((p) => Math.hypot(p[0], p[2])));
    expect(band).toBeGreaterThan(corner + 0.01);
    // The painted facet: a flat, upright face at its bearing and distance, the bare stretch tall.
    const facet = facetTriangles(model);
    expect(facet.length).toBeGreaterThan(0);
    for (const [a] of facet) {
      const out = v[a][0] * Math.sin(k.markFacet) + v[a][2] * Math.cos(k.markFacet);
      expect(out).toBeCloseTo(k.facetApothem, 3);
    }
    // The bung: the top of the keg, off the axis on +x.
    const top = v.filter((p) => p[1] > k.bungTop - 1e-3);
    const mx = top.reduce((sum, p) => sum + p[0], 0) / top.length;
    const mz = top.reduce((sum, p) => sum + p[2], 0) / top.length;
    expect(mx).toBeCloseTo(k.bungX, 2);
    expect(mz).toBeCloseTo(0, 2);
  });

  it('turns its painted facet toward the tower from anywhere around it', () => {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = 3 + Math.sin(a) * 20;
      const z = -7 + Math.cos(a) * 20;
      const yaw = turretKegYaw(x, z, 3, -7);
      const facing = TURRET_KEG_SHAPE.markFacet + yaw;
      expect(Math.sin(facing)).toBeCloseTo(-Math.sin(a), 12);
      expect(Math.cos(facing)).toBeCloseTo(-Math.cos(a), 12);
    }
  });

  it('rises its wick out of the bung and bends it over, the fuse burning at its tip', () => {
    const start = turretKegWickInto(point(), 0);
    expect(start.x).toBeCloseTo(TURRET_KEG_SHAPE.bungX * H, 12);
    expect(start.y).toBeCloseTo(H - TURRET_KEG_WICK.sink, 12);
    expect(start.z).toBeCloseTo(0, 12);
    let length = 0;
    let prev = start;
    for (let i = 1; i <= 40; i++) {
      const p = turretKegWickInto(point(), i / 40);
      expect(p.y).toBeGreaterThan(prev.y);
      length += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
      prev = p;
    }
    const aboveLid = length - TURRET_KEG_WICK.sink;
    expect(aboveLid).toBeGreaterThan(0.2);
    expect(aboveLid).toBeLessThan(0.3);
    // It bends: the tip stands off the line the wick leaves the bung on.
    expect(Math.hypot(prev.x - start.x, prev.z - start.z)).toBeGreaterThan(0.05);
    // The tip over a keg, turned as the keg is: its reach from the axis kept.
    const local = turretKegWickInto(point(), 1);
    const reach = Math.hypot(local.x, local.z);
    for (const yaw of [0, 0.9, -2.4]) {
      const tip = turretKegWickTipInto(point(), 10, 2, 20, yaw);
      expect(tip.y).toBeCloseTo(2 + local.y, 12);
      expect(Math.hypot(tip.x - 10, tip.z - 20)).toBeCloseTo(reach, 12);
      // Three's turn about +y: local +z goes to (sin, cos).
      const bearing = Math.atan2(local.x, local.z) + yaw;
      expect(tip.x - 10).toBeCloseTo(Math.sin(bearing) * reach, 12);
      expect(tip.z - 20).toBeCloseTo(Math.cos(bearing) * reach, 12);
    }
    expect(turretKegWickTipInto(point(), 0, 0, 0, 0)).toEqual(local);
  });

  it('breaks into staves and a few iron band pieces', () => {
    let bands = 0;
    let staves = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (let i = 1; i < TURRET_BARREL_SHARDS.perBlast; i++) {
        const s = turretShardLaunch(newTurretShard(), seed, i, 10, 0, 0, 0, flat);
        if (s.shade < TURRET_SHARD_BAND_SHADE) bands++;
        else staves++;
      }
    }
    expect(bands / (bands + staves)).toBeGreaterThan(0.08);
    expect(bands / (bands + staves)).toBeLessThan(0.35);
  });
});

describe('the stencilled bomb', () => {
  const b = TURRET_KEG_BOMB;
  const data = turretKegMarkTexels(TURRET_KEG_MARK.texels);

  it("paints its bare wood as hex_barrel.glb's own atlas holds it under the painted facet", async () => {
    const model = await kegModel();
    const facet = facetTriangles(model);
    const corners = [...new Set(facet.flat())];
    const k = TURRET_KEG_SHAPE;
    // The facet's v at its upper and at its lower band, and the u it spans.
    for (const i of corners) {
      const top = Math.abs(model.v[i][1] - k.bareHigh) < 1e-3;
      expect(model.uv[i][1]).toBeCloseTo(top ? TURRET_KEG_WOOD.vTop : TURRET_KEG_WOOD.vBottom, 5);
    }
    const us = corners.map((i) => model.uv[i][0]);
    const { size, rgba } = await decodeAtlas(model.atlas);
    expect(size).toBe(TURRET_KEG_WOOD.atlas);
    // Every pinned row is the atlas's, across the facet's columns and a few beyond (its mips hold).
    const lo = Math.floor(Math.min(...us) * size) - 3;
    const hi = Math.ceil(Math.max(...us) * size) + 3;
    const rows = TURRET_KEG_WOOD.rows.length / 3;
    const topRow = TURRET_KEG_WOOD.vTop * size - 0.5;
    const bottomRow = TURRET_KEG_WOOD.vBottom * size - 0.5;
    expect(TURRET_KEG_WOOD.firstRow).toBeLessThanOrEqual(Math.floor(topRow));
    expect(TURRET_KEG_WOOD.firstRow + rows - 1).toBeGreaterThanOrEqual(Math.ceil(bottomRow));
    for (let r = 0; r < rows; r++) {
      const pinned = TURRET_KEG_WOOD.rows.slice(r * 3, r * 3 + 3);
      for (let col = lo; col <= hi; col++) {
        const at = ((TURRET_KEG_WOOD.firstRow + r) * size + col) * 4;
        expect([rgba[at], rgba[at + 1], rgba[at + 2]]).toEqual(pinned);
      }
    }
    // The mark's wood at any height is the atlas sampled as the facet samples it.
    const column = Math.round(((Math.min(...us) + Math.max(...us)) / 2) * size);
    for (const share of [0, 0.13, 0.5, 0.71, 1]) {
      const y = (2 * share - 1) * ASPECT;
      const v = TURRET_KEG_WOOD.vBottom + (TURRET_KEG_WOOD.vTop - TURRET_KEG_WOOD.vBottom) * share;
      const row = v * size - 0.5;
      const r0 = Math.floor(row);
      const f = row - r0;
      const wood = turretKegWoodInto([0, 0, 0], y);
      for (let c = 0; c < 3; c++) {
        const a = rgba[(r0 * size + column) * 4 + c];
        const z = rgba[((r0 + 1) * size + column) * 4 + c];
        expect(wood[c]).toBeCloseTo(a + (z - a) * f, 9);
      }
    }
  });

  it('lights the mark as the kit shades the facet: blended between its corner normals', async () => {
    const model = await kegModel();
    const k = TURRET_KEG_SHAPE;
    const n = { x: 0, z: 0 };
    let seen = 0;
    for (const i of new Set(facetTriangles(model).flat())) {
      const [x, , z] = model.v[i];
      // Mark x: -1 at the facet's left corner, 1 at its right, seen from in front.
      const side = (x * Math.cos(k.markFacet) - z * Math.sin(k.markFacet)) / (k.facetWidth / 2);
      expect(Math.abs(Math.abs(side) - 1)).toBeLessThan(1e-2);
      turretKegFacetNormalInto(n, Math.sign(side));
      expect(model.n[i][0]).toBeCloseTo(n.x, 1);
      expect(model.n[i][1]).toBeCloseTo(0, 2);
      expect(model.n[i][2]).toBeCloseTo(n.z, 1);
      expect(Math.hypot(model.n[i][0] - n.x, model.n[i][2] - n.z)).toBeLessThan(0.012);
      seen++;
    }
    expect(seen).toBeGreaterThanOrEqual(4);
    // Across the facet it turns from one corner to the other, straight out at the middle.
    turretKegFacetNormalInto(n, 0);
    const len = Math.hypot(n.x, n.z);
    expect(n.x / len).toBeCloseTo(TURRET_KEG_MARK_FRAME.normalX, 12);
    expect(n.z / len).toBeCloseTo(TURRET_KEG_MARK_FRAME.normalZ, 12);
    const left = turretKegFacetNormalInto({ x: 0, z: 0 }, -1);
    const right = turretKegFacetNormalInto({ x: 0, z: 0 }, 1);
    const between = Math.acos(left.x * right.x + left.z * right.z);
    expect(between).toBeCloseTo(2 * k.facetSpread, 12);
  });

  it('lays the bomb on its facet between the bands: the ball low in the middle, the spark at the upper right', () => {
    const f = TURRET_KEG_MARK_FRAME;
    expect(f.width).toBeCloseTo(TURRET_KEG_SHAPE.facetWidth * H, 12);
    expect(f.height / f.width).toBeCloseTo(ASPECT, 12);
    expect(f.centreY - f.height / 2).toBeCloseTo(TURRET_KEG_SHAPE.bareLow * H, 12);
    expect(f.offset - TURRET_KEG_SHAPE.facetApothem * H).toBeCloseTo(TURRET_KEG_MARK.lift, 12);
    expect(TURRET_KEG_MARK.lift).toBeGreaterThan(0.005);
    expect(f.sideX * f.normalX + f.sideZ * f.normalZ).toBeCloseTo(0, 12);
    // The ball fills most of the facet's width, low and a little left of its middle.
    expect(2 * b.ballR).toBeGreaterThan(1.1);
    expect(2 * b.ballR).toBeLessThan(1.5);
    expect(Math.abs(b.ballX)).toBeLessThan(0.2);
    expect(b.ballY).toBeLessThan(0);
    expect(b.ballY - b.ballR).toBeGreaterThan(-ASPECT);
    // The neck on its upper right, the spark high on the right, above the ball.
    expect(b.neckX).toBeGreaterThan(b.ballX);
    expect(b.neckY).toBeGreaterThan(b.ballY + 0.6 * b.ballR);
    expect(b.sparkX).toBeGreaterThan(0.5);
    expect(b.sparkY).toBeGreaterThan(0.6 * ASPECT);
    expect(b.sparkY).toBeGreaterThan(b.neckY);
    // The fuse runs from the neck to the spark.
    const line = fuseLine();
    expect(Math.hypot(line[0].x - b.neckX, line[0].y - b.neckY)).toBeLessThan(b.neckLong);
    const end = line[line.length - 1];
    expect(Math.hypot(end.x - b.sparkX, end.y - b.sparkY)).toBeLessThan(b.sparkOuter);
    // Its whole mesh stays on the facet, inside its corners and between the bands.
    const tris = turretKegBombTriangles();
    for (let i = 0; i < tris.length; i += 2) {
      expect(Math.abs(tris[i])).toBeLessThan(1);
      expect(Math.abs(tris[i + 1])).toBeLessThan(ASPECT);
    }
  });

  it('stencils a black bomb straight on the wood: a bare crescent and bridges, a dashed fuse, a yellow spark', () => {
    expect(turretKegMarkTexels(TURRET_KEG_MARK.texels)).toEqual(data);
    const ink = (t: number[]) => lum(t) < 45;
    const wood = (t: number[], y: number) =>
      t.slice(0, 3).every((c, i) => Math.abs(c - woodAt(y)[i]) <= 1);
    // Straight on the wood: no patch, no border, the keg's own colour all round.
    for (const [x, y] of [
      [-0.85, 1.1],
      [0.85, -1.1],
      [-0.9, -0.3],
      [0.9, 0.2],
    ]) {
      expect(wood(markTexel(data, x, y), y)).toBe(true);
    }
    // The ball: black paint, worn only slightly along the grain.
    const cutR = b.crescentR * b.ballR;
    let paint = 0;
    let worn = 0;
    for (let x = b.ballX - b.ballR; x <= b.ballX + b.ballR; x += 0.01) {
      for (let y = b.ballY - b.ballR; y <= b.ballY + b.ballR; y += 0.01) {
        const rho = Math.hypot(x - b.ballX, y - b.ballY);
        const bearing = Math.atan2(y - b.ballY, x - b.ballX);
        const nearCut =
          Math.abs(rho - cutR) < b.crescentWidth ||
          (bearing > b.crescentFrom - 0.2 && bearing < b.crescentTo + 0.2 && rho > cutR);
        if (rho > b.ballR - 0.05 || nearCut) continue;
        const t = markTexel(data, x, y);
        if (ink(t)) paint++;
        else worn++;
      }
    }
    expect(worn / (paint + worn)).toBeGreaterThan(0.01);
    expect(worn / (paint + worn)).toBeLessThan(0.12);
    // The highlight crescent: bare wood across the ball's upper left.
    for (const k of [0.25, 0.5, 0.75]) {
      const a = b.crescentFrom + (b.crescentTo - b.crescentFrom) * k;
      const x = b.ballX + Math.cos(a) * cutR;
      const y = b.ballY + Math.sin(a) * cutR;
      expect(lum(markTexel(data, x, y))).toBeGreaterThan(lum(woodAt(y)) - 8);
    }
    // A stencil bridge at each end of it, through to the rim: a thin bare gap in the paint.
    for (const a of [b.crescentFrom, b.crescentTo]) {
      let lightest = 0;
      for (let rho = cutR + 0.05; rho < b.ballR - 0.03; rho += 0.01) {
        for (let side = -0.03; side <= 0.03; side += 0.005) {
          const x = b.ballX + Math.cos(a) * rho - Math.sin(a) * side;
          const y = b.ballY + Math.sin(a) * rho + Math.cos(a) * side;
          lightest = Math.max(lightest, lum(markTexel(data, x, y)) / lum(woodAt(y)));
        }
      }
      expect(lightest).toBeGreaterThan(0.7);
    }
    // The neck: black.
    expect(ink(markTexel(data, b.neckX, b.neckY))).toBe(true);
    // The fuse: dashes of black with bare gaps between, all along to the spark.
    const line = fuseLine();
    const at = (along: number) => line.find((p) => p.s >= along) ?? line[line.length - 1];
    const clear = (p: { x: number; y: number }) =>
      Math.hypot(p.x - b.sparkX, p.y - b.sparkY) > b.sparkOuter * (1 + b.jitter) + 0.03;
    const period = b.dash + b.gap;
    let dashes = 0;
    for (let k = 0; k * period < line[line.length - 1].s; k++) {
      const dash = at(k * period + b.dash / 2);
      const gap = at(k * period + b.dash + b.gap / 2);
      if (!clear(dash)) continue;
      const dashTexel = markTexel(data, dash.x, dash.y);
      expect(lum(dashTexel)).toBeLessThan(70);
      if (clear(gap)) {
        expect(lum(markTexel(data, gap.x, gap.y)) - lum(dashTexel)).toBeGreaterThan(40);
      }
      dashes++;
    }
    expect(dashes).toBeGreaterThanOrEqual(3);
    // The spark: a pale heart in a yellow star.
    const heart = markTexel(data, b.sparkX, b.sparkY);
    expect(heart[0]).toBeGreaterThan(235);
    expect(heart[1]).toBeGreaterThan(210);
    let yellow = 0;
    for (let x = b.sparkX - b.sparkOuter; x <= b.sparkX + b.sparkOuter; x += 0.01) {
      for (let y = b.sparkY - b.sparkOuter; y <= b.sparkY + b.sparkOuter; y += 0.01) {
        const [r, g, bl] = markTexel(data, x, y);
        if (r > 220 && g > 150 && g < 230 && bl < 140) yellow++;
      }
    }
    expect(yellow).toBeGreaterThan(40);
  });

  it('cuts its mesh to the bomb: every painted texel well inside it, so its edge samples bare wood', () => {
    const tris = turretKegBombTriangles();
    expect(tris.length % 6).toBe(0);
    for (let t = 0; t < tris.length; t += 6) {
      const [ax, ay, bx, by, cx, cy] = tris.slice(t, t + 6);
      // Wound counter-clockwise seen from in front: the keg's program culls the back.
      expect((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)).toBeGreaterThan(0);
    }
    const step = 2 / LAYOUT.width;
    expect((2 * ASPECT) / MARK_ROWS).toBeCloseTo(step, 2);
    // The texels a bilinear read at the mesh's edge blends (a texel either way)
    // are bare wood: the square a texel round any paint is still mesh.
    const reach = step;
    let painted = 0;
    for (let j = 0; j < MARK_ROWS; j++) {
      const y = ((j + 0.5) / MARK_ROWS) * 2 * ASPECT - ASPECT;
      const bare = woodAt(y);
      for (let i = 0; i < LAYOUT.width; i++) {
        const at = ((LAYOUT.markRow + j) * LAYOUT.width + i) * 4;
        if ([0, 1, 2].every((c) => Math.abs(data[at + c] - bare[c]) <= 1)) continue;
        painted++;
        const x = ((i + 0.5) / LAYOUT.width) * 2 - 1;
        for (const [ox, oy] of [
          [0, 0],
          [reach, 0],
          [-reach, 0],
          [0, reach],
          [0, -reach],
          [reach, reach],
          [reach, -reach],
          [-reach, reach],
          [-reach, -reach],
        ]) {
          expect(inMesh(tris, x + ox, y + oy), `texel ${i},${j} at ${ox},${oy}`).toBe(true);
        }
      }
    }
    expect(painted).toBeGreaterThan(1000);
  });

  it('lays its texture out as the cord, a gutter, then the facet in square texels, opaque throughout', () => {
    expect(LAYOUT.width).toBe(TURRET_KEG_MARK.texels);
    expect(data).toHaveLength(LAYOUT.width * LAYOUT.height * 4);
    expect(LAYOUT.wickTop).toBeCloseTo(LAYOUT.cordRows / LAYOUT.height, 12);
    expect(LAYOUT.markBottom).toBeCloseTo(LAYOUT.markRow / LAYOUT.height, 12);
    expect(LAYOUT.markRow).toBeGreaterThan(LAYOUT.cordRows);
    expect(MARK_ROWS / LAYOUT.width).toBeCloseTo(ASPECT, 2);
    for (let at = 3; at < data.length; at += 4) expect(data[at]).toBe(255);
    const bottom = woodAt(-ASPECT);
    for (let i = 0; i < LAYOUT.width; i++) {
      // The cord: dark along the bottom.
      const cord = (Math.floor(LAYOUT.cordRows / 2) * LAYOUT.width + i) * 4;
      expect(lum([data[cord], data[cord + 1], data[cord + 2]])).toBeLessThan(70);
      // The gutter: the cord's ink over it, then the facet's wood under the facet.
      const low = ((LAYOUT.cordRows + 1) * LAYOUT.width + i) * 4;
      expect(lum([data[low], data[low + 1], data[low + 2]])).toBeLessThan(70);
      const high = ((LAYOUT.markRow - 1) * LAYOUT.width + i) * 4;
      expect([data[high], data[high + 1], data[high + 2]]).toEqual(bottom);
    }
  });
});
