import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseProceduralRaidBalanceCliArguments } from '../scripts/procedural_raid_balance_cli';

describe('procedural raid balance CLI', () => {
  it('parses enforcement and both integer argument forms', () => {
    expect(
      parseProceduralRaidBalanceCliArguments([
        '--',
        '--enforce',
        '--samples=250',
        '--seed',
        '1234',
      ]),
    ).toEqual({ enforce: true, samplesPerDifficulty: 250, seed: 1234 });
  });

  it('rejects missing, invalid, and unknown arguments', () => {
    expect(() => parseProceduralRaidBalanceCliArguments(['--samples'])).toThrow(
      '--samples requires an integer',
    );
    expect(() => parseProceduralRaidBalanceCliArguments(['--samples=0'])).toThrow(
      '--samples must be a positive integer',
    );
    expect(() => parseProceduralRaidBalanceCliArguments(['--enforc'])).toThrow(
      'unknown procedural raid balance argument: --enforc',
    );
  });

  it('wires raid enforcement into the primary release command', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['loot:balance']).toContain('procedural_raid_balance.ts --enforce');
    expect(packageJson.scripts['loot:balance:report']).toContain('procedural_raid_balance.ts');
    expect(packageJson.scripts['loot:balance:report']).not.toContain('--enforce');
  });
});
