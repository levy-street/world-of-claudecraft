// Pure halves of the WOC crowd A/B rig (scripts/woc_crowd_ab.mjs): the fixed
// crowd (who stands where, wearing what), the per-window statistics, and the
// text and Markdown reports. No browser, no clock, no filesystem: the entry
// script owns puppeteer and the page, and a Vitest imports this directly
// (tests/woc_crowd_ab_core.test.ts).
//
// Percentiles use the shared FLOOR nearest-rank convention of
// scripts/lib/bench_gate.mjs, so a p95 here reads like every other bench's.

import { sampleStats } from './bench_gate.mjs';

export const AB_SCHEMA = 'woc-crowd-ab/1';

/** The nine player classes, in the order the crowd cycles through them. */
export const AB_CLASSES = Object.freeze([
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

export const AB_BOT_COUNT = 40;

/**
 * The six-slot worn set every bot wears in every arm. Any armor id in a slot
 * dresses a WOC body in its wearer's own class piece for that slot (an item
 * with no display row: src/render/characters/woc_parts_core.ts
 * wocArmorAssetFor), and the release's composed body ignores worn armor and
 * wears its class kit, so the ids only have to exist in the item table of
 * every arm. These six are class-neutral base items of src/sim/content/items.ts.
 */
export const AB_WORN_SET = Object.freeze({
  helmet: 'cryptbone_helm',
  shoulder: 'cryptbone_pauldrons',
  gloves: 'mistveil_grips',
  chest: 'recruit_tunic',
  waist: 'mistveil_cord',
  feet: 'oiled_boots',
});

/** Forward distance of the first and last grid row from the local player, in yards. */
export const AB_SCENE_BANDS = Object.freeze({
  // Inside the articulated band whatever the crowd factor.
  close: Object.freeze({ near: 6, far: 20 }),
  // Past the 62 yd proxy-shadow band and inside the 80 yd view range, so every
  // body stands on its far mesh.
  far: Object.freeze({ near: 62, far: 75 }),
});

export const AB_GRID_COLUMNS = 8;
export const AB_GRID_COLUMN_SPACING = 2.2;

/** A rendered frame slower than 30 fps. */
export const AB_SLOW_FRAME_MS = 33.4;
/** A rendered frame a player feels as a hitch. */
export const AB_HITCH_FRAME_MS = 50;
/** The game loop clamps its own frame dt here (src/main.ts frame()). */
export const AB_FRAME_DT_CLAMP_MS = 250;
/** Frames one GPU timer rolling stat covers (gpu_timer_probe_core GPU_TIMER_STAT_WINDOW). */
export const AB_GPU_TIMER_RING = 120;
/** One-minute load per logical core above which a run is not evidence. */
export const AB_BUSY_LOAD_PER_CORE = 0.5;
/** Megabytes swapped in and out during a run above which the host was short of memory. */
export const AB_BUSY_SWAP_MB = 64;

const round1 = (value) => Math.round(value * 10) / 10;
const round2 = (value) => Math.round(value * 100) / 100;
const round3 = (value) => Math.round(value * 1000) / 1000;

/** Two lowercase letters for a bot index: character names are letters only. */
function indexLetters(index) {
  return String.fromCharCode(97 + Math.floor(index / 26)) + String.fromCharCode(97 + (index % 26));
}

/**
 * The crowd: the nine classes in turn, body type alternating. Nine is odd, so
 * every class meets both body types inside any 18 consecutive bots.
 */
export function crowdRoster(count = AB_BOT_COUNT) {
  if (!Number.isInteger(count) || count <= 0 || count > 26 * 26) {
    throw new Error(`crowd size is invalid: ${String(count)}`);
  }
  return Array.from({ length: count }, (_, index) => ({
    index,
    cls: AB_CLASSES[index % AB_CLASSES.length],
    gender: index % 2 === 0 ? 'male' : 'female',
    name: `Crowd${indexLetters(index)}`,
  }));
}

/**
 * Grid positions ahead of an anchor. The sim's compass: facing 0 looks down
 * +z and +x is to the right of it, so forward is (sin f, cos f) and right is
 * (cos f, -sin f). Rows run from `band.near` to `band.far` yards ahead,
 * columns are centred on the facing line.
 */
export function crowdGrid(
  anchor,
  band,
  count = AB_BOT_COUNT,
  columns = AB_GRID_COLUMNS,
  columnSpacing = AB_GRID_COLUMN_SPACING,
) {
  if (
    !Number.isFinite(anchor?.x) ||
    !Number.isFinite(anchor?.z) ||
    !Number.isFinite(anchor?.facing)
  ) {
    throw new Error('crowd grid anchor needs finite x, z and facing');
  }
  if (!(band?.near > 0) || !(band?.far >= band.near)) {
    throw new Error('crowd grid band needs 0 < near <= far');
  }
  if (!Number.isInteger(columns) || columns <= 0) throw new Error('crowd grid needs columns');
  const rows = Math.ceil(count / columns);
  const forwardX = Math.sin(anchor.facing);
  const forwardZ = Math.cos(anchor.facing);
  const rightX = Math.cos(anchor.facing);
  const rightZ = -Math.sin(anchor.facing);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const forward =
      rows === 1 ? band.near : band.near + ((band.far - band.near) * row) / (rows - 1);
    const lateral = (column - (columns - 1) / 2) * columnSpacing;
    return {
      index,
      x: round3(anchor.x + forwardX * forward + rightX * lateral),
      z: round3(anchor.z + forwardZ * forward + rightZ * lateral),
      forward: round3(forward),
      lateral: round3(lateral),
      distance: round3(Math.hypot(forward, lateral)),
    };
  });
}

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Rendered-frame statistics from the game's own frame dt (ms per rendered
 * frame, as handed to PerfMonitor.frame). The game clamps that dt at 250 ms,
 * so `atClamp` says how many frames the totals understate.
 */
