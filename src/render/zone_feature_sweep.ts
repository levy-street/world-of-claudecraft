// The per-frame zone-feature sweep: every attached feature cull group is
// shown or hidden against the live cull distance and its own apparent-size
// reach, and its sun-shadow casting is flipped past the shadow range. The
// decisions are the pure core's (zone_feature_visibility_core.ts); this module
// is the thin consumer the renderer drives once per frame over the entries
// attachZoneFeature registered. It needs nothing of the renderer's private
// state beyond that list, which is why it lives beside the renderer and not
// in it.
import type * as THREE from 'three';
import {
  type FeatureFootprint,
  isZoneFeatureInReach,
  isZoneFeatureShadowCasting,
  isZoneFeatureVisible,
  zoneFeatureReach,
} from './zone_feature_visibility_core';

/**
 * The `userData` key a feature module sets on a cull group to opt into the
 * apparent-size reach: the largest world-space extent (yd) of any instance
 * the group holds. Absent or non-positive means no reach: the group is culled
 * by distance only, today's rule.
 */
export const ZONE_FEATURE_EXTENT_KEY = 'zoneFeatureExtentYd';

export interface ZoneFeatureEntry {
  group: THREE.Group;
  /** World XZ footprint measured once at attach (static, matrix-frozen). */
  footprint: FeatureFootprint | null;
  /** Reach (yd) past which the group's largest instance is too small to draw;
   *  Infinity when the group carries no extent. */
  reach: number;
  /** Whether the group was inside its reach on the last sweep (hysteresis). */
  inReach: boolean;
  /** Whether this group currently casts into the sun shadow map. */
  shadowCasting: boolean;
  /** Meshes that carried castShadow at the first far flip, for restore. */
  shadowCasters: THREE.Mesh[] | null;
}

export function zoneFeatureEntryFor(
  group: THREE.Group,
  footprint: FeatureFootprint | null,
): ZoneFeatureEntry {
  const extent = group.userData[ZONE_FEATURE_EXTENT_KEY];
  return {
    group,
    footprint,
    reach: typeof extent === 'number' ? zoneFeatureReach(extent) : Number.POSITIVE_INFINITY,
    inReach: true,
    shadowCasting: true,
    shadowCasters: null,
  };
}

/**
 * One frame of the sweep. Visibility is the fog (or detail-horizon) rule AND
 * the group's own reach; shadow casting stops far before the fogless detail
 * horizon (the merged feature meshes disable frustum culling, so the shadow
 * pass would otherwise redraw whole neighbour towns that cannot land one
 * texel in the shadow volume), with the per-mesh castShadow writes made only
 * on a state flip, never as a steady per-frame traversal.
 */
export function sweepZoneFeatures(
  entries: readonly ZoneFeatureEntry[],
  camX: number,
  camZ: number,
  cullFar: number,
  shadowHalfExtent: number,
): void {
  for (const entry of entries) {
    entry.inReach = isZoneFeatureInReach(entry.footprint, camX, camZ, entry.reach, entry.inReach);
    entry.group.visible =
      entry.inReach && isZoneFeatureVisible(entry.footprint, camX, camZ, cullFar);
    const casting = isZoneFeatureShadowCasting(
      entry.footprint,
      camX,
      camZ,
      entry.shadowCasting,
      shadowHalfExtent,
    );
    if (casting !== entry.shadowCasting) {
      entry.shadowCasting = casting;
      if (!casting && !entry.shadowCasters) {
        const casters: THREE.Mesh[] = [];
        entry.group.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh && mesh.castShadow) casters.push(mesh);
        });
        entry.shadowCasters = casters;
      }
      for (const mesh of entry.shadowCasters ?? []) mesh.castShadow = casting;
    }
  }
}
