import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { ABILITIES, DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { type Entity, NYTHRAXIS_BOSS_ID } from '../src/sim/types';
import { abilityBuffValue } from '../src/ui/ability_damage';
import { hasExplicitAbilityIcon } from '../src/ui/icons';
import { placePlayerInOpenField } from './helpers/open_field';

const FORM_ID = 'fireball_form';

function mageWithSpec(spec: 'fire' | 'frost' | 'arcane', devCommands = false): Sim {
  const sim = new Sim({ seed: 73, playerClass: 'mage', autoEquip: true, devCommands });
  sim.setPlayerLevel(11);
  placePlayerInOpenField(sim);
  expect(sim.setSpec(spec)).toBe(true);
  sim.tick();
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function knownMageAbilities(spec: 'fire' | 'frost' | 'arcane'): string[] {
  const mods = computeTalentModifiers('mage', {
    ...emptyAllocation(),
    spec,
  } as never);
  return abilitiesKnownAt('mage', 11, mods).map((known) => known.def.id);
}

function activate(sim: Sim): void {
  sim.castAbility(FORM_ID);
  expect(sim.player.castingAbility).toBe(FORM_ID);
  for (let tick = 0; tick < 40; tick++) sim.tick();
  expect(sim.player.auras.some((aura) => aura.kind === 'form_fireball')).toBe(true);
}

describe('Mage Fireball Form', () => {
  it('is a general Mage ability learned by every specialization at level 11', () => {
    expect(abilitiesKnownAt('mage', 10).map((known) => known.def.id)).not.toContain(FORM_ID);
    for (const spec of ['fire', 'frost', 'arcane'] as const) {
      expect(knownMageAbilities(spec), spec).toContain(FORM_ID);
    }
    expect(ABILITIES[FORM_ID]).toMatchObject({
      class: 'mage',
      learnLevel: 11,
      requiresTarget: false,
    });
    expect(ABILITIES[FORM_ID].specs).toBeUndefined();
  });

  it('requires a real two-second cast before the transformation begins', () => {
    const sim = mageWithSpec('fire');

    sim.castAbility(FORM_ID);

    expect(ABILITIES[FORM_ID].castTime).toBe(2);
    expect(sim.player.castingAbility).toBe(FORM_ID);
    expect(sim.player.auras.some((aura) => aura.kind === 'form_fireball')).toBe(false);
    for (let tick = 0; tick < 39; tick++) sim.tick();
    expect(sim.player.castingAbility).toBe(FORM_ID);
    expect(sim.player.auras.some((aura) => aura.kind === 'form_fireball')).toBe(false);

    sim.tick();

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.auras.some((aura) => aura.kind === 'form_fireball')).toBe(true);
  });

  it('cannot be activated while the Mage is in combat', () => {
    const sim = mageWithSpec('fire');
    const resourceBefore = sim.player.resource;
    sim.player.inCombat = true;
    sim.drainEvents();

    sim.castAbility(FORM_ID);

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.auras.some((aura) => aura.kind === 'form_fireball')).toBe(false);
    expect(sim.player.resource).toBe(resourceBefore);
    expect(sim.player.cooldowns.has(FORM_ID)).toBe(false);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'error', text: "You can't do that while in combat." }),
    );
  });

  it.each([
    ['a dungeon', 'hollow_crypt'],
    ['a raid', 'nythraxis_crypt'],
  ] as const)('cannot be activated inside %s instance', (_label, dungeonId) => {
    const sim = mageWithSpec('fire');
    const resourceBefore = sim.player.resource;
    expect(sim.enterDungeon(dungeonId)).toBe(true);
    expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe(dungeonId);
    sim.drainEvents();

    sim.castAbility(FORM_ID);

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.auras.some((aura) => aura.kind === 'form_fireball')).toBe(false);
    expect(sim.player.resource).toBe(resourceBefore);
    expect(sim.player.cooldowns.has(FORM_ID)).toBe(false);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'Leave the dungeon first.' }),
    );
  });

  it('cancels its running cast when combat starts before the transformation completes', () => {
    const sim = mageWithSpec('fire');
    const resourceBefore = sim.player.resource;
    sim.castAbility(FORM_ID);
    expect(sim.player.castingAbility).toBe(FORM_ID);
    sim.drainEvents();

    sim.player.inCombat = true;
    const events = sim.tick();

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.auras.some((aura) => aura.kind === 'form_fireball')).toBe(false);
    expect(sim.player.resource).toBe(resourceBefore);
    expect(sim.player.cooldowns.has(FORM_ID)).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'castStop', entityId: sim.player.id, success: false }),
        expect.objectContaining({ type: 'error', text: "You can't do that while in combat." }),
      ]),
    );
  });

  it.each([
    ['a dungeon', 'hollow_crypt'],
    ['a raid', 'nythraxis_crypt'],
  ] as const)(
    'cancels its running cast when the Mage enters %s before completion',
    (_label, dungeonId) => {
      const sim = mageWithSpec('fire');
      const resourceBefore = sim.player.resource;
      sim.castAbility(FORM_ID);
      expect(sim.player.castingAbility).toBe(FORM_ID);
      sim.drainEvents();

      expect(sim.enterDungeon(dungeonId)).toBe(true);
      const events = sim.tick();

      expect(sim.player.castingAbility).toBeNull();
      expect(sim.player.auras.some((aura) => aura.kind === 'form_fireball')).toBe(false);
      expect(sim.player.resource).toBe(resourceBefore);
      expect(sim.player.cooldowns.has(FORM_ID)).toBe(false);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'castStop', entityId: sim.player.id, success: false }),
          expect.objectContaining({ type: 'error', text: 'Leave the dungeon first.' }),
        ]),
      );
    },
  );

  it('cannot be activated in the wide wings after the Nythraxis boss despawns', () => {
    const sim = mageWithSpec('fire', true);
    expect(enterDungeon(sim.ctx, 'nythraxis_boss_arena', sim.player.id, true)).toBe(true);
    const boss = [...sim.entities.values()].find(
      (entity) => entity.templateId === NYTHRAXIS_BOSS_ID,
    );
    expect(boss).toBeDefined();
    if (!boss) throw new Error('Nythraxis missing from the claimed raid');
    sim.entities.delete(boss.id);
    const origin = instanceOrigin(DUNGEONS.nythraxis_boss_arena.index, 0);
    sim.player.pos = { ...sim.player.pos, x: origin.x + 130, z: origin.z + 96 };
    sim.player.prevPos = { ...sim.player.pos };
    sim.drainEvents();

    sim.castAbility(FORM_ID);

    expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe('nythraxis_boss_arena');
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.auras.some((aura) => aura.kind === 'form_fireball')).toBe(false);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'Leave the dungeon first.' }),
    );
  });

  it('applies the canonical 40 percent movement bonus without dealing damage', () => {
    for (const spec of ['fire', 'frost', 'arcane'] as const) {
      const sim = mageWithSpec(spec);
      activate(sim);

      const aura = sim.player.auras.find((candidate) => candidate.kind === 'form_fireball');
      expect(aura, spec).toMatchObject({ id: FORM_ID, value: 1.4, sourceId: sim.player.id });
      expect(sim.moveSpeedMult(sim.player), spec).toBeCloseTo(1.4, 5);
      expect(
        sim.drainEvents().some((event) => event.type === 'damage'),
        spec,
      ).toBe(false);
    }
  });

  it('moves the Mage 40 percent faster through the real movement path', () => {
    const distanceOver = (transformed: boolean): number => {
      const sim = mageWithSpec('arcane');
      const player = sim.player;
      // Measure the speed ratio on empty ground: the town square is furnished.
      placePlayerInOpenField(sim);
      if (transformed) activate(sim);
      const meta = sim.meta(player.id);
      if (!meta) throw new Error('mage metadata missing');
      meta.moveInput = {
        forward: true,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
        jump: false,
      };
      const start = { x: player.pos.x, z: player.pos.z };
      for (let tick = 0; tick < 60; tick++) sim.tick();
      return Math.hypot(player.pos.x - start.x, player.pos.z - start.z);
    };

    const normal = distanceOver(false);
    const transformed = distanceOver(true);
    expect(normal).toBeGreaterThan(0);
    expect(transformed / normal).toBeCloseTo(1.4, 1);
  });

  it('prevents spell casts and auto-attacks while transformed', () => {
    const sim = mageWithSpec('frost');
    const player = sim.player;
    const target = createMob(93001, MOBS.training_dummy, 11, {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z + 4,
    });
    (sim as unknown as { addEntity(entity: Entity): void }).addEntity(target);
    sim.targetEntity(target.id);
    player.autoAttack = true;
    activate(sim);
    expect(player.autoAttack).toBe(false);
    player.gcdRemaining = 0;

    sim.castAbility('frostbolt');
    expect(player.castingAbility).toBeNull();
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'error', text: "You can't do that while shapeshifted." }),
    );

    sim.startAutoAttack();
    expect(player.autoAttack).toBe(false);
  });

  it('can still be toggled off after combat starts', () => {
    const sim = mageWithSpec('arcane');
    activate(sim);
    sim.player.gcdRemaining = 0;
    sim.player.inCombat = true;

    sim.castAbility(FORM_ID);

    expect(sim.player.auras.some((aura) => aura.kind === 'form_fireball')).toBe(false);
  });

  it.each([
    ['a dungeon', 'hollow_crypt'],
    ['a raid', 'nythraxis_crypt'],
  ] as const)('can still be toggled off inside %s', (_label, dungeonId) => {
    const sim = mageWithSpec('arcane');
    activate(sim);
    sim.player.gcdRemaining = 0;
    expect(sim.enterDungeon(dungeonId)).toBe(true);
    sim.drainEvents();

    sim.castAbility(FORM_ID);

    expect(sim.player.auras.some((aura) => aura.kind === 'form_fireball')).toBe(false);
    expect(
      sim
        .drainEvents()
        .some((event) => event.type === 'error' && event.text === 'Leave the dungeon first.'),
    ).toBe(false);
  });

  it('toggles off through its running cooldown and restores normal control and speed', () => {
    const sim = mageWithSpec('arcane');
    activate(sim);
    expect(sim.player.cooldowns.has(FORM_ID)).toBe(true);
    sim.player.gcdRemaining = 0;

    sim.castAbility(FORM_ID);

    expect(sim.player.auras.some((aura) => aura.kind === 'form_fireball')).toBe(false);
    expect(sim.moveSpeedMult(sim.player)).toBeCloseTo(1, 5);
    sim.player.gcdRemaining = 0;
    sim.castAbility('arcane_missiles');
    expect(
      sim.drainEvents().some((event) => event.type === 'error' && /shapeshifted/.test(event.text)),
    ).toBe(false);
  });

  it('has a deliberate procedural icon instead of using the fallback', () => {
    expect(hasExplicitAbilityIcon(FORM_ID)).toBe(true);
  });

  it('derives the tooltip movement percentage from the authoritative multiplier', () => {
    const resolved = mageWithSpec('fire').resolvedAbility(FORM_ID);
    if (!resolved) throw new Error('Fireball Form missing');
    expect(abilityBuffValue(resolved)).toBeCloseTo(40, 5);
    expect(ABILITIES[FORM_ID].description).toContain('$b%');
    expect(ABILITIES[FORM_ID].description).not.toContain('40%');
  });
});
