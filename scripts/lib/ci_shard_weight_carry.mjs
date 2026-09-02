// Carried shard weights: the machine-readable half of the weight table's
// provenance (scripts/ci_shard_weights.generated.json).
//
// A CI harvest (scripts/ci_shard_weights_harvest.mjs <run-id>) measures every
// file the run executed. Between harvests the table also carries rows no harvest
// produced: test files a release sync or a phase added, measured locally so the
// coverage floor in tests/ci_shard_partition.test.ts keeps grading the LPT
// balance claim against reality, and rows an older table measured in an earlier
// harvest that a KEY UNION (scripts/merge_audit/shard_weight_union.mjs) kept.
// Until Phase 18 that carrying was disclosed in prose only, and the gate
// reviewer's finding stood through three phases: NOTHING MACHINE-CHECKED THAT A
// CARRIED WEIGHT WAS A REAL MEASUREMENT. A contributor appending rows valued at
// MEASURED_FALLBACK_MS would have passed every pin and left the balance bar
// byte-identical, since that bar already scores an unknown file at the fallback.
//
// The contract this module owns, pinned by tests/ci_shard_weight_carry.test.ts
// (fixtures) and tests/ci_shard_partition.test.ts (the committed table):
//   __provenance.carried      one entry per row the newest harvest did NOT
//                             measure: { ms, method, ... } with the fields the
//                             method requires (below).
//   __provenance.harvestedFiles  the count of rows the newest harvest measured.
//   identity                  files == rows == harvestedFiles + |carried|, so a
//                             row appended without an attribution reds the pin.
//   fallback-not-modal        MEASURED_FALLBACK_MS is not the modal value among
//                             the carried rows (the fabrication shape above).
// Methods:
//   local-median          measured locally: `runs` (every run's ms) whose median
//                         is `ms`, the `measured` date, and a non-empty `reason`
//                         saying WHY the row was carried instead of harvested.
//                         Written by `ci_shard_weights_harvest.mjs --carry-local`.
//                         The reason is required, not decorative: a local carry
//                         is always a stopgap for a harvest that could not run,
//                         and the row has to say which one, so a reader months
//                         later can tell a pending-harvest row from a permanent
//                         one without going back through the phase docs.
//   union-older-harvest   measured by an OLDER CI harvest and kept by a key
//                         union: `run` names that harvest, `measured` its date.
//   prose-backfill        a row the table carried before this map existed,
//                         attributed once from the localMerge prose on the date
//                         __provenance.backfill records (its `note` says so).
//                         New rows never take this method; it exists so the 410
//                         rows carried through Phases 11d to 11m are declared
//                         rather than laundered into the harvested count.

