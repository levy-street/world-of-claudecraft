// The memory SENSOR behind the gate's vitest worker clamp (`lib/gate_workers.mjs` owns the
// arithmetic; this module only answers "how much memory can this machine actually hand a new
// worker"). Split out per scripts/CLAUDE.md's module-first rule: the parse is pure and
// Vitest-pinned, and the one impure read (`vm_stat`) is injectable so no test spawns it.
//
// Why it exists. The clamp originally read `os.freemem()` on every platform. On Linux and
// Windows that is a reasonable proxy, but on macOS it counts ONLY completely unused pages,
// and macOS deliberately keeps almost none: idle RAM is filled with file cache and inactive
// pages the kernel reclaims the instant a process asks for them. So on a healthy Mac that has
// been up a while, freemem sits near zero no matter how much memory is really available, the
// memory bound collapses to 1, and the full suite runs single-threaded on an idle many-core
// box. The failure compounds under this repo's own recommended multi-worktree workflow:
// freemem also drops as sibling gates allocate, so the clamp tightened hardest exactly when
// throughput mattered most.
//
// Measured on a 14-core / 26 GB Mac (uptime 27 days) while four gates ran:
//   os.freemem()                      1.47 GB  -> memBound 1 (all 1974 test files serial)
//   vm_stat free+inactive+speculative ~12 GB   -> memBound 15, so CPU/2 stays the limiter
//   `memory_pressure`                 68% free, i.e. no pressure at all
//
// The clamp itself is kept: a worker that gets swapped out does not fail cleanly, it times
// out and reads as a flaky test. Only the sensor changes, and only on darwin.
import { spawnSync } from 'node:child_process';

// vm_stat line labels summed into "memory macOS can hand out without swapping".
// Deliberately excluded, because both are ALREADY counted in the lines above and would
// double count: `File-backed pages` (a file-backed page is also active or inactive) and
// `Pages purgeable` (a purgeable page also sits in the active or inactive queue). Erring
// low is the right bias for a clamp whose whole job is to stop a worker from swapping.
const DARWIN_AVAILABLE_PAGE_LABELS = ['Pages free', 'Pages inactive', 'Pages speculative'];

/**
 * Pure parse of `vm_stat` output into the bytes macOS could hand a new process without
 * swapping: free + inactive + speculative pages, at the page size vm_stat prints in its
 * header. See DARWIN_AVAILABLE_PAGE_LABELS for the two classes deliberately left out.
 *
 * Returns null when the text is missing, unparseable, or lacks the page size or the free-page
 * line, so the caller falls back to os.freemem() rather than trusting a partial read.
 *
 * @param {string | null | undefined} vmStatOutput
 * @returns {number | null}
 */
export function parseDarwinAvailableMemory(vmStatOutput) {
  if (typeof vmStatOutput !== 'string' || vmStatOutput.trim() === '') return null;
  const pageSize = Number(/page size of (\d+) bytes/.exec(vmStatOutput)?.[1]);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null;
  let pages = 0;
  let sawFree = false;
  for (const label of DARWIN_AVAILABLE_PAGE_LABELS) {
    // Each line reads e.g. "Pages inactive:    367677." (padded, trailing period).
    const match = new RegExp(`^${label}:\\s+(\\d+)\\.?\\s*$`, 'm').exec(vmStatOutput);
    if (!match) continue; // an older or newer vm_stat may omit a line; count it as zero
    if (label === 'Pages free') sawFree = true;
    pages += Number(match[1]);
  }
  if (!sawFree || !Number.isFinite(pages)) return null;
  return pages * pageSize;
}

/**
 * The one impure read: `vm_stat` stdout, or null if it is unavailable for any reason.
 * Never throws, so a locked-down or non-macOS host degrades to the old sensor.
 *
 * @returns {string | null}
 */
export function readDarwinVmStat() {
  try {
    const res = spawnSync('vm_stat', [], { encoding: 'utf8', timeout: 2000 });
    if (res.status !== 0 || typeof res.stdout !== 'string') return null;
    return res.stdout;
  } catch {
    return null;
  }
}

/**
 * Bytes of memory the worker clamp should budget against. darwin derives it from vm_stat;
 * every other platform keeps os.freemem(), where it already means what the clamp assumed.
 * Any read or parse failure falls back to freeMemBytes, so a future vm_stat format change can
 * only restore the old conservative behavior, never break the gate. The result is never LOWER
 * than freeMemBytes: this widens the sensor, it never tightens it.
 *
 * @param {{
 *   platform: string,
 *   freeMemBytes: number,
 *   readVmStat?: () => string | null,
 * }} opts
 * @returns {number}
 */
export function resolveAvailableMemoryBytes({ platform, freeMemBytes, readVmStat }) {
  if (platform !== 'darwin') return freeMemBytes;
  const read = readVmStat ?? readDarwinVmStat;
  let parsed = null;
  try {
    parsed = parseDarwinAvailableMemory(read());
  } catch {
    parsed = null; // vm_stat missing or unreadable: keep the old sensor
  }
  if (parsed === null) return freeMemBytes;
  return Math.max(parsed, freeMemBytes);
}
