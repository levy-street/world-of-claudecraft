import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assembleEventsFrame, serializeEventFragments } from '../server/event_frame';
import {
  consumeMendingCurrent,
  depositMendingCurrent,
  unleashMendingCurrent,
} from '../src/sim/combat/shaman_spiritmend';
import { SHAMAN_TALENT_IDS } from '../src/sim/combat/shaman_talents';
import {
  addThunderCharges,
  armPrimalMastery,
  thunderCharges,
} from '../src/sim/combat/shaman_thundercall';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';

function fixture(charges: number, reservoir = false, seed = 2804) {
  const sim = new Sim({ seed, playerClass: 'shaman', noPlayer: true });
  const id = sim.addPlayer('shaman', 'Presentation');
  sim.setPlayerLevel(20, id);
  expect(
    sim.applyTalents(
      { spec: 'elemental', rows: reservoir ? { 20: SHAMAN_TALENT_IDS.deepReservoir } : {} },
      id,
    ),
  ).toBe(true);
  const player = sim.entities.get(id);
  const meta = sim.ctx.players.get(id);
  if (!player || !meta) throw new Error('missing real Shaman fixture');
  player.pos = sim.groundPos(700, 0);
  player.prevPos = { ...player.pos };
  sim.ctx.rebucket(player);
  const target = createMob(90001, MOBS.training_dummy, 20, sim.groundPos(701, 0));
  target.hostile = true;
  target.hp = target.maxHp = 999999;
  sim.ctx.addEntity(target);
  sim.targetEntity(target.id, id);
  player.facing = Math.PI / 2;
  player.resource = player.maxResource;
  addThunderCharges(sim.ctx, player, charges);
  sim.drainEvents();
  return { sim, player, target, meta };
}

function castJolt(charges: number, reservoir = false, primal = false, seed = 2804) {
  const h = fixture(charges, reservoir, seed);
  if (primal) armPrimalMastery(h.sim.ctx, h.player);
  h.sim.drainEvents();
  const draws: number[] = [];
  h.sim.rng.setObserver((value) => draws.push(value));
  const manaBefore = h.player.resource;
  h.sim.castAbility('earth_shock', h.player.id);
  const events: SimEvent[] = h.sim.drainEvents();
  for (let i = 0; i < 20; i++) events.push(...h.sim.tick());
  h.sim.rng.setObserver(null);
  const damage = events.filter((e) => e.type === 'damage' && e.abilityId === 'earth_shock');
  return {
    ...h,
    events,
    mechanics: {
      manaSpent: manaBefore - h.player.resource,
      damage,
      drawCount: draws.length,
      drawHash: createHash('sha256').update(JSON.stringify(draws)).digest('hex'),
    },
  };
}

function ventEvents(events: readonly SimEvent[]) {
  return events.filter(
    (e) => e.type === 'spellfx' && e.ability === 'earth_shock' && e.fx === 'procSurge',
  );
}

function quake(charges: number, aimed: boolean, reservoir = false) {
  const h = fixture(charges, reservoir, 2806);
  h.player.castAim = aimed ? { ...h.player.pos } : null;
  const resolved = h.sim.resolvedAbility('earthquake', h.player.id);
  if (!resolved) throw new Error('missing resolved Faultwake');
  h.sim.ctx.runEffects(h.player, h.meta, null, resolved);
  const events = h.sim.drainEvents();
  return { ...h, events };
}