export const CARRY_METHODS = Object.freeze([
  'local-median',
  'union-older-harvest',
  'prose-backfill',
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Row keys of a table: everything but the provenance block. */
export function tableRows(table) {
  return Object.keys(table).filter((k) => k !== '__provenance');
}

/**
 * The median of a non-empty list of integer milliseconds: the middle value for
 * an odd count, the rounded mean of the two middles for an even one.
 *
 * Named medianMs, not median: scripts/load_probe.mjs and
 * scripts/assets/eastbrook_grand_armoury/capture_contract.mjs already export a
 * `median`, and a third same-named export in the scripts tree is a
 * duplicate-definition row in the merge census for no gain. The suffix also
 * states the unit this one rounds to.
 * @param {readonly number[]} values
 */
export function medianMs(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('medianMs: need at least one value');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** The modal value(s) of a list: every value sharing the highest count. */
export function modes(values) {
  const freq = new Map();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  let best = 0;
  for (const n of freq.values()) if (n > best) best = n;
  return [...freq.entries()].filter(([, n]) => n === best).map(([v]) => v);
}

/**
 * The carried map, `{}` when the table predates it.
 * @param {Record<string, unknown>} table
 * @returns {Record<string, Record<string, unknown>>}
 */
export function carriedRows(table) {
  const carried = table.__provenance?.carried;
  return carried && typeof carried === 'object' && !Array.isArray(carried) ? carried : {};
}

/**
 * Every defect in a table's carried attribution, as messages. An empty list is
 * the pass. The committed table is checked with `requireMap: true` (the map and
 * the harvested count must be PRESENT, not merely consistent when present); the
 * tools accept a legacy table without a map so an old parent can still be
 * unioned.
 *
 * @param {Record<string, any>} table
 * @param {{ fallbackMs?: number, requireMap?: boolean }} [opts]
 * @returns {string[]}
 */
export function carriedDefects(table, opts = {}) {
  const defects = [];
  const prov = table.__provenance;
  if (!prov || typeof prov !== 'object') return ['__provenance is missing'];
  const rows = tableRows(table);
  const hasMap = prov.carried !== undefined;
  if (opts.requireMap && !hasMap) defects.push('__provenance.carried is missing');
  if (
    hasMap &&
    (typeof prov.carried !== 'object' || prov.carried === null || Array.isArray(prov.carried))
  ) {
    defects.push('__provenance.carried is not an object');
    return defects;
  }
  const carried = carriedRows(table);
  const carriedKeys = Object.keys(carried);
  if (typeof prov.files === 'number' && prov.files !== rows.length) {
    defects.push(`files ${prov.files} != ${rows.length} rows`);
  }
  if (opts.requireMap && typeof prov.harvestedFiles !== 'number') {
    defects.push('__provenance.harvestedFiles is missing');
  }
  if (
    typeof prov.harvestedFiles === 'number' &&
    prov.harvestedFiles + carriedKeys.length !== rows.length
  ) {
    defects.push(
      `harvestedFiles ${prov.harvestedFiles} + ${carriedKeys.length} carried != ${rows.length} rows ` +
        '(a row was added or removed without moving its attribution)',
    );
  }
  let backfilled = 0;
  for (const key of carriedKeys) {
    const entry = carried[key];
    if (!entry || typeof entry !== 'object') {
      defects.push(`${key}: carried entry is not an object`);
      continue;
    }
    if (!(key in table) || key === '__provenance') {
      defects.push(`${key}: carried but not a row`);
      continue;
    }
    const row = table[key];
    if (!Number.isInteger(entry.ms) || entry.ms <= 0) {
      defects.push(`${key}: carried ms ${JSON.stringify(entry.ms)} is not a positive integer`);
    } else if (row !== entry.ms) {
      defects.push(`${key}: row ${row} != carried ms ${entry.ms}`);
    }
    if (!CARRY_METHODS.includes(entry.method)) {
      defects.push(`${key}: unknown carry method ${JSON.stringify(entry.method)}`);
      continue;
    }
    if (entry.method === 'local-median') {
      if (!Array.isArray(entry.runs) || entry.runs.length === 0) {
        defects.push(`${key}: local-median without runs`);
      } else if (!entry.runs.every((r) => Number.isInteger(r) && r > 0)) {
        defects.push(`${key}: local-median runs must be positive integers`);
      } else if (medianMs(entry.runs) !== entry.ms) {
        defects.push(`${key}: ms ${entry.ms} is not the median of runs ${entry.runs.join(',')}`);
      }
      if (!DATE_RE.test(String(entry.measured)))
        defects.push(`${key}: local-median without a measured date`);
      if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
        defects.push(`${key}: local-median without a reason`);
      }
    } else if (entry.method === 'union-older-harvest') {
      if (!/^\d+$/.test(String(entry.run)))
        defects.push(`${key}: union-older-harvest without a numeric run`);
      if (!DATE_RE.test(String(entry.measured)))
        defects.push(`${key}: union-older-harvest without a measured date`);
    } else {
      backfilled += 1;
    }
  }
  if (backfilled > 0) {
    const bf = prov.backfill;
    if (
      !bf ||
      typeof bf !== 'object' ||
      !DATE_RE.test(String(bf.date)) ||
      typeof bf.note !== 'string' ||
      !bf.note.trim()
    ) {
      defects.push(`${backfilled} prose-backfill rows without a dated __provenance.backfill note`);
    }
  }
  if (typeof opts.fallbackMs === 'number' && carriedKeys.length > 0) {
    const values = carriedKeys.map((k) => carried[k]?.ms).filter((v) => Number.isInteger(v));
    if (values.length > 0 && modes(values).includes(opts.fallbackMs)) {
      defects.push(
        `MEASURED_FALLBACK_MS ${opts.fallbackMs} is a modal value among the ${values.length} carried rows ` +
          '(the fabrication shape: rows filled at the fallback pass every other pin unchanged)',
      );
    }
  }
  return defects;
}

/**
 * Apply local measurements to a table: each file gets a row at the median of its
 * runs and a `local-median` carried entry. A file the newest harvest measured
 * (a row NOT in the carried map) is refused: a local run never overwrites a CI
 * weight. Re-carrying an already carried row replaces its attribution.
 *
 * @param {Record<string, any>} table
 * @param {ReadonlyArray<{ file: string, runs: readonly number[] }>} measurements
 * @param {{ measured: string, reason: string }} opts the measurement date
 *   (YYYY-MM-DD) and why these rows are carried rather than harvested
 * @returns {Record<string, any>} a new table, rows sorted
 */
export function applyLocalCarry(table, measurements, opts) {
  if (!DATE_RE.test(String(opts?.measured))) {
    throw new Error('applyLocalCarry: opts.measured must be a YYYY-MM-DD date');
  }
  if (typeof opts?.reason !== 'string' || opts.reason.trim() === '') {
    throw new Error('applyLocalCarry: opts.reason must say why the rows are carried');
  }
  const prov = table.__provenance;
  if (!prov || typeof prov !== 'object')
    throw new Error('applyLocalCarry: table has no __provenance');
  const carried = { ...carriedRows(table) };
  const rows = {};
  for (const k of tableRows(table)) rows[k] = table[k];
  const harvestedBefore = tableRows(table).length - Object.keys(carriedRows(table)).length;
  for (const m of measurements) {
    if (!m.file.startsWith('tests/'))
      throw new Error(`applyLocalCarry: ${m.file} is not under tests/`);
    if (m.file in rows && !(m.file in carried)) {
      throw new Error(
        `applyLocalCarry: ${m.file} is a harvested row; a local run never overwrites a CI weight`,
      );
    }
    if (!m.runs.every((r) => Number.isInteger(r) && r > 0)) {
      throw new Error(`applyLocalCarry: ${m.file} runs must be positive integer milliseconds`);
    }
    const ms = medianMs(m.runs);
    rows[m.file] = ms;
    carried[m.file] = {
      ms,
      method: 'local-median',
      measured: opts.measured,
      reason: opts.reason.trim(),
      runs: [...m.runs],
    };
  }
  const sortedRows = Object.fromEntries(Object.entries(rows).sort(([a], [b]) => (a < b ? -1 : 1)));
  const sortedCarried = Object.fromEntries(
    Object.entries(carried).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  return {
    __provenance: {
      ...prov,
      files: Object.keys(sortedRows).length,
      harvestedFiles:
        typeof prov.harvestedFiles === 'number' ? prov.harvestedFiles : harvestedBefore,
      carried: sortedCarried,
    },
    ...sortedRows,
  };
}

/**
 * The carried map and harvested count of a KEY UNION: the newer table's own
 * attributions travel with its rows, and every row only the older table carried
 * keeps the older table's attribution when it has one, else is attributed to the
 * older table's harvest run.
 *
 * @param {{ newer: Record<string, any>, older: Record<string, any>, carriedKeys: readonly string[] }} args
 * @returns {{ carried: Record<string, Record<string, unknown>>, harvestedFiles: number }}
 */
export function unionCarried({ newer, older, carriedKeys }) {
  const newerCarried = carriedRows(newer);
  const olderCarried = carriedRows(older);
  const newerKeys = tableRows(newer);
  const carried = {};
  let harvestedFiles = 0;
  for (const k of newerKeys) {
    if (newerCarried[k]) carried[k] = newerCarried[k];
    else harvestedFiles += 1;
  }
  for (const k of carriedKeys) {
    carried[k] = olderCarried[k] ?? {
      ms: older[k],
      method: 'union-older-harvest',
      run: String(older.__provenance?.run),
      measured: older.__provenance?.harvested,
    };
  }
  return {
    carried: Object.fromEntries(Object.entries(carried).sort(([a], [b]) => (a < b ? -1 : 1))),
    harvestedFiles,
  };
}

/**
 * The default `reason` a `--carry-local` row carries. Phase 18 of the
 * masterwrought packet added roughly thirty test files whose weights no CI
 * harvest has measured, and the harvest cannot run while the branch is local,
 * so the rows are carried at local medians until the post-push harvest replaces
 * them wholesale. Override with `--reason` when carrying for a different cause.
 */
export const DEFAULT_LOCAL_CARRY_REASON = 'phase 18 local carry pending the post-push harvest';

/**
 * The test files a weight table does not measure, in walk order. The phase-close
 * carry enumerates its work with this rather than a hand-kept list, so a file a
 * late unit added cannot be missed.
 *
 * @param {readonly string[]} walkedFiles the shard walk's population
 * @param {Record<string, unknown>} weights the measured table (rows only)
 * @returns {string[]}
 */
export function missingWeightFiles(walkedFiles, weights) {
  return walkedFiles.filter((f) => typeof weights[f] !== 'number');
}

/**
 * Split a `--carry-local` argument list into its optional `--reason <text>` and
 * the measurement tokens. Parsed here rather than in the entry script so the
 * flag has pins: a `--reason` with no value, or a repeated one, is a refusal
 * rather than a silently dropped argument that would leave every row carrying
 * the default reason instead of the one the operator typed.
 *
 * @param {readonly string[]} argv the arguments AFTER `--carry-local`
 * @returns {{ reason: string, tokens: string[] }}
 */
export function parseCarryLocalCli(argv) {
  const tokens = [];
  let reason = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--reason') {
      tokens.push(argv[i]);
      continue;
    }
    if (reason !== null) throw new Error('--carry-local: --reason given twice');
    const value = argv[i + 1];
    if (value === undefined || value.trim() === '' || value === '--reason') {
      throw new Error('--carry-local: --reason needs a non-empty value');
    }
    reason = value.trim();
    i += 1;
  }
  return { reason: reason ?? DEFAULT_LOCAL_CARRY_REASON, tokens };
}

/**
 * Parse the `--carry-local` measurement arguments: one `<path>=<ms>[,<ms>...]`
 * token per file, the runs in the order they were measured. Kept here rather
 * than in the entry script so the fixture suite pins the refusals (a token with
 * no `=`, an empty or non-integer run list, a duplicate file) instead of the
 * entry parsing arguments no test ever drives.
 *
 * @param {readonly string[]} tokens
 * @returns {Array<{ file: string, runs: number[] }>}
 */
export function parseCarryLocalArgs(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    throw new Error('--carry-local needs at least one <path>=<ms>[,<ms>...] measurement');
  }
  const out = [];
  const seen = new Set();
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq <= 0) throw new Error(`--carry-local: ${token} is not <path>=<ms>[,<ms>...]`);
    const file = token.slice(0, eq);
    if (seen.has(file)) throw new Error(`--carry-local: ${file} measured twice`);
    seen.add(file);
    const parts = token.slice(eq + 1).split(',');
    const runs = parts.map((p) => {
      if (!/^\d+$/.test(p.trim())) {
        throw new Error(`--carry-local: ${file} run ${JSON.stringify(p)} is not an integer ms`);
      }
      return Number(p.trim());
    });
    if (runs.length === 0 || runs.some((r) => r <= 0)) {
      throw new Error(`--carry-local: ${file} needs at least one positive ms measurement`);
    }
    out.push({ file, runs });
  }
  return out;
}

