import { describe, expect, it } from 'vitest';
import { grantBuddy } from '../src/sim/buddies';
import { dealDamage } from '../src/sim/combat/damage';
import { applyHeal } from '../src/sim/combat/heal';
import { buddyOf, buddyUnselectableBy } from '../src/sim/pet/buddy_ai';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// A buddy (src/sim/pet/buddy_ai.ts) is visible but never interactable: no
// heal, buff, chain-heal jump, or damage ever lands on it from anyone (its
// owner included), and only its owner may select it (for the rename/autoloot
// menu). Regression: isFriendlyTo's owned-mob arm treated a buddy as a
// healable ally, so Chain Heal arced onto it.

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as { rebucket(e: unknown): void }).rebucket(e);
}

function setup() {
  const sim = new Sim({ seed: 2, playerClass: 'shaman', noPlayer: true });
  const healer = sim.addPlayer('shaman', 'Healer');
  const owner = sim.addPlayer('warrior', 'Owner');
  sim.setPlayerLevel(18, healer);
  sim.setSpec('restoration', healer);
  sim.setPlayerLevel(18, owner);
  sim.tick();
  grantBuddy(sim.ctx, owner, 'horse');
  const buddy = buddyOf(sim.ctx, owner);
  if (!buddy) throw new Error('buddy did not spawn');
  const healerE = sim.entities.get(healer)!;
  const ownerE = sim.entities.get(owner)!;
  place(sim, healerE, 0, -40);
  place(sim, ownerE, 4, -40);
  place(sim, buddy, 6, -40);
  return { sim, healer, owner, healerE, ownerE, buddy };
}

describe('buddies are visible but never interactable', () => {
  it('Chain Heal never jumps to a buddy, even the most injured one in range', () => {
    const { sim, healer, owner, healerE, ownerE, buddy } = setup();
    ownerE.hp = Math.round(ownerE.maxHp * 0.6);
    // The buddy is the most injured thing in jump range: the old bug picked it.
    buddy.maxHp = Math.max(buddy.maxHp, 100);
    buddy.hp = 1;
    healerE.resource = healerE.maxResource;
    sim.targetEntity(owner, healer);
    sim.castAbility('chain_heal', healer);
    const touched: number[] = [];
    let ownerHealed = false;
    for (let i = 0; i < 20 * 4; i++) {
      for (const ev of sim.tick() as SimEvent[]) {
        if (ev.type === 'spellfx' && ev.fx === 'chainHeal') touched.push(ev.targetId);
        if (ev.type === 'heal2') {
          touched.push(ev.targetId);
          if (ev.targetId === owner) ownerHealed = true;
        }
      }
    }
    expect(ownerHealed).toBe(true);
    expect(touched).not.toContain(buddy.id);
    expect(buddy.hp).toBe(1);
  });

  it('is neither friendly nor hostile to anyone, its owner included', () => {
    const { sim, healerE, ownerE, buddy } = setup();
    for (const caster of [healerE, ownerE]) {
      expect(sim.ctx.isFriendlyTo(caster, buddy)).toBe(false);
      expect(sim.ctx.isHostileTo(caster, buddy)).toBe(false);
    }
  });

  it('friendly Tab and nearest-friendly never select a buddy', () => {
    const { sim, healer, healerE, ownerE, buddy } = setup();
    // Move the owner out of range so the buddy would be the only candidate.
    place(sim, ownerE, 200, -40);
    place(sim, buddy, 3, -40);
    healerE.targetId = null;
    sim.friendlyTabTarget(healer);
    expect(healerE.targetId).toBeNull();
    sim.targetNearestFriendly(healer);
    expect(healerE.targetId).toBeNull();
  });

  it('only the owner may select their buddy', () => {
    const { sim, healer, owner, healerE, ownerE, buddy } = setup();
    healerE.targetId = null;
    sim.targetEntity(buddy.id, healer);
    expect(healerE.targetId).toBeNull();
    sim.targetEntity(buddy.id, owner);
    expect(ownerE.targetId).toBe(buddy.id);
    expect(ownerE.autoAttack).toBe(false);
  });

  it('applyHeal and dealDamage are no-ops on a buddy', () => {
    const { sim, ownerE, buddy } = setup();
    buddy.maxHp = Math.max(buddy.maxHp, 100);
    buddy.hp = 50;
    expect(applyHeal(sim.ctx, ownerE, buddy, 40, 'Test Heal')).toBe(0);
    expect(buddy.hp).toBe(50);
    expect(dealDamage(sim.ctx, ownerE, buddy, 40, false, 'physical', 'Test', 'hit')).toBe(0);
    expect(buddy.hp).toBe(50);
    expect(sim.entities.has(buddy.id)).toBe(true);
  });

  it('no aura (buff, stun, or debuff) ever lands on a buddy through applyAura', () => {
    const { sim, ownerE, healerE, buddy } = setup();
    buddy.auras.length = 0;
    const base = { remaining: 5, duration: 5, value: 0, school: 'physical' as const };
    sim.ctx.applyAura(buddy, {
      ...base,
      id: 't_stun',
      name: 'Stun',
      kind: 'stun',
      sourceId: ownerE.id,
    });
    sim.ctx.applyAura(buddy, {
      ...base,
      id: 't_buff',
      name: 'Buff',
      kind: 'buff_ap',
      sourceId: healerE.id,
    });
    expect(buddy.auras).toEqual([]);
    // Control: the same call still lands on a player.
    sim.ctx.applyAura(ownerE, {
      ...base,
      id: 't_buff',
      name: 'Buff',
      kind: 'buff_ap',
      sourceId: healerE.id,
    });
    expect(ownerE.auras.some((a) => a.id === 't_buff')).toBe(true);
  });

  it('buddyUnselectableBy: owner may pick, everyone else may not, other mobs unaffected', () => {
    const { owner, healer, buddy } = setup();
    expect(buddyUnselectableBy(buddy, owner)).toBe(false);
    expect(buddyUnselectableBy(buddy, healer)).toBe(true);
    expect(buddyUnselectableBy(buddy, null)).toBe(true);
    expect(buddyUnselectableBy({ ownerId: owner, templateId: 'wolf' }, healer)).toBe(false);
    expect(buddyUnselectableBy({ ownerId: null, templateId: buddy.templateId }, healer)).toBe(
      false,
    );
  });
});
