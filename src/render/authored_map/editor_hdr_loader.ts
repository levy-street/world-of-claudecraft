// Editor-only Radiance (.hdr) decode for the custom skybox picker.
//
// The shared runtime loader (assets/loader.ts) deliberately has no Radiance
// arm: the shipped biome skies are KTX2 UASTC HDR, so nothing in the GAME
// loads a .hdr (tests/sky_ktx2_assets.test.ts keeps it that way). The EDITOR
// still does: a maker can point the Skybox picker at any .hdr on disk, and that
// file is whatever they hand us, not a pipeline artefact we control. So this
// lives beside its one consumer (editor_skybox.ts) instead of in the shared
// loader, and it is deliberately the small arm: no decode worker, no PMREM
// downscale, no retry queue (the editor loads one sky on demand rather than
// streaming them per zone). One promise cache so re-picking a sky is free.

import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { assetUrl } from '../assets/media';
import { assetLoadStarted, recordAssetLoad } from '../assets/stats';

const hdrCache = new Map<string, Promise<THREE.DataTexture>>();

/** Decode a Radiance (.hdr) file for the editor's custom skybox. */
export function loadEditorHdr(url: string): Promise<THREE.DataTexture> {
  const resolved = assetUrl(url);
  let p = hdrCache.get(resolved);
  if (!p) {
    const startedAt = assetLoadStarted();
    p = new Promise<THREE.DataTexture>((resolve, reject) => {
      new HDRLoader().load(
        resolved,
        (tex) => {
          tex.mapping = THREE.EquirectangularReflectionMapping;
          resolve(tex);
        },
        undefined,
        () => reject(new Error(`hdr load failed: ${url}`)),
      );
    }).then(
      (tex) => {
        recordAssetLoad('hdr', resolved, startedAt);
        return tex;
      },
      (err: unknown) => {
        recordAssetLoad('hdr', resolved, startedAt, true);
        // Evict on failure (the loadGltf precedent): a rejected promise left in
        // the cache would poison every later pick for the session.
        if (hdrCache.get(resolved) === p) hdrCache.delete(resolved);
        throw err;
      },
    );
    hdrCache.set(resolved, p);
  }
  return p;
}
