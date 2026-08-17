// The terminal draw of a renderer frame, lifted out of renderer.sync so the
// "may this frame draw" decision has a testable home. Dependency-injected: the
// host is a structural view of the renderer's draw surfaces, nothing more.
//
// Everything else in sync (view lifecycle, mixers, uTime, the viewport poll)
// keeps running while a frame is skipped, so a hidden window has no create
// burst or shader-link stall waiting for it when it comes back.

export interface FramePresentHost {
  vfx: { prepareDraw(camera: unknown): void };
  post: { updateScreenFx(dt: number): void; render(): void } | null;
  webgl: { render(scene: unknown, camera: unknown): void };
  scene: unknown;
  camera: unknown;
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
  if (!present) {
    host.post?.updateScreenFx(dt);
    return false;
  }
  host.vfx.prepareDraw(host.camera);
  if (host.post) {
    // screen-fx pass state (ripple re-projection, flash decay) advances
    // with the camera finalized for this frame
    host.post.updateScreenFx(dt);
    host.post.render();
  } else host.webgl.render(host.scene, host.camera);
  return true;
}
