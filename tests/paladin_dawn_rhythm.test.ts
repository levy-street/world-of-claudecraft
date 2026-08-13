import { beforeAll, describe, expect, it } from 'vitest';
import {
  DAWN_RHYTHM_COOLDOWN_REDUCTION,
  triggerPaladinDawnRhythm,
} from '../src/sim/combat/paladin_dawn_rhythm';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

type TestSim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
};

function makeRetribution(): TestSim {
  const sim = new Sim({ seed: 8431, playerClass: 'paladin', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('retribution')).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function targetAt(sim: TestSim, distance: number, xOffset = 0): Entity {
  const target = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x + xOffset,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  target.maxHp = 50_000;
  target.hp = target.maxHp;
  target.hostile = true;
  target.aiState = 'idle';
  target.swingTimer = 999;
  sim.addEntity(target);
  return target;
}

function fullyShield(target: Entity, sourceId: number): void {
  target.auras.push({
    id: 'test_full_absorb',
    name: 'Test Full Absorb',
    kind: 'absorb',
    remaining: 10,
    duration: 10,
    value: 50_000,
    sourceId,
    school: 'holy',
  } satisfies Aura);
}

describe('Paladin Rhythm of Dawn', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  it('pins the two-second interaction in both player-facing ability descriptions', () => {
    expect(ABILITIES.final_edict.description).toContain(
      "reduces Dawnfall's remaining cooldown by 2 sec",
    );
    expect(ABILITIES.dawnfall.description).toContain(
      "reduces Final Edict's remaining cooldown by 2 sec",
    );
    expect(tEntity({ kind: 'ability', id: 'final_edict', field: 'description' })).toContain(
      "reduces Dawnfall's remaining cooldown by 2 sec",
    );
    expect(tEntity({ kind: 'ability', id: 'dawnfall', field: 'description' })).toContain(
      "reduces Final Edict's remaining cooldown by 2 sec",
    );
  });

  it('reduces only the paired running cooldown and never banks unused reduction', () => {
    const player = makeRetribution().player;
    player.cooldowns.set('dawnfall', 6);

    expect(triggerPaladinDawnRhythm(player, 'final_edict')).toBe(2);
    expect(player.cooldowns.get('dawnfall')).toBe(4);
    expect(triggerPaladinDawnRhythm(player, 'hammer_of_wrath')).toBe(0);
    expect(player.cooldowns.get('dawnfall')).toBe(4);

    player.cooldowns.set('final_edict', 1);
    expect(triggerPaladinDawnRhythm(player, 'dawnfall')).toBe(1);
    expect(player.cooldowns.has('final_edict')).toBe(false);
    expect(triggerPaladinDawnRhythm(player, 'dawnfall')).toBe(0);

    player.cooldowns.set('dawnfall', 2);
    expect(triggerPaladinDawnRhythm(player, 'final_edict')).toBe(2);
    expect(player.cooldowns.has('dawnfall')).toBe(false);
    expect(DAWN_RHYTHM_COOLDOWN_REDUCTION).toBe(2);
  });

  it("does not bank a reduction for either ability's next full cooldown", () => {
    const afterFinal = makeRetribution();
    const finalTarget = targetAt(afterFinal, 2);
    afterFinal.targetEntity(finalTarget.id);
    afterFinal.rng.next = () => 0.99;
    afterFinal.rng.chance = () => false;

    afterFinal.castAbility('final_edict');
    afterFinal.player.gcdRemaining = 0;
    afterFinal.castAbility('dawnfall');

    expect(afterFinal.player.cooldowns.get('dawnfall')).toBe(12);

    const afterDawnfall = makeRetribution();
    const dawnfallTarget = targetAt(afterDawnfall, 2);
    afterDawnfall.targetEntity(dawnfallTarget.id);
    afterDawnfall.rng.next = () => 0.99;
    afterDawnfall.rng.chance = () => false;

    afterDawnfall.castAbility('dawnfall');
    afterDawnfall.player.gcdRemaining = 0;
    afterDawnfall.castAbility('final_edict');

    expect(afterDawnfall.player.cooldowns.get('final_edict')).toBe(8);
  });

  it('lets a successful Final Edict hit reduce Dawnfall by two seconds', () => {
    const sim = makeRetribution();
    const target = targetAt(sim, 2);
    sim.targetEntity(target.id);
    sim.player.cooldowns.set('dawnfall', 6);
    sim.rng.next = () => 0.99;
    sim.rng.chance = () => false;

    sim.castAbility('final_edict');

    expect(target.hp).toBeLessThan(target.maxHp);
    expect(sim.player.cooldowns.get('dawnfall')).toBe(4);
  });

  it('does not reduce Dawnfall when Final Edict misses', () => {
    const sim = makeRetribution();
    const target = targetAt(sim, 2);
    sim.targetEntity(target.id);
    sim.player.cooldowns.set('dawnfall', 6);
    sim.rng.next = () => 0;

    sim.castAbility('final_edict');

    expect(target.hp).toBe(target.maxHp);
    expect(sim.player.cooldowns.get('dawnfall')).toBe(6);
  });

  it('counts a fully absorbed Final Edict as a hit without generating Devotion', () => {
    const sim = makeRetribution();
    const target = targetAt(sim, 2);
    fullyShield(target, target.id);
    sim.targetEntity(target.id);
    sim.player.cooldowns.set('dawnfall', 6);
    sim.rng.next = () => 0.99;
    sim.rng.chance = () => false;

    sim.castAbility('final_edict');

    expect(target.hp).toBe(target.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(0);
    expect(sim.player.cooldowns.get('dawnfall')).toBe(4);
  });

  it('reduces Final Edict once when Dawnfall hits several enemies', () => {
    const sim = makeRetribution();
    const first = targetAt(sim, 2);
    const second = targetAt(sim, 3, 1);
    sim.player.cooldowns.set('final_edict', 6);
    sim.rng.next = () => 0.5;

    sim.castAbility('dawnfall');

    expect(first.hp).toBeLessThan(first.maxHp);
    expect(second.hp).toBeLessThan(second.maxHp);
    expect(sim.player.cooldowns.get('final_edict')).toBe(4);
  });

  it('counts a fully absorbed Dawnfall as a hit without generating Devotion', () => {
    const sim = makeRetribution();
    const target = targetAt(sim, 2);
    fullyShield(target, target.id);
    sim.player.cooldowns.set('final_edict', 6);
    sim.rng.next = () => 0.5;

    sim.castAbility('dawnfall');

    expect(target.hp).toBe(target.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(0);
    expect(sim.player.cooldowns.get('final_edict')).toBe(4);
  });

  it('does not reduce Final Edict when Dawnfall hits no enemy', () => {
    const sim = makeRetribution();
    sim.player.cooldowns.set('final_edict', 6);

    sim.castAbility('dawnfall');

    expect(sim.player.cooldowns.get('final_edict')).toBe(6);
  });
});
