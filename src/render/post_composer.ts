import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { GpuFrameTimer } from './gpu_timer_probe';
import { gpuTimerBracketDrawsScene, gpuTimerPassName } from './gpu_timer_probe_core';

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
  /** The GPU timer probe's per-pass brackets (gpu_timer_probe.ts); null,
   *  the default, renders through three's own loop untouched. */
  passTimer: GpuFrameTimer | null = null;

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

  /** Three's pass loop with one timer bracket per enabled pass. Only the
   *  `?gputimer=1` arm runs it; without a timer the loop is three's own. The
   *  mask-pass branch of the original is not carried: this chain builds no
   *  MaskPass (post.ts, pinned by tests/gpu_timer_probe.test.ts), so the timed
   *  loop is the same submission in the same order. */
  override render(deltaTime?: number): void {
    const timer = this.passTimer;
    if (!timer) {
      super.render(deltaTime);
      return;
    }
    this.timer.update();
    const dt = deltaTime ?? this.timer.getDelta();
    const currentRenderTarget = this.renderer.getRenderTarget();
    for (let i = 0; i < this.passes.length; i++) {
      const pass = this.passes[i];
      if (pass.enabled === false) continue;
      pass.renderToScreen = this.renderToScreen && this.isLastEnabledPass(i);
      const name = gpuTimerPassName(pass);
      if (gpuTimerBracketDrawsScene(name)) timer.beginScene(name);
      else timer.begin(name);
      try {
        pass.render(this.renderer, this.writeBuffer, this.readBuffer, dt, false);
      } finally {
        // A pass that throws must not leave its bracket open, or every later
        // begin would throw on nesting for the rest of the session.
        timer.end();
      }
      if (pass.needsSwap) this.swapBuffers();
    }
    this.renderer.setRenderTarget(currentRenderTarget);
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
