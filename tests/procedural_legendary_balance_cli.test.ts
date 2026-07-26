import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLegendaryBalanceCliArguments } from '../scripts/procedural_legendary_balance_cli';

describe('procedural legendary balance CLI', () => {
  it('parses enforcement and both integer argument forms across a separator', () => {
    expect(
      parseLegendaryBalanceCliArguments(['--', '--enforce', '--samples=250', '--seed', '1234']),
    ).toEqual({
      enforce: true,
      samplesPerRollEdge: 250,
      seed: 1234,
    });
  });

  it('rejects swallowed or misspelled flags instead of silently using release defaults', () => {
    expect(() => parseLegendaryBalanceCliArguments(['1'])).toThrow(
      'unknown legendary balance argument: 1',
    );
    expect(() => parseLegendaryBalanceCliArguments(['--enforc'])).toThrow(
      'unknown legendary balance argument: --enforc',
    );
    expect(() => parseLegendaryBalanceCliArguments(['--samples'])).toThrow(
      '--samples requires an integer',
    );
  });

  it('makes the primary npm command fail-closed and keeps report mode explicit', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['loot:balance']).toContain('--enforce');
    expect(packageJson.scripts['loot:balance:report']).not.toContain('--enforce');
  });
});
