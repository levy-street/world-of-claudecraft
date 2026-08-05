// Memory-bounded launcher for the Source Cave probe matrix. Each real Sim run
// gets a fresh process, so the default 80-run matrix is stable on CI-sized hosts.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  aggregateProbeRuns,
  parseProbeSeeds,
  SOURCE_CAVE_PROBE_PROFILES,
  type SourceCaveProbeProfileKey,
} from './source_cave_probe_core';
import type { ProbeRunResult } from './source_cave_raid_probe';

function profileKeys(): SourceCaveProbeProfileKey[] {
  const values = process.env.PROBE_PROFILES
    ? process.env.PROBE_PROFILES.split(',').map((value) => value.trim())
    : Object.keys(SOURCE_CAVE_PROBE_PROFILES);
  return values.map((value) => {
    if (!(value in SOURCE_CAVE_PROBE_PROFILES)) {
      throw new Error(`Unknown PROBE_PROFILES entry: ${value}`);
    }
    return value as SourceCaveProbeProfileKey;
  });
}

function runBatch(seeds: readonly number[], profile: SourceCaveProbeProfileKey): ProbeRunResult[] {
  const script = fileURLToPath(new URL('./source_cave_raid_probe.ts', import.meta.url));
  const child = spawnSync(
    process.execPath,
    ['--max-old-space-size=256', '--import', 'tsx', script],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PROBE_JSON: '1',
        PROBE_QUIET: '1',
        PROBE_SEED: undefined,
        PROBE_SEEDS: seeds.join(','),
        PROBE_PROFILES: profile,
      },
    },
  );
  if (child.status !== 0) {
    throw new Error(
      `probe failed (${profile}/${seeds.join(',')}): ${child.stderr || child.stdout}`,
    );
  }
  const json = child.stdout
    .trim()
    .split('\n')
    .reverse()
    .find((line: string) => line.startsWith('[{'));
  if (!json) throw new Error(`probe returned no JSON (${profile}/${seeds.join(',')})`);
  const results = JSON.parse(json) as ProbeRunResult[];
  if (results.length !== seeds.length) throw new Error(`probe returned ${results.length} runs`);
  return results;
}

const seeds = parseProbeSeeds(process.env);
const allResults: ProbeRunResult[] = [];
const round1 = (value: number): number => Math.round(value * 10) / 10;
for (const profile of profileKeys()) {
  const results: ProbeRunResult[] = [];
  for (let i = 0; i < seeds.length; i += 4) {
    results.push(...runBatch(seeds.slice(i, i + 4), profile));
  }
  allResults.push(...results);
  const summary = aggregateProbeRuns(results);
  console.log(
    `${profile}: ${summary.clears}/${summary.validRuns} clears, ${summary.invalidRuns} invalid, ` +
      `median clear ${round1(summary.medianClearSeconds)}s, p90 deaths ${summary.p90Deaths}, ` +
      `p10 healer mana ${summary.p10MinHealerManaPct}%`,
  );
}
if (process.env.PROBE_JSON === '1') console.log(JSON.stringify(allResults));
