import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  InstanceMusicController,
  type InstanceMusicEntity,
  type InstanceMusicInput,
  instanceMusicDecision,
  resolveMapMusicZone,
} from '../src/game/instance_music';
import { ZONE_STREAM_URLS } from '../src/game/music_tracks';
import { DELVE_X_MIN, DUNGEONS, instanceOrigin, ZONES } from '../src/sim/data';

const eastbrookFixture = ZONES.find((zone) => zone.id === 'eastbrook_vale');
if (!eastbrookFixture) throw new Error('eastbrook_vale fixture is missing');
const eastbrook = eastbrookFixture;

function input(overrides: Partial<InstanceMusicInput> = {}): InstanceMusicInput {
  return {
    now: 20000,
    lastCombatEventAt: 0,
    lastBossCombatEventAt: 0,
    inCombat: false,
    playerId: 7,
    playerPos: { x: eastbrook.hub.x, z: eastbrook.hub.z },
    zone: eastbrook,
    inDungeon: false,
    entities: [],
    riftFloor: null,
    ...overrides,
  };
}

describe('instance music policy', () => {
  it('derives combat from the local aggro target without treating unrelated mobs as combat', () => {
    const unrelated: InstanceMusicEntity = {
      kind: 'mob',
      dead: false,
      templateId: 'wolf',
      aggroTargetId: 99,
    };
    const localAggro = { ...unrelated, aggroTargetId: 7 };

    expect(instanceMusicDecision(input({ entities: [unrelated] })).inCombat).toBe(false);
    expect(instanceMusicDecision(input({ entities: [localAggro] })).inCombat).toBe(true);
  });

  it('selects and resets a delve profile by its domain id', () => {
    const port = {
      resetForDungeonEntry: vi.fn(),
      update: vi.fn(),
      setBossCombat: vi.fn(),
    };
    const controller = new InstanceMusicController(port);
    const delveInput = input({
      playerPos: { x: DELVE_X_MIN, z: 0 },
      inDungeon: true,
    });

    const first = controller.update(delveInput);
    controller.update(delveInput);

    expect(first.instanceId).toBe('collapsed_reliquary');
    expect(first.zone).toBe('dungeon_hollow_crypt');
    expect(port.resetForDungeonEntry).toHaveBeenCalledTimes(1);
    expect(port.resetForDungeonEntry).toHaveBeenCalledWith(
      'collapsed_reliquary',
      'dungeon_hollow_crypt',
    );
    expect(port.update).toHaveBeenLastCalledWith('dungeon_hollow_crypt', false);
  });
});

describe('the Proving Shore cue, resolved from the shipped zone record', () => {
  // The routing tests in music.test.ts feed musicZoneForLocation a hand-typed
  // zone id and biome. This one goes through the real content record and the
  // resolver the client actually calls, so a change to the island's biome,
  // its hub, or its id cannot silently drop it back onto the mainland loop.
  const islandFixture = ZONES.find((zone) => zone.id === 'proving_shore');
  if (!islandFixture) throw new Error('proving_shore fixture is missing');
  const island = islandFixture;

  const at = (x: number, z: number) =>
    instanceMusicDecision(input({ zone: island, playerPos: { x, z } })).zone;

  it('plays the island cue at Dawnrest Camp and out on the strand alike', () => {
    expect(at(island.hub.x, island.hub.z)).toBe('proving_shore');
    // The Wreck Line, the far west end of the island, well outside the hub.
    expect(at(-380, -42)).toBe('proving_shore');
  });

  it('is a different cue from the mainland vale it paints as', () => {
    // Without its own row the island would inherit its biome's cue, which is
    // the whole reason this exists: the first music a new player hears would
    // be the mainland's.
    expect(island.biome).toBe('vale');
    expect(at(island.hub.x, island.hub.z)).not.toBe('vale');
    expect(ZONE_STREAM_URLS.proving_shore).not.toBe(ZONE_STREAM_URLS.vale);
  });

  it('streams a committed file, so the island is never silent', () => {
    const url = ZONE_STREAM_URLS.proving_shore;
    expect(url).toBeTruthy();
    expect(existsSync(path.join(__dirname, '..', 'public', ...url!.split('?')[0].split('/')))).toBe(
      true,
    );
  });

  it('selects the authored ambient cue for each Ignivar raid room', () => {
    const rooms = [
      { id: 'ignivar_forge_approach', zone: 'ignivar_forge_approach' },
      { id: 'ignivar_raid_arena', zone: 'ignivar_raid_arena' },
      { id: 'ignivar_molten_assembly', zone: 'ignivar_forge_approach' },
      { id: 'ignivar_inner_crucible', zone: 'ignivar_inner_crucible' },
    ] as const;

    for (const room of rooms) {
      const origin = instanceOrigin(DUNGEONS[room.id].index, 0);
      const decision = instanceMusicDecision(
        input({
          playerPos: origin,
          inDungeon: true,
        }),
      );
      expect(decision.instanceId, room.id).toBe(room.id);
      expect(decision.zone, room.id).toBe(room.zone);
      expect(decision.musicCombat, room.id).toBe(false);
    }
  });

  it('keeps the final room soundtrack active instead of the global combat layer', () => {
    const room = 'ignivar_inner_crucible';
    const origin = instanceOrigin(DUNGEONS[room].index, 0);
    const decision = instanceMusicDecision(
      input({
        playerPos: origin,
        inDungeon: true,
        entities: [
          {
            kind: 'mob',
            dead: false,
            templateId: 'varkhul_forgefather',
            aggroTargetId: 7,
          },
        ],
      }),
    );

    expect(decision.zone).toBe(room);
    expect(decision.inCombat).toBe(true);
    expect(decision.musicCombat).toBe(false);
    expect(decision.crucibleFloor).toBe(4);
  });
});

