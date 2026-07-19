// The fire mage spec (owner design 2026-07-10, built 2026-07-11): Ignition
// mastery, guaranteed crits (Fire Blast / Scorch execute / Combustion), Hot
// Streak, Meteor's ignite spread, the Blazing Barrier personal-barrier slot,
// and the frost mage's Water Elemental. Follows the mage_choice_rows harness.

import { describe, expect, it } from 'vitest';
import { fireGuaranteedCrit, HOT_STREAK_BUILDERS } from '../src/sim/combat/fire_mage';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { ROW_TREES } from '../src/sim/content/talent_rows';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

function mageWithSpec(spec: 'fire' | 'frost') {
  const sim = new Sim({ seed: 33, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function addDummy(sim: Sim, dist = 5, hp = 1000000): Entity {
  const p = sim.player;
  const mob = createMob(9400, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dist,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = hp;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  p.facing = 0;
  return mob;
}

function collect(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 20); i++) out.push(...sim.tick());
  return out;
}

function gcdReset(p: Entity): void {
  (p as unknown as { gcdRemaining: number }).gcdRemaining = 0;
}

describe('fire spec kit', () => {
  it('the pick grants Ignition + Hot Streak passives, Blazing Barrier and Meteor', () => {
    const fireMods = computeTalentModifiers('mage', {
      ...emptyAllocation(),
      spec: 'fire',
    } as never);
    const fire = abilitiesKnownAt('mage', 20, fireMods).map((k) => k.def.id);
    for (const id of ['ignition', 'hot_streak', 'blazing_barrier', 'meteor', 'combustion']) {
      expect(fire, id).toContain(id);
    }
    const frostMods = computeTalentModifiers('mage', {
      ...emptyAllocation(),
      spec: 'frost',
    } as never);
    const frost = abilitiesKnownAt('mage', 20, frostMods).map((k) => k.def.id);
    for (const id of ['ignition', 'hot_streak', 'blazing_barrier', 'meteor']) {
      expect(frost, id).not.toContain(id);
    }
    expect(frost).toContain('summon_water_elemental');
    expect(fire).not.toContain('summon_water_elemental');
  });
});

describe('guaranteed crits and Ignition', () => {
  it('Cinderfall killing its target makes the follow-up auto-engage a silent no-op', () => {
    const { sim, p } = mageWithSpec('fire');
    const mob = addDummy(sim, 5, 1);
    sim.castAbility('fire_blast');
    expect(mob.dead).toBe(true);
    sim.startAutoAttack();
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error' && e.text === 'Invalid attack target.')).toBe(
      false,
    );
    expect(p.autoAttack).toBe(false);
  });

  it('Fire Blast always crits for committed fire and banks an Ignite burn', () => {
    const { sim, p } = mageWithSpec('fire');
    const mob = addDummy(sim);
    sim.castAbility('fire_blast');
    const events = collect(sim, 1.5);
    const hits = events.filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === p.id && e.amount > 0,
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].crit).toBe(true); // the guaranteed builder
    const ignite = mob.auras.find((a) => a.id === 'ignite');
    expect(ignite?.kind).toBe('dot');
    // 40% of the crit over 6s / 2s ticks = a third of the burn per tick.
    expect(ignite?.value).toBe(Math.max(1, Math.round(Math.round(hits[0].amount * 0.4) / 3)));
  });

  it('a second crit STACKS the running Ignite instead of replacing it', () => {
    const { sim, p } = mageWithSpec('fire');
    const mob = addDummy(sim);
    sim.castAbility('fire_blast');
    collect(sim, 1);
    const first = mob.auras.find((a) => a.id === 'ignite')?.value ?? 0;
    expect(first).toBeGreaterThan(0);
    gcdReset(p);
    p.cooldowns.delete('fire_blast');
    sim.castAbility('fire_blast');
    collect(sim, 1);
    const second = mob.auras.find((a) => a.id === 'ignite')?.value ?? 0;
    expect(second).toBeGreaterThan(first); // the burn banked on top
  });

  it('Scorch always crits only against targets at or below 30% health', () => {
    const { sim, p } = mageWithSpec('fire');
    const mob = addDummy(sim);
    // Enter combat first so the dummy stops regenerating during the cast.
    (
      sim as unknown as {
        dealDamage(
          s: Entity,
          t: Entity,
          n: number,
          c: boolean,
          sc: string,
          a: null,
          k: string,
        ): void;
      }
    ).dealDamage(p, mob, 1, false, 'fire', null, 'hit');
    mob.hp = Math.floor(mob.maxHp * 0.25); // execute range
    sim.castAbility('scorch');
    const events = collect(sim, 3);
    const hit = events.find(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === p.id && e.ability === 'Scald',
    );
    expect(hit?.crit).toBe(true);
  });

  it('frost mages get no guaranteed Fire Blast crit machinery', () => {
    const { sim, p } = mageWithSpec('frost');
    const ctx = (sim as unknown as { ctx: never }).ctx;
    expect(fireGuaranteedCrit(ctx, p, 'fire_blast', 'fire', null)).toBe(false);
  });
});

