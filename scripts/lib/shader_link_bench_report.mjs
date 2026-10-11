// The pure half of scripts/shader_link_bench.mjs: turns per-program link
// timings into the numbers that answer one question, "is the cost held by a
// few programs or spread over all of them". No fs, no browser; pinned by
// tests/shader_link_bench_report.test.ts.
//
// Two costs per program. `firstMs` is the first salted link: everything cold
// that a salt can make cold. `repeatMs` is the median of the later salted
// links: the browser and ANGLE caches still miss, but the GPU driver may now
// hit on the identical compiled bytecode, so it approximates the backend
// compile alone. The ranking uses `repeatMs` when there is one, because it is
// the part a shader rewrite can change and the more repeatable of the two.

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** One row per program that linked; failures are returned apart. */
export function summarizePrograms(results) {
  const rows = [];
  const failures = [];
  for (const r of results) {
    const runs = r.runs ?? [];
    if (!runs.length || runs.some((run) => !run.ok)) {
      failures.push({ hash: r.hash, name: r.name, log: runs.find((run) => !run.ok)?.log ?? '' });
      continue;
    }
    const firstMs = runs[0].ms;
    const later = runs.slice(1).map((run) => run.ms);
    const repeatMs = later.length ? median(later) : firstMs;
    const draws = runs.map((run) => run.drawMs).filter((v) => typeof v === 'number');
    rows.push({
      base: r.base,
      variant: r.variant,
      group: r.group,
      hash: r.hash,
      name: r.name,
      kind: r.kind,
      firstStep: r.firstStep,
      profiles: r.profiles ?? [],
      firstMs,
      repeatMs,
      costMs: repeatMs,
      // Per-repetition figures, kept because a backend that defers work makes
      // repetitions unequal and a median would hide it.
      linkMsByRep: runs.map((run) => run.ms),
      firstDrawMs: draws.length ? draws[0] : null,
      drawMedianMs: draws.length ? median(draws) : null,
      drawErrors: runs.filter((run) => run.drawError).length,
    });
  }
  rows.sort((a, b) => b.costMs - a.costMs);
  return { rows, failures };
}

/**
 * How concentrated the cost is. `topShare(n)` is the share of the summed cost
 * held by the n dearest programs; `tailRatio` is p95 over the median. A flat
 * corpus has a tailRatio near 1 and a top-10 share near 10 / count.
 */
export function concentration(rows) {
  const costs = rows.map((r) => r.costMs);
  const total = costs.reduce((a, b) => a + b, 0);
  const topShare = (n) =>
    total > 0 ? rows.slice(0, n).reduce((a, r) => a + r.costMs, 0) / total : 0;
  const med = median(costs);
  return {
    count: rows.length,
    totalMs: total,
    medianMs: med,
    p90Ms: quantile(costs, 0.9),
    p95Ms: quantile(costs, 0.95),
    maxMs: costs.length ? Math.max(...costs) : 0,
    tailRatio: med > 0 ? quantile(costs, 0.95) / med : 0,
    top10Share: topShare(10),
    top10FlatShare: rows.length ? Math.min(1, 10 / rows.length) : 0,
    top10PercentShare: topShare(Math.max(1, Math.round(rows.length / 10))),
  };
}

/**
 * Ablation runs: every variant row paired with the baseline row of the SAME
 * program, so the saving is a per-program difference, never a difference of
 * group medians over different programs.
 */
export function pairedAblation(rows) {
  const baseline = new Map();
  for (const r of rows) if (r.variant === 'baseline') baseline.set(r.base, r);
  const byVariant = new Map();
  for (const r of rows) {
    if (!r.variant || r.variant === 'baseline') continue;
    const b = baseline.get(r.base);
    if (!b) continue;
    const key = `${r.variant}|${r.group ?? ''}`;
    const list = byVariant.get(key) ?? [];
    list.push({ baseMs: b.costMs, variantMs: r.costMs, savedMs: b.costMs - r.costMs });
    byVariant.set(key, list);
  }
  return [...byVariant]
    .map(([key, pairs]) => {
      const [variant, group] = key.split('|');
      return {
        variant,
        group,
        pairs: pairs.length,
        baseMedianMs: median(pairs.map((p) => p.baseMs)),
        variantMedianMs: median(pairs.map((p) => p.variantMs)),
        savedMedianMs: median(pairs.map((p) => p.savedMs)),
        savedMinMs: Math.min(...pairs.map((p) => p.savedMs)),
        savedMaxMs: Math.max(...pairs.map((p) => p.savedMs)),
      };
    })
    .sort((a, b) => a.group.localeCompare(b.group) || b.savedMedianMs - a.savedMedianMs);
}

const ms = (v) => v.toFixed(1);
const pct = (v) => `${(v * 100).toFixed(1)} %`;

