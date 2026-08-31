import * as THREE from 'three';
import {
  patchFogFragmentNanGuard,
  patchOpaqueFragmentNanGuard,
} from './final_color_nan_guard_core';

interface FinalColorShaderChunks {
  opaque_fragment: string;
  fog_fragment: string;
}

/**
 * Install before any scene material compiles, unconditionally: every tier
 * and platform can hit the same driver-level NaN emission (see
 * final_color_nan_guard_core.ts), so this is not scoped to the composer
 * tiers OutputGradePass's sanitizeFinite already covers. Returns true only
 * when this call changed a chunk, mirroring installPbrPointLightShaderPruning.
 */
export function installFinalColorNanGuard(
  chunks: FinalColorShaderChunks = THREE.ShaderChunk,
): boolean {
  const patchedOpaque = patchOpaqueFragmentNanGuard(chunks.opaque_fragment);
  const patchedFog = patchFogFragmentNanGuard(chunks.fog_fragment);
  const changed = patchedOpaque !== chunks.opaque_fragment || patchedFog !== chunks.fog_fragment;
  chunks.opaque_fragment = patchedOpaque;
  chunks.fog_fragment = patchedFog;
  return changed;
}

// The world renderer is not the only WebGLRenderer that compiles real scene
// materials: characters/preview.ts, characters/portrait.ts,
// armory_preview.ts, src/editor/asset_thumbs.ts, src/guide/viewer/scene.ts
// and src/dev/outfit_audit.ts each build their own and never run through
// initGfxTier. (src/render/assets/ktx2_support.ts also builds a throwaway
// renderer, but only to probe texture-format support; it never compiles a
// material, so it is correctly outside this list.) Rather than chase every
// current and future call site individually (a per-site call was tried
// first and missed two of the three under src/render/characters and
// src/render, the exact ordering hazard a reviewer flagged for the one it
// did catch), install here instead, at module scope: importing this module
// is itself enough, before any of those renderers can exist. This is the
// ONLY seam that installs the guard: gfx.ts imports this module for the
// side effect but does not call installFinalColorNanGuard() itself (that
// was also tried; it is a provable no-op there, since this module's static
// import always runs first, and a redundant call reads as load-bearing to
// the next person who edits initGfxTier). installPbrPointLightShaderPruning
// stays on its own different seam (an explicit call inside initGfxTier) on
// purpose: only the world renderer needs point-light pruning today, so its
// narrower scope is correct as is, not an inconsistency to fix here.
installFinalColorNanGuard();
