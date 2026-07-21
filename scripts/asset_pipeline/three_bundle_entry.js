// Bundled (esbuild -> ESM) for the live library viewer: three.js core plus the
// addons the viewer needs, served at /three.bundle.js so the page can render
// real GLBs with orbit controls and meshopt-compressed geometry.
export * as THREE from 'three';
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
export { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// Postprocessing chain for the weapon-inspector VFX layer (emissive bloom).
export { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
export { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
export { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