describe('instance music policy: the authoritative in-combat flag', () => {
  it('the world flag alone puts the player in combat, with no aggro target and no recent event', () => {
    const decision = instanceMusicDecision(input({ inCombat: true }));
    expect(decision.inCombat).toBe(true);
    expect(decision.musicCombat).toBe(true);
  });

  it('a false world flag never suppresses the aggro or recent-event arms', () => {
    const aggro = instanceMusicDecision(
      input({
        inCombat: false,
        entities: [{ kind: 'mob', dead: false, templateId: 'wolf', aggroTargetId: 7 }],
      }),
    );
    expect(aggro.inCombat).toBe(true);
    const recent = instanceMusicDecision(input({ inCombat: false, lastCombatEventAt: 19000 }));
    expect(recent.inCombat).toBe(true);
    const calm = instanceMusicDecision(input({ inCombat: false }));
    expect(calm.inCombat).toBe(false);
  });
});

describe('an authored map’s own soundtrack', () => {
  // WorldContent.music is what the Studio's "Map track" writes; before this
  // the game ignored it and an authored world resolved its score through the
  // OVERWORLD's zone table at its own coordinates, so the cue churned as the
  // player walked.
  it('outranks the location walk when the map names a known track', () => {
    const d = instanceMusicDecision(input({ mapMusic: { zoneTrack: 'amber' } }));
    expect(d.zone).toBe('amber');
    // No map music, or an unknown id: the location decides as before.
    expect(instanceMusicDecision(input({ mapMusic: null })).zone).toBe('town_eastbrook');
    expect(instanceMusicDecision(input({ mapMusic: { zoneTrack: 'not_a_track' } })).zone).toBe(
      'town_eastbrook',
    );
  });

  it('lets the smallest containing area win over the map-wide track', () => {
    const pos = { x: eastbrook.hub.x, z: eastbrook.hub.z };
    const big = { minX: pos.x - 100, maxX: pos.x + 100, minZ: pos.z - 100, maxZ: pos.z + 100 };
    const small = { minX: pos.x - 5, maxX: pos.x + 5, minZ: pos.z - 5, maxZ: pos.z + 5 };
    const music = {
      zoneTrack: 'amber',
      areas: [
        { ...big, track: 'frost' },
        { ...small, track: 'gale' },
        // Off to the side: must not count.
        { minX: pos.x + 50, maxX: pos.x + 60, minZ: pos.z, maxZ: pos.z + 10, track: 'jungle' },
      ],
    };
    expect(resolveMapMusicZone(music, pos.x, pos.z)).toBe('gale');
    expect(resolveMapMusicZone(music, pos.x + 30, pos.z)).toBe('frost');
    expect(resolveMapMusicZone(music, pos.x + 500, pos.z)).toBe('amber');
    // An area naming an unknown track is skipped, not honoured.
    expect(resolveMapMusicZone({ areas: [{ ...small, track: 'bogus' }] }, pos.x, pos.z)).toBe(null);
  });

  it('is still outranked by a rift floor, whose theme is the world’s call', () => {
    const d = instanceMusicDecision(
      input({
        mapMusic: { zoneTrack: 'amber' },
        riftFloor: { instanceId: 1, floorIndex: 0, themeName: 'Frostbound' },
      }),
    );
    expect(d.zone).toBe('rift_frost');
  });
});
