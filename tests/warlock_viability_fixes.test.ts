import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type Spec = 'affliction' | 'demonology' | 'destruction';

function knownIds(spec: Spec, level: number): string[] {
  const mods = computeTalentModifiers('warlock', {
    ...emptyAllocation(),
    spec,
  } as never);
  return abilitiesKnownAt('warlock', level, mods).map((known) => known.def.id);
}

function knownEffects(spec: Spec, level: number, abilityId: string) {
  const mods = computeTalentModifiers('warlock', {
    ...emptyAllocation(),
    spec,
  } as never);
  const known = abilitiesKnownAt('warlock', level, mods).find(
    (entry) => entry.def.id === abilityId,
  );
  if (!known) throw new Error(`${abilityId} is not known by ${spec} at level ${level}`);
  return known.effects;
}

function rig(spec: Spec, rows: Record<number, string> = {}, level = 20) {
  const sim = new Sim({ seed: 73, playerClass: 'warlock', autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  sim.tick();
  const player = sim.player;
  player.resource = player.maxResource;
  return { sim, player };
}

function hostile(sim: Sim, id = 9931): Entity {
  const player = sim.player;
  const mob = createMob(id, MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 4,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 10_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

// Damage the player takes from one clean 100-point hit, with armor and the
// hit table out of the picture (dealDamage takes an already-resolved amount).
function hitForOneHundred(sim: Sim, mob: Entity): number {
  const player = sim.player;
  player.hp = player.maxHp;
  dealDamage(sim.ctx, mob, player, 100, false, 'shadow', null, 'hit');
  return player.maxHp - player.hp;
}

describe('Cinderhide, the Ruination defensive', () => {
  it('is a Destruction ability that arrives at level 8', () => {
    expect(knownIds('destruction', 8)).toContain('cinderhide');
    expect(knownIds('destruction', 7)).not.toContain('cinderhide');
  });

  it('never reaches the other two specializations', () => {
    expect(knownIds('affliction', 20)).not.toContain('cinderhide');
    expect(knownIds('demonology', 20)).not.toContain('cinderhide');
  });

  it('lands every specialization its defensive button at the same level', () => {
    expect(knownIds('demonology', 8)).toContain('bone_armor');
    expect(knownIds('destruction', 8)).toContain('cinderhide');
  });

  it('cuts incoming damage by 25% for 10 sec', () => {
    const { sim, player } = rig('destruction');
    const mob = hostile(sim);
    expect(hitForOneHundred(sim, mob)).toBe(100);

    sim.castAbility('cinderhide');
    sim.tick();
    const aura = player.auras.find((entry) => entry.id === 'cinderhide');
    expect(aura?.kind).toBe('buff_dr');
    expect(aura?.value).toBe(0.25);
    expect(aura?.duration).toBe(10);

    expect(hitForOneHundred(sim, mob)).toBe(75);
  });
});

describe('Litany of Guilt covers the early Hexcraft levels', () => {
  it('gives Hexcraft its first area damage at level 8', () => {
    expect(knownIds('affliction', 8)).toContain('litany_of_guilt');
    expect(knownIds('affliction', 7)).not.toContain('litany_of_guilt');
  });

  // These are the resolved in-game numbers: Hexcraft's specialization passive
  // adds 10% spell damage on top of the authored 5, 9 and 14.
  it('opens deliberately weak at rank 1', () => {
    const litany = knownEffects('affliction', 8, 'litany_of_guilt').find(
      (effect) => effect.type === 'afflictionLitany',
    );
    if (litany?.type !== 'afflictionLitany') throw new Error('missing rank 1 Litany');
    expect(litany.maxTargets).toBe(2);
    expect(litany.duration).toBe(6);
    expect(litany.damage).toBe(6);
  });

  it('preserves the values Litany already had at 11 and 20', () => {
    const rankTwo = knownEffects('affliction', 11, 'litany_of_guilt').find(
      (effect) => effect.type === 'afflictionLitany',
    );
    if (rankTwo?.type !== 'afflictionLitany') throw new Error('missing rank 2 Litany');
    expect(rankTwo.maxTargets).toBe(4);
    expect(rankTwo.duration).toBe(8);
    expect(rankTwo.damage).toBe(10);

    const rankThree = knownEffects('affliction', 20, 'litany_of_guilt').find(
      (effect) => effect.type === 'afflictionLitany',
    );
    if (rankThree?.type !== 'afflictionLitany') throw new Error('missing rank 3 Litany');
    expect(rankThree.damage).toBe(15);
  });
});
