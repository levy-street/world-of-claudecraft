// The Willowfen's willow placements: every weeping willow's spot, scale,
// and yaw, computed once per seed. Lives sim-side so the render module
// (render/fen_features.ts) and the collider builder (sim/colliders.ts) read
// the SAME list: the trunk you see is exactly the trunk that blocks you
// (the reachPalmSpots idiom). Shoreline rings around every pool plus a
// loose inland scatter; a willow only roots on LEVEL dry ground, clear of
// roads, props, and the terrain's own scatter rocks. Pure leaf:
// deterministic, memoized, no SimContext.

import { REALM_PROPS, REALM_ZONE } from './content/realm';
import { WILLOWFEN_PROPS, WILLOWFEN_ZONE } from './content/willowfen';
import { hash2 } from './rng';
import { generateDecorationsInBounds, roadDistance, terrainHeight, WATER_LEVEL } from './world';

const FEN_ZMIN = 180;
const FEN_ZMAX = 700;

export interface FenWillow {
  x: number;
  z: number;
  y: number;
  s: number; // uniform world scale (the model is ~1 unit across at s 1)
  rot: number;
  r: number; // trunk collider radius, world units
}

let fenWillowCache: { seed: number; spots: FenWillow[] } | null = null;
let hollowWillowCache: { seed: number; spots: FenWillow[] } | null = null;

/**
 * The Veiled Hollow's willows: shoreline rings around the realm's pools
 * plus a light meadow scatter, the same level-dry-clear rules as the fen's
 * (and the same one-list contract: render/water_flora.ts draws these,
 * sim/colliders.ts blocks their trunks).
 */
export function hollowWillowSpots(seed: number): FenWillow[] {
  if (hollowWillowCache && hollowWillowCache.seed === seed) return hollowWillowCache.spots;
  const hub = REALM_ZONE.hub;
  const rocks = generateDecorationsInBounds(seed, {
    minX: -180,
    maxX: 180,
    minZ: 910,
    maxZ: 1290,
  }).filter((d) => d.kind === 'rock');
  const zp = REALM_PROPS;
  const buildings = zp.buildings ?? [];
  const decor = (zp.decorProps ?? []).map((d) => ({ x: d.x, z: d.z, r: d.r ?? 3 }));
  const level = (x: number, z: number): boolean => {
    const e = 0.9;
    const hx = terrainHeight(x + e, z, seed) - terrainHeight(x - e, z, seed);
    const hz = terrainHeight(x, z + e, seed) - terrainHeight(x, z - e, seed);
    return Math.hypot(hx, hz) / (2 * e) < 0.34;
  };
  const spots: FenWillow[] = [];
  const tryWillow = (x: number, z: number, s: number, rot: number): boolean => {
    if (z < 918 || z > 1250) return false;
    const y = terrainHeight(x, z, seed);
    if (y < WATER_LEVEL + 0.6) return false;
    if (!level(x, z)) return false;
    if (Math.hypot(x - hub.x, z - hub.z) < hub.radius + 6) return false;
    if (Math.hypot(x + 60, z - 1004) < 14) return false; // the graveyard
    if (roadDistance(x, z) < 5) return false;
    for (const b of buildings) if (Math.hypot(x - b.x, z - b.z) < 9) return false;
    for (const d of decor) if (Math.hypot(x - d.x, z - d.z) < d.r + 4) return false;
    for (const r of rocks) if (Math.hypot(x - r.x, z - r.z) < 2.2 * r.scale + 1) return false;
    spots.push({ x, z, y: y - 0.15, s, rot, r: Math.max(0.85, s * 0.14) });
    return true;
  };
  for (const lake of REALM_ZONE.lakes) {
    const count = 2 + Math.floor(hash2(lake.x, lake.z, seed + 2601) * 3);
    for (let k = 0; k < count; k++) {
      const ang = hash2(k, lake.x + lake.z, seed + 2611) * Math.PI * 2;
      const dist = lake.radius + 9 + hash2(lake.x, k, seed + 2621) * 7;
      tryWillow(
        lake.x + Math.sin(ang) * dist,
        lake.z + Math.cos(ang) * dist,
        6.5 + hash2(k, lake.z, seed + 2631) * 3,
        hash2(lake.x + k, k, seed + 2641) * Math.PI * 2,
      );
    }
  }
  // the meadow scatter between the pools
  for (let gx = -160; gx <= 170; gx += 26) {
    for (let gz = 930; gz <= 1240; gz += 26) {
      if (hash2(gx, gz, seed + 2651) > 0.24) continue;
      const x = gx + (hash2(gx + 1, gz, seed + 2661) - 0.5) * 15;
      const z = gz + (hash2(gx, gz + 1, seed + 2671) - 0.5) * 15;
      if (REALM_ZONE.lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.radius + 12)) continue;
      tryWillow(x, z, 7 + hash2(x, z, seed + 2681) * 3, hash2(z, x, seed + 2691) * Math.PI * 2);
    }
  }
  hollowWillowCache = { seed, spots };
  return spots;
}

