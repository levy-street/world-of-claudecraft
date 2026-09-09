import { describe, expect, it } from 'vitest';
import { DOCTRINE_AURA_ID, DOCTRINE_RANGE } from '../src/sim/combat/priest/doctrine';
import {
  applyScouringMercyRescueCopies,
  doctrineScouringMercyRescue,
  selectScouringMercyRescueRecipients,
} from '../src/sim/combat/priest/doctrine_rescue';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';

// Independent literals, not imported from doctrine_rescue.ts: the authored
// rescue-cleave budget (docs/design/class-balance-v042.md).
const EXPECTED_RESCUE_MAX_RECIPIENTS = 2;
const EXPECTED_RESCUE_RADIUS = 10;
const EXPECTED_RESCUE_FRACTION = 0.5;

function doctrinePriest(seed: number): { sim: Sim; priest: Entity; ctx: SimContext } {
  const sim = new Sim({ seed, playerClass: 'priest', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('discipline')).toBe(true);
  sim.tick();
  sim.player.resource = sim.player.maxResource;
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  return { sim, priest: sim.player, ctx };
}

function addPartyAlly(sim: Sim, priest: Entity, name: string, dx: number, dz: number): Entity {
  const id = sim.addPlayer('warrior', name);
  sim.setPlayerLevel(20, id);
  const ally = sim.entities.get(id);
  if (!ally) throw new Error('ally missing');
  ally.pos.x = priest.pos.x + dx;
  ally.pos.z = priest.pos.z + dz;
  ally.pos.y = priest.pos.y;
  sim.partyInvite(id, priest.id);
  sim.partyAccept(id);
  return ally;
}

function castOn(sim: Sim, caster: Entity, target: Entity, abilityId: string): void {
  caster.gcdRemaining = 0;
  caster.resource = caster.maxResource;
  caster.cooldowns.delete(abilityId);
  sim.targetEntity(target.id, caster.id);
  sim.castAbility(abilityId, caster.id);
  sim.tick();
}

describe('v0.42.0 Doctrine: Scouring Mercy rescue cleave, recipient selection', () => {
  it('selects up to two OTHER injured party allies within 10 yards of the primary, nearest-to-death first', () => {
    const { sim, priest, ctx } = doctrinePriest(50501);
    const primary = addPartyAlly(sim, priest, 'Primary', 4, 0);
    const worst = addPartyAlly(sim, priest, 'Worst', 5, 0);
    const mid = addPartyAlly(sim, priest, 'Mid', 3, 0);
    const best = addPartyAlly(sim, priest, 'Best', 4, 4);
    primary.hp = primary.maxHp; // healed by the primary cast already, not a candidate anyway
    worst.hp = Math.floor(worst.maxHp * 0.2);
    mid.hp = Math.floor(mid.maxHp * 0.5);
    best.hp = Math.floor(best.maxHp * 0.9);

    const recipients = selectScouringMercyRescueRecipients(ctx, priest, primary);

    expect(recipients).toHaveLength(EXPECTED_RESCUE_MAX_RECIPIENTS);
    expect(recipients[0]).toBe(worst);
    expect(recipients[1]).toBe(mid);
    expect(recipients).not.toContain(best);
    expect(recipients).not.toContain(primary);
  });

  it('breaks a missing-health-fraction tie by stable entity id', () => {
    const { sim, priest, ctx } = doctrinePriest(50502);
    const primary = addPartyAlly(sim, priest, 'Primary', 0, 0);
    const higherId = addPartyAlly(sim, priest, 'HigherId', 2, 0);
    const lowerId = addPartyAlly(sim, priest, 'LowerId', -2, 0);
    higherId.hp = lowerId.hp = Math.floor(higherId.maxHp * 0.5);

    const recipients = selectScouringMercyRescueRecipients(ctx, priest, primary, 10, 1);

    expect(recipients).toHaveLength(1);
    expect(recipients[0].id).toBe(Math.min(higherId.id, lowerId.id));
  });

  it('excludes a full-health ally', () => {
    const { sim, priest, ctx } = doctrinePriest(50503);
    const primary = addPartyAlly(sim, priest, 'Primary', 0, 0);
    const full = addPartyAlly(sim, priest, 'Full', 2, 0);
    full.hp = full.maxHp;

    expect(selectScouringMercyRescueRecipients(ctx, priest, primary)).toHaveLength(0);
  });

  it('includes an ally exactly at the 10-yard boundary and excludes one just outside it', () => {
    const { sim, priest, ctx } = doctrinePriest(50504);
    const primary = addPartyAlly(sim, priest, 'Primary', 0, 0);
    const atBoundary = addPartyAlly(sim, priest, 'AtBoundary', EXPECTED_RESCUE_RADIUS, 0);
    const justOutside = addPartyAlly(sim, priest, 'JustOutside', EXPECTED_RESCUE_RADIUS + 0.5, 0);
    atBoundary.hp = Math.floor(atBoundary.maxHp * 0.5);
    justOutside.hp = Math.floor(justOutside.maxHp * 0.5);

    const recipients = selectScouringMercyRescueRecipients(ctx, priest, primary);

    expect(recipients).toContain(atBoundary);
    expect(recipients).not.toContain(justOutside);
  });

  it('excludes a living player who is not in the priest current group', () => {
    const { sim, priest, ctx } = doctrinePriest(50505);
    const primary = addPartyAlly(sim, priest, 'Primary', 0, 0);
    const strangerId = sim.addPlayer('warrior', 'Stranger');
    sim.setPlayerLevel(20, strangerId);
    const stranger = sim.entities.get(strangerId);
    if (!stranger) throw new Error('stranger missing');
    stranger.pos.x = priest.pos.x + 2;
    stranger.pos.z = priest.pos.z;
    stranger.hp = Math.floor(stranger.maxHp * 0.3);
    // Deliberately never partied with the priest.

    expect(selectScouringMercyRescueRecipients(ctx, priest, primary)).not.toContain(stranger);
  });

  it('excludes a dead ally', () => {
    const { sim, priest, ctx } = doctrinePriest(50506);
    const primary = addPartyAlly(sim, priest, 'Primary', 0, 0);
    const dead = addPartyAlly(sim, priest, 'Dead', 2, 0);
    dead.hp = 1;
    dead.dead = true;

    expect(selectScouringMercyRescueRecipients(ctx, priest, primary)).not.toContain(dead);
  });

  it('excludes a candidate the priest itself cannot see, even though it is within radius of the primary', () => {
    const { sim, priest, ctx } = doctrinePriest(50514);
    const primary = addPartyAlly(sim, priest, 'Primary', 4, 0);
    const blocked = addPartyAlly(sim, priest, 'Blocked', 3, 0);
    const visible = addPartyAlly(sim, priest, 'Visible', 5, 0);
    blocked.hp = Math.floor(blocked.maxHp * 0.5);
    visible.hp = Math.floor(visible.maxHp * 0.5);
    const realLos = ctx.hasLineOfSight;
    ctx.hasLineOfSight = (source, target) =>
      target.id === blocked.id ? false : realLos(source, target);

    const recipients = selectScouringMercyRescueRecipients(ctx, priest, primary);

    expect(recipients).toContain(visible);
    expect(recipients).not.toContain(blocked);
  });
});

describe('v0.42.0 Doctrine: Scouring Mercy rescue cleave, copy application', () => {
  it('heals each recipient for exactly 50% of the effective primary heal, noncrit', () => {
    const { sim, priest, ctx } = doctrinePriest(50507);
    const a = addPartyAlly(sim, priest, 'A', 2, 0);
    const b = addPartyAlly(sim, priest, 'B', -2, 0);
    a.hp = Math.floor(a.maxHp * 0.5);
    b.hp = Math.floor(b.maxHp * 0.5);
    const aBefore = a.hp;
    const bBefore = b.hp;
    sim.drainEvents();

    applyScouringMercyRescueCopies(ctx, priest, [a, b], 200);

    const expected = Math.max(1, Math.round(200 * EXPECTED_RESCUE_FRACTION));
    expect(a.hp - aBefore).toBe(expected);
    expect(b.hp - bBefore).toBe(expected);
    const heals = sim
      .drainEvents()
      .filter((event) => event.type === 'heal2' && event.ability === 'Scouring Mercy');
    expect(heals).toHaveLength(2);
    for (const heal of heals) {
      expect(heal.type === 'heal2' ? heal.crit : undefined).toBe(false);
    }
  });

  it('produces no copies when effectiveHeal is zero or negative', () => {
    const { sim, priest, ctx } = doctrinePriest(50508);
    const a = addPartyAlly(sim, priest, 'A', 2, 0);
    a.hp = Math.floor(a.maxHp * 0.5);
    const before = a.hp;

    applyScouringMercyRescueCopies(ctx, priest, [a], 0);

    expect(a.hp).toBe(before);
  });

  it('applies the target-side incoming-heal multiplier to a copy exactly once', () => {
    const { sim, priest, ctx } = doctrinePriest(50509);
    const a = addPartyAlly(sim, priest, 'A', 2, 0);
    a.hp = Math.floor(a.maxHp * 0.5);
    a.auras.push({
      id: 'test_mortal_wound',
      name: 'Mortal Wound',
      kind: 'mortal_wound',
      remaining: 30,
      duration: 30,
      value: 0.5, // halves incoming healing on the TARGET side
      sourceId: priest.id,
      school: 'physical',
    });
    const before = a.hp;

    applyScouringMercyRescueCopies(ctx, priest, [a], 100);

    // 50% of 100 = 50, halved once by the target-side debuff = 25. If it were
    // applied twice (or folded into a source-side path too) this would be
    // 12 or 13; if never applied it would be 50.
    expect(a.hp - before).toBe(25);
  });

  it.each([0.5, 1])(
    'does not force a tiny reduced rescue copy above zero (reduction %s)',
    (reduction) => {
      const { sim, priest, ctx } = doctrinePriest(50520);
      const ally = addPartyAlly(sim, priest, 'Reduced', 2, 0);
      ally.hp = Math.floor(ally.maxHp * 0.5);
      ally.auras.push({
        id: 'test_mortal_wound',
        name: 'Mortal Wound',
        kind: 'mortal_wound',
        remaining: 30,
        duration: 30,
        value: reduction,
        sourceId: priest.id,
        school: 'physical',
      });
      const before = ally.hp;
      applyScouringMercyRescueCopies(ctx, priest, [ally], 1);
      expect(ally.hp).toBe(before);
    },
  );

  it('does not apply a source-side healing bonus on the priest to a copy', () => {
    const { sim, priest, ctx } = doctrinePriest(50515);
    const a = addPartyAlly(sim, priest, 'A', 2, 0);
    a.hp = Math.floor(a.maxHp * 0.5);
    priest.auras.push({
      id: 'test_source_heal_bonus',
      name: 'Source Heal Bonus',
      kind: 'buff_heal_done',
      remaining: 30,
      duration: 30,
      value: 1, // +100% outgoing healing, SOURCE side, must not touch a copy
      sourceId: priest.id,
      school: 'holy',
    });
    const before = a.hp;

    applyScouringMercyRescueCopies(ctx, priest, [a], 100);

    expect(a.hp - before).toBe(Math.max(1, Math.round(100 * EXPECTED_RESCUE_FRACTION)));
  });

  it('still drains a healing absorb on the recipient', () => {
    const { sim, priest, ctx } = doctrinePriest(50516);
    const a = addPartyAlly(sim, priest, 'A', 2, 0);
    a.hp = Math.floor(a.maxHp * 0.5);
    a.auras.push({
      id: 'test_heal_absorb',
      name: 'Necrotic Blight',
      kind: 'heal_absorb',
      remaining: 30,
      duration: 30,
      value: 30,
      sourceId: 999,
      school: 'shadow',
    });
    const before = a.hp;

    applyScouringMercyRescueCopies(ctx, priest, [a], 100);

    const expected = Math.max(1, Math.round(100 * EXPECTED_RESCUE_FRACTION)) - 30;
    expect(a.hp - before).toBe(expected);
    expect(a.auras.some((aura) => aura.kind === 'heal_absorb')).toBe(false);
  });

  it('creates no new Doctrine link on the recipient', () => {
    const { sim, priest, ctx } = doctrinePriest(50517);
    const a = addPartyAlly(sim, priest, 'A', 2, 0);
    a.hp = Math.floor(a.maxHp * 0.5);

    applyScouringMercyRescueCopies(ctx, priest, [a], 100);

    expect(a.auras.some((aura) => aura.id === DOCTRINE_AURA_ID)).toBe(false);
  });
});

describe('v0.42.0 Doctrine: Scouring Mercy rescue cleave, end-to-end helper', () => {
  it('heals the primary plus up to two nearby injured allies, capping at three total recipients', () => {
    const { sim, priest, ctx } = doctrinePriest(50510);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addPartyAlly(sim, priest, 'Primary', 4, 0);
    const first = addPartyAlly(sim, priest, 'First', 3, 0);
    const second = addPartyAlly(sim, priest, 'Second', 5, 0);
    const third = addPartyAlly(sim, priest, 'Third', 4, 2);
    for (const ally of [first, second, third]) ally.hp = Math.floor(ally.maxHp * 0.5);
    const firstBefore = first.hp;
    const secondBefore = second.hp;
    const thirdBefore = third.hp;

    doctrineScouringMercyRescue(ctx, priest, meta, primary, 150);

    const healedCount = [first, second, third].filter((ally, index) => {
      const before = [firstBefore, secondBefore, thirdBefore][index];
      return ally.hp > before;
    }).length;
    expect(healedCount).toBe(EXPECTED_RESCUE_MAX_RECIPIENTS);
  });

  it('is inert for a non-Discipline priest', () => {
    const { sim, priest, ctx } = doctrinePriest(50511);
    expect(sim.setSpec('holy')).toBe(true);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addPartyAlly(sim, priest, 'Primary', 4, 0);
    const ally = addPartyAlly(sim, priest, 'Ally', 3, 0);
    ally.hp = Math.floor(ally.maxHp * 0.5);
    const before = ally.hp;

    doctrineScouringMercyRescue(ctx, priest, meta, primary, 150);

    expect(ally.hp).toBe(before);
  });

  it('produces no rescue copies for a fully overhealed primary', () => {
    const { sim, priest, ctx } = doctrinePriest(50512);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addPartyAlly(sim, priest, 'Primary', 4, 0);
    const ally = addPartyAlly(sim, priest, 'Ally', 3, 0);
    ally.hp = Math.floor(ally.maxHp * 0.5);
    const before = ally.hp;

    doctrineScouringMercyRescue(ctx, priest, meta, primary, 0);

    expect(ally.hp).toBe(before);
  });

  it('is inert when the primary is not a living friendly group member', () => {
    const { sim, priest, ctx } = doctrinePriest(50518);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const strangerId = sim.addPlayer('warrior', 'Stranger Primary');
    sim.setPlayerLevel(20, strangerId);
    const stranger = sim.entities.get(strangerId);
    if (!stranger) throw new Error('stranger missing');
    stranger.pos.x = priest.pos.x + 4;
    stranger.pos.z = priest.pos.z;
    // Deliberately never partied with the priest.
    const ally = addPartyAlly(sim, priest, 'Ally', 3, 0);
    ally.hp = Math.floor(ally.maxHp * 0.5);
    const before = ally.hp;

    doctrineScouringMercyRescue(ctx, priest, meta, stranger, 150);

    expect(ally.hp).toBe(before);
  });

  it('is inert when the primary is outside Psalm reach of the priest', () => {
    const { sim, priest, ctx } = doctrinePriest(50519);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const farPrimary = addPartyAlly(sim, priest, 'Far Primary', DOCTRINE_RANGE + 5, 0);
    const ally = addPartyAlly(sim, priest, 'Ally', DOCTRINE_RANGE + 5, 3);
    ally.hp = Math.floor(ally.maxHp * 0.5);
    const before = ally.hp;

    doctrineScouringMercyRescue(ctx, priest, meta, farPrimary, 150);

    expect(ally.hp).toBe(before);
  });
});

describe('v0.42.0 Doctrine: Scouring Mercy rescue cleave, effect_dispatch.ts integration', () => {
  it('a real friendly Scouring Mercy cast also heals a nearby injured party ally', () => {
    const { sim, priest } = doctrinePriest(50513);
    const primary = addPartyAlly(sim, priest, 'Primary', 4, 0);
    const nearby = addPartyAlly(sim, priest, 'Nearby', 5, 0);
    primary.hp = Math.floor(primary.maxHp * 0.5);
    nearby.hp = Math.floor(nearby.maxHp * 0.5);
    const nearbyBefore = nearby.hp;

    castOn(sim, priest, primary, 'scouring_mercy');

    expect(nearby.hp).toBeGreaterThan(nearbyBefore);
  });
});
