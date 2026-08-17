// Dev-channel residency accounting for the iOS entry-kill investigation.
//
// Walks the live scene graph plus the module-level asset caches and reports
// where the decoded bytes sit at a moment in time: geometry attribute arrays
// (deduped by buffer identity, split scene vs cache), decoded or transcoded
// texture bytes (compressed mip chains counted as stored, bitmaps as w*h*4,
// deduped by source), and the parsed-GLTF retention maps. English console
// output by design. The one caller is the Renderer constructor's build
// summary, gated to dev browsers and the iOS WebKit profile (every iOS host, not
// just the packaged app). Known
// under-count: only the six common material map slots are walked; alphaMap,
// envMap, scene.background and the standalone texture cache are not. World-only
// KTX2 textures released by ktx2_mip_release.ts truthfully report ~0 mip bytes
// after upload; the renderer passes the retained restore sources in as their
// own pre-counted 'ktx2 restore sources' entry (ktx2RetainedSourceBytes fed
// through ResidencySource.bytes) so the mip release cannot read as a free win
// in this table. residencyBudget itself stays a pure function of its sources
// argument.
import type * as THREE from 'three';

export interface ResidencyBucket {
  category: string;
  bytes: number;
  count: number;
}

interface BudgetAccumulator {
  add(category: string, bytes: number): void;
  buckets(): ResidencyBucket[];
}

function makeAccumulator(): BudgetAccumulator {
  const map = new Map<string, { bytes: number; count: number }>();
  return {
    add(category, bytes) {
      const b = map.get(category) ?? { bytes: 0, count: 0 };
      b.bytes += bytes;
      b.count += 1;
      map.set(category, b);
    },
    buckets() {
      return [...map.entries()]
        .map(([category, b]) => ({ category, bytes: b.bytes, count: b.count }))
        .sort((a, b) => b.bytes - a.bytes);
    },
  };
}

function geometryBytes(geo: THREE.BufferGeometry, seenArrays: Set<unknown>): number {
  let total = 0;
  const attrs = Object.values(geo.attributes) as Array<{
    array?: ArrayLike<number> & { byteLength?: number };
    data?: { array?: { byteLength?: number } };
  }>;
  for (const attr of attrs) {
    // Interleaved attributes share one backing buffer; count it once.
    const backing = attr.data?.array ?? attr.array;
    if (!backing || seenArrays.has(backing)) continue;
    seenArrays.add(backing);
    total += (backing as { byteLength?: number }).byteLength ?? 0;
  }
  const idx = geo.index;
  if (idx?.array && !seenArrays.has(idx.array)) {
    seenArrays.add(idx.array);
    total += idx.array.byteLength;
  }
  return total;
}

function textureBytes(tex: THREE.Texture, seenImages: Set<unknown>): number {
  const img = tex.image as
    | { width?: number; height?: number; data?: { byteLength?: number } }
    | undefined;
  if (!img || seenImages.has(img)) return 0;
  seenImages.add(img);
  // KTX2 textures keep their transcoded blocks in the mipmap array; the image
  // is a bare {width,height} and w*h*4 would over-report by the compression
  // ratio (the whole point of shipping them compressed).
  const compressed = tex as {
    isCompressedTexture?: boolean;
    mipmaps?: { data?: { byteLength?: number } }[];
  };
  if (compressed.isCompressedTexture) {
    let total = 0;
    for (const mip of compressed.mipmaps ?? []) total += mip.data?.byteLength ?? 0;
    return total;
  }
  // DataTexture carries its buffer; decoded bitmaps cost w*h*RGBA.
  if (img.data?.byteLength) return img.data.byteLength;
  if (img.width && img.height) return img.width * img.height * 4;
  return 0;
}

function walkObject(
  root: THREE.Object3D,
  label: string,
  acc: BudgetAccumulator,
  seenArrays: Set<unknown>,
  seenImages: Set<unknown>,
): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) {
      const bytes = geometryBytes(mesh.geometry as THREE.BufferGeometry, seenArrays);
      if (bytes > 0) acc.add(`${label}: geometry`, bytes);
    }
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const mat of mats) {
      const m = mat as THREE.MeshStandardMaterial;
      for (const t of [
        m.map,
        m.normalMap,
        m.emissiveMap,
        m.roughnessMap,
        m.metalnessMap,
        m.aoMap,
      ]) {
        if (t) {
          const bytes = textureBytes(t, seenImages);
          if (bytes > 0) acc.add(`${label}: textures`, bytes);
        }
      }
    }
  });
}

export interface ResidencySource {
  /** e.g. the live scene, a parsed-GLTF cache's scenes, an extract cache's parts */
  label: string;
  objects?: THREE.Object3D[];
  geometries?: THREE.BufferGeometry[];
  textures?: THREE.Texture[];
  /** Pre-counted bytes attributed directly to `label`, for retention that is
   *  not a walkable Three object (e.g. the KTX2 restore-source registry, raw
   *  ArrayBuffers the caller sums via ktx2RetainedSourceBytes()). */
  bytes?: number;
}

/** One-shot walk over every registered source; dedupes shared buffers/images so
 *  a texture referenced from both a parse cache and the scene counts once, at
 *  the FIRST source that reaches it (order sources accordingly). */
export function residencyBudget(sources: ResidencySource[]): ResidencyBucket[] {
  const acc = makeAccumulator();
  const seenArrays = new Set<unknown>();
  const seenImages = new Set<unknown>();
  for (const src of sources) {
    for (const obj of src.objects ?? []) walkObject(obj, src.label, acc, seenArrays, seenImages);
    for (const geo of src.geometries ?? []) {
      const bytes = geometryBytes(geo, seenArrays);
      if (bytes > 0) acc.add(`${src.label}: geometry`, bytes);
    }
    for (const tex of src.textures ?? []) {
      const bytes = textureBytes(tex, seenImages);
      if (bytes > 0) acc.add(`${src.label}: textures`, bytes);
    }
    if (src.bytes !== undefined && src.bytes > 0) acc.add(src.label, src.bytes);
  }
  return acc.buckets();
}

export function formatResidencyBudget(buckets: ResidencyBucket[]): string {
  const total = buckets.reduce((s, b) => s + b.bytes, 0);
  const lines = buckets.map(
    (b) =>
      `${(b.bytes / 1048576).toFixed(1).padStart(8)} MB  x${String(b.count).padStart(5)}  ${b.category}`,
  );
  return [`[residency] total ${(total / 1048576).toFixed(1)} MB`, ...lines].join('\n');
}
