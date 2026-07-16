// Druid class wand (the caster-form ranged basic attack): in caster form and
// Moonwing Form (`form_moonkin`) the druid auto-attacks at range with the same
// fixed class wand the mage/priest/warlock carry (nature school); shifted into
// bear, cat, or travel form the wand is unavailable and auto-attack falls back
// to the form's melee swing. The form gate is the pure
// combat/form_swing.rangedAutoProfile resolver, consumed by
// updatePlayerAutoAttack and the /attack readout.

import { describe, expect, it } from 'vitest';
import { rangedAutoProfile, wandAllowedInForm } from '../src/sim/combat/form_swing';
import { CLASSES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { AuraKind, Entity, PlayerClass } from '../src/sim/types';
import { MELEE_RANGE } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;
type Ev = Record<string, any>;

function makeSim(seed = 7): { sim: AnySim; p: AnyEntity } {
  const sim = new Sim({ seed, playerClass: 'druid', autoEquip: true }) as AnySim;
  sim.setPlayerLevel(20);
  const p = sim.player as AnyEntity;
  p.resource = p.maxResource;
  return { sim, p };
}

// An idle hostile mob, beefed, in front of the player at distance dz, targeted + faced.
function spawnDummy(sim: AnySim, p: AnyEntity, dz: number): AnyEntity {
  const mob = createMob(sim.nextId++, MOBS['forest_wolf'], 5, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  }) as AnyEntity;
  mob.maxHp = 500000;
  mob.hp = 500000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

function capture(sim: AnySim): Ev[] {
  const events: Ev[] = [];
  const orig = (sim as any).emit.bind(sim);
  (sim as any).emit = (e: Ev) => {
    events.push(e);
    orig(e);
  };
  return events;
}

const isWandBolt = (e: Ev) => e.type === 'spellfx' && e.fx === 'projectile' && e.wand === true;

// Enter Moonwing Form directly via the aura (the ability is a Balance spec
// signature; the form gate reads the aura kind, not how it was granted).
function enterMoonwing(sim: AnySim, p: AnyEntity): void {
  (sim as any).applyAura(p, {
    id: 'moonkin_form',
    name: 'Moonwing Form',
    kind: 'form_moonkin' as AuraKind,
    remaining: 3600,
    duration: 3600,
    value: 0,
    sourceId: p.id,
    school: 'arcane' as const,
  });
}

describe('druid wand: caster and Moonwing form fire the class wand at range', () => {
  it('a caster-form druid auto-attacks a 25yd target with a nature wand bolt', () => {
    const { sim, p } = makeSim();
    const mob = spawnDummy(sim, p, 25);
    const events = capture(sim);
    (sim as any).startAutoAttack(p.id);
    const hp0 = mob.hp;
    for (let i = 0; i < 60 && mob.hp === hp0; i++) sim.tick();
    const bolt = events.find(isWandBolt);
    expect(bolt).toBeTruthy();
    expect(bolt?.school).toBe('nature');
    expect(mob.hp).toBeLessThan(hp0); // the bolt landed
    // The cadence is the class wand's, not the equipped staff's.
    expect(CLASSES.druid.ranged?.speed).toBe(1.8);
  });

  it('a caster-form druid wands even at point-blank range, like the other casters', () => {
    // Wand profiles have no dead zone (#94), so a caster druid never melee
    // white-hits; in-reach auto-attacks still fire the bolt, exactly like a
    // mage. (tests/form_swing.test.ts moved its staff-cadence control to bear
    // form for this reason.)
    const { sim, p } = makeSim();
    const mob = spawnDummy(sim, p, 2);
    const events = capture(sim);
    (sim as any).startAutoAttack(p.id);
    for (let i = 0; i < 60 && !events.some(isWandBolt); i++) sim.tick();
    expect(events.some(isWandBolt)).toBe(true);
  });

  it('a Moonwing-form druid keeps the wand', () => {
    const { sim, p } = makeSim();
    enterMoonwing(sim, p);
    const mob = spawnDummy(sim, p, 25);
    const events = capture(sim);
    (sim as any).startAutoAttack(p.id);
    for (let i = 0; i < 60 && !events.some(isWandBolt); i++) sim.tick();
    expect(events.some(isWandBolt)).toBe(true);
  });
});

describe('druid wand: melee and travel shapeshifts cannot fire it', () => {
  const shiftedHasNoWand = (formAbility: string) => {
    const { sim, p } = makeSim();
    sim.castAbility(formAbility);
    sim.tick();
    const mob = spawnDummy(sim, p, 25);
    const events = capture(sim);
    (sim as any).startAutoAttack(p.id);
    for (let i = 0; i < 60; i++) sim.tick();
    expect(events.some(isWandBolt)).toBe(false);
    return { sim, p, mob };
  };

  it('cat form never fires a bolt at range, and still melees in reach', () => {
    const { sim, p, mob } = shiftedHasNoWand('cat_form');
    // Walk the same mob into melee reach: the form swings claws instead.
    mob.pos = { x: p.pos.x, y: p.pos.y, z: p.pos.z + MELEE_RANGE * 0.5 };
    mob.prevPos = { ...mob.pos };
    (sim as any).rebucket(mob);
    const events = capture(sim);
    const hp0 = mob.hp;
    for (let i = 0; i < 60 && mob.hp === hp0; i++) sim.tick();
    expect(mob.hp).toBeLessThan(hp0);
    expect(events.some(isWandBolt)).toBe(false);
    expect(
      events.some((e) => e.type === 'damage' && e.school === 'physical' && e.sourceId === p.id),
    ).toBe(true);
  });

  it('bear form never fires a bolt at range', () => {
    shiftedHasNoWand('bear_form');
  });

  it('travel form never fires a bolt at range', () => {
    shiftedHasNoWand('travel_form');
  });
});

describe('rangedAutoProfile (the pure form gate)', () => {
  const fakeEntity = (kinds: string[]): Entity =>
    ({ auras: kinds.map((kind) => ({ kind })) }) as unknown as Entity;

  it('blocks the wand in exactly the bear, cat, and travel forms', () => {
    expect(wandAllowedInForm(fakeEntity([]))).toBe(true);
    expect(wandAllowedInForm(fakeEntity(['form_moonkin']))).toBe(true);
    expect(wandAllowedInForm(fakeEntity(['form_bear']))).toBe(false);
    expect(wandAllowedInForm(fakeEntity(['form_cat']))).toBe(false);
    expect(wandAllowedInForm(fakeEntity(['form_travel']))).toBe(false);
  });

  it('resolves the druid profile in caster or Moonwing form, undefined when shifted', () => {
    expect(rangedAutoProfile(fakeEntity([]), 'druid')).toBe(CLASSES.druid.ranged);
    expect(rangedAutoProfile(fakeEntity(['form_moonkin']), 'druid')).toBe(CLASSES.druid.ranged);
    expect(rangedAutoProfile(fakeEntity(['form_cat']), 'druid')).toBeUndefined();
    expect(rangedAutoProfile(fakeEntity(['form_bear']), 'druid')).toBeUndefined();
  });

  it('never gates the other wand carriers or the hunter Auto Shot', () => {
    // Shadowform priests and metamorphosed warlocks keep their wands; the
    // hunter's Auto Shot is not a wand, so no form can gate it.
    expect(rangedAutoProfile(fakeEntity(['form_shadow']), 'priest')).toBe(CLASSES.priest.ranged);
    expect(rangedAutoProfile(fakeEntity(['form_metamorph']), 'warlock')).toBe(
      CLASSES.warlock.ranged,
    );
    expect(rangedAutoProfile(fakeEntity(['form_bear']), 'hunter')).toBe(CLASSES.hunter.ranged);
    const meleeClasses: PlayerClass[] = ['warrior', 'rogue', 'paladin', 'shaman'];
    for (const cls of meleeClasses) expect(rangedAutoProfile(fakeEntity([]), cls)).toBeUndefined();
  });
});
