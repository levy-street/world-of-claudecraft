import { describe, expect, it } from 'vitest';

import { Sim } from '../src/sim/sim';
import type { CharacterState } from '../src/sim/sim';

function simWith(state?: Partial<CharacterState>): { sim: Sim; pid: number } {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
  // Build a baseline state, fold in the override, and load it as the character.
  const base = new Sim({ seed: 7, playerClass: 'warrior', playerName: 'HC' });
  const baseState = base.serializeCharacter(base.playerId)!;
  const pid = sim.addPlayer('warrior', 'HC', { state: { ...baseState, ...state } });
  return { sim, pid };
}

describe('Hardcore mode', () => {
  it('a hardcore character that dies becomes permanently deceased', () => {
    const { sim, pid } = simWith({ hardcore: true });
    const p = sim.entities.get(pid)!;
    // Drive the death funnel with lethal self-damage (no source).
    (sim as unknown as { dealDamage: (...a: unknown[]) => void }).dealDamage(
      p, p, 99999, false, 'physical', null, 'hit',
    );
    expect(p.dead).toBe(true);

    // Spirit release must NOT revive a deceased hardcore character.
    sim.releaseSpirit(pid);
    expect(sim.entities.get(pid)!.dead).toBe(true);

    // The deceased flag persists across a serialize round-trip.
    const saved = sim.serializeCharacter(pid)!;
    expect(saved.hardcore).toBe(true);
    expect(saved.deceased).toBe(true);
  });

  it('a normal character revives at the graveyard on spirit release', () => {
    const { sim, pid } = simWith({ hardcore: false });
    const p = sim.entities.get(pid)!;
    (sim as unknown as { dealDamage: (...a: unknown[]) => void }).dealDamage(
      p, p, 99999, false, 'physical', null, 'hit',
    );
    expect(p.dead).toBe(true);

    sim.releaseSpirit(pid);
    expect(sim.entities.get(pid)!.dead).toBe(false);
  });

  it('non-hardcore saves stay free of the hardcore/deceased keys', () => {
    const { sim, pid } = simWith({ hardcore: false });
    const saved = sim.serializeCharacter(pid)!;
    expect(saved.hardcore).toBeUndefined();
    expect(saved.deceased).toBeUndefined();
  });
});
