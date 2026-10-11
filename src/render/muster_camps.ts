// The Mirefen muster camps' art: the Three-side adapter over the sim's camp plan
// (src/sim/muster_camp_layout.ts plans it, src/sim/muster_camp_plan.ts seeds it).
//
// Balgath marches between the army pickets ringing the Starfall Crater and smashes them
// (src/sim/content/mirefen_muster.ts is the layout). The camp kit is thirteen
// vertex-coloured GLBs from the image-to-glb pipeline (scripts/assets/muster_camp/,
// pinned by tests/muster_camp_asset.test.ts). They ride the SAME seam every authored
// world prop set uses, the props decor pass (src/render/props.ts), so they inherit its
// deferred preload lane, its material conversion and prewarm group, its static merge
// and cell bands, its reveal gates and its distance cull; this module only says WHAT
// stands WHERE:
//   - `MUSTER_KIT_PROP_DEFS` joins PROP_ASSET_DEFS (one preload per GLB, tier
//     independent, the props-wide rule);
//   - `renderDecorProps` is the decor list the props pass walks: the active world's
//     authored decorProps plus, in the built-in world only, the muster placements for
//     the live preset (clutter is shed on the low preset, structure never is);
//   - `buildMusterRackPickBody` is the weapon rack entity's click volume: the rack's
//     art is drawn here by the camp, so its sim entity needs only something to pick.
// The collision for the same pieces is the sim's (src/sim/muster_camp_colliders.ts, off
// the same plan), so nothing here needs to know about it.

import * as THREE from 'three';
import { BUILTIN_WORLD } from '../sim/data';
import {
  MUSTER_CLUTTER_KEYS,
  type MusterKitKey,
  musterPlacementsForTier,
} from '../sim/muster_camp_layout';
import { musterCampPlan } from '../sim/muster_camp_plan';
import type { WorldContent } from '../sim/types';

/** The kit's props registry rows (url per piece; one material-dedup kit). */
export const MUSTER_KIT_PROP_DEFS: Readonly<Record<MusterKitKey, { url: string; kit: string }>> =
  Object.freeze({
    musterPalisade: { url: '/models/props/muster_palisade.glb', kit: 'muster' },
    musterBarricade: { url: '/models/props/muster_barricade.glb', kit: 'muster' },
    musterGate: { url: '/models/props/muster_gate.glb', kit: 'muster' },
    musterWatchtower: { url: '/models/props/muster_watchtower.glb', kit: 'muster' },
    musterTentLarge: { url: '/models/props/muster_tent_large.glb', kit: 'muster' },
    musterTentSmall: { url: '/models/props/muster_tent_small.glb', kit: 'muster' },
    musterWeaponRack: { url: '/models/props/muster_weapon_rack.glb', kit: 'muster' },
    musterLanternPost: { url: '/models/props/muster_lantern_post.glb', kit: 'muster' },
    musterCrate: { url: '/models/props/muster_crate.glb', kit: 'muster' },
    musterBarrel: { url: '/models/props/muster_barrel.glb', kit: 'muster' },
    musterSacks: { url: '/models/props/muster_sacks.glb', kit: 'muster' },
    musterCartWheel: { url: '/models/props/muster_cart_wheel.glb', kit: 'muster' },
    musterTorch: { url: '/models/props/muster_torch.glb', kit: 'muster' },
  });

/** The kit keys the low preset still draws (every piece that can be structure). The
 *  torch is here because the command camp's gate torches are structure. */
export const MUSTER_LOW_TIER_KIT_KEYS: readonly MusterKitKey[] = (
  Object.keys(MUSTER_KIT_PROP_DEFS) as MusterKitKey[]
).filter((key) => key === 'musterTorch' || !MUSTER_CLUTTER_KEYS.has(key));

/** Where the torch's flame sits above its seated base (the GLB's Socket_Flame; pinned
 *  against scripts/assets/muster_camp/contract.mjs by the asset test). */
export const MUSTER_TORCH_FLAME_HEIGHT = 2.36;

type AuthoredDecorProp = NonNullable<WorldContent['props']['decorProps']>[number];

/** A decor entry as the props pass consumes it: the authored shape plus the muster's
 *  ground fit (a sink below the centre height and a lean under the yaw). */
export type RenderDecorProp = AuthoredDecorProp & {
  sink?: number;
  pitch?: number;
  roll?: number;
};

/** The muster placements the props pass draws for the live preset, as decor entries.
 *  Empty outside the built-in world (an editor document has no muster). */
export function musterCampDecor(
  content: WorldContent,
  seed: number,
  lowTier: boolean,
): RenderDecorProp[] {
  if (content !== BUILTIN_WORLD) return [];
  return musterPlacementsForTier(musterCampPlan(seed), lowTier).map((p) => ({
    key: p.key,
    x: p.x,
    z: p.z,
    rot: p.rot,
    pitch: p.pitch,
    roll: p.roll,
    sink: p.sink,
    ...(p.ghostRadius > 0 ? { r: p.ghostRadius, h: p.ghostHeight } : {}),
  }));
}

/** The decor list the props pass walks: authored decor, then the muster camps. */
export function renderDecorProps(
  content: WorldContent,
  seed: number,
  lowTier: boolean,
): RenderDecorProp[] {
  const authored: RenderDecorProp[] = content.props.decorProps ?? [];
  const muster = musterCampDecor(content, seed, lowTier);
  return muster.length === 0 ? authored : [...authored, ...muster];
}

/** The rack's click volume, in the entity's own frame (the entity stands at
 *  MUSTER_RACK): a box the size of the rack and its pikes. */
export const MUSTER_RACK_PICK = Object.freeze({ width: 3.6, height: 3.1 });

/**
 * The weapon rack entity's body: a pick volume only. Its art is the camp's (the props
 * pass draws the rack GLB at the same spot), so without this the entity fell through
 * renderer.ts's generic ground-object arm and drew a quest-pickup prop with a loot
 * sparkle inside the rack. A cylinder rather than a box, so the pick holds whatever
 * yaw the entity arrives with. Invisible rather than transparent: three's raycaster
 * ignores `visible`, so this costs no draw call and still takes the click (the
 * realm_builder_monument recipe).
 */
export function buildMusterRackPickBody(): { group: THREE.Group; height: number } {
  const group = new THREE.Group();
  group.name = 'MusterWeaponRackPick';
  const radius = MUSTER_RACK_PICK.width / 2;
  const proxy = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, MUSTER_RACK_PICK.height, 12, 1, true),
    new THREE.MeshBasicMaterial(),
  );
  proxy.position.y = MUSTER_RACK_PICK.height / 2;
  proxy.visible = false;
  proxy.castShadow = false;
  proxy.receiveShadow = false;
  group.add(proxy);
  return { group, height: MUSTER_RACK_PICK.height };
}
