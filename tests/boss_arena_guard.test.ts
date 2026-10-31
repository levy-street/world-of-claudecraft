import { describe, expect, it } from 'vitest';
import { MOON_ALTAR } from '../src/sim/content/drowned_temple_layout';
import { RITUAL_VAULT, WYRMS_HOLLOW } from '../src/sim/content/gravewyrm_sanctum_layout';
import { startRisingTide } from '../src/sim/encounters/drowned_temple/ysolei';
import { korzulDevTrigger } from '../src/sim/encounters/gravewyrm_sanctum/korzul';
import { velkharDevTrigger } from '../src/sim/encounters/gravewyrm_sanctum/velkhar';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const CASES = [
  { id: 'ysolei', dev: 'temple', arena: MOON_ALTAR },
  { id: 'grand_necromancer_velkhar', dev: 'sanctum', arena: RITUAL_VAULT },
  {
    id: 'korzul_the_gravewyrm',
    dev: 'sanctum',
    arena: { ...WYRMS_HOLLOW, r: WYRMS_HOLLOW.shelfR },
  },
] as const;

function setup(c: (typeof CASES)[number]) {
  const sim = new Sim({ seed: 42, playerClass: 'mage', devCommands: true });
  sim.chat('/dev level 20');
  sim.chat(`/dev ${c.dev} enter normal`);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('Missing claim');
  const boss = inst.mobIds.map((id) => sim.entities.get(id)).find((e) => e?.templateId === c.id);
  if (!boss) throw new Error('Missing boss');
  for (const id of inst.mobIds) {
    const e = sim.entities.get(id);
    if (e && e !== boss) {
      e.dead = true;
      e.hp = 0;
    }
  }
  const o = sim.ctx.instanceOriginOf(inst);
  const place = (e: Entity, dx: number, dz = 0) => {
    e.pos = sim.ctx.groundPos(o.x + c.arena.x + dx, o.z + c.arena.z + dz);
    e.prevPos = { ...e.pos };
    sim.ctx.rebucket(e);
  };
  place(sim.player, -3);
  sim.player.gm = true;
  if (c.id === 'korzul_the_gravewyrm') korzulDevTrigger(sim.ctx, inst, boss, 'breath');
  sim.ctx.aggroMob(boss, sim.player, false);
  boss.hp = Math.floor(boss.maxHp * 0.9);
  sim.tick();
  sim.drainEvents();
  return { sim, inst, boss, place };
}

