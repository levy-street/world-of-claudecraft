// KTX2/Basis transcoder wiring for GLB-embedded compressed textures.
//
// Every GLB under public/models carries its textures as KTX2 (KHR_texture_basisu)
// so they stay GPU-compressed in memory instead of decoding to full RGBA bitmaps
// (the decode amplification was the bulk of the WKWebView process footprint that
// got the native iOS client jetsam-killed at world entry). GLTFLoader needs a
// KTX2Loader attached before it can parse them.
//
// KTX2Loader.detectSupport requires a live WebGLRenderer, but GLB preloads start
// at the launcher, long before the real Renderer exists. detectSupport only reads
// extension support flags, so a 1x1 throwaway renderer is enough; it is released
// immediately (browsers cap ~16 live WebGL contexts, see context_release.ts).
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

// Served verbatim from public/basis/ in every host (vite dev, the deployed
// site, the Capacitor native bundle, the Electron app scheme). The files are
// deliberately not media-manifest hashed: KTX2Loader fetches them by path.
const TRANSCODER_PATH = '/basis/';

let ktx2: KTX2Loader | null = null;

function detectViaThrowawayContext(loader: KTX2Loader): void {
  let probe: THREE.WebGLRenderer | null = null;
  try {
    // Node test hosts drive loadGltf without a DOM; they take the RGBA
    // fallback config below instead of a context probe.
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    probe = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    loader.detectSupport(probe);
  } catch {
    // No context available (exhausted pool, headless edge case): fall back to
    // transcoding into plain RGBA, which every WebGL implementation accepts.
    // Bigger in memory, but it keeps models loading instead of failing parse.
    // Dev-channel English: this restores the decoded-bitmap footprint the
    // KTX2 conversion exists to remove, so it must be visible in a console.
    console.warn('[ktx2] no probe context; transcoding to uncompressed RGBA');
    loader.workerConfig = {
      astcSupported: false,
      etc1Supported: false,
      etc2Supported: false,
      dxtSupported: false,
      bptcSupported: false,
      pvrtcSupported: false,
    };
  } finally {
    try {
      probe?.forceContextLoss();
      probe?.dispose();
    } catch {
      // Best-effort teardown; the probe context is unreachable afterwards
      // either way and the browser reclaims lost contexts.
    }
  }
}

/** The shared KTX2 transcoder, initialized on first use. Attach to a
 *  GLTFLoader via setKTX2Loader before parsing any public/models GLB. */
export function ktx2Loader(): KTX2Loader {
  if (!ktx2) {
    ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath(TRANSCODER_PATH);
    detectViaThrowawayContext(ktx2);
  }
  return ktx2;
}

export const ktx2InternalsForTest = {
  reset(): void {
    ktx2 = null;
  },
};
