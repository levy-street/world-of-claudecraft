import { describe, expect, it } from 'vitest';
import { shouldPlayCombatImpactForTarget, shouldPlayCritSfxForTarget, shouldPlayMobVoiceSfxForEntity } from '../src/ui/combat_sfx';
import type { Entity } from '../src/sim/types';

function target(kind: Entity['kind'], templateId: string): Entity {
  return {
    id: 1,
    kind,
    templateId,
    name: 'Target',
    level: 20,
    pos: { x: 0, y: 0, z: 0 },
    prevPos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    facing: 0,
    prevFacing: 0,
    hp: 100,
    maxHp: 100,
    resource: 0,
    maxResource: 0,
    resourceType: null,
    stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
    weapon: { min: 1, max: 2, speed: 2 },
    auras: [],
    targetId: null,
    castRemaining: 0,
    castTotal: 0,
    castingAbility: null,
    channeling: false,
    dead: false,
    inCombat: false,
    swingTimer: 0,
    moveSpeed: 7,
    radius: 0.35,
    height: 1.8,
    scale: 1,
    color: 0xffffff,
    ownerId: null,
    petMode: 'defensive',
    petTargetId: null,
    petAttackTargetId: null,
    petReturnTarget: null,
    petNextActionAt: 0,
    hostile: kind === 'mob',
    aggroRadius: 0,
    aiState: 'idle',
    aggroTargetId: null,
    spawnPos: { x: 0, y: 0, z: 0 },
    leashOrigin: { x: 0, y: 0, z: 0 },
    threat: new Map(),
    tappedById: null,
    lootable: false,
    loot: null,
    questIds: [],
    patrol: null,
    patrolIndex: 0,
    fleeing: false,
    fleeTimer: 0,
    fleeReturnTimer: 0,
    fledOnce: false,
    summonedIds: [],
    summonedById: null,
    interactable: false,
    objectItemId: null,
    dungeonId: null,
    dungeonSlot: null,
    overheadEmoteId: null,
    overheadEmoteSeq: 0,
    overheadEmoteUntil: 0,
  } as unknown as Entity;
}

describe('combat SFX policy', () => {
  it('suppresses crit stingers for boss targets only', () => {
    expect(shouldPlayCritSfxForTarget(target('mob', 'nythraxis_scourge_of_thornpeak'))).toBe(false);
    expect(shouldPlayCritSfxForTarget(target('mob', 'nythraxis_skeleton_warrior'))).toBe(true);
    expect(shouldPlayCritSfxForTarget(target('player', 'warrior'))).toBe(true);
  });

  it('suppresses Nythraxis add voice barks without muting ordinary undead', () => {
    expect(shouldPlayMobVoiceSfxForEntity(target('mob', 'nythraxis_skeleton_warrior'))).toBe(false);
    expect(shouldPlayMobVoiceSfxForEntity(target('mob', 'crypt_shambler'))).toBe(true);
    expect(shouldPlayMobVoiceSfxForEntity(target('player', 'warrior'))).toBe(false);
  });

  it('mutes all non-dialogue Nythraxis boss combat sounds', () => {
    expect(shouldPlayMobVoiceSfxForEntity(target('mob', 'nythraxis_scourge_of_thornpeak'))).toBe(false);
    expect(shouldPlayCombatImpactForTarget(target('mob', 'nythraxis_scourge_of_thornpeak'))).toBe(false);
    expect(shouldPlayCombatImpactForTarget(target('mob', 'crypt_shambler'))).toBe(true);
    expect(shouldPlayCombatImpactForTarget(target('player', 'warrior'))).toBe(true);
  });
});
