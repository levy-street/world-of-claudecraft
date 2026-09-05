import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CRUCIBLE_STREAM_URLS, crucibleFloorForDungeon } from '../src/game/crucible_music';
import {
  InstanceMusicController,
  type InstanceMusicInput,
  instanceMusicDecision,
} from '../src/game/instance_music';
import { DUNGEONS, instanceOrigin, ZONES } from '../src/sim/data';

const rooms = [
  ['ignivar_forge_approach', 1],
  ['ignivar_raid_arena', 2],
  ['ignivar_molten_assembly', 3],
  ['ignivar_inner_crucible', 4],
] as const;
const fixture = ZONES.find((entry) => entry.id === 'eastbrook_vale');
if (!fixture) throw new Error('Missing Eastbrook fixture');
const zone = fixture;

function input(
  room: string | null,
  overrides: Partial<InstanceMusicInput> = {},
): InstanceMusicInput {
  return {
    now: 20000,
    lastCombatEventAt: 0,
    lastBossCombatEventAt: 0,
    playerId: 7,
    playerPos: room ? instanceOrigin(DUNGEONS[room].index, 0) : zone.hub,
    zone,
    inDungeon: room !== null,
    entities: [],
    riftFloor: null,
    ...overrides,
  };
}

describe('Crucible floor soundtrack', () => {
  it.each(rooms)('routes %s in both the first and last private slots', (id, floor) => {
    expect(crucibleFloorForDungeon(id)).toBe(floor);
    for (const slot of [0, 23]) {
      const decision = instanceMusicDecision(
        input(id, {
          playerPos: instanceOrigin(DUNGEONS[id].index, slot),
        }),
      );
      expect(decision.crucibleFloor).toBe(floor);
      expect(decision.instanceId).toBe(id);
    }
  });

  it.each(rooms)('keeps %s music through damage, aggro, and unrelated boss events', (id, floor) => {
    const decision = instanceMusicDecision(
      input(id, {
        lastCombatEventAt: 19999,
        lastBossCombatEventAt: 19999,
        entities: [
          { kind: 'mob', dead: false, templateId: 'forge_guard', aggroTargetId: 7 },
          {
            kind: 'mob',
            dead: false,
            templateId: 'nythraxis_scourge_of_thornpeak',
            aggroTargetId: 99,
          },
        ],
      }),
    );
    expect(decision).toMatchObject({
      crucibleFloor: floor,
      inCombat: true,
      musicCombat: false,
      bossEngaged: false,
    });
  });

  it.each(['live boss elsewhere', 'recent boss event'] as const)(
    'suppresses an unrelated %s independently',
    (trigger) => {
      const decision = instanceMusicDecision(
        input('ignivar_inner_crucible', {
          lastBossCombatEventAt: trigger === 'recent boss event' ? 19999 : 0,
          entities:
            trigger === 'live boss elsewhere'
              ? [
                  {
                    kind: 'mob',
                    dead: false,
                    templateId: 'nythraxis_scourge_of_thornpeak',
                    aggroTargetId: 99,
                  },
                ]
              : [],
        }),
      );
      expect(decision).toMatchObject({ crucibleFloor: 4, bossEngaged: false, musicCombat: false });
    },
  );

  it('keeps the lift on the approach and rejects non-Crucible contexts', () => {
    expect(instanceMusicDecision(input('ignivar_forge_lift')).crucibleFloor).toBe(1);
    expect(
      instanceMusicDecision(input('ignivar_raid_arena', { inDungeon: false })).crucibleFloor,
    ).toBeNull();
    expect(
      instanceMusicDecision(
        input('ignivar_raid_arena', {
          riftFloor: { instanceId: 1, floorIndex: 2, themeName: 'Emberforge' },
        }),
      ).crucibleFloor,
    ).toBeNull();
    expect(crucibleFloorForDungeon('toString')).toBeNull();
    expect(crucibleFloorForDungeon(null)).toBeNull();
  });

  it('leaves ordinary dungeon combat and Nythraxis music intact', () => {
    const ordinary = instanceMusicDecision(input('hollow_crypt', { lastCombatEventAt: 19999 }));
    expect(ordinary).toMatchObject({ crucibleFloor: null, inCombat: true, musicCombat: true });
    const nythraxis = instanceMusicDecision(input('nythraxis_boss_arena'));
    expect(nythraxis).toMatchObject({ crucibleFloor: null, musicCombat: true, bossEngaged: true });
  });

  it('passes distinct floor tracks through entry, combat, backtracking, exit, and reentry', () => {
    const port = { resetForDungeonEntry: vi.fn(), update: vi.fn(), setBossCombat: vi.fn() };
    const controller = new InstanceMusicController(port);
    for (const id of [
      'ignivar_forge_approach',
      'ignivar_raid_arena',
      'ignivar_molten_assembly',
      'ignivar_inner_crucible',
      'ignivar_molten_assembly',
      null,
      'ignivar_molten_assembly',
    ]) {
      controller.update(input(id));
      const resets = port.resetForDungeonEntry.mock.calls.length;
      const decision = controller.update(input(id, { lastCombatEventAt: 19999 }));
      expect(port.resetForDungeonEntry).toHaveBeenCalledTimes(resets);
      if (id) {
        expect(port.update).toHaveBeenLastCalledWith(
          decision.zone,
          false,
          crucibleFloorForDungeon(id),
        );
        expect(port.setBossCombat).toHaveBeenLastCalledWith(false);
      } else {
        expect(decision.crucibleFloor).toBeNull();
        expect(port.update).toHaveBeenLastCalledWith(decision.zone, true);
      }
    }
    expect(port.resetForDungeonEntry).toHaveBeenCalledTimes(6);
  });

  it('ships four distinct final exports with clean filenames and matching cache hashes', () => {
    expect(CRUCIBLE_STREAM_URLS).toEqual({
      1: '/audio/music/a_way_through_the_embers.mp3?v=14a001b98e5b',
      2: '/audio/music/even_iron_must_yield.mp3?v=ebd0f6c6b99d',
      3: '/audio/music/a_fate_still_unwritten.mp3?v=78d0bc42726a',
      4: '/audio/music/the_future_is_not_yours_to_keep.mp3?v=a6e896149cb0',
    });
    const urls = Object.values(CRUCIBLE_STREAM_URLS);
    expect(new Set(urls).size).toBe(4);
    for (const url of urls) {
      expect(url).toMatch(/^\/audio\/music\/[a-z_]+\.mp3\?v=[a-f0-9]{12}$/);
      const [asset, hash] = url.split('?v=');
      const bytes = readFileSync(path.join(__dirname, '..', 'public', asset));
      expect(createHash('sha256').update(bytes).digest('hex').slice(0, 12)).toBe(hash);
    }
  });
});
