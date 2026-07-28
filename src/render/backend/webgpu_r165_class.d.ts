import Renderer from 'three/addons/renderers/common/Renderer.js';

declare module 'three/addons/renderers/webgpu/WebGPURenderer.js' {
  export default class WebGPURenderer extends Renderer {
    constructor(parameters?: WebGPURendererParameters);
  }
}
