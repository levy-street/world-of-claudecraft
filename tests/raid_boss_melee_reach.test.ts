import { describe, expect, it } from 'vitest';
import { startAutoAttack, updatePlayerAutoAttack } from '../src/sim/combat/auto_attack';
import {
  effectivePlayerAttackRange,
  RAID_BOSS_PLAYER_MELEE_RANGE,
} from '../src/sim/combat/player_attack_reach';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { VARKHUL_BOSS_ID } from '../src/sim/ignivar_raid_ids';
import { Sim } from '../src/sim/sim';
import { IGNIVAR_BOSS_ID, MELEE_RANGE } from '../src/sim/types';

const RAID_BOSS_IDS = [IGNIVAR_BOSS_ID, VARKHUL_BOSS_ID] as const;

function raidBossTarget(templateId: typeof IGNIVAR_BOSS_ID | typeof VARKHUL_BOSS_ID, distance = 8) {
  const sim = new Sim({ seed: 771, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.setSpec('arms');
  const player = sim.player;
  const meta = sim.players.get(player.id);
  if (!meta) throw new Error('Warrior metadata missing');
  player.resource = player.maxResource;
  const boss = createMob(sim.nextId++, MOBS[templateId], 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + distance,
  });
  boss.maxHp = 1_000_000;
  boss.hp = boss.maxHp;
  boss.stats = { ...boss.stats, armor: 0 };
  sim.addEntity(boss);
  sim.targetEntity(boss.id, player.id);
  return { sim, player, meta, boss };
}

describe('raid boss player attack reach', () => {
  it('pins the enlarged raid boss melee boundary', () => {
    expect(RAID_BOSS_PLAYER_MELEE_RANGE).toBe(8);
  });

  it.each(RAID_BOSS_IDS)(
    'extends melee attacks against %s without changing ranged attacks',
    (templateId) => {
      const boss = { kind: 'mob' as const, templateId };

      expect(effectivePlayerAttackRange(boss, MELEE_RANGE)).toBe(8);
      expect(effectivePlayerAttackRange(boss, 0)).toBe(8);
      expect(effectivePlayerAttackRange(boss, 30)).toBe(30);
    },
  );

  it('keeps ordinary mob melee reach unchanged', () => {
    const mob = { kind: 'mob' as const, templateId: 'forest_wolf' };

    expect(effectivePlayerAttackRange(mob, MELEE_RANGE)).toBe(MELEE_RANGE);
    expect(effectivePlayerAttackRange(mob, 0)).toBe(MELEE_RANGE);
  });

  it.each(RAID_BOSS_IDS)(
    'allows a real player swing at the enlarged %s footprint',
    (templateId) => {
      const { sim, player, meta, boss } = raidBossTarget(templateId);

      startAutoAttack(sim.ctx, player.id);
      expect(boss.aggroTargetId).toBe(player.id);
      player.swingTimer = 0;
      for (let attempt = 0; attempt < 20 && boss.hp === boss.maxHp; attempt++) {
        updatePlayerAutoAttack(sim.ctx, player, meta);
        player.swingTimer = 0;
      }

      expect(boss.hp).toBeLessThan(boss.maxHp);
    },
  );

  it.each(RAID_BOSS_IDS)(
    'allows a real melee ability at the enlarged %s footprint',
    (templateId) => {
      const { sim, player, boss } = raidBossTarget(templateId);

      sim.castAbility('mortal_strike', player.id);

      expect(player.cooldowns.get('mortal_strike')).toBeGreaterThan(0);
      expect(boss.hp).toBeLessThan(boss.maxHp);
    },
  );

  it.each(RAID_BOSS_IDS)('rejects melee just outside the enlarged %s footprint', (templateId) => {
    const { sim, player, meta, boss } = raidBossTarget(templateId, 8.01);

    startAutoAttack(sim.ctx, player.id);
    player.swingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, player, meta);
    expect(boss.aggroTargetId).toBeNull();
    expect(boss.hp).toBe(boss.maxHp);

    sim.castAbility('mortal_strike', player.id);
    expect(player.cooldowns.has('mortal_strike')).toBe(false);
    expect(boss.hp).toBe(boss.maxHp);
  });
});
