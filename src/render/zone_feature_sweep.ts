// The per-frame zone-feature sweep: every attached feature cull group is
// shown or hidden against the live cull distance and its own apparent-size
// reach, and its sun-shadow casting is flipped past the shadow range. The
// decisions are the pure core's (zone_feature_visibility_core.ts); this module
// is the thin consumer the renderer drives once per frame over the entries
// attachZoneFeature registered. It needs nothing of the renderer's private
// state beyond that list, which is why it lives beside the renderer and not
// in it.
import type * as THREE from 'three';
import { GFX } from './gfx';
import { updateSceneryGeometryLod } from './scenery_geometry_lod';
import {
  type FeatureFootprint,
  hasUnseededInstanceMatrix,
  isZoneFeatureInReach,
  isZoneFeatureInRect,
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
  /** Whether the group was inside its reach on the last sweep (hysteresis);
   *  false at attach, so the first sweep decides on the reach itself. */
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
    // hidden until the first sweep finds it inside its reach: a group that
    // attaches inside the hysteresis band then behaves as one approached from
    // outside, and a group without a reach is in reach by definition
    inReach: false,
    shadowCasting: true,
    shadowCasters: null,
  };
}

/**
 * The sweep entries of one attached feature view: each of its cull groups, or
 * the view's own group. A view spanning several regions registers each child
 * instead of the whole group, because one world-wide footprint can never be
 * culled (water-flora was 10.96M triangles submitted from every realm).
 * Footprints are measured ONCE here, at attach, so an InstancedMesh whose
 * matrices are still factory zeros poisons the measurement silently (the
 * seabird flock parked a footprint at the world origin this way): it is
 * reported, and the entry is registered as measured.
 */
export function zoneFeatureEntriesFor(
  groups: readonly THREE.Group[],
  measure: (group: THREE.Group) => FeatureFootprint | null,
): ZoneFeatureEntry[] {
  return groups.map((group) => {
    group.traverse((obj) => {
      const inst = obj as THREE.InstancedMesh;
      if (!inst.isInstancedMesh) return;
      if (hasUnseededInstanceMatrix(inst.instanceMatrix.array, inst.count)) {
        console.error(
          `attachZoneFeature: "${group.name}" holds an InstancedMesh with unseeded ` +
            'instance matrices; seed placements before attach or its cull footprint is wrong',
        );
      }
    });
    return zoneFeatureEntryFor(group, measure(group));
  });
}

/**
 * One frame of the sweep. Visibility is the fog (or detail-horizon) rule AND
 * the group's own reach; shadow casting stops far before the fogless detail
 * horizon (the merged feature meshes disable frustum culling, so the shadow
 * pass would otherwise redraw whole neighbour towns that cannot land one
 * texel in the shadow volume), with the per-mesh castShadow writes made only
 * on a state flip, never as a steady per-frame traversal.
 *
 * `isolate` is the editor's zone-isolate rect: it narrows visibility from
 * "near enough to see" to "belongs to the isolated zone" (streetlamps,
 * braziers and water flora register one cull child PER ZONE, so the rect test
 * lands at the right granularity). It gates drawing only; the shadow cull is
 * an independent gate.
 */
export function sweepZoneFeatures(
  entries: readonly ZoneFeatureEntry[],
  camX: number,
  camZ: number,
  cullFar: number | ((group: THREE.Group) => number),
  shadowHalfExtent: number,
  isolate: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null,
): void {
  for (const entry of entries) {
    updateSceneryGeometryLod(entry.group, camX, camZ, GFX.sceneryGeometryLodDistance);
    entry.inReach = isZoneFeatureInReach(entry.footprint, camX, camZ, entry.reach, entry.inReach);
    entry.group.visible =
      entry.inReach &&
      isZoneFeatureVisible(
        entry.footprint,
        camX,
        camZ,
        typeof cullFar === 'number' ? cullFar : cullFar(entry.group),
      ) &&
      (!isolate || isZoneFeatureInRect(entry.footprint, isolate));
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
