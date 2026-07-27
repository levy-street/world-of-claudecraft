import { parseProceduralRaidBalanceCliArguments } from './procedural_raid_balance_cli';
import {
  assertProceduralRaidBalanceRelease,
  simulateProceduralRaidBalance,
} from './procedural_raid_balance_core';

const options = parseProceduralRaidBalanceCliArguments(process.argv.slice(2));
const report = simulateProceduralRaidBalance({
  samplesPerDifficulty: options.samplesPerDifficulty,
  seed: options.seed,
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (options.enforce) {
  try {
    assertProceduralRaidBalanceRelease(report);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
