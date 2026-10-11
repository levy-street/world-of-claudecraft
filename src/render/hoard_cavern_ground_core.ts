import {
  type HoardValleyLayoutInput,
  type HoardValleyZoneProfile,
  hoardValleyRevealZ,
  hoardValleySpanAtZ,
} from './hoard_valley_core';

export interface HoardCavernGroundPlan {
  positions: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
}

function smooth(t: number): number {
  const v = Math.max(0, Math.min(1, t));
  return v * v * (3 - 2 * v);
}

function hash(x: number, z: number, seed: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const u = smooth(x - ix),
    v = smooth(z - iz);
  const a = hash(ix, iz, seed),
    b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed),
    d = hash(ix + 1, iz + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/** Continuous soil field: mineral entry and margins, irregular growth beneath the opening. */
export function hoardCavernGroundSample(
  layout: HoardValleyLayoutInput,
  zone: HoardValleyZoneProfile,
  seed: number,
  x: number,
  z: number,
  revealZ = hoardValleyRevealZ(layout),
): { color: readonly [number, number, number]; growth: number } {
  const span = hoardValleySpanAtZ(layout, Math.min(layout.zMax - 0.00001, z));
  const edge = Math.min(x - span.minX, span.maxX - x, layout.zMax - z);
  const exposure = smooth((z - revealZ + 6) / 16) * smooth(edge / 7);
  const patch = noise(x / 10, z / 12, seed) * 0.72 + noise(x / 4, z / 5, seed ^ 713) * 0.28;
  const growth = exposure * smooth((patch - 0.25) / 0.45);
  const mottling = noise(x / 2.7, z / 3.1, seed ^ 871) * 0.12;
  const light = 0.76 + exposure * 0.17 + mottling;
  const color = [16, 8, 0].map((shift) => {
    const mineral =
      (((zone.cliffLight >>> shift) & 255) * 0.68 + ((zone.ground >>> shift) & 255) * 0.32) / 255;
    const biome =
      (((zone.ground >>> shift) & 255) * 0.35 + ((zone.groundLight >>> shift) & 255) * 0.65) / 255;
    return (mineral + (biome - mineral) * growth) * light;
  }) as [number, number, number];
  return { color, growth };
}

/** One welded flat mesh. Polygon corner rows preserve the gorge shoulders exactly. */
export function buildHoardCavernGroundPlan(
  layout: HoardValleyLayoutInput,
  zone: HoardValleyZoneProfile,
  seed: number,
): HoardCavernGroundPlan {
  const rows = new Set<number>([layout.zMin, layout.zMax]);
  for (let z = layout.zMin + 1.4; z < layout.zMax; z += 1.4) rows.add(z);
  for (const point of layout.shellPolygon ?? []) rows.add(point.z);
  const zs = [...rows].filter((z) => z >= layout.zMin && z <= layout.zMax).sort((a, b) => a - b);
  const columns = 48;
  const plan: HoardCavernGroundPlan = { positions: [], colors: [], uvs: [], indices: [] };
  const revealZ = hoardValleyRevealZ(layout);
  for (let row = 0; row < zs.length; row++) {
    const z = zs[row];
    const span = hoardValleySpanAtZ(layout, Math.min(layout.zMax - 0.00001, z));
    for (let column = 0; column <= columns; column++) {
      const x = span.minX + ((span.maxX - span.minX) * column) / columns;
      plan.positions.push(x, 0.04, z);
      plan.colors.push(...hoardCavernGroundSample(layout, zone, seed, x, z, revealZ).color);
      plan.uvs.push(x / 5, z / 5);
      if (row < zs.length - 1 && column < columns) {
        const a = row * (columns + 1) + column,
          b = a + columns + 1;
        plan.indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  return plan;
}

/** Neutral fine grit, generated without a canvas so the build remains host agnostic. */
export function hoardCavernGrain(size = 128): Uint8Array {
  const bytes = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const grain = hash(x, z, 4187);
      const value = Math.round(222 + grain * 33);
      const index = (z * size + x) * 4;
      bytes[index] = value;
      bytes[index + 1] = value;
      bytes[index + 2] = value;
      bytes[index + 3] = 255;
    }
  return bytes;
}
