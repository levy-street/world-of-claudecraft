// Authored ground decals: images draped over the terrain (pentagrams, blast
// scorch, blood pools, tracks). Render-only — a decal never collides, blocks,
// or reaches the sim; it is paint that follows the ground.
//
// STREAMING is the whole design. A map may carry MAX_DECALS records, but only
// those within a decal's own view range are resident: entering range meshes a
// terrain-conforming patch and ACQUIRES its texture (ref-counted, so leaving
// range frees the VRAM), and a live budget keeps the nearest N when a map
// stamps more than that into one spot. Range scales with footprint, so a
// 60-yard summoning circle is visible from far off while boot prints appear
// only when you are near enough to see them at all. Nothing about a decal is
// touched — not its bytes, not its mesh — while it is out of range.
//
// Conforming, not projecting: each decal is a small grid patch whose vertices
// sample terrainHeight, lifted a hair and drawn with a polygon offset. That
// costs nothing at rest, works on the low graphics tier, and needs no depth
// prepass — at the price of a decal being cut off by a cliff it spans, which
// is what a stamped-on-the-ground decal should do anyway.

import * as THREE from 'three';
import { getActiveWorldContent } from '../sim/data';
import type { MapDecal } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { groundImageFor } from './assets/ground_textures';
import { acquireTexture } from './assets/loader';
import { assetUrl } from './assets/media';
import { registerPageTeardown } from './context_release';
import { DECAL_LIBRARY } from './decal_library.generated';
import { keepDroppedDecal, pickResidentDecals } from './decal_stream_core';

const BUILTIN_PREFIX = 'builtin:';

/** Public path of a built-in decal image, or null for an unknown key. */
export function decalTexturePath(key: string): string | null {
  return DECAL_LIBRARY.some((d) => d.key === key) ? `textures/decals/${key}.webp` : null;
}

/** The art id a map stores for built-in decal `key`. */
export function builtinDecalId(key: string): string {
  return `${BUILTIN_PREFIX}${key}`;
}

/** The library key behind a `builtin:` art id, else null (an imported sha). */
export function builtinDecalKey(tex: string): string | null {
  return tex.startsWith(BUILTIN_PREFIX) ? tex.slice(BUILTIN_PREFIX.length) : null;
}

/** Browser URL for a decal's art, for editor thumbnails. Null when an imported
 *  decal's bytes have not been resolved in this session yet. */
export function decalPreviewUrl(tex: string): string | null {
  const key = builtinDecalKey(tex);
  if (key) {
    const path = decalTexturePath(key);
    return path ? assetUrl(path) : null;
  }
  return importedUrls.get(tex) ?? null;
}

// ---- art cache ---------------------------------------------------------------
//
// Built-in art rides the shared loader's ref-counted acquire (one cache for the
// whole renderer). Imported art is decoded out of the same IndexedDB store the
// paint tool's imported textures use, and ref-counted here.

interface ImportedArt {
  refs: number;
  texture: THREE.Texture | null;
  promise: Promise<THREE.Texture | null>;
}

const importedArt = new Map<string, ImportedArt>();
const importedUrls = new Map<string, string>();

function acquireImported(sha: string): {
  texture: Promise<THREE.Texture | null>;
  release: () => void;
} {
  let art = importedArt.get(sha);
  if (!art) {
    const entry: ImportedArt = {
      refs: 0,
      texture: null,
      promise: groundImageFor(sha).then((bitmap) => {
        if (!bitmap) return null;
        const tex = new THREE.Texture(bitmap);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        entry.texture = tex;
        // Dropped to zero while decoding: honour that now rather than leaking.
        if (entry.refs <= 0) {
          tex.dispose();
          entry.texture = null;
          return null;
        }
        return tex;
      }),
    };
    art = entry;
    importedArt.set(sha, entry);
  }
  art.refs++;
  let released = false;
  return {
    texture: art.promise,
    release: () => {
      if (released) return;
      released = true;
      const e = importedArt.get(sha);
      if (!e) return;
      e.refs--;
      if (e.refs > 0) return;
      e.texture?.dispose();
      e.texture = null;
      importedArt.delete(sha);
    },
  };
}

function acquireArt(tex: string): {
  texture: Promise<THREE.Texture | null>;
  release: () => void;
} {
  const key = builtinDecalKey(tex);
  if (!key) return acquireImported(tex);
  const path = decalTexturePath(key);
  if (!path) return { texture: Promise.resolve(null), release: () => {} };
  const held = acquireTexture(assetUrl(path), { srgb: true });
  return {
    texture: held.texture.then((t) => {
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    }),
    release: held.release,
  };
}

/** Drop every cached imported-decal texture (page teardown / context loss). */
export function disposeDecalArtCache(): void {
  for (const art of importedArt.values()) art.texture?.dispose();
  importedArt.clear();
  for (const url of importedUrls.values()) URL.revokeObjectURL(url);
  importedUrls.clear();
}

if (typeof window !== 'undefined') registerPageTeardown(disposeDecalArtCache);

// ---- streaming ----------------------------------------------------------------
//
// The RULES (range, ranking, fade, hysteresis, budget) live in
// decal_stream_core.ts as pure maths so they can be tested without a GL
// context; this file only turns the decision into meshes.

// Terrain samples per yard across a patch, and the clamps on the resulting
// grid. Fine enough to follow ordinary ground, cheap enough to build inline.
const SEGMENTS_PER_YARD = 0.7;
const MIN_SEGMENTS = 4;
const MAX_SEGMENTS = 40;
// Lift above the terrain, in yards: enough to clear z-fighting on a slope
// without the decal visibly floating when seen edge-on.
const LIFT = 0.045;

