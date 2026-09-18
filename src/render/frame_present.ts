// The terminal draw of a renderer frame, lifted out of renderer.sync so the
// "may this frame draw" decision has a testable home. Dependency-injected: the
// host is a structural view of the renderer's draw surfaces, nothing more.
//
// Everything else in sync (view lifecycle, mixers, uTime, the viewport poll)
// keeps running while a frame is skipped, so a hidden window has no create
// burst or shader-link stall waiting for it when it comes back.
//
// The draw is also where a program ESCAPE is visible: a variant no prewarm
// covered links synchronously inside this render call, so the live-program
// watch brackets exactly it (absorb before, record after) and nothing else. A
// skipped frame absorbs too: see presentFrame. The watch rides the host like
// every other effect here (injected, so this file stays a pure core and a
// stub host draws with no watch at all).

import type { GpuFrameTimer } from './gpu_timer_probe';
import type { ProgramListHost } from './live_program_watch';

/** The live-program watch as the draw sees it (src/render/live_program_watch.ts). */
export interface FramePresentProgramWatch {
  absorbLivePrograms(webgl: ProgramListHost): void;
  recordNewLivePrograms(webgl: ProgramListHost): void;
}

export interface FramePresentHost {
  vfx: { prepareDraw(camera: unknown): void };
  post: { updateScreenFx(dt: number): void; render(): void } | null;
  webgl: { render(scene: unknown, camera: unknown): void } & ProgramListHost;
  scene: unknown;
  camera: unknown;
  programWatch?: FramePresentProgramWatch | null;
  /** The GPU timer probe (gpu_timer_probe.ts), null unless `?gputimer=1`.
   *  The composer brackets its own passes; the direct draw is bracketed here. */
  gpuTimer?: GpuFrameTimer | null;
}

/**
 * Submit the frame. Returns whether anything was actually drawn.
 *
 * When present is false the GL work (the vfx draw prep and the composer or
 * renderer submit) is skipped, but the screen-fx pass is still advanced: it only
 * ages CPU-side state (ripple re-projection, flash decay), so freezing it would
 * leave a stale flash to pop the moment the window is shown again.
 */
export function presentFrame(host: FramePresentHost, dt: number, present: boolean): boolean {
  // Ahead of the skip: a program minted while frames are skipped is prep by
  // definition (nothing drew it), so absorbing only on the drawing arm would
  // hand a whole hidden-window backlog to the next real draw as escapes.
  host.programWatch?.absorbLivePrograms(host.webgl);
  const gpuTimer = host.gpuTimer ?? null;
  if (!present) {
    host.post?.updateScreenFx(dt);
    // A skipped frame issues no queries, but the ones in flight still need
    // their readback poll or a long hidden stretch would drop them all.
    gpuTimer?.endFrame();
    return false;
  }
  host.vfx.prepareDraw(host.camera);
  // Arms the probe for THIS submit only: a composer or renderer draw issued
  // out of band (prewarm, census, screenshot) opens no bracket.
  gpuTimer?.beginFrame();
  try {
    if (host.post) {
      // screen-fx pass state (ripple re-projection, flash decay) advances
      // with the camera finalized for this frame
      host.post.updateScreenFx(dt);
      host.post.render();
    } else {
      gpuTimer?.beginScene();
      try {
        host.webgl.render(host.scene, host.camera);
      } finally {
        gpuTimer?.end();
      }
    }
  } finally {
    gpuTimer?.endFrame();
  }
  host.programWatch?.recordNewLivePrograms(host.webgl);
  return true;
}
