import { describe, expect, it } from 'vitest';
import {
  activePvpOpponentIds,
  HOVER_REPICK_MS,
  HoverPickGate,
  handlePickedEntity,
  hoverCursorKind,
  isAttackableEntity,
  isAttackHoverTarget,
} from '../src/game/interactions';
import type { Entity } from '../src/sim/types';

function stubEntity(partial: Partial<Entity> & Pick<Entity, 'id' | 'kind'>): Entity {
  return {
    templateId: 'test',
    name: 'Test',
    level: 1,
    pos: { x: 0, y: 0, z: 0 },
    prevPos: { x: 0, y: 0, z: 0 },
    facing: 0,
    prevFacing: 0,
    vy: 0,
    onGround: true,
    fallStartY: 0,
    hp: 100,
    maxHp: 100,
    resource: 0,
    maxResource: 0,
    resourceType: null,
    stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0 },
    weapon: { min: 1, max: 2, speed: 2, kind: 'sword' },
    attackPower: 0,
    rangedPower: 0,
    critChance: 0,
    dodgeChance: 0,
    moveSpeed: 7,
    hostile: false,
    targetId: null,
    autoAttack: false,
    swingTimer: 0,
    inCombat: false,
    combatTimer: 0,
    auras: [],
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    channeling: false,
    channelTickTimer: 0,
    channelTickEvery: 0,
    gcdRemaining: 0,
    cooldowns: new Map(),
    queuedOnSwing: null,
    fiveSecondRule: 0,
    comboPoints: 0,
    comboUntil: -1,
    overpowerUntil: 0,
    chargeTargetId: null,
    chargeTimeLeft: 0,
    chargePath: [],
    savedMana: 0,
    sitting: false,
    eating: null,
    drinking: null,
    aiState: 'idle',
    tappedById: null,
    threat: new Map(),
    forcedTargetId: null,
    forcedTargetTimer: 0,
    ownerId: null,
    petMode: 'defensive',
    petTauntTimer: 0,
    pulseTimer: 0,
    firedSummons: 0,
    summonedIds: [],
    enraged: false,
    dead: false,
    lootable: false,
    respawnAt: 0,
    ...partial,
  } as Entity;
}

describe('hoverCursorKind', () => {
  it('returns attack for living hostile mobs', () => {
    const mob = stubEntity({ id: 2, kind: 'mob', hostile: true, dead: false });
    expect(hoverCursorKind(mob, 1, new Set())).toBe('attack');
    expect(isAttackHoverTarget(mob)).toBe(true);
  });

  it('returns friendly for npcs', () => {
    const npc = stubEntity({ id: 3, kind: 'npc' });
    expect(hoverCursorKind(npc, 1, new Set())).toBe('friendly');
  });

  it('returns friendly for other players', () => {
    const ally = stubEntity({ id: 4, kind: 'player' });
    const stranger = stubEntity({ id: 5, kind: 'player' });
    const party = new Set([4]);
    expect(hoverCursorKind(ally, 1, party)).toBe('friendly');
    expect(hoverCursorKind(stranger, 1, party)).toBe('friendly');
    expect(hoverCursorKind(ally, 4, party)).toBe('default');
  });

  it('returns attack for active pvp opponents', () => {
    const opponent = stubEntity({ id: 5, kind: 'player' });
    expect(hoverCursorKind(opponent, 1, new Set(), new Set([5]))).toBe('attack');
    expect(isAttackableEntity(opponent, 1, new Set([5]))).toBe(true);
  });

  it('keeps dead pvp opponents non-attackable for hover', () => {
    const opponent = stubEntity({ id: 5, kind: 'player', dead: true });
    expect(hoverCursorKind(opponent, 1, new Set(), new Set([5]))).toBe('friendly');
  });

  it('returns default for empty pick', () => {
    expect(hoverCursorKind(undefined, 1, new Set())).toBe('default');
  });
});

