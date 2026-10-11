import { describe, expect, it, vi } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import { updateCasting } from '../src/sim/combat/casting_lifecycle';
import { cleanupPriestState } from '../src/sim/combat/priest/lifecycle';
import {
  recordGloomtitheGeneration,
  spiritBombProgress,
} from '../src/sim/combat/priest/spirit_bomb';
import { beginSpiritBombRaidPull } from '../src/sim/combat/priest/spirit_bomb_raid';
import { spawnSpiritBombResidual } from '../src/sim/combat/priest/spirit_bomb_residual';
import { applyVampiricTouch } from '../src/sim/combat/priest/vampiric_touch';
import { addGloomtithe, bindEffigy, ownDirge, ownEffigy } from '../src/sim/combat/priest/vespers';
import { ABILITIES, MOBS, ZONES, zoneAt } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { tickGroundAoEs } from '../src/sim/entity_roster';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { type Aura, DT, type Entity, IGNIVAR_BOSS_ID, type SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function fixture(rows: Partial<Record<14 | 17 | 20, string>> = {}) {
  const sim = new Sim({ seed: 7781, playerClass: 'priest', world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: 'shadow', rows })).toBe(true);
  sim.tick();
  const p = sim.player;
  p.hitBonus = 1;
  p.resource = p.maxResource;
  sim.ctx.spellCrit = () => 0;
  sim.ctx.lineOfSightBlocked = () => false;
  const target = addTarget(sim, 9900, 15);
  sim.targetEntity(target.id);
  return { sim, ctx: sim.ctx, p, target };
}

function addTarget(sim: Sim, id: number, distance: number): Entity {
  const target = createMob(id, MOBS.training_dummy, 20, {
    ...sim.player.pos,
    z: sim.player.pos.z + distance,
  });
  target.hostile = true;
  target.maxHp = target.hp = 100000;
  sim.ctx.addEntity(target);
  return target;
}

type Fixture = ReturnType<typeof fixture>;

function dot(f: Fixture, id: string, sourceId = f.p.id): Aura {
  const a: Aura = {
    id,
    name: id === 'vampiric_touch' ? 'Vampiric Touch' : 'Dirge of Decay',
    kind: 'dot',
    remaining: 18,
    duration: 18,
    value: 20,
    tickInterval: 3,
    tickTimer: 2.4,
    sourceId,
    school: 'shadow',
  };
  f.ctx.applyAura(f.target, a);
  return a;
}

function link(f: Fixture): Aura {
  const dirge = dot(f, 'shadow_word_pain');
  expect(bindEffigy(f.ctx, f.p, f.target)).toBe(true);
  return dirge;
}

function pulse(f: Fixture, aura: Aura): SimEvent[] {
  aura.tickTimer = DT;
  const emit = vi.spyOn(f.ctx, 'emit');
  updateAuras(f.ctx, f.target);
  const events = emit.mock.calls.map(([event]) => event);
  emit.mockRestore();
  return events;
}

function hits(events: SimEvent[], name: string) {
  return events.filter(
    (event): event is Extract<SimEvent, { type: 'damage' }> =>
      event.type === 'damage' && event.ability === name,
  );
}

function groupAlly(f: Fixture): Entity {
  const id = f.sim.addPlayer('warrior', 'Shadow support');
  f.sim.setPlayerLevel(20, id);
  const ally = f.sim.entities.get(id)!;
  ally.pos = { ...f.p.pos, x: f.p.pos.x + 3 };
  f.sim.partyInvite(id, f.p.id);
  f.sim.partyAccept(id);
  ally.hp = Math.floor(ally.maxHp / 2);
  return ally;
}

