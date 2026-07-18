// Temporal Acceleration (the Chronomancer's Bloodlust) + the shared full-haste /
// exhaustion rework of the group haste burst. Verifies FULL haste (attack + cast +
// channel), the shared `sated` exhaustion that stops chaining, group/raid scope, and
// that the base flagless form (Wildfang Rally) stays attack-only with no exhaustion.
import { describe, expect, it } from 'vitest';
import { spellHasteMult } from '../src/sim/combat/spell_combat';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const TA = 'temporal_acceleration';

function chronoMage(): { sim: Sim; p: Entity } {
  const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function addAlly(sim: Sim, name: string, dx: number): Entity {
  const p = sim.player;
  const id = sim.addPlayer('warrior', name);
  const e = sim.entities.get(id)!;
  e.pos = { x: p.pos.x + dx, y: p.pos.y, z: p.pos.z };
  e.prevPos = { ...e.pos };
  return e;
}

function grouped(sim: Sim, leader: number, members: number[]): void {
  for (const m of members) {
    sim.partyInvite(m, leader);
    sim.partyAccept(m);
  }
}

const hasteVal = (e: Entity, kind: string) => e.auras.find((a) => a.kind === kind)?.value ?? null;
const isSated = (e: Entity) => e.auras.some((a) => a.kind === 'sated');

describe('Temporal Acceleration: definition', () => {
  it('is an instant, no-target, 5-min base arcane cooldown at +30% for 15s over 40yd', () => {
    const def = ABILITIES[TA];
    expect(def.castTime).toBe(0);
    expect(def.requiresTarget).toBe(false);
    expect(def.cooldown).toBe(300);
    expect(def.specs).toContain('arcane');
    const eff = def.effects.find((e) => e.type === 'aoeAllyHaste');
    expect(eff && 'mult' in eff ? eff.mult : 0).toBe(1.3);
    expect(eff && 'duration' in eff ? eff.duration : 0).toBe(15);
    expect(eff && 'radius' in eff ? eff.radius : 0).toBe(40);
    expect(eff && 'spell' in eff ? eff.spell : false).toBe(true);
    expect(eff && 'exhaust' in eff ? eff.exhaust : false).toBe(true);
  });
});

describe('Temporal Acceleration: full haste', () => {
  it('grants attack AND spell/channel haste (+30%) to the group', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'A', 3);
    grouped(sim, p.id, [ally.id]);
    sim.castAbility(TA);
    sim.tick();
    for (const e of [p, ally]) {
      // Attack speed: buff_haste value is the multiplier (1.3 => 30% faster swings).
      expect(hasteVal(e, 'buff_haste')).toBe(1.3);
      // Spell/channel haste: buff_spellhaste value is the additive bonus (0.3).
      expect(hasteVal(e, 'buff_spellhaste')).toBeCloseTo(0.3, 6);
      // The stat readers reflect it: casts and channels run at 1.3x, swings faster.
      expect(spellHasteMult(e)).toBeCloseTo(1.3, 6);
      expect(
        (sim as unknown as { swingIntervalMult(x: Entity): number }).swingIntervalMult(e),
      ).toBeCloseTo(1 / 1.3, 6);
    }
  });
});

describe('Temporal Acceleration: shared exhaustion', () => {
  it('applies the sated debuff and refuses to re-buff an already-sated ally', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'A', 3);
    grouped(sim, p.id, [ally.id]);
    sim.castAbility(TA);
    sim.tick();
    expect(isSated(ally)).toBe(true);
    // Strip the haste but keep sated, then re-cast: the buff must NOT re-apply.
    ally.auras = ally.auras.filter((a) => a.kind !== 'buff_haste' && a.kind !== 'buff_spellhaste');
    p.cooldowns.delete(TA);
    p.resource = p.maxResource;
    sim.castAbility(TA);
    sim.tick();
    expect(hasteVal(ally, 'buff_haste')).toBeNull(); // still exhausted, no re-benefit
  });

  it('is shared with Bloodlust: War Drums now uses the same full-haste + exhaustion', () => {
    // Bloodlust was converted to the shared effect: full haste (spell) + the same
    // exhaustion (exhaust) as Temporal Acceleration, so the two can never be chained.
    const bl = ABILITIES.bloodlust;
    const eff = bl.effects.find((e) => e.type === 'aoeAllyHaste');
    expect(eff && 'spell' in eff ? eff.spell : false).toBe(true);
    expect(eff && 'exhaust' in eff ? eff.exhaust : false).toBe(true);

    // A group already sated by Bloodlust gets nothing from a following Temporal
    // Acceleration (the sated KIND is shared, not per-ability).
    const { sim, p } = chronoMage();
    p.auras.push({
      id: 'sated',
      name: 'Temporal Exhaustion',
      kind: 'sated',
      value: 0,
      remaining: 300,
      duration: 300,
      sourceId: p.id,
      school: 'nature',
    });
    sim.castAbility(TA);
    sim.tick();
    expect(hasteVal(p, 'buff_haste')).toBeNull(); // already exhausted by Bloodlust
  });
});

describe('Temporal Acceleration: scope', () => {
  it('only buffs the group/raid, never an external friendly in range', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'A', 3);
    grouped(sim, p.id, [ally.id]);
    const outsider = addAlly(sim, 'Out', 2); // in range but NOT grouped
    sim.castAbility(TA);
    sim.tick();
    expect(hasteVal(ally, 'buff_haste')).toBe(1.3);
    expect(hasteVal(outsider, 'buff_haste')).toBeNull();
    expect(isSated(outsider)).toBe(false);
  });
});

describe('Wildfang Rally stays attack-only (no full haste, no exhaustion)', () => {
  it('keeps the base aoeAllyHaste form: no spell haste, no exhaustion, no group gate', () => {
    // The ported warrior redesign removed Red Banner (the old flagless exemplar), so
    // the surviving base-form user is the hunter's Wildfang Rally (aspect_of_the_wild):
    // it reuses aoeAllyHaste WITHOUT the new flags, so the dispatch applies only
    // buff_haste (attack speed), never buff_spellhaste or the sated debuff, and
    // still fans out to every friendly in radius (not group-scoped).
    const eff = ABILITIES.aspect_of_the_wild.effects.find((e) => e.type === 'aoeAllyHaste');
    expect(eff).toBeTruthy();
    expect(eff && 'mult' in eff ? eff.mult : 0).toBe(1.05);
    expect(eff && 'spell' in eff ? eff.spell : undefined).toBeUndefined();
    expect(eff && 'exhaust' in eff ? eff.exhaust : undefined).toBeUndefined();
    expect(eff && 'groupOnly' in eff ? eff.groupOnly : undefined).toBeUndefined();
  });
});