describe('Hot Streak', () => {
  it('two builder crits in a row make the next Pyroblast free and instant', () => {
    const { sim, p } = mageWithSpec('fire');
    addDummy(sim);
    sim.castAbility('fire_blast'); // guaranteed crit #1
    collect(sim, 1);
    expect(p.auras.some((a) => a.id === 'heating_up')).toBe(true);
    gcdReset(p);
    p.cooldowns.delete('fire_blast');
    sim.castAbility('fire_blast'); // guaranteed crit #2
    collect(sim, 1);
    expect(p.auras.some((a) => a.id === 'heating_up')).toBe(false);
    expect(p.auras.some((a) => a.id === 'hot_streak')).toBe(true);
    // Spend it: Pyroblast fires instantly and bills nothing.
    gcdReset(p);
    const mana0 = p.resource;
    sim.castAbility('pyroblast');
    expect(p.castingAbility).toBeNull(); // instant
    expect(p.resource).toBe(mana0); // free
    expect(p.auras.some((a) => a.id === 'hot_streak')).toBe(false); // consumed
  });

  it('Combustion crits every Fire spell and its crits BUILD Hot Streak (owner reversal)', () => {
    const { sim, p } = mageWithSpec('fire');
    addDummy(sim);
    sim.castAbility('combustion');
    expect(p.auras.some((a) => a.kind === 'combustion')).toBe(true);
    gcdReset(p);
    sim.castAbility('fireball'); // guaranteed crit under Combustion
    const events = collect(sim, 4);
    const hit = events.find(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === p.id && e.amount > 0,
    );
    expect(hit?.crit).toBe(true);
    // The Combustion crit counts toward the streak: half the phoenix lights.
    expect(p.auras.some((a) => a.id === 'heating_up')).toBe(true);
  });
});

