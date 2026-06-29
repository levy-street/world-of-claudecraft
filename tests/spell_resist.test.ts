// Tests for spell avoidance semantics: spells never "miss", they are "resisted".
// Covers the pure leaf (src/sim/combat/spell_resist.ts) AND the behavioral fix at
// the cast site (applyAbility in combat/casting_lifecycle.ts): an avoided hostile
// spell must emit kind:'resist' (not 'miss') with zero damage, while a physical
// ability (sunder) still emits kind:'miss'.

import { describe, expect, it } from 'vitest';
import { castAbility, updateCasting } from '../src/sim/combat/casting_lifecycle';
import { isSpellResisted, spellResistChance } from '../src/sim/combat/spell_resist';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';
import { type Entity, type PlayerClass, spellHitChance } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

describe('spell_resist: pure leaf', () => {
  it('resist chance is the complement of spell-hit chance', () => {
    expect(spellResistChance(5, 5)).toBeCloseTo(1 - spellHitChance(5, 5));
    expect(spellResistChance(3, 7)).toBeCloseTo(1 - spellHitChance(3, 7));
    // a much higher-level target resists far more often than an equal-level one
    expect(spellResistChance(3, 7)).toBeGreaterThan(spellResistChance(5, 5));
  });

  it('isSpellResisted draws exactly one rng value and inverts the hit roll', () => {
    let draws = 0;
    const landed = isSpellResisted(
      {
        chance: () => {
          draws++;
          return true;
        },
      },
      5,
      5,
    );
    expect(draws).toBe(1);
    expect(landed).toBe(false); // chance(hit)=true means NOT resisted
    expect(isSpellResisted({ chance: () => false }, 5, 5)).toBe(true);
  });
});

function makeSim(cls: PlayerClass, level: number): { sim: AnySim; p: AnyEntity; meta: any } {
  const sim = new Sim({ seed: 99, playerClass: cls, autoEquip: true }) as AnySim;
  sim.setPlayerLevel(level);
  const p = sim.player as AnyEntity;
  p.resource = p.maxResource;
  return { sim, p, meta: sim.players.get(p.id) };
}

function spawnTarget(sim: AnySim, p: AnyEntity, level: number, dz = 4): AnyEntity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, level, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  }) as AnyEntity;
  mob.maxHp = 5000;
  mob.hp = 5000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

describe('spell_resist: cast outcome labeling', () => {
  it('an avoided hostile spell emits kind:"resist" (never "miss") with zero damage', () => {
    const { sim, p, meta } = makeSim('mage', 5);
    // A wildly higher-level target makes the resist near-certain; force it by
    // stubbing the shared rng so the hit roll always fails.
    const mob = spawnTarget(sim, p, 60);
    sim.rng.chance = () => false; // every spell-hit roll fails -> resisted

    const events: any[] = [];
    sim.ctx.emit = (e: any) => events.push(e);

    castAbility(sim.ctx, 'fireball', p.id);
    let n = 0;
    while (p.castingAbility && n++ < 1000) updateCasting(sim.ctx, p, meta);
    // Fireball is a projectile: its hit roll and damage now resolve on impact, not on
    // cast. The bolt homes on its (static) target, so step it directly until it lands
    // (a full sim.tick() would also let the level-60 mob kill the mage mid-flight,
    // fizzling the projectile before it arrives).
    for (let i = 0; i < 200 && sim.ctx.pendingProjectiles.length > 0; i++)
      advancePendingProjectiles(sim.ctx);

    const dmg = events.filter((e) => e.type === 'damage' && e.targetId === mob.id);
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every((e) => e.kind === 'resist')).toBe(true);
    expect(dmg.some((e) => e.kind === 'miss')).toBe(false);
    expect(dmg.every((e) => e.amount === 0)).toBe(true);
  });

  it('a physical ability (sunder) still emits kind:"miss" when avoided', () => {
    const { sim, p, meta } = makeSim('warrior', 12);
    const mob = spawnTarget(sim, p, 60, 2);
    sim.rng.chance = () => true; // meleeMissChance roll -> miss

    const events: any[] = [];
    sim.ctx.emit = (e: any) => events.push(e);

    castAbility(sim.ctx, 'sunder_armor', p.id);
    let n = 0;
    while (p.castingAbility && n++ < 1000) updateCasting(sim.ctx, p, meta);

    const dmg = events.filter((e) => e.type === 'damage' && e.targetId === mob.id);
    expect(dmg.some((e) => e.kind === 'miss')).toBe(true);
    expect(dmg.some((e) => e.kind === 'resist')).toBe(false);
  });
});
