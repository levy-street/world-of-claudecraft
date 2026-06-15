import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import type { Aura } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x; e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Start an accepted duel between two adjacent players and run the countdown
// out so the bout is live.
function startedDuel(): { sim: Sim; a: number; b: number } {
  const sim = makeWorld();
  const a = sim.addPlayer('warrior', 'Aleph');
  const b = sim.addPlayer('mage', 'Bet');
  teleport(sim, a, 0, -40);
  teleport(sim, b, 4, -40);
  sim.duelRequest(b, a);
  sim.duelAccept(b);
  // run the 3s countdown (TICK_RATE = 20) to flip the duel to 'active'
  for (let i = 0; i < 20 * 4; i++) {
    sim.tick();
    const d = (sim as any).duels.get(a);
    if (d && d.state === 'active') break;
  }
  return { sim, a, b };
}

// A bleed/poison style damage-over-time applied by the opponent.
function opponentDot(sourceId: number): Aura {
  return {
    id: 'test_bleed', name: 'Test Bleed', kind: 'dot',
    remaining: 10, duration: 10, value: 40,
    tickInterval: 1, tickTimer: 1,
    sourceId, school: 'physical',
  } as Aura;
}

describe('duel: non-lethal cleanup', () => {
  it('a lingering opponent DoT does not kill the loser after the duel ends', () => {
    const { sim, a, b } = startedDuel();
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    expect((sim as any).duels.get(a)?.state).toBe('active');

    // Aleph puts a strong bleed on Bet, then lands the finishing blow. The
    // 1-HP duel guard fires, the duel ends, Bet survives at 1 HP.
    (sim as any).applyAura(eb, opponentDot(ea.id));
    (sim as any).dealDamage(ea, eb, eb.hp + 1000, false, 'physical', 'Finisher', 'hit');

    expect((sim as any).duels.has(b)).toBe(false); // duel is over
    expect(eb.dead).toBe(false);
    expect(eb.hp).toBe(1);

    // Run a few seconds so the leftover bleed ticks several times.
    for (let i = 0; i < 20 * 3; i++) sim.tick();

    // The duel was non-lethal — the opponent's leftover DoT must not have
    // killed Bet for real after the bout ended.
    expect(eb.dead).toBe(false);
    expect(eb.hp).toBeGreaterThanOrEqual(1);
  });

  it('a lingering DoT does not kill a player who forfeits by running away', () => {
    const { sim, a, b } = startedDuel();
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;

    (sim as any).applyAura(eb, opponentDot(ea.id));
    eb.hp = 30; // wounded but alive

    // Bet flees past the forfeit distance, ending the duel as a draw.
    teleport(sim, b, 400, -40);
    sim.tick();
    expect((sim as any).duels.has(b)).toBe(false);

    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(eb.dead).toBe(false);
  });
});