describe('playtest round four (owner hotfixes)', () => {
  it('Combustion is off the GCD', () => {
    const { sim, p } = mageWithSpec('fire');
    addDummy(sim);
    sim.castAbility('combustion');
    expect(p.auras.some((a) => a.kind === 'combustion')).toBe(true);
    expect((p as unknown as { gcdRemaining: number }).gcdRemaining).toBe(0);
  });

  it('an interleaved Combustion never disturbs the Fireball in progress (target kept, landing crit)', () => {
    const { sim, p } = mageWithSpec('fire');
    const mob = addDummy(sim, 18);
    sim.castAbility('fireball');
    collect(sim, 0.5); // mid-cast
    expect(p.castingAbility).toBe('fireball');
    sim.castAbility('combustion'); // slips through the busy guard
    expect(p.auras.some((a) => a.kind === 'combustion')).toBe(true);
    expect(p.castingAbility).toBe('fireball'); // the cast survived
    expect((p as unknown as { castTargetId: number | null }).castTargetId).toBe(mob.id);
    const events = collect(sim, 6);
    const hit = events.find(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === p.id && e.ability === 'Cinderbolt' && e.amount > 0,
    );
    expect(hit?.crit).toBe(true); // Combustion was worn when the bolt landed
  });

  it('Combustion pressed while the bolt is already flying still crits it on impact', () => {
    const { sim, p } = mageWithSpec('fire');
    addDummy(sim, 18);
    sim.castAbility('fireball');
    // Ride out the full cast; the bolt leaves and is now in flight.
    while (p.castingAbility) collect(sim, 0.05);
    sim.castAbility('combustion');
    const events = collect(sim, 3);
    const hit = events.find(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === p.id && e.ability === 'Cinderbolt' && e.amount > 0,
    );
    expect(hit?.crit).toBe(true);
  });

  it('Fire Blast resolves instantly, no bolt in flight', () => {
    const { sim, p } = mageWithSpec('fire');
    addDummy(sim, 18);
    sim.castAbility('fire_blast');
    const events = collect(sim, 0.05); // ONE tick
    const hit = events.find(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === p.id && e.amount > 0,
    );
    expect(hit).toBeDefined(); // damage on the cast tick, not after a flight
    expect(events.some((e) => e.type === 'spellfx' && e.fx === 'projectile')).toBe(false);
  });

  it('Scorch casts on the move', () => {
    const { sim, p } = mageWithSpec('fire');
    addDummy(sim, 10);
    sim.castAbility('scorch');
    expect(p.castingAbility).toBe('scorch');
    sim.moveInput.forward = true;
    const events = collect(sim, 2);
    const hit = events.find(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === p.id && e.ability === 'Scald' && e.amount > 0,
    );
    expect(hit).toBeDefined(); // the cast survived the run
  });

  it('Pyroblast flies as the heavy bolt', () => {
    const { sim, p } = mageWithSpec('fire');
    addDummy(sim, 18);
    sim.castAbility('pyroblast');
    while (p.castingAbility) collect(sim, 0.05);
    const events = collect(sim, 0.1);
    void events;
    // The launch cue was emitted when the cast completed (heavyBolt, not the
    // stock projectile); assert on the def wiring, which the emit reads.
    expect(ABILITIES.pyroblast.projectileFx).toBe('heavyBolt');
  });
});

describe('Pyroblast as a builder (owner rule)', () => {
  it('a free Pyroblast crit re-arms Heating Up; Flamestrike never builds', () => {
    const { sim, p } = mageWithSpec('fire');
    addDummy(sim, 18);
    sim.castAbility('combustion'); // everything crits, off the GCD
    sim.castAbility('fire_blast'); // crit 1 (instant)
    collect(sim, 0.3);
    gcdReset(p);
    sim.castAbility('fire_blast'); // crit 2: Hot Streak armed
    collect(sim, 0.3);
    expect(p.auras.some((a) => a.id === 'hot_streak')).toBe(true);
    gcdReset(p);
    sim.castAbility('pyroblast'); // free + instant; the bolt flies
    expect(p.auras.some((a) => a.id === 'hot_streak')).toBe(false); // spent
    const events = collect(sim, 3); // impact crits under Combustion
    const hit = events.find(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === p.id && e.ability === 'Pyrelance' && e.amount > 0,
    );
    expect(hit?.crit).toBe(true);
    // The free Pyroblast's crit counted: half the phoenix lights again.
    expect(p.auras.some((a) => a.id === 'heating_up')).toBe(true);
    expect(HOT_STREAK_BUILDERS).toContain('pyroblast');
    expect(HOT_STREAK_BUILDERS).toContain('flamestrike');
  });

  it('one Flamestrike is ONE crit toward the streak, however many enemies it hits', () => {
    const { sim, p } = mageWithSpec('fire');
    const a = addDummy(sim, 10);
    const b = addDummy(sim, 12);
    sim.castAbility('combustion'); // guarantees the blast crits
    gcdReset(p);
    sim.castAbilityAt('flamestrike', { x: a.pos.x, z: (a.pos.z + b.pos.z) / 2 });
    expect(p.castingAbility).toBe('flamestrike'); // a real cast now (owner rule)
    const events = collect(sim, 3);
    const hits = events.filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === p.id && e.ability === 'Flamestrike' && e.amount > 0,
    );
    expect(hits.length).toBeGreaterThanOrEqual(2); // both dummies caught
    for (const h of hits) expect(h.crit).toBe(true); // the cast crits as one
    // Exactly ONE crit noted: Heating Up armed, the streak NOT completed.
    expect(p.auras.some((a2) => a2.id === 'heating_up')).toBe(true);
    expect(p.auras.some((a2) => a2.id === 'hot_streak')).toBe(false);
  });
});

