// Choice-row counterplay spells (Talents 2.0): the level-8 rows that used to grant a
// now-baseline interrupt instead grant a distinct utility spell. Warrior Spell Reflect
// bounces the next hostile spell back at its caster; rogue Smoke Screen raises dodge;
// druid Typhoon knocks back and dazes nearby enemies.
import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// Row-granted spells are only known via a choice pick; build a ResolvedAbility straight
// from the def so the test drives runEffects without allocating the row.
function cast(sim: Sim, target: Entity, abilityId: string): void {
  const p = sim.entities.get(sim.playerId) as Entity;
  const meta = (sim as unknown as { players: Map<number, unknown> }).players.get(sim.playerId);
  const def = ABILITIES[abilityId];
  const res = {
    def,
    rank: 1,
    cost: def.cost,
    castTime: def.castTime,
    cooldown: def.cooldown,
    effects: def.effects,
    threatFlat: 0,
    threatMult: 1,
  };
  (
    sim as unknown as {
      ctx: { runEffects(p: Entity, meta: unknown, target: Entity, res: unknown): void };
    }
  ).ctx.runEffects(p, meta, target, res);
}

function spawnEnemy(sim: Sim, dz: number): Entity {
  const p = sim.entities.get(sim.playerId) as Entity;
  const enemy = createMob((sim as unknown as { nextId: number }).nextId++, MOBS.ridge_stalker, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  enemy.hostile = true;
  enemy.maxHp = 5000;
  enemy.hp = 5000;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(enemy);
  return enemy;
}

describe('warrior Spell Reflect', () => {
  it('bounces the next spell hit back at its caster and is consumed', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const p = sim.entities.get(sim.playerId) as Entity;
    const enemy = spawnEnemy(sim, 3);

    cast(sim, p, 'spell_reflect');
    expect(p.auras.some((a) => a.kind === 'spell_reflect')).toBe(true);

    const hpBefore = p.hp;
    const enemyBefore = enemy.hp;
    (sim as unknown as { dealDamage: (...a: unknown[]) => void }).dealDamage(
      enemy,
      p,
      200,
      false,
      'fire',
      'Fireball',
      'hit',
    );

    expect(p.hp).toBe(hpBefore); // the spell was reflected, the warrior took nothing
    expect(p.auras.some((a) => a.kind === 'spell_reflect')).toBe(false); // charge consumed
    expect(enemy.hp).toBeLessThan(enemyBefore); // the caster ate its own spell
  });

  it('does not reflect physical damage and leaves the charge up', () => {
    const sim = new Sim({ seed: 2, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const p = sim.entities.get(sim.playerId) as Entity;
    const enemy = spawnEnemy(sim, 3);

    cast(sim, p, 'spell_reflect');
    const hpBefore = p.hp;
    (sim as unknown as { dealDamage: (...a: unknown[]) => void }).dealDamage(
      enemy,
      p,
      200,
      false,
      'physical',
      'Claw',
      'hit',
    );

    expect(p.hp).toBeLessThan(hpBefore); // a melee hit lands normally
    expect(p.auras.some((a) => a.kind === 'spell_reflect')).toBe(true); // charge still up
  });
});

describe('rogue Smoke Screen', () => {
  it('raises the caster dodge chance by 30% for its duration', () => {
    const sim = new Sim({ seed: 3, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    const p = sim.entities.get(sim.playerId) as Entity;
    const dodgeBefore = p.dodgeChance;

    cast(sim, p, 'smoke_screen');

    expect(p.auras.some((a) => a.kind === 'buff_dodge')).toBe(true);
    expect(p.dodgeChance).toBeCloseTo(dodgeBefore + 0.3, 5);
  });
});

describe('druid Typhoon', () => {
  it('knocks nearby enemies back from the caster and dazes them', () => {
    const sim = new Sim({ seed: 4, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(20);
    const p = sim.entities.get(sim.playerId) as Entity;
    const enemy = spawnEnemy(sim, 3);
    const distBefore = Math.hypot(enemy.pos.x - p.pos.x, enemy.pos.z - p.pos.z);

    cast(sim, p, 'typhoon');

    const distAfter = Math.hypot(enemy.pos.x - p.pos.x, enemy.pos.z - p.pos.z);
    expect(distAfter).toBeGreaterThan(distBefore); // shoved outward
    expect(enemy.auras.some((a) => a.kind === 'slow')).toBe(true); // dazed
  });
});

describe('the level-8 counterplay rows grant the utility spell, not the interrupt', () => {
  it('warrior offers Spell Reflect, not Pummel', () => {
    const war = CHOICE_ROWS.warrior.rows.find((r) => r.level === 8);
    expect(war?.options.some((o) => o.effect.grant?.ability === 'spell_reflect')).toBe(true);
    expect(war?.options.some((o) => o.effect.grant?.ability === 'pummel')).toBe(false);
  });
  it('rogue offers Smoke Screen, not Kick', () => {
    const rog = CHOICE_ROWS.rogue.rows.find((r) => r.level === 8);
    expect(rog?.options.some((o) => o.effect.grant?.ability === 'smoke_screen')).toBe(true);
    expect(rog?.options.some((o) => o.effect.grant?.ability === 'kick')).toBe(false);
  });
  it('druid offers Typhoon, not Skull Bash', () => {
    const dru = CHOICE_ROWS.druid.rows.find((r) => r.level === 8);
    expect(dru?.options.some((o) => o.effect.grant?.ability === 'typhoon')).toBe(true);
    expect(dru?.options.some((o) => o.effect.grant?.ability === 'skull_bash')).toBe(false);
  });
});