export function frameWindowStats(frameMs) {
  const values = (frameMs ?? []).filter((ms) => Number.isFinite(ms) && ms >= 0);
  const stats = sampleStats(values);
  let overSlow = 0;
  let overHitch = 0;
  let timeOverSlowMs = 0;
  let atClamp = 0;
  let totalMs = 0;
  for (const ms of values) {
    totalMs += ms;
    if (ms > AB_SLOW_FRAME_MS) {
      overSlow += 1;
      timeOverSlowMs += ms;
    }
    if (ms > AB_HITCH_FRAME_MS) overHitch += 1;
    if (ms >= AB_FRAME_DT_CLAMP_MS - 0.5) atClamp += 1;
  }
  return {
    rendered: stats.count,
    meanMs: round2(stats.count ? totalMs / stats.count : 0),
    p50Ms: stats.p50,
    p95Ms: stats.p95,
    p99Ms: stats.p99,
    maxMs: stats.max,
    over33_4: overSlow,
    over50: overHitch,
    timeOver33_4Ms: round1(timeOverSlowMs),
    atClamp,
    totalMs: round1(totalMs),
  };
}

/** Raw requestAnimationFrame timestamps to gap statistics (unclamped). */
export function rafGapStats(timestamps) {
  const gaps = [];
  const ts = timestamps ?? [];
  for (let i = 1; i < ts.length; i += 1) gaps.push(ts[i] - ts[i - 1]);
  const stats = sampleStats(gaps);
  return {
    callbacks: Math.max(0, ts.length - 1),
    medianMs: stats.p50,
    p95Ms: stats.p95,
    maxMs: stats.max,
    over50: gaps.filter((gap) => gap > AB_HITCH_FRAME_MS).length,
  };
}

/** Long tasks ([startTime, duration] pairs) that started inside [t0, t1). */
export function longTaskStats(entries, t0, t1) {
  let count = 0;
  let maxMs = 0;
  let totalMs = 0;
  for (const entry of entries ?? []) {
    const start = entry?.[0];
    const duration = entry?.[1];
    if (!Number.isFinite(start) || !Number.isFinite(duration)) continue;
    if (start < t0 || start >= t1) continue;
    count += 1;
    totalMs += duration;
    if (duration > maxMs) maxMs = duration;
  }
  return { count, maxMs: round1(maxMs), totalMs: round1(totalMs) };
}

/**
 * The window's mean GPU time per frame from 1 s samples of the timer probe's
 * ROLLING stats. A rolling stat covers the last `ring` resolved frames, so
 * consecutive samples overlap; only samples at least `ring` resolved frames
 * apart are used, which makes the chunks disjoint and keeps every frame
 * inside the window. A window too short for one chunk falls back to its last
 * rolling sample and says so (`basis: 'rolling'`, may reach before the window).
 */
