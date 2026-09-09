// The one place a texture's anisotropic-filtering budget is decided.
//
// Anisotropy used to be a flat constant per call site (8 on the terrain splat
// albedo, 4 on its normals, 4 on every parsed GLB colour and normal map, 4 or 8
// in half a dozen other modules), so a bandwidth-bound integrated GPU sampled
// the whole ground eight ways per fragment at a grazing angle for exactly the
// same cost a discrete desktop GPU absorbs without noticing. The budget now
// comes from the STATIC preset (`GFX.anisotropy` / `GFX.normalAnisotropy`,
// derived in gfx.ts), never from the FPS governor: a sampler tap count is
// cosmetic sharpness, never information a player reacts to.
//
// WHY THIS IS A MODULE AND NOT `tex.anisotropy = GFX.anisotropy` AT EACH SITE.
// Anisotropy is a sampler parameter three applies inside `uploadTexture` only
// (WebGLTextures.setTextureParameters is reached from there and nowhere else),
// and it is ALSO an input to `getTextureCacheKey`. So on an already-uploaded
// texture:
//   - changing `anisotropy` alone does nothing at all: `setTexture2D` re-enters
//     `uploadTexture` only when `texture.version` went stale, so the parameter
//     silently keeps its pre-upload value;
//   - changing it AND setting `needsUpdate` is worse: the new cache key mints a
//     fresh WebGLTexture with `forceUpload`, a full re-upload that comes back
//     BLACK for a KTX2 texture whose CPU mips assets/ktx2_mip_release.ts has
//     already released.
// The cheapest correct path is therefore: stamp the value BEFORE the first
// upload and never touch `needsUpdate` for it. That is a real ordering problem,
// because the deferred preload lane parses world GLBs (and the terrain splat
// channel) BEFORE the Renderer constructor runs `initGfxTier`, so a stamp at
// parse time would be a guess at the tier. Every stamp is therefore registered
// here and re-applied by `refreshTextureAnisotropy`, which the Renderer calls
// right after `initGfxTier` and before it builds any scene content: at that
// moment the world context has uploaded nothing, so the re-stamp is free.
//
// A renderer this repo builds outside `initGfxTier` (the character preview and
// portrait contexts) may already have uploaded a shared texture by then. It
// keeps the value it uploaded with, which is why the re-stamp deliberately
// leaves `needsUpdate` alone: a launcher preview drawn one tap softer or
// sharper than the world is cosmetic, a black portrait is not.
import type { GfxSettings } from './gfx';
import { GFX } from './gfx';

/** Colour maps carry the full budget; normals and data maps take half of it. */
export type AnisotropyMapClass = 'colour' | 'normal';

/** The slice of a three Texture this owns. Structural so the module stays
 *  three-free and a Vitest can drive it with a plain object. */
export interface AnisotropicTexture {
  anisotropy: number;
}

/** The slice of a WebGLRenderer the device ceiling is read from. */
export interface AnisotropyCapabilityHost {
  capabilities: { getMaxAnisotropy(): number };
}

interface Registration {
  readonly ref: WeakRef<AnisotropicTexture>;
  readonly map: AnisotropyMapClass;
}

let deviceMax = Number.POSITIVE_INFINITY;
let registrations: Registration[] = [];

/** The budget for one map class, clamped to what the device can sample. */
export function anisotropyFor(
  map: AnisotropyMapClass,
  settings: Readonly<GfxSettings> = GFX,
): number {
  const taps = map === 'normal' ? settings.normalAnisotropy : settings.anisotropy;
  return Math.max(1, Math.min(taps, deviceMax));
}

/**
 * Stamp the current budget onto a texture and remember it, so a stamp made
 * before `initGfxTier` resolved the tier is corrected before the world renderer
 * uploads it. Never sets `needsUpdate` (see the header).
 */
export function applyTextureAnisotropy<T extends AnisotropicTexture>(
  tex: T,
  map: AnisotropyMapClass,
): T {
  tex.anisotropy = anisotropyFor(map);
  registrations.push({ ref: new WeakRef(tex), map });
  return tex;
}

/**
 * Re-apply the live budget to every registered texture, dropping the ones that
 * have been collected. Called by the Renderer right after `initGfxTier`, so
 * every construction of a renderer (a graphics-preset rebuild included) lands
 * the resolved value before that context's first upload.
 */
export function refreshTextureAnisotropy(webgl?: AnisotropyCapabilityHost): void {
  if (webgl) deviceMax = webgl.capabilities.getMaxAnisotropy();
  const live: Registration[] = [];
  for (const entry of registrations) {
    const tex = entry.ref.deref();
    if (!tex) continue;
    tex.anisotropy = anisotropyFor(entry.map);
    live.push(entry);
  }
  registrations = live;
}

export const textureAnisotropyInternalsForTest = {
  registeredCount: (): number => registrations.length,
  registrations: (): readonly Registration[] => registrations,
  reset: (): void => {
    deviceMax = Number.POSITIVE_INFINITY;
    registrations = [];
  },
};
