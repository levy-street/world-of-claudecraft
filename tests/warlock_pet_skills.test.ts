import { describe, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { petRangedAttack, updatePet } from '../src/sim/pet/pet_ai';
import { tryUseWarlockPetSkill, useWarlockPetSkill } from '../src/sim/pet/warlock_pet_skills';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity } from '../src/sim/types';

type RigSim = Sim & { addEntity(entity: Entity): void };

function rig(petTemplateId = 'gloomshade'): {
  sim: RigSim;
  owner: Entity;
  pet: Entity;
  target: Entity;
} {
  const sim = new Sim({ seed: 97, playerClass: 'warlock', noPlayer: true }) as unknown as RigSim;
  const ownerId = sim.addPlayer('warlock', 'Owner');
  const owner = sim.entities.get(ownerId) as Entity;
  const petTemplate = MOBS[petTemplateId];
  if (!petTemplate) throw new Error(`Missing pet template ${petTemplateId}.`);
  const pet = createMob(9901, petTemplate, 20, {
    x: owner.pos.x,
    y: owner.pos.y,
    z: owner.pos.z + 1,
  });
  pet.ownerId = owner.id;
  pet.hostile = false;
  pet.petAutoSkill = true;
  const target = createMob(9902, MOBS.forest_wolf, 20, {
    x: pet.pos.x,
    y: pet.pos.y,
    z: pet.pos.z + 12,
  });
  target.hostile = true;
  target.maxHp = target.hp = 50_000;
  sim.addEntity(pet);
  sim.addEntity(target);
  return { sim, owner, pet, target };
}

