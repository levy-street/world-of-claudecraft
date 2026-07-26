import { LEGENDARY_BALANCE_SAMPLE_FLOOR } from './procedural_legendary_balance_core';

export interface LegendaryBalanceCliOptions {
  enforce: boolean;
  samplesPerRollEdge: number;
  seed: number;
}

function integerValue(name: string, raw: string | undefined): number {
  if (raw === undefined || raw.length === 0) throw new Error(`${name} requires an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

export function parseLegendaryBalanceCliArguments(
  argv: readonly string[],
): LegendaryBalanceCliOptions {
  let enforce = false;
  let samplesPerRollEdge = LEGENDARY_BALANCE_SAMPLE_FLOOR;
  let seed = 32_106_458;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--enforce') {
      enforce = true;
      continue;
    }
    if (arg === '--samples') {
      samplesPerRollEdge = integerValue(arg, argv[++index]);
      continue;
    }
    if (arg.startsWith('--samples=')) {
      samplesPerRollEdge = integerValue('--samples', arg.slice('--samples='.length));
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
    throw new Error(`unknown legendary balance argument: ${arg}`);
  }

  return { enforce, samplesPerRollEdge, seed };
}
