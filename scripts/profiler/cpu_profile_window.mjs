// Offline analyzer for a .cpuprofile captured by scripts/gpu_hitch_capture.mjs
// --cpu-profile. Names the main-thread JS work of one page-clock window; the
// window bounds are performance.now() milliseconds, the same clock the probe
// stamps its atMs / startMs fields with.

import fs from 'node:fs';
import path from 'node:path';

const usage = `CPU profile window

  node scripts/profiler/cpu_profile_window.mjs <file.cpuprofile> --from MS --to MS [--top 25]

  --from MS   window start on the page performance.now() clock
  --to MS     window end on the page performance.now() clock
  --top N     rows per table (default 25)`;

const SPECIAL_FRAMES = Object.freeze(['(idle)', '(program)', '(garbage collector)']);

export function frameKey(callFrame) {
  const name = callFrame?.functionName || '(anonymous)';
  const url = callFrame?.url ? path.basename(callFrame.url) : '';
  if (!url) return name;
  return `${name} ${url}:${(callFrame.lineNumber ?? -1) + 1}`;
}

/** Absolute sample times in profiler microseconds; timeDeltas are cumulative
 *  from startTime, each delta preceding its own sample. */
export function sampleTimesUs(profile) {
  const times = new Array(profile.samples.length);
  let at = profile.startTime;
  for (let index = 0; index < profile.samples.length; index++) {
    at += profile.timeDeltas?.[index] ?? 0;
    times[index] = at;
  }
  return times;
}

export function toPageMs(profile, timeUs) {
  const base = profile.wocProfileEndTimeUs ?? profile.endTime;
  const pageAtEnd = profile.wocPageNowAtStopMs ?? 0;
  return (timeUs - base) / 1000 + pageAtEnd;
}

/** The samples whose page-clock time falls inside [fromMs, toMs], each carrying
 *  its own sampling weight in milliseconds. */
export function selectWindow(profile, fromMs, toMs) {
  const times = sampleTimesUs(profile);
  const rows = [];
  for (let index = 0; index < times.length; index++) {
    const pageMs = toPageMs(profile, times[index]);
    if (pageMs < fromMs || pageMs > toMs) continue;
    rows.push({
      nodeId: profile.samples[index],
      pageMs,
      weightMs: (profile.timeDeltas?.[index] ?? 0) / 1000,
    });
  }
  return rows;
}

/** Self time per frame, inclusive time per frame (a sample credits every
 *  ancestor once), and the weight of each distinct stack. */
export function aggregate(profile, rows) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const self = new Map();
  const inclusive = new Map();
  const stacks = new Map();
  const special = Object.fromEntries(SPECIAL_FRAMES.map((name) => [name, 0]));
  let totalMs = 0;
  const add = (map, key, ms) => map.set(key, (map.get(key) ?? 0) + ms);
  for (const row of rows) {
    totalMs += row.weightMs;
    const node = nodes.get(row.nodeId);
    if (!node) continue;
    add(self, frameKey(node.callFrame), row.weightMs);
    const name = node.callFrame?.functionName ?? '';
    if (Object.hasOwn(special, name)) special[name] += row.weightMs;
    const chain = [];
    for (let id = row.nodeId; id !== undefined; id = parents.get(id)) {
      const current = nodes.get(id);
      if (!current) break;
      chain.push(frameKey(current.callFrame));
    }
    const credited = new Set();
    for (const key of chain) {
      if (credited.has(key)) continue;
      credited.add(key);
      add(inclusive, key, row.weightMs);
    }
    add(stacks, chain.join(' < '), row.weightMs);
  }
  return { totalMs, special, self, inclusive, stacks };
}

function table(title, entries, top, totalMs) {
  const rows = [...entries].sort((a, b) => b[1] - a[1]).slice(0, top);
  const lines = [`${title}:`];
  for (const [key, ms] of rows) {
    const percent = totalMs > 0 ? ((ms / totalMs) * 100).toFixed(1) : '0.0';
    lines.push(`  ${ms.toFixed(1).padStart(8)} ms  ${percent.padStart(5)}%  ${key}`);
  }
  if (rows.length === 0) lines.push('  (none)');
  return lines.join('\n');
}

export function report(result, { fromMs, toMs, top }) {
  const { totalMs, special, self, inclusive, stacks } = result;
  const head = [
    `window ${fromMs} to ${toMs} ms on the page clock`,
    `sampled ${totalMs.toFixed(1)} ms`,
    ...SPECIAL_FRAMES.map((name) => `  ${name}: ${special[name].toFixed(1)} ms`),
  ].join('\n');
  const stackRows = [...stacks].map(([key, ms]) => [key.split(' < ').slice(0, 6).join(' < '), ms]);
  return [
    head,
    table(`top ${top} self time`, self, top, totalMs),
    table(`top ${top} inclusive time`, inclusive, top, totalMs),
    table('top 10 stacks (innermost first)', stackRows, 10, totalMs),
  ].join('\n\n');
}

function parseArgs(argv) {
  const args = { file: null, fromMs: null, toMs: null, top: 25 };
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (option === '--from') args.fromMs = Number(argv[++index]);
    else if (option === '--to') args.toMs = Number(argv[++index]);
    else if (option === '--top') args.top = Number(argv[++index]);
    else if (!args.file) args.file = option;
    else throw new Error(`unknown option ${option}`);
  }
  if (!args.file || !Number.isFinite(args.fromMs) || !Number.isFinite(args.toMs))
    throw new Error('a .cpuprofile path plus --from and --to are required');
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const profile = JSON.parse(fs.readFileSync(args.file, 'utf8'));
    const rows = selectWindow(profile, args.fromMs, args.toMs);
    console.log(report(aggregate(profile, rows), args));
  } catch (error) {
    console.error(error?.message ?? error);
    console.error(usage);
    process.exitCode = 1;
  }
}
