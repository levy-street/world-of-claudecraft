// Bundled (esbuild -> ESM) for the live library viewer: three.js core plus the
// addons the viewer needs, served at /three.bundle.js so the page can render
// real GLBs with orbit controls and meshopt-compressed geometry.
export * as THREE from 'three';
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
// Neutral studio environment for the Fit Studio: metals/PBR presets need an
// env map to read as metal at all under plain analytic lights.
export { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
export { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
// Postprocessing chain for the weapon-inspector VFX layer (emissive bloom).
export { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
export { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
export { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
// The game's hair-sway driver (stride oscillator → lateral spring + backward
// stream): the Fit Studio feeds it a synthetic gait from the previewed clip so
// built styles sway exactly as they do in game.
export { HairSwayDriver } from '../../src/render/characters/hair_sway.ts';
export { MAT_STUBBLE } from '../../src/render/characters/modular.ts';
// The game's own stubble decal, bundled for the Fit Studio so the scalp worn
// under a fitted hair sculpt is the SAME growth the game composes, not a
// lookalike. Pure three + data code; esbuild erases the TS types.
export { buildStubbleDecal } from '../../src/render/characters/stubble.ts';
