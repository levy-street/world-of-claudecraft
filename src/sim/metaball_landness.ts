// >0 on land, <0 at sea; the coast is the soft zero crossing. One metaball
// evaluator shared by every northern realm's coastline (same math the Hollow
// shipped with, extracted verbatim when the Drakelands and the Frostveil
// added their own lobe tables, and moved here out of world.ts verbatim when
// the Quartered Isle's coast pushed that file past its monolith ceiling).
// Pure leaf: fixed-seed fbm only, no world seed, no rng stream.
import { fbm2 } from './rng';

export type CoastBlob = { readonly x: number; readonly z: number; readonly r: number };
// One terrainHeight sample evaluates SEVERAL realms' landness at the same
// (x, z) (its own coast, seam neighbours, the border seaGate, the open-sea
// check), and the three fixed-seed fbm terms below depend only on (x, z),
// never on the lobe tables. A last-point memo shares them across those calls:
// pure caching of identical inputs, so every result stays bit-identical.
let mbMemoX = Number.NaN;
let mbMemoZ = Number.NaN;
let mbMemoWX = 0;
let mbMemoWZ = 0;
let mbMemoRag = 0;
// Per-table bounding box of every blob's reach, cached by array identity. A
// warped point outside the box contributes zero from every blob (all d2 >= 1),
// so the whole loop can be skipped bit-identically. terrainHeight consults
// far realms' landness on most samples (border seaGates, the open-sea check),
// which is exactly the always-outside case this gate removes.
interface BlobBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface BoundedBlobs {
  blobs: readonly CoastBlob[];
  bounds: BlobBounds;
}
export function boundedBlobs(blobs: readonly CoastBlob[]): BoundedBlobs {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
  for (const blob of blobs) {
    bounds.minX = Math.min(bounds.minX, blob.x - blob.r);
    bounds.maxX = Math.max(bounds.maxX, blob.x + blob.r);
    bounds.minZ = Math.min(bounds.minZ, blob.z - blob.r);
    bounds.maxZ = Math.max(bounds.maxZ, blob.z + blob.r);
  }
  return { blobs, bounds };
}
export function metaballLandness(
  lobes: BoundedBlobs,
  bays: BoundedBlobs,
  x: number,
  z: number,
): number {
  // Organic coastlines: the raw metaball union reads as connecting circles,
  // so the sample position is domain-warped by fixed-seed fbm (bending the
  // blobs into peninsulas and coves) and the result gets a higher-frequency
  // raggedness term (small capes and inlets). The seeds are CONSTANTS, not
  // the world seed: landness must stay a pure fn of (x, z) because content
  // tables, tests, and the sim's open-sea check were all placed against it.
  if (x !== mbMemoX || z !== mbMemoZ) {
    mbMemoX = x;
    mbMemoZ = z;
    mbMemoWX = x + (fbm2(x * 0.015, z * 0.015, 9101, 3) - 0.5) * 46;
    mbMemoWZ = z + (fbm2(x * 0.015 + 73, z * 0.015 - 41, 9103, 3) - 0.5) * 46;
    mbMemoRag = (fbm2(x * 0.05, z * 0.05, 9107, 2) - 0.5) * 0.2;
  }
  const wx = mbMemoWX;
  const wz = mbMemoWZ;
  let land = 0;
  // Bounds are computed once beside each private coast table. Passing them
  // directly avoids a WeakMap lookup on every terrain landness probe.
  const lb = lobes.bounds;
  if (wx >= lb.minX && wx <= lb.maxX && wz >= lb.minZ && wz <= lb.maxZ) {
    for (const b of lobes.blobs) {
      // |dx| >= r means d2 >= 1 regardless of dz: skip the divisions early
      const dx = wx - b.x;
      if (dx >= b.r || -dx >= b.r) continue;
      const d2 = (dx / b.r) ** 2 + ((wz - b.z) / b.r) ** 2;
      if (d2 < 1) land += (1 - d2) ** 2;
    }
  }
  if (bays.blobs.length > 0) {
    const bb = bays.bounds;
    if (wx >= bb.minX && wx <= bb.maxX && wz >= bb.minZ && wz <= bb.maxZ) {
      for (const b of bays.blobs) {
        const dx = wx - b.x;
        if (dx >= b.r || -dx >= b.r) continue;
        const d2 = (dx / b.r) ** 2 + ((wz - b.z) / b.r) ** 2;
        if (d2 < 1) land -= 1.4 * (1 - d2) ** 2;
      }
    }
  }
  land += mbMemoRag;
  return land - 0.06;
}
