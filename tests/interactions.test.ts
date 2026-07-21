import { describe, expect, it, vi } from 'vitest';
import {
  activePvpOpponentIds,
  HOVER_REPICK_MS,
  HoverPickGate,
  handlePickedEntity,
  hoverCursorKind,
  isAttackableEntity,
  isAttackHoverTarget,
  shouldApproachPickedEntity,
} from '../src/game/interactions';
import { type Entity, INTERACT_RANGE } from '../src/sim/types';

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

  it('treats a non-hostile mob in the opponent set as attackable (enemy Yumi cat)', () => {
    // The cats carry hostile=false (team hostility lives in the sim rule);
    // the enemy cat's id rides the opponent set instead.
    const enemyCat = stubEntity({ id: 900, kind: 'mob', hostile: false });
    const ownCat = stubEntity({ id: 901, kind: 'mob', hostile: false });
    expect(isAttackableEntity(enemyCat, 1, new Set([900]))).toBe(true);
    expect(hoverCursorKind(enemyCat, 1, new Set(), new Set([900]))).toBe('attack');
    expect(isAttackableEntity(ownCat, 1, new Set([900]))).toBe(false);
    expect(hoverCursorKind(ownCat, 1, new Set(), new Set([900]))).toBe('default');
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
          yumi3: { rating: 1500, wins: 0, losses: 0 },
          yumi5: { rating: 1500, wins: 0, losses: 0 },
        },
        ladder: [],
        ladders: { '1v1': [], '2v2': [], fiesta: [], yumi3: [], yumi5: [] },
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

  it('includes the ENEMY Yumi cat entity id, never the own cat', () => {
    const player = stubEntity({ id: 1, kind: 'player' });
    const yumiView = (entityId: number) => ({
      entityId,
      hp: 5000,
      maxHp: 5000,
      x: 8400,
      z: -1250,
      alive: true,
    });
    const base = {
      queued: false,
      queueSize: 0,
      rating: 1500,
      wins: 0,
      losses: 0,
      format: 'yumi3' as const,
      standings: {
        '1v1': { rating: 1500, wins: 0, losses: 0 },
        '2v2': { rating: 1500, wins: 0, losses: 0 },
        fiesta: { rating: 1500, wins: 0, losses: 0 },
        yumi3: { rating: 1500, wins: 0, losses: 0 },
        yumi5: { rating: 1500, wins: 0, losses: 0 },
      },
      ladder: [],
      ladders: { '1v1': [], '2v2': [], fiesta: [], yumi3: [], yumi5: [] },
    };
    const matchBase = {
      oppPid: 3,
      oppName: 'Rivals',
      oppClass: 'warrior' as const,
      oppLevel: 1,
      state: 'active' as const,
      format: 'yumi3' as const,
      allies: [],
      enemies: [{ pid: 3, name: 'Rival', cls: 'warrior' as const, level: 1 }],
    };
    const yumi = (team: 'A' | 'B') => ({
      team,
      size: 3 as const,
      phase: 'active' as const,
      matchElapsed: 10,
      teleportIn: 50,
      suddenDeathIn: 590,
      damageTakenMult: 1,
      down: false,
      respawnIn: 0,
      yumiA: yumiView(900),
      yumiB: yumiView(901),
      teamA: [],
      teamB: [],
    });
    const idsA = activePvpOpponentIds({
      playerId: 1,
      player,
      arenaInfo: { ...base, match: { ...matchBase, yumi: yumi('A') } },
    });
    expect(idsA.has(901)).toBe(true); // team A attacks cat B
    expect(idsA.has(900)).toBe(false);
    const idsB = activePvpOpponentIds({
      playerId: 1,
      player,
      arenaInfo: { ...base, match: { ...matchBase, yumi: yumi('B') } },
    });
    expect(idsB.has(900)).toBe(true); // team B attacks cat A
    expect(idsB.has(901)).toBe(false);
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
          yumi3: { rating: 1500, wins: 0, losses: 0 },
          yumi5: { rating: 1500, wins: 0, losses: 0 },
        },
        ladder: [],
        ladders: { '1v1': [], '2v2': [], fiesta: [], yumi3: [], yumi5: [] },
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
  it('reports a nearby NPC dialogue as an interaction but plain targeting as no interaction', () => {
    const player = stubEntity({ id: 1, kind: 'player' });
    const npc = stubEntity({ id: 2, kind: 'npc', pos: { x: 1, y: 0, z: 0 } });
    const world = {
      playerId: 1,
      player,
      entities: new Map([
        [1, player],
        [2, npc],
      ]),
      targetEntity: () => {},
    } as unknown as Parameters<typeof handlePickedEntity>[0];
    const hud = {
      openQuestDialog: vi.fn(),
      closeContextMenu: () => {},
    } as unknown as Parameters<typeof handlePickedEntity>[1];

    expect(handlePickedEntity(world, hud, 2, 0, 10, 20)).toBe(true);
    expect(hud.openQuestDialog).toHaveBeenCalledWith(2);

    npc.pos = { x: 99, y: 0, z: 0 };
    expect(handlePickedEntity(world, hud, 2, 0, 10, 20)).toBe(false);
  });

  it.each([0, 2])('reports opening nearby corpse loot with button %i', (button) => {
    const player = stubEntity({ id: 1, kind: 'player' });
    const corpse = stubEntity({
      id: 2,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
      pos: { x: 1, y: 0, z: 0 },
    });
    const world = {
      playerId: 1,
      player,
      entities: new Map([
        [1, player],
        [2, corpse],
      ]),
      targetEntity: () => {},
    } as unknown as Parameters<typeof handlePickedEntity>[0];
    const hud = {
      openLoot: vi.fn(),
      closeContextMenu: () => {},
    } as unknown as Parameters<typeof handlePickedEntity>[1];

    expect(handlePickedEntity(world, hud, 2, button, 10, 20)).toBe(true);
    expect(hud.openLoot).toHaveBeenCalledWith(2, 10, 20);
  });

  it.each([0, 2])('preserves movement when button %i finds no visible corpse loot', (button) => {
    const player = stubEntity({ id: 1, kind: 'player' });
    const corpse = stubEntity({
      id: 2,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [99] }] },
      pos: { x: 1, y: 0, z: 0 },
    });
    const world = {
      playerId: 1,
      player,
      entities: new Map([
        [1, player],
        [2, corpse],
      ]),
      targetEntity: () => {},
    } as unknown as Parameters<typeof handlePickedEntity>[0];
    const hud = {
      openLoot: vi.fn(),
      closeContextMenu: () => {},
    } as unknown as Parameters<typeof handlePickedEntity>[1];

    expect(handlePickedEntity(world, hud, 2, button, 10, 20)).toBe(false);
    expect(hud.openLoot).not.toHaveBeenCalled();
  });

  it.each([0, 2])(
    'preserves movement for button %i when an online host only appears to have harvestable remains',
    (button) => {
      const player = stubEntity({ id: 1, kind: 'player' });
      const corpse = stubEntity({
        id: 2,
        kind: 'mob',
        templateId: 'forest_wolf',
        dead: true,
        lootable: true,
        loot: null,
        harvestClaimedBy: null,
        pos: { x: 1, y: 0, z: 0 },
      });
      const world = {
        playerId: 1,
        player,
        entities: new Map([
          [1, player],
          [2, corpse],
        ]),
        targetEntity: () => {},
      } as unknown as Parameters<typeof handlePickedEntity>[0];
      const hud = {
        openLoot: vi.fn(),
        closeContextMenu: () => {},
      } as unknown as Parameters<typeof handlePickedEntity>[1];

      expect(handlePickedEntity(world, hud, 2, button, 10, 20, false)).toBe(false);
      expect(hud.openLoot).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['door', 0, { templateId: 'dungeon_door', dungeonId: 'crypt' }, 'enterDungeon'],
    ['door', 2, { templateId: 'dungeon_door', dungeonId: 'crypt' }, 'enterDungeon'],
    ['exit', 0, { templateId: 'dungeon_exit' }, 'leaveDungeon'],
    ['exit', 2, { templateId: 'dungeon_exit' }, 'leaveDungeon'],
    ['mailbox', 0, { templateId: 'mailbox' }, 'openMailbox'],
    ['mailbox', 2, { templateId: 'mailbox' }, 'openMailbox'],
    ['pickup', 0, {}, 'pickUpObject'],
    ['pickup', 2, {}, 'pickUpObject'],
  ])('reports a successful %s interaction with button %i', (_name, button, fields, expected) => {
    const player = stubEntity({ id: 1, kind: 'player' });
    const object = stubEntity({
      id: 2,
      kind: 'object',
      lootable: true,
      pos: { x: 1, y: 0, z: 0 },
      ...(fields as Partial<Entity>),
    });
    const calls: string[] = [];
    const world = {
      playerId: 1,
      player,
      entities: new Map([
        [1, player],
        [2, object],
      ]),
      targetEntity: () => {},
      enterDungeon: () => {
        calls.push('enterDungeon');
        return true;
      },
      leaveDungeon: () => {
        calls.push('leaveDungeon');
        return true;
      },
      pickUpObject: () => {
        calls.push('pickUpObject');
        return true;
      },
    } as unknown as Parameters<typeof handlePickedEntity>[0];
    const hud = {
      openMailbox: () => calls.push('openMailbox'),
      closeContextMenu: () => {},
    } as unknown as Parameters<typeof handlePickedEntity>[1];

    expect(handlePickedEntity(world, hud, 2, button as number, 10, 20)).toBe(true);
    expect(calls).toEqual([expected]);
  });

  it('returns a rejected authoritative pickup result', async () => {
    const player = stubEntity({ id: 1, kind: 'player' });
    const object = stubEntity({
      id: 2,
      kind: 'object',
      lootable: true,
      pos: { x: 1, y: 0, z: 0 },
    });
    const world = {
      playerId: 1,
      player,
      entities: new Map([
        [1, player],
        [2, object],
      ]),
      targetEntity: () => {},
      pickUpObject: vi.fn(async () => false),
    } as unknown as Parameters<typeof handlePickedEntity>[0];
    const hud = {
      closeContextMenu: () => {},
    } as unknown as Parameters<typeof handlePickedEntity>[1];

    await expect(handlePickedEntity(world, hud, 2, 0, 10, 20)).resolves.toBe(false);
    expect(world.pickUpObject).toHaveBeenCalledWith(2);
  });

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
      requestSpiritHealerResurrect: () => {},
    };

    expect(handlePickedEntity(world, hud, 2, 2, 10, 20)).toBe(false);

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
      requestSpiritHealerResurrect: () => {},
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
      enterDungeon: () => {
        calls.push('enterDungeon');
        return true;
      },
      leaveDungeon: () => true,
      pickUpObject: () => {
        calls.push('pickUpObject');
        return true;
      },
      startAutoAttack: () => {},
      resurrectAtSpiritHealer: () => {
        calls.push('resurrectAtSpiritHealer');
        return true;
      },
    };
    const hud = {
      openLoot: () => calls.push('openLoot'),
      openQuestDialog: () => calls.push('openQuestDialog'),
      openDelveBoard: () => calls.push('openDelveBoard'),
      openMailbox: () => calls.push('openMailbox'),
      showError: () => calls.push('showError'),
      closeContextMenu: () => {},
      requestSpiritHealerResurrect: () => calls.push('requestSpiritHealerResurrect'),
    };
    return { world, hud, calls };
  }

  const questNpc = () =>
    stubEntity({ id: 2, kind: 'npc', templateId: 'elder_maren', pos: { x: 3, y: 0, z: 0 } });

  it('a ghost right-clicking a quest NPC does not open the quest dialog', () => {
    const { world, hud, calls } = rig({ dead: true, ghost: true }, questNpc());
    expect(handlePickedEntity(world, hud, 2, 2, 10, 20)).toBe(false);
    expect(calls).not.toContain('openQuestDialog');
    expect(calls).not.toContain('openDelveBoard');
    expect(calls).toContain('showError');
  });

  it('a ghost left-clicking a quest NPC does not open the quest dialog', () => {
    const { world, hud, calls } = rig({ dead: true, ghost: true }, questNpc());
    expect(handlePickedEntity(world, hud, 2, 0, 10, 20)).toBe(false);
    expect(calls).not.toContain('openQuestDialog');
    expect(calls).not.toContain('openDelveBoard');
  });

  it('a dead-unreleased player clicking a quest NPC does not open the quest dialog', () => {
    const { world, hud, calls } = rig({ dead: true, ghost: false }, questNpc());
    expect(handlePickedEntity(world, hud, 2, 2, 10, 20)).toBe(false);
    expect(calls).not.toContain('openQuestDialog');
  });

  it('a ghost clicking a dungeon door does not dispatch a no-op interaction', () => {
    const door = stubEntity({
      id: 2,
      kind: 'object',
      templateId: 'dungeon_door',
      dungeonId: 'crypt',
      pos: { x: 1, y: 0, z: 0 },
    });
    const { world, hud, calls } = rig({ dead: true, ghost: true }, door);
    expect(handlePickedEntity(world, hud, 2, 2, 10, 20)).toBe(false);
    expect(calls).not.toContain('enterDungeon');
    expect(calls).toContain('showError');
  });

  it('a dead player clicking visible corpse loot does not open it', () => {
    const corpse = stubEntity({
      id: 2,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
      pos: { x: 1, y: 0, z: 0 },
    });
    const { world, hud, calls } = rig({ dead: true, ghost: false }, corpse);
    expect(handlePickedEntity(world, hud, 2, 0, 10, 20)).toBe(false);
    expect(calls).not.toContain('openLoot');
  });

  it('a ghost right-clicking the Spirit Healer routes through the confirm gate', () => {
    const healer = stubEntity({
      id: 2,
      kind: 'npc',
      templateId: 'spirit_healer',
      pos: { x: 3, y: 0, z: 0 },
    });
    const { world, hud, calls } = rig({ dead: true, ghost: true }, healer);
    expect(handlePickedEntity(world, hud, 2, 2, 10, 20)).toBe(true);
    // The click opens the HUD confirm (which owns sending the command on OK);
    // it must never send the resurrect command directly.
    expect(calls).toContain('requestSpiritHealerResurrect');
    expect(calls).not.toContain('resurrectAtSpiritHealer');
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
    expect(handlePickedEntity(world, hud, 2, 2, 10, 20)).toBe(false);
    expect(calls).not.toContain('openMailbox');
    expect(handlePickedEntity(world, hud, 2, 0, 10, 20)).toBe(false);
    expect(calls).not.toContain('openMailbox');
  });

  it('an alive player clicking a quest NPC still opens the quest dialog', () => {
    const { world, hud, calls } = rig({}, questNpc());
    expect(handlePickedEntity(world, hud, 2, 2, 10, 20)).toBe(true);
    expect(calls).toContain('openQuestDialog');
  });
});

