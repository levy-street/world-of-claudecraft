import type { PlayerClass } from '../src/sim/types';
import {
  type ProceduralLootSimulationOptions,
  simulateProceduralLoot,
} from './procedural_loot_sim_core';

const CLASSES = new Set<PlayerClass>([
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
]);

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

function optionsFromArguments(): ProceduralLootSimulationOptions {
  const personalLootClass = argument('--class');
  if (personalLootClass && !CLASSES.has(personalLootClass as PlayerClass))
    throw new Error(`unknown player class ${personalLootClass}`);
  return {
    poolId: argument('--pool') ?? 'initial_world',
    rarityTableId: argument('--table') ?? 'initial_world',
    itemLevel: integerArgument('--level', 18),
    count: integerArgument('--count', 100_000),
    worldSeed: integerArgument('--seed', 13_371_337),
    ...(personalLootClass && {
      personalLootClass: personalLootClass as PlayerClass,
    }),
  };
}

const report = simulateProceduralLoot(optionsFromArguments());
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
