import { describe, expect, it, vi } from 'vitest';
import {
  InstanceMusicController,
  type InstanceMusicEntity,
  type InstanceMusicInput,
  instanceMusicDecision,
} from '../src/game/instance_music';
import { DELVE_X_MIN, ZONES } from '../src/sim/data';
import { SOWFIELD_CENTER } from '../src/sim/vale_cup_layout';

const eastbrookFixture = ZONES.find((zone) => zone.id === 'eastbrook_vale');
if (!eastbrookFixture) throw new Error('eastbrook_vale fixture is missing');
const eastbrook = eastbrookFixture;

function input(overrides: Partial<InstanceMusicInput> = {}): InstanceMusicInput {
  return {
    now: 20000,
    lastCombatEventAt: 0,
    lastBossCombatEventAt: 0,
    playerId: 7,
    playerPos: { x: eastbrook.hub.x, z: eastbrook.hub.z },
    zone: eastbrook,
    inDungeon: false,
    entities: [],
    cupInfo: null,
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
      setSowfieldTrack: vi.fn(),
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
    expect(port.resetForDungeonEntry).toHaveBeenCalledWith('collapsed_reliquary');
    expect(port.update).toHaveBeenLastCalledWith('dungeon_hollow_crypt', false);
  });

  it('selects the Sowfield music zone and follows its public match phase', () => {
    const waiting = instanceMusicDecision(
      input({
        playerPos: SOWFIELD_CENTER,
        cupInfo: null,
      }),
    );
    expect(waiting.atSowfield).toBe(true);
    expect(waiting.zone).toBe('vale_cup');
    expect(waiting.sowfieldTrack).toBe('waiting');

    const active = instanceMusicDecision(
      input({
        playerPos: SOWFIELD_CENTER,
        cupInfo: {
          match: { phase: 'active', origin: { x: 0, z: 0 } },
          spectate: null,
        },
      }),
    );
    expect(active.atSowfield).toBe(true);
    expect(active.zone).toBe('vale_cup');
    expect(active.sowfieldTrack).toBe('match');
  });

  it('routes private-practice phases through the Vale Cup tracks', () => {
    const practice = instanceMusicDecision(
      input({
        playerPos: { x: 30000, z: 0 },
        inDungeon: true,
        cupInfo: {
          match: { phase: 'active', origin: { x: 30000, z: 0 } },
          spectate: null,
        },
      }),
    );
    expect(practice.sowfieldTrack).toBe('match');

    const waiting = instanceMusicDecision(
      input({
        playerPos: { x: 0, z: 0 },
        cupInfo: {
          match: null,
          spectate: { phase: 'briefing', origin: { x: 0, z: 0 } },
        },
      }),
    );
    expect(waiting.sowfieldTrack).toBeNull();
  });
});
