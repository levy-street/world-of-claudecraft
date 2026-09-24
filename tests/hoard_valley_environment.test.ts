import { describe, expect, it } from 'vitest';
import { bossRoomThemeFor } from '../src/render/hoard_room_themes_core';
import { hoardValleyProfile } from '../src/render/hoard_valley_core';
import { resolveHoardValleyEnvironment } from '../src/render/hoard_valley_environment';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import type { RiftFloorView } from '../src/world_api';

function floorView(seed: number): RiftFloorView {
  return {
    eventId: null,
    seed,
    baseLevel: 20,
    floorIndex: 0,
    floorCount: 1,
    contentId: 'base',
    contentHash: 'base',
    upgrade: null,
    instanceId: 1,
    origin: { x: 0, z: 0 },
    tier: null,
    name: 'Buried Hoard',
    themeName: 'Buried Hoard',
  };
}

describe('hidden valley environment', () => {
  it('uses the encoded dig zone for sky and live-light biome, and the boss room for fog', () => {
    const seed = makeVaultSeed(3, 1234, { open: true, zoneId: 'frostveil' });
    const env = resolveHoardValleyEnvironment(floorView(seed));
    expect(env?.floor.outdoor?.zoneId).toBe('frostveil');
    expect(env?.profile.biome).toBe('frost');
    expect(env?.sky).toEqual({ x: 118, z: 1790 });
    // The fog is the room of whoever lives there, not the zone the map was dug in.
    const theme = bossRoomThemeFor(env?.floor.spawns.find((spawn) => spawn.boss)?.templateId);
    expect(theme).not.toBeNull();
    expect(env?.fog.color).toBe(theme?.palette.fogColor);
    expect(env?.fog.color).not.toBe(hoardValleyProfile('frostveil').fogColor);
    expect(env?.profile.ground).toBe(theme?.palette.ground);
  });

  it('leaves ordinary Rifts and cave hoards on the interior path', () => {
    expect(resolveHoardValleyEnvironment(floorView(424242))).toBeNull();
    expect(resolveHoardValleyEnvironment(floorView(makeVaultSeed(0, 1234)))).toBeNull();
  });
});
