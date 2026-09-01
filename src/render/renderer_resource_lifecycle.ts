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
