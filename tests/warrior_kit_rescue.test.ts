// The three base-kit abilities the owner rescued from PR #1348 (his design
// moved them OUT of talents into the baseline warrior): Pummel (level 8
// interrupt), Heroic Leap (level 6 ground-targeted swept relocation + area
// damage, the new repositionToAim effect), and Rallying Cry (level 18 party
// attack-power horn, the new aoeAllyAttackPower effect).

import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';
import { dist2d, MAX_LEVEL, STANCE_RAGE_GEN } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function warriorAtCap(seed = 7): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior' });
  sim.setPlayerLevel(MAX_LEVEL);
  return sim;
}

function nearestMob(sim: Sim) {
  let best: any = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = dist2d(sim.player.pos, e.pos);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function standOff(sim: Sim, mob: any, dist: number) {
  const p = sim.player;
  p.pos.x = mob.pos.x - dist;
  p.pos.z = mob.pos.z;
  p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
}

describe('base kit membership', () => {
  it('the three rescues are BASE abilities at their learn levels, no talent needed', () => {
    for (const id of ['pummel', 'heroic_leap', 'rallying_cry']) {
      expect(CLASSES.warrior.abilities, id).toContain(id);
    }
    expect(ABILITIES.pummel.learnLevel).toBe(8);
    expect(ABILITIES.heroic_leap.learnLevel).toBe(6);
    expect(ABILITIES.rallying_cry.learnLevel).toBe(18);
    const at7 = abilitiesKnownAt('warrior', 7).map((k) => k.def.id);
    expect(at7).not.toContain('pummel');
    const at20 = abilitiesKnownAt('warrior', 20).map((k) => k.def.id);
    for (const id of ['pummel', 'heroic_leap', 'rallying_cry']) expect(at20).toContain(id);
  });
});

describe('Pummel', () => {
  it('costs nothing, interrupts, locks the school 4s, and PAYS 10 rage for the cut', () => {
    const sim = warriorAtCap(71);
    const p = sim.player;
    const mob = nearestMob(sim);
    mob.hp = 1_000_000;
    mob.maxHp = 1_000_000;
    standOff(sim, mob, 2);
    sim.targetEntity(mob.id);
    // A mid-cast hostile spell (resolved through the global ability table).
    mob.castingAbility = 'fireball';
    mob.castRemaining = 1.2;
    mob.castTotal = 2;
    p.resource = 0; // free: castable at empty rage
    sim.castAbility('pummel');
    expect(mob.castingAbility).toBeNull();
    const lockout = mob.auras.find((a: any) => a.kind === 'lockout');
    expect(lockout).toBeTruthy();
    expect(lockout.remaining).toBeCloseTo(4, 0);
    // The owner's incentive: stopping a cast GENERATES 10 rage.
    // No-spec warrior stands in Battle Stance: +STANCE_RAGE_GEN (10%) at the mint.
    expect(p.resource).toBeCloseTo(10 * (1 + STANCE_RAGE_GEN));
  });

  it('pays no rage on a whiff (the target was not casting)', () => {
    const sim = warriorAtCap(71);
    const p = sim.player;
    const mob = nearestMob(sim);
    standOff(sim, mob, 2);
    sim.targetEntity(mob.id);
    p.resource = 0;
    sim.castAbility('pummel');
    expect(p.resource).toBe(0);
  });
});

describe('Heroic Leap', () => {
  it('relocates the caster to the aimed point and damages enemies there', () => {
    const sim = warriorAtCap(72);
    const p = sim.player;
    // Anchor on a camp mob's clearing (known-walkable ground) and leap to a
    // point right next to it.
    const mob = nearestMob(sim);
    mob.hp = 1_000_000;
    mob.maxHp = 1_000_000;
    standOff(sim, mob, 14);
    const aim = { x: mob.pos.x - 2, z: mob.pos.z };
    const hp0 = mob.hp;
    sim.castAbilityAt('heroic_leap', aim);
    // Cast ARMS the arc and puts the ability on its 20s cooldown; the caster has
    // not swept to the aim yet and no landing blast has fired.
    expect(p.leap).not.toBeNull();
    expect(p.cooldowns.get('heroic_leap')).toBe(20);
    expect(mob.hp).toBe(hp0);
    // Fly the ~0.6s arc to touchdown; the flight owns movement until it lands.
    for (let i = 0; i < 30 && p.leap; i++) sim.tick();
    expect(p.leap).toBeNull();
    // Landed near the aim (swept up to it), far from the start.
    expect(Math.hypot(p.pos.x - aim.x, p.pos.z - aim.z)).toBeLessThan(3);
    // The landing blast caught the adjacent mob.
    expect(mob.hp).toBeLessThan(hp0);
  });

  it('never tunnels: the swept landing is collision-resolved ground', () => {
    const sim = warriorAtCap(73);
    const p = sim.player;
    const mob = nearestMob(sim);
    standOff(sim, mob, 10);
    const aim = { x: p.pos.x + 8, z: p.pos.z };
    sim.castAbilityAt('heroic_leap', aim);
    // Wherever it stopped, the caster stands on real terrain height.
    expect(p.pos.y).toBeCloseTo(terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed), 3);
    expect(p.onGround).toBe(true);
  });
});

