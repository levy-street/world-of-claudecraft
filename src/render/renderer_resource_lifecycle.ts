import { uninstallOccluderFadeGate } from './occluder_fade_gate';
import { disposeShaderWarmAudit } from './shader_warm_audit';
import { disposeShaderWarm } from './shader_warm_client';

export interface RendererDisposable {
  dispose(): void;
}

export interface RendererPrewarmAndGroundFxOwner<T extends RendererDisposable> {
  prewarmDepthMaterials: Map<string, T>;
  mageGroundFx?: RendererDisposable;
  warlockMeteorFx?: RendererDisposable;
  vfx?: RendererDisposable;
  abilityVfxFx?: RendererDisposable;
  // The farm patch visuals (src/render/farm_patches.ts) own per-plot material
  // clones; their dispose() walks plots AND feasts. Added at the Phase 17
  // render review: the class carried a correct idempotent terminal owner that
  // no production path ever called (scene.clear() detaches without disposing).
  farmPatchVisuals?: RendererDisposable;
  // The two release-side transient FX (frozen_orb_fx.ts pools its orb
  // materials and shares three geometries; necromancy_army_portal_fx.ts owns
  // its portal materials and a particle texture) joined at the Phase 18
  // sweep: both had a terminal owner with no production caller.
  frozenOrbFx?: RendererDisposable;
  necromancyArmyPortalFx?: RendererDisposable;
  /** The battleground copies this renderer built, by slot
   *  (battleground_views.ts). Each owns a field's terrain, its paint array
   *  texture, the placement instances, the decals and its share of the
   *  point-light budget. */
  bgViews?: Map<number, RendererDisposable>;
}

/**
 * Dispose the renderer-owned prewarm depth materials and ground VFX independently.
 * The renderer passes itself because these resource fields are private.
 */
export function disposeRendererPrewarmAndGroundFx(
  owner: object,
  bestEffort: (cleanup: () => void) => void,
): void {
  const resources = owner as RendererPrewarmAndGroundFxOwner<RendererDisposable>;
  for (const material of resources.prewarmDepthMaterials.values())
    bestEffort(() => material.dispose());
  resources.prewarmDepthMaterials.clear();
  bestEffort(() => resources.mageGroundFx?.dispose());
  bestEffort(() => resources.warlockMeteorFx?.dispose());
  bestEffort(() => resources.abilityVfxFx?.dispose());
  bestEffort(() => resources.vfx?.dispose());
  bestEffort(() => resources.farmPatchVisuals?.dispose());
  bestEffort(() => resources.frozenOrbFx?.dispose());
  bestEffort(() => resources.necromancyArmyPortalFx?.dispose());
  // The live copies release themselves as the session resolves each offer;
  // this is the terminal drain for whatever the teardown catches standing.
  for (const view of resources.bgViews?.values() ?? []) bestEffort(() => view.dispose());
  resources.bgViews?.clear();
  // The occluder-fade gate and its twins were linked on this renderer's
  // context; a later renderer installs its own (occluder_fade_gate.ts).
  bestEffort(() => uninstallOccluderFadeGate());
  // The shader warm audit holds this renderer's compile arms and listens to
  // its links; the next renderer's first announcement binds its own.
  bestEffort(() => disposeShaderWarmAudit());
  // The warm worker's context contract (attributes, extensions) was this
  // renderer's; the next renderer's first gate spawns its own.
  bestEffort(() => disposeShaderWarm());
}

/**
 * Dispose the renderer-owned world-subsystem views (terrain, far terrain,
 * water, underwater) independently. Without this, a graphics-preset rebuild
 * (`src/main.ts` wiring `shutdownRenderer`/`recycleContext` into
 * `GraphicsRebuildCoordinator`, `src/render/context_recycle.ts` driving the
 * `WEBGL_lose_context` cycle; see GitHub issue #3750) silently retains every
 * resident terrain chunk, the far-vista tiles, the water simulation, and the
 * underwater overlay's geometry and materials on the JS heap: nothing else in
 * the renderer's teardown ever calls their dispose() methods, so a rebuild
 * permanently steps up memory instead of returning to its pre-rebuild floor.
 * `FarTerrainView.dispose()` also flips its own `cancelled` flag, so this is
 * what stops its idle-paced tile build from allocating against the dead
 * renderer, the same role `cancelTerrainStreaming()` plays for the near
 * layer. Typed parameters, not a duck-typed owner cast: a call site passes
 * `this.<field>` directly, so a renamed field fails `tsc`, not a silent
 * dispose-nothing. Props/foliage are deliberately NOT included here: unlike
 * these four, their geometries and materials are drawn from the shared
 * GLB-cache (`assets/loader.ts`), and disposing a cached resource that
 * another consumer still reads would corrupt live rendering elsewhere;
 * releasing them safely needs its own per-subsystem accounting, tracked
 * separately.
 */
export function disposeRendererWorldViews(
  terrainView: RendererDisposable | undefined,
  farTerrainView: RendererDisposable | undefined,
  waterView: RendererDisposable | undefined,
  underwaterView: RendererDisposable | undefined,
  bestEffort: (cleanup: () => void) => void,
): void {
  bestEffort(() => terrainView?.dispose());
  bestEffort(() => farTerrainView?.dispose());
  bestEffort(() => waterView?.dispose());
  bestEffort(() => underwaterView?.dispose());
}