export function gpuWindowMean(samples, framesAtStart, ring = AB_GPU_TIMER_RING) {
  const usable = (samples ?? []).filter((sample) => sample?.gpuAvail === true);
  if (usable.length === 0) return { available: false, meanMs: null, chunks: 0, basis: 'none' };
  const picked = [];
  let last = framesAtStart;
  for (const sample of usable) {
    if (sample.gpuFrames - last >= ring) {
      picked.push(sample);
      last = sample.gpuFrames;
    }
  }
  const rows = picked.length > 0 ? picked : [usable[usable.length - 1]];
  const meanOf = (read) => rows.reduce((sum, row) => sum + read(row), 0) / rows.length;
  const brackets = {};
  for (const name of Object.keys(rows[rows.length - 1].brackets ?? {})) {
    brackets[name] = round3(meanOf((row) => row.brackets?.[name] ?? 0));
  }
  return {
    available: true,
    meanMs: round3(meanOf((row) => row.gpuAvg)),
    p95Ms: round3(meanOf((row) => row.gpuP95 ?? 0)),
    chunks: picked.length,
    basis: picked.length > 0 ? 'chunks' : 'rolling',
    framesResolved: usable[usable.length - 1].gpuFrames - framesAtStart,
    brackets,
  };
}

/** Draw calls and triangles per frame: the median of the 1 s samples. */
export function drawWindowStats(samples) {
  const calls = (samples ?? []).map((sample) => sample.calls).filter(Number.isFinite);
  const triangles = (samples ?? []).map((sample) => sample.triangles).filter(Number.isFinite);
  return {
    samples: calls.length,
    callsMedian: median(calls),
    callsMin: calls.length ? Math.min(...calls) : null,
    callsMax: calls.length ? Math.max(...calls) : null,
    trianglesMedian: median(triangles),
  };
}

/** Per-kind change of a lifetime counter table between two snapshots. */
export function countsDelta(before, after) {
  const out = {};
  for (const [kind, value] of Object.entries(after ?? {})) {
    out[kind] = value - (before?.[kind] ?? 0);
  }
  return out;
}

/**
 * Background GPU queue units that ran between two reads of the per-kind
 * table (kind to { units, emaMs }), most units first. `emaMs` is the kind's
 * learned cost at the second read, not a sum over the interval.
 */
export function queueKindDelta(before, after) {
  const rows = [];
  for (const [kind, stat] of Object.entries(after ?? {})) {
    const units = stat.units - (before?.[kind]?.units ?? 0);
    if (units > 0) rows.push({ kind, units, emaMs: round2(stat.emaMs) });
  }
  return rows.sort((a, b) => b.units - a.units || a.kind.localeCompare(b.kind));
}

/**
 * Build-ledger rows that moved inside a window: per kind, how many builds and
 * how many main-thread ms. `maxMs` is the kind's LIFETIME worst (the ledger
 * keeps no per-window max), named so in the reports.
 */
export function ledgerDelta(before, after) {
  const rows = [];
  for (const [kind, stats] of Object.entries(after ?? {})) {
    const prior = before?.[kind];
    const count = stats.count - (prior?.count ?? 0);
    if (count <= 0) continue;
    const totalMs = stats.totalMs - (prior?.totalMs ?? 0);
    rows.push({
      kind,
      count,
      totalMs: round2(totalMs),
      meanMs: round2(totalMs / count),
      lifetimeMaxMs: round2(stats.maxMs),
    });
  }
  return rows.sort((a, b) => b.totalMs - a.totalMs);
}

/**
 * What the crowd adds over the empty scene of the SAME run: draw calls,
 * triangles and GPU ms, in total and per body. The subtraction removes the
 * world both windows share, so it is the arm's own crowd cost; it is only as
 * steady as the world between the two windows (a wandering mob moves it).
 */