describe('Warlock pet signature skills', () => {
  it('labels Emberkin Felbolt, drives its cast animation cue, and keeps AP-scaled damage', () => {
    const { sim, pet, target } = rig('emberkin');
    const ranged = MOBS.emberkin.petRanged;
    expect(ranged).toMatchObject({
      name: 'Felbolt',
      ability: 'emberkin_felbolt',
      school: 'fire',
    });

    if (!ranged) throw new Error('Emberkin is missing its ranged skill metadata.');
    petRangedAttack(sim.ctx, pet, target, ranged);
    const launch = sim.drainEvents() as Array<Record<string, unknown>>;
    expect(launch).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'projectile',
        ability: 'emberkin_felbolt',
      }),
    );

    let hit: Record<string, unknown> | undefined;
    for (let i = 0; i < 30 && !hit; i++) {
      hit = (sim.tick() as Array<Record<string, unknown>>).find(
        (event) => event.type === 'damage' && event.sourceId === pet.id,
      );
    }
    expect(hit).toMatchObject({ ability: 'Felbolt', school: 'fire' });
    expect(target.hp).toBeLessThan(target.maxHp);

    const baseHit = Number(hit?.amount ?? 0);
    const stronger = rig('emberkin');
    stronger.pet.attackPower += 140;
    const strongerRanged = MOBS.emberkin.petRanged;
    if (!strongerRanged) throw new Error('Emberkin is missing its ranged skill metadata.');
    petRangedAttack(stronger.sim.ctx, stronger.pet, stronger.target, strongerRanged);
    stronger.sim.drainEvents();
    let strongerHit: Record<string, unknown> | undefined;
    for (let i = 0; i < 30 && !strongerHit; i++) {
      strongerHit = (stronger.sim.tick() as Array<Record<string, unknown>>).find(
        (event) => event.type === 'damage' && event.sourceId === stronger.pet.id,
      );
    }
    expect(Number(strongerHit?.amount ?? 0)).toBeGreaterThan(baseHit);
  });

  it('gives Emberkin a commanded damage skill instead of a taunt', () => {
    const { sim, owner, pet, target } = rig('emberkin');
    owner.targetId = target.id;

    expect(MOBS.emberkin.petCanTaunt).toBe(false);
    expect(MOBS.emberkin.petRanged?.active).toEqual({ cooldown: 8 });
    expect(useWarlockPetSkill(sim.ctx, pet, target, petRangedAttack)).toBe(true);
    expect(pet.petSkillTimer).toBe(8);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'projectile',
        ability: 'emberkin_felbolt',
      }),
    );
  });

  it('only auto-casts a signature skill while its pet-bar autocast is armed', () => {
    const disabled = rig('emberkin');
    disabled.pet.petAutoSkill = false;
    expect(
      tryUseWarlockPetSkill(disabled.sim.ctx, disabled.pet, disabled.target, petRangedAttack),
    ).toBe(false);
    expect(disabled.pet.petSkillTimer).toBeUndefined();

    const enabled = rig('emberkin');
    enabled.pet.petAutoSkill = true;
    expect(
      tryUseWarlockPetSkill(enabled.sim.ctx, enabled.pet, enabled.target, petRangedAttack),
    ).toBe(true);
    expect(enabled.pet.petSkillTimer).toBe(8);
  });

  it.each([
    ['emberkin', 8, 'emberkin_felbolt'],
    ['gloomshade', 15, 'gloomshade_abyssal_chain'],
  ] as const)(
    'routes %s autocast through the real pet AI update',
    (templateId, cooldown, ability) => {
      const { sim, pet, target } = rig(templateId);
      pet.aggroTargetId = target.id;

      updatePet(sim.ctx, pet);

      expect(pet.petSkillTimer).toBe(cooldown);
      expect(sim.drainEvents()).toContainEqual(
        expect.objectContaining({ type: 'spellfx', sourceId: pet.id, ability }),
      );
    },
  );

  it('has Gloomshade pull a distant normal enemy with its own readable cooldown', () => {
    const { sim, pet, target } = rig();
    const before = dist2d(pet.pos, target.pos);

    expect(tryUseWarlockPetSkill(sim.ctx, pet, target, petRangedAttack)).toBe(true);
    expect(before).toBeGreaterThan(8);
    expect(dist2d(pet.pos, target.pos)).toBeCloseTo(2.8, 1);
    expect(pet.petSkillTimer).toBe(15);
    expect(sim.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'spellfx',
          fx: 'beam',
          ability: 'gloomshade_abyssal_chain',
        }),
        expect.objectContaining({
          type: 'spellfx',
          fx: 'tick',
          ability: 'gloomshade_abyssal_chain',
        }),
      ]),
    );

    target.pos.z = pet.pos.z + 12;
    target.prevPos = { ...target.pos };
    expect(tryUseWarlockPetSkill(sim.ctx, pet, target, petRangedAttack)).toBe(false);
    expect(dist2d(pet.pos, target.pos)).toBeCloseTo(12, 4);
  });

  it.each([
    [7.99, false],
    [8, false],
    [20, true],
    [20.01, false],
  ])('enforces the Abyssal Chain distance boundary at %s yards', (distance, expected) => {
    const { sim, pet, target } = rig();
    target.pos.z = pet.pos.z + distance;
    target.prevPos = { ...target.pos };
    vi.spyOn(sim.ctx, 'hasLineOfSight').mockReturnValue(true);

    expect(tryUseWarlockPetSkill(sim.ctx, pet, target, petRangedAttack)).toBe(expected);
  });

  it('becomes reusable after its independent 15 second cooldown expires', () => {
    const { sim, pet, target } = rig();
    expect(tryUseWarlockPetSkill(sim.ctx, pet, target, petRangedAttack)).toBe(true);

    for (let tick = 0; tick < 299; tick++) updatePet(sim.ctx, pet);
    expect(pet.petSkillTimer).toBeGreaterThan(0);
    updatePet(sim.ctx, pet);
    expect(pet.petSkillTimer).toBe(0);

    target.pos.z = pet.pos.z + 12;
    target.prevPos = { ...target.pos };
    expect(tryUseWarlockPetSkill(sim.ctx, pet, target, petRangedAttack)).toBe(true);
  });

  it('never lets Abyssal Chain move bosses or control-immune enemies', () => {
    const { sim, pet, target } = rig();
    const bossTemplate = Object.values(MOBS).find((template) => template.boss === true);
    if (!bossTemplate) throw new Error('The mob registry has no boss fixture.');
    target.templateId = bossTemplate.id;
    const bossPosition = { ...target.pos };

    expect(tryUseWarlockPetSkill(sim.ctx, pet, target, petRangedAttack)).toBe(false);
    expect(target.pos).toEqual(bossPosition);
    expect(pet.petSkillTimer).toBeUndefined();

    target.templateId = 'forest_wolf';
    target.ccImmune = true;
    expect(tryUseWarlockPetSkill(sim.ctx, pet, target, petRangedAttack)).toBe(false);
    expect(target.pos).toEqual(bossPosition);
  });

  it('rejects template-level control immunity, owned targets, and blocked line of sight', () => {
    const templateImmune = Object.values(MOBS).find(
      (template) => template.ccImmune === true && template.boss !== true,
    );
    if (!templateImmune) throw new Error('The mob registry has no non-boss CC-immune fixture.');

    const templateCase = rig();
    templateCase.target.templateId = templateImmune.id;
    expect(
      tryUseWarlockPetSkill(
        templateCase.sim.ctx,
        templateCase.pet,
        templateCase.target,
        petRangedAttack,
      ),
    ).toBe(false);

    const ownedCase = rig();
    ownedCase.target.ownerId = ownedCase.owner.id;
    expect(
      tryUseWarlockPetSkill(ownedCase.sim.ctx, ownedCase.pet, ownedCase.target, petRangedAttack),
    ).toBe(false);

    const losCase = rig();
    vi.spyOn(losCase.sim.ctx, 'hasLineOfSight').mockReturnValue(false);
    expect(
      tryUseWarlockPetSkill(losCase.sim.ctx, losCase.pet, losCase.target, petRangedAttack),
    ).toBe(false);
  });

  it('never pulls a player entity', () => {
    const { sim, pet, target } = rig();
    target.kind = 'player';
    const playerPosition = { ...target.pos };

    expect(tryUseWarlockPetSkill(sim.ctx, pet, target, petRangedAttack)).toBe(false);
    expect(target.pos).toEqual(playerPosition);
    expect(pet.petSkillTimer).toBeUndefined();
  });

  it('does not interrupt a normal enemy that is already evading back to its leash', () => {
    const { sim, pet, target } = rig();
    target.aiState = 'evade';
    const resetPosition = { ...target.pos };

    expect(tryUseWarlockPetSkill(sim.ctx, pet, target, petRangedAttack)).toBe(false);
    expect(target.pos).toEqual(resetPosition);
    expect(pet.petSkillTimer).toBeUndefined();
    expect(sim.drainEvents()).toEqual([]);
  });
});
