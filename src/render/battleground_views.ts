// The Thornhollow Fields copies the session shows, by slot: built the moment
// the player stands in the band (the yumi view-map pattern), or ahead of it.
//
// The field streams in (buildBattleground: terrain, wards, placements, grass,
// decals, flames arrive from async loads), and a bare add of each part drew
// it on its first frame with its programs unlinked: the 1.3 s frame at the
// /dev bg teleport in the 2026-08-28 combat audit, 11 cold programs. Every
// streamed part now goes through the host's attach (gated: hidden until its
// programs link, then shown), and the field's programs do not depend on the
// slot (same kit, another origin), so the queue proposal, thirty seconds
// before the teleport, prebuilds slot 0 hidden: its parts link through the
// same gate during the answer window, and the copy the player is matched
// into then links as a hit whichever slot it is. The asset preload commits
// at the proposal too, so a reconnect straight into a live match, which never
// clicked the queue, still drains it.

import type * as THREE from 'three';
import { BG_SLOT_COUNT, battlegroundOrigin } from '../sim/data';
import {
  type BattlegroundLightHooks,
  type BattlegroundView,
  battlegroundAssetPrewarm,
  buildBattleground,
} from './battleground';

export interface BattlegroundViewHost extends BattlegroundLightHooks {
  scene: { add(object: THREE.Object3D): unknown };
  seed: number;
  /** The streamed parts' attach into the field group (gated by the renderer). */
  attachPart: (part: THREE.Object3D, into: THREE.Group) => void;
}

export type BattlegroundViews = Map<number, BattlegroundView>;

/** How far from a slot's origin the player must stand for its copy to build. */
export const BG_VIEW_NEAR_X = 220;
export const BG_VIEW_NEAR_Z = 200;

/** The slot the proposal prebuilds: any slot serves, the programs are shared. */
export const BG_PREBUILD_SLOT = 0;

function buildSlot(
  views: BattlegroundViews,
  slot: number,
  host: BattlegroundViewHost,
  visible: boolean,
): BattlegroundView {
  const view = buildBattleground(battlegroundOrigin(slot), host.seed, host);
  view.group.visible = visible;
  host.scene.add(view.group);
  views.set(slot, view);
  return view;
}

/** At the queue proposal: prebuild one hidden copy so its programs link
 *  during the answer window, and commit the asset preload. Idempotent. */
export function prebuildBattlegroundView(
  views: BattlegroundViews,
  host: BattlegroundViewHost,
): void {
  void battlegroundAssetPrewarm.commit();
  if (views.size > 0) return;
  buildSlot(views, BG_PREBUILD_SLOT, host, false);
}

/** Per frame while the player stands in the band: the copy of the slot the
 *  player was matched into builds if missing, and shows (a prebuilt copy stays
 *  hidden until the player actually lands in it). */
export function ensureBattlegroundViewNear(
  views: BattlegroundViews,
  px: number,
  pz: number,
  host: BattlegroundViewHost,
): void {
  for (let slot = 0; slot < BG_SLOT_COUNT; slot++) {
    const origin = battlegroundOrigin(slot);
    if (Math.abs(px - origin.x) >= BG_VIEW_NEAR_X || Math.abs(pz - origin.z) >= BG_VIEW_NEAR_Z) {
      continue;
    }
    const view = views.get(slot) ?? buildSlot(views, slot, host, true);
    view.group.visible = true;
  }
}
