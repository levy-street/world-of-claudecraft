// The two deliberate rng-draw compensations on the max-health heal path
// (review 3050: both read as dead code and both are load-bearing for the
// shared-stream draw order). effect_dispatch's 'heal' case ALWAYS rolls
// min/max even when casterMaxHpPct discards the roll (legacy Last Rite order),
// and burns one chance() draw when canCrit === false (the crit roll every
// other direct heal takes). Deleting either would silently shift every draw
// that follows in the tick for every seed, breaking parity goldens far from
// the edit. This pin turns that deletion into a local red instead.
import { describe, expect, it } from 'vitest';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { repeatDawnEcho } from '../src/sim/combat/paladin_talents';
import type { PlayerMeta, ResolvedAbility } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';

type TestSim = Sim & { players: Map<number, PlayerMeta> };

describe('rng draw-order compensations (max-health heal path)', () => {
  it('lay_on_hands consumes exactly two draws: the discarded roll and the burned crit', () => {
    const sim = new Sim({ seed: 31, playerClass: 'paladin', autoEquip: true }) as TestSim;
    sim.setPlayerLevel(20);
    const p = sim.player;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing meta');
    p.hp = Math.floor(p.maxHp / 2);
    const res = sim.ctx.resolvedAbility('lay_on_hands', p.id) as ResolvedAbility | null;
    if (!res) throw new Error('lay_on_hands did not resolve');

    let draws = 0;
    sim.rng.setObserver(() => {
      draws += 1;
    });
    runEffects(sim.ctx, p, meta, p, res);
    sim.rng.setObserver(null);

    // Draw 1: the always-rolled min/max the casterMaxHpPct arm discards.
    // Draw 2: the chance(0) burn standing in for the skipped crit roll.
    // A third party appears here only if the heal path itself changes shape;
    // re-derive deliberately, never delete the compensations to make it 2.
    expect(draws).toBe(2);
    expect(p.hp).toBe(p.maxHp);
  });

  it('a Dawn Echo repeat (the alreadyResolved heal copy) draws zero rng: no compensation needed', () => {
    // heal.ts's alreadyResolved flag is a SECOND, unrelated skip-draw path: the
    // crit ternary short-circuits on `!alreadyResolved` before it ever reaches
    // canCrit, so a repeat copy never rolls and never needs a chance(0) burn
    // the way the max-health heal path above does. paladin_talents.ts's
    // repeatDawnEcho is the real caller (Dawn Echo copies an already-resolved
    // heal at 40%); pin it at zero draws so a future change cannot silently
    // add a roll (or a needless compensation) and shift the shared stream.
    const sim = new Sim({ seed: 31, playerClass: 'paladin', autoEquip: true }) as TestSim;
    sim.setPlayerLevel(20);
    const p = sim.player;
    p.hp = Math.floor(p.maxHp / 2);

    let draws = 0;
    sim.rng.setObserver(() => {
      draws += 1;
    });
    const healed = repeatDawnEcho(sim.ctx, p, { kind: 'healing', target: p, amount: 100 });
    sim.rng.setObserver(null);

    expect(healed).toBe(true);
    expect(draws).toBe(0);
  });
});