export function crowdOverSolo(windows, bodies) {
  const solo = (windows ?? []).find((w) => w.scene === 'SOLO');
  if (!solo || !(bodies > 0)) return [];
  const rows = [];
  for (const scene of ['CLOSE', 'FAR']) {
    const w = windows.find((candidate) => candidate.scene === scene);
    if (!w) continue;
    const calls = w.draws.callsMedian - solo.draws.callsMedian;
    const triangles = w.draws.trianglesMedian - solo.draws.trianglesMedian;
    const gpuMs =
      w.gpu.available && solo.gpu.available ? round3(w.gpu.meanMs - solo.gpu.meanMs) : null;
    rows.push({
      scene,
      calls,
      callsPerBody: round2(calls / bodies),
      triangles,
      trianglesPerBody: Math.round(triangles / bodies),
      gpuMs,
      gpuMsPerBody: gpuMs === null ? null : round3(gpuMs / bodies),
    });
  }
  return rows;
}

/** Whether the host was too loaded for the numbers to count as evidence. */
export function hostLoad(loadAvg1, logicalCpus) {
  if (!Number.isFinite(loadAvg1) || !(logicalCpus > 0) || loadAvg1 === 0) {
    return { load1: loadAvg1 ?? null, perCore: null, busy: null };
  }
  const perCore = loadAvg1 / logicalCpus;
  return {
    load1: round2(loadAvg1),
    perCore: round2(perCore),
    busy: perCore > AB_BUSY_LOAD_PER_CORE,
  };
}

/** The cumulative swap counters and page size out of macOS `vm_stat` text. */
export function parseVmStat(text) {
  const read = (pattern) => {
    const match = pattern.exec(text ?? '');
    return match ? Number(match[1]) : null;
  };
  return {
    pageSize: read(/page size of (\d+) bytes/),
    swapins: read(/Swapins:\s+(\d+)/),
    swapouts: read(/Swapouts:\s+(\d+)/),
  };
}

/**
 * Memory swapped in and out between two `vm_stat` reads. A healthy host swaps
 * next to nothing during a run; one that moved more than AB_BUSY_SWAP_MB was
 * short of memory, and a page stalled there says nothing about the arm.
 */
export function swapActivity(before, after) {
  const known = (counters) =>
    counters &&
    Number.isFinite(counters.pageSize) &&
    Number.isFinite(counters.swapins) &&
    Number.isFinite(counters.swapouts);
  if (!known(before) || !known(after)) return { swappedMb: null, busy: null };
  const pages = after.swapins - before.swapins + (after.swapouts - before.swapouts);
  const swappedMb = Math.max(0, Math.round((pages * after.pageSize) / 2 ** 20));
  return { swappedMb, busy: swappedMb > AB_BUSY_SWAP_MB };
}

/**
 * Why a run is NOT performance evidence, as plain sentences; empty when
 * nothing disqualifies it. A headless run has no display and no vsync, a busy
 * host adds stalls of its own, a throttled window is a proxy by construction,
 * and a software rasterizer measures no GPU.
 */
export function evidenceReasons({
  headless,
  busyStart,
  busyEnd,
  swapping,
  softwareGl,
  smoke,
  hiddenWindows,
}) {
  const reasons = [];
  if (smoke) reasons.push('run was declared a smoke run (AB_SMOKE=1)');
  if (headless) {
    reasons.push('headless browser: frames are paced by a timer, not by a display vsync');
  }
  if (busyStart === true || busyEnd === true) {
    reasons.push(
      "host was busy with other work (see host.loadAvg): stalls are not the game's alone",
    );
  }
  if (swapping === true) {
    reasons.push('host was short of memory and swapping during the run (see host.swap)');
  }
  if (softwareGl) reasons.push('software WebGL renderer: no GPU was measured');
  if (hiddenWindows > 0) {
    reasons.push(`${hiddenWindows} window(s) ran while the page was not visible`);
  }
  return reasons;
}

