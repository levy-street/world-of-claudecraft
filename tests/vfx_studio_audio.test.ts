import { describe, expect, it, vi } from 'vitest';
import { StudioCombatAudio } from '../src/vfx_studio/combat_audio';
import { DEFAULT_STUDIO_CONFIG, StudioSession } from '../src/vfx_studio/session';

describe('studio canonical combat audio', () => {
  const setup = () => {
    const session = new StudioSession(DEFAULT_STUDIO_CONFIG);
    const sink = { playAt: vi.fn(), loop: vi.fn(), unloop: vi.fn(), preload: vi.fn() };
    const audio = new StudioCombatAudio(sink);
    const event = (row: Parameters<StudioCombatAudio['event']>[0]) =>
      audio.event(row, session.sim.entities, session.sim.player.id);
    return { session, sink, audio, event };
  };
  it('owns real cast loops and stops them on cancellation and reset', () => {
    const h = setup();
    for (const row of h.session.dispatch({
      kind: 'cast',
      abilityId: 'ghost_wolf',
      targetId: h.session.sim.player.id,
    }))
      h.event(row);
    expect(h.sink.loop).toHaveBeenCalledTimes(1);
    h.event({ type: 'castStop', entityId: h.session.sim.player.id, success: false });
    expect(h.sink.unloop).toHaveBeenCalledWith(`cast:${h.session.sim.player.id}`, 0.1);
    h.sink.unloop.mockClear();
    h.audio.clear();
    expect(h.sink.unloop).not.toHaveBeenCalled();
  });
  it('uses the periodic authored charge for chain heal and keeps HoT ticks silent', () => {
    const h = setup();
    h.event({
      type: 'castStart',
      entityId: h.session.sim.player.id,
      ability: 'chain_heal',
      time: 2,
    });
    expect(h.sink.loop).toHaveBeenCalledTimes(1);
    expect(h.sink.loop.mock.calls[0][1]).toBe('cast_masterwork_tide');
    expect(h.sink.playAt).not.toHaveBeenCalled();
    h.sink.playAt.mockClear();
    h.event({
      type: 'heal2',
      sourceId: h.session.sim.player.id,
      targetId: h.session.sim.player.id,
      amount: 12,
      crit: false,
      ability: 'Renew',
      hot: true,
      abilityId: 'renew',
    });
    expect(h.sink.playAt).not.toHaveBeenCalled();
  });
  it('never turns a missed hit into an impact and does not stop another actor casting on death', () => {
    const h = setup();
    h.event({
      type: 'castStart',
      entityId: h.session.sim.player.id,
      ability: 'healing_wave',
      time: 2,
    });
    h.event({
      type: 'damage',
      sourceId: h.session.sim.player.id,
      targetId: h.session.targetIds[0],
      amount: 0,
      crit: false,
      ability: 'Lightning Bolt',
      kind: 'miss',
      school: 'nature',
      abilityId: 'lightning_bolt',
    });
    expect(h.sink.playAt.mock.calls.some(([cue]) => String(cue).startsWith('impact_'))).toBe(false);
    h.event({ type: 'death', entityId: h.session.targetIds[0], killerId: h.session.sim.player.id });
    expect(h.sink.unloop).not.toHaveBeenCalledWith(
      `cast:${h.session.sim.player.id}`,
      expect.anything(),
    );
    h.audio.clear();
    expect(h.sink.unloop).toHaveBeenCalledWith(`cast:${h.session.sim.player.id}`, 0.05);
  });
});