describe('shouldApproachPickedEntity', () => {
  const player = stubEntity({ id: 1, kind: 'player' });

  it('does not replace autorun for successful or locally impossible interactions', () => {
    const nearbyHealer = stubEntity({
      id: 2,
      kind: 'npc',
      templateId: 'spirit_healer',
      pos: { x: 1, y: 0, z: 0 },
    });
    const unavailableCorpse = stubEntity({
      id: 3,
      kind: 'mob',
      dead: true,
      lootable: true,
      pos: { x: 1, y: 0, z: 0 },
    });

    expect(shouldApproachPickedEntity(player, nearbyHealer, false)).toBe(false);
    expect(shouldApproachPickedEntity(player, unavailableCorpse, false)).toBe(false);
    expect(shouldApproachPickedEntity(player, nearbyHealer, true)).toBe(false);
  });

  it('allows movement toward distant interactables and living targets', () => {
    const distantNpc = stubEntity({ id: 2, kind: 'npc', pos: { x: 99, y: 0, z: 0 } });
    const hostile = stubEntity({
      id: 3,
      kind: 'mob',
      hostile: true,
      pos: { x: 1, y: 0, z: 0 },
    });
    const distantCorpse = stubEntity({
      id: 4,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
      pos: { x: 99, y: 0, z: 0 },
    });

    expect(shouldApproachPickedEntity(player, distantNpc, false)).toBe(true);
    expect(shouldApproachPickedEntity(player, hostile, false)).toBe(true);
    expect(shouldApproachPickedEntity(player, distantCorpse, false)).toBe(true);
  });

  it('approaches an object outside the authoritative interaction range while confirmation is pending', () => {
    const object = stubEntity({
      id: 2,
      kind: 'object',
      lootable: true,
      pos: { x: INTERACT_RANGE + 0.5, y: 0, z: 0 },
    });

    expect(shouldApproachPickedEntity(player, object, false)).toBe(true);
  });

  it('approaches distant harvest remains only when the host mirrors claim state', () => {
    const harvestOnlyCorpse = stubEntity({
      id: 2,
      kind: 'mob',
      templateId: 'forest_wolf',
      dead: true,
      lootable: true,
      loot: null,
      harvestClaimedBy: null,
      pos: { x: 99, y: 0, z: 0 },
    });

    expect(shouldApproachPickedEntity(player, harvestOnlyCorpse, false, true)).toBe(true);
    expect(shouldApproachPickedEntity(player, harvestOnlyCorpse, false, false)).toBe(false);
  });

  it('does not start entity click-move while the player is dead', () => {
    const ghost = stubEntity({ id: 1, kind: 'player', dead: true, ghost: true });
    const distantNpc = stubEntity({ id: 2, kind: 'npc', pos: { x: 99, y: 0, z: 0 } });

    expect(shouldApproachPickedEntity(ghost, distantNpc, false)).toBe(false);
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
