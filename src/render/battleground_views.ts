// The Thornhollow Fields copies the session shows, by slot: built the moment
// the player stands in the band (the yumi view-map pattern), or ahead of it,
// driven per frame from the battleground readout. Only a HIDDEN copy is ever
// released: the copy the player was shown stays resident until the renderer
// goes, the way the yumi maze copies do, because its programs are what the
// session's next match links as a cache hit.
//
// The field streams in (buildBattleground: terrain, wards, placements, grass,
// decals, flames arrive from async loads), and a bare add of each part drew
// it on its first frame with its programs unlinked: the 1.3 s frame at the
// /dev bg teleport in the 2026-08-28 combat audit, 11 cold programs. Each
// streamed piece now attaches through the host's compile gate inside
// buildBattleground itself (battleground.ts), and the field's programs do not
// depend on the slot (same kit, another origin), so the queue proposal, thirty
// seconds before the teleport, prebuilds slot 0 hidden: its pieces link through
// that same gate during the answer window, and the copy the player is matched
// into then links as a hit whichever slot it is. The asset preload commits at
// the proposal too, so a reconnect straight into a live match, which never
// clicked the queue, still drains it.

import type * as THREE from 'three';
import { BG_SLOT_COUNT, battlegroundOrigin } from '../sim/data';
import type { BgInfo } from '../world_api/battleground';
import {
  type BattlegroundLightHooks,
  type BattlegroundView,
  battlegroundAssetPrewarm,
  buildBattleground,
} from './battleground';
import type { BgWardState } from './battleground_ward';

export interface BattlegroundViewHost extends BattlegroundLightHooks {
  scene: { add(object: THREE.Object3D): unknown };
  seed: number;
  /** The renderer's async compile gate, passed straight through to
   *  buildBattleground: absent means no KHR_parallel_shader_compile, and every
   *  piece attaches direct and links at its first draw. */
  compileGate?: (target: THREE.Object3D) => Promise<unknown>;
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
    // A copy that is already shown has nothing left to do, and the origin read
    // mints a fresh point per call: settle the shown slot before it, so the
    // frames after the flip no longer allocate for the slot the player is in.
    const known = views.get(slot);
    if (known?.group.visible) continue;
    const origin = battlegroundOrigin(slot);
    if (Math.abs(px - origin.x) >= BG_VIEW_NEAR_X || Math.abs(pz - origin.z) >= BG_VIEW_NEAR_Z) {
      continue;
    }
    const view = known ?? buildSlot(views, slot, host, true);
    view.group.visible = true;
  }
}

/** The bookkeeping the view map needs beside it, owned by the renderer.
 *
 *  `ward` is a reused carrier: setWardState only READS its fields, so the
 *  per-frame push refills this object rather than minting a literal.
 *
 *  `offerSeen` is what makes releasing the prebuilt copy safe. The
 *  `bgProposed` event rides the events frame while the offer itself rides the
 *  next `bg` snapshot key, so a frame that read that gap as "the offer
 *  resolved" would throw away the copy it had just prebuilt (the shape of the
 *  v0.36.0 queue-pop outage; see the arrival-order note in
 *  src/ui/hud/battleground/battleground_proposal_popup.ts). A hidden copy is
 *  therefore only released once the offer was actually SEEN and is gone, or
 *  once the player is standing in a copy of their own. */
export interface BattlegroundViewState {
  ward: BgWardState;
  offerSeen: boolean;
}

export function createBattlegroundViewState(): BattlegroundViewState {
  return { ward: { countdown: false, ghost: false, myTeam: null }, offerSeen: false };
}

/** Release every copy the session has nothing left to show in. The prebuild
 *  buys thirty seconds of linked programs; without this the field terrain, its
 *  paint array texture, the placement instances, the decals and the tier's
 *  share of the point-light budget stayed resident in the open world for the
 *  rest of the session, on a declined or lapsed offer as much as beside the
 *  real copy of a match seated on another slot.
 *
 *  A VISIBLE copy is never released, here or anywhere else:
 *  ensureBattlegroundViewNear only ever shows a copy, it never hides or
 *  disposes one, so the field the player played in stays resident until the
 *  renderer's teardown drains the map (renderer_resource_lifecycle.ts). That
 *  is the deliberate trade: those programs are what the session's next match
 *  links as a hit, and re-showing a copy would have to link them again. */
function releaseSpentViews(
  views: BattlegroundViews,
  state: BattlegroundViewState,
  info: BgInfo | null,
): void {
  if (info?.proposal) {
    state.offerSeen = true;
    return;
  }
  let shown = false;
  let hidden = 0;
  for (const view of views.values()) {
    if (view.group.visible) shown = true;
    else hidden += 1;
  }
  if (hidden === 0) return;
  // Nothing shown yet: the copy is still the answer window's, from the offer
  // being seated (a match, whose slot the player has not reached) or from the
  // offer's own snapshot not having landed at all.
  if (!shown && (info?.match || !state.offerSeen)) return;
  let failure: unknown = null;
  for (const [slot, view] of views) {
    if (view.group.visible) continue;
    // Out of the map BEFORE the dispose runs, and one copy's failure is not
    // another's: a dispose that throws part way through its release steps
    // would otherwise leave its slot standing to be re-disposed every frame,
    // skip the copies after it, and take the frame's ward push with it.
    views.delete(slot);
    try {
      view.dispose();
    } catch (error) {
      failure ??= error;
    }
  }
  state.offerSeen = false;
  if (failure !== null) {
    try {
      console.warn('Battleground copy release failed', failure);
    } catch {
      // Reporting must not turn a best-effort release into a frame failure.
    }
  }
}

/** Per frame while any copy exists: release what the session is done with, then
 *  drive the state-dependent wards of what is left. */
export function updateBattlegroundViews(
  views: BattlegroundViews,
  state: BattlegroundViewState,
  info: BgInfo | null,
  playerId: number,
): void {
  if (views.size === 0) return;
  releaseSpentViews(views, state, info);
  if (views.size === 0) return;
  const match = info?.match ?? null;
  const ward = state.ward;
  ward.countdown = match?.state === 'countdown';
  ward.myTeam = match ? match.myTeam : null;
  // The roster scan only matters while the match is live, so it is skipped as
  // a whole outside that window rather than run and then discarded, and the
  // plain loop over the at-most-ten rows allocates no per-frame closure.
  ward.ghost = false;
  if (match?.state === 'active') {
    for (const row of match.players) {
      if (row.pid !== playerId) continue;
      ward.ghost = row.dead;
      break;
    }
  }
  for (const view of views.values()) view.setWardState(ward);
}