describe.each(CASES)('authored boss arena: $id', (c) => {
  it('rejects direct and periodic damage from outside, even before a lethal hit', () => {
    const { sim, boss, place } = setup(c);
    place(sim.player, c.arena.r + 5);
    const hp = boss.hp;
    for (const direct of [true, false]) {
      sim.ctx.dealDamage(
        sim.player,
        boss,
        boss.maxHp * 2,
        false,
        'arcane',
        null,
        'hit',
        false,
        undefined,
        direct,
      );
      expect(boss.hp).toBe(hp);
      expect(boss.dead).toBe(false);
      const hits = sim.drainEvents().filter((event) => event.type === 'damage');
      if (direct)
        expect(hits).toContainEqual(expect.objectContaining({ kind: 'evade', amount: 0 }));
      else expect(hits).toEqual([]);
    }
  });

  it('resets when the last combatant leaves the arena, cancelling a planted cast', () => {
    const { sim, boss, place } = setup(c);
    boss.castingAbility = 'arena_test_cast';
    boss.castRemaining = 10;
    boss.castTotal = 10;
    place(sim.player, c.arena.r + 5);
    sim.tick();
    expect(boss.aiState).toBe('evade');
    expect(boss.aggroTargetId).toBeNull();
    expect(boss.threat.size).toBe(0);
    expect(boss.castingAbility).toBeNull();
    for (let n = 0; n < 200 && boss.aiState === 'evade'; n++) sim.tick();
    expect(boss.hp).toBe(boss.maxHp);
    expect(boss.inCombat).toBe(false);
  });

  it('keeps an ordinary ranged player inside the arena in combat', () => {
    const { sim, boss, place } = setup(c);
    place(sim.player, c.arena.r - 2);
    const hp = boss.hp;
    sim.ctx.dealDamage(sim.player, boss, 1, false, 'arcane', null, 'hit');
    expect(boss.hp).toBeLessThan(hp);
    sim.tick();
    expect(boss.aiState).not.toBe('evade');
    expect(boss.aggroTargetId).toBe(sim.player.id);
  });

  it('refuses a pet attacking from a safe owner outside the arena', () => {
    const { sim, boss, place } = setup(c);
    const pet = { ...sim.player, id: 990001, kind: 'mob', ownerId: sim.player.id } as Entity;
    place(pet, -3);
    sim.entities.set(pet.id, pet);
    place(sim.player, c.arena.r + 5);
    const hp = boss.hp;
    sim.ctx.dealDamage(pet, boss, 100, false, 'physical', null, 'hit');
    expect(boss.hp).toBe(hp);
  });

  it('evades even when a pinned boss is pulled off its floor', () => {
    const { sim, boss, place } = setup(c);
    place(boss, c.arena.r + 20);
    boss.evadeInPlace = 0;
    boss.leashAnchor = { ...boss.pos };
    sim.tick();
    expect(boss.aiState).toBe('evade');
    expect(boss.evadeInPlace).toBeUndefined();
  });

  it('refuses attacks from an overlapping lower floor', () => {
    const { sim, boss } = setup(c);
    sim.player.pos.y = c.arena.h - 8;
    const hp = boss.hp;
    sim.ctx.dealDamage(sim.player, boss, 100, false, 'arcane', null, 'hit');
    expect(boss.hp).toBe(hp);
  });

  it.each([3, 8])('keeps jumps and class flights above the floor legal (%s yd)', (height) => {
    const { sim, boss } = setup(c);
    sim.player.pos.y = c.arena.h + height;
    const hp = boss.hp;
    sim.ctx.dealDamage(sim.player, boss, 1, false, 'arcane', null, 'hit');
    expect(boss.hp).toBeLessThan(hp);
  });

  it('permits an inside pet and owner but rejects a pet outside with its owner inside', () => {
    const { sim, boss, place } = setup(c);
    const pet = { ...sim.player, id: 990002, kind: 'mob', ownerId: sim.player.id } as Entity;
    place(pet, -3);
    sim.entities.set(pet.id, pet);
    const hp = boss.hp;
    sim.ctx.dealDamage(pet, boss, 10, false, 'physical', null, 'hit');
    expect(boss.hp).toBeLessThan(hp);
    const after = boss.hp;
    place(pet, c.arena.r + 5);
    sim.ctx.dealDamage(pet, boss, 100, false, 'physical', null, 'hit');
    expect(boss.hp).toBe(after);
  });

  it('retargets the inside tank when an outside taunter owns current and forced aggro', () => {
    const { sim, boss, place } = setup(c);
    const id = sim.addPlayer('warrior', 'OutsideTaunter');
    const outside = sim.entities.get(id);
    if (!outside) throw new Error('Missing taunter');
    place(outside, c.arena.r + 5);
    boss.threat.set(sim.player.id, 100);
    boss.threat.set(outside.id, 1000);
    boss.aggroTargetId = outside.id;
    boss.forcedTargetId = outside.id;
    boss.forcedTargetTimer = 3;
    sim.tick();
    expect(boss.aiState).not.toBe('evade');
    expect(boss.aggroTargetId).toBe(sim.player.id);
    expect(boss.forcedTargetId).toBeNull();
    expect(boss.threat.has(outside.id)).toBe(false);
  });

  it('preserves a valid inside taunt when the previous target walks outside', () => {
    const { sim, boss, place } = setup(c);
    const id = sim.addPlayer('warrior', 'LeavingTank');
    const outside = sim.entities.get(id);
    if (!outside) throw new Error('Missing old tank');
    place(outside, c.arena.r + 5);
    boss.threat.set(sim.player.id, 100);
    boss.threat.set(outside.id, 1000);
    boss.aggroTargetId = outside.id;
    boss.forcedTargetId = sim.player.id;
    boss.forcedTargetTimer = 3;
    sim.tick();
    expect(boss.aiState).not.toBe('evade');
    expect(boss.aggroTargetId).toBe(sim.player.id);
    expect(boss.forcedTargetId).toBe(sim.player.id);
    expect(boss.forcedTargetTimer).toBeGreaterThan(0);
  });
});

