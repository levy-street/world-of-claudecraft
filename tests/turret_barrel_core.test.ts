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
  TURRET_KEG_MARK,
  TURRET_KEG_MARK_FRAME,
  TURRET_KEG_SHAPE,
  TURRET_KEG_SHIELD_ASPECT,
  TURRET_KEG_WICK,
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
  turretKegMarkTexels,
  turretKegShieldOutline,
  turretKegWickInto,
  turretKegWickTipInto,
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

/** hex_barrel.glb's vertices and triangles, its foot at 0, in shares of its height. */
async function kegShares(): Promise<{ v: number[][]; tris: number[][] }> {
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
  const indices = prim?.getIndices();
  if (!position || !indices) throw new Error('the keg has no triangles');
  const m = node.getWorldMatrix();
  const raw: number[][] = [];
  const e: number[] = [];
  for (let i = 0; i < position.getCount(); i++) {
    position.getElement(i, e);
    raw.push([
      m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
      m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
      m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
    ]);
  }
  const lo = Math.min(...raw.map((p) => p[1]));
  const height = Math.max(...raw.map((p) => p[1])) - lo;
  const v = raw.map(([x, y, z]) => [x / height, (y - lo) / height, z / height]);
  const tris: number[][] = [];
  for (let i = 0; i < indices.getCount(); i += 3) {
    tris.push([indices.getScalar(i), indices.getScalar(i + 1), indices.getScalar(i + 2)]);
  }
  return { v, tris };
}

/** The mark texture's texel under shield point (x, y), as RGBA bytes. */
function markTexel(data: Uint8Array, x: number, y: number): number[] {
  const w = TURRET_KEG_MARK.texels;
  const h = w * 2;
  const v =
    TURRET_KEG_MARK.markBottom +
    ((1 - TURRET_KEG_MARK.markBottom) * (y / TURRET_KEG_SHIELD_ASPECT + 1)) / 2;
  const i = Math.min(w - 1, Math.floor(((x + 1) / 2) * w));
  const j = Math.min(h - 1, Math.floor(v * h));
  const at = (j * w + i) * 4;
  return [data[at], data[at + 1], data[at + 2], data[at + 3]];
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
  it('matches hex_barrel.glb: eight staves, the painted facet, the bare staves between the bands, the bung', async () => {
    const { v, tris } = await kegShares();
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
    const facet = tris.filter(([a, b, c]) => {
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

  it('paints a shield that fills its facet between the bands', () => {
    const f = TURRET_KEG_MARK_FRAME;
    expect(f.width).toBeLessThan(TURRET_KEG_SHAPE.facetWidth * H);
    expect(f.width).toBeGreaterThan(0.8 * TURRET_KEG_SHAPE.facetWidth * H);
    const bare = (TURRET_KEG_SHAPE.bareHigh - TURRET_KEG_SHAPE.bareLow) * H;
    expect(f.height).toBeLessThan(bare);
    expect(f.height).toBeGreaterThan(0.8 * bare);
    expect(f.centreY - f.height / 2).toBeGreaterThan(TURRET_KEG_SHAPE.bareLow * H);
    expect(f.centreY + f.height / 2).toBeLessThan(TURRET_KEG_SHAPE.bareHigh * H);
    expect(f.offset - TURRET_KEG_SHAPE.facetApothem * H).toBeCloseTo(TURRET_KEG_MARK.lift, 12);
    expect(TURRET_KEG_MARK.lift).toBeGreaterThan(0.005);
    expect(f.sideX * f.normalX + f.sideZ * f.normalZ).toBeCloseTo(0, 12);
    // A heater shield: flat on top, a point below, wound counter-clockwise seen from the front.
    const o = turretKegShieldOutline(8);
    let area = 0;
    for (let i = 0; i < o.length; i += 2) {
      const j = (i + 2) % o.length;
      area += o[i] * o[j + 1] - o[j] * o[i + 1];
      expect(Math.abs(o[i])).toBeLessThanOrEqual(1 + 1e-12);
      expect(Math.abs(o[i + 1])).toBeLessThanOrEqual(TURRET_KEG_SHIELD_ASPECT + 1e-12);
    }
    expect(area).toBeGreaterThan(0);
    expect(o[0]).toBeCloseTo(0, 12);
    expect(o[1]).toBeCloseTo(-TURRET_KEG_SHIELD_ASPECT, 12);
    const ys = o.filter((_, i) => i % 2 === 1);
    expect(ys.filter((y) => y === TURRET_KEG_SHIELD_ASPECT)).toHaveLength(2);
  });

  it('paints a flame on a pale shield inside a dark border, clear around it, and a dark cord below', () => {
    const data = turretKegMarkTexels(TURRET_KEG_MARK.texels);
    const w = TURRET_KEG_MARK.texels;
    expect(data).toHaveLength(w * w * 2 * 4);
    expect(turretKegMarkTexels(TURRET_KEG_MARK.texels)).toEqual(data);
    const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // The flame's heart and body: opaque, hot, well apart from the pale field.
    const heart = markTexel(data, 0, -0.35);
    expect(heart[3]).toBe(255);
    expect(heart[0]).toBeGreaterThan(230);
    expect(heart[2]).toBeLessThan(110);
    const body = markTexel(data, -0.3, -0.35);
    expect(body[3]).toBe(255);
    expect(body[0]).toBeGreaterThan(190);
    expect(body[0]).toBeGreaterThan(body[1] + 60);
    expect(body[1]).toBeGreaterThan(body[2] + 30);
    const field = markTexel(data, 0.72, 0.95);
    expect(field[3]).toBe(255);
    expect(Math.min(field[0], field[1], field[2])).toBeGreaterThan(160);
    expect(lum(field) - lum(body)).toBeGreaterThan(40);
    // The dark outline between them, and the shield's dark border.
    let inked = 0;
    for (let x = -0.95; x < 0; x += 0.01) {
      const t = markTexel(data, x, -0.35);
      if (lum(t) < 70) inked++;
    }
    expect(inked).toBeGreaterThan(3);
    const border = markTexel(data, 0.97, 0.9);
    expect(border[3]).toBe(255);
    expect(lum(border)).toBeLessThan(70);
    // Clear past the shield, its ink carried on for the mip levels.
    const outside = markTexel(data, 0.95, -1.1);
    expect(outside[3]).toBe(0);
    expect(lum(outside)).toBeLessThan(70);
    // The cord: opaque and dark along the bottom; clear in the gutter above it.
    const cordRow = Math.floor((TURRET_KEG_MARK.wickTop * w * 2) / 2);
    const gutterRow = Math.floor(
      ((TURRET_KEG_MARK.wickTop + TURRET_KEG_MARK.markBottom) / 2) * w * 2,
    );
    for (let i = 0; i < w; i++) {
      const cord = (cordRow * w + i) * 4;
      expect(data[cord + 3]).toBe(255);
      expect(lum([data[cord], data[cord + 1], data[cord + 2]])).toBeLessThan(70);
      expect(data[(gutterRow * w + i) * 4 + 3]).toBe(0);
    }
    // Most of the shield is opaque paint; its corners are clear.
    let opaque = 0;
    for (let j = Math.round(TURRET_KEG_MARK.markBottom * w * 2); j < w * 2; j++) {
      for (let i = 0; i < w; i++) if (data[(j * w + i) * 4 + 3] === 255) opaque++;
    }
    const markTexels = w * (w * 2 - Math.round(TURRET_KEG_MARK.markBottom * w * 2));
    expect(opaque / markTexels).toBeGreaterThan(0.7);
    expect(opaque / markTexels).toBeLessThan(0.95);
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
