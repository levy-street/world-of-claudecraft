// The auras a player carries into a Graveyard Shift come back on the way out
// (owner decision): buffs are not lost, a penalty is not shed by starting a
// shift and leaving at once, and their timers are frozen for the run like the
// pools. Forms, stances, stealth and crowd control do not come back; the
// recovery sickness comes back once, through the pools.
import { describe, expect, it } from 'vitest';
import { hasMorthenIdentity } from '../src/sim/graveyard_shift/morthen_identity';
import {
  graveyardShiftResolveLeave,
  startGraveyardShift,
} from '../src/sim/graveyard_shift/run_lifecycle';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift/run_state';
import { RESURRECTION_SICKNESS_ID } from '../src/sim/resurrection';
import { Sim } from '../src/sim/sim';
import type { Aura, AuraKind } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function aura(id: string, kind: AuraKind, remaining: number, value = 0): Aura {
  return {
    id,
    name: id,
    kind,
    remaining,
    duration: remaining * 2,
    value,
    sourceId: 0,
    school: 'physical',
  } as Aura;
}

function shiftSim() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    devCommands: true,
    offlineHost: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(15);
  return sim;
}

const ids = (sim: Sim) => sim.player.auras.map((a) => a.id);

describe('the auras a player carries into a shift', () => {
  it('come back on the way out with their timers frozen, buffs and penalties alike', () => {
    const sim = shiftSim();
    const p = sim.player;
    p.auras.push(
      aura('test_well_fed', 'buff_sta', 600, 20),
      aura('test_penalty', 'debuff_ap', 300, 50),
    );
    (sim as any).recalcPlayer(p);
    const fedMaxHp = p.maxHp;
    expect(startGraveyardShift(sim.ctx, sim.playerId, 'dev')).toBeNull();
    // On shift the clean slate has shed them.
    expect(ids(sim)).not.toContain('test_well_fed');
    expect(ids(sim)).not.toContain('test_penalty');
    expect(hasMorthenIdentity(p)).toBe(true);
    // Half a minute on shift: the carried timers do not run.
    for (let i = 0; i < 20 * 30; i++) sim.tick();
    graveyardShiftRunFor(sim.ctx, sim.playerId)!.pendingOutcome = 'aborted';
    sim.tick();
    expect(hasMorthenIdentity(p)).toBe(false);
    const fed = p.auras.find((a) => a.id === 'test_well_fed');
    const penalty = p.auras.find((a) => a.id === 'test_penalty');
    expect(fed?.remaining).toBeGreaterThan(599);
    expect(penalty?.remaining).toBeGreaterThan(299);
    // The stamina buff is folded back into the stats.
    expect(p.maxHp).toBe(fedMaxHp);
  });

  it('a leaver gets them back too', () => {
    const sim = shiftSim();
    sim.player.auras.push(aura('test_penalty', 'debuff_ap', 300, 50));
    expect(startGraveyardShift(sim.ctx, sim.playerId, 'dev')).toBeNull();
    graveyardShiftResolveLeave(sim.ctx, sim.playerId);
    expect(ids(sim)).toContain('test_penalty');
  });

  it('never brings back a form, a stance, stealth or crowd control', () => {
    const sim = shiftSim();
    const kept = aura('test_buff', 'buff_str', 600, 5);
    const dropped: Aura[] = [
      aura('test_bear', 'form_bear', 600),
      aura('test_stance', 'defensive_stance', 600),
      aura('test_stealth', 'stealth', 600),
      aura('test_root', 'root', 5),
      aura('test_stun', 'stun', 5),
    ];
    sim.player.auras.push(kept, ...dropped);
    expect(startGraveyardShift(sim.ctx, sim.playerId, 'dev')).toBeNull();
    graveyardShiftRunFor(sim.ctx, sim.playerId)!.pendingOutcome = 'aborted';
    sim.tick();
    expect(ids(sim)).toContain('test_buff');
    for (const a of dropped) expect(ids(sim)).not.toContain(a.id);
  });

  it('hands the recovery sickness back once, through the pools, never twice', () => {
    const sim = shiftSim();
    sim.player.auras.push(aura(RESURRECTION_SICKNESS_ID, 'debuff_ap', 200));
    expect(startGraveyardShift(sim.ctx, sim.playerId, 'dev')).toBeNull();
    graveyardShiftRunFor(sim.ctx, sim.playerId)!.pendingOutcome = 'aborted';
    sim.tick();
    expect(ids(sim).filter((id) => id === RESURRECTION_SICKNESS_ID)).toHaveLength(1);
  });
});