describe('recesses just past the authored edge', () => {
  const VELKHAR = CASES[1];
  const KORZUL = CASES[2];
  const at = (r: number, deg: number): [number, number] => [
    Math.sin((deg * Math.PI) / 180) * r,
    Math.cos((deg * Math.PI) / 180) * r,
  ];
  // Measured stopping points: walls and seals hold a player here, unmarked.
  it.each([
    ['Velkhar north door', VELKHAR, 0, 19.1],
    ['Velkhar north door corner', VELKHAR, ...at(19.7, 15)],
    ['Velkhar south door corner', VELKHAR, ...at(20.5, 165)],
    ['Korzul south shelf', KORZUL, 0, -47.6],
  ] as const)('keeps a player standing in the %s in the fight', (_name, c, dx, dz) => {
    const { sim, boss, place } = setup(c);
    place(sim.player, dx, dz);
    const hp = boss.hp;
    sim.ctx.dealDamage(sim.player, boss, 1, false, 'arcane', null, 'hit');
    expect(boss.hp).toBeLessThan(hp);
    sim.tick();
    expect(boss.aiState).not.toBe('evade');
    expect(boss.aggroTargetId).toBe(sim.player.id);
  });

  it('still refuses a player past the recess margin', () => {
    const { sim, boss, place } = setup(KORZUL);
    place(sim.player, 0, -(KORZUL.arena.r + 2.5));
    const hp = boss.hp;
    sim.ctx.dealDamage(sim.player, boss, 1, false, 'arcane', null, 'hit');
    expect(boss.hp).toBe(hp);
  });
});

describe('scripted arena reset cleanup', () => {
  it('clears Ysolei rising tide when the last opponent leaves', () => {
    const { sim, inst, boss, place } = setup(CASES[0]);
    const state = boss.templeFight;
    if (state?.kind !== 'ysolei') throw new Error('Missing Ysolei state');
    startRisingTide(sim.ctx, inst, boss, state);
    expect(state.tide).not.toBeNull();
    place(sim.player, MOON_ALTAR.r + 5);
    sim.tick();
    expect(boss.aiState).toBe('evade');
    expect(boss.templeFight).toBeUndefined();
  });

  it('despawns Velkhar walkers and floor objects on an outside retreat', () => {
    const { sim, inst, boss, place } = setup(CASES[1]);
    velkharDevTrigger(sim.ctx, inst, boss, 'wave');
    velkharDevTrigger(sim.ctx, inst, boss, 'trench');
    const state = boss.sanctumFight;
    if (state?.kind !== 'velkhar') throw new Error('Missing Velkhar state');
    const adds = state.walkers.map((w) => w.id);
    expect(adds.length).toBeGreaterThan(0);
    const objects = inst.objectIds.filter(
      (id) => sim.entities.get(id)?.templateId === 'sanctum_trench_lane',
    );
    place(sim.player, RITUAL_VAULT.r + 5);
    sim.tick();
    expect(boss.sanctumFight).toBeUndefined();
    for (const id of [...adds, ...objects]) expect(sim.entities.has(id)).toBe(false);
  });

  it('preserves Korzul normal flight and clears airborne immunity, marks and plates on reset', () => {
    const { sim, inst, boss, place } = setup(CASES[2]);
    korzulDevTrigger(sim.ctx, inst, boss, 'flight');
    const state = boss.sanctumFight;
    if (state?.kind !== 'korzul') throw new Error('Missing Korzul state');
    for (let n = 0; n < 200 && state.phase !== 'air'; n++) sim.tick();
    expect(state.phase).toBe('air');
    expect(boss.damageImmune).toBe(true);
    expect(boss.aiState).not.toBe('evade');
    korzulDevTrigger(sim.ctx, inst, boss, 'plunge');
    sim.tick();
    const markers = [...(state.flight?.plunge?.objectIds ?? [])];
    expect(markers.length).toBeGreaterThan(0);
    korzulDevTrigger(sim.ctx, inst, boss, 'break 0');
    expect(state.plates[0].state).toBe('broken');
    place(sim.player, WYRMS_HOLLOW.shelfR + 5);
    sim.tick();
    expect(boss.aiState).toBe('evade');
    expect(boss.damageImmune).toBe(false);
    expect(state.flight).toBeNull();
    expect(state.phase).toBe('ready');
    expect(state.plates.every((p) => p.state === 'sound')).toBe(true);
    for (const id of markers) expect(sim.entities.has(id)).toBe(false);
    for (let n = 0; n < 300 && boss.aiState === 'evade'; n++) sim.tick();
    expect(boss.hp).toBe(boss.maxHp);
    place(sim.player, -3);
    sim.ctx.aggroMob(boss, sim.player, false);
    sim.tick();
    expect(state.phase).toBe('ground');
  });
});
