// Bundled (esbuild -> ESM) for the live library viewer: three.js core plus the
// addons the viewer needs, served at /three.bundle.js so the page can render
// real GLBs with orbit controls and meshopt-compressed geometry.
export * as THREE from 'three';
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
