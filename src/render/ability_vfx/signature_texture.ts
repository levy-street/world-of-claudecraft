import type * as THREE from 'three';
import { loadTexture } from '../assets/loader';
import { registerDeferredPreload } from '../assets/preload';

export const SIGNATURE_ATLAS_URL = '/textures/vfx/signature-atlas.png';
let atlas: THREE.Texture | null = null;
// The shared loader owns this immutable texture, including context restoration.
// No image fetch or decode occurs on a cast.
registerDeferredPreload(
  () =>
    loadTexture(SIGNATURE_ATLAS_URL).then((texture) => {
      atlas = texture;
    }),
  true,
);
export function signatureTexture(): THREE.Texture | null {
  return atlas;
}
