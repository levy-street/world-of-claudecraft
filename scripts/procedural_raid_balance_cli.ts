import { RAID_BALANCE_SAMPLE_FLOOR } from './procedural_raid_balance_core';

export interface ProceduralRaidBalanceCliOptions {
  enforce: boolean;
  samplesPerDifficulty: number;
  seed: number;
}

function integerValue(name: string, raw: string | undefined): number {
  if (raw === undefined || raw.length === 0) throw new Error(`${name} requires an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

export function parseProceduralRaidBalanceCliArguments(
  argv: readonly string[],
): ProceduralRaidBalanceCliOptions {
  let enforce = false;
  let samplesPerDifficulty = RAID_BALANCE_SAMPLE_FLOOR;
  let seed = 30_037;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--enforce') {
      enforce = true;
      continue;
    }
    if (arg === '--samples') {
      samplesPerDifficulty = integerValue(arg, argv[++index]);
      continue;
    }
    if (arg.startsWith('--samples=')) {
      samplesPerDifficulty = integerValue('--samples', arg.slice('--samples='.length));
      continue;
    }
    if (arg === '--seed') {
      seed = integerValue(arg, argv[++index]);
      continue;
    }
    if (arg.startsWith('--seed=')) {
      seed = integerValue('--seed', arg.slice('--seed='.length));
      continue;
    }
    throw new Error(`unknown procedural raid balance argument: ${arg}`);
  }

  return { enforce, samplesPerDifficulty, seed };
}
