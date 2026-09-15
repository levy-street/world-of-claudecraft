// Pure aggregation for scripts/live_program_hunt.mjs: turns the raw NDJSON
// samples a manual online session produced into the short report the hunt
// skill reads. No I/O here so tests/live_program_hunt_report.test.ts can drive
// it with hand-written samples.
//
// A sample is one poll of the live page (see the script's pollOnce): the new
// programs three minted since the previous poll (id, name, cacheKey), the
// gpu-prep events that appeared (live-program, attach-watchdog, gate-timeout,
// reveal-watchdog), the render diagnostics of the last frame (the materials
// and objects seen for the first time), and where the player stood.

/** Two live-program events closer than this are one burst (one frame or the
 *  few frames a link stall spans). */
export const BURST_WINDOW_MS = 50;

/** Shorten three's program cache key to what identifies it: the head (shader
 *  id or custom shader ids) and the tail (encoded flags plus the
 *  customProgramCacheKey text). */
export function shortKey(key) {
  if (typeof key !== 'string') return '';
  const parts = key.split(',');
  if (parts.length < 8) return key;
  const head = parts.slice(0, 2).join(',');
  const tail = parts.slice(-4).join(',');
  return `${head},...,${tail}`;
}

function samplePosition(sample) {
  const p = sample.pos;
  if (!p || typeof p.x !== 'number' || typeof p.z !== 'number') return '';
  return `(${Math.round(p.x)}, ${Math.round(p.z)})`;
}

/** Group the live-program events of every sample by their label, keeping the
 *  first sighting's context (zone, position, the diagnostics of the same poll,
 *  the minted program entry whose name or key matches). */
export function aggregateLivePrograms(samples) {
  const byLabel = new Map();
  for (const sample of samples) {
    const events = (sample.events ?? []).filter((e) => e.kind === 'live-program');
    if (events.length === 0) continue;
    const minted = sample.programs ?? [];
    for (const event of events) {
      const label = event.key ?? 'program';
      const program =
        minted.find((p) => p.cacheKey === label) ?? minted.find((p) => p.name === label) ?? null;
      let row = byLabel.get(label);
      if (!row) {
        row = {
          label,
          count: 0,
          firstAtMs: event.atMs ?? null,
          zone: sample.zone ?? '',
          pos: samplePosition(sample),
          materialName: program?.name ?? (label.includes(',') ? '' : label),
          owner: program?.owner ?? '',
          keyShort: shortKey(program?.cacheKey ?? (label.includes(',') ? label : '')),
          newMaterials: [...(sample.diag?.newMaterials ?? [])],
          firstVisibleObjects: [...(sample.diag?.firstVisibleObjects ?? [])],
          readyRoots: `${event.readyRoots ?? 0}/${event.totalRoots ?? 0}`,
        };
        byLabel.set(label, row);
      }
      row.count += 1;
    }
  }
  return [...byLabel.values()].sort((a, b) => (a.firstAtMs ?? 0) - (b.firstAtMs ?? 0));
}

/** Runs of live-program events closer than BURST_WINDOW_MS: the multi-program
 *  frame that turns a 40 ms link into a multi-second freeze. */
export function findBursts(samples) {
  const events = samples
    .flatMap((s) =>
      (s.events ?? [])
        .filter((e) => e.kind === 'live-program')
        .map((e) => ({ atMs: e.atMs ?? 0, label: e.key ?? 'program', zone: s.zone ?? '' })),
    )
    .sort((a, b) => a.atMs - b.atMs);
  const bursts = [];
  let run = [];
  for (const event of events) {
    if (run.length > 0 && event.atMs - run[run.length - 1].atMs > BURST_WINDOW_MS) {
      if (run.length >= 2) bursts.push(run);
      run = [];
    }
    run.push(event);
  }
  if (run.length >= 2) bursts.push(run);
  return bursts.map((r) => ({
    atMs: r[0].atMs,
    zone: r[0].zone,
    count: r.length,
    labels: r.map((e) => e.label),
  }));
}

/** Every gate that gave up (watchdog reveal or timed out gate): an ungated
 *  reveal in disguise, and the context a live program may be charged to. */
export function collectGateFailures(samples) {
  const rows = [];
  for (const sample of samples) {
    for (const e of sample.events ?? []) {
      if (
        e.kind === 'attach-watchdog' ||
        e.kind === 'gate-timeout' ||
        e.kind === 'reveal-watchdog'
      ) {
        rows.push({ kind: e.kind, atMs: e.atMs ?? 0, key: e.key ?? '', zone: sample.zone ?? '' });
      }
    }
  }
  return rows.sort((a, b) => a.atMs - b.atMs);
}

