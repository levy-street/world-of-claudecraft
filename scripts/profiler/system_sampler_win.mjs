// Windows arm of the profiler system sampler. scripts/profiler/system_sampler.mjs
// dispatches here on win32 and the return shape is identical to the darwin arm:
// a live `points` array of timestamped partial metrics, `macmonAvailable()`
// (true once the GPU source has produced a sample), and `stop()`.
//
// GPU utilization/memory/power: a long-running `nvidia-smi ... -l 1` poll when
// the binary exists (checked via `where`); otherwise a vendor-neutral
// `typeperf "\GPU Engine(*engtype_3D)\Utilization Percentage" -si 1` poll whose
// per-process engine instances are summed (clamped to 100) per sample line.
// Browser process-tree CPU: one PowerShell CIM one-shot builds the process tree
// rooted at the browser pid, then bounded per-interval one-shots over
// Win32_PerfFormattedData_PerfProc_Process sum PercentProcessorTime across the
// tree (the counter is per-core scaled, like ps pcpu on the darwin arm).
// Any failure degrades to missing points (the aggregation in
// scripts/lib/perf_baseline_store.mjs treats absent metrics as advisory), never
// a throw. Not pure (child processes + timers), per scripts/CLAUDE.md.
import { execFile, spawn, spawnSync } from 'node:child_process';

const TREE_QUERY_TIMEOUT_MS = 20000;
const POLL_TIMEOUT_MS = 8000;
const PROCESS_TREE_CMD =
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress';
const PROC_CPU_CMD =
  'Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Select-Object IDProcess,PercentProcessorTime | ConvertTo-Json -Compress';

function nvidiaSmiPresent() {
  try {
    const probe = spawnSync('where', ['nvidia-smi'], { stdio: 'ignore', windowsHide: true });
    return probe.status === 0;
  } catch {
    return false;
  }
}

// Feed complete lines (CRLF tolerated) from a child stdout stream to `handle`.
function onLines(stream, handle) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += String(chunk);
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '').trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
      if (line) handle(line);
    }
  });
}

// One `nvidia-smi --format=csv,noheader,nounits` line: "41, 2231, 12282, 87.20"
// (utilization.gpu %, memory.used MiB, memory.total MiB, power.draw W). Power
// reads "[N/A]" on some boards, which nulls just that field.
function parseNvidiaSmiLine(line) {
  const parts = String(line)
    .split(',')
    .map((part) => Number(part.trim()));
  if (parts.length < 4 || !Number.isFinite(parts[0])) return null;
  return {
    gpuPct: Math.min(100, Math.max(0, parts[0])),
    gpuMemUsedMb: Number.isFinite(parts[1]) ? parts[1] : undefined,
    gpuMemTotalMb: Number.isFinite(parts[2]) ? parts[2] : undefined,
    gpuPowerW: Number.isFinite(parts[3]) ? parts[3] : undefined,
  };
}

// typeperf prints locale-formatted values; tolerate a decimal comma.
function typeperfNumber(text) {
  const direct = Number(text);
  if (Number.isFinite(direct)) return direct;
  if (/^-?\d+,\d+$/.test(text)) return Number(text.replace(',', '.'));
  return Number.NaN;
}

// typeperf emits quoted CSV: a header line of counter paths, then per-second
// lines of "timestamp","val","val",... with one column per process 3D-engine
// instance. The header (or a localized error line) has no numeric columns and
// yields null; a data line sums its instances, clamped to 100 (the instances
// are per-process utilizations of the shared engine).
function parseTypeperfLine(line) {
  const fields = [...String(line).matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  if (fields.length < 2) return null;
  let sum = 0;
  let numeric = 0;
  for (let i = 1; i < fields.length; i++) {
    const value = typeperfNumber(fields[i]);
    if (!Number.isFinite(value)) continue;
    sum += value;
    numeric++;
  }
  if (!numeric) return null;
  return Math.min(100, Math.max(0, sum));
}

// Rows from Win32_Process (ProcessId/ParentProcessId): the set of pids in the
// tree rooted at rootPid, or null when the root is not in the table.
function collectTreePids(rows, rootPid) {
  const root = Number(rootPid);
  const kids = new Map();
  let sawRoot = false;
  for (const row of Array.isArray(rows) ? rows : []) {
    const pid = Number(row?.ProcessId);
    if (!Number.isFinite(pid)) continue;
    if (pid === root) sawRoot = true;
    const ppid = Number(row?.ParentProcessId);
    if (!Number.isFinite(ppid)) continue;
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  if (!sawRoot) return null;
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const kid of kids.get(pid) ?? []) stack.push(kid);
  }
  return seen;
}

