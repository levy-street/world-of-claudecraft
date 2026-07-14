// Headless-Chrome page script (bundled by lib/usdz.mjs): converts GLB bytes
// (base64) to a USDZ (base64) via three.js USDZExporter, so an exported asset
// previews WITH TEXTURES in macOS Quick Look / Preview (which render .glb
// poorly but .usdz natively). Runs in a real browser context, so canvas/image
// decoding needed by the exporter is available.

import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

function b64(u8) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(s);
}

window.toUsdz = async (base64) => {
  const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(bin.buffer, '');
  const usdz = await new USDZExporter().parseAsync(gltf.scene);
  return b64(usdz);
};
window.__ready = true;
