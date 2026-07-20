// Ice Block (Cold Coffin) rework, owner 2026-07-13: total immunity while encased (no
// finite absorb), a full debuff cleanse on cast, castable while stunned/polymorphed,
// the recast toggle, and a second charge for Frost.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

function rigMage(spec: 'frost' | 'fire' | 'arcane' | null = null) {
  const sim = new Sim({ seed: 17, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(20);
  if (spec) expect(sim.setSpec(spec)).toBe(true); // Ice Block is base kit, no talent needed
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  p.gcdRemaining = 0;
  return { sim, p };
}

function addTargetMob(sim: Sim, dist = 8): Entity {
  const p = sim.player;
  const mob = createMob(9100, MOBS.forest_wolf, 20, { x: p.pos.x + dist, y: p.pos.y, z: p.pos.z });
  mob.hostile = true;
  mob.maxHp = mob.hp = 100000;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  return mob;
}

function dealDamage(sim: Sim, target: Entity, amount: number, school = 'physical'): void {
  (
    sim as unknown as {
      dealDamage(
        s: Entity | null,
        t: Entity,
        n: number,
        c: boolean,
        sc: string,
        a: string | null,
        k: string,
      ): void;
    }
  ).dealDamage(null, target, amount, false, school, null, 'hit');
}

function tickSeconds(sim: Sim, seconds: number) {
  const events = [];
  for (let i = 0; i < 20 * seconds; i++) events.push(...sim.tick());
  return events;
}

function debuff(id: string, kind: Aura['kind'], value = 0): Aura {
  return { id, name: id, kind, value, remaining: 30, duration: 30, sourceId: 0, school: 'shadow' };
}

function unbreakableControl(
  id: string,
  kind: Aura['kind'],
): Aura & {
  unbreakableControl: true;
} {
  return { ...debuff(id, kind), unbreakableControl: true };
}

describe('Ice Block: immunity + cleanse + control', () => {
  it('grants total immunity and blocks your own actions, then restores on expiry', () => {
    const { sim, p } = rigMage();
    const mob = addTargetMob(sim);
    sim.startAutoAttack();
    expect(p.autoAttack).toBe(true);

    sim.castAbility('ice_block');
    expect(p.auras.some((a) => a.id === 'ice_block' && a.kind === 'stasis')).toBe(true);
    expect(p.auras.some((a) => a.kind === 'absorb')).toBe(false); // no finite shield anymore
    expect(p.autoAttack).toBe(false);

    // Your own casts/swings are blocked while encased.
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('fireball');
    expect(p.castingAbility).toBe(null);
    sim.startAutoAttack();
    expect(p.autoAttack).toBe(false);
    const swings = tickSeconds(sim, 3).filter(
      (e) => e.type === 'damage' && e.sourceId === p.id && e.targetId === mob.id,
    );
    expect(swings).toEqual([]);

    // TOTAL immunity: even a huge hit does nothing.
    const hp0 = p.hp;
    dealDamage(sim, p, 999999, 'fire');
    expect(p.hp).toBe(hp0);

    tickSeconds(sim, 5); // 8s stasis expires
    expect(p.auras.some((a) => a.kind === 'stasis')).toBe(false);
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('fireball');
    expect(p.castingAbility).toBe('fireball'); // action restored
  });

  it('strips every debuff on cast and can be cast while stunned or polymorphed', () => {
    const { sim, p } = rigMage();
    p.auras.push(debuff('test_stun', 'stun'));
    p.auras.push(debuff('test_poly', 'polymorph'));
    p.auras.push(debuff('test_dot', 'dot', 50));
    p.auras.push(debuff('test_slow', 'slow', 1.5));
    // Stunned + polymorphed, yet Ice Block still fires (usableWhileControlled)...
    sim.castAbility('ice_block');
    expect(p.auras.some((a) => a.kind === 'stasis')).toBe(true);
    // ...and it removed every harmful effect.
    for (const id of ['test_stun', 'test_poly', 'test_dot', 'test_slow']) {
      expect(p.auras.some((a) => a.id === id)).toBe(false);
    }
  });

  it('cannot cleanse unbreakable encounter control but still cleanses ordinary debuffs', () => {
    const { sim, p } = rigMage();
    p.auras.push(unbreakableControl('scripted_stun', 'stun'));
    p.auras.push(debuff('ordinary_dot', 'dot', 50));

    sim.castAbility('ice_block');

    expect(p.auras.some((a) => a.id === 'scripted_stun')).toBe(true);
    expect(p.auras.some((a) => a.id === 'ordinary_dot')).toBe(false);
    expect(p.auras.some((a) => a.id === 'ice_block' && a.kind === 'stasis')).toBe(true);
  });

  it('cannot prevent unbreakable encounter control from landing', () => {
    const { sim, p } = rigMage();
    const mob = addTargetMob(sim);
    const applyAura = (aura: Aura) =>
      (sim as unknown as { applyAura(target: Entity, aura: Aura): void }).applyAura(p, aura);
    const scripted = unbreakableControl('scripted_stun', 'stun');
    scripted.sourceId = mob.id;
    const ordinary = debuff('ordinary_stun', 'stun');
    ordinary.sourceId = mob.id;

    sim.castAbility('ice_block');
    applyAura(scripted);
    applyAura(ordinary);

    expect(p.auras.some((a) => a.id === 'scripted_stun')).toBe(true);
    expect(p.auras.some((a) => a.id === 'ordinary_stun')).toBe(false);
  });

  it('rejects every incoming external crowd-control aura until Ice Block ends', () => {
    const { sim, p } = rigMage();
    const mob = addTargetMob(sim);
    const crowdControlKinds: Aura['kind'][] = [
      'polymorph',
      'stun',
      'root',
      'incapacitate',
      'silence',
      'blind',
      'disarm',
      'slow',
    ];
    const applyCrowdControl = (kind: Aura['kind']) => {
      const incoming = debuff(`incoming_${kind}`, kind, kind === 'slow' ? 0.5 : 0);
      incoming.sourceId = mob.id;
      (sim as unknown as { applyAura(target: Entity, aura: Aura): void }).applyAura(p, incoming);
    };
    sim.castAbility('ice_block');
    for (const kind of crowdControlKinds) applyCrowdControl(kind);
    for (const kind of crowdControlKinds) {
      expect(p.auras.some((aura) => aura.id === `incoming_${kind}`)).toBe(false);
    }

    sim.castAbility('ice_block');
    applyCrowdControl('polymorph');
    applyCrowdControl('slow');
    expect(p.auras.some((aura) => aura.id === 'incoming_polymorph')).toBe(true);
    expect(p.auras.some((aura) => aura.id === 'incoming_slow')).toBe(true);
  });

  it('rejects incoming knockback until Ice Block ends', () => {
    const { sim, p } = rigMage();
    const mob = addTargetMob(sim);
    const applyKnockback = () =>
      (
        sim as unknown as {
          applyKnockback(source: Entity, target: Entity, distance: number): number;
        }
      ).applyKnockback(mob, p, 4);

    sim.castAbility('ice_block');
    const blockedPosition = { ...p.pos };
    expect(applyKnockback()).toBe(0);
    expect(p.pos).toEqual(blockedPosition);

    sim.castAbility('ice_block');
    expect(applyKnockback()).toBeGreaterThan(0);
    expect(p.pos).not.toEqual(blockedPosition);
  });

  it('recast cancels the stasis early', () => {
    const { sim, p } = rigMage();
    sim.castAbility('ice_block');
    expect(p.auras.some((a) => a.kind === 'stasis')).toBe(true);
    tickSeconds(sim, 1);
    sim.castAbility('ice_block');
    expect(p.auras.some((a) => a.kind === 'stasis')).toBe(false);
  });

  it('recast removes only caster-owned stasis when an aura id collides', () => {
    const { sim, p } = rigMage();
    const protectedAura = {
      ...unbreakableControl('ice_block', 'stasis'),
      sourceId: 9000,
    };
    const ownedStasis = { ...debuff('ice_block', 'stasis'), sourceId: p.id };
    const ownedAbsorb = { ...debuff('ice_block_absorb', 'absorb', 100), sourceId: p.id };
    p.auras.push(protectedAura, ownedStasis, ownedAbsorb);

    sim.castAbility('ice_block');

    expect(p.auras).toContain(protectedAura);
    expect(p.auras).not.toContain(ownedStasis);
    expect(p.auras).not.toContain(ownedAbsorb);
  });

  it('Frost carries two Ice Block charges; other specs carry one', () => {
    const frost = rigMage('frost');
    const frostRes = frost.sim.resolvedAbility('ice_block', frost.p.id);
    expect(frostRes?.bonusCharges ?? 0).toBe(1); // +1 => two total charges

    // The KNOWN entry carries it too (abilitiesKnownAt, the shared builder):
    // this is what the action bar badges, and what ClientWorld's local
    // recompute mirrors, so a resolvedAbility-only stamp would regress the "2".
    const frostKnown = frost.sim.known.find((k) => k.def.id === 'ice_block');
    expect(frostKnown?.bonusCharges ?? 0).toBe(1);

    const plain = rigMage(null);
    const plainRes = plain.sim.resolvedAbility('ice_block', plain.p.id);
    expect(plainRes?.bonusCharges ?? 0).toBe(0); // one charge
    const plainKnown = plain.sim.known.find((k) => k.def.id === 'ice_block');
    expect(plainKnown?.bonusCharges ?? 0).toBe(0);
  });

  it('replays deterministically', () => {
    const run = () => {
      const { sim, p } = rigMage();
      const mob = addTargetMob(sim);
      const events = [];
      sim.startAutoAttack();
      sim.castAbility('ice_block');
      events.push(...tickSeconds(sim, 2));
      dealDamage(sim, p, 175);
      p.gcdRemaining = 0;
      sim.castAbility('ice_block');
      p.gcdRemaining = 0;
      p.resource = p.maxResource;
      sim.castAbility('fireball');
      events.push(...tickSeconds(sim, 4));
      return { hp: p.hp, casting: p.castingAbility, mobHp: mob.hp, events };
    };
    expect(run()).toEqual(run());
  });
});
