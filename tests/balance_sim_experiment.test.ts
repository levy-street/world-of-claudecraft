// The Monte Carlo experiment runner and report renderer, exercised end to end
// on a deliberately tiny matrix so the suite stays fast.
import { describe, expect, it } from 'vitest';
import { defaultConfig, mixSeed, runExperiment } from '../scripts/balance_sim/experiment';
import { extremeMatchups, renderMarkdown } from '../scripts/balance_sim/report';
import { SPEC_CATALOG } from '../scripts/balance_sim/spec_catalog';

describe('mixSeed', () => {
  it('is deterministic and spreads across coordinates', () => {
    expect(mixSeed(1337, 1, 2, 3)).toBe(mixSeed(1337, 1, 2, 3));
    const seen = new Set<number>();
    for (let a = 0; a < 10; a++) {
      for (let t = 0; t < 10; t++) seen.add(mixSeed(1337, a, 1, t));
    }
    expect(seen.size).toBe(100);
    expect(mixSeed(1, 0, 0, 0)).not.toBe(mixSeed(2, 0, 0, 0));
  });
});

describe('runExperiment', () => {
  const tinyConfig = () => {
    const cfg = defaultConfig();
    cfg.specKeys = ['fury_warrior', 'frost_mage'];
    cfg.trials = 2;
    cfg.maxSeconds = 90;
    cfg.pveTargets = [{ key: 'standard', templateId: 'forest_wolf' }];
    return cfg;
  };

  it('produces standings, matchups, pve rows, and a ranking', () => {
    const labels: string[] = [];
    const result = runExperiment(tinyConfig(), (_done, _total, label) => labels.push(label));
    expect(result.standings).toHaveLength(2);
    const games = result.standings.map((s) => s.games);
    expect(games).toEqual([2, 2]);
    for (const s of result.standings) {
      expect(s.wins + s.losses + s.draws).toBe(s.games);
      expect(s.winRate).toBeGreaterThanOrEqual(0);
      expect(s.winRate).toBeLessThanOrEqual(1);
      expect(s.wilson.low).toBeLessThanOrEqual(s.winRate);
      expect(s.wilson.high).toBeGreaterThanOrEqual(s.winRate);
    }
    expect(result.duels).toHaveLength(2);
    expect(result.matchups.fury_warrior.frost_mage).toBeDefined();
    expect(result.matchups.frost_mage.fury_warrior).toBeCloseTo(
      1 - result.matchups.fury_warrior.frost_mage,
      10,
    );
    expect(result.pve).toHaveLength(2);
    for (const row of result.pve) {
      expect(row.trials).toBe(2);
      expect(row.killRate).toBeGreaterThan(0);
    }
    expect(result.ranking).toHaveLength(2);
    expect(result.realDeathCount).toBe(result.duels.filter((d) => d.realDeath).length);
    expect(labels.some((l) => l.startsWith('pvp'))).toBe(true);
    expect(labels.some((l) => l.startsWith('pve'))).toBe(true);
  }, 120000);

  it('is deterministic end to end for the same config', () => {
    const one = runExperiment(tinyConfig());
    const two = runExperiment(tinyConfig());
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  }, 120000);

  it('rejects an unknown spec key', () => {
    const cfg = tinyConfig();
    cfg.specKeys = ['no_such_spec'];
    expect(() => runExperiment(cfg)).toThrow(/unknown spec key/);
  });

  it('honors pvp-only and pve-only modes', () => {
    const cfg = tinyConfig();
    cfg.pve = false;
    const result = runExperiment(cfg);
    expect(result.pve).toHaveLength(0);
    expect(result.duels.length).toBeGreaterThan(0);
    const cfg2 = tinyConfig();
    cfg2.pvp = false;
    const result2 = runExperiment(cfg2);
    expect(result2.duels).toHaveLength(0);
    expect(result2.pve.length).toBeGreaterThan(0);
  }, 120000);
});

describe('report rendering', () => {
  it('renders every section with the spec keys and no banned characters', () => {
    const cfg = defaultConfig();
    cfg.specKeys = ['fury_warrior', 'frost_mage'];
    cfg.trials = 1;
    cfg.maxSeconds = 90;
    cfg.pveTargets = [{ key: 'standard', templateId: 'forest_wolf' }];
    const result = runExperiment(cfg);
    const md = renderMarkdown(result);
    expect(md).toContain('# Combat balance report');
    expect(md).toContain('## Brokenness ranking');
    expect(md).toContain('## PvP standings');
    expect(md).toContain('## PvE benchmarks');
    expect(md).toContain('fury_warrior');
    expect(md).toContain('frost_mage');
    // The repo bans em dashes (u2014), en dashes (u2013), and emoji in all output.
    expect(md).not.toMatch(/[\u2013\u2014\u{1f300}-\u{1faff}]/u);
    const extremes = extremeMatchups(result, 5);
    expect(extremes.length).toBeGreaterThan(0);
    expect(extremes[0].rate).toBeGreaterThanOrEqual(0.5);
  }, 120000);
});

describe('spec catalog exports', () => {
  it('exposes all 27 specs', () => {
    expect(SPEC_CATALOG).toHaveLength(27);
  });
});
