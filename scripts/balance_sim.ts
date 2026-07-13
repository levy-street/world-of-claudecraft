// Monte Carlo combat balance simulator, the adversarial layer of the balance
// framework (docs/design/combat-balance-simulator.md). Runs PvP duel round
// robins and PvE kill benchmarks over the real Sim for every spec, and reports
// which classes and talents are out of band.
//
// Run: npx tsx scripts/balance_sim.ts [flags]     (npm run sim:balance)
//   --trials N          bouts per matchup and per pve target (default 20)
//   --seed N            experiment base seed (default 1337)
//   --level N           fighter level (default the level cap)
//   --specs a,b,c       restrict to these spec keys (default all 27)
//   --pvp-only / --pve-only
//   --knockout          per-talent knockout attribution (slow, opt in)
//   --knockout-trials N duels per knockout matchup (default 6)
//   --max-seconds N     bout cap in sim seconds (default 180)
//   --out DIR           output directory (default tmp/balance_sim)
//   --quiet             no progress line

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultConfig, runExperiment } from './balance_sim/experiment';
import { renderMarkdown } from './balance_sim/report';
import { SPEC_CATALOG } from './balance_sim/spec_catalog';

function main(argv: string[]): void {
  const cfg = defaultConfig();
  let outDir = join('tmp', 'balance_sim');
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    if (arg === '--trials') cfg.trials = Number(next());
    else if (arg === '--seed') cfg.baseSeed = Number(next());
    else if (arg === '--level') cfg.level = Number(next());
    else if (arg === '--specs') cfg.specKeys = next().split(',');
    else if (arg === '--pvp-only') cfg.pve = false;
    else if (arg === '--pve-only') cfg.pvp = false;
    else if (arg === '--knockout') cfg.knockout = true;
    else if (arg === '--knockout-trials') cfg.knockoutTrials = Number(next());
    else if (arg === '--max-seconds') cfg.maxSeconds = Number(next());
    else if (arg === '--out') outDir = next();
    else if (arg === '--quiet') quiet = true;
    else if (arg === '--help') {
      console.log('see the header of scripts/balance_sim.ts for flags');
      return;
    } else throw new Error(`unknown flag ${arg} (see --help)`);
  }
  const known = new Set(SPEC_CATALOG.map((s) => s.key));
  for (const key of cfg.specKeys) {
    if (!known.has(key)) throw new Error(`unknown spec "${key}" (known: ${[...known].join(', ')})`);
  }

  const t0 = performance.now();
  const result = runExperiment(cfg, (done, total, label) => {
    if (!quiet) process.stdout.write(`\r[${done}/${total}] ${label.padEnd(60)}`);
  });
  if (!quiet) process.stdout.write('\n');

  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, 'balance_report.json');
  const mdPath = join(outDir, 'balance_report.md');
  writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  writeFileSync(mdPath, renderMarkdown(result));

  console.log(`\nwrote ${jsonPath}`);
  console.log(`wrote ${mdPath}`);
  console.log(`wall time ${(Math.round(performance.now() - t0) / 1000).toFixed(1)}s\n`);
  console.log('Top of the brokenness ranking:');
  for (const r of result.ranking.slice(0, 8)) {
    console.log(
      `  ${r.key.padEnd(24)} score ${r.brokenScore.toFixed(2).padStart(6)}  ${r.verdict}`,
    );
  }
  if (result.realDeathCount > 0) {
    console.log(
      `\nanomaly: ${result.realDeathCount} duel(s) ended in a REAL death (1 hp guard hole)`,
    );
  }
}

main(process.argv.slice(2));
