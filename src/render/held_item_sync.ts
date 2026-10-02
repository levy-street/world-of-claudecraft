// Live held-item swaps for one entity view, extracted from the renderer's
// per-entity loop: the equipped mainhand and offhand models (self equip or a
// peer's gear update) and the Katana Table look of a held katana. Each swap
// returns newly attached payloads, which ride the renderer's compile gate so
// first-sight materials link off-thread instead of freezing the frame (#2571).
import type { CharacterVisual } from './characters';
import type { KatanaLookColors } from './characters/katana_look_paint';

export interface HeldItemView {
  visual: CharacterVisual | null;
  mainhandItemId: string | null;
  offhandItemId: string | null;
}

export interface HeldItemEntity {
  kind: string;
  mainhandItemId: string | null;
  offhandItemId: string | null;
  equippedInstances?: { mainhand?: { katana?: KatanaLookColors } };
}

export interface HeldItemSyncHost<V extends HeldItemView> {
  gateSwapOnCompile(node: object): void;
  reconcileViewLights(v: V): void;
  /** Re-queue the encounter-mark prewarm on the new held look. */
  requeueSoulRendPrewarm(visual: CharacterVisual, v: V, kind: string): void;
}

export function syncHeldItems<V extends HeldItemView>(
  host: HeldItemSyncHost<V>,
  v: V,
  e: HeldItemEntity,
): void {
  const visual = v.visual;
  if (!visual) return;
  // setWeapon no-ops on classes with a fixed weapon (hunter). Both held swaps
  // re-run finishWeaponAttach, which re-snapshots the original-material map, so
  // the encounter mark's warmed clones are re-queued on the new held look.
  if (e.mainhandItemId !== v.mainhandItemId) {
    v.mainhandItemId = e.mainhandItemId;
    const changed = visual.setWeapon(e.mainhandItemId);
    if (changed) for (const node of changed) host.gateSwapOnCompile(node);
    host.reconcileViewLights(v);
    host.requeueSoulRendPrewarm(visual, v, e.kind);
  }
  if (e.offhandItemId !== v.offhandItemId) {
    v.offhandItemId = e.offhandItemId;
    const changed = visual.setOffhand(e.offhandItemId);
    if (changed) for (const node of changed) host.gateSwapOnCompile(node);
    host.reconcileViewLights(v);
    host.requeueSoulRendPrewarm(visual, v, e.kind);
  }
  // Katana Table colors and the sheathed scabbard; a no-op unless the look changed.
  const look = e.equippedInstances?.mainhand?.katana ?? null;
  const repainted = visual.setKatanaLook(look);
  if (repainted) {
    for (const node of repainted) host.gateSwapOnCompile(node);
    host.requeueSoulRendPrewarm(visual, v, e.kind);
  }
}
