// Pure policy for constrained-memory zone eviction: WHICH resident overworld
// zones to release as the player travels away from them.
//
// Zone residency (`preparedZones` in renderer.ts) only ever grows during
// ordinary play: once a zone's terrain, water and features stream in they stay
// GPU-resident for the rest of the session, and the only place that ever
// clears residency is an editor-only full scene rebuild. That is fine on
// desktop/Android, where retaining every explored zone is an intentional
// trade for never re-paying a build. iOS WebKit (Safari and the packaged app
// alike; see gfx.ts's iosMemoryProfile) instead KILLS the whole WebContent
// process outright once its per-process memory ceiling is crossed, so a
// session that walks through several zones over a few minutes accumulates
// terrain and water geometry it can never afford to keep whole. This is the
// "stage 4: retire preparedZones as the residency source of truth" gap
// docs/design/chunk-streaming.md documents as unstarted; full chunk-level
// residency is a much larger rewrite, so this module instead bounds memory
// the same way gfx.ts already bounds other iOS allocations (see
// Renderer.ensureEnvironmentBiome's GFX.constrainedMemory PMREM cap): shed
// the biggest retained cost for zones the player is nowhere near, and let the
// existing streaming machinery rebuild them exactly as it would for a zone
// never visited (residency flips back to "pending", which is what the
// chunk-level fog clamp already expects).
//
// On iOS specifically the water half of this rarely fires: GFX.iosMemoryProfile
// forces GFX.standardMaterials off (gfx.ts), so buildWater always returns the
// single-plane Phong tier there, whose unloadZone is an intentional no-op
// (nothing per-zone to release). Terrain still runs on every constrained
// profile, iOS included, and is the one axis this module reliably bounds
// there; a non-iOS constrained browser that still qualifies for the shader
// water tier gets both.
//
// Renderer.evictFarZoneIfConstrained (renderer.ts) is the thin consumer: it
// calls zonesEligibleForEviction on the same throttled cadence as the
// visible-zone streaming recompute, evicting one zone per call so a long
// session sheds memory gradually. It measures distance from the PLAYER, not
// the camera: the camera boom (camera_boom_core.ts) snaps to and tightly
// leashes the player, so its only real offset from the player is the zoom
// arm, and anchoring on the player keeps that zoom/free-look state out of a
// memory-residency decision. It deliberately never clears
// prewarmedZonePrograms: that tracks compiled shader programs, which
// unloadZone (geometry only) never touches, so clearing it would force a
// wasted recompile on re-entry for no benefit.

import type { ZoneDef } from '../sim/types';
import { distanceSqToZone, MAX_OUTDOOR_FOG_FAR } from './zone_streaming';

/**
 * How far beyond a zone's rectangle the player must be before that zone
 * becomes eligible for eviction.
 *
 * Terrain chunk ownership (terrain.ts's cellOwnerId) is nearest-rectangle,
 * not exact-rectangle: the 14 zone rectangles do not tile the world, so a
 * zone also owns every unclaimed "gap" cell nearest to it, which can sit well
 * outside its own rectangle (measured against the live ZONES table: up to
 * 360 yd for eastbrook_vale, see tests/zone_eviction_core.test.ts). unloadZone
 * releases every cell a zone owns, but this radius is measured to the
 * rectangle alone, so the nearest chunk an eviction can actually remove may
 * be up to that overshoot CLOSER than the radius suggests. The margin over
 * MAX_OUTDOOR_FOG_FAR (850, the widest radius that can re-trigger a
 * background prepare for the same zone) must clear that overshoot, or a
 * player standing near a border could see an evicted zone's ground before it
 * rebuilds, or thrash it: evict, immediately re-stream, evict again.
 * 850 + 600 clears the measured 360 yd worst case with room to spare;
 * tests/zone_eviction_core.test.ts pins the real margin against live zone
 * geometry so a future zone reshuffle cannot silently erode it.
 */
export const ZONE_EVICTION_RADIUS = MAX_OUTDOOR_FOG_FAR + 600;

/**
 * Prepared zones the player has left far enough behind to release, farthest
 * first (so a caller that evicts one at a time always sheds the least useful
 * zone). Never returns the zone the player currently occupies: `zoneIdAt`
 * (renderer.ts) falls back to the nearest zone by z-band for a position no
 * zone rectangle strictly contains (the same gap-fill idea ZONE_EVICTION_RADIUS
 * accounts for above, just for whole-zone lookup instead of terrain cells),
 * so a player standing in one of those gaps is not guaranteed a zero
 * rectangle distance to their own "current" zone; without this guard that
 * could rank their own zone as evictable and tear down the ground under
 * their feet.
 */
export function zonesEligibleForEviction(
  zones: readonly ZoneDef[],
  preparedZoneIds: ReadonlySet<string>,
  currentZoneId: string | null,
  playerX: number,
  playerZ: number,
  retentionRadius = ZONE_EVICTION_RADIUS,
): string[] {
  const retentionSq = retentionRadius * retentionRadius;
  const candidates: { id: string; distanceSq: number }[] = [];
  for (const zone of zones) {
    if (zone.id === currentZoneId) continue;
    if (!preparedZoneIds.has(zone.id)) continue;
    const distanceSq = distanceSqToZone(zone, playerX, playerZ);
    if (distanceSq > retentionSq) candidates.push({ id: zone.id, distanceSq });
  }
  candidates.sort((a, b) => b.distanceSq - a.distanceSq);
  return candidates.map((candidate) => candidate.id);
}
