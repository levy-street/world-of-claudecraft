import { describe, expect, it } from 'vitest';
import { isRooted } from '../src/sim/combat/cc';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { grantDevotion } from '../src/sim/paladin_devotion';
import { moveSpeedMult } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
};

function makeProtection(seed = 8117): TestSim {
  const sim = new Sim({ seed, playerClass: 'paladin', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('protection')).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.pos = { x: 0, y: sim.player.pos.y, z: -40 };
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.facing = 0;
  sim.grid.update(sim.player);
  sim.playerGrid.update(sim.player);
  return sim;
}

function targetAt(sim: TestSim, x: number, z: number): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x,
    y: sim.player.pos.y,
    z,
  });
  mob.maxHp = 50_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  // Unbreakable: the Veil Mark's own damage ticks would break an ordinary
  // root (classic break-on-damage) and let the aggroed mob close the gap,
  // which is exactly the drift the distance assertions must not see.
  mob.auras.push({ ...aura('test_pin', 'root', mob.id, 60), unbreakableControl: true });
  sim.addEntity(mob);
  return mob;
}

function aura(id: string, kind: Aura['kind'], sourceId: number, duration = 30): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: duration,
    duration,
    value: kind === 'slow' ? 0.2 : 0,
    sourceId,
    school: 'shadow',
  };
}

function walkInto(sim: TestSim, targets: Entity[]): void {
  sim.moveInput.forward = true;
  for (let tick = 0; tick < 4; tick++) sim.tick();
  sim.moveInput.forward = false;
  // Movement intent decays over a grace window instead of stopping on the tick
  // input clears (the black-holed-drop resume), so settle until the player
  // actually stands still before callers measure or reposition against them.
  for (let tick = 0; tick < 40; tick++) {
    const { x, z } = sim.player.pos;
    sim.tick();
    if (sim.player.pos.x === x && sim.player.pos.z === z) break;
  }
  for (const target of targets) {
    expect(target.auras).toContainEqual(
      expect.objectContaining({ id: 'veilbound_mark', sourceId: sim.playerId, kind: 'dot' }),
    );
  }
}

