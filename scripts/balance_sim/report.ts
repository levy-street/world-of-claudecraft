// Report rendering for the balance simulator: a human-readable markdown digest
// of an ExperimentResult. The full data (every duel record, the complete
// matchup matrix) ships in the JSON next to it; the markdown carries what a
// balance pass reads first. Pure string building, pinned by the report test.

import type { ExperimentResult } from './experiment';

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const num = (v: number, digits = 1): string => v.toFixed(digits);

export function renderMarkdown(result: ExperimentResult): string {
  const { config } = result;
  const lines: string[] = [];
  lines.push('# Combat balance report');
  lines.push('');
  lines.push(
    `Config: ${config.specKeys.length} specs, ${config.trials} trials per matchup, ` +
      `level ${config.level}, base seed ${config.baseSeed}, bout cap ${config.maxSeconds}s.`,
  );
  lines.push(
    'Method: Monte Carlo over the real deterministic Sim (real duels, real mobs, generated ' +
      'per-spec talent builds, best-in-slot stat-weight gear, one shared rotation policy).',
  );
  lines.push('');

  if (result.ranking.length > 0) {
    lines.push('## Brokenness ranking');
    lines.push('');
    lines.push(
      'Composite of PvP winrate z-score and PvE kill-speed z-score. ' +
        'Positive is stronger than the field; the verdict bands at 0.75 and 1.5 sigma.',
    );
    lines.push('');
    lines.push('| spec | broken score | pvp z | pve z | verdict |');
    lines.push('|---|---|---|---|---|');
    for (const r of result.ranking) {
      lines.push(
        `| ${r.key} | ${num(r.brokenScore, 2)} | ${r.pvpZ === null ? '-' : num(r.pvpZ, 2)} | ` +
          `${r.pveZ === null ? '-' : num(r.pveZ, 2)} | ${r.verdict} |`,
      );
    }
    lines.push('');
  }

  if (result.standings.length > 0) {
    lines.push('## PvP standings (duel round robin)');
    lines.push('');
    lines.push('Draws count as half a win. The Wilson bounds are the 95% confidence band.');
    lines.push('');
    lines.push('| spec | games | wins | draws | winrate | wilson low | wilson high |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const s of result.standings) {
      lines.push(
        `| ${s.key} | ${s.games} | ${s.wins} | ${s.draws} | ${pct(s.winRate)} | ` +
          `${pct(s.wilson.low)} | ${pct(s.wilson.high)} |`,
      );
    }
    lines.push('');

    const lopsided = extremeMatchups(result, 8);
    if (lopsided.length > 0) {
      lines.push('### Most lopsided matchups');
      lines.push('');
      lines.push('| matchup | winrate |');
      lines.push('|---|---|');
      for (const m of lopsided) lines.push(`| ${m.label} | ${pct(m.rate)} |`);
      lines.push('');
    }

    lines.push('### PvP detail per spec');
    lines.push('');
    lines.push(
      '| spec | avg duel s | avg dmg | avg healing | control ticks | top damage sources |',
    );
    lines.push('|---|---|---|---|---|---|');
    for (const d of result.pvpDetails) {
      const top = d.topDamageAbilities.map((t) => `${t.ability} ${pct(t.share)}`).join(', ');
      lines.push(
        `| ${d.key} | ${num(d.avgDuelSeconds)} | ${num(d.avgDamagePerDuel, 0)} | ` +
          `${num(d.avgHealingPerDuel, 0)} | ${num(d.avgControlTicksInflicted)} | ${top} |`,
      );
    }
    lines.push('');
  }

  if (result.pve.length > 0) {
    lines.push('## PvE benchmarks (solo kill attempts)');
    lines.push('');
    lines.push('| spec | target | kill rate | death rate | avg kill s | avg dps |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of result.pve) {
      lines.push(
        `| ${r.key} | ${r.targetKey} | ${pct(r.killRate)} | ${pct(r.deathRate)} | ` +
          `${r.avgKillSeconds === null ? '-' : num(r.avgKillSeconds)} | ${num(r.avgDps)} |`,
      );
    }
    lines.push('');
  }

  if (result.knockouts.length > 0) {
    lines.push('## Talent knockout attribution');
    lines.push('');
    lines.push(
      'Winrate delta of the full build against the same build minus one talent node, same ' +
        'seeds and opponents. A large positive delta marks the talent carrying the spec.',
    );
    lines.push('');
    lines.push('| spec | talent node | full winrate | without it | delta |');
    lines.push('|---|---|---|---|---|');
    for (const k of result.knockouts.slice(0, 30)) {
      lines.push(
        `| ${k.key} | ${k.nodeId} | ${pct(k.fullWinRate)} | ${pct(k.knockoutWinRate)} | ` +
          `${k.winRateDelta >= 0 ? '+' : ''}${pct(k.winRateDelta)} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Anomalies and caveats');
  lines.push('');
  lines.push(
    `- Real deaths inside duels (the 1 hp guard should make duels non-lethal): ${result.realDeathCount}.`,
  );
  lines.push(
    '- The shared policy plays every spec the same way: no kiting, no stealth openers, no ' +
      'consumables. Absolute winrates carry that bias; the RANKING between specs is the signal.',
  );
  lines.push('- Draws are sustain stalemates (healer mirrors mostly) and count as half a win.');
  lines.push('');
  return lines.join('\n');
}

export function extremeMatchups(
  result: ExperimentResult,
  limit: number,
): { label: string; rate: number }[] {
  const seen = new Set<string>();
  const rows: { label: string; rate: number }[] = [];
  for (const [rowKey, cols] of Object.entries(result.matchups)) {
    for (const [colKey, rate] of Object.entries(cols)) {
      const id = [rowKey, colKey].sort().join('|');
      if (seen.has(id)) continue;
      seen.add(id);
      const dominant = rate >= 0.5;
      rows.push({
        label: dominant ? `${rowKey} beats ${colKey}` : `${colKey} beats ${rowKey}`,
        rate: dominant ? rate : 1 - rate,
      });
    }
  }
  return rows.sort((a, b) => b.rate - a.rate || a.label.localeCompare(b.label)).slice(0, limit);
}
