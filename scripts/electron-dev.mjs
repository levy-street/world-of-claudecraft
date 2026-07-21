import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { buildElectronVendor } from './electron-vendor.mjs';

const {
  buildLinuxPrimeEnv,
  isLinuxHybridGpu,
  LINUX_OZONE_X11_ARG,
  PRIME_RELAUNCH_MARKER,
  shouldRelaunchForLinuxPrime,
} = createRequire(import.meta.url)('../electron/gpu_preference.cjs');

// On Linux hybrid-graphics machines main.cjs re-execs itself to bake the PRIME offload env
// in (see electron/gpu_preference.cjs lever 3). In THIS orchestrator that would be fatal:
// the parent electron exits immediately, the 'exit' handler below tears down Vite, and the
// detached child is left running against a dead dev server. So the dev spawn pre-applies
// the exact configuration the relaunch would have produced (env additions + marker + the
// explicit ozone flag), which both suppresses the relaunch and gives Linux dev runs the
// discrete-GPU offload for real. Same-machine no-ops (non-Linux, non-hybrid, or an env the
// player already configured) fall out of the same predicates main.cjs uses.
function linuxPrimeDevConfig() {
  if (process.platform !== 'linux') return { env: {}, args: [] };
  if (!isLinuxHybridGpu()) return { env: {}, args: [] };
  if (!shouldRelaunchForLinuxPrime(process.env, [])) return { env: {}, args: [] };
  return {
    env: { ...buildLinuxPrimeEnv(process.env), [PRIME_RELAUNCH_MARKER]: '1' },
    args: [LINUX_OZONE_X11_ARG],
  };
}

const viteUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';
const onlineOrigin = process.env.VITE_DESKTOP_API_ORIGIN ?? 'https://worldofclaudecraft.com';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronCommand = process.platform === 'win32' ? 'electron.cmd' : 'electron';

let shuttingDown = false;

const vite = spawn(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1', '--strictPort'], {
  env: {
    ...process.env,
    BROWSER: 'none',
    VITE_DESKTOP_APP: '1',
    VITE_DESKTOP_API_ORIGIN: onlineOrigin,
    VITE_DESKTOP_RELATIVE_API: '1',
  },
  stdio: 'inherit',
});

function stopAll(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!vite.killed) vite.kill();
  process.exit(code);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

vite.on('exit', (code) => {
  if (!shuttingDown) stopAll(code ?? 0);
});

async function waitForVite() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const res = await fetch(viteUrl);
      if (res.ok) return;
    } catch {
      // Keep waiting until Vite accepts connections.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${viteUrl}`);
}

try {
  // The main process requires the electron/vendor bundles (logging, updater)
  // even in dev, and they are gitignored generated output, so rebuild them
  // before launching the shell.
  buildElectronVendor();
  await waitForVite();
  const prime = linuxPrimeDevConfig();
  const electron = spawn(electronCommand, ['.', ...prime.args], {
    env: {
      ...process.env,
      ...prime.env,
      VITE_DEV_SERVER_URL: viteUrl,
      VITE_DESKTOP_API_ORIGIN: onlineOrigin,
      VITE_DESKTOP_LOGIN_ORIGIN: viteUrl,
    },
    stdio: 'inherit',
  });
  electron.on('exit', (code) => stopAll(code ?? 0));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  stopAll(1);
}
