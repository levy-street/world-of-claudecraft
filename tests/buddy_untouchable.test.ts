import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nameplateAnchorPickable } from '../src/render/nameplate_pick_core';
import { grantBuddy } from '../src/sim/buddies';
import { dealDamage } from '../src/sim/combat/damage';
import { applyHeal } from '../src/sim/combat/heal';
import { BUDDY_TEMPLATE_IDS, buddyTemplateId } from '../src/sim/content/buddy_mobs';
import { MOBS } from '../src/sim/data';
import { nythraxisTransitionStunTargets } from '../src/sim/encounters/nythraxis';
import { createMob } from '../src/sim/entity';
import { buddyOf, buddyUnselectableBy } from '../src/sim/pet/buddy_ai';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { stripComments } from './helpers/strip_comments';

/** Any real, non-buddy mob template, for controls. */
const NON_BUDDY_TEMPLATE = Object.keys(MOBS).find((id) => !BUDDY_TEMPLATE_IDS.has(id))!;

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

  // The buddy stands closer than its owner, so a selector that still admitted
  // it would pick the buddy; landing on the owner proves the buddy was skipped,
  // not that nothing was selectable.
  it('friendly Tab skips a closer buddy for the real ally behind it', () => {
    const { sim, healer, owner, healerE, ownerE, buddy } = setup();
    place(sim, buddy, 2, -40);
    place(sim, ownerE, 10, -40);
    healerE.targetId = null;
    sim.friendlyTabTarget(healer);
    expect(healerE.targetId).toBe(owner);
    sim.friendlyTabTarget(healer);
    expect(healerE.targetId).toBe(owner);
  });

  it('nearest-friendly skips a closer buddy for the real ally behind it', () => {
    const { sim, healer, owner, healerE, ownerE, buddy } = setup();
    place(sim, buddy, 2, -40);
    place(sim, ownerE, 10, -40);
    healerE.targetId = null;
    sim.targetNearestFriendly(healer);
    expect(healerE.targetId).toBe(owner);
  });

  it('only the owner may select their buddy', () => {
    const { sim, healer, owner, healerE, ownerE, buddy } = setup();
    healerE.targetId = null;
    sim.targetEntity(buddy.id, healer);
    expect(healerE.targetId).toBeNull();
    // Selecting it never keeps a swing going, even with auto-attack running.
    ownerE.autoAttack = true;
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

  it('no aura (buff, stun, or dot) ever lands on a buddy through applyAura', () => {
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
    sim.ctx.applyAura(buddy, {
      ...base,
      id: 't_dot',
      name: 'Dot',
      kind: 'dot',
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

  it('the Nythraxis transition stun list leaves a buddy out', () => {
    const { sim, owner, ownerE, buddy } = setup();
    const pet = createMob(sim.ctx.nextId++, MOBS[NON_BUDDY_TEMPLATE], 18, { ...ownerE.pos });
    pet.ownerId = owner;
    sim.ctx.addEntity(pet);
    const boss = { ...ownerE, spawnPos: { ...ownerE.pos } } as Entity;
    const ids = nythraxisTransitionStunTargets(sim.ctx, boss).map((e) => e.id);
    expect(ids).toContain(owner);
    expect(ids).toContain(pet.id);
    expect(ids).not.toContain(buddy.id);
  });
});

describe("client picking skips other players' buddies", () => {
  const viewer = 7;
  const otherBuddy = { id: 40, dead: false, ownerId: 9, templateId: buddyTemplateId('horse') };
  const ownBuddy = { ...otherBuddy, id: 41, ownerId: viewer };
  const mob = { id: 42, dead: false, ownerId: null, templateId: NON_BUDDY_TEMPLATE };

  it("nameplate anchors: never another player's buddy, still the owner's own and a mob", () => {
    expect(nameplateAnchorPickable(otherBuddy, viewer)).toBe(false);
    expect(nameplateAnchorPickable(ownBuddy, viewer)).toBe(true);
    expect(nameplateAnchorPickable(mob, viewer)).toBe(true);
    expect(nameplateAnchorPickable({ ...mob, dead: true }, viewer)).toBe(false);
    expect(nameplateAnchorPickable({ ...mob, id: viewer }, viewer)).toBe(false);
  });

  it('nameplate painter routes both anchor branches through nameplateAnchorPickable', () => {
    const src = stripComments(readFileSync('src/render/nameplate_painter.ts', 'utf8'));
    expect(
      src.match(/pickable\s*[:=]\s*nameplateAnchorPickable\(entity, player\.id\)/g),
    ).toHaveLength(2);
  });

  it('world picking gates both the direct-hit and the sloppy path on buddyUnselectableBy', () => {
    const src = stripComments(readFileSync('src/render/world_picking.ts', 'utf8'));
    const direct = src.slice(
      src.indexOf('pickDirect(clientX: number'),
      src.indexOf('pickSloppy(clientX: number'),
    );
    const sloppy = src.slice(src.indexOf('pickSloppy(clientX: number'));
    expect(direct).toMatch(/buddyUnselectableBy\(e, sim\.playerId\)\) break;/);
    expect(sloppy).toMatch(/buddyUnselectableBy\(e, sim\.playerId\)\)\s*continue;/);
  });
});
