// Budgeted texture-residency prewarm shared by the secondary preview contexts
// (armory inspect, paperdoll, portraits). A preview warmup's first draw used to
// pay every texture upload of the newly selected rig inside one synchronous
// render call (production traces booked 140 to 870 ms per preview unit, the
// post-entry hitch metronome). Uploading each texture individually through
// WebGLRenderer.initTexture ahead of that draw, under a small per-slice time
// budget with a real yield between slices, keeps every main-thread block
// bounded; the draw that follows finds its textures resident. Already-resident
// textures make initTexture a cheap no-op, so sweeping a whole scene per step
// stays affordable.
import type * as THREE from 'three';

/** Per-slice main-thread budget for texture uploads. Small enough that a slice
 *  landing inside a busy frame cannot by itself push it past the hitch
 *  threshold; large enough that a catalog sweep converges in a few slices. */
export const TEXTURE_PREWARM_SLICE_BUDGET_MS = 8;

/** The one renderer capability this module needs; lets a Vitest drive the
 *  slicing with a fake instead of a WebGL context. */
export interface TexturePrewarmHost {
  initTexture(texture: THREE.Texture): void;
}

/** The shared macrotask yield every staged preview warmup uses between its
 *  bounded slices (a microtask would run before the browser gets a live frame
 *  out). One definition on purpose: the armory, paperdoll, and portrait
 *  warmups all need exactly this. */
export const yieldToMainThread = (): Promise<void> =>
  new Promise<void>((resolve) => window.setTimeout(resolve, 0));

interface TraversableLike {
  traverse(callback: (object: unknown) => void): void;
}

const isPrewarmableTexture = (value: unknown): value is THREE.Texture => {
  if (value === null || typeof value !== 'object') return false;
  const texture = value as THREE.Texture;
  // Render-target textures live GPU-side already and must never be re-uploaded
  // from their (absent) image source.
  return texture.isTexture === true && texture.isRenderTargetTexture !== true;
};

const collectMaterialTextures = (material: unknown, out: Set<THREE.Texture>): void => {
  if (material === null || typeof material !== 'object') return;
  for (const value of Object.values(material as Record<string, unknown>)) {
    if (isPrewarmableTexture(value)) out.add(value);
  }
  // ShaderMaterial textures (the weapon VFX rigs, water-style materials) ride
  // uniforms rather than named map slots; a uniform can also hold a texture
  // ARRAY (sampler2D[]), so sweep one level into array values too.
  const uniforms = (material as { uniforms?: Record<string, { value?: unknown }> }).uniforms;
  if (uniforms && typeof uniforms === 'object') {
    for (const uniform of Object.values(uniforms)) {
      if (!uniform) continue;
      if (isPrewarmableTexture(uniform.value)) out.add(uniform.value);
      else if (Array.isArray(uniform.value)) {
        for (const entry of uniform.value) {
          if (isPrewarmableTexture(entry)) out.add(entry);
        }
      }
    }
  }
};

/** Collect every uploadable texture reachable from `root`'s materials
 *  (map slots and ShaderMaterial uniforms) into `out`, deduplicated. */
export function collectPrewarmTextures(root: TraversableLike, out: Set<THREE.Texture>): void {
  root.traverse((object) => {
    const material = (object as { material?: unknown }).material;
    if (Array.isArray(material)) {
      for (const entry of material) collectMaterialTextures(entry, out);
    } else if (material) {
      collectMaterialTextures(material, out);
    }
  });
}

export interface UploadTexturesOptions {
  /** Yield the main thread between slices (a macrotask, not a microtask: the
   *  point is letting a live frame render between uploads). */
  yieldToMain: () => Promise<void>;
  budgetMs?: number;
  now?: () => number;
  /** Checked before each upload; a destroyed context stops the sweep. */
  isCancelled?: () => boolean;
}

/** Upload `textures` one by one through `host.initTexture`, yielding whenever
 *  a slice's uploads exceed the time budget. Returns how many textures were
 *  handed to the host (cancellation can end the sweep early). */
export async function uploadTexturesInSlices(
  host: TexturePrewarmHost,
  textures: Iterable<THREE.Texture>,
  options: UploadTexturesOptions,
): Promise<number> {
  const budgetMs = options.budgetMs ?? TEXTURE_PREWARM_SLICE_BUDGET_MS;
  const now = options.now ?? ((): number => performance.now());
  let uploaded = 0;
  let sliceStart = now();
  for (const texture of textures) {
    if (options.isCancelled?.()) return uploaded;
    host.initTexture(texture);
    uploaded++;
    if (now() - sliceStart >= budgetMs) {
      await options.yieldToMain();
      sliceStart = now();
    }
  }
  return uploaded;
}
