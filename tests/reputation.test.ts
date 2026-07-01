import { describe, expect, it } from 'vitest';
import { REPUTATION_MAX, reputationStanding } from '../src/sim/content/factions';
import { grantReputation, normalizeReputation } from '../src/sim/reputation';
import { Sim } from '../src/sim/sim';

describe('reputation standing helpers', () => {
  it('maps faction points to standing bands', () => {
    expect(reputationStanding(-42000)).toBe('Hostile');
    expect(reputationStanding(-1)).toBe('Unfriendly');
    expect(reputationStanding(0)).toBe('Neutral');
    expect(reputationStanding(3000)).toBe('Friendly');
    expect(reputationStanding(9000)).toBe('Honored');
    expect(reputationStanding(21000)).toBe('Revered');
    expect(reputationStanding(42000)).toBe('Exalted');
  });

  it('normalizes persisted faction records', () => {
    expect(
      normalizeReputation({
        eastbrook: 3250.9,
        unknown: 99,
        bad: Number.NaN,
      }),
    ).toEqual({ eastbrook: 3250 });
  });
});

describe('grantReputation', () => {
  it('ignores unknown factions and clamps known totals', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior' });
    const meta = sim.meta(sim.playerId);
    expect(meta).toBeTruthy();
    if (!meta) return;

    expect(grantReputation(meta, 'unknown', 250)).toBeNull();
    expect(meta.reputation).toEqual({});

    expect(grantReputation(meta, 'eastbrook', 250)).toEqual({
      factionName: 'Eastbrook',
      amount: 250,
      total: 250,
      standing: 'Neutral',
    });
    expect(meta.reputation.eastbrook).toBe(250);

    const capped = grantReputation(meta, 'eastbrook', REPUTATION_MAX);
    expect(capped?.total).toBe(REPUTATION_MAX);
    expect(capped?.amount).toBe(REPUTATION_MAX - 250);
    expect(meta.reputation.eastbrook).toBe(REPUTATION_MAX);
  });
});

describe('/reputation readout', () => {
  it('reports current faction standings from player meta', () => {
    const sim = new Sim({ seed: 12, playerClass: 'warrior' });
    const pid = sim.playerId;

    sim.chat('/reputation', pid);
    expect(sim.drainEvents()).toContainEqual({
      type: 'error',
      text: 'Reputation: Eastbrook Neutral (0).',
      pid,
    });

    const meta = sim.meta(pid);
    expect(meta).toBeTruthy();
    if (!meta) return;
    meta.reputation.eastbrook = 3000;
    sim.chat('/rep', pid);
    expect(sim.drainEvents()).toContainEqual({
      type: 'error',
      text: 'Reputation: Eastbrook Friendly (3000).',
      pid,
    });
  });
});
