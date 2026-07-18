// Enhancement shaman tank kit: a spec-granted toolkit (Stone Aegis mitigation,
// Anchorbound Weapon threat imbue, Elemental Demand taunt, Elemental Discharge)
// that lets a melee shaman hold aggro. Proves the spec grant, the charge-limited
// damage reduction, the threat multiplier, the ranged taunt, and the enchant-keyed
// discharge riders.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { threatModifier } from '../src/sim/threat';
import type { Entity, SimEvent } from '../src/sim/types';

const TANK_KIT = ['earth_shield', 'earthbound_weapon', 'elemental_demand', 'unleash_weapon'];

function makeEnh(seed = 7) {
  const sim = new Sim({ seed, playerClass: 'shaman', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.setSpec('enhancement');
  const pid = sim.playerId;
  const p = sim.entities.get(pid) as Entity & Record<string, unknown>;
  for (let i = 0; i < 5; i++) sim.tick(); // flush spec-grant learn events
  (p as any).maxHp = p.hp = 1_000_000;
  (p as any).resource = (p as any).maxResource;
  return { sim, p, pid };
}

function spawnMob(
  sim: Sim,
  p: Entity,
  dz: number,
  hostile = true,
  templateId: keyof typeof MOBS = 'ridge_stalker',
) {
  const mob = createMob((sim as any).nextId++, MOBS[templateId], 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.maxHp = mob.hp = 1_000_000;
  mob.hostile = hostile;
  sim.entities.set(mob.id, mob);
  (sim as any).rebucket(mob);
  return mob;
}

// Cast an instant ability and let it resolve. Ticks past the GCD (~1.5s = 30
// ticks) so a following cast in the same test is not blocked.
function cast(sim: Sim, id: string, pid: number, aim?: { x: number; z: number }) {
  (sim.entities.get(pid) as any).resource = (sim.entities.get(pid) as any).maxResource;
  sim.castAbility(id, pid, aim);
  const events: SimEvent[] = [];
  for (let i = 0; i < 32; i++) events.push(...sim.tick());
  return events;
}

describe('Enhancement tank kit: spec grant', () => {
  it('grants all four tank abilities at spec unlock to Enhancement only', () => {
    for (const specId of [null, 'enhancement', 'elemental', 'restoration']) {
      const sim = new Sim({ seed: 1, playerClass: 'shaman', autoEquip: true });
      sim.setPlayerLevel(5);
      if (specId !== null) expect(sim.setSpec(specId)).toBe(true);
      const isEnh = specId === 'enhancement';
      for (const id of TANK_KIT) {
        expect(!!sim.resolvedAbility(id), `${specId ?? 'no spec'} knows ${id}`).toBe(isEnh);
      }
    }
  });

  it('removes Enhancement-only tank auras when the player changes spec', () => {
    const { sim, p, pid } = makeEnh();
    cast(sim, 'earth_shield', pid);
    cast(sim, 'earthbound_weapon', pid);
    expect(p.auras.some((a) => a.kind === 'earth_shield')).toBe(true);
    expect(p.auras.some((a) => a.kind === 'earthbound_weapon')).toBe(true);
    expect(threatModifier(p, 'nature')).toBe(2);

    expect(sim.setSpec('elemental')).toBe(true);

    expect(TANK_KIT.some((id) => sim.resolvedAbility(id))).toBe(false);
    expect(p.auras.some((a) => a.kind === 'earth_shield')).toBe(false);
    expect(p.auras.some((a) => a.kind === 'earthbound_weapon')).toBe(false);
    expect(threatModifier(p, 'nature')).toBe(1);
  });
});

describe('Stone Aegis (Earth Shield)', () => {
  it('reduces the next 6 attacks by 20%, then expires', () => {
    const { sim, p, pid } = makeEnh();
    cast(sim, 'earth_shield', pid);
    const aura = p.auras.find((a) => a.kind === 'earth_shield');
    expect(aura, 'earth_shield aura applied').toBeTruthy();
    expect(aura?.charges).toBe(6);

    const mob = spawnMob(sim, p, 3, false);
    const drops: number[] = [];
    for (let i = 0; i < 7; i++) {
      const before = p.hp;
      (sim as any).dealDamage(mob, p, 100, false, 'physical', null, 'hit');
      drops.push(before - p.hp);
    }
    // First 6 hits are mitigated (80 each); the 7th lands full (shield spent).
    expect(drops.slice(0, 6)).toEqual([80, 80, 80, 80, 80, 80]);
    expect(drops[6]).toBe(100);
    expect(p.auras.some((a) => a.kind === 'earth_shield')).toBe(false);
  });

  it('takes full spell-reflection damage without spending a charge', () => {
    const { sim, p, pid } = makeEnh();
    cast(sim, 'earth_shield', pid);
    const mob = spawnMob(sim, p, 3, true, 'wyrmcult_necromancer');
    const ward = MOBS.wyrmcult_necromancer.spellReflect!;
    const before = p.hp;

    // Drive the real reflection path: a spell landing on the warded mob reflects
    // incidental damage back to the caster.
    (sim as any).dealDamage(p, mob, 100, false, 'fire', 'Fireball', 'hit');

    expect(before - p.hp).toBe(ward.value);
    expect(p.auras.find((a) => a.kind === 'earth_shield')?.charges).toBe(6);
  });

  it('does not spend charges on source-less, self, or zero damage', () => {
    const { sim, p, pid } = makeEnh();
    cast(sim, 'earth_shield', pid);
    const mob = spawnMob(sim, p, 3, false);

    let before = p.hp;
    (sim as any).dealDamage(null, p, 100, false, 'physical', null, 'hit');
    expect(before - p.hp).toBe(100);
    expect(p.auras.find((a) => a.kind === 'earth_shield')?.charges).toBe(6);

    before = p.hp;
    (sim as any).dealDamage(p, p, 100, false, 'physical', null, 'hit');
    expect(before - p.hp).toBe(100);
    expect(p.auras.find((a) => a.kind === 'earth_shield')?.charges).toBe(6);

    before = p.hp;
    (sim as any).dealDamage(mob, p, 0, false, 'physical', null, 'hit');
    expect(p.hp).toBe(before);
    expect(p.auras.find((a) => a.kind === 'earth_shield')?.charges).toBe(6);
  });

  it('recasting renews the shield to a full 6 charges', () => {
    const { sim, p, pid } = makeEnh();
    cast(sim, 'earth_shield', pid);
    const mob = spawnMob(sim, p, 3, false);
    (sim as any).dealDamage(mob, p, 100, false, 'physical', null, 'hit');
    (sim as any).dealDamage(mob, p, 100, false, 'physical', null, 'hit');
    expect(p.auras.find((a) => a.kind === 'earth_shield')?.charges).toBe(4);
    // Drop the source so no auto-attack spends a charge during the recast, then
    // renew: recasting refreshes the aura back to a full 6 charges.
    sim.entities.delete(mob.id);
    cast(sim, 'earth_shield', pid);
    expect(p.auras.find((a) => a.kind === 'earth_shield')?.charges).toBe(6);
  });
});

describe('Anchorbound Weapon (Earthbound Weapon)', () => {
  it('doubles all threat the wearer generates', () => {
    const { sim, p, pid } = makeEnh();
    expect(threatModifier(p, 'physical')).toBe(1);
    cast(sim, 'earthbound_weapon', pid);
    expect(p.auras.some((a) => a.kind === 'earthbound_weapon')).toBe(true);
    expect(threatModifier(p, 'physical')).toBe(2);
    expect(threatModifier(p, 'nature')).toBe(2);
  });

  it('swaps with a damage imbue: one weapon enchant at a time', () => {
    const { sim, p, pid } = makeEnh();
    cast(sim, 'rockbiter_weapon', pid);
    expect(p.auras.some((a) => a.kind === 'imbue')).toBe(true);
    cast(sim, 'earthbound_weapon', pid);
    expect(p.auras.some((a) => a.kind === 'imbue')).toBe(false);
    expect(p.auras.some((a) => a.kind === 'earthbound_weapon')).toBe(true);
    // and back: a damage imbue clears the threat imbue.
    cast(sim, 'rockbiter_weapon', pid);
    expect(p.auras.some((a) => a.kind === 'earthbound_weapon')).toBe(false);
    expect(p.auras.some((a) => a.kind === 'imbue')).toBe(true);
  });
});

describe('Elemental Demand (taunt)', () => {
  function demandAt(dz: number) {
    const { sim, p, pid } = makeEnh();
    const mob = spawnMob(sim, p, dz);
    mob.threat.set(999, 50);
    p.facing = 0;
    sim.targetEntity(mob.id, pid);
    cast(sim, 'elemental_demand', pid, { x: mob.pos.x, z: mob.pos.z });
    return { mob, pid };
  }

  it('accepts a target exactly 15 yards away', () => {
    const { mob, pid } = demandAt(15);
    expect(mob.forcedTargetId).toBe(pid);
    expect(mob.threat.get(pid) ?? 0).toBeGreaterThanOrEqual(50);
  });

  it('rejects a target beyond 15 yards', () => {
    const { mob, pid } = demandAt(15.01);
    expect(mob.forcedTargetId).toBeNull();
    expect(mob.threat.has(pid)).toBe(false);
  });
});

describe('Elemental Discharge (Unleash Weapon)', () => {
  function setup(dz = 4) {
    const { sim, p, pid } = makeEnh();
    const mob = spawnMob(sim, p, dz);
    p.facing = 0;
    sim.targetEntity(mob.id, pid);
    return { sim, p, pid, mob };
  }

  it('with Rimebound (frostbrand) active, damages and slows the target', () => {
    const { sim, p, pid, mob } = setup();
    cast(sim, 'frostbrand_weapon', pid);
    const before = mob.hp;
    cast(sim, 'unleash_weapon', pid, { x: mob.pos.x, z: mob.pos.z });
    expect(mob.hp).toBeLessThan(before);
    expect(mob.auras.some((a) => a.kind === 'slow')).toBe(true);
    expect(p.auras.some((a) => a.kind === 'imbue')).toBe(false);
  });

  it('with Pyrebrand (flametongue) active, applies a fire DoT', () => {
    const { sim, p, pid, mob } = setup();
    cast(sim, 'flametongue_weapon', pid);
    cast(sim, 'unleash_weapon', pid, { x: mob.pos.x, z: mob.pos.z });
    expect(mob.auras.some((a) => a.kind === 'dot' && a.school === 'fire')).toBe(true);
    expect(p.auras.some((a) => a.kind === 'imbue')).toBe(false);
  });

  it('with Anchorbound active, spikes threat onto the shaman', () => {
    const { sim, p, pid, mob } = setup();
    cast(sim, 'earthbound_weapon', pid);
    const before = mob.hp;
    cast(sim, 'unleash_weapon', pid, { x: mob.pos.x, z: mob.pos.z });
    const damage = before - mob.hp;
    // Anchorbound doubles the hit's pre-health-clamp threat and adds a doubled
    // 60-point spike. The health delta may differ by one from the internal
    // pre-clamp amount, so pin the decisive extra threat as a narrow range.
    const extraThreat = (mob.threat.get(pid) ?? 0) - damage * 2;
    expect(extraThreat).toBeGreaterThanOrEqual(120);
    expect(extraThreat).toBeLessThanOrEqual(121);
    expect(p.auras.some((a) => a.kind === 'earthbound_weapon')).toBe(false);
  });

  it('with Stonebound active, deals only physical damage and consumes the imbue', () => {
    const { sim, p, pid, mob } = setup();
    cast(sim, 'rockbiter_weapon', pid);
    const before = mob.hp;
    const events = cast(sim, 'unleash_weapon', pid, { x: mob.pos.x, z: mob.pos.z });
    const discharge = events.find(
      (event) =>
        event.type === 'damage' &&
        event.sourceId === pid &&
        event.targetId === mob.id &&
        event.ability === sim.resolvedAbility('unleash_weapon')?.def.name,
    );
    if (discharge?.type !== 'damage') throw new Error('missing Elemental Discharge damage event');
    expect(mob.hp).toBeLessThan(before);
    expect(discharge.school).toBe('physical');
    const excessThreat = (mob.threat.get(pid) ?? 0) - discharge.amount;
    expect(excessThreat).toBeGreaterThanOrEqual(0);
    expect(excessThreat).toBeLessThanOrEqual(1);
    expect(mob.auras.some((a) => a.kind === 'dot' || a.kind === 'slow')).toBe(false);
    expect(p.auras.some((a) => a.kind === 'imbue')).toBe(false);
  });

  it('without an enchant, deals the base hit without adding a rider', () => {
    const { sim, p, pid, mob } = setup();
    const before = mob.hp;
    const events = cast(sim, 'unleash_weapon', pid, { x: mob.pos.x, z: mob.pos.z });
    const discharge = events.find(
      (event) =>
        event.type === 'damage' &&
        event.sourceId === pid &&
        event.targetId === mob.id &&
        event.ability === sim.resolvedAbility('unleash_weapon')?.def.name,
    );
    if (discharge?.type !== 'damage') throw new Error('missing Elemental Discharge damage event');
    expect(mob.hp).toBeLessThan(before);
    const excessThreat = (mob.threat.get(pid) ?? 0) - discharge.amount;
    expect(excessThreat).toBeGreaterThanOrEqual(0);
    expect(excessThreat).toBeLessThanOrEqual(1);
    expect(mob.auras.some((a) => a.kind === 'dot' || a.kind === 'slow')).toBe(false);
    expect(p.auras.some((a) => a.kind === 'imbue' || a.kind === 'earthbound_weapon')).toBe(false);
  });

  it('consumes the enchant even when the discharge is lethal', () => {
    const { sim, p, pid, mob } = setup();
    cast(sim, 'frostbrand_weapon', pid);
    mob.hp = 1;
    cast(sim, 'unleash_weapon', pid, { x: mob.pos.x, z: mob.pos.z });
    expect(mob.dead).toBe(true);
    expect(p.auras.some((a) => a.kind === 'imbue')).toBe(false);
  });

  it('replays the same discharge outcome and RNG stream from the same seed', () => {
    const run = () => {
      const { sim, p, pid, mob } = setup();
      const draws: number[] = [];
      sim.rng.setObserver((value) => draws.push(value));
      cast(sim, 'frostbrand_weapon', pid);
      const before = mob.hp;
      cast(sim, 'unleash_weapon', pid, { x: mob.pos.x, z: mob.pos.z });
      sim.rng.setObserver(null);
      return {
        damage: before - mob.hp,
        draws,
        targetAuras: mob.auras.map((a) => ({ id: a.id, kind: a.kind, remaining: a.remaining })),
        enchantActive: p.auras.some((a) => a.kind === 'imbue'),
      };
    };

    expect(run()).toEqual(run());
  });
});