const num = (value, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : 'n/a';
const millions = (value) => (Number.isFinite(value) ? `${(value / 1e6).toFixed(2)}M` : 'n/a');
const seconds = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)} s` : 'not reached');

function throttleTag(rate) {
  return rate > 1 ? `CPU x${rate} (proxy)` : 'no throttle';
}

function bodiesCell(window) {
  const b = window.bodies;
  if (!b) return '';
  return `drawn ${b.drawn}/${b.expected}, articulated ${b.articulated}, far mesh ${b.onFarMesh}`;
}

/** The one-arm text summary written beside the JSON and printed at the end. */
export function formatSummary(result) {
  const p = result.provenance;
  const lines = [];
  lines.push(`WOC crowd A/B rig, one arm: ${p.label}`);
  if (p.evidence.performanceEvidence) {
    lines.push('STATUS: performance evidence (headed, real GPU, quiet host).');
  } else {
    lines.push('STATUS: NOT performance evidence. Reasons:');
    for (const reason of p.evidence.reasons) lines.push(`  - ${reason}`);
  }
  if (p.cpuThrottle.rate > 1) {
    lines.push(
      `PROXY RUN: the page's main thread is slowed ${p.cpuThrottle.rate}x through CDP. It stands in for a weak CPU; it is never a measurement of one.`,
    );
  }
  lines.push('');
  lines.push(
    `arm      ${p.arm.url}  sha ${p.arm.gitShaShort ?? 'unknown'}${p.arm.servedDirty ? ' (served files DIRTY)' : ''}` +
      `${p.arm.dirty && !p.arm.servedDirty ? ' (worktree dirty outside the served files)' : ''}` +
      `  branch ${p.arm.branch ?? 'unknown'}  ${p.arm.build} build` +
      `  page build id ${p.arm.pageBuildId ?? 'unknown'}`,
  );
  lines.push(`served   ${p.arm.servedDir ?? 'unknown'} (${p.arm.servedDirSource})`);
  lines.push(
    `browser  ${p.browser.version}  ${p.browser.headless ? 'headless=new' : 'headed'}  fresh profile  vsync flags untouched`,
  );
  lines.push(
    `webgl    ${p.webgl.renderer}  (timer query extension: ${p.webgl.gpuTimer ? 'yes' : 'NO'})`,
  );
  lines.push(
    `flags    ${p.flags.query}  viewport ${p.viewport.width}x${p.viewport.height} @${p.viewport.dpr}` +
      `  drawing buffer ${p.viewport.drawingBuffer?.width ?? '?'}x${p.viewport.drawingBuffer?.height ?? '?'}`,
  );
  lines.push(
    `pacing   ${p.pacing.mode}; cadence ${p.pacing.cadence?.verdict ?? 'unknown'}` +
      ` at ${num(p.pacing.cadence?.refreshHz, 1)} Hz, ceiling ${p.pacing.cadence?.intent ?? '?'}` +
      `, raw rAF median ${num(p.pacing.rafMedianMs, 1)} ms`,
  );
  lines.push(
    `host     ${p.host.cpu}, ${p.host.logicalCpus} cores, load ${num(p.host.loadStart?.load1, 1)} at start` +
      ` and ${num(p.host.loadEnd?.load1, 1)} at end`,
  );
  if (p.host.swap?.swappedMb !== null && p.host.swap?.swappedMb !== undefined) {
    lines.push(
      `         ${num(p.host.swap.swappedMb)} MB swapped in and out during the run${p.host.swap.busy ? ' (SHORT OF MEMORY)' : ''}`,
    );
  }
  lines.push(
    `throttle ${throttleTag(p.cpuThrottle.rate)}${p.cpuThrottle.rate > 1 ? `: ${p.cpuThrottle.note}` : ''}`,
  );
  lines.push(
    `daylight ${p.dayNight?.pinnedPhase === null || p.dayNight?.pinnedPhase === undefined ? 'NOT pinned: the live 45 minute cycle' : `frozen at phase ${p.dayNight.pinnedPhase} (0.5 is noon)`}`,
  );
  lines.push(`date     ${p.startedAtUtc}`);
  if (p.note) lines.push(`note     ${p.note}`);
  lines.push('');
  const crowd = result.crowd;
  if (crowd) {
    lines.push(
      `crowd    ${crowd.count} bots through the sim: ${crowd.classes} classes, ${crowd.male} male and ${crowd.female} female,` +
        ` default faces, six worn slots on ${crowd.dressed}/${crowd.count}`,
    );
    lines.push(`         worn set ${Object.values(crowd.wornSet).join(', ')}`);
    lines.push(`         ${crowd.asymmetry}`);
    lines.push('');
  }
  lines.push(
    'scene      gpu ms/frame   draws   triangles   frame mean / p95 ms   over 50 ms   time over 33.4 ms   long tasks (n, max)   programs   bodies',
  );
  for (const w of result.windows) {
    // A trailing ~ marks the rolling fallback of a window too short for one chunk.
    const gpu = w.gpu.available
      ? `${num(w.gpu.meanMs, 2)}${w.gpu.basis === 'chunks' ? '' : '~'}`
      : 'n/a';
    lines.push(
      `${`${w.scene}${w.cpuThrottle > 1 ? ` x${w.cpuThrottle}` : ''}`.padEnd(10)} ${gpu.padStart(12)}   ` +
        `${num(w.draws.callsMedian).padStart(5)}   ${millions(w.draws.trianglesMedian).padStart(9)}   ` +
        `${`${num(w.frames.meanMs, 2)} / ${num(w.frames.p95Ms, 1)}`.padStart(19)}   ` +
        `${num(w.frames.over50).padStart(10)}   ${`${(w.frames.timeOver33_4Ms / 1000).toFixed(2)} s`.padStart(17)}   ` +
        `${`${w.longTasks.count}, ${num(w.longTasks.maxMs)} ms`.padStart(19)}   ` +
        `${`${w.programs.end} (${w.programs.delta >= 0 ? '+' : ''}${w.programs.delta})`.padStart(8)}   ${bodiesCell(w)}`,
    );
  }
  lines.push('');
  for (const w of result.windows) {
    const tag = `${w.scene}${w.cpuThrottle > 1 ? ` x${w.cpuThrottle}` : ''}`;
    if (w.arrival) {
      const a = w.arrival;
      lines.push(
        `${tag}: all ${a.expected} bodies had a view (nameplate, click target) after ${seconds(a.allViewsAfterMs)}` +
          ` and were drawn after ${seconds(a.allDrawnAfterMs)}` +
          ` (first ${seconds(a.firstDrawnAfterMs)}, half ${seconds(a.halfDrawnAfterMs)});` +
          ` ${a.lastChangeMs === null ? 'the drawn set was still changing when the window closed' : `the drawn set last changed at ${seconds(a.lastChangeMs)}`};` +
          ` worst raw frame gap ${num(w.raf.maxMs)} ms; spawn task ${num(a.spawnTaskMs, 1)} ms;` +
          ` ${a.assetRequests} model and texture files (${(a.assetBytes / 1e6).toFixed(2)} MB) first requested in the window,` +
          ` ${a.characterAssetRequests} of them character files (${(a.characterAssetBytes / 1e6).toFixed(2)} MB)`,
      );
    }
    if (w.transit) {
      const t = w.transit;
      lines.push(
        `${tag}: all ${t.expected} bodies stood on their far mesh after ${seconds(t.allOnFarMeshAfterMs)}` +
          ` (first ${seconds(t.firstOnFarMeshAfterMs)}, half ${seconds(t.halfOnFarMeshAfterMs)});` +
          ` worst raw frame gap ${num(w.raf.maxMs)} ms; move task ${num(t.moveTaskMs, 1)} ms`,
      );
    }
  }
  for (const row of result.crowdOverSolo ?? []) {
    lines.push(
      `${row.scene} over SOLO: ${row.calls >= 0 ? '+' : ''}${num(row.calls)} draws (${num(row.callsPerBody, 1)} a body),` +
        ` ${row.triangles >= 0 ? '+' : ''}${millions(row.triangles)} triangles (${num(row.trianglesPerBody)} a body)` +
        `${row.gpuMs === null ? '' : `, ${row.gpuMs >= 0 ? '+' : ''}${num(row.gpuMs, 3)} ms GPU (${num(row.gpuMsPerBody, 4)} ms a body)`}`,
    );
  }
  lines.push('');
  lines.push('gpu-prep events per window (lifetime counter deltas):');
  for (const w of result.windows) {
    const moved = Object.entries(w.events.counts)
      .filter(([, value]) => value !== 0)
      .map(([kind, value]) => `${kind} ${value}`)
      .join(', ');
    lines.push(
      `  ${w.scene.padEnd(8)} live-program ${w.events.counts['live-program'] ?? 0}, gate-timeout ${w.events.counts['gate-timeout'] ?? 0}` +
        `${moved ? `   (all moved: ${moved})` : ''}`,
    );
  }
  lines.push('');
  lines.push(
    'build ledger, view rows per window (count, total ms, mean ms; max is the lifetime worst):',
  );
  for (const w of result.windows) {
    const rows = w.ledger.filter((row) => row.kind.startsWith('view:'));
    if (rows.length === 0) {
      lines.push(`  ${w.scene.padEnd(8)} no view build`);
      continue;
    }
    for (const row of rows) {
      lines.push(
        `  ${w.scene.padEnd(8)} ${row.kind.padEnd(16)} ${String(row.count).padStart(3)} builds  ${num(row.totalMs, 1).padStart(8)} ms` +
          `  mean ${num(row.meanMs, 2)} ms  max ${num(row.lifetimeMaxMs, 1)} ms`,
      );
    }
  }
  for (const w of result.windows) {
    const slowest = (w.ledgerSlowestInWindow ?? []).slice(0, 3);
    if (slowest.length === 0) continue;
    lines.push(
      `  ${w.scene.padEnd(8)} slowest single builds: ${slowest.map((row) => `${row.kind} ${num(row.ms, 1)} ms at ${seconds(row.atMs)}`).join('; ')}`,
    );
  }
  lines.push('');
  lines.push('background queue units per window (kind x units, the six busiest):');
  for (const w of result.windows) {
    const work = (w.queueWork ?? []).slice(0, 6);
    lines.push(
      `  ${w.scene.padEnd(8)} ${work.length ? work.map((row) => `${row.kind} x${row.units}`).join(', ') : 'none'}`,
    );
  }
  lines.push('');
  const settles = Object.entries(result.settles ?? {})
    .map(
      ([name, settle]) =>
        `${name} ${(settle.waitedMs / 1000).toFixed(0)} s${settle.quiet ? '' : ' (NOT quiet when it ran out)'}`,
    )
    .join(', ');
  if (settles) lines.push(`settles  ${settles}`);
  lines.push(
    `rig      its own work inside the windows: ${result.windows.map((w) => `${w.scene} ${num(w.rigOverheadMs, 1)} ms`).join(', ')}`,
  );
  lines.push(
    `health   page errors ${result.health.pageErrors.length}, console errors ${result.health.consoleErrors.length},` +
      ` WebGL messages ${result.health.webglMessages.length}, failed asset requests ${result.health.failedAssets.length}`,
  );
  for (const warning of result.warnings ?? []) lines.push(`WARNING  ${warning}`);
  for (const failure of result.failures ?? []) lines.push(`FAILURE  ${failure}`);
  return `${lines.join('\n')}\n`;
}

