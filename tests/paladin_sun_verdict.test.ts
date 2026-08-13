import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import { fiestaDownEntity } from '../src/sim/social/fiesta';
import type { Aura, Entity } from '../src/sim/types';

function addHostile(sim: Sim, id: number, offsetX: number): Entity {
  const mob = createMob(id, MOBS.ridge_stalker, 20, {
    x: sim.player.pos.x + offsetX,
    y: sim.player.pos.y,
    z: sim.player.pos.z,
  });
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function setup(): { sim: Sim; marked: Entity; nearby: Entity } {
  const sim = new Sim({ seed: 2701, playerClass: 'paladin', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('retribution')).toBe(true);
  sim.rng.next = () => 0.5;
  const marked = addHostile(sim, 9701, 4.5);
  const nearby = addHostile(sim, 9702, 9);
  sim.targetEntity(marked.id);
  sim.castAbility('sun_gods_verdict');
  return { sim, marked, nearby };
}

function resolve(sim: Sim, id: string): ResolvedAbility {
  const ability = sim.resolvedAbility(id);
  if (!ability) throw new Error(`missing ability ${id}`);
  return ability;
}

function run(sim: Sim, target: Entity | null, abilityId: string): void {
  const meta = (sim as unknown as { players: Map<number, unknown> }).players.get(sim.playerId);
  (
    sim as unknown as {
      ctx: {
        runEffects(
          player: Entity,
          meta: unknown,
          target: Entity | null,
          ability: ResolvedAbility,
        ): void;
      };
    }
  ).ctx.runEffects(sim.player, meta, target, resolve(sim, abilityId));
}

function verdictAura(entity: Entity, sourceId: number): Aura | undefined {
  return entity.auras.find((aura) => aura.id === 'sun_gods_verdict' && aura.sourceId === sourceId);
}

describe('Verdict of the Sun God', () => {
  it('authors a 60-second Retribution cooldown that marks one enemy for three charges', () => {
    const { sim, marked } = setup();
    expect(resolve(sim, 'sun_gods_verdict').def).toMatchObject({
      name: 'Verdict of the Sun God',
      specs: ['retribution'],
      learnLevel: 17,
      cooldown: 60,
      range: 30,
      requiresTarget: true,
      offGcd: true,
      effects: [
        expect.objectContaining({
          type: 'sunGodVerdict',
          duration: 30,
          charges: 3,
          singleTargetMin: 360,
          singleTargetMax: 420,
          areaMin: 150,
          areaMax: 180,
          areaRadius: 8,
          areaSoftCap: 5,
          stunDuration: 1.5,
        }),
      ],
    });
    expect(verdictAura(marked, sim.player.id)).toMatchObject({
      kind: 'sun_verdict',
      value: 0,
      remaining: 30,
      duration: 30,
    });
    expect(sim.player.cooldowns.get('sun_gods_verdict')).toBe(60);
    const originalMark = verdictAura(marked, sim.player.id);
    sim.castAbility('sun_gods_verdict');
    expect(verdictAura(marked, sim.player.id)).toBe(originalMark);
    expect(sim.player.cooldowns.get('sun_gods_verdict')).toBe(60);
  });

  it("replaces only the casting Paladin's previous mark and preserves another Paladin's mark", () => {
    const sim = new Sim({ seed: 2702, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('retribution')).toBe(true);
    const secondId = sim.addPlayer('paladin', 'Second Sun Judge', { autoEquip: true });
    sim.setPlayerLevel(20, secondId);
    expect(sim.setSpec('retribution', secondId)).toBe(true);
    const second = sim.entities.get(secondId);
    if (!second) throw new Error('missing second Sun Judge');
    second.pos = { ...sim.player.pos };
    second.prevPos = { ...second.pos };
    (sim as unknown as { rebucket(entity: Entity): void }).rebucket(second);
    const firstTarget = addHostile(sim, 9704, 4.5);
    const replacementTarget = addHostile(sim, 9705, 6);

    sim.targetEntity(firstTarget.id);
    sim.castAbility('sun_gods_verdict');
    sim.targetEntity(firstTarget.id, secondId);
    sim.castAbility('sun_gods_verdict', secondId);
    expect(verdictAura(firstTarget, sim.player.id)).toBeDefined();
    expect(verdictAura(firstTarget, secondId)).toBeDefined();

    sim.player.cooldowns.delete('sun_gods_verdict');
    sim.targetEntity(replacementTarget.id);
    sim.castAbility('sun_gods_verdict');

    expect(verdictAura(firstTarget, sim.player.id)).toBeUndefined();
    expect(verdictAura(firstTarget, secondId)).toBeDefined();
    expect(verdictAura(replacementTarget, sim.player.id)).toBeDefined();
  });

  it('lets only the third hit choose the area verdict', () => {
    const { sim, marked, nearby } = setup();
    sim.drainEvents();

    run(sim, marked, 'final_edict');
    expect(verdictAura(marked, sim.player.id)?.value).toBe(1);
    run(sim, marked, 'final_edict');
    expect(verdictAura(marked, sim.player.id)?.value).toBe(2);

    run(sim, null, 'dawnfall');

    expect(verdictAura(marked, sim.player.id)).toMatchObject({ value: 3, stacks: 3 });
    const events = sim.drainEvents();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'damage',
        targetId: marked.id,
        ability: 'Verdict of the Sun God',
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'damage',
        targetId: nearby.id,
        ability: 'Verdict of the Sun God',
      }),
    );
    expect(marked.auras).toContainEqual(expect.objectContaining({ kind: 'stun', duration: 1.5 }));
    expect(nearby.auras).toContainEqual(expect.objectContaining({ kind: 'stun', duration: 1.5 }));
    for (let tick = 0; tick < 3; tick++) sim.tick();
    expect(verdictAura(marked, sim.player.id)?.value).toBe(3);
    sim.tick();
    expect(verdictAura(marked, sim.player.id)).toBeUndefined();
  });

  it('lets only the third hit choose the single-target verdict', () => {
    const { sim, marked, nearby } = setup();
    sim.drainEvents();

    run(sim, null, 'dawnfall');
    expect(verdictAura(marked, sim.player.id)?.value).toBe(1);
    run(sim, null, 'dawnfall');
    expect(verdictAura(marked, sim.player.id)?.value).toBe(2);

    run(sim, marked, 'final_edict');

    const verdictDamage = sim
      .drainEvents()
      .filter((event) => event.type === 'damage' && event.ability === 'Verdict of the Sun God');
    expect(verdictDamage).toHaveLength(1);
    expect(verdictDamage[0]).toMatchObject({ targetId: marked.id });
    expect(nearby.auras.some((aura) => aura.kind === 'stun')).toBe(false);
  });

  it.each([
    { sequence: ['final_edict', 'dawnfall', 'dawnfall'], expected: 'area' },
    { sequence: ['dawnfall', 'final_edict', 'final_edict'], expected: 'single' },
  ] as const)(
    'keeps the first two mixed charges neutral for the $expected verdict',
    ({ sequence, expected }) => {
      const { sim, marked, nearby } = setup();
      sim.drainEvents();

      for (const abilityId of sequence)
        run(sim, abilityId === 'final_edict' ? marked : null, abilityId);

      const verdictTargets = sim
        .drainEvents()
        .flatMap((event) =>
          event.type === 'damage' && event.ability === 'Verdict of the Sun God'
            ? [event.targetId]
            : [],
        );
      expect(verdictTargets).toContain(marked.id);
      expect(verdictTargets.includes(nearby.id)).toBe(expected === 'area');
    },
  );

  it('does not fill the verdict when Final Edict misses or Dawnfall misses the marked enemy', () => {
    const { sim, marked } = setup();
    sim.rng.next = () => 0;
    run(sim, marked, 'final_edict');
    expect(verdictAura(marked, sim.player.id)?.value).toBe(0);

    marked.pos.x = sim.player.pos.x + 7;
    run(sim, null, 'dawnfall');
    expect(verdictAura(marked, sim.player.id)?.value).toBe(0);
  });

  it('does not mark a target beyond the verdict range', () => {
    const sim = new Sim({ seed: 2701, playerClass: 'paladin', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('retribution')).toBe(true);
    const farTarget = addHostile(sim, 9703, 31);
    sim.targetEntity(farTarget.id);

    sim.castAbility('sun_gods_verdict');

    expect(verdictAura(farTarget, sim.player.id)).toBeUndefined();
    expect(sim.player.cooldowns.has('sun_gods_verdict')).toBe(false);
  });

  it('cannot detonate from a stale mark after reflected damage kills the paladin', () => {
    const { sim, marked } = setup();
    const mark = verdictAura(marked, sim.player.id);
    if (!mark) throw new Error('missing verdict mark');
    mark.value = 2;
    mark.stacks = 2;
    marked.auras.push({
      id: 'test_thorns',
      name: 'Test Thorns',
      kind: 'thorns',
      remaining: 30,
      duration: 30,
      value: 1_000_000,
      sourceId: marked.id,
      school: 'nature',
    });
    sim.drainEvents();

    run(sim, marked, 'final_edict');

    expect(sim.player.dead).toBe(true);
    expect(verdictAura(marked, sim.player.id)).toBeUndefined();
    expect(
      sim
        .drainEvents()
        .some((event) => event.type === 'damage' && event.ability === 'Verdict of the Sun God'),
    ).toBe(false);
  });

  it('cannot detonate from the stale mark removed when a terminal duel hit lands', () => {
    const sim = new Sim({ seed: 2701, playerClass: 'paladin', noPlayer: true });
    const casterId = sim.addPlayer('paladin', 'Sun Judge', { autoEquip: true });
    const opponentId = sim.addPlayer('warrior', 'Condemned', { autoEquip: true });
    sim.setPlayerLevel(20, casterId);
    sim.setPlayerLevel(20, opponentId);
    expect(sim.setSpec('retribution', casterId)).toBe(true);
    sim.rng.next = () => 0.5;
    const caster = sim.entities.get(casterId);
    const opponent = sim.entities.get(opponentId);
    if (!caster || !opponent) throw new Error('missing duel players');
    opponent.pos.x = caster.pos.x + 2;
    opponent.prevPos.x = opponent.pos.x;
    (sim as unknown as { rebucket(entity: Entity): void }).rebucket(opponent);
    sim.duelRequest(opponentId, casterId);
    sim.duelAccept(opponentId);
    for (let tick = 0; tick < 80 && sim.duelFor(casterId)?.state !== 'active'; tick++) sim.tick();
    expect(sim.duelFor(casterId)?.state).toBe('active');
    sim.targetEntity(opponentId, casterId);
    sim.castAbility('sun_gods_verdict', casterId);
    const mark = verdictAura(opponent, casterId);
    if (!mark) throw new Error('missing duel verdict mark');
    mark.value = 2;
    mark.stacks = 2;
    opponent.hp = 1;
    sim.drainEvents();

    sim.castAbility('final_edict', casterId);

    expect(opponent.hp).toBe(1);
    expect(sim.duelFor(casterId)).toBeNull();
    expect(verdictAura(opponent, casterId)).toBeUndefined();
    expect(
      sim
        .drainEvents()
        .some((event) => event.type === 'damage' && event.ability === 'Verdict of the Sun God'),
    ).toBe(false);
  });

  it('removes the judgment from its target when the casting paladin dies', () => {
    const { sim, marked } = setup();
    (
      sim as unknown as {
        dealDamage(
          source: Entity,
          target: Entity,
          amount: number,
          crit: boolean,
          school: Aura['school'],
          ability: string,
          kind: 'hit',
        ): void;
      }
    ).dealDamage(marked, sim.player, 1_000_000, false, 'holy', 'Test', 'hit');

    expect(sim.player.dead).toBe(true);
    expect(verdictAura(marked, sim.player.id)).toBeUndefined();
  });

  it('removes the judgment through the Fiesta and Yumi shared down path', () => {
    const { sim, marked } = setup();

    fiestaDownEntity(sim.ctx, sim.player, null);

    expect(sim.player.dead).toBe(true);
    expect(verdictAura(marked, sim.player.id)).toBeUndefined();
  });

  it('removes the judgment when the casting paladin leaves the world', () => {
    const { sim, marked } = setup();
    const casterId = sim.player.id;

    sim.removePlayer(casterId);

    expect(verdictAura(marked, casterId)).toBeUndefined();
  });
});