/**
 * Drop every weight row whose file no longer exists, MOVING THE ATTRIBUTION
 * WITH IT. Pure and injectable (`exists` is passed in) so the arithmetic that
 * makes it safe is testable without a tree walk.
 *
 * WHY IT EXISTS. Retiring a test file leaves its weight row naming a path that
 * is gone, and `tests/ci_shard_partition.test.ts` reds on exactly that (an
 * absent-file row silently skews the pack it lands in). The full harvest cannot
 * discharge it, because that needs a green all-green FULL-MODE CI run, so
 * before this the only local answer was to hand-edit a generated table, which
 * the repo forbids.
 *
 * THE ARITHMETIC IS THE WHOLE POINT. `carriedDefects` holds the table to
 * `harvestedFiles + carried == rows`, so dropping a HARVESTED row must
 * decrement `harvestedFiles` while dropping a CARRIED one is paid by deleting
 * its `carried` entry. Getting that backwards writes a table its own pin
 * refuses, which is why the caller re-runs `carriedDefects` before writing.
 *
 * @param {Record<string, any>} table
 * @param {(file: string) => boolean} exists
 */
export function pruneMissingRows(table, exists) {
  const provenance = table.__provenance ?? {};
  const gone = tableRows(table).filter((file) => !exists(file));
  if (gone.length === 0) return { table, gone: [] };
  const goneSet = new Set(gone);
  const goneCarried = gone.filter((file) => Boolean(provenance.carried?.[file])).length;
  const out = { __provenance: { ...provenance } };
  if (out.__provenance.carried) {
    out.__provenance.carried = { ...out.__provenance.carried };
    for (const file of gone) delete out.__provenance.carried[file];
  }
  for (const file of tableRows(table)) {
    if (!goneSet.has(file)) out[file] = table[file];
  }
  if (typeof provenance.harvestedFiles === 'number') {
    out.__provenance.harvestedFiles = provenance.harvestedFiles - (gone.length - goneCarried);
  }
  out.__provenance.files = tableRows(out).length;
  return { table: out, gone };
}

/**
 * Serialize a table the way both writers commit it: two-space JSON with a
 * trailing newline. `JSON.parse(serializeWeightTable(t))` deep-equals `t`.
 *
 * ONE writer owns this file's bytes, and it is this function, not the
 * formatter: `biome.json` excludes the table for the same reason it excludes
 * `**\/*.generated.ts`. That exclusion became load-bearing when the carried map
 * arrived, because a carried `runs` list is the file's first array and biome
 * collapses a short array onto one line where `JSON.stringify` expands it, so
 * generator and formatter disagree by construction and `npm run ci:changed`
 * would fail on the format diff of a file nobody hand-edits. Until then the
 * table happened to agree with biome only because it contained no arrays at all.
 *
 * @param {Record<string, any>} table
 */
export function serializeWeightTable(table) {
  return `${JSON.stringify(table, null, 2)}\n`;
}