// Rows from Win32_PerfFormattedData_PerfProc_Process: total PercentProcessorTime
// over the tree pids, or null when none matched (e.g. the tree died).
function sumTreeCpu(rows, treePids) {
  let total = 0;
  let matched = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const pid = Number(row?.IDProcess);
    const pct = Number(row?.PercentProcessorTime);
    if (!Number.isFinite(pid) || !Number.isFinite(pct)) continue;
    if (!treePids.has(pid)) continue;
    total += pct;
    matched++;
  }
  if (!matched) return null;
  return Math.round(total * 10) / 10;
}

export function startSystemSamplerWin({ browserPid = null, intervalMs = 700 } = {}) {
  const points = [];
  const children = new Set();
  let stopped = false;
  let gpuState = 'pending'; // pending | ok | missing
  let typeperfStarted = false;

  const track = (child) => {
    if (!child) return null;
    children.add(child);
    child.on('close', () => children.delete(child));
    child.on('error', () => children.delete(child));
    return child;
  };

  // Bounded PowerShell one-shot returning parsed JSON rows; null on any
  // failure (the timeout kills the child, bad JSON, non-zero exit).
  const psJsonRows = (command, timeoutMs, cb) => {
    try {
      const child = execFile(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout) => {
          if (err) return cb(null);
          try {
            const parsed = JSON.parse(String(stdout));
            cb(Array.isArray(parsed) ? parsed : parsed ? [parsed] : null);
          } catch {
            cb(null);
          }
        },
      );
      track(child);
    } catch {
      cb(null);
    }
  };

  const startTypeperf = () => {
    if (stopped || typeperfStarted) return;
    typeperfStarted = true;
    try {
      const child = spawn(
        'typeperf',
        ['\\GPU Engine(*engtype_3D)\\Utilization Percentage', '-si', '1'],
        { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
      );
      track(child);
      onLines(child.stdout, (line) => {
        const gpuPct = parseTypeperfLine(line);
        if (gpuPct == null) return;
        gpuState = 'ok';
        points.push({ t: Date.now(), gpuPct });
      });
      // A localized or missing counter set makes typeperf error out (often
      // before any data line): mark the GPU source missing, never throw.
      child.on('error', () => {
        if (gpuState !== 'ok') gpuState = 'missing';
      });
      child.on('exit', () => {
        if (gpuState !== 'ok') gpuState = 'missing';
      });
    } catch {
      gpuState = 'missing';
    }
  };

  const startNvidiaSmi = () => {
    try {
      const child = spawn(
        'nvidia-smi',
        [
          '--query-gpu=utilization.gpu,memory.used,memory.total,power.draw',
          '--format=csv,noheader,nounits',
          '-l',
          '1',
        ],
        { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
      );
      track(child);
      onLines(child.stdout, (line) => {
        const sample = parseNvidiaSmiLine(line);
        if (!sample) return;
        gpuState = 'ok';
        points.push({ t: Date.now(), ...sample });
      });
      // A present-but-broken nvidia-smi (driver mismatch, immediate exit)
      // falls back to the vendor-neutral counter instead of losing GPU data.
      child.on('error', () => {
        if (!stopped && gpuState === 'pending') startTypeperf();
      });
      child.on('exit', () => {
        if (!stopped && gpuState === 'pending') startTypeperf();
      });
    } catch {
      startTypeperf();
    }
  };

  if (nvidiaSmiPresent()) startNvidiaSmi();
  else startTypeperf();

  let timer = null;
  if (browserPid) {
    psJsonRows(PROCESS_TREE_CMD, TREE_QUERY_TIMEOUT_MS, (rows) => {
      if (stopped) return;
      const treePids = collectTreePids(rows, browserPid);
      if (!treePids) return; // browser pid not in the table: procCpuPct stays absent
      let inFlight = false;
      const poll = () => {
        if (stopped || inFlight) return;
        inFlight = true;
        psJsonRows(PROC_CPU_CMD, POLL_TIMEOUT_MS, (perfRows) => {
          inFlight = false;
          if (stopped) return;
          const procCpuPct = sumTreeCpu(perfRows, treePids);
          if (procCpuPct != null) points.push({ t: Date.now(), procCpuPct });
        });
      };
      // A PowerShell one-shot costs 1 to 3s to start; the inFlight guard makes
      // a short interval degrade to back-to-back polls instead of a pile-up.
      timer = setInterval(poll, Math.max(200, intervalMs));
      poll();
    });
  }

  return {
    points,
    // Same probe name as the darwin arm so consumers stay platform-blind: true
    // once the Windows GPU source (nvidia-smi or typeperf) produced a sample.
    macmonAvailable: () => gpuState === 'ok',
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      for (const child of [...children]) {
        try {
          child.kill();
        } catch {
          /* already exited */
        }
      }
      return points;
    },
  };
}
