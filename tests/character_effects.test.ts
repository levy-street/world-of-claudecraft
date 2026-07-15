import { describe, expect, it } from 'vitest';
import {
  characterRecklessnessActive,
  characterSanguineAuraActive,
  characterSoulRendActive,
} from '../src/render/character_effects';
import type { Entity } from '../src/sim/types';

function entity(partial: Partial<Entity>): Entity {
  return {
    id: 1,
    kind: 'player',
    templateId: '',
    name: 'Marked',
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
    hostile: false,
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
    ...partial,
  } as unknown as Entity;
}

describe('character visual effects', () => {
  it('detects Soul Rend as a model-level effect instead of a nameplate marker', () => {
    expect(characterSoulRendActive(entity({ auras: [] }))).toBe(false);
    expect(
      characterSoulRendActive(
        entity({
          auras: [
            {
              id: 'nythraxis_soul_rend',
              name: 'Soul Rend',
              kind: 'vulnerability',
              remaining: 8,
              duration: 8,
              value: 0,
              sourceId: 2,
              school: 'shadow',
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('routes winning Warrior aura identities to their authored render layers', () => {
    const sanguine = {
      id: 'sanguine_aura',
      name: 'Sanguine Aura',
      kind: 'sanguine',
      remaining: 12,
      duration: 12,
      value: 0.1,
      sourceId: 1,
      school: 'physical',
    } as const;
    const reckless = {
      id: 'recklessness',
      name: 'Recklessness',
      kind: 'buff_reckless',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: 1,
      school: 'physical',
    } as const;

    expect(characterSanguineAuraActive(entity({ auras: [sanguine] }))).toBe(true);
    expect(characterRecklessnessActive(entity({ auras: [reckless] }))).toBe(true);
    expect(characterSanguineAuraActive(entity({ auras: [reckless] }))).toBe(false);
    expect(characterRecklessnessActive(entity({ auras: [sanguine] }))).toBe(false);
  });
});
