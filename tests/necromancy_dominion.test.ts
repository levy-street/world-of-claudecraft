import { describe, expect, it } from 'vitest';
import {
  dominionSummonBlock,
  missingDominionTemplates,
  NECROMANCY_DOMINION_CAP,
  selectCorpseExplosionServant,
} from '../src/sim/combat/necromancy_dominion';

describe('Necromancy Dominion composition', () => {
  it('allows two unique servants and blocks duplicates or a third normal summon', () => {
    const warrior = { templateId: 'necromancy_skeletal_warrior' };
    const mage = { templateId: 'necromancy_bone_mage' };

    expect(NECROMANCY_DOMINION_CAP).toBe(2);
    expect(dominionSummonBlock([], warrior.templateId)).toBeNull();
    expect(dominionSummonBlock([warrior], warrior.templateId)).toBe('duplicate');
    expect(dominionSummonBlock([warrior], mage.templateId)).toBeNull();
    expect(dominionSummonBlock([warrior, mage], 'necromancy_gravewing')).toBe('full');
  });

  it('returns only the archetypes Army of the Dead must add', () => {
    expect(
      missingDominionTemplates([
        { templateId: 'necromancy_skeletal_warrior' },
        { templateId: 'necromancy_bone_mage' },
      ]),
    ).toEqual(['necromancy_gravewing']);
  });

  it('sacrifices Bone Mage before Warrior and protects Gravewing for last', () => {
    const warrior = {
      id: 8,
      templateId: 'necromancy_skeletal_warrior',
      hp: 1,
      maxHp: 100,
    };
    const mage = {
      id: 9,
      templateId: 'necromancy_bone_mage',
      hp: 100,
      maxHp: 100,
    };
    const expiringGravewing = {
      id: 10,
      templateId: 'necromancy_gravewing',
      hp: 100,
      maxHp: 100,
      despawnTimer: 3,
    };

    expect(selectCorpseExplosionServant([warrior, mage, expiringGravewing])).toBe(mage);
    expect(selectCorpseExplosionServant([warrior, expiringGravewing])).toBe(warrior);
    expect(selectCorpseExplosionServant([expiringGravewing])).toBe(expiringGravewing);
  });

  it('uses duration, health percentage, and entity id within one servant archetype', () => {
    const expiringSooner = {
      id: 14,
      templateId: 'necromancy_bone_mage',
      hp: 100,
      maxHp: 100,
      despawnTimer: 3,
    };
    const expiringLater = {
      id: 15,
      templateId: 'necromancy_bone_mage',
      hp: 1,
      maxHp: 100,
      despawnTimer: 8,
    };
    const weakest = {
      id: 12,
      templateId: 'necromancy_bone_mage',
      hp: 20,
      maxHp: 100,
    };
    const tiedHigherId = {
      id: 13,
      templateId: 'necromancy_bone_mage',
      hp: 50,
      maxHp: 200,
    };
    const tiedLowerId = {
      id: 11,
      templateId: 'necromancy_bone_mage',
      hp: 50,
      maxHp: 200,
    };

    expect(selectCorpseExplosionServant([expiringLater, expiringSooner])).toBe(expiringSooner);
    expect(selectCorpseExplosionServant([tiedHigherId, tiedLowerId, weakest])).toBe(weakest);
    expect(selectCorpseExplosionServant([tiedHigherId, tiedLowerId])).toBe(tiedLowerId);
  });

  it('never selects Graveguard or a dead Dominion servant', () => {
    expect(
      selectCorpseExplosionServant([
        { id: 1, templateId: 'graveguard', hp: 1, maxHp: 100 },
        {
          id: 2,
          templateId: 'necromancy_skeletal_warrior',
          hp: 1,
          maxHp: 100,
          dead: true,
        },
      ]),
    ).toBeNull();
  });
});
