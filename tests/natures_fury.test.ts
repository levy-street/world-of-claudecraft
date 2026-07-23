import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

// Nature's Fury (maintainer design, replacing Storm Refrain): while the druid
// is in Moonwing Form, they and their party members within 30 yd carry a 3%
// spell-crit aura. Out of form (or out of range) the aura lapses within its
// short refresh window. Also pins the Galeheart rename on the hurricane def.

function moonwingAura(sourceId: number): Aura {
  return {
    id: 'moonkin_form',
    name: 'Moonwing Form',
    kind: 'form_moonkin',
    remaining: 3600,
    duration: 3600,
    value: 0,
    sourceId,
    school: 'arcane',
  } as Aura;
}

function fury(e: Entity): Aura | undefined {
  return e.auras.find((aura) => aura.id === 'natures_fury');
}

function setup(): { sim: Sim; druid: Entity; allyEntity: Entity } {
  const sim = new Sim({ seed: 7, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: null, rows: { 20: 'dru_r20_improved_hurricane' } })).toBe(true);
  const druid = sim.player;
  const allyPid = sim.addPlayer('priest', 'FuryAlly');
  sim.partyInvite(allyPid, druid.id);
  sim.partyAccept(allyPid);
  const allyEntity = sim.entities.get(allyPid) as Entity;
  allyEntity.pos.x = druid.pos.x + 5;
  allyEntity.pos.z = druid.pos.z;
  return { sim, druid, allyEntity };
}

describe("Nature's Fury", () => {
  it('pulses 3% spell crit to the moonwing druid and nearby party members', () => {
    const { sim, druid, allyEntity } = setup();
    (sim as unknown as { applyAura(t: Entity, a: Aura): void }).applyAura(
      druid,
      moonwingAura(druid.id),
    );
    for (let i = 0; i < 40; i++) sim.tick(); // past the pulse cadence
    expect(fury(druid)?.kind).toBe('buff_spellcrit');
    expect(fury(druid)?.value).toBeCloseTo(0.03);
    expect(fury(allyEntity)?.value).toBeCloseTo(0.03);
  });

  it('requires Moonwing Form and lapses after leaving it', () => {
    const { sim, druid, allyEntity } = setup();
    for (let i = 0; i < 40; i++) sim.tick();
    expect(fury(druid)).toBeUndefined(); // talent alone, no form: nothing
    (sim as unknown as { applyAura(t: Entity, a: Aura): void }).applyAura(
      druid,
      moonwingAura(druid.id),
    );
    for (let i = 0; i < 40; i++) sim.tick();
    expect(fury(druid)).toBeDefined();
    druid.auras = druid.auras.filter((aura) => aura.kind !== 'form_moonkin');
    for (let i = 0; i < 90; i++) sim.tick(); // refresh window expires
    expect(fury(druid)).toBeUndefined();
    expect(fury(allyEntity)).toBeUndefined();
  });

  it('does not reach party members out of range', () => {
    const { sim, druid, allyEntity } = setup();
    allyEntity.pos.x = druid.pos.x + 80;
    (sim as unknown as { applyAura(t: Entity, a: Aura): void }).applyAura(
      druid,
      moonwingAura(druid.id),
    );
    for (let i = 0; i < 40; i++) sim.tick();
    expect(fury(druid)).toBeDefined();
    expect(fury(allyEntity)).toBeUndefined();
  });

  it('the hurricane ability reads Galeheart now', () => {
    const sim = new Sim({ seed: 7, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.resolvedAbility('hurricane')?.def.name).toBe('Galeheart');
  });

  it('does not re-announce a gained buff on every 1s refresh pulse', () => {
    const { sim, druid } = setup();
    (sim as unknown as { applyAura(t: Entity, a: Aura): void }).applyAura(
      druid,
      moonwingAura(druid.id),
    );
    let druidGainedCount = 0;
    // 4 seconds: long enough to cross several 1s refresh pulses (each pulse
    // carries a 3s window), while the druid stays in form the whole time. The
    // druid should only ever "gain" the buff once; later pulses just extend it.
    for (let i = 0; i < 80; i++) {
      for (const ev of sim.tick()) {
        if (
          ev.type === 'aura' &&
          ev.name === "Nature's Fury" &&
          ev.gained &&
          ev.targetId === druid.id
        )
          druidGainedCount++;
      }
    }
    expect(druidGainedCount).toBe(1);
    expect(fury(druid)?.remaining).toBeGreaterThan(0);
  });
});
