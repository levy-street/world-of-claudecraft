// KTX2 transcoder attach for tool-page GLTFLoaders (browser side, esbuild-bundled).
//
// Shipped GLBs under public/models carry KTX2 (KHR_texture_basisu) textures, so
// every tool page that parses one needs a KTX2Loader attached or GLTFLoader
// rejects the parse outright. Two hosting modes:
// - Pages served from a public/-rooted origin (armory thumbs harness): the
//   transcoder fetches from /basis/ like the game client does.
// - Blank pages built with page.setContent (weapon/mount/mech icon renderers):
//   no origin to fetch from, so the driver injects the transcoder via
//   ktx2TranscoderScriptTag (scripts/lib/ktx2_assets.mjs) and this helper
//   pre-seeds THREE.Cache, which FileLoader consults before any network fetch.
import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

export function attachKtx2(loader, renderer) {
  const injected = typeof window !== 'undefined' ? window.__KTX2_TRANSCODER__ : undefined;
  if (injected) {
    THREE.Cache.enabled = true;
    THREE.Cache.add('/basis/basis_transcoder.js', injected.jsText);
    const bytes = Uint8Array.from(atob(injected.wasmB64), (c) => c.charCodeAt(0));
    THREE.Cache.add('/basis/basis_transcoder.wasm', bytes.buffer);
  }
  const ktx2 = new KTX2Loader().setTranscoderPath('/basis/');
  ktx2.detectSupport(renderer);
  loader.setKTX2Loader(ktx2);
  return loader;
}
