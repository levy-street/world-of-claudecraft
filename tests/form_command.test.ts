import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { AuraKind, SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

// Push a toggle aura directly onto a player; forms/stances use the 3600s
// toggle sentinel for both remaining and duration.
function giveForm(sim: Sim, pid: number, kind: AuraKind, name: string) {
  const e = sim.entities.get(pid)!;
  e.auras.push({
    id: name.toLowerCase().replace(/\s+/g, '_'),
    name,
    kind,
    remaining: 3600,
    duration: 3600,
    value: 1,
    sourceId: pid,
    school: 'physical',
  });
}

function lastReply(sim: Sim, cmd: string, pid: number): string {
  sim.chat(cmd, pid);
  const texts = errorTexts(sim.tick());
  return texts[texts.length - 1];
}

describe('/form command', () => {
  it('reports no form or stance by default', () => {
    // Warriors now auto-wear a stance, so the no-form default uses a paladin.
    const sim = makeWorld();
    const a = sim.addPlayer('paladin', 'Aleph');
    sim.tick();
    expect(lastReply(sim, '/form', a)).toBe('You are not in any form or stance.');
  });

  it('reports the battle stance a fresh warrior auto-wears', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    expect(lastReply(sim, '/form', a)).toBe('You are in Battle Stance.');
  });

  it('names a warrior defensive stance', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    // Arms may hold Guarded Stance; swap the auto-worn Battle Stance for it so
    // the per-tick stance reconcile leaves the pushed aura in place.
    sim.setPlayerLevel(10, a);
    expect(sim.setSpec('arms', a)).toBe(true);
    const e = sim.entities.get(a)!;
    e.auras = e.auras.filter((au) => au.kind !== 'battle_stance');
    giveForm(sim, a, 'defensive_stance', 'Defensive Stance');
    expect(lastReply(sim, '/form', a)).toBe('You are in Defensive Stance.');
  });

  it('names a druid shapeshift form', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Bet');
    sim.tick();
    giveForm(sim, a, 'form_bear', 'Bear Form');
    expect(lastReply(sim, '/form', a)).toBe('You are in Bear Form.');
  });

  it('uses dedicated phrasing for rogue stealth', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('rogue', 'Gimel');
    sim.tick();
    giveForm(sim, a, 'stealth', 'Stealth');
    expect(lastReply(sim, '/form', a)).toBe('You are stealthed.');
  });

  it('answers to the /stance and /shapeshift aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Dalet');
    sim.tick();
    giveForm(sim, a, 'form_cat', 'Wolf Form');
    expect(lastReply(sim, '/stance', a)).toBe('You are in Wolf Form.');
    expect(lastReply(sim, '/shapeshift', a)).toBe('You are in Wolf Form.');
  });

  it('is self-only and never emits a chat event', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const sent = sim.chat('/form', a);
    expect(sent).toBeNull();
    const events = sim.tick();
    expect(events.some((e) => e.type === 'chat')).toBe(false);
  });
});
