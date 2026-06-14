import { describe, expect, it } from 'vitest';
import { hoverCursorKind, isAttackHoverTarget } from '../src/game/interactions';
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
    comboTargetId: null,
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
    petTauntTimer: 0,
    pulseTimer: 0,
    firedSummons: 0,
    summonedIds: [],
    enraged: false,
    evadeTimer: 0,
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

  it('returns friendly for party members only', () => {
    const ally = stubEntity({ id: 4, kind: 'player' });
    const stranger = stubEntity({ id: 5, kind: 'player' });
    const party = new Set([4]);
    expect(hoverCursorKind(ally, 1, party)).toBe('friendly');
    expect(hoverCursorKind(stranger, 1, party)).toBe('default');
    expect(hoverCursorKind(ally, 4, party)).toBe('default');
  });

  it('returns default for empty pick', () => {
    expect(hoverCursorKind(undefined, 1, new Set())).toBe('default');
  });
});