function runKey(result) {
  return `${result.provenance.flags.gfx}|${result.provenance.cpuThrottle.rate}`;
}

/**
 * Markdown tables across arms, in the shape of the review's two tables: the
 * steady scenes (GPU ms, draws, triangles) and the arrival window. One result
 * file is one arm at one preset and one throttle; rows group them by preset
 * and throttle, arms follow the order the files were given in, and repeats of
 * one arm are joined by "and" in file order, never averaged.
 */
export function comparisonTables(results) {
  const labels = [];
  for (const result of results) {
    if (!labels.includes(result.provenance.label)) labels.push(result.provenance.label);
  }
  const keys = [];
  for (const result of results) if (!keys.includes(runKey(result))) keys.push(runKey(result));
  // Rows read preset by preset, the unthrottled run before its proxies,
  // whatever order the files came in.
  const presetRank = (key) => {
    const rank = ['low', 'medium', 'high', 'ultra', 'insane'].indexOf(key.split('|')[0]);
    return rank < 0 ? 99 : rank;
  };
  keys.sort(
    (a, b) => presetRank(a) - presetRank(b) || Number(a.split('|')[1]) - Number(b.split('|')[1]),
  );
  const windowsOf = (key, label, scene) =>
    results
      .filter((result) => runKey(result) === key && result.provenance.label === label)
      .map((result) => result.windows.find((w) => w.scene === scene))
      .filter(Boolean);
  const repeats = (windows, read) => (windows.length ? windows.map(read).join(' and ') : 'not run');
  const across = (key, scene, read) =>
    labels.map((label) => repeats(windowsOf(key, label, scene), read)).join(' / ');

  const out = [];
  out.push(`Arms, in column order: ${labels.join(' / ')}. Repeats of one arm are joined by "and".`);
  out.push('');
  for (const result of results) {
    const p = result.provenance;
    out.push(
      `- ${p.label}, ${p.flags.gfx}, ${throttleTag(p.cpuThrottle.rate)}: sha ${p.arm.gitShaShort ?? 'unknown'}` +
        `${p.arm.servedDirty ? ' (served files dirty)' : ''}, ${p.arm.build} build, ${p.browser.version},` +
        ` ${p.browser.headless ? 'headless' : 'headed'}, ${p.webgl.renderer}, ${p.startedAtUtc},` +
        ` host load ${num(p.host.loadStart?.load1, 1)}.` +
        ` ${p.evidence.performanceEvidence ? 'Counts as evidence.' : `NOT evidence: ${p.evidence.reasons.join('; ')}.`}`,
    );
  }
  out.push('');
  out.push(
    '| Preset | Throttle | Scene | GPU ms per frame | Draw calls | Triangles | Frame ms, mean (p95) |',
  );
  out.push('|---|---|---|---|---|---|---|');
  for (const key of keys) {
    const [gfx, rate] = key.split('|');
    for (const scene of ['SOLO', 'CLOSE', 'FAR']) {
      if (!labels.some((label) => windowsOf(key, label, scene).length > 0)) continue;
      out.push(
        `| ${gfx} | ${throttleTag(Number(rate))} | ${scene}` +
          ` | ${across(key, scene, (w) => (w.gpu.available ? num(w.gpu.meanMs, 2) : 'n/a'))}` +
          ` | ${across(key, scene, (w) => num(w.draws.callsMedian))}` +
          ` | ${across(key, scene, (w) => millions(w.draws.trianglesMedian))}` +
          ` | ${across(key, scene, (w) => `${num(w.frames.meanMs, 2)} (${num(w.frames.p95Ms, 1)})`)} |`,
      );
    }
  }
  // The windows that start with a change: the spawn (ARRIVAL) and, when it
  // was run, the move to the far band (TRANSIT). Each names its own goals.
  const changes = [
    [
      'ARRIVAL',
      [
        ['All bodies had a view after', (w) => seconds(w.arrival?.allViewsAfterMs)],
        ['All bodies drawn after', (w) => seconds(w.arrival?.allDrawnAfterMs)],
      ],
    ],
    [
      'TRANSIT',
      [['All bodies on their far mesh after', (w) => seconds(w.transit?.allOnFarMeshAfterMs)]],
    ],
  ];
  for (const [scene, goals] of changes) {
    if (!keys.some((key) => labels.some((label) => windowsOf(key, label, scene).length > 0))) {
      continue;
    }
    out.push('');
    out.push(
      `| Preset | Throttle | ${scene}, arm | Frame ms, mean (p95) | Rendered frames over 50 ms | Time in frames over 33.4 ms | Long tasks (count, max) | Worst raw frame gap | ${goals.map(([title]) => title).join(' | ')} | Programs at the end | live-program, gate-timeout |`,
    );
    out.push(`|---|---|---|---|---|---|---|---|${goals.map(() => '---|').join('')}---|---|`);
    for (const key of keys) {
      const [gfx, rate] = key.split('|');
      for (const label of labels) {
        const windows = windowsOf(key, label, scene);
        if (windows.length === 0) continue;
        out.push(
          `| ${gfx} | ${throttleTag(Number(rate))} | ${label}` +
            ` | ${repeats(windows, (w) => `${num(w.frames.meanMs, 2)} (${num(w.frames.p95Ms, 1)})`)}` +
            ` | ${repeats(windows, (w) => String(w.frames.over50))}` +
            ` | ${repeats(windows, (w) => `${(w.frames.timeOver33_4Ms / 1000).toFixed(2)} s`)}` +
            ` | ${repeats(windows, (w) => `${w.longTasks.count}, max ${num(w.longTasks.maxMs)} ms`)}` +
            ` | ${repeats(windows, (w) => `${num(w.raf.maxMs)} ms`)}` +
            `${goals.map(([, read]) => ` | ${repeats(windows, read)}`).join('')}` +
            ` | ${repeats(windows, (w) => String(w.programs.end))}` +
            ` | ${repeats(windows, (w) => `${w.events.counts['live-program'] ?? 0}, ${w.events.counts['gate-timeout'] ?? 0}`)} |`,
        );
      }
    }
  }
  return `${out.join('\n')}\n`;
}
