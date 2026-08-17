import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Text pins for the 'desktop-gpu-status' push. electron/*.cjs live outside tsc
// and outside every runnable suite (they need a real Electron main process), so
// the placement contracts below can only be held by reading the sources. Kept
// out of tests/electron_shell_startup.test.ts so that heavily pinned suite is
// untouched by GPU-flow work.
const repoRoot = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

const main = read('electron/main.cjs');
const preload = read('electron/preload.cjs');

// The whole GPU flow lives in one top-level function; every placement pin below
// is bounded to its body so a match elsewhere in main.cjs cannot satisfy one.
const gpuFlowBody = (): string => {
  const start = main.indexOf('function logGpuStatus()');
  expect(start, 'logGpuStatus is gone from electron/main.cjs').toBeGreaterThan(-1);
  const end = main.indexOf('\n}', start);
  expect(end, 'could not find the end of logGpuStatus').toBeGreaterThan(start);
  return main.slice(start, end);
};

describe('the GPU verdict push to the renderer', () => {
  it('re-fires after a crash-recovery reload: did-finish-load binds with .on, never .once', () => {
    // A .once would leave a reloaded page with no verdict at all, and a GPU-process
    // crash plus auto-reload is exactly when the adapter flips to software.
    const bindings = [...main.matchAll(/webContents\.(on|once)\('did-finish-load', (\w+)\)/g)];
    expect(bindings.length, 'no did-finish-load binding found in main.cjs').toBe(1);
    expect(bindings[0][1]).toBe('on');
    expect(bindings[0][2]).toBe('logGpuStatus');
    expect(main).not.toContain("webContents.once('did-finish-load'");
  });

  it('sends the verdict BEFORE the log dedup early-return', () => {
    // The dedup exists only to keep main.log quiet, and after a reload the reading
    // is usually byte-identical: a send placed after it would never reach the new
    // page. This ordering IS the contract, so pin it directly.
    const body = gpuFlowBody();
    const sendAt = body.indexOf("webContents.send('desktop-gpu-status'");
    const dedupAt = body.indexOf('=== lastGpuRendererLog');
    expect(sendAt, 'logGpuStatus does not push desktop-gpu-status').toBeGreaterThan(-1);
    expect(dedupAt, 'the lastGpuRendererLog dedup guard is gone').toBeGreaterThan(-1);
    expect(sendAt).toBeLessThan(dedupAt);
    // And the early-return is still what follows the comparison (the reason the
    // ordering matters at all).
    expect(body.slice(dedupAt, dedupAt + 40)).toContain('return');
  });

  it('builds the payload through the gpu_status_events reducer, not an inline literal', () => {
    expect(main).toContain("require('./gpu_status_events.cjs')");
    expect(main).toContain('gpuStatusPayload');
    const body = gpuFlowBody();
    const sendAt = body.indexOf("webContents.send('desktop-gpu-status'");
    expect(sendAt).toBeGreaterThan(-1);
    // The send's payload argument must be a bare identifier (the regex refuses an
    // inline object literal), and that identifier must come from the reducer.
    const send = /webContents\.send\('desktop-gpu-status', (\w+)\)/.exec(body);
    expect(send, 'the desktop-gpu-status send does not pass a prebuilt payload').not.toBeNull();
    const arg = (send as RegExpExecArray)[1];
    expect(body).toContain(`const ${arg} = gpuStatusPayload(`);
  });

  it('guards the async send on a live window', () => {
    // getGPUInfo resolves on a later tick; the window can be gone by then. Pin
    // the whole guarded statement with its polarity (the phase 3 QA audit
    // showed the old nearby-strings pin passed with the guard inverted or the
    // send hoisted out), and pin the send count so a second, unguarded send
    // cannot ride in beside the guarded one.
    const body = gpuFlowBody();
    expect(body.replace(/\s+/g, ' ')).toContain(
      "if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('desktop-gpu-status', gpuStatus); }",
    );
    expect([...body.matchAll(/webContents\.send\('desktop-gpu-status'/g)].length).toBe(1);
  });

  it('the preload subscription shape-checks every payload field and can unsubscribe', () => {
    const start = preload.indexOf('onGpuStatus: (callback)');
    expect(start, 'preload is missing the onGpuStatus bridge method').toBeGreaterThan(-1);
    const end = preload.indexOf('\n  },', start);
    expect(end).toBeGreaterThan(start);
    const body = preload.slice(start, end);
    expect(body).toContain("typeof callback !== 'function'");
    expect(body).toContain("typeof payload.softwareRendering === 'boolean'");
    expect(body).toContain("typeof payload.discreteInactive === 'boolean'");
    expect(body).toContain("typeof payload.adapter === 'string'");
    expect(body).toContain("ipcRenderer.on('desktop-gpu-status', listener)");
    expect(body).toContain("ipcRenderer.removeListener('desktop-gpu-status', listener)");
    // Push-only: a renderer must never be able to pull this verdict on demand.
    expect(preload).not.toContain("ipcRenderer.invoke('desktop-gpu-status'");
    expect(main).not.toContain("ipcMain.handle('desktop-gpu-status'");
  });
});
