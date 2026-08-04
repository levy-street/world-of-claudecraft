// Pure helpers for the local-gate measurement harness (scripts/gate_profile.mjs).
// Kept side-effect-free so Vitest can pin parsing, tier classification, and
// slow-file ranking without spawning the full gate. The entry script owns spawn,
// stdio, and wall-clock collection.

import { buildFullGateSteps } from './gate_steps.mjs';

/** GiB used by gate.mjs's free-mem worker clamp; re-exported for docs only. */
export const GATE_BYTES_PER_WORKER = 768 * 1024 * 1024;

/**
 * Machine-tier labels used in docs/local-gate-perf/baselines.md.
 * Low: 4-8 logical CPUs and 8-16 GB total RAM (either bound can place you here).
 * Medium: above low and not high.
 * High: 12+ logical CPUs AND 32+ GB total RAM.
 */
export function classifyMachineTier({ cpuCount, totalMemBytes }) {
  const ramGb = totalMemBytes / (1024 * 1024 * 1024);
  // Match baselines.md tier guide: both dimensions must clear the high bar;
  // both must sit in the low band for low; everything else is medium.
  if (cpuCount >= 12 && ramGb >= 32) return 'high';
  if (cpuCount <= 8 && ramGb <= 16) return 'low';
  return 'medium';
}

/**
 * Snapshot of host facts for baseline rows. Pure over the injected os/process
 * surfaces so tests do not depend on the live machine.
 *
 * @param {{
 *   platform: string | (() => string),
 *   arch: string | (() => string),
 *   availableParallelism?: () => number,
 *   cpus: () => { length: number },
 *   totalmem: () => number,
 *   freemem: () => number,
 * }} osApi
 * @param {{ version: string, platform: string }} processApi
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function collectMachineFacts(osApi, processApi, env = {}) {
  const cpuCount =
    typeof osApi.availableParallelism === 'function'
      ? osApi.availableParallelism()
      : osApi.cpus().length;
  const totalMemBytes = osApi.totalmem();
  const freeMemBytes = osApi.freemem();
  // node:os exposes platform/arch as functions; tests may inject string fields.
  const platform = typeof osApi.platform === 'function' ? osApi.platform() : osApi.platform;
  const arch = typeof osApi.arch === 'function' ? osApi.arch() : osApi.arch;
  return {
    platform,
    arch,
    cpuCount,
    totalMemBytes,
    freeMemBytes,
    totalMemGb: round1(totalMemBytes / (1024 * 1024 * 1024)),
    freeMemGb: round1(freeMemBytes / (1024 * 1024 * 1024)),
    nodeVersion: processApi.version,
    processPlatform: processApi.platform,
    gateMaxWorkers: env.GATE_MAX_WORKERS ?? null,
    tier: classifyMachineTier({ cpuCount, totalMemBytes }),
  };
}

/**
 * Extract per-file wall durations from a Vitest/Jest-compatible JSON reporter
 * payload. Prefers explicit `duration` when present; otherwise uses
 * `endTime - startTime`. Returns rows with relative-ish name and durationMs.
 *
 * Accepts either the full report object or an array of testResults entries.
 */
export function extractFileDurations(vitestJson) {
  const results = normalizeTestResults(vitestJson);
  const rows = [];
  for (const file of results) {
    if (!file || typeof file !== 'object') continue;
    const name = pickFileName(file);
    if (!name) continue;
    const durationMs = pickDurationMs(file);
    if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) continue;
    rows.push({ file: name, durationMs });
  }
  return rows;
}

/**
 * Rank file durations descending and return the top N (default 10).
 * Ties keep input order (stable sort).
 */
export function rankSlowestFiles(vitestJsonOrRows, limit = 10) {
  const n = normalizePositiveInt(limit, 10);
  const rows = Array.isArray(vitestJsonOrRows)
    ? vitestJsonOrRows.map(normalizeDurationRow).filter(Boolean)
    : extractFileDurations(vitestJsonOrRows);
  const sorted = [...rows].sort((a, b) => b.durationMs - a.durationMs);
  return sorted.slice(0, n).map((row, i) => ({
    rank: i + 1,
    file: row.file,
    durationMs: row.durationMs,
  }));
}

/**
 * Parse argv for scripts/gate_profile.mjs. Unknown flags throw so a typo does
 * not silently run a multi-hour full profile.
 *
 * @param {ReadonlyArray<string>} argv process.argv slice starting after node+script
 */