interface DecalEntry {
  decal: MapDecal;
  mesh: THREE.Mesh;
  material: THREE.MeshLambertMaterial;
  release: () => void;
  /** Set once the art resolves; a decal with no art stays hidden, never white. */
  ready: boolean;
}

export class Decals {
  readonly group = new THREE.Group();
  private decals: readonly MapDecal[] = [];
  private live = new Map<number, DecalEntry>();
  /** Reused across frames so a steady camera allocates nothing here. */
  private readonly wanted = new Set<number>();

  constructor(private readonly seed: number) {
    this.group.name = 'decals';
    this.rebuild();
  }

  /** (Re)load the decal set from `list` (the editor's live document) or, when
   *  omitted, the active world content. Every resident mesh is dropped: the
   *  next update re-streams whatever is still in range. */
  rebuild(list?: readonly MapDecal[]): void {
    this.dropAll();
    this.decals = list ?? getActiveWorldContent().decals ?? [];
  }

  /**
   * Stream the resident set against the camera: mesh what came into range,
   * drop what left, and fade the band between. Called once per frame.
   */
  update(camX: number, camZ: number, fogFar: number): void {
    const picks = pickResidentDecals(this.decals, camX, camZ, fogFar);
    this.wanted.clear();
    for (const pick of picks) {
      this.wanted.add(pick.index);
      let entry = this.live.get(pick.index);
      if (!entry) {
        entry = this.build(this.decals[pick.index]);
        this.live.set(pick.index, entry);
      }
      const opacity = (entry.decal.opacity ?? 1) * pick.fade;
      entry.material.opacity = opacity;
      // Hidden, not dropped, until the art lands: a textureless decal would
      // otherwise render as a white quad on the ground for a frame or two.
      entry.mesh.visible = entry.ready && opacity > 0.004;
    }
    for (const [index, entry] of this.live) {
      if (this.wanted.has(index)) continue;
      if (keepDroppedDecal(entry.decal, camX, camZ, fogFar, this.live.size)) {
        entry.mesh.visible = false;
        continue;
      }
      this.disposeEntry(entry);
      this.live.delete(index);
    }
  }

  private build(d: MapDecal): DecalEntry {
    const halfX = d.size * 0.5;
    const halfZ = d.size * (d.aspect ?? 1) * 0.5;
    const seg = Math.max(
      MIN_SEGMENTS,
      Math.min(MAX_SEGMENTS, Math.round(Math.max(halfX, halfZ) * 2 * SEGMENTS_PER_YARD)),
    );
    const geo = new THREE.PlaneGeometry(d.size, d.size * (d.aspect ?? 1), seg, seg);
    geo.rotateX(-Math.PI / 2); // plane's +y normal -> up, uv preserved
    // Drape: every vertex sits on the terrain under it, so the patch follows
    // slopes and rolls instead of intersecting them.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const cos = Math.cos(d.rot);
    const sin = Math.sin(d.rot);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      // THREE's Y rotation maps local (x, z) to (x·cos + z·sin, -x·sin + z·cos)
      // — the opposite handedness to the textbook 2D rotation. Sampling with
      // the wrong one puts a rotated decal's height profile on the wrong side
      // of the slope: flat ground looks fine, a hillside does not.
      const wx = d.x + lx * cos + lz * sin;
      const wz = d.z - lx * sin + lz * cos;
      pos.setY(i, terrainHeight(wx, wz, this.seed) + LIFT);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere(); // the drape moved every vertex; refresh culling

    const material = new THREE.MeshLambertMaterial({
      // The art's own ALPHA channel is the coverage mask (map.a rides straight
      // into diffuseColor.a), so no separate alphaMap is needed — and using one
      // would read the GREEN channel, not the alpha.
      color: d.color ?? 0xffffff,
      transparent: true,
      opacity: d.opacity ?? 1,
      depthWrite: false,
      // Decals sit ON the ground: bias them toward the camera so a coplanar
      // patch never fights the terrain triangle beneath it.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
      alphaTest: 0.004,
    });
    if (d.glow) {
      material.emissive = new THREE.Color(d.color ?? 0xffffff);
      material.emissiveIntensity = d.glow;
    }
    const mesh = new THREE.Mesh(geo, material);
    // Local space is already world space (the drape baked world Y in), so the
    // mesh only carries the yaw and the anchor.
    mesh.position.set(d.x, 0, d.z);
    mesh.rotation.y = d.rot;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    // Over the terrain (renderOrder 0) and under the UI decals (3); `sort`
    // resolves overlapping stamps in the maker's chosen order.
    mesh.renderOrder = 1 + (d.sort ?? 0) * 0.01;
    mesh.visible = false; // until the art resolves
    mesh.frustumCulled = true;
    this.group.add(mesh);

    const entry: DecalEntry = {
      decal: d,
      mesh,
      material,
      release: () => {},
      ready: false,
    };
    const held = acquireArt(d.tex);
    entry.release = held.release;
    void held.texture.then((tex) => {
      // The entry may already have been dropped (walked away mid-fetch).
      if (!tex || entry.material.userData.disposed) return;
      entry.material.map = tex;
      // Glow follows the ART, not the quad: an emissive with no map would light
      // the whole footprint, including the parts the mask cuts away.
      if (d.glow) entry.material.emissiveMap = tex;
      entry.material.needsUpdate = true;
      entry.ready = true;
    });
    return entry;
  }

  private disposeEntry(entry: DecalEntry): void {
    entry.material.userData.disposed = true;
    this.group.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.material.dispose();
    entry.release();
  }

  private dropAll(): void {
    for (const entry of this.live.values()) this.disposeEntry(entry);
    this.live.clear();
  }

  /** Release every mesh and texture hold (renderer teardown). */
  dispose(): void {
    this.dropAll();
    this.decals = [];
  }
}
