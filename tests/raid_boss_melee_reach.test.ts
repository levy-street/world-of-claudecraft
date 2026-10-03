import { describe, expect, it } from 'vitest';
import { startAutoAttack, updatePlayerAutoAttack } from '../src/sim/combat/auto_attack';
import {
  BODY_EDGE_MELEE_REACH,
  effectivePlayerAttackRange,
  RAID_BOSS_PLAYER_MELEE_RANGE,
} from '../src/sim/combat/player_attack_reach';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { VARKHUL_BOSS_ID } from '../src/sim/ignivar_raid_ids';
import { combatProfileForMob } from '../src/sim/mob_combat';
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

// The towering dungeon bosses author a bodyRadius (MobTemplate): a player's
// melee reaches the edge of the body (bodyRadius + 3) instead of standing
// inside the model (Ysolei's coils spread 8 yd round her pivot), and the
// boss's own swing reaches one yard further, so nobody hits from outside it.
describe('big-bodied boss reach (bodyRadius)', () => {
  const BODIED = Object.values(MOBS).filter((m) => (m.bodyRadius ?? 0) > 0);

  it('covers the reworked dungeons’ big bosses', () => {
    const ids = BODIED.map((m) => m.id);
    for (const id of ['ysolei', 'crypt_knellwyrm', 'morthen']) expect(ids).toContain(id);
  });

  it.each(BODIED.map((m) => [m.id, m.bodyRadius as number, m.scale] as const))(
    '%s: melee reaches its edge, and its own swing outreaches the player',
    (id, body, scale) => {
      const target = { kind: 'mob' as const, templateId: id };
      const reach = effectivePlayerAttackRange(target, MELEE_RANGE);
      // (A body under 2 yd, the great jaguar's, keeps the stock reach.)
      expect(reach).toBe(Math.max(MELEE_RANGE, body + BODY_EDGE_MELEE_REACH));
      expect(effectivePlayerAttackRange(target, 30)).toBe(30);
      expect(combatProfileForMob(id, scale).meleeRange).toBeGreaterThan(reach);
    },
  );

  it('Ysolei: a swing lands from the edge of her coil, 10.5 yd out', () => {
    const sim = new Sim({ seed: 771, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const player = sim.player;
    const meta = sim.players.get(player.id);
    if (!meta) throw new Error('no meta');
    const boss = createMob(sim.nextId++, MOBS.ysolei, 18, {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z + 10.5,
    });
    boss.maxHp = 1_000_000;
    boss.hp = boss.maxHp;
    boss.stats = { ...boss.stats, armor: 0 };
    sim.addEntity(boss);
    sim.targetEntity(boss.id, player.id);
    startAutoAttack(sim.ctx, player.id);
    player.swingTimer = 0;
    for (let attempt = 0; attempt < 20 && boss.hp === boss.maxHp; attempt++) {
      updatePlayerAutoAttack(sim.ctx, player, meta);
      player.swingTimer = 0;
    }
    expect(boss.hp).toBeLessThan(boss.maxHp);
  });
});

// The dungeons' great NON-boss bodies take the same rule (the owner's playtest:
// a melee player had to stand inside a great body to hit it). Each radius
// is sized to the drawn footprint and held under the creature's own point-blank
// mechanic, so nobody fights it from outside what it throws at its feet.
describe('large dungeon creature reach (bodyRadius)', () => {
  /** Does a warrior's swing land on the template from `dist` yards? */
  function swingLands(templateId: string, level: number, dist: number): boolean {
    const sim = new Sim({ seed: 771, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const player = sim.player;
    const meta = sim.players.get(player.id);
    if (!meta) throw new Error('no meta');
    const mob = createMob(sim.nextId++, MOBS[templateId], level, {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z + dist,
    });
    mob.maxHp = 1_000_000;
    mob.hp = mob.maxHp;
    mob.stats = { ...mob.stats, armor: 0 };
    sim.addEntity(mob);
    sim.targetEntity(mob.id, player.id);
    startAutoAttack(sim.ctx, player.id);
    player.swingTimer = 0;
    for (let attempt = 0; attempt < 20 && mob.hp === mob.maxHp; attempt++) {
      updatePlayerAutoAttack(sim.ctx, player, meta);
      player.swingTimer = 0;
    }
    return mob.hp < mob.maxHp;
  }

  // [template, level, the drawn half-width, the bodyRadius]
  const CREATURES = [
    ['turretback_hermit', 13, 4.3, 4.5],
    ['mere_hydra_head_left', 17, 3, 3],
    ['mere_hydra_head_center', 17, 3, 3],
    ['mere_hydra_head_right', 17, 3, 3],
    ['great_saurian', 20, 3.5, 4],
    ['the_gorgebloom', 20, 4, 4.5],
  ] as const;

  it.each(CREATURES)(
    '%s: a swing lands from its body edge, and none from beyond its own reach',
    (id, level, halfWidth, body) => {
      const template = MOBS[id];
      expect(template.bodyRadius).toBe(body);
      // The radius covers the drawn flank, so the reach starts outside the model.
      expect(body).toBeGreaterThanOrEqual(halfWidth);
      const reach = body + BODY_EDGE_MELEE_REACH;
      expect(reach).toBeGreaterThan(MELEE_RANGE);
      const own = combatProfileForMob(id, template.scale).meleeRange;
      expect(own).toBeGreaterThanOrEqual(reach + 1);
      // At the body's edge, well outside the stock 5 yd: the swing lands.
      expect(swingLands(id, level, reach - 0.1)).toBe(true);
      // Just past the player's reach, and past the creature's own: nothing.
      expect(swingLands(id, level, reach + 0.2)).toBe(false);
      expect(swingLands(id, level, own + 0.2)).toBe(false);
    },
  );

  it('the Turretback Hermit: Shell Slam and Claw Sweep still cover its melee ring', () => {
    const hermit = MOBS.turretback_hermit;
    const reach = effectivePlayerAttackRange({ kind: 'mob', templateId: hermit.id }, MELEE_RANGE);
    expect(reach).toBe(7.5);
    expect(hermit.trashKit?.wingGust?.radius).toBeGreaterThanOrEqual(reach);
    expect(hermit.breathCone?.range).toBeGreaterThanOrEqual(reach);
  });

  it('the Snarlvine Lasher needs none: stock reach already stands outside its 2.6 yd body', () => {
    expect(MOBS.vine_lasher.bodyRadius).toBeUndefined();
    expect(MELEE_RANGE).toBeGreaterThan(2.6 + 2);
  });
});