export function fenWillowSpots(seed: number): FenWillow[] {
  if (fenWillowCache && fenWillowCache.seed === seed) return fenWillowCache.spots;
  const hub = WILLOWFEN_ZONE.hub;
  const zp = WILLOWFEN_PROPS;
  const props = {
    campfires: zp.campfires ?? [],
    buildings: zp.buildings ?? [],
    decorProps: (zp.decorProps ?? []).map((d) => ({ x: d.x, z: d.z, r: d.r ?? 3 })),
    stalls: zp.stalls ?? [],
    wells: zp.wells ?? [],
    crates: zp.crates ?? [],
    fences: zp.fences ?? [],
  };
  const fenRocks = generateDecorationsInBounds(seed, {
    minX: -540,
    maxX: -180,
    minZ: FEN_ZMIN,
    maxZ: FEN_ZMAX,
  }).filter((d) => d.kind === 'rock');
  const segDist = (x: number, z: number, f: { x1: number; z1: number; x2: number; z2: number }) => {
    const dx = f.x2 - f.x1;
    const dz = f.z2 - f.z1;
    const t = Math.max(
      0,
      Math.min(1, ((x - f.x1) * dx + (z - f.z1) * dz) / (dx * dx + dz * dz || 1)),
    );
    return Math.hypot(x - (f.x1 + dx * t), z - (f.z1 + dz * t));
  };
  const clearOfProps = (x: number, z: number, pad: number): boolean => {
    for (const f of props.campfires) if (Math.hypot(x - f[0], z - f[1]) < 8 + pad) return false;
    for (const b of props.buildings) if (Math.hypot(x - b.x, z - b.z) < 8 + pad) return false;
    for (const d of props.decorProps)
      if (Math.hypot(x - d.x, z - d.z) < d.r + 2 + pad) return false;
    for (const st of props.stalls) if (Math.hypot(x - st.x, z - st.z) < 4 + pad) return false;
    for (const w of props.wells) if (Math.hypot(x - w.x, z - w.z) < 3 + pad) return false;
    for (const cr of props.crates) if (Math.hypot(x - cr[0], z - cr[1]) < 2.5 + pad) return false;
    for (const f of props.fences) if (segDist(x, z, f) < 2.2 + pad) return false;
    return true;
  };
  const clearOfRocks = (x: number, z: number, pad: number): boolean => {
    for (const r of fenRocks) if (Math.hypot(x - r.x, z - r.z) < 2.2 * r.scale + pad) return false;
    return true;
  };
  const level = (x: number, z: number): boolean => {
    const e = 0.9;
    const hx = terrainHeight(x + e, z, seed) - terrainHeight(x - e, z, seed);
    const hz = terrainHeight(x, z + e, seed) - terrainHeight(x, z - e, seed);
    return Math.hypot(hx, hz) / (2 * e) < 0.34;
  };
  const spots: FenWillow[] = [];
  const tryWillow = (x: number, z: number, s: number, rot: number): boolean => {
    if (z < FEN_ZMIN + 8 || z > FEN_ZMAX - 8) return false;
    const y = terrainHeight(x, z, seed);
    if (y < WATER_LEVEL + 0.6) return false;
    if (!level(x, z)) return false;
    if (Math.hypot(x - hub.x, z - hub.z) < 15) return false;
    if (roadDistance(x, z) < 5) return false;
    if (!clearOfProps(x, z, 2)) return false;
    if (!clearOfRocks(x, z, 1)) return false;
    spots.push({ x, z, y: y - 0.15, s, rot, r: Math.max(0.85, s * 0.14) });
    return true;
  };
  // the shoreline rings, with a bigger elder companion beside many
  for (const lake of WILLOWFEN_ZONE.lakes) {
    const count = 2 + Math.floor(hash2(lake.x, lake.z, seed + 2101) * 3);
    for (let k = 0; k < count; k++) {
      const ang = hash2(k, lake.x + lake.z, seed + 2111) * Math.PI * 2;
      const dist = lake.radius + 10 + hash2(lake.x, k, seed + 2121) * 7;
      const x = lake.x + Math.sin(ang) * dist;
      const z = lake.z + Math.cos(ang) * dist;
      const ok = tryWillow(
        x,
        z,
        7 + hash2(k, lake.z, seed + 2131) * 3.5,
        hash2(lake.x + k, k, seed + 2141) * Math.PI * 2,
      );
      if (ok && hash2(x, z, seed + 2161) < 0.55) {
        const ang2 = hash2(z, x, seed + 2171) * Math.PI * 2;
        const off = 8 + hash2(x + 1, z, seed + 2181) * 4;
        tryWillow(
          x + Math.sin(ang2) * off,
          z + Math.cos(ang2) * off,
          (7 + hash2(k, lake.z, seed + 2131) * 3.5) * 1.28,
          hash2(z, x + 1, seed + 2191) * Math.PI * 2,
        );
      }
    }
  }
  // the inland scatter across the open moor between the pools
  for (let gx = -515; gx <= -205; gx += 24) {
    for (let gz = FEN_ZMIN + 26; gz <= FEN_ZMAX - 40; gz += 24) {
      if (hash2(gx, gz, seed + 2301) > 0.3) continue;
      const x = gx + (hash2(gx + 1, gz, seed + 2311) - 0.5) * 14;
      const z = gz + (hash2(gx, gz + 1, seed + 2321) - 0.5) * 14;
      if (WILLOWFEN_ZONE.lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.radius + 14)) {
        continue;
      }
      tryWillow(x, z, 7.5 + hash2(x, z, seed + 2331) * 3.5, hash2(z, x, seed + 2341) * Math.PI * 2);
    }
  }
  fenWillowCache = { seed, spots };
  return spots;
}
