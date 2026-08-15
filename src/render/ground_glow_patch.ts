// ground_glow_patch: merged, terrain-conforming ground glow geometry, shared by
// every layer that used to lay a FLAT additive disc on the ground (streetlamp
// pools, campfire ember pools, camp brazier pools).
//
// Why not a flat disc: the world is not flat. A rigid circle floated a hand's
// width over the terrain slices INTO any slope, so on a hillside road half the
// lamplight vanished under the ground. Each patch here is a small radial grid
// whose every vertex sits on the sim's own terrain height plus a small lift, so
// the glow drapes over whatever the ground does, the way projected light would.
//
// Cost model: the patches for one bucket (a zone's lamps, a zone's fires) merge
// into ONE static BufferGeometry drawn with ONE additive material, so a bucket
// costs a single draw, exactly what the flat instanced discs cost. The terrain
// sampling happens once at build time, never per frame.
//
// The UV channel maps each patch's own disc onto [0,1]^2 so the shared radial
// glow sprite (textures.ts radialGlowTexture) shades every patch independently
// inside the merge.
import * as THREE from 'three';

export interface GlowPatchSite {
  x: number;
  z: number;
  radius: number;
}

/** Spokes around each patch ring. 12 keeps a 4 yd pool visibly round. */
export const PATCH_SPOKES = 12;
/** Ring radius fractions out from the centre vertex. */
export const PATCH_RING_FRACTIONS = [0.5, 1] as const;
/** How far above the sampled ground each vertex floats. */
export const PATCH_LIFT = 0.14;
/** Vertices one patch contributes to the merge. */
export const PATCH_VERTS = 1 + PATCH_SPOKES * PATCH_RING_FRACTIONS.length;

/**
 * Build one merged geometry holding a draped glow patch for every site.
 * `groundAt` is the sim's terrainHeight bound to the world seed, per the
 * "terrain height = sim height" invariant; the caller owns the material.
 */
export function buildDrapedGlowGeometry(
  sites: readonly GlowPatchSite[],
  groundAt: (x: number, z: number) => number,
  lift = PATCH_LIFT,
): THREE.BufferGeometry {
  const ringCount = PATCH_RING_FRACTIONS.length;
  const positions = new Float32Array(sites.length * PATCH_VERTS * 3);
  const uvs = new Float32Array(sites.length * PATCH_VERTS * 2);
  const indices: number[] = [];

  for (let s = 0; s < sites.length; s++) {
    const site = sites[s];
    const base = s * PATCH_VERTS;
    // centre vertex
    positions[base * 3] = site.x;
    positions[base * 3 + 1] = groundAt(site.x, site.z) + lift;
    positions[base * 3 + 2] = site.z;
    uvs[base * 2] = 0.5;
    uvs[base * 2 + 1] = 0.5;
    // ring vertices, inner ring first
    for (let r = 0; r < ringCount; r++) {
      const fraction = PATCH_RING_FRACTIONS[r];
      for (let k = 0; k < PATCH_SPOKES; k++) {
        const angle = (k / PATCH_SPOKES) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const x = site.x + cos * site.radius * fraction;
        const z = site.z + sin * site.radius * fraction;
        const v = base + 1 + r * PATCH_SPOKES + k;
        positions[v * 3] = x;
        positions[v * 3 + 1] = groundAt(x, z) + lift;
        positions[v * 3 + 2] = z;
        uvs[v * 2] = 0.5 + 0.5 * cos * fraction;
        uvs[v * 2 + 1] = 0.5 + 0.5 * sin * fraction;
      }
    }
    // centre fan to the inner ring
    for (let k = 0; k < PATCH_SPOKES; k++) {
      const a = base + 1 + k;
      const b = base + 1 + ((k + 1) % PATCH_SPOKES);
      indices.push(base, b, a);
    }
    // band between consecutive rings
    for (let r = 0; r + 1 < ringCount; r++) {
      const inner = base + 1 + r * PATCH_SPOKES;
      const outer = base + 1 + (r + 1) * PATCH_SPOKES;
      for (let k = 0; k < PATCH_SPOKES; k++) {
        const k2 = (k + 1) % PATCH_SPOKES;
        indices.push(inner + k, outer + k2, outer + k);
        indices.push(inner + k, inner + k2, outer + k2);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}
