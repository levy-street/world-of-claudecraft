import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';

interface EffectComposerSizeState {
  _width: number;
  _height: number;
  _pixelRatio: number;
}

/**
 * r165's public setters resize once for pixel ratio and again for logical
 * dimensions. This pinned adapter updates both pieces of state before one
 * target/pass resize and can collapse the spare ping-pong target when the
 * final pass renders directly to the canvas.
 */
export class PostEffectComposer extends EffectComposer {
  readonly singleBuffer: boolean;

  constructor(
    renderer: WebGLRenderer,
    renderTarget: WebGLRenderTarget,
    width: number,
    height: number,
    singleBuffer: boolean,
  ) {
    super(renderer, renderTarget);
    this.singleBuffer = singleBuffer;

    if (singleBuffer) {
      const spare = this.renderTarget2;
      this.renderTarget2 = this.renderTarget1;
      this.readBuffer = this.renderTarget1;
      this.writeBuffer = this.renderTarget1;
      spare.dispose();
    }

    this.setSizeAndPixelRatio(width, height, renderer.getPixelRatio());
  }

  setSizeAndPixelRatio(width: number, height: number, pixelRatio: number): void {
    const state = this as unknown as EffectComposerSizeState;
    state._width = width;
    state._height = height;
    state._pixelRatio = pixelRatio;
    const effectiveWidth = Math.max(1, Math.floor(width * pixelRatio));
    const effectiveHeight = Math.max(1, Math.floor(height * pixelRatio));

    this.renderTarget1.setSize(effectiveWidth, effectiveHeight);
    if (!this.singleBuffer) this.renderTarget2.setSize(effectiveWidth, effectiveHeight);
    for (const pass of this.passes) pass.setSize(effectiveWidth, effectiveHeight);
  }

  setRenderRegion(width: number, height: number): void {
    const targets =
      this.renderTarget1 === this.renderTarget2
        ? [this.renderTarget1]
        : [this.renderTarget1, this.renderTarget2];
    for (const target of targets) {
      const renderWidth = Math.min(target.width, Math.max(1, Math.floor(width)));
      const renderHeight = Math.min(target.height, Math.max(1, Math.floor(height)));
      target.viewport.set(0, 0, renderWidth, renderHeight);
      target.scissor.set(0, 0, renderWidth, renderHeight);
      target.scissorTest = renderWidth < target.width || renderHeight < target.height;
    }
  }

  override setSize(width: number, height: number): void {
    const state = this as unknown as EffectComposerSizeState;
    this.setSizeAndPixelRatio(width, height, state._pixelRatio);
  }

  override setPixelRatio(pixelRatio: number): void {
    const state = this as unknown as EffectComposerSizeState;
    this.setSizeAndPixelRatio(state._width, state._height, pixelRatio);
  }

  override dispose(): void {
    if (!this.singleBuffer) {
      super.dispose();
      return;
    }
    this.renderTarget1.dispose();
    this.copyPass.dispose();
  }
}
