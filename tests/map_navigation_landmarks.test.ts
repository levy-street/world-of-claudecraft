import { describe, expect, it } from 'vitest';
import { DELVE_LIST, PORTALS, zoneContaining } from '../src/sim/data';
import { LIVE_MAP_ENTITY_DISCLOSURE_RADIUS } from '../src/ui/map_entity_disclosure_core';
import {
  isNearbyLiveRiftZoneMapEntity,
  STABLE_MAP_NAVIGATION_LANDMARKS,
} from '../src/ui/map_navigation_landmarks_core';

describe('stable map navigation landmarks', () => {
  it('publishes every authored delve door with its exact zone identity', () => {
    const landmarks = STABLE_MAP_NAVIGATION_LANDMARKS.filter(
      (landmark) => landmark.kind === 'delve-entrance',
    );

    expect(landmarks).toHaveLength(DELVE_LIST.length);
    for (const delve of DELVE_LIST) {
      const zone = zoneContaining(delve.doorPos.x, delve.doorPos.z);
      expect(zone, `delve ${delve.id} door must be in a shipped overworld zone`).not.toBeNull();
      expect(landmarks).toContainEqual({
        kind: 'delve-entrance',
        id: delve.id,
        zoneId: zone?.id,
        x: delve.doorPos.x,
        z: delve.doorPos.z,
      });
    }
  });

  it('publishes both ends of every authored passage with the opposite zone as destination', () => {
    const landmarks = STABLE_MAP_NAVIGATION_LANDMARKS.filter(
      (landmark) => landmark.kind === 'world-passage',
    );

    expect(landmarks).toHaveLength(PORTALS.length * 2);
    for (const portal of PORTALS) {
      const aZone = zoneContaining(portal.a.x, portal.a.z);
      const bZone = zoneContaining(portal.b.x, portal.b.z);
      expect(
        aZone,
        `portal ${portal.id} side a must be in a shipped overworld zone`,
      ).not.toBeNull();
      expect(
        bZone,
        `portal ${portal.id} side b must be in a shipped overworld zone`,
      ).not.toBeNull();
      expect(landmarks).toContainEqual({
        kind: 'world-passage',
        id: portal.id,
        side: 'a',
        zoneId: aZone?.id,
        destinationZoneId: bZone?.id,
        x: portal.a.x,
        z: portal.a.z,
      });
      expect(landmarks).toContainEqual({
        kind: 'world-passage',
        id: portal.id,
        side: 'b',
        zoneId: bZone?.id,
        destinationZoneId: aZone?.id,
        x: portal.b.x,
        z: portal.b.z,
      });
    }
    expect(Object.isFrozen(STABLE_MAP_NAVIGATION_LANDMARKS)).toBe(true);
  });
});

describe('live rift zone-map visibility', () => {
  const player = { x: 5, z: 10 };
  const riftAt = (x: number, z: number) => ({
    kind: 'object',
    templateId: 'rift_portal',
    pos: { x, z },
  });

  it('includes live rifts through the inclusive 80-yard host-fair boundary', () => {
    expect(isNearbyLiveRiftZoneMapEntity(riftAt(player.x + 79.99, player.z), player)).toBe(true);
    expect(
      isNearbyLiveRiftZoneMapEntity(
        riftAt(player.x + LIVE_MAP_ENTITY_DISCLOSURE_RADIUS, player.z),
        player,
      ),
    ).toBe(true);
    expect(
      isNearbyLiveRiftZoneMapEntity(
        riftAt(player.x + LIVE_MAP_ENTITY_DISCLOSURE_RADIUS + 0.01, player.z),
        player,
      ),
    ).toBe(false);
  });

  it('uses planar distance at the negative diagonal boundary', () => {
    const negativePlayer = { x: -200, z: -300 };
    const dx = LIVE_MAP_ENTITY_DISCLOSURE_RADIUS * 0.6;
    const dz = LIVE_MAP_ENTITY_DISCLOSURE_RADIUS * 0.8;

    expect(
      isNearbyLiveRiftZoneMapEntity(
        riftAt(negativePlayer.x - dx, negativePlayer.z - dz),
        negativePlayer,
      ),
    ).toBe(true);
    expect(
      isNearbyLiveRiftZoneMapEntity(
        riftAt(negativePlayer.x - dx, negativePlayer.z - dz - 0.01),
        negativePlayer,
      ),
    ).toBe(false);
  });

  it('rejects non-rift entities before reading their position', () => {
    const ordinaryObject = {
      kind: 'object',
      templateId: 'mailbox',
      get pos(): never {
        throw new Error('non-rift positions must not enter the distance path');
      },
    };
    expect(isNearbyLiveRiftZoneMapEntity(ordinaryObject, player)).toBe(false);
    expect(
      isNearbyLiveRiftZoneMapEntity(
        { kind: 'mob', templateId: 'rift_portal', pos: { x: player.x, z: player.z } },
        player,
      ),
    ).toBe(false);
  });
});
