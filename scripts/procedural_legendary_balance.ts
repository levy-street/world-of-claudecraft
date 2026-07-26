import { parseLegendaryBalanceCliArguments } from './procedural_legendary_balance_cli';
import {
  assertLegendaryBalanceRelease,
  simulateLegendaryBalance,
} from './procedural_legendary_balance_core';

const options = parseLegendaryBalanceCliArguments(process.argv.slice(2));

const report = simulateLegendaryBalance({
  samplesPerRollEdge: options.samplesPerRollEdge,
  seed: options.seed,
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (options.enforce) {
  try {
    assertLegendaryBalanceRelease(report);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