describe('Shadow talent choices with Vampiric Touch and Tithe Bomb', () => {
  it('adds a sixth damage pulse when a real VT cast naturally completes its five ticks', () => {
    const f = fixture({ 20: 'pri_r20_second_verse' });
    link(f);
    f.sim.castAbility('vampiric_touch');
    const events: SimEvent[] = [];
    for (let i = 0; i < 332; i++) events.push(...f.sim.tick());
    expect(hits(events, 'Vampiric Touch')).toHaveLength(6);
    expect(f.target.auras.some((a) => a.id === 'vampiric_touch')).toBe(false);
  });

  it('keeps real Dirge refresh and Effigy durations finite after importing the new talent modules', () => {
    const f = fixture({ 14: 'pri_r11_meditation', 20: 'pri_r20_second_verse' });
    link(f);
    for (let i = 0; i < 300; i++) f.sim.tick();
    const prior = ownDirge(f.target, f.p.id)!;
    const priorTimer = prior.tickTimer!;
    f.p.gcdRemaining = 0;
    f.p.resource = f.p.maxResource;
    f.sim.castAbility('shadow_word_pain');
    let elapsed = 0;
    while (ownDirge(f.target, f.p.id) === prior && elapsed < 30) {
      f.sim.tick();
      elapsed++;
    }
    const refreshed = ownDirge(f.target, f.p.id)!;
    const effigy = ownEffigy(f.target, f.p.id)!;
    expect(refreshed).not.toBe(prior);
    expect(refreshed.remaining).toBeGreaterThan(17);
    expect(refreshed.remaining).toBeLessThanOrEqual(18);
    expect(refreshed.duration).toBe(18);
    const expectedTimer = (((priorTimer - elapsed * DT) % 3) + 3) % 3;
    expect(refreshed.tickTimer).toBeCloseTo(expectedTimer, 8);
    expect(effigy.remaining).toBe(refreshed.remaining);
    expect(effigy.duration).toBe(refreshed.duration);
    for (let i = 0; i < 60; i++) {
      f.sim.tick();
      expect(Number.isFinite(refreshed.remaining)).toBe(true);
      expect(Number.isFinite(effigy.remaining)).toBe(true);
    }
  });
  it('extends both own primary DoTs on landed Mindfracture, capped per application', () => {
    const f = fixture({ 14: 'pri_r14_pain_and_suffering' });
    const dirge = link(f);
    const touch = dot(f, 'vampiric_touch');
    const foreign = dot(f, 'vampiric_touch', 9999);
    const timers = [dirge.tickTimer, touch.tickTimer];
    for (let i = 0; i < 5; i++)
      f.ctx.dealDamage(
        f.p,
        f.target,
        10,
        false,
        'shadow',
        'Mindfracture',
        'hit',
        true,
        undefined,
        true,
        false,
        false,
        'mind_blast',
      );
    expect(dirge.extendedBy).toBe(3);
    expect(touch.extendedBy).toBe(3);
    expect([dirge.duration, touch.duration, foreign.duration]).toEqual([21, 21, 18]);
    expect([dirge.tickTimer, touch.tickTimer]).toEqual(timers);
    expect(ownEffigy(f.target, f.p.id)?.remaining).toBe(dirge.remaining);
    expect(spiritBombProgress(f.p)).toBe(5); // One ordinary generation per nuke.
  });

  it('does not extend without the talent or on an immune Mindfracture', () => {
    for (const selected of [false, true]) {
      const f = fixture(selected ? { 14: 'pri_r14_pain_and_suffering' } : {});
      const dirge = link(f);
      const touch = dot(f, 'vampiric_touch');
      f.target.damageImmune = selected;
      f.ctx.dealDamage(
        f.p,
        f.target,
        10,
        false,
        'shadow',
        'Mindfracture',
        'hit',
        true,
        undefined,
        true,
        false,
        false,
        'mind_blast',
      );
      expect([dirge.duration, touch.duration]).toEqual([18, 18]);
    }
  });

  it('respects an existing secondary Dirge extension budget and resets on reapplication', () => {
    const f = fixture({ 14: 'pri_r14_pain_and_suffering' });
    const dirge = link(f);
    dirge.extendedBy = 6;
    f.ctx.dealDamage(
      f.p,
      f.target,
      10,
      false,
      'shadow',
      'Mindfracture',
      'hit',
      true,
      undefined,
      true,
      false,
      false,
      'mind_blast',
    );
    expect(dirge.extendedBy).toBe(6);
    const touch = dot(f, 'vampiric_touch');
    touch.extendedBy = 3;
    const replacement = { ...touch, extendedBy: undefined, duration: 15, remaining: 15 };
    applyVampiricTouch(f.ctx, f.p, f.target, replacement);
    f.ctx.dealDamage(
      f.p,
      f.target,
      10,
      false,
      'shadow',
      'Mindfracture',
      'hit',
      true,
      undefined,
      true,
      false,
      false,
      'mind_blast',
    );
    expect(replacement.extendedBy).toBe(1);
  });

  it('keeps both own Effigies aligned when Living Covenant extends the secondary Dirge', () => {
    const f = fixture({ 14: 'pri_r14_pain_and_suffering', 20: 'pri_r20_twin_covenant' });
    link(f);
    const secondary = addTarget(f.sim, 9920, 17);
    const dirge = { ...dot(f, 'shadow_word_pain'), sourceId: f.p.id };
    f.ctx.applyAura(secondary, dirge);
    bindEffigy(f.ctx, f.p, secondary);
    const foreignLink: Aura = {
      id: 'priest_effigy',
      name: 'Effigy',
      kind: 'hex',
      remaining: 18,
      duration: 18,
      value: 0.3,
      sourceId: 9999,
      school: 'shadow',
    };
    secondary.auras.push(foreignLink);
    f.ctx.dealDamage(
      f.p,
      f.target,
      10,
      false,
      'shadow',
      'Mindfracture',
      'hit',
      true,
      undefined,
      true,
      false,
      false,
      'mind_blast',
    );
    expect(dirge.extendedBy).toBe(1);
    expect(ownEffigy(secondary, f.p.id)?.remaining).toBe(dirge.remaining);
    expect(ownEffigy(secondary, f.p.id)?.duration).toBe(dirge.duration);
    expect(foreignLink.remaining).toBe(18);
  });

  it('adds exactly one full VT pulse after five natural Effigy pulses with shared healing', () => {
    const f = fixture({ 20: 'pri_r20_second_verse' });
    link(f);
    const touch = dot(f, 'vampiric_touch');
    f.p.hp = Math.floor(f.p.maxHp / 2);
    const ally = groupAlly(f);
    for (let i = 0; i < 4; i++) expect(hits(pulse(f, touch), 'Vampiric Touch')).toHaveLength(1);
    const before = f.p.hp + ally.hp;
    const events = pulse(f, touch);
    const damage = hits(events, 'Vampiric Touch');
    expect(damage).toHaveLength(2);
    expect(damage[0].amount).toBe(damage[1].amount);
    expect(f.p.hp + ally.hp - before).toBe(2 * Math.round(damage[0].amount * 0.2));
    expect(touch.shadowVerseTicks).toBe(5);
    expect(hits(pulse(f, touch), 'Vampiric Touch')).toHaveLength(1);
    expect(touch.shadowVerseTicks).toBe(6);
    expect(events.filter((e) => e.type === 'heal2' && e.crit)).toHaveLength(0);
  });

  it('requires the own Effigy and talent to count natural VT pulses', () => {
    for (const selected of [false, true]) {
      const f = fixture(selected ? { 20: 'pri_r20_second_verse' } : {});
      if (!selected) link(f);
      const touch = dot(f, 'vampiric_touch');
      for (let i = 0; i < 6; i++) expect(hits(pulse(f, touch), 'Vampiric Touch')).toHaveLength(1);
      expect(touch.shadowVerseTicks ?? 0).toBe(0);
    }
  });

  it('carries four natural pulses through an empowered refresh and procs on the next tick', () => {
    const f = fixture({ 20: 'pri_r20_second_verse' });
    link(f);
    const touch = dot(f, 'vampiric_touch');
    for (let i = 0; i < 4; i++) pulse(f, touch);
    addGloomtithe(f.ctx, f.p, 5);
    const refreshed = { ...touch, remaining: 15, duration: 15, tickTimer: 3 };
    const emit = vi.spyOn(f.ctx, 'emit');
    expect(applyVampiricTouch(f.ctx, f.p, f.target, refreshed)).toBe(true);
    expect(
      hits(
        emit.mock.calls.map(([event]) => event),
        'Vampiric Touch',
      ),
    ).toHaveLength(0);
    emit.mockRestore();
    expect(refreshed.shadowVerseTicks).toBe(4);
    expect(refreshed.shadowVerseEffigyTick).toBeUndefined();
    expect(refreshed).toMatchObject({ value: 26, duration: 15, remaining: 15, tickTimer: 3 });
    expect(f.p.auras.find((a) => a.kind === 'gloomtithe')?.stacks).toBe(3);
    f.p.hp = Math.floor(f.p.maxHp / 2);
    const before = f.p.hp;
    const damage = hits(pulse(f, refreshed), 'Vampiric Touch');
    expect(damage.map((hit) => hit.amount)).toEqual([26, 26]);
    expect(f.p.hp - before).toBe(10);
    expect(refreshed.shadowVerseTicks).toBe(5);
    expect(hits(pulse(f, refreshed), 'Vampiric Touch')).toHaveLength(1);
  });

  it.each(['expired', 'missing', 'foreign'] as const)(
    'resets progress when the previous own VT is %s',
    (state) => {
      const f = fixture({ 20: 'pri_r20_second_verse' });
      link(f);
      const touch = dot(f, 'vampiric_touch', state === 'foreign' ? 9999 : f.p.id);
      touch.shadowVerseTicks = 4;
      if (state === 'expired') touch.remaining = 0;
      if (state === 'missing') f.target.auras.splice(f.target.auras.indexOf(touch), 1);
      const refreshed = { ...touch, sourceId: f.p.id, remaining: 15, duration: 15 };
      expect(applyVampiricTouch(f.ctx, f.p, f.target, refreshed)).toBe(true);
      expect(refreshed.shadowVerseTicks).toBe(0);
      expect(hits(pulse(f, refreshed), 'Vampiric Touch')).toHaveLength(1);
      if (state === 'foreign') expect(touch.shadowVerseTicks).toBe(4);
    },
  );

  it('keeps existing progress, timing and gems when a refresh is rejected', () => {
    const f = fixture({ 20: 'pri_r20_second_verse' });
    link(f);
    const touch = dot(f, 'vampiric_touch');
    for (let i = 0; i < 4; i++) pulse(f, touch);
    addGloomtithe(f.ctx, f.p, 5);
    const before = { ...touch };
    const refused = vi.spyOn(f.ctx, 'applyAura').mockImplementation(() => {});
    expect(applyVampiricTouch(f.ctx, f.p, f.target, { ...touch })).toBe(false);
    refused.mockRestore();
    expect(f.target.auras).toContain(touch);
    expect(touch).toEqual(before);
    expect(f.p.auras.find((a) => a.kind === 'gloomtithe')?.stacks).toBe(5);
    expect(hits(pulse(f, touch), 'Vampiric Touch')).toHaveLength(2);
  });

  it('bonus VT pulse respects absorbs and overkill, with no fabricated healing', () => {
    const f = fixture({ 20: 'pri_r20_second_verse' });
    link(f);
    const touch = dot(f, 'vampiric_touch');
    touch.shadowVerseTicks = 4;
    f.p.hp = Math.floor(f.p.maxHp / 2);
    f.target.auras.push({
      id: 'test_absorb',
      name: 'Test shield',
      kind: 'absorb',
      remaining: 30,
      duration: 30,
      value: 1000,
      sourceId: f.target.id,
      school: 'holy',
    });
    const before = f.p.hp;
    pulse(f, touch);
    expect(f.p.hp).toBe(before);
    f.target.auras = f.target.auras.filter((a) => a.kind !== 'absorb');
    f.target.hp = 1;
    touch.shadowVerseTicks = 4;
    expect(hits(pulse(f, touch), 'Vampiric Touch')).toHaveLength(1);
    expect(f.p.hp).toBe(before);
  });

  it("does not credit VT ticks from a different priest's Effigy", () => {
    const f = fixture({ 20: 'pri_r20_second_verse' });
    dot(f, 'shadow_word_pain');
    f.target.auras.push({
      id: 'priest_effigy',
      name: 'Effigy',
      kind: 'hex',
      remaining: 18,
      duration: 18,
      value: 0.3,
      sourceId: 9999,
      school: 'shadow',
    });
    const touch = dot(f, 'vampiric_touch');
    const events = Array.from({ length: 5 }, () => pulse(f, touch)).flat();
    expect(hits(events, 'Vampiric Touch')).toHaveLength(5);
    expect(touch.shadowVerseTicks ?? 0).toBe(0);
  });

  it.each([false, true])(
    'resolves a fifth pulse when VT and Effigy expire together, reversed=%s',
    (reverse) => {
      const f = fixture({ 20: 'pri_r20_second_verse' });
      const dirge = link(f);
      dirge.tickTimer = 3;
      const touch = dot(f, 'vampiric_touch');
      const effigy = ownEffigy(f.target, f.p.id)!;
      touch.shadowVerseTicks = 4;
      touch.remaining = touch.tickTimer = DT;
      effigy.remaining = DT;
      f.target.auras = reverse ? [dirge, touch, effigy] : [dirge, effigy, touch];
      const events = pulse(f, touch);
      expect(hits(events, 'Vampiric Touch')).toHaveLength(2);
      expect(touch.shadowVerseTicks).toBe(5);
      expect(f.target.auras).not.toContain(touch);
      expect(f.target.auras).not.toContain(effigy);
    },
  );

  it('replays Second Verse events, RNG draws and final RNG state across isolated equal-seed Sims', () => {
    const replay = () => {
      const f = fixture({ 20: 'pri_r20_second_verse' });
      link(f);
      const touch = dot(f, 'vampiric_touch');
      f.ctx.spellCrit = () => 0.4;
      f.p.hp = Math.floor(f.p.maxHp / 2);
      const draws: number[] = [];
      f.ctx.rng.setObserver((value) => draws.push(value));
      const events = Array.from({ length: 10 }, () => pulse(f, touch)).flat();
      f.ctx.rng.setObserver(null);
      return { events, draws, state: (f.ctx.rng as unknown as { s: number }).s };
    };
    const first = replay();
    const second = replay();
    expect(first.events).toEqual(second.events);
    expect(first.draws).toEqual(second.draws);
    expect(first.state).toBe(second.state);
    expect(hits(first.events, 'Vampiric Touch')).toHaveLength(12);
  });

  it('makes Shadow Choir instant, keeps its cost/cooldown and preserves Shadowform', () => {
    const f = fixture({ 17: 'pri_r17_choir_of_deliverance' });
    f.p.auras.push({
      id: 'shadowform',
      name: 'Gloamveil Form',
      kind: 'form_shadow',
      remaining: 100,
      duration: 100,
      value: 15,
      sourceId: f.p.id,
      school: 'shadow',
    });
    const base = ABILITIES.choir_of_deliverance;
    const mana = f.p.resource;
    f.sim.castAbility('choir_of_deliverance');
    expect(f.p.castingAbility).toBeNull();
    expect(f.p.resource).toBe(mana - 128);
    expect(f.p.cooldowns.get('choir_of_deliverance')).toBe(180);
    expect(f.p.auras.find((a) => a.id === 'choir_of_deliverance')).toMatchObject({
      remaining: 15,
      value: 0,
    });
    expect(f.p.auras.some((a) => a.kind === 'form_shadow')).toBe(true);
    expect(base.channel).toEqual({ duration: 6, ticks: 3 });
    expect(base.school).toBe('holy');
  });

  it('Choir shares one 20% HP-loss budget and excludes fully absorbed, physical and copied hits', () => {
    const f = fixture({ 17: 'pri_r17_choir_of_deliverance' });
    const ally = groupAlly(f);
    f.p.hp = Math.floor(f.p.maxHp / 2);
    f.sim.castAbility('choir_of_deliverance');
    const total = () => f.p.hp + ally.hp;
    const before = total();
    const hp = f.target.hp;
    f.ctx.dealDamage(f.p, f.target, 100, false, 'shadow', 'Test hit', 'hit', true);
    expect(total() - before).toBe(Math.round((hp - f.target.hp) * 0.2));
    const settled = total();
    f.ctx.dealDamage(f.p, f.target, 100, false, 'physical', 'Physical hit', 'hit', true);
    f.ctx.dealDamage(
      f.p,
      f.target,
      100,
      false,
      'shadow',
      'Copied hit',
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
    f.target.auras.push({
      id: 'test_absorb',
      name: 'Test shield',
      kind: 'absorb',
      remaining: 30,
      duration: 30,
      value: 1000,
      sourceId: f.target.id,
      school: 'holy',
    });
    f.ctx.dealDamage(f.p, f.target, 100, false, 'shadow', 'Absorbed hit', 'hit', true);
    expect(total()).toBe(settled);
    f.target.auras = [];
    f.target.hp = 7;
    f.ctx.dealDamage(f.p, f.target, 1000, false, 'shadow', 'Lethal hit', 'hit', true);
    expect(total() - settled).toBe(1);
  });

  it('Choir converts a duel-ending Shadow hit before duel termination without healing the enemy', () => {
    const f = fixture({ 17: 'pri_r17_choir_of_deliverance' });
    const enemy = groupAlly(f);
    f.sim.duelRequest(enemy.id);
    f.sim.duelAccept(enemy.id);
    for (let i = 0; i < 65; i++) f.sim.tick();
    f.p.hp = Math.floor(f.p.maxHp / 2);
    f.p.gcdRemaining = 0;
    f.p.resource = f.p.maxResource;
    f.sim.castAbility('choir_of_deliverance');
    enemy.hp = 8;
    const before = f.p.hp;
    f.ctx.dealDamage(f.p, enemy, 1000, false, 'shadow', 'Duel finisher', 'hit', true);
    expect(enemy.hp).toBe(1);
    expect(f.p.hp - before).toBe(1);
  });

  it.each(['expiry', 'lost talent'] as const)('stops Choir conversion after %s', (reason) => {
    const f = fixture({ 17: 'pri_r17_choir_of_deliverance' });
    f.sim.castAbility('choir_of_deliverance');
    if (reason === 'expiry') {
      for (let i = 0; i < 301; i++) updateAuras(f.ctx, f.p);
    } else {
      expect(f.sim.applyTalents({ spec: 'shadow', rows: { 17: 'pri_r17_anointing' } })).toBe(true);
    }
    f.p.hp = Math.floor(f.p.maxHp / 2);
    const before = f.p.hp;
    f.ctx.dealDamage(f.p, f.target, 100, false, 'shadow', 'Post-Choir hit', 'hit', true);
    expect(f.p.hp).toBe(before);
    expect(f.p.auras.some((a) => a.id === 'choir_of_deliverance')).toBe(false);
  });

  it('a completed talented bomb leaves one fixed six-second region with three noncritical pulses', () => {
    const f = fixture({ 20: 'pri_r20_incarnate_spirit' });
    recordGloomtitheGeneration(f.ctx, f.p, 20);
    f.sim.castAbility('spirit_bomb');
    f.p.castRemaining = DT;
    updateCasting(f.ctx, f.p, f.ctx.players.get(f.p.id)!);
    const initial = hits(f.sim.drainEvents(), 'Tithe Bomb');
    expect(initial).toHaveLength(1);
    const zones = f.ctx.groundAoEs.filter((z) => z.spiritBombResidual);
    expect(zones).toHaveLength(1);
    expect(zones[0].interval).toBe(2);
    expect(zones[0].radius).toBe(8);
    expect(zones[0].spiritBombResidual?.pulses).toBe(3);
    expect(zones[0].pos).toEqual(f.target.pos);
    const originalCenter = { ...zones[0].pos };
    f.target.pos.z += 1;
    f.ctx.rebucket(f.target);
    const emit = vi.spyOn(f.ctx, 'emit');
    for (let i = 0; i < 121; i++) tickGroundAoEs(f.ctx);
    const events = emit.mock.calls.map(([event]) => event);
    emit.mockRestore();
    const residual = hits(events, 'Tithe Bomb');
    expect(residual).toHaveLength(3);
    expect(residual.every((hit) => !hit.crit)).toBe(true);
    expect(residual.reduce((sum, hit) => sum + hit.amount, 0)).toBeCloseTo(
      initial[0].amount * 0.2,
      -1,
    );
    expect(zones[0].pos).toEqual(originalCenter);
    expect(f.ctx.groundAoEs).toHaveLength(0);
    expect(
      events.some((e) => (e.type === 'spellfx' || e.type === 'spellfxAt') && e.fx === 'nova'),
    ).toBe(false);
  });

  it('residual scales above five targets and never starts an entering raid boss', () => {
    const f = fixture({ 20: 'pri_r20_incarnate_spirit' });
    const targets = [
      f.target,
      ...Array.from({ length: 5 }, (_, i) => addTarget(f.sim, 9910 + i, 15)),
    ];
    spawnSpiritBombResidual(f.ctx, f.p, f.target.pos, 8, 300, {});
    const boss = createMob(9980, MOBS[IGNIVAR_BOSS_ID], 20, f.target.pos);
    boss.maxHp = boss.hp = 100000;
    f.ctx.addEntity(boss);
    const before = targets.map((target) => target.hp);
    for (let i = 0; i < 40; i++) tickGroundAoEs(f.ctx);
    expect(targets.map((target, i) => before[i] - target.hp)).toEqual([17, 17, 17, 17, 17, 17]);
    expect(boss.hp).toBe(100000);
    expect(boss.spiritBombRaidPullStarted).toBeUndefined();
    beginSpiritBombRaidPull(f.ctx, boss);
    expect(f.ctx.groundAoEs.every((zone) => zone.remaining === 0)).toBe(true);
  });

  it.each([0, 100])(
    'applies Spell Power %s and source boosts once to the residual budget',
    (power) => {
      const f = fixture({ 20: 'pri_r20_incarnate_spirit' });
      f.p.spellPower = power;
      f.p.auras.push(
        {
          id: 'test_damage',
          name: 'Test damage boost',
          kind: 'buff_dmg_done',
          remaining: 30,
          duration: 30,
          value: 0.2,
          sourceId: f.p.id,
          school: 'shadow',
        },
        {
          id: 'shadowform',
          name: 'Gloamveil Form',
          kind: 'form_shadow',
          remaining: 30,
          duration: 30,
          value: 15,
          sourceId: f.p.id,
          school: 'shadow',
        },
      );
      recordGloomtitheGeneration(f.ctx, f.p, 20);
      f.sim.castAbility('spirit_bomb');
      f.p.castRemaining = DT;
      updateCasting(f.ctx, f.p, f.ctx.players.get(f.p.id)!);
      const initial = hits(f.sim.drainEvents(), 'Tithe Bomb')[0].amount;
      const before = f.target.hp;
      for (let i = 0; i < 121; i++) tickGroundAoEs(f.ctx);
      expect(before - f.target.hp).toBeCloseTo(initial * 0.2, -1);
    },
  );

  it('keeps the residual region after an immune initial explosion, with no extra critical roll', () => {
    const f = fixture({ 20: 'pri_r20_incarnate_spirit' });
    f.ctx.spellCrit = () => 1;
    f.target.damageImmune = true;
    recordGloomtitheGeneration(f.ctx, f.p, 20);
    f.sim.castAbility('spirit_bomb');
    f.p.castRemaining = DT;
    updateCasting(f.ctx, f.p, f.ctx.players.get(f.p.id)!);
    expect(spiritBombProgress(f.p)).toBe(0);
    expect(f.ctx.groundAoEs).toHaveLength(1);
    const rng = vi.spyOn(f.ctx.rng, 'chance');
    f.target.damageImmune = false;
    const hp = f.target.hp;
    for (let i = 0; i < 121; i++) tickGroundAoEs(f.ctx);
    expect(hp - f.target.hp).toBeGreaterThan(0);
    expect(rng).not.toHaveBeenCalled();
    rng.mockRestore();
  });

  it.each(['death', 'respec', 'depart'] as const)(
    'deactivates the region on source %s',
    (reason) => {
      const f = fixture({ 20: 'pri_r20_incarnate_spirit' });
      spawnSpiritBombResidual(f.ctx, f.p, f.target.pos, 8, 300, {});
      if (reason === 'death') {
        f.p.dead = true;
        cleanupPriestState(f.ctx, f.p.id);
      } else if (reason === 'respec') {
        expect(f.sim.setSpec('holy')).toBe(true);
      } else {
        f.ctx.dropEntity(f.p.id);
      }
      const hp = f.target.hp;
      for (let i = 0; i < 121; i++) tickGroundAoEs(f.ctx);
      expect(f.target.hp).toBe(hp);
      expect(f.ctx.groundAoEs).toHaveLength(0);
    },
  );

  it.each(['region', 'instance'] as const)(
    'deactivates the region after its source changes %s',
    (reason) => {
      const f = fixture({ 20: 'pri_r20_incarnate_spirit' });
      if (reason === 'region') {
        f.p.pos.x = 0;
        f.p.pos.z = ZONES[0].zMax - 1;
      }
      spawnSpiritBombResidual(f.ctx, f.p, f.target.pos, 8, 300, {});
      if (reason === 'region') {
        const originZone = zoneAt(f.p.pos.x, f.p.pos.z).id;
        f.p.pos.z += 2;
        expect(zoneAt(f.p.pos.x, f.p.pos.z).id).not.toBe(originZone);
      } else expect(enterDungeon(f.ctx, 'hollow_crypt', f.p.id, true)).toBe(true);
      const before = f.target.hp;
      for (let i = 0; i < 121; i++) tickGroundAoEs(f.ctx);
      expect(f.target.hp).toBe(before);
      expect(f.ctx.groundAoEs).toHaveLength(0);
    },
  );

  it('does not create a bomb region without Incarnate Spirit', () => {
    const f = fixture();
    recordGloomtitheGeneration(f.ctx, f.p, 20);
    f.sim.castAbility('spirit_bomb');
    f.p.castRemaining = DT;
    updateCasting(f.ctx, f.p, f.ctx.players.get(f.p.id)!);
    expect(f.ctx.groundAoEs).toHaveLength(0);
  });

  it('deactivates a residual on released claim even when the owner position and zone stay unchanged', () => {
    const f = fixture({ 20: 'pri_r20_incarnate_spirit' });
    expect(enterDungeon(f.ctx, 'hollow_crypt', f.p.id, true)).toBe(true);
    const slot = f.ctx.instances.find(
      (entry) => entry.dungeonId === 'hollow_crypt' && entry.partyKey !== null,
    );
    if (!slot) throw new Error('Missing claimed dungeon');
    const enemy = f.ctx.entities.get(slot.mobIds[0]);
    if (!enemy) throw new Error('Missing dungeon target');
    enemy.hp = enemy.maxHp = 100000;
    f.p.pos = { ...enemy.pos, z: enemy.pos.z + 2 };
    f.ctx.rebucket(f.p);
    spawnSpiritBombResidual(f.ctx, f.p, enemy.pos, 8, 300, {});
    expect(f.ctx.groundAoEs[0].spiritBombResidual?.sourceClaim).not.toBeNull();
    const initial = enemy.hp;
    for (let i = 0; i < 40; i++) tickGroundAoEs(f.ctx);
    expect(enemy.hp).toBeLessThan(initial);
    const pos = { ...f.p.pos };
    const region = zoneAt(f.p.pos.x, f.p.pos.z).id;
    slot.partyKey = null;
    const before = enemy.hp;
    for (let i = 0; i < 121; i++) tickGroundAoEs(f.ctx);
    expect(f.p.pos).toEqual(pos);
    expect(zoneAt(f.p.pos.x, f.p.pos.z).id).toBe(region);
    expect(enemy.hp).toBe(before);
    expect(f.ctx.groundAoEs).toHaveLength(0);
  });
});
