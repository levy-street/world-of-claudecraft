import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorText(events: SimEvent[], pid: number): string | undefined {
  const e = events.find(
    (ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error' && ev.pid === pid,
  );
  return e?.text;
}

describe('/attack command', () => {
  it('reports auto-attack as off for an idle player', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/attack', a);
    expect(errorText(sim.tick(), a)).toBe('Auto-attack is off.');
  });

  it('reports the target, next swing, and swing interval when engaged', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    const target = sim.addPlayer('mage', 'Bet');
    sim.tick();
    const pa = sim.entities.get(a)!;
    const tb = sim.entities.get(target)!;
    pa.autoAttack = true;
    pa.targetId = tb.id;
    pa.swingTimer = 1.2;
    sim.chat('/attack', a);
    const expected = (pa.weapon.speed).toFixed(1);
    expect(errorText(sim.tick(), a)).toBe(
      `Auto-attack is on against Bet — next swing in 1.2s (${expected}s swing).`,
    );
  });

  it('says "now" when the swing is ready', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    const target = sim.addPlayer('mage', 'Bet');
    sim.tick();
    const pa = sim.entities.get(a)!;
    pa.autoAttack = true;
    pa.targetId = target;
    pa.swingTimer = 0;
    sim.chat('/aa', a);
    expect(errorText(sim.tick(), a)).toContain('next swing now');
  });

  it('reports no valid target when the foe is gone', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const pa = sim.entities.get(a)!;
    pa.autoAttack = true;
    pa.targetId = 9999; // unresolvable
    sim.chat('/autoattack', a);
    expect(errorText(sim.tick(), a)).toBe('Auto-attack is on, but you have no valid target.');
  });
});