describe('Rallying Cry', () => {
  it('grants 20% temporary maximum health, raising current health with it', () => {
    const sim = warriorAtCap(74);
    const p = sim.player;
    const max0 = p.maxHp;
    p.hp = Math.floor(p.maxHp * 0.5); // half health going in
    const hp0 = p.hp;
    sim.castAbility('rallying_cry');
    const aura = p.auras.find((a: any) => a.id === 'rallying_cry_hp');
    expect(aura?.kind).toBe('buff_maxhp_pct');
    expect(aura?.value).toBeCloseTo(0.2);
    expect(aura?.remaining).toBeCloseTo(10, 0);
    // Max rose 20% and CURRENT health rose proportionally (the hp-fraction
    // restore): the horn grants real temporary health, WoW-style.
    expect(p.maxHp).toBe(Math.round(max0 * 1.2));
    expect(p.hp).toBeGreaterThan(hp0);
    expect(p.cooldowns.get('rallying_cry')).toBe(180);
  });

  it('drops the temporary health on expiry without overflowing', () => {
    const sim = warriorAtCap(74);
    const p = sim.player;
    const max0 = p.maxHp;
    sim.castAbility('rallying_cry');
    expect(p.maxHp).toBe(Math.round(max0 * 1.2));
    for (let i = 0; i < 20 * 11 && p.auras.some((a: any) => a.id === 'rallying_cry_hp'); i++)
      sim.tick();
    expect(p.auras.some((a: any) => a.id === 'rallying_cry_hp')).toBe(false);
    expect(p.maxHp).toBe(max0);
    expect(p.hp).toBeLessThanOrEqual(p.maxHp);
  });

  it('reaches party members in range and skips those beyond 40 yards', () => {
    const sim = new Sim({ seed: 74, playerClass: 'warrior', noPlayer: true });
    const casterId = sim.addPlayer('warrior', 'Caster');
    const nearId = sim.addPlayer('warrior', 'Near');
    const farId = sim.addPlayer('warrior', 'Fara');
    for (const pid of [casterId, nearId, farId]) sim.setPlayerLevel(20, pid);
    sim.partyInvite(nearId, casterId);
    sim.partyAccept(nearId);
    sim.partyInvite(farId, casterId);
    sim.partyAccept(farId);
    const caster = sim.entities.get(casterId)! as any;
    const near = sim.entities.get(nearId)! as any;
    const far = sim.entities.get(farId)! as any;
    near.pos = { ...caster.pos };
    far.pos = { x: caster.pos.x + 60, y: caster.pos.y, z: caster.pos.z };
    caster.resource = 50;
    sim.castAbility('rallying_cry', casterId);
    expect(near.auras.some((a: any) => a.id === 'rallying_cry_hp')).toBe(true);
    expect(far.auras.some((a: any) => a.id === 'rallying_cry_hp')).toBe(false);
  });
});

describe('determinism', () => {
  it('same seed, same leap, same world', () => {
    const run = () => {
      const sim = warriorAtCap(75);
      const mob = nearestMob(sim);
      standOff(sim, mob, 12);
      sim.castAbilityAt('heroic_leap', { x: mob.pos.x - 2, z: mob.pos.z });
      for (let i = 0; i < 40; i++) sim.tick();
      return { pos: { ...sim.player.pos }, mobHp: mob.hp };
    };
    expect(run()).toEqual(run());
  });
});
