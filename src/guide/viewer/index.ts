// Public surface of the Guide's interactive 3D model viewer. Pages import ONLY from this
// barrel. modelViewerEmbed + wireModelViewers + hasWebGL are lightweight (no three.js);
// the renderer (scene.ts) and GLB assembly (model.ts) load lazily on first activation, so
// three.js never enters the main Guide bundle.

export { modelViewerEmbed, type ModelEmbedOptions } from './embed';
export { wireModelViewers, createViewer, hasWebGL } from './mount';
export type { ModelViewer } from './scene';