export function parseGateProfileArgs(argv) {
  const out = {
    help: false,
    factsOnly: false,
    steps: true,
    vitestSlow: false,
    fromJson: null,
    top: 10,
    skipBrowser: false,
    skipBuilds: false,
    skipVitest: false,
    skipTypes: false,
    continueOnError: false,
    jsonOut: null,
    workersOverride: null,
    dryRun: false,
  };

  const args = [...argv];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }
    if (a === '--facts' || a === '--facts-only') {
      out.factsOnly = true;
      out.steps = false;
      continue;
    }
    if (a === '--vitest-slow') {
      out.vitestSlow = true;
      // Vitest-slow can run alone or after timed steps; keep steps unless facts-only.
      continue;
    }
    if (a === '--from-json') {
      const path = args[++i];
      if (!path || path.startsWith('-')) {
        throw new Error('--from-json requires a path argument');
      }
      out.fromJson = path;
      out.steps = false;
      out.vitestSlow = true;
      continue;
    }
    if (a === '--top') {
      const raw = args[++i];
      const n = Number.parseInt(String(raw), 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--top requires a positive integer, got ${JSON.stringify(raw)}`);
      }
      out.top = n;
      continue;
    }
    if (a === '--skip-browser') {
      out.skipBrowser = true;
      continue;
    }
    if (a === '--skip-builds') {
      out.skipBuilds = true;
      continue;
    }
    if (a === '--skip-vitest') {
      out.skipVitest = true;
      continue;
    }
    if (a === '--skip-types') {
      out.skipTypes = true;
      continue;
    }
    if (a === '--continue-on-error') {
      out.continueOnError = true;
      continue;
    }
    if (a === '--json-out') {
      const path = args[++i];
      if (!path || path.startsWith('-')) {
        throw new Error('--json-out requires a path argument');
      }
      out.jsonOut = path;
      continue;
    }
    if (a === '--workers') {
      const raw = args[++i];
      const n = Number.parseInt(String(raw), 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--workers requires a positive integer, got ${JSON.stringify(raw)}`);
      }
      out.workersOverride = n;
      continue;
    }
    if (a === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (a === '--no-steps') {
      out.steps = false;
      continue;
    }
    throw new Error(`unknown argument: ${a} (pass --help for usage)`);
  }

  if (out.factsOnly && out.vitestSlow && !out.fromJson) {
    // facts + vitest-slow without --from-json still runs vitest; steps stay off.
    out.steps = false;
  }

  return out;
}

/**
 * Gate step list aligned with scripts/gate.mjs (names + turbo/npm/git commands).
 * Preflights (dep sync, ffmpeg) are measured separately by the entry script.
 * Generate-once + turbo cacheable pure steps live in buildFullGateSteps.
 *
 * @param {number} workers
 * @param {{
 *   releaseTier?: boolean,
 *   skipBrowser?: boolean,
 *   skipBuilds?: boolean,
 *   skipVitest?: boolean,
 *   skipTypes?: boolean,
 * }} [opts]
 * @returns {Array<{ name: string, cmd: string, args: string[], env?: Record<string, string> }>}
 */
export function buildGateProfileSteps(workers, opts = {}) {
  return buildFullGateSteps(workers, opts);
}

/** Human-readable machine facts block. */
export function formatMachineFacts(facts, extra = {}) {
  const lines = [
    'Machine facts',
    `  OS:              ${facts.platform} (${facts.arch})`,
    `  CPUs:            ${facts.cpuCount}`,
    `  RAM total/free:  ${facts.totalMemGb} / ${facts.freeMemGb} GiB`,
    `  Tier:            ${facts.tier}`,
    `  Node:            ${facts.nodeVersion}`,
    `  GATE_MAX_WORKERS:${facts.gateMaxWorkers == null ? ' (unset)' : ` ${facts.gateMaxWorkers}`}`,
  ];
  // Availability (lib/gate_memory.mjs) is what the worker clamp actually budgets against,
  // and on macOS it is far above freemem. Printed only when the caller resolved it, so a
  // reader can tell why the worker count does not follow the free figure above.
  if (extra.availableMemGb != null) {
    lines.push(`  RAM available:   ${extra.availableMemGb} GiB`);
  }
  if (extra.workers != null) lines.push(`  gate workers:    ${extra.workers}`);
  if (extra.gitSha) lines.push(`  git SHA:         ${extra.gitSha}`);
  if (extra.npmVersion) lines.push(`  npm:             ${extra.npmVersion}`);
  if (extra.dateUtc) lines.push(`  date (UTC):      ${extra.dateUtc}`);
  return lines.join('\n');
}

/**
 * Format timed step results. Each step:
 * { name, seconds, status: 'ok'|'fail'|'skipped', exitCode?: number|null }
 */
export function formatStepTimings(steps) {
  const header = ['Step timings (wall seconds)', '  status  seconds  name'];
  const body = steps.map((s) => {
    const status = (s.status ?? 'ok').padEnd(6);
    const sec = Number.isFinite(s.seconds) ? s.seconds.toFixed(1).padStart(8) : '     n/a';
    return `  ${status}  ${sec}  ${s.name}`;
  });
  const total = steps
    .filter((s) => s.status !== 'skipped' && Number.isFinite(s.seconds))
    .reduce((acc, s) => acc + s.seconds, 0);
  const footer = [`  TOTAL   ${total.toFixed(1).padStart(8)}  (sum of non-skipped)`];
  return [...header, ...body, ...footer].join('\n');
}