function ms(v) {
  return typeof v === 'number' ? `${(v / 1000).toFixed(1)} s` : '?';
}

function cell(v) {
  return String(v ?? '').replace(/\|/g, '\\|');
}

/** The Markdown report the skill reads. `meta` carries the session facts
 *  (target, git sha, browser, duration, polls). */
export function renderReport(samples, meta = {}) {
  const programs = aggregateLivePrograms(samples);
  const bursts = findBursts(samples);
  const failures = collectGateFailures(samples);
  const audit = meta.audit ?? null;
  const lines = [];
  lines.push('# Live program hunt');
  lines.push('');
  lines.push(`- Target: ${meta.target ?? '?'}`);
  lines.push(`- Source: ${meta.gitSha ?? '?'}${meta.dirty ? ' (dirty)' : ''}`);
  lines.push(`- Browser: ${meta.browser ?? '?'}`);
  lines.push(`- Session: ${ms(meta.durationMs)}, ${meta.polls ?? samples.length} polls`);
  lines.push(
    `- Zones visited: ${[...new Set(samples.map((s) => s.zone).filter(Boolean))].join(', ') || 'none'}`,
  );
  lines.push(
    `- Live programs: ${programs.reduce((n, p) => n + p.count, 0)} events, ${programs.length} distinct`,
  );
  lines.push(`- Bursts (2+ within ${BURST_WINDOW_MS} ms): ${bursts.length}`);
  lines.push(`- Gate failures (watchdog or timeout): ${failures.length}`);
  lines.push('');
  lines.push('## Live programs, first sighting');
  lines.push('');
  if ((meta.polls ?? samples.length) === 0) {
    lines.push(
      'No poll reached the renderer: the world was never entered, so nothing was measured.',
    );
  } else if (programs.length === 0) {
    lines.push('None. Every program the session drew had a prewarm twin or a gate.');
  } else {
    lines.push(
      '| at | zone | pos | owner (category:object:material) | material name | key | roots | n | new materials in that poll | first visible objects in that poll |',
    );
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const p of programs) {
      lines.push(
        `| ${ms(p.firstAtMs)} | ${cell(p.zone)} | ${cell(p.pos)} | ${cell(p.owner || '(not in scene at the poll)')} | ${cell(p.materialName || '(unnamed)')} | \`${cell(p.keyShort)}\` | ${p.readyRoots} | ${p.count} | ${cell(p.newMaterials.join('; '))} | ${cell(p.firstVisibleObjects.join('; '))} |`,
      );
    }
  }
  lines.push('');
  lines.push('## Bursts');
  lines.push('');
  if (bursts.length === 0) lines.push('None.');
  for (const b of bursts) {
    lines.push(`- ${ms(b.atMs)} in ${b.zone || '?'}: ${b.count} programs`);
    for (const l of b.labels) lines.push(`  - \`${cell(shortKey(l) || l)}\``);
  }
  lines.push('');
  lines.push('## Gate failures');
  lines.push('');
  if (failures.length === 0) lines.push('None.');
  for (const f of failures)
    lines.push(`- ${ms(f.atMs)} ${f.kind} \`${cell(f.key)}\` (${f.zone || '?'})`);
  lines.push('');
  lines.push('## Shader warm audit (end of session)');
  lines.push('');
  if (audit?.error) {
    lines.push(`Audit unreadable: ${audit.error}`);
  } else if (!audit || audit.enabled === false) {
    lines.push('Audit off: the page was not served with ?perfTrace=1&perf on localhost.');
  } else {
    lines.push(
      `- expected ${audit.expected}, matched ${audit.matched}, drifted ${audit.drifted}, unexpected ${audit.unexpected}, out of band ${audit.outOfBand}`,
    );
    for (const row of audit.unexpectedByName ?? []) {
      lines.push(`- unexpected ${row.count}x: ${cell(row.name || '(unnamed)')}`);
    }
    for (const s of audit.unexpectedSamples ?? []) {
      const attr = s.attribution ? ` ${JSON.stringify(s.attribution)}` : '';
      lines.push(
        `  - sample: name=${cell(s.name || '(unnamed)')} key=\`${cell(shortKey(s.cacheKey))}\`${attr}`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}
