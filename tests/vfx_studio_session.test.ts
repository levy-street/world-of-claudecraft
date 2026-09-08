import { describe, expect, it } from 'vitest';
import { StudioPlayback } from '../src/vfx_studio/playback_core';
import { DEFAULT_STUDIO_CONFIG, StudioSession } from '../src/vfx_studio/session';
import { stageStudioCast } from '../src/vfx_studio/stage_cast';

describe('studio runs the real combat simulation', () => {
  it('prepares Frostjaw at the chosen enemy and waits for the real trap to arm', () => {
    const s = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'hunter', spec: null });
    const id = s.targetIds[0];
    const target = s.sim.entities.get(id);
    expect(target).toBeDefined();
    if (!target) throw new Error('Missing training target');
    const events = s.dispatch({
      kind: 'cast',
      abilityId: 'frostjaw_trap',
      targetId: id,
      prepare: true,
    });
    expect(s.sim.player.targetId).toBe(id);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfxAt',
        ability: 'frostjaw_trap',
        x: target.pos.x,
        z: target.pos.z,
      }),
    );
    expect(target.auras.some((a) => a.id === 'frostjaw_trap_freeze')).toBe(false);
    for (let i = 0; i < 20; i++) s.tick();
    expect(target.auras.some((a) => a.id === 'frostjaw_trap_freeze')).toBe(true);
  });

  it('leaves completed Ember Form before preparing a normal Mage cast', () => {
    const s = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'mage', spec: null });
    const id = s.targetIds[0];
    s.dispatch({ kind: 'cast', abilityId: 'fireball_form', targetId: id, prepare: true });
    for (let i = 0; i < 50; i++) s.tick();
    expect(s.sim.player.auras.some((a) => a.kind === 'form_fireball')).toBe(true);
    s.dispatch({ kind: 'cast', abilityId: 'fireball', targetId: id, prepare: true });
    expect(s.sim.player.auras.some((a) => a.kind === 'form_fireball')).toBe(false);
    expect(s.sim.player.castingAbility).toBe('fireball');
  });
  it('stages a legal Headbutt from wolf form and interrupts a real spell at close contact', () => {
    const s = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'druid', spec: null });
    const id = s.targetIds[0];
    stageStudioCast(s.sim, 'claw', id);
    const events = s.dispatch({
      kind: 'cast',
      abilityId: 'skull_bash',
      targetId: id,
      prepare: true,
    });
    expect(s.sim.player.auras.some((a) => a.kind === 'form_cat')).toBe(false);
    const target = s.sim.entities.get(id)!;
    expect(
      Math.hypot(s.sim.player.pos.x - target.pos.x, s.sim.player.pos.z - target.pos.z),
    ).toBeLessThanOrEqual(2);
    expect(target.castingAbility).toBeNull();
    expect(target.auras.some((a) => a.id === 'skull_bash_lockout' && a.school === 'fire')).toBe(
      true,
    );
    expect(events.some((e) => e.type === 'spellfx' && e.ability === 'skull_bash')).toBe(true);
    stageStudioCast(s.sim, 'wrath', id);
    expect(s.sim.player.auras.some((a) => a.kind === 'form_cat')).toBe(false);
  });
  it('prepares sequential bear, cat and caster previews through canonical form transitions', () => {
    const s = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'druid', spec: null });
    const id = s.targetIds[0];
    stageStudioCast(s.sim, 'maul', id);
    expect(s.sim.player.auras.filter((a) => a.kind.startsWith('form_')).map((a) => a.kind)).toEqual(
      ['form_bear'],
    );
    stageStudioCast(s.sim, 'claw', id);
    expect(s.sim.player.auras.filter((a) => a.kind.startsWith('form_')).map((a) => a.kind)).toEqual(
      ['form_cat'],
    );
    stageStudioCast(s.sim, 'wrath', id);
    expect(s.sim.player.auras.some((a) => a.kind.startsWith('form_'))).toBe(false);
    expect(s.sim.player.resource).toBe(s.sim.player.maxResource);
  });
  it('stages a melee preview into range and reproduces the same setup during replay', () => {
    const original = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'rogue', spec: null });
    const replay = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'rogue', spec: null });
    const command = {
      kind: 'cast',
      abilityId: 'kick',
      targetId: original.targetIds[0],
      prepare: true,
    } as const;
    const before = { ...original.sim.player.pos };
    const first = original.dispatch(command);
    const second = replay.dispatch(command, false);
    expect(original.sim.player.pos).not.toEqual(before);
    expect(replay.sim.player.pos).toEqual(original.sim.player.pos);
    expect(first.filter((e) => e.type === 'error')).toEqual([]);
    expect(second).toEqual(first);
    expect(original.commands[0].command).toEqual(command);
  });
  it('applies the real instant Shadewolf row and snapshots its build', () => {
    const rows = { 5: 'sha_r5_concussion' };
    const session = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, rows });
    rows[5] = 'changed-after-recording';
    expect(session.config.rows?.[5]).toBe('sha_r5_concussion');
    const events = session.dispatch({
      kind: 'cast',
      abilityId: 'ghost_wolf',
      targetId: session.sim.player.id,
    });
    expect(events.some((event) => event.type === 'castStart')).toBe(false);
    expect(session.sim.player.auras.some((aura) => aura.id === 'ghost_wolf')).toBe(true);
  });
  it('rejects invalid seeds and cross-class talent choices', () => {
    for (const seed of [NaN, Infinity, -1, 1.5, 0x100000000])
      expect(() => new StudioSession({ ...DEFAULT_STUDIO_CONFIG, seed })).toThrow(
        'Invalid studio seed',
      );
    expect(
      () => new StudioSession({ ...DEFAULT_STUDIO_CONFIG, rows: { 5: 'not-a-shaman-talent' } }),
    ).toThrow('Invalid studio talent build');
  });
  it('stages the real raid boss and nine practice allies without starting a fake combat event', () => {
    const session = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, scene: 'raid' });
    expect(session.targetIds).toHaveLength(11);
    const boss = session.sim.entities.get(session.targetIds[0])!;
    expect(boss.name).toBe('Ignivar, Herald of the Last Flame');
    expect(boss.hp).toBe(120000);
    const events = session.dispatch({
      kind: 'cast',
      abilityId: 'lightning_bolt',
      targetId: boss.id,
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'castStart', ability: 'lightning_bolt' }),
    );
  });
  it('unlocks the actual restoration kit and obeys Shadewolf cast and movement cancellation', () => {
    const session = new StudioSession(DEFAULT_STUDIO_CONFIG);
    expect(session.abilities).toContain('chain_heal');
    const cast = {
      kind: 'cast',
      abilityId: 'ghost_wolf',
      targetId: session.sim.player.id,
    } as const;
    expect(session.dispatch(cast)).toContainEqual(
      expect.objectContaining({ type: 'castStart', ability: 'ghost_wolf', time: 2 }),
    );
    for (let i = 0; i < 20; i++) session.tick();
    expect(session.sim.player.castingAbility).toBe('ghost_wolf');
    expect(session.sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(false);
    session.dispatch({ kind: 'move', active: true });
    session.tick();
    expect(session.sim.player.castingAbility).toBeNull();
    session.dispatch({ kind: 'move', active: false });
    session.dispatch({ kind: 'recover' });
    session.dispatch(cast);
    for (let i = 0; i < 45; i++) session.tick();
    expect(session.sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'ghost_wolf', kind: 'buff_speed', value: 1.4 }),
    );
  });

  it('replays target, movement and cast commands into the same combat state', () => {
    const original = new StudioSession(DEFAULT_STUDIO_CONFIG);
    const replay = new StudioSession(DEFAULT_STUDIO_CONFIG);
    original.dispatch({ kind: 'target', targetId: original.targetIds[2] });
    original.dispatch({ kind: 'move', active: true });
    for (let i = 0; i < 8; i++) original.tick();
    original.dispatch({ kind: 'move', active: false });
    original.dispatch({ kind: 'cast', abilityId: 'ghost_wolf', targetId: original.sim.player.id });
    for (let i = 0; i < 50; i++) original.tick();
    let cursor = 0;
    while (replay.ticks < original.ticks) {
      while (cursor < original.commands.length && original.commands[cursor].tick === replay.ticks)
        replay.dispatch(original.commands[cursor++].command, false);
      replay.tick();
    }
    expect(cursor).toBe(original.commands.length);
    expect(original.sim.player.pos.x).not.toBe(-94);
    expect(replay.sim.player.pos).toEqual(original.sim.player.pos);
    expect(replay.sim.player.facing).toBe(original.sim.player.facing);
    expect(replay.sim.player.auras).toEqual(original.sim.player.auras);
    expect(replay.sim.player.resource).toEqual(original.sim.player.resource);
  });

  it('builds a real duel with a legal opposing target', () => {
    const session = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, scene: 'duel' });
    const events = session.dispatch({
      kind: 'cast',
      abilityId: 'lightning_bolt',
      targetId: session.targetIds[0],
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'castStart', ability: 'lightning_bolt' }),
    );
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });
});

