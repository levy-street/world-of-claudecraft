// Chronomancy owner tuning (2026-07-12): the Chronoweave mastery gains a mana cushion,
// Cascada's echo window grows, Aether Darts fires a full-charge barrage, and a combat
// resurrection (Temporal Reversal) is added. docs/prd/mage-chronomancy.md.
import { describe, expect, it } from 'vitest';
import {
  ARCANE_SURGE_ID,
  aetherDartsChannelStart,
  aetherSurgeCastMult,
  aetherSurgeStacks,
} from '../src/sim/combat/chronomancy';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

function chronoMage(level = 20) {
  const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function free(p: Entity): boolean {
  const q = p as unknown as { castingAbility: string | null; gcdRemaining: number };
  return q.castingAbility == null && q.gcdRemaining <= 1e-6;
}

function addDummy(sim: Sim): Entity {
  const p = sim.player;
  const mob = createMob(9500, MOBS.training_dummy, 20, { x: p.pos.x, y: p.pos.y, z: p.pos.z + 5 });
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000_000;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  return mob;
}

describe('Chronoweave mastery: healing + mana cushion', () => {
  it('grants +15% healing, +5% max mana, and +20% mana regen', () => {
    const mods = computeTalentModifiers('mage', { ...emptyAllocation(), spec: 'arcane' } as never);
    expect(mods.global.healPct).toBeCloseTo(0.15, 6);
    expect(mods.global.manaPct).toBeCloseTo(0.05, 6);
    expect(mods.global.manaRegenPct).toBeCloseTo(0.2, 6);
  });

  it('the mana cushion actually raises a Chronomancer max mana', () => {
    const chrono = chronoMage().p.maxResource;
    const fire = (() => {
      const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
      sim.setPlayerLevel(20);
      sim.setSpec('fire');
      sim.tick();
      return sim.player.maxResource;
    })();
    // Same base pool, but the mastery gives the Chronomancer ~5% more.
    expect(chrono).toBeGreaterThan(fire);
    expect(chrono / fire).toBeCloseTo(1.05, 2);
  });
});

describe('Cascada echo window', () => {
  it('lasts 10s on a 17s cooldown (a longer window, same ~7s gap)', () => {
    const cascade = ABILITIES.temporal_cascade;
    expect(cascade.cooldown).toBe(17);
    const rank3 = cascade.ranks?.at(-1) ?? cascade;
    const eff = rank3.effects.find((e) => e.type === 'massTemporalEcho');
    expect(eff && 'duration' in eff ? eff.duration : 0).toBe(10);
  });
});

describe('Aether Darts full-charge barrage', () => {
  it('fires 5 missiles at max charges, 3 otherwise (channelStart hook)', () => {
    const { p } = chronoMage();
    // No charges: default (0 => casting_lifecycle keeps the ability's 3 ticks).
    aetherDartsChannelStart(p, 'arcane_missiles');
    expect(p.aetherDartsTicks).toBe(0);
    // Build to 4 charges with real Aether Surge casts, then re-arm the channel.
    const { sim, p: mage } = chronoMage();
    const dummy = addDummy(sim);
    for (let i = 0; i < 4 && aetherSurgeStacks(mage) < 4; i++) {
      sim.targetEntity(dummy.id);
      sim.castAbility('arcane_surge');
      for (let t = 0; t < 60 && !free(mage); t++) sim.tick();
    }
    expect(aetherSurgeStacks(mage)).toBe(4);
    aetherDartsChannelStart(mage, 'arcane_missiles');
    expect(mage.aetherDartsTicks).toBe(5);
  });

  // Count the missiles FIRED (each launches a 'spellfx' projectile), not the ones
  // that land: a spell-hit roll can miss, but the barrage must always FIRE exactly
  // 5. This also pins the floating-point channel-tick fix (the 5th tick used to drop
  // when it coincided with the channel end, at 0% and some haste levels).
  function fireCount(sim: Sim, p: Entity): number {
    let fired = 0;
    for (let t = 0; t < 120; t++) {
      for (const e of sim.tick() as SimEvent[]) {
        if (e.type === 'spellfx' && (e as { sourceId?: number }).sourceId === p.id) fired++;
      }
      if (free(p) && t > 5) break;
    }
    return fired;
  }

  it('the channel actually fires 5 missiles at 4 charges (default 3), miss-independent', () => {
    const { sim, p } = chronoMage();
    const dummy = addDummy(sim);
    for (let i = 0; i < 4 && aetherSurgeStacks(p) < 4; i++) {
      sim.targetEntity(dummy.id);
      sim.castAbility('arcane_surge');
      for (let t = 0; t < 60 && !free(p); t++) sim.tick();
    }
    expect(aetherSurgeStacks(p)).toBe(4);
    sim.targetEntity(dummy.id);
    sim.castAbility('arcane_missiles');
    expect(fireCount(sim, p)).toBe(5);
  });

  it('a plain channel (no charges) still fires exactly the default 3 missiles', () => {
    const { sim, p } = chronoMage();
    const dummy = addDummy(sim);
    expect(aetherSurgeStacks(p)).toBe(0);
    sim.targetEntity(dummy.id);
    sim.castAbility('arcane_missiles');
    expect(fireCount(sim, p)).toBe(3);
  });

  it('the 5-missile barrage holds under spell haste (fp channel-tick fix)', () => {
    const { sim, p } = chronoMage();
    const dummy = addDummy(sim);
    for (let i = 0; i < 4 && aetherSurgeStacks(p) < 4; i++) {
      sim.targetEntity(dummy.id);
      sim.castAbility('arcane_surge');
      for (let t = 0; t < 60 && !free(p); t++) sim.tick();
    }
    expect(aetherSurgeStacks(p)).toBe(4);
    p.spellHaste = (p.spellHaste ?? 0) + 0.2; // a tierset-like haste level that dropped the 5th
    sim.targetEntity(dummy.id);
    sim.castAbility('arcane_missiles');
    expect(fireCount(sim, p)).toBe(5);
  });
});

describe('Aether Surge cast-speed ramp', () => {
  function chargeAura(value: number) {
    return {
      id: ARCANE_SURGE_ID,
      name: 'Aether Surge',
      kind: 'arcane_charge' as const,
      value,
      stacks: value,
      remaining: 10,
      duration: 10,
      sourceId: 1,
      school: 'arcane' as const,
    };
  }
  function freeAura() {
    return {
      id: 'aether_surge_free',
      name: 'Aether Rush',
      kind: 'next_cast_free' as const,
      value: 0,
      remaining: 15,
      duration: 15,
      sourceId: 1,
      school: 'arcane' as const,
      empowerAbilities: [ARCANE_SURGE_ID],
    };
  }

  it('trims 5% per charge, and the free proc halves the cast (stacking)', () => {
    const { p } = chronoMage();
    expect(aetherSurgeCastMult(p)).toBeCloseTo(1, 6); // at rest
    p.auras.push(chargeAura(3));
    expect(aetherSurgeCastMult(p)).toBeCloseTo(0.85, 6); // 3 charges: -15%
    p.auras.push(freeAura());
    expect(aetherSurgeCastMult(p)).toBeCloseTo(0.425, 6); // + Aether Rush: x0.5
  });

  it('the charge ramp is capped at 4 (never faster than -20% from charges alone)', () => {
    const { p } = chronoMage();
    p.auras.push(chargeAura(4));
    expect(aetherSurgeCastMult(p)).toBeCloseTo(0.8, 6);
  });

  it('is wired into the cast bar: 4 charges shortens Aether Surge to 0.8x', () => {
    const base = chronoMage();
    base.sim.targetEntity(addDummy(base.sim).id);
    base.sim.castAbility('arcane_surge');
    const t0 = base.p.castTotal; // 0 charges
    expect(t0).toBeGreaterThan(0);

    const buffed = chronoMage();
    buffed.p.auras.push(chargeAura(4));
    buffed.sim.targetEntity(addDummy(buffed.sim).id);
    buffed.sim.castAbility('arcane_surge');
    const t4 = buffed.p.castTotal; // 4 charges: identical gear/haste, so the ratio is the mult
    expect(t4).toBeCloseTo(t0 * 0.8, 3);
  });

  it('only Aether Surge is affected: a Frostbolt cast is untouched by charges', () => {
    const base = chronoMage();
    base.sim.targetEntity(addDummy(base.sim).id);
    base.sim.castAbility('frostbolt');
    const t0 = base.p.castTotal;
    expect(t0).toBeGreaterThan(0);

    const charged = chronoMage();
    charged.p.auras.push(chargeAura(4));
    charged.sim.targetEntity(addDummy(charged.sim).id);
    charged.sim.castAbility('frostbolt');
    expect(charged.p.castTotal).toBeCloseTo(t0, 3); // charges do not touch other casts
  });
});

describe('Temporal Reversal: combat resurrection', () => {
  it('is defined as a dead-target arcane res', () => {
    const rez = ABILITIES.temporal_reversal;
    expect(rez.targetsDead).toBe(true);
    expect(rez.cooldown).toBe(600);
    expect(rez.effects.some((e) => e.type === 'resurrectAlly')).toBe(true);
  });

  it('rewinds a dead party ally back to life; refuses on a living or non-party target', () => {
    const { sim, p } = chronoMage();
    const allyId = sim.addPlayer('warrior', 'Fallen');
    const ally = sim.entities.get(allyId)!;
    ally.pos = { x: p.pos.x + 3, y: p.pos.y, z: p.pos.z };
    sim.partyInvite(allyId, p.id);
    sim.partyAccept(allyId);
    // Kill the ally.
    ally.dead = true;
    ally.corpsePos = { ...ally.pos };
    ally.hp = 0;

    // Refuse on a LIVING target (self): no revive, cast not started, no cost.
    const mana0 = p.resource;
    sim.targetEntity(p.id);
    sim.castAbility('temporal_reversal');
    expect((p as unknown as { castingAbility: string | null }).castingAbility).toBeNull();
    expect(p.resource).toBe(mana0);

    // Cast on the DEAD ally: completes and offers the resurrection. The target
    // remains dead until their client explicitly accepts it.
    sim.targetEntity(allyId);
    sim.castAbility('temporal_reversal');
    const events = [];
    for (let t = 0; t < 60; t++) events.push(...sim.tick());
    expect(ally.dead).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'resurrectionOffer', pid: allyId, fromName: p.name }),
    );
    p.pos.x += 50;
    p.pos.z += 50;
    const currentCasterPosition = { x: p.pos.x, z: p.pos.z };
    sim.respondToResurrection(true, allyId);
    expect(ally.dead).toBe(false);
    expect(ally.pos.x).toBe(currentCasterPosition.x);
    expect(ally.pos.z).toBe(currentCasterPosition.z);
    expect(ally.hp).toBe(Math.round(ally.maxHp * 0.35));
  });

  it('keeps a declined or expired combat resurrection dead', () => {
    const castOffer = () => {
      const { sim, p } = chronoMage();
      const allyId = sim.addPlayer('warrior', 'Fallen');
      const ally = sim.entities.get(allyId)!;
      ally.pos = { x: p.pos.x + 3, y: p.pos.y, z: p.pos.z };
      sim.partyInvite(allyId, p.id);
      sim.partyAccept(allyId);
      ally.dead = true;
      ally.corpsePos = { ...ally.pos };
      ally.hp = 0;
      sim.targetEntity(allyId);
      sim.castAbility('temporal_reversal');
      for (let tick = 0; tick < 60; tick++) sim.tick();
      return { sim, ally, allyId };
    };

    const declined = castOffer();
    declined.sim.respondToResurrection(false, declined.allyId);
    expect(declined.ally.dead).toBe(true);

    const expired = castOffer();
    for (let tick = 0; tick < 20 * 30; tick++) expired.sim.tick();
    expired.sim.respondToResurrection(true, expired.allyId);
    expect(expired.ally.dead).toBe(true);
  });

  it('measures a released spirit from its nearby corpse, not the distant graveyard', () => {
    const { sim, p } = chronoMage();
    const allyId = sim.addPlayer('warrior', 'Released');
    const ally = sim.entities.get(allyId)!;
    sim.partyInvite(allyId, p.id);
    sim.partyAccept(allyId);
    ally.dead = true;
    ally.ghost = true;
    ally.hp = 0;
    ally.corpsePos = { x: p.pos.x + 3, y: p.pos.y, z: p.pos.z };
    ally.pos = { x: p.pos.x + 200, y: p.pos.y, z: p.pos.z + 200 };

    sim.targetEntity(allyId);
    sim.castAbility('temporal_reversal');

    expect(p.castingAbility).toBe('temporal_reversal');
  });
});