export function renderLinkBenchReport(payload) {
  const { rows, failures } = summarizePrograms(payload.results);
  const c = concentration(rows);
  const firstTotal = rows.reduce((a, r) => a + r.firstMs, 0);
  const lines = ['# Shader link bench report', ''];
  lines.push(`- machine: ${payload.machine?.renderer ?? 'unknown'}`);
  lines.push(`- browser: ${payload.browser}, angle flag: ${payload.angle}`);
  lines.push(
    `- corpus: commit ${payload.corpus?.gitSha}, ${payload.corpus?.programCount} programs`,
  );
  lines.push(`- ${payload.reps} salted links per program, ${payload.seconds} s in total`);
  lines.push(`- linked ${rows.length}, failed ${failures.length}`, '');
  lines.push('## Distribution (cost = median of the repeated salted links)', '');
  lines.push('| measure | value |', '|---|---|');
  lines.push(`| programs | ${c.count} |`);
  lines.push(`| sum of costs | ${ms(c.totalMs)} ms |`);
  lines.push(`| sum of first links | ${ms(firstTotal)} ms |`);
  lines.push(`| median | ${ms(c.medianMs)} ms |`);
  lines.push(`| p90 | ${ms(c.p90Ms)} ms |`);
  lines.push(`| p95 | ${ms(c.p95Ms)} ms |`);
  lines.push(`| max | ${ms(c.maxMs)} ms |`);
  lines.push(`| p95 over median | ${c.tailRatio.toFixed(2)} |`);
  lines.push(
    `| share held by the 10 dearest | ${pct(c.top10Share)} (flat would be ${pct(c.top10FlatShare)}) |`,
  );
  lines.push(
    `| share held by the dearest 10 percent | ${pct(c.top10PercentShare)} (flat would be 10.0 %) |`,
  );
  const repCount = Math.max(0, ...rows.map((r) => r.linkMsByRep.length));
  if (repCount > 1) {
    lines.push('', '## Link time per repetition (sum over the corpus)', '');
    lines.push(
      'Unequal repetitions mean the backend returns from the link before its work is done; read the cost column with care.',
      '',
      '| repetition | sum ms | median ms (Standard programs when the corpus names them, else all) |',
      '|---|---|---|',
    );
    for (let rep = 0; rep < repCount; rep++) {
      const all = rows.map((r) => r.linkMsByRep[rep] ?? 0);
      const named = rows.filter((r) => r.kind === 'STANDARD');
      const standard = (named.length ? named : rows).map((r) => r.linkMsByRep[rep] ?? 0);
      lines.push(`| ${rep} | ${ms(all.reduce((a, b) => a + b, 0))} | ${ms(median(standard))} |`);
    }
  }
  const drawn = rows.filter((r) => r.drawMedianMs !== null);
  if (drawn.length) {
    lines.push('', '## First draw after the link', '');
    lines.push(
      '| kind | programs | link median ms | draw median ms | link + draw sum ms | draws with a GL error |',
      '|---|---|---|---|---|---|',
    );
    const drawKinds = new Map();
    for (const r of drawn) {
      const list = drawKinds.get(r.kind || '(other)') ?? [];
      list.push(r);
      drawKinds.set(r.kind || '(other)', list);
    }
    for (const [kind, list] of [...drawKinds].sort((a, b) => b[1].length - a[1].length)) {
      const sum = list.reduce((a, r) => a + r.costMs + r.drawMedianMs, 0);
      lines.push(
        `| ${kind} | ${list.length} | ${ms(median(list.map((r) => r.costMs)))} | ${ms(median(list.map((r) => r.drawMedianMs)))} | ${ms(sum)} | ${list.reduce((a, r) => a + r.drawErrors, 0)} |`,
      );
    }
  }
  const paired = pairedAblation(rows);
  if (paired.length) {
    lines.push('', '## Paired ablation (each variant against its own baseline)', '');
    lines.push(
      '| group | variant | pairs | baseline median ms | variant median ms | saved median ms | saved min..max ms |',
      '|---|---|---|---|---|---|---|',
    );
    for (const a of paired) {
      lines.push(
        `| ${a.group} | ${a.variant} | ${a.pairs} | ${ms(a.baseMedianMs)} | ${ms(a.variantMedianMs)} | ${ms(a.savedMedianMs)} | ${ms(a.savedMinMs)}..${ms(a.savedMaxMs)} |`,
      );
    }
  }
  lines.push('', '## The 40 dearest programs', '');
  lines.push('| rank | cost ms | first ms | kind | name | first met | profiles | program |');
  lines.push('|---|---|---|---|---|---|---|---|');
  rows.slice(0, 40).forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${ms(r.costMs)} | ${ms(r.firstMs)} | ${r.kind || '-'} | ${r.name || '-'} | ${r.firstStep || '-'} | ${r.profiles.join(' ')} | ${r.hash} |`,
    );
  });
  lines.push(
    '',
    '## Cost by material kind',
    '',
    '| kind | programs | median ms | sum ms |',
    '|---|---|---|---|',
  );
  const kinds = new Map();
  for (const r of rows) {
    const list = kinds.get(r.kind || '(other)') ?? [];
    list.push(r.costMs);
    kinds.set(r.kind || '(other)', list);
  }
  for (const [kind, list] of [...kinds].sort((a, b) => median(b[1]) - median(a[1]))) {
    lines.push(
      `| ${kind} | ${list.length} | ${ms(median(list))} | ${ms(list.reduce((a, b) => a + b, 0))} |`,
    );
  }
  if (failures.length) {
    lines.push('', '## Programs that failed to link', '');
    for (const f of failures.slice(0, 30))
      lines.push(`- ${f.hash} ${f.name}: ${f.log.replace(/\s+/g, ' ')}`);
  }
  return `${lines.join('\n')}\n`;
}
