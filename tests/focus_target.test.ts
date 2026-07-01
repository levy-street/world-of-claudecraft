import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function liveMob(sim: Sim): Entity {
  const mob = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && !e.dead && e.hostile && e.ownerId === null,
  );
  if (!mob) throw new Error('test needs a live wild mob');
  return mob;
}

function errors(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

describe('/focus command', () => {
  it('pins the current target as focus and keeps it through normal retargeting', () => {
    const sim = makeWorld();
    const playerId = sim.addPlayer('warrior', 'Aleph');
    const first = liveMob(sim);
    first.name = 'Focus Wolf';
    const second = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && !e.dead && e.hostile && e.ownerId === null && e.id !== first.id,
    );
    if (!second) throw new Error('test needs a second live wild mob');

    sim.targetEntity(first.id, playerId);
    sim.chat('/focus', playerId);
    expect(errors(sim.tick())).toContain('Focus set to Focus Wolf.');
    expect(sim.entities.get(playerId)?.focusTargetId).toBe(first.id);

    sim.targetEntity(second.id, playerId);
    expect(sim.entities.get(playerId)?.targetId).toBe(second.id);
    expect(sim.entities.get(playerId)?.focusTargetId).toBe(first.id);
  });

  it('sets focus by unambiguous unit name and clears it without sending chat', () => {
    const sim = makeWorld();
    const playerId = sim.addPlayer('warrior', 'Aleph');
    const focus = liveMob(sim);
    focus.name = 'Moonfang';

    sim.chat('/focus moonfang', playerId);
    let events = sim.tick();
    expect(events.some((e) => e.type === 'chat')).toBe(false);
    expect(errors(events)).toContain('Focus set to Moonfang.');
    expect(sim.entities.get(playerId)?.focusTargetId).toBe(focus.id);

    sim.chat('/clearfocus', playerId);
    events = sim.tick();
    expect(events.some((e) => e.type === 'chat')).toBe(false);
    expect(errors(events)).toContain('Focus target cleared.');
    expect(sim.entities.get(playerId)?.focusTargetId).toBeNull();
  });
});