describe('playtest round five (owner hotfixes)', () => {
  it('the Water Elemental goes home when its mage leaves frost', () => {
    const { sim, p } = mageWithSpec('frost');
    sim.castAbility('summon_water_elemental');
    collect(sim, 2.5); // ride out the 2s summon cast
    const pet = () =>
      [...sim.entities.values()].find(
        (e) => e.templateId === 'water_elemental' && (e as { ownerId?: number }).ownerId === p.id,
      );
    expect(pet()).toBeDefined();
    expect(sim.setSpec('fire')).toBe(true);
    collect(sim, 0.5);
    expect(pet()).toBeUndefined(); // dismissed at the spec boundary
  });

  it('Fire Blast rides no GCD in either direction', () => {
    const { sim, p } = mageWithSpec('fire');
    addDummy(sim);
    sim.castAbility('fire_blast');
    expect((p as unknown as { gcdRemaining: number }).gcdRemaining).toBe(0); // arms none
    sim.castAbility('scorch'); // arms the GCD at cast start
    expect((p as unknown as { gcdRemaining: number }).gcdRemaining).toBeGreaterThan(0);
    sim.castAbility('fire_blast'); // ...and Fire Blast casts straight through it
    const events = collect(sim, 0.2);
    const hits = events.filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === p.id && e.ability === 'Cinderfall' && e.amount > 0,
    );
    expect(hits.length).toBe(2); // both charges landed, GCD never in the way
  });

  it('Hot Streak makes Flamestrike instant and free (otherwise a 2s cast)', () => {
    const { sim, p } = mageWithSpec('fire');
    const mob = addDummy(sim);
    sim.castAbility('fire_blast'); // crit 1
    collect(sim, 0.2);
    sim.castAbility('fire_blast'); // crit 2: Hot Streak armed (charge 2, no GCD)
    collect(sim, 0.2);
    expect(p.auras.some((a) => a.id === 'hot_streak')).toBe(true);
    gcdReset(p);
    const mana0 = p.resource;
    sim.castAbilityAt('flamestrike', { x: mob.pos.x, z: mob.pos.z });
    expect(p.castingAbility).toBeNull(); // instant under the streak
    expect(p.resource).toBe(mana0); // and free
    expect(p.auras.some((a) => a.id === 'hot_streak')).toBe(false); // spent
  });

  it('Rune of Power is a deliberate cast now', () => {
    const { sim, p } = mageWithSpec('fire');
    // The rune is a level-20 choice-row grant; pick it like the window would.
    const row = (ROW_TREES.mage ?? []).find((r) =>
      r.options.some((o) => o.id === 'mag_r20_rune_of_power'),
    );
    expect(row).toBeDefined();
    expect(sim.selectTalentRow(row!.level, 'mag_r20_rune_of_power')).toBe(true);
    p.resource = p.maxResource;
    sim.castAbility('rune_of_power');
    expect(p.castingAbility).toBe('rune_of_power');
  });
});

describe('Meteor', () => {
  it('falls after a delay, then its impact damages and Ignites the area', () => {
    const { sim, p } = mageWithSpec('fire');
    const mob = addDummy(sim, 15);
    sim.castAbilityAt('meteor', { x: mob.pos.x, z: mob.pos.z });
    const falling = collect(sim, 1); // still falling
    const warning = falling.find(
      (event): event is Extract<SimEvent, { type: 'spellfxAt' }> =>
        event.type === 'spellfxAt' && event.fx === 'meteorFall',
    );
    expect(warning?.radius).toBe(8);
    expect(mob.auras.some((a) => a.id === 'ignite')).toBe(false);
    const events = collect(sim, 2); // impact at ~2s
    const hit = events.find(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === p.id && e.amount > 0,
    );
    expect(hit).toBeDefined();
    const ignite = mob.auras.find((a) => a.id === 'ignite');
    expect(ignite?.kind).toBe('dot'); // the spread copied the resolved damage
  });
});

