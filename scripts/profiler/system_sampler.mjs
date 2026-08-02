// System-level CPU/GPU sampling for the perf baseline harness, dispatched by
// platform. darwin (and any other non-Windows platform): macmon (brew install
// macmon) reads Apple Silicon GPU/CPU utilization without sudo; where it is
// missing the sampler still runs and reports the browser process-tree CPU via
// ps, leaving the GPU fields null. win32: delegates to system_sampler_win.mjs
// (nvidia-smi or typeperf for GPU, PowerShell CIM one-shots for the browser
// process tree) with the identical return shape. Absent metrics stay advisory
// either way (the pure aggregation in scripts/lib/perf_baseline_store.mjs never
// gates on them). Not pure (child processes + timers): anything testable lives
// in the store module, per scripts/CLAUDE.md.
import { execFile, spawn } from 'node:child_process';
import { sumProcessTreeCpu } from '../lib/perf_baseline_store.mjs';
import { startSystemSamplerWin } from './system_sampler_win.mjs';

export function startSystemSampler({ browserPid = null, intervalMs = 700 } = {}) {
  // Windows has neither macmon nor `ps -Ao`; the win32 arm fills the same
  // point fields from nvidia-smi/typeperf and PowerShell CIM instead.
  if (process.platform === 'win32') return startSystemSamplerWin({ browserPid, intervalMs });
  return startSystemSamplerPosix({ browserPid, intervalMs });
}

function startSystemSamplerPosix({ browserPid, intervalMs }) {
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