describe('studio playback clock', () => {
  it('does not render an accumulated partial frame twice at a replay endpoint', () => {
    const clock = new StudioPlayback();
    expect(clock.advance(0.03, () => {})).toBe(0.03);
    expect(
      clock.advance(0.1, () => {
        clock.paused = true;
      }),
    ).toBeCloseTo(0.02);
  });
  it('uses fixed ticks, freezes, and ignores invalid frame deltas', () => {
    const clock = new StudioPlayback();
    let ticks = 0;
    clock.speed = 0.25;
    for (let i = 0; i < 40; i++) clock.advance(0.025, () => ticks++);
    expect(ticks).toBe(5);
    clock.paused = true;
    expect(clock.advance(0.1, () => ticks++)).toBe(0);
    clock.paused = false;
    for (const bad of [Infinity, NaN, -1]) expect(clock.advance(bad, () => ticks++)).toBe(0);
    expect(ticks).toBe(5);
  });
  it('honors an endpoint reached inside a multi-tick frame', () => {
    const clock = new StudioPlayback();
    let ticks = 0;
    clock.speed = 2;
    const dt = clock.advance(0.1, () => {
      ticks++;
      clock.paused = true;
    });
    expect(ticks).toBe(1);
    expect(dt).toBe(0.05);
    expect(clock.accumulator).toBe(0);
  });
});