describe('activePvpOpponentIds', () => {
  it('includes active duel and every arena enemy', () => {
    const player = stubEntity({ id: 1, kind: 'player' });
    const ids = activePvpOpponentIds({
      playerId: 1,
      player,
      duelInfo: { otherPid: 2, otherName: 'Duelist', state: 'active' },
      arenaInfo: {
        queued: false,
        queueSize: 0,
        rating: 1500,
        wins: 0,
        losses: 0,
        format: '1v1',
        standings: {
          '1v1': { rating: 1500, wins: 0, losses: 0 },
          '2v2': { rating: 1500, wins: 0, losses: 0 },
          fiesta: { rating: 1500, wins: 0, losses: 0 },
        },
        ladder: [],
        ladders: { '1v1': [], '2v2': [], fiesta: [] },
        match: {
          oppPid: 3,
          oppName: 'Arena Rival',
          oppClass: 'warrior',
          oppLevel: 1,
          state: 'active',
          format: '1v1',
          allies: [],
          enemies: [
            { pid: 3, name: 'Arena Rival', cls: 'warrior', level: 1 },
            { pid: 4, name: 'Arena Partner', cls: 'mage', level: 1 },
          ],
        },
      },
    });

    expect([...ids].sort()).toEqual([2, 3, 4]);
  });

  it('ignores inactive pvp states', () => {
    const player = stubEntity({ id: 1, kind: 'player' });
    const ids = activePvpOpponentIds({
      playerId: 1,
      player,
      duelInfo: { otherPid: 2, otherName: 'Duelist', state: 'countdown' },
      arenaInfo: {
        queued: false,
        queueSize: 0,
        rating: 1500,
        wins: 0,
        losses: 0,
        format: '1v1',
        standings: {
          '1v1': { rating: 1500, wins: 0, losses: 0 },
          '2v2': { rating: 1500, wins: 0, losses: 0 },
          fiesta: { rating: 1500, wins: 0, losses: 0 },
        },
        ladder: [],
        ladders: { '1v1': [], '2v2': [], fiesta: [] },
        match: {
          oppPid: 3,
          oppName: 'Arena Rival',
          oppClass: 'warrior',
          oppLevel: 1,
          state: 'countdown',
          format: '1v1',
          allies: [],
          enemies: [],
        },
      },
    });

    expect(ids.size).toBe(0);
  });
});

describe('handlePickedEntity', () => {
  it('targets and starts auto-attack on a hostile mob on right-click', () => {
    // Right-clicking an enemy targets AND begins auto-attack, the classic-MMO
    // convention the attack ability tooltip documents ("Right-clicking an enemy
    // also attacks."). Camera right-drag never reaches here: clickPickFromMouseGesture
    // rejects a right-button gesture that moved past the drag threshold, so this
    // fires only on a deliberate right-click, never on a camera rotation.
    const player = stubEntity({ id: 1, kind: 'player' });
    const mob = stubEntity({ id: 2, kind: 'mob', hostile: true, pos: { x: 3, y: 0, z: 0 } });
    let targetId: number | null = null;
    let attacks = 0;
    const world: any = {
      playerId: 1,
      player,
      entities: new Map([
        [1, player],
        [2, mob],
      ]),
      duelInfo: null,
      arenaInfo: null,
      targetEntity: (id: number | null) => {
        targetId = id;
      },
      enterDungeon: () => {},
      leaveDungeon: () => {},
      pickUpObject: () => {},
      startAutoAttack: () => {
        attacks++;
      },
    };
    const hud = {
      openLoot: () => {},
      openQuestDialog: () => {},
      openDelveBoard: () => {},
      openMailbox: () => {},
      showError: () => {},
      closeContextMenu: () => {},
    };

    handlePickedEntity(world, hud, 2, 2, 10, 20);

    expect(targetId).toBe(2);
    expect(attacks).toBe(1);
  });

  it('starts auto-attack when right-clicking an active duel opponent', () => {
    const player = stubEntity({ id: 1, kind: 'player' });
    const opponent = stubEntity({ id: 2, kind: 'player', pos: { x: 3, y: 0, z: 0 } });
    let targetId: number | null = null;
    let attacks = 0;
    const world: any = {
      playerId: 1,
      player,
      entities: new Map([
        [1, player],
        [2, opponent],
      ]),
      duelInfo: { otherPid: 2, otherName: 'Bet', state: 'active' },
      arenaInfo: null,
      targetEntity: (id: number | null) => {
        targetId = id;
      },
      enterDungeon: () => {},
      leaveDungeon: () => {},
      pickUpObject: () => {},
      startAutoAttack: () => {
        attacks++;
      },
    };
    const hud = {
      openLoot: () => {},
      openQuestDialog: () => {},
      openDelveBoard: () => {},
      openMailbox: () => {},
      showError: () => {},
      closeContextMenu: () => {},
    };

    handlePickedEntity(world, hud, 2, 2, 10, 20);

    expect(targetId).toBe(2);
    expect(attacks).toBe(1);
  });
});

