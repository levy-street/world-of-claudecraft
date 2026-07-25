// Shadow-pass-only gate for instanced shadow proxy meshes.
//
// Foliage submits separate colorWrite-off InstancedMesh clones so canopies
// cast shadows independently of the live color mesh, but three still issues
// (and counts) a color-pass draw for every such clone. The pinned three r165
// exposes per-object onBeforeShadow/onAfterShadow hooks around each shadow
// draw, and its instanced draw path skips the GL call entirely when
// `count === 0` (WebGLBufferRenderer.renderInstances primcount guard). So:
// restore the instance count just before the shadow draw and zero it right
// after; the color pass, which renders AFTER the shadow pass inside the same
// webgl.render, then skips the clone for free. When the shadow pass does not
// run at all (shadows off, frustum-culled, census-frozen), the count simply
// stays zero, which is exactly right for a shadow-only mesh.
//
// Pure core contract: structural mesh shape only, no three import, no DOM,
// no clocks, no randomness. Registered in RENDER_PURE_CORES
// (tests/architecture.test.ts); tested by tests/shadow_pass_gate_core.test.ts.

// The hook properties are typed `unknown` so a THREE.InstancedMesh (whose
// hooks take the renderer/camera/... argument list) stays structurally
// assignable under strict function variance; the gate's own hooks need no
// arguments.
export interface ShadowPassGatedMesh {
  count: number;
  onBeforeShadow: unknown;
  onAfterShadow: unknown;
  /** The real instance count, for cost telemetry: `count` reads 0 outside
   * the shadow draw once the gate is attached. */
  shadowPassFullCount?: number;
}

/**
 * Make an instanced shadow proxy draw ONLY in the shadow pass. Call after the
 * mesh's final instance count is set; the count is captured once (foliage
 * bucket counts are fixed at build time).
 *
 * CALLER CONTRACT: compute (or pin) the mesh's bounding volumes BEFORE
 * attaching the gate. three's frustum test lazily computes an
 * InstancedMesh's bounding sphere from its CURRENT count exactly once; at
 * the gated count of 0 that caches an empty sphere and culls the mesh, and
 * its shadow, forever.
 */
export function attachShadowPassOnlyGate(mesh: ShadowPassGatedMesh): void {
  const fullCount = mesh.count;
  mesh.shadowPassFullCount = fullCount;
  mesh.onBeforeShadow = () => {
    mesh.count = fullCount;
  };
  mesh.onAfterShadow = () => {
    mesh.count = 0;
  };
  // Start color-invisible: the first shadow draw of a frame restores the
  // count before it is needed.
  mesh.count = 0;
}