describe('authoritative Shaman presentation events', () => {
  it('preserves Cascading Mend healing and RNG while identifying the caster hop through the wire', () => {
    const h = fixture(0, false, 2810);
    expect(h.sim.setSpec('restoration', h.player.id)).toBe(true);
    const recipients = [
      h.sim.addPlayer('shaman', 'Relay'),
      h.sim.addPlayer('warrior', 'Recipient'),
    ];
    for (const [index, id] of recipients.entries()) {
      h.sim.setPlayerLevel(20, id);
      const ally = h.sim.entities.get(id);
      if (!ally) throw new Error('missing Cascading Mend recipient');
      ally.pos = h.sim.groundPos(704 + index * 8, 0);
      ally.prevPos = { ...ally.pos };
      ally.hp = 1;
      h.sim.ctx.rebucket(ally);
    }
    const first = h.sim.entities.get(recipients[0]);
    const resolved = h.sim.resolvedAbility('chain_heal', h.player.id);
    if (!first || !resolved) throw new Error('missing real Cascading Mend fixture');
    h.sim.drainEvents();
    const draws: number[] = [];
    h.sim.rng.setObserver((value) => draws.push(value));
    h.sim.ctx.runEffects(h.player, h.meta, first, resolved);
    h.sim.rng.setObserver(null);
    const events = h.sim.drainEvents();
    const cues = events.filter(
      (e): e is Extract<SimEvent, { type: 'spellfx' }> =>
        e.type === 'spellfx' && e.fx === 'chainHeal',
    );
    const heals = events.filter((e) => e.type === 'heal2');
    // Recorded against the real producer before adding presentation metadata.
    expect({
      heals,
      drawCount: draws.length,
      drawHash: createHash('sha256').update(JSON.stringify(draws)).digest('hex'),
    }).toEqual({
      drawCount: 4,
      drawHash: '439c3c0e0078a50b2b2c197c5965800c701a55f58ff0b9fd6e0c52d32be22457',
      heals: [
        {
          type: 'heal2',
          ability: 'Cascading Mend',
          sourceId: 1006,
          targetId: 1007,
          amount: 284,
          crit: true,
        },
        {
          type: 'heal2',
          ability: 'Cascading Mend',
          sourceId: 1006,
          targetId: 1008,
          amount: 95,
          crit: false,
        },
        {
          type: 'heal2',
          ability: 'Cascading Mend',
          sourceId: 1006,
          targetId: 1006,
          amount: 0,
          crit: false,
          overheal: 47,
        },
      ],
    });
    expect(cues.map((cue) => [cue.sourceId, cue.targetId, cue.level])).toEqual([
      [h.player.id, recipients[0], 0],
      [recipients[0], recipients[1], 1],
      [recipients[1], h.player.id, 2],
    ]);
    const client = bareClient(h.player.id, { playerClass: 'shaman' });
    (client as unknown as { onMessage(raw: string): void }).onMessage(
      assembleEventsFrame(serializeEventFragments(events)),
    );
    expect(client.drainEvents()).toEqual(events);
  });

  it('preserves the pre-metadata mana, damage and RNG draw trace', () => {
    // Recorded against the real producer before adding presentation metadata.
    expect([0, 4, 5].map((charges) => castJolt(charges).mechanics)).toEqual(
      [104, 104, 235].map((amount) => ({
        manaSpent: 55,
        drawCount: 3,
        drawHash: 'a7d2bdfaa49e48a3ed0c6eec172b89f161e7c973edf6c7a2df2a21c2212ac718',
        damage: [
          {
            type: 'damage',
            ability: 'Earthen Jolt',
            abilityId: 'earth_shock',
            sourceId: 1006,
            targetId: 90001,
            school: 'nature',
            kind: 'hit',
            amount,
            crit: false,
            absorbed: undefined,
          },
        ],
      })),
    );
  });
  it.each([0, 4, 5])('tags only an actual full Earthen Jolt spend (%i banked)', (charges) => {
    const h = castJolt(charges);
    expect(h.mechanics.damage).toHaveLength(1);
    expect(h.mechanics.damage[0]).toMatchObject({ kind: 'hit' });
    expect(ventEvents(h.events)).toHaveLength(charges === 5 ? 1 : 0);
    if (charges === 5)
      expect(ventEvents(h.events)[0]).toMatchObject({
        sourceId: h.player.id,
        targetId: h.target.id,
        level: 5,
      });
    expect(thunderCharges(h.player)).toBe(charges === 5 ? 0 : charges);
  });

  it('reports five spent after Deep Reservoir has already refilled two', () => {
    const h = castJolt(5, true);
    expect(thunderCharges(h.player)).toBe(2);
    expect(ventEvents(h.events)).toHaveLength(1);
    expect(ventEvents(h.events)[0]).toMatchObject({ level: 5 });
  });

  it('keeps the distinct Primal payoff and emits exactly one tagged full-bank payoff', () => {
    const h = castJolt(5, false, true);
    const all = h.events.filter((e) => e.type === 'spellfx' && e.fx === 'procSurge');
    expect(all).toHaveLength(2);
    expect(all.filter((e) => e.type === 'spellfx' && e.ability === undefined)).toHaveLength(1);
    expect(ventEvents(all)).toHaveLength(1);
  });

  it('does not spend or announce a vent when the projectile loses its recipient', () => {
    const h = fixture(5);
    h.sim.castAbility('earth_shock', h.player.id);
    h.target.dead = true;
    h.target.hp = 0;
    const events = h.sim.drainEvents();
    for (let i = 0; i < 20; i++) events.push(...h.sim.tick());
    expect(ventEvents(events)).toHaveLength(0);
    expect(thunderCharges(h.player)).toBe(5);
  });

  it('retains all five charges on a real resisted spell without a payoff cue', () => {
    const h = fixture(5);
    // Exercise a deterministic failed roll through the real projectile/resist
    // resolver; a level difference alone cannot guarantee a resist.
    h.sim.rng.next = () => 0.999999;
    h.sim.castAbility('earth_shock', h.player.id);
    const events = h.sim.drainEvents();
    for (let i = 0; i < 20; i++) events.push(...h.sim.tick());
    expect(events.filter((e) => e.type === 'damage' && e.ability === 'Earthen Jolt')).toEqual([
      expect.objectContaining({
        kind: 'resist',
        amount: 0,
        sourceId: h.player.id,
        targetId: h.target.id,
      }),
    ]);
    expect(ventEvents(events)).toHaveLength(0);
    expect(thunderCharges(h.player)).toBe(5);
  });

  it('marks only resolved Chain Lightning hops, keeping the launch distinct', () => {
    const h = fixture(0);
    for (const [id, x] of [
      [90002, 704],
      [90003, 707],
    ]) {
      const mob = createMob(id, MOBS.training_dummy, 20, h.sim.groundPos(x, 0));
      mob.hostile = true;
      mob.hp = mob.maxHp = 999999;
      h.sim.ctx.addEntity(mob);
    }
    h.sim.castAbility('chain_lightning', h.player.id);
    const events = h.sim.drainEvents();
    for (let i = 0; i < 80; i++) events.push(...h.sim.tick());
    const cues = events.filter(
      (e) => e.type === 'spellfx' && e.ability === 'chain_lightning' && e.fx === 'projectile',
    );
    expect(cues).toHaveLength(4);
    expect(cues[0]).toMatchObject({ sourceId: h.player.id, targetId: h.target.id });
    expect(cues[0]).not.toHaveProperty('level');
    expect(cues[0]).not.toHaveProperty('count');
    expect(cues.slice(1)).toEqual([
      expect.objectContaining({ sourceId: h.player.id, targetId: 90001, level: 0, count: 3 }),
      expect.objectContaining({ sourceId: 90001, targetId: 90002, level: 1, count: 3 }),
      expect.objectContaining({ sourceId: 90002, targetId: 90003, level: 2, count: 3 }),
    ]);
    expect(
      events
        .filter((e) => e.type === 'damage' && e.abilityId === 'chain_lightning')
        .map((e) => (e.type === 'damage' ? e.targetId : 0)),
    ).toEqual([90001, 90002, 90003]);
  });

  it.each([true, false])(
    'preserves the one Faultwake point cue through server JSON and ClientWorld (aimed=%s)',
    (aimed) => {
      for (const charges of [0, 4, 5]) {
        const h = quake(charges, aimed, charges === 5);
        const cues = h.events.filter(
          (e) => e.type === 'spellfxAt' && e.fx === 'nova' && e.ability === 'earthquake',
        );
        expect(cues).toHaveLength(1);
        const damageIndex = h.events.findIndex(
          (e) => e.type === 'damage' && e.ability === 'Faultwake',
        );
        expect(damageIndex).toBeGreaterThanOrEqual(0);
        expect(h.events.indexOf(cues[0])).toBeGreaterThan(damageIndex);
        expect(cues[0]).toMatchObject({
          sourceId: h.player.id,
          x: 700,
          z: 0,
          radius: 8,
          duration: 6,
        });
        if (charges === 5) expect(cues[0]).toHaveProperty('thunderSpent', 5);
        else expect(cues[0]).not.toHaveProperty('thunderSpent');
        expect(thunderCharges(h.player)).toBe(charges === 5 ? 2 : charges);
        expect(h.sim.ctx.groundAoEs).toHaveLength(1);
        expect(h.sim.ctx.groundAoEs[0]).toMatchObject({ radius: 8, remaining: 6, interval: 1.5 });
        const client = bareClient(h.player.id, { playerClass: 'shaman' });
        (client as unknown as { onMessage(raw: string): void }).onMessage(
          assembleEventsFrame(serializeEventFragments(cues)),
        );
        expect(client.drainEvents()).toEqual(cues);
      }
    },
  );

  it('keeps Lifespring Unleash and Mending Current tags distinct through the wire', () => {
    const h = fixture(0);
    expect(h.sim.setSpec('restoration', h.player.id)).toBe(true);
    const id = h.sim.addPlayer('warrior', 'Ally');
    h.sim.setPlayerLevel(20, id);
    const ally = h.sim.entities.get(id);
    if (!ally) throw new Error('missing ally');
    ally.hp = 1;
    const seedCurrent = () =>
      ally.auras.push({
        id: 'shaman_mending_current',
        name: 'Mending Current',
        kind: 'hot',
        value: 40,
        remaining: 12,
        duration: 12,
        sourceId: h.player.id,
        school: 'nature',
      });
    seedCurrent();
    h.sim.drainEvents();
    expect(unleashMendingCurrent(h.sim.ctx, h.player, ally)).toBeGreaterThan(0);
    const unleash = h.sim.drainEvents().filter((e) => e.type === 'spellfx' && e.fx === 'echoBurst');
    expect(unleash).toHaveLength(1);
    expect(unleash[0]).toMatchObject({
      ability: 'unleash_weapon',
      sourceId: h.player.id,
      targetId: ally.id,
    });
    seedCurrent();
    consumeMendingCurrent(h.sim.ctx, h.player, ally);
    const ordinary = h.sim
      .drainEvents()
      .filter((e) => e.type === 'spellfx' && e.fx === 'echoBurst');
    expect(ordinary).toHaveLength(1);
    expect(ordinary[0]).toMatchObject({
      ability: 'shaman_mending_current',
      sourceId: h.player.id,
      targetId: ally.id,
    });
    h.sim.drainEvents();
    const deposited = depositMendingCurrent(h.sim.ctx, h.player, ally, 40, 'tidecall');
    expect(deposited).toBeGreaterThan(0);
    const fills = h.sim.drainEvents().filter((e) => e.type === 'spellfx' && e.fx === 'wardBloom');
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({
      ability: 'shaman_mending_current',
      sourceId: h.player.id,
      targetId: ally.id,
    });
    const cues = [...unleash, ...ordinary, ...fills];
    const client = bareClient(h.player.id, { playerClass: 'shaman' });
    (client as unknown as { onMessage(raw: string): void }).onMessage(
      assembleEventsFrame(serializeEventFragments(cues)),
    );
    expect(client.drainEvents()).toEqual(cues);
  });
});