describe('Veilbound March', () => {
  it('is a Protection-only 75-second cooldown that triggers the global cooldown', () => {
    const sim = makeProtection();
    const ability = ABILITIES.veilbound_march;

    expect(ability).toMatchObject({
      id: 'veilbound_march',
      specs: ['protection'],
      learnLevel: 18,
      cost: 0,
      cooldown: 75,
      castTime: 0,
      requiresTarget: false,
      school: 'holy',
    });
    expect(ability?.offGcd).not.toBe(true);

    sim.castAbility('veilbound_march');

    expect(sim.player.cooldowns.get('veilbound_march')).toBe(75);
    expect(sim.player.gcdRemaining).toBeGreaterThan(0);
  });

  it('cannot be canceled early, keeping its paired armor and mandatory final wave coherent', () => {
    const sim = makeProtection();
    const marked = targetAt(sim, 0, -39.4);
    const baseArmor = sim.player.stats.armor;
    sim.castAbility('veilbound_march');
    walkInto(sim, [marked]);
    const events = [...sim.drainEvents()];

    sim.cancelAura('veilbound_march');

    expect(sim.player.auras.some((active) => active.id === 'veilbound_march')).toBe(true);
    expect(sim.player.auras.some((active) => active.id === 'veilbound_march_armor')).toBe(true);
    expect(sim.player.stats.armor).toBe(Math.round(baseArmor * 1.3));
    expect(
      events.some((event) => event.type === 'damage' && event.ability === 'Veilbound March'),
    ).toBe(false);

    for (let tick = 0; tick < 4 * 20; tick++) events.push(...sim.tick());
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'damage',
        targetId: marked.id,
        ability: 'Veilbound March',
        amount: 36,
      }),
    );
    expect(sim.player.stats.armor).toBe(baseArmor);
  });

  it('grants 40% speed and 30% armor, cleanses and blocks movement control, but not stun or silence', () => {
    const sim = makeProtection();
    const attacker = targetAt(sim, 2, -40);
    const baseArmor = sim.player.stats.armor;
    sim.player.auras.push(aura('old_root', 'root', attacker.id));
    sim.player.auras.push(aura('old_slow', 'slow', attacker.id));

    sim.castAbility('veilbound_march');

    expect(moveSpeedMult(sim.player)).toBeCloseTo(1.4);
    expect(sim.player.stats.armor).toBe(Math.round(baseArmor * 1.3));
    expect(isRooted(sim.player)).toBe(false);
    expect(
      sim.player.auras.some((active) => active.kind === 'root' || active.kind === 'slow'),
    ).toBe(false);

    sim.ctx.applyAura(sim.player, aura('new_root', 'root', attacker.id));
    sim.ctx.applyAura(sim.player, aura('new_slow', 'slow', attacker.id));
    sim.ctx.applyAura(sim.player, aura('new_stun', 'stun', attacker.id));
    sim.ctx.applyAura(sim.player, aura('new_silence', 'silence', attacker.id));

    expect(sim.player.auras.some((active) => active.id === 'new_root')).toBe(false);
    expect(sim.player.auras.some((active) => active.id === 'new_slow')).toBe(false);
    expect(sim.player.auras.some((active) => active.id === 'new_stun')).toBe(true);
    expect(sim.player.auras.some((active) => active.id === 'new_silence')).toBe(true);
    const before = { ...sim.player.pos };
    expect(sim.ctx.applyKnockback(attacker, sim.player, 8)).toBe(0);
    expect(sim.player.pos).toEqual(before);
  });

  it('does not cleanse encounter-authored unbreakable movement control on activation', () => {
    const sim = makeProtection();
    const attacker = targetAt(sim, 2, -40);
    sim.player.auras.push({
      ...aura('scripted_root', 'root', attacker.id),
      unbreakableControl: true,
    });
    sim.player.auras.push(aura('ordinary_slow', 'slow', attacker.id));

    sim.castAbility('veilbound_march');

    expect(sim.player.auras.some((active) => active.id === 'scripted_root')).toBe(true);
    expect(sim.player.auras.some((active) => active.id === 'ordinary_slow')).toBe(false);
  });

  it('marks every traversed enemy once and grants only one extra Devotion from traversal', () => {
    const sim = makeProtection();
    const first = targetAt(sim, -0.25, -39.4);
    const second = targetAt(sim, 0.25, -39.4);
    sim.castAbility('veilbound_march');

    walkInto(sim, [first, second]);
    for (let tick = 0; tick < 4; tick++) sim.tick();

    expect(first.auras.filter((active) => active.id === 'veilbound_mark')).toHaveLength(1);
    expect(second.auras.filter((active) => active.id === 'veilbound_mark')).toHaveLength(1);
    // One march grants exactly one traversal Devotion (the ability text: "The
    // first mark grants 1 Devotion"); veilbound_march has no cast-time Devotion
    // row in DEVOTION_GAIN, so the total from zero is 1.
    expect(sim.player.paladinDevotion?.value).toBe(1);
  });

  it('ticks Holy damage and triple threat for six seconds, and reduces only its damage to the marking Paladin', () => {
    const sim = makeProtection();
    const marked = targetAt(sim, 0, -39.4);
    sim.castAbility('veilbound_march');
    walkInto(sim, [marked]);
    const events = [...sim.drainEvents()];

    const ownerHp = sim.player.hp;
    sim.ctx.dealDamage(marked, sim.player, 100, false, 'holy', 'Marked Test', 'hit');
    expect(ownerHp - sim.player.hp).toBe(80);

    const allyId = sim.addPlayer('warrior', 'March Ally');
    const ally = sim.entities.get(allyId);
    expect(ally).toBeDefined();
    if (!ally) throw new Error('missing March Ally');
    ally.hp = ally.maxHp;
    const allyHp = ally.hp;
    sim.ctx.dealDamage(marked, ally, 100, false, 'holy', 'Marked Test', 'hit');
    expect(allyHp - ally.hp).toBe(100);

    for (let tick = 0; tick < 6 * 20; tick++) events.push(...sim.tick());
    const markTicks = events.filter(
      (event) =>
        event.type === 'damage' && event.targetId === marked.id && event.ability === 'Veil Mark',
    );
    const markDamage = markTicks.reduce(
      (total, event) => total + (event.type === 'damage' ? event.amount : 0),
      0,
    );

    expect(markTicks).toHaveLength(6);
    expect(markDamage).toBe(72);
    expect(marked.threat.get(sim.playerId) ?? 0).toBeGreaterThanOrEqual(markDamage * 3);
    expect(marked.auras.some((active) => active.id === 'veilbound_mark')).toBe(false);
  });

  it('ends after four seconds with a nearby marked-enemy wave and no extra Devotion', () => {
    const sim = makeProtection();
    const inside = targetAt(sim, 0, -39.4);
    const outside = targetAt(sim, 0.3, -39.4);
    sim.castAbility('veilbound_march');
    walkInto(sim, [inside, outside]);
    outside.pos.z = sim.player.pos.z + 11;
    sim.grid.update(outside);
    const events = [...sim.drainEvents()];
    const baseArmor = sim.player.stats.armor / 1.3;

    for (let tick = 0; tick < 4 * 20; tick++) events.push(...sim.tick());
    const finalHits = events.filter(
      (event) => event.type === 'damage' && event.ability === 'Veilbound March',
    );

    expect(finalHits).toEqual([
      expect.objectContaining({ targetId: inside.id, amount: 36, school: 'holy' }),
    ]);
    // "No extra Devotion": the march's single traversal grant is the only
    // Devotion in the window (no cast-time or final-wave row in DEVOTION_GAIN).
    expect(sim.player.paladinDevotion?.value).toBe(1);
    expect(sim.player.auras.some((active) => active.id === 'veilbound_march')).toBe(false);
    expect(moveSpeedMult(sim.player)).toBe(1);
    expect(sim.player.stats.armor).toBe(Math.round(baseArmor));
  });

  it('uses one Ascension charge to empower the final wave by 50% and pull marked enemies 2 m', () => {
    const sim = makeProtection();
    const marked = targetAt(sim, 0, -39.4);
    grantDevotion(sim.player, 20);
    sim.castAbility('divine_ascension');
    sim.castAbility('veilbound_march');
    expect(sim.player.paladinDevotion?.ascensionCharges).toBe(4);
    walkInto(sim, [marked]);
    marked.pos.z = sim.player.pos.z + 6;
    sim.grid.update(marked);
    const beforeDistance = Math.hypot(
      marked.pos.x - sim.player.pos.x,
      marked.pos.z - sim.player.pos.z,
    );
    const events = [...sim.drainEvents()];

    for (let tick = 0; tick < 4 * 20; tick++) events.push(...sim.tick());

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'damage',
        targetId: marked.id,
        ability: 'Veilbound March',
        amount: 54,
      }),
    );
    expect(
      Math.hypot(marked.pos.x - sim.player.pos.x, marked.pos.z - sim.player.pos.z),
    ).toBeCloseTo(beforeDistance - 2, 1);
    expect(sim.player.paladinDevotion?.value).toBe(0);
  });
});
