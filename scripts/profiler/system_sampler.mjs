// System-level CPU/GPU sampling for the perf baseline harness. macmon
// (brew install macmon) reads Apple Silicon GPU/CPU utilization without sudo;
// where it is missing the sampler still runs and reports the browser
// process-tree CPU via ps, leaving the GPU fields null (the pure aggregation in
// scripts/lib/perf_baseline_store.mjs treats absent metrics as advisory, never a
// gate failure). Not pure (child processes + timers): anything testable lives in
// the store module, per scripts/CLAUDE.md.
import { execFile, spawn } from 'node:child_process';
import { sumProcessTreeCpu } from '../lib/perf_baseline_store.mjs';

export function startSystemSampler({ browserPid = null, intervalMs = 700 } = {}) {
  const points = [];
  let macmonState = 'pending';
  let child = null;
  try {
    child = spawn('macmon', ['pipe', '-i', String(Math.max(200, intervalMs))], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += String(chunk);
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
        if (!line) continue;
        try {
          const j = JSON.parse(line);
          macmonState = 'ok';
          points.push({
            t: Date.now(),
            cpuPct: Number.isFinite(j.cpu_active_ratio) ? j.cpu_active_ratio * 100 : undefined,
            gpuPct: Number.isFinite(j.gpu_active_ratio) ? j.gpu_active_ratio * 100 : undefined,
            gpuPowerW: Number.isFinite(j.gpu_power) ? j.gpu_power : undefined,
          });
        } catch {
          /* partial or non-JSON line: skip */
        }
      }
    });
    child.on('error', () => {
      macmonState = 'missing';
      child = null;
    });
  } catch {
    macmonState = 'missing';
  }
  let timer = null;
  if (browserPid) {
    const poll = () => {
      execFile('ps', ['-Ao', 'pid=,ppid=,pcpu='], (err, stdout) => {
        if (err) return;
        const total = sumProcessTreeCpu(stdout, browserPid);
        if (total != null) points.push({ t: Date.now(), procCpuPct: total });
      });
    };
    timer = setInterval(poll, intervalMs);
    poll();
  }
  return {
    points,
    macmonAvailable: () => macmonState === 'ok',
    stop() {
      if (timer) clearInterval(timer);
      try {
        child?.kill();
      } catch {
        /* already exited */
      }
      return points;
    },
  };
}