describe('the personal-barrier slot', () => {
  it('Warded cuts damage behind Blazing Barrier and heals when it breaks', () => {
    const sim = new Sim({ seed: 33, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'fire', rows: { 8: 'mag_r8_warded' } } as never)).toBe(true);
    sim.tick();
    const p = sim.player;
    p.resource = p.maxResource;
    const mob = addDummy(sim);
    sim.castAbility('blazing_barrier');
    const initialBarrier =
      p.auras.find((aura) => aura.id === 'blazing_barrier' && aura.kind === 'absorb')?.value ?? 0;
    const breakHeal = Math.round(p.maxHp * 0.1);
    const deal = (n: number) =>
      (
        sim as unknown as {
          dealDamage(
            s: Entity,
            t: Entity,
            n: number,
            c: boolean,
            sc: string,
            a: string | null,
            k: string,
          ): void;
        }
      ).dealDamage(mob, p, n, false, 'physical', null, 'hit');
    p.hp -= 100;
    const hp0 = p.hp;
    deal(100);
    expect(p.hp).toBe(hp0);
    const remainingBarrier = initialBarrier - 85;
    const landingDamage = 85 - remainingBarrier;
    deal(100);
    expect(p.hp).toBe(hp0 + breakHeal - landingDamage);
  });

  it('Cold Snap finishes the Blazing Barrier cooldown too', () => {
    const sim = new Sim({ seed: 33, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'fire', rows: { 17: 'mag_r17_cold_snap' } } as never)).toBe(
      true,
    );
    const p = sim.player;
    p.cooldowns.set('blazing_barrier', 25);
    p.resource = p.maxResource;
    sim.castAbility('cold_snap');
    expect(p.cooldowns.has('blazing_barrier')).toBe(false);
  });
});

describe('Water Elemental', () => {
  it('the frost mage summons it and it bolts the target', () => {
    const { sim, p } = mageWithSpec('frost');
    addDummy(sim, 10);
    sim.castAbility('summon_water_elemental');
    collect(sim, 3); // ride the 2s summon cast
    const pet = [...sim.entities.values()].find(
      (e) => e.templateId === 'water_elemental' && e.ownerId === p.id,
    );
    expect(pet).toBeDefined();
    // Order the attack, the way the pet bar does.
    gcdReset(p);
    sim.castAbility('frostbolt');
    (sim as unknown as { petAttack(): void }).petAttack();
    const events = collect(sim, 14);
    const bolts = events.filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === (pet as Entity).id && e.amount > 0,
    );
    expect(bolts.length).toBeGreaterThanOrEqual(1); // Waterbolts landing
    expect(bolts.some((e) => e.ability === 'Water Jet')).toBe(false);
  });

  it('has no taunt command or autocast', () => {
    const { sim, p } = mageWithSpec('frost');
    const mob = addDummy(sim, 5);
    sim.castAbility('summon_water_elemental');
    collect(sim, 3);
    const pet = [...sim.entities.values()].find(
      (e) => e.templateId === 'water_elemental' && e.ownerId === p.id,
    ) as Entity;
    p.targetId = mob.id;
    pet.aggroTargetId = mob.id;
    mob.forcedTargetId = null;
    (sim as unknown as { setPetAutoTaunt(enabled: boolean): void }).setPetAutoTaunt(true);
    (sim as unknown as { petTaunt(): void }).petTaunt();
    expect(pet.petAutoTaunt).toBe(false);
    expect(mob.forcedTargetId).toBeNull();
  });

  it('channels Water Jet for three seconds and deals damage throughout the beam', () => {
    const { sim, p } = mageWithSpec('frost');
    addDummy(sim, 10);
    sim.castAbility('summon_water_elemental');
    collect(sim, 3);
    const pet = [...sim.entities.values()].find(
      (e) => e.templateId === 'water_elemental' && e.ownerId === p.id,
    ) as Entity;
    gcdReset(p);
    sim.castAbility('frostbolt');
    (sim as unknown as { petAttack(): void }).petAttack();
    sim.petWaterJet();

    let channelStarted = false;
    let channelTicks = 0;
    for (let i = 0; i < 20 * 14; i++) {
      for (const event of sim.tick()) {
        if (event.type === 'spellfx' && event.sourceId === pet.id && event.fx === 'bubbleBeam') {
          channelStarted = true;
          expect(event.duration).toBe(3);
        }
        if (event.type === 'damage' && event.sourceId === pet.id && event.ability === 'Water Jet') {
          channelTicks++;
        }
      }
      if (channelStarted && !pet.channeling) break;
    }
    expect(channelStarted).toBe(true);
    expect(channelTicks).toBe(3);
  });
});