/** Markdown-friendly slow-file table body lines (no header). */
export function formatSlowFiles(ranked) {
  if (!ranked.length) return '(no file durations found in report)';
  return ranked
    .map(
      (r) =>
        `  ${String(r.rank).padStart(2)}. ${r.durationMs.toFixed(0).padStart(8)} ms  ${r.file}`,
    )
    .join('\n');
}

export function helpText() {
  return `gate_profile: measure local gate step wall times and vitest slow files

Usage:
  node scripts/gate_profile.mjs [options]

Options:
  --help, -h           Show this help
  --facts, --facts-only
                       Print machine facts only (no steps)
  --no-steps           Do not run timed gate steps
  --vitest-slow        After steps (or alone with --no-steps), run vitest with
                       JSON reporter and print top-N slowest files
  --from-json <path>   Rank slow files from an existing vitest JSON report
                       (implies --no-steps and --vitest-slow; no re-run)
  --top <n>            How many slow files to show (default 10)
  --workers <n>        Override vitest maxWorkers for timed vitest step
                       (does not change gate.mjs defaults)
  --skip-browser       Skip browser regressions step
  --skip-builds        Skip env/server/client build steps
  --skip-vitest        Skip full vitest step
  --skip-types         Skip typecheck step
  --continue-on-error  Keep timing remaining steps after a failure
  --json-out <path>    Write a machine-readable summary JSON
  --dry-run            Print planned steps and facts without spawning

Environment:
  GATE_MAX_WORKERS     Same override as scripts/gate.mjs when --workers is unset
  WOC_SKIP_DEP_SYNC=1  Skip npm ls preflight (same as gate.mjs)
  WOC_SKIP_PRETEST=1   Applied to the vitest step after generate-once (same as gate.mjs)

Examples:
  node scripts/gate_profile.mjs --facts
  node scripts/gate_profile.mjs --skip-browser --json-out tmp/gate-profile.json
  node scripts/gate_profile.mjs --no-steps --vitest-slow --top 15
  node scripts/gate_profile.mjs --from-json tmp/vitest-results.json --top 20
`;
}

// --- internals ---

function round1(n) {
  return Math.round(n * 10) / 10;
}

function normalizePositiveInt(raw, fallback) {
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function normalizeTestResults(vitestJson) {
  if (Array.isArray(vitestJson)) return vitestJson;
  if (vitestJson && typeof vitestJson === 'object') {
    if (Array.isArray(vitestJson.testResults)) return vitestJson.testResults;
    // Vitest 4 sometimes nests under "testResults" only; also accept a single file.
    if (vitestJson.name || vitestJson.filepath || vitestJson.file) return [vitestJson];
  }
  return [];
}

function pickFileName(file) {
  const raw =
    file.name ??
    file.filepath ??
    file.file ??
    file.filename ??
    (typeof file.meta?.file === 'string' ? file.meta.file : null);
  if (typeof raw !== 'string' || raw.length === 0) return null;
  // Prefer a repo-relative path when an absolute path is present.
  const marker = '/tests/';
  const idx = raw.lastIndexOf(marker);
  if (idx !== -1) return raw.slice(idx + 1); // "tests/..."
  const winMarker = '\\tests\\';
  const widx = raw.lastIndexOf(winMarker);
  if (widx !== -1) return raw.slice(widx + 1).replace(/\\/g, '/');
  return raw;
}

function pickDurationMs(file) {
  if (Number.isFinite(file.duration) && file.duration >= 0) return file.duration;
  if (Number.isFinite(file.durationMs) && file.durationMs >= 0) return file.durationMs;
  if (Number.isFinite(file.startTime) && Number.isFinite(file.endTime)) {
    const d = file.endTime - file.startTime;
    return d >= 0 ? d : null;
  }
  // Some reporters only put per-assertion times; sum when present.
  if (Array.isArray(file.assertionResults) && file.assertionResults.length > 0) {
    let sum = 0;
    let any = false;
    for (const a of file.assertionResults) {
      if (Number.isFinite(a.duration) && a.duration >= 0) {
        sum += a.duration;
        any = true;
      }
    }
    if (any) return sum;
  }
  return null;
}

function normalizeDurationRow(row) {
  if (!row || typeof row !== 'object') return null;
  const file = typeof row.file === 'string' ? row.file : pickFileName(row);
  const durationMs =
    Number.isFinite(row.durationMs) && row.durationMs >= 0 ? row.durationMs : pickDurationMs(row);
  if (!file || durationMs == null) return null;
  return { file, durationMs };
}
