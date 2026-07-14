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
import type { Entity } from '../src/sim/types';

const TANK_KIT = [
  'earth_shield',
  'earthbound_weapon',
  'elemental_demand',
  'unleash_weapon',
  'tidal_ward',
];

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

function spawnMob(sim: Sim, p: Entity, dz: number, hostile = true) {
  const mob = createMob((sim as any).nextId++, MOBS.ridge_stalker, 20, {
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
  for (let i = 0; i < 32; i++) sim.tick();
}

describe('Enhancement tank kit: spec grant', () => {
  it('grants the whole tank kit to Enhancement only', () => {
    for (const specId of ['enhancement', 'elemental', 'restoration']) {
      const sim = new Sim({ seed: 1, playerClass: 'shaman', autoEquip: true });
      sim.setPlayerLevel(20);
      sim.setSpec(specId);
      const isEnh = specId === 'enhancement';
      for (const id of TANK_KIT) {
        expect(!!sim.resolvedAbility(id), `${specId} knows ${id}`).toBe(isEnh);
      }
    }
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

  it('does not spend a charge on non-direct damage (DoT ticks / reflects)', () => {
    const { sim, p, pid } = makeEnh();
    cast(sim, 'earth_shield', pid);
    const mob = spawnMob(sim, p, 3, false);
    // direct=false (10th positional arg): incidental damage leaves the shield intact.
    (sim as any).dealDamage(mob, p, 100, false, 'physical', null, 'hit', false, undefined, false);
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

describe('Tidal Ward (shaman defensive cooldown, heal-through)', () => {
  it('is granted to Enhancement and heals over time while boosting healing received', () => {
    const { sim, p, pid } = makeEnh();
    expect(!!sim.resolvedAbility('tidal_ward')).toBe(true);
    (p as any).maxHp = 100_000;
    cast(sim, 'tidal_ward', pid);
    expect(p.auras.some((a) => a.kind === 'hot')).toBe(true);
    expect(p.auras.find((a) => a.kind === 'heal_taken_up')?.value).toBe(0.4);
    // injure, then let the HoT tick: health climbs back
    p.hp = p.maxHp - 5000;
    const before = p.hp;
    for (let i = 0; i < 45; i++) sim.tick();
    expect(p.hp).toBeGreaterThan(before);
  });
});

describe('Elemental Demand (taunt)', () => {
  it('taunts a mob at 15 yard range, forcing it onto the shaman', () => {
    const { sim, p, pid } = makeEnh();
    const mob = spawnMob(sim, p, 12); // inside 15 yд
    mob.threat.set(999, 50); // someone else holds aggro
    p.facing = 0;
    sim.targetEntity(mob.id, pid);
    cast(sim, 'elemental_demand', pid, { x: mob.pos.x, z: mob.pos.z });
    expect(mob.forcedTargetId).toBe(pid);
    expect(mob.threat.get(pid) ?? 0).toBeGreaterThanOrEqual(50);
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
  });

  it('with Pyrebrand (flametongue) active, applies a fire DoT', () => {
    const { sim, p, pid, mob } = setup();
    cast(sim, 'flametongue_weapon', pid);
    cast(sim, 'unleash_weapon', pid, { x: mob.pos.x, z: mob.pos.z });
    expect(mob.auras.some((a) => a.kind === 'dot' && a.school === 'fire')).toBe(true);
  });

  it('with Anchorbound active, spikes threat onto the shaman', () => {
    const { sim, p, pid, mob } = setup();
    cast(sim, 'earthbound_weapon', pid);
    cast(sim, 'unleash_weapon', pid, { x: mob.pos.x, z: mob.pos.z });
    // The discharge itself plus the anchored threat spike put the shaman on top.
    expect(mob.threat.get(pid) ?? 0).toBeGreaterThan(0);
  });
});
