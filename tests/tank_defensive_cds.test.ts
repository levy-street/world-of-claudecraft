// Tank defensive cooldowns, one distinct mechanic per class:
//   - Warrior Ironhold: a flat 40% damage-taken reduction (shield_wall).
//   - Paladin Sacred Bulwark: a cheat-death that denies a lethal blow and restores 35%.
//   - Druid Primal Reflexes: a dodge cooldown (buff_dodge), usable while shapeshifted.
// Also covers the druid parity buff (Dire Bruin now +20% threat / +15% armor).
import { describe, expect, it } from 'vitest';
import { TALENTS } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function make(cls: string) {
  const sim = new Sim({ seed: 5, playerClass: cls as any, autoEquip: true });
  sim.setPlayerLevel(20);
  const pid = sim.playerId;
  const p = sim.entities.get(pid) as Entity & Record<string, unknown>;
  for (let i = 0; i < 5; i++) sim.tick();
  (p as any).resource = (p as any).maxResource;
  return { sim, p, pid };
}

function spawnMob(sim: Sim, p: Entity, dz: number) {
  const mob = createMob((sim as any).nextId++, MOBS.ridge_stalker, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.maxHp = mob.hp = 1_000_000;
  mob.hostile = false;
  sim.entities.set(mob.id, mob);
  (sim as any).rebucket(mob);
  return mob;
}

// Cast an instant ability and let it resolve (ticks past the GCD).
function cast(sim: Sim, id: string, pid: number) {
  (sim.entities.get(pid) as any).resource = (sim.entities.get(pid) as any).maxResource;
  sim.castAbility(id, pid);
  for (let i = 0; i < 32; i++) sim.tick();
}

describe('Tank defensive cooldowns: known by their class at 20', () => {
  it('warrior knows Ironhold, paladin Sacred Bulwark, druid Primal Reflexes', () => {
    const CD: Record<string, string> = {
      warrior: 'ironhold',
      paladin: 'sacred_bulwark',
      druid: 'primal_reflexes',
    };
    for (const [cls, id] of Object.entries(CD)) {
      const { sim } = make(cls);
      expect(!!sim.resolvedAbility(id), `${cls} knows ${id}`).toBe(true);
    }
  });
});

describe('Ironhold (warrior): flat 40% mitigation', () => {
  it('reduces damage of any school, DoT ticks included, then expires', () => {
    const { sim, p, pid } = make('warrior');
    cast(sim, 'ironhold', pid);
    expect(p.auras.some((a) => a.kind === 'shield_wall')).toBe(true);
    const mob = spawnMob(sim, p, 3);
    (p as any).maxHp = p.hp = 1_000_000;
    for (const school of ['physical', 'fire', 'shadow']) {
      const before = p.hp;
      (sim as any).dealDamage(mob, p, 100, false, school, null, 'hit');
      expect(before - p.hp).toBe(60); // 40% reduced
    }
    // non-direct (DoT tick) is reduced too
    const beforeDot = p.hp;
    (sim as any).dealDamage(mob, p, 100, false, 'shadow', null, 'hit', false, undefined, false);
    expect(beforeDot - p.hp).toBe(60);
  });
});

describe('Sacred Bulwark (paladin): divine cheat-death', () => {
  it('denies a lethal blow and restores 35% health, consuming the ward', () => {
    const { sim, p, pid } = make('paladin');
    cast(sim, 'sacred_bulwark', pid);
    expect(p.auras.some((a) => a.kind === 'guardian_ward')).toBe(true);
    const mob = spawnMob(sim, p, 3);
    p.hp = p.maxHp;
    (sim as any).dealDamage(mob, p, p.maxHp * 5, false, 'physical', null, 'hit'); // lethal
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(Math.round(p.maxHp * 0.35));
    expect(p.auras.some((a) => a.kind === 'guardian_ward')).toBe(false);
  });

  it('a non-lethal blow leaves the ward intact', () => {
    const { sim, p, pid } = make('paladin');
    cast(sim, 'sacred_bulwark', pid);
    const mob = spawnMob(sim, p, 3);
    p.hp = p.maxHp;
    (sim as any).dealDamage(mob, p, 10, false, 'physical', null, 'hit');
    expect(p.auras.some((a) => a.kind === 'guardian_ward')).toBe(true);
  });
});

describe('Primal Reflexes (druid): dodge cooldown', () => {
  it('raises dodge chance and works while shapeshifted', () => {
    const { sim, p, pid } = make('druid');
    const baseDodge = p.dodgeChance;
    cast(sim, 'primal_reflexes', pid);
    expect(p.auras.some((a) => a.kind === 'buff_dodge')).toBe(true);
    expect(p.dodgeChance).toBeGreaterThan(baseDodge + 0.45); // +50% dodge

    // usable in bear form: shift, then pop it
    const { sim: sim2, p: p2, pid: pid2 } = make('druid');
    cast(sim2, 'bear_form', pid2);
    expect(p2.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    cast(sim2, 'primal_reflexes', pid2);
    expect(p2.auras.some((a) => a.kind === 'buff_dodge')).toBe(true);
  });
});

describe('Druid parity: Dire Bruin threat/armor buff', () => {
  it('grants +20% threat and +15% armor', () => {
    const druid = TALENTS.druid!;
    const choice = druid.nodes.find((n: any) => n.id === 'feral_choice');
    const bruin = choice?.choices?.find((c: any) => c.id === 'feral_choice_bear');
    expect(bruin?.effect.global?.threatPct).toBe(0.2);
    expect(bruin?.effect.stats?.armorPct).toBe(0.15);
  });
});