describe('handlePickedEntity while dead (the ghost/death loop)', () => {
  // Shared rig: a player stub, a nearby entity, and call-recording world + hud.
  function rig(playerPartial: Partial<Entity>, target: Entity) {
    const player = stubEntity({ id: 1, kind: 'player', ...playerPartial });
    const calls: string[] = [];
    const world: any = {
      playerId: 1,
      player,
      entities: new Map([
        [1, player],
        [target.id, target],
      ]),
      duelInfo: null,
      arenaInfo: null,
      targetEntity: () => {},
      enterDungeon: () => calls.push('enterDungeon'),
      leaveDungeon: () => {},
      pickUpObject: () => calls.push('pickUpObject'),
      startAutoAttack: () => {},
      resurrectAtSpiritHealer: () => calls.push('resurrectAtSpiritHealer'),
    };
    const hud = {
      openLoot: () => calls.push('openLoot'),
      openQuestDialog: () => calls.push('openQuestDialog'),
      openDelveBoard: () => calls.push('openDelveBoard'),
      openMailbox: () => calls.push('openMailbox'),
      showError: () => calls.push('showError'),
      closeContextMenu: () => {},
    };
    return { world, hud, calls };
  }

  const questNpc = () =>
    stubEntity({ id: 2, kind: 'npc', templateId: 'elder_maren', pos: { x: 3, y: 0, z: 0 } });

  it('a ghost right-clicking a quest NPC does not open the quest dialog', () => {
    const { world, hud, calls } = rig({ dead: true, ghost: true }, questNpc());
    handlePickedEntity(world, hud, 2, 2, 10, 20);
    expect(calls).not.toContain('openQuestDialog');
    expect(calls).not.toContain('openDelveBoard');
    expect(calls).toContain('showError');
  });

  it('a ghost left-clicking a quest NPC does not open the quest dialog', () => {
    const { world, hud, calls } = rig({ dead: true, ghost: true }, questNpc());
    handlePickedEntity(world, hud, 2, 0, 10, 20);
    expect(calls).not.toContain('openQuestDialog');
    expect(calls).not.toContain('openDelveBoard');
  });

  it('a dead-unreleased player clicking a quest NPC does not open the quest dialog', () => {
    const { world, hud, calls } = rig({ dead: true, ghost: false }, questNpc());
    handlePickedEntity(world, hud, 2, 2, 10, 20);
    expect(calls).not.toContain('openQuestDialog');
  });

  it('a ghost right-clicking the Spirit Healer still takes the healer res', () => {
    const healer = stubEntity({
      id: 2,
      kind: 'npc',
      templateId: 'spirit_healer',
      pos: { x: 3, y: 0, z: 0 },
    });
    const { world, hud, calls } = rig({ dead: true, ghost: true }, healer);
    handlePickedEntity(world, hud, 2, 2, 10, 20);
    expect(calls).toContain('resurrectAtSpiritHealer');
    expect(calls).not.toContain('openQuestDialog');
  });

  it('a ghost clicking a mailbox does not open it', () => {
    const mailbox = stubEntity({
      id: 2,
      kind: 'object',
      templateId: 'mailbox',
      lootable: true,
      pos: { x: 3, y: 0, z: 0 },
    });
    const { world, hud, calls } = rig({ dead: true, ghost: true }, mailbox);
    handlePickedEntity(world, hud, 2, 2, 10, 20);
    expect(calls).not.toContain('openMailbox');
    handlePickedEntity(world, hud, 2, 0, 10, 20);
    expect(calls).not.toContain('openMailbox');
  });

  it('an alive player clicking a quest NPC still opens the quest dialog', () => {
    const { world, hud, calls } = rig({}, questNpc());
    handlePickedEntity(world, hud, 2, 2, 10, 20);
    expect(calls).toContain('openQuestDialog');
  });
});

describe('HoverPickGate', () => {
  it('picks on first call and then throttles a stationary pointer', () => {
    const gate = new HoverPickGate();
    expect(gate.shouldPick(10, 20, 1000)).toBe(true);
    expect(gate.shouldPick(10, 20, 1001)).toBe(false);
    expect(gate.shouldPick(10, 20, 1000 + HOVER_REPICK_MS - 1)).toBe(false);
    expect(gate.shouldPick(10, 20, 1000 + HOVER_REPICK_MS)).toBe(true);
  });

  it('re-picks immediately when the pointer moves', () => {
    const gate = new HoverPickGate();
    expect(gate.shouldPick(10, 20, 1000)).toBe(true);
    expect(gate.shouldPick(11, 20, 1001)).toBe(true); // x moved
    expect(gate.shouldPick(11, 21, 1002)).toBe(true); // y moved
    expect(gate.shouldPick(11, 21, 1003)).toBe(false); // stationary again
  });

  it('a movement re-pick restarts the stationary window', () => {
    const gate = new HoverPickGate();
    gate.shouldPick(0, 0, 1000);
    gate.shouldPick(5, 5, 1030); // move at t=1030 re-picks
    expect(gate.shouldPick(5, 5, 1030 + HOVER_REPICK_MS - 1)).toBe(false);
    expect(gate.shouldPick(5, 5, 1030 + HOVER_REPICK_MS)).toBe(true);
  });
});
