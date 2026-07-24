import {
  assertLegendaryBalanceRelease,
  LEGENDARY_BALANCE_SAMPLE_FLOOR,
  simulateLegendaryBalance,
} from './procedural_legendary_balance_core';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function integerArgument(name: string, fallback: number): number {
  const raw = argument(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

const report = simulateLegendaryBalance({
  samplesPerRollEdge: integerArgument('--samples', LEGENDARY_BALANCE_SAMPLE_FLOOR),
  seed: integerArgument('--seed', 32_106_458),
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (process.argv.includes('--enforce')) {
  try {
    assertLegendaryBalanceRelease(report);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
