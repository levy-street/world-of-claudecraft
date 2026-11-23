// Which textures the renderer holds resident on its live context
// (src/render/texture_residency_ledger.ts, lifted out of renderer.ts): a
// synchronous upload records at once, a paced one when its last chunk lands,
// and a context restore forgets both, including an upload whose chunks
// straddled the loss.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createBackgroundGpuQueue, GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { TextureResidencyLedger } from '../src/render/texture_residency_ledger';

function ledgerWith(idle: () => Promise<void> = async () => {}) {
  const initTexture = vi.fn();
  const queue = createBackgroundGpuQueue();
  const run = vi.spyOn(queue, 'run');
  const ledger = new TextureResidencyLedger({
    webgl: () => ({ initTexture }) as unknown as THREE.WebGLRenderer,
    queue,
    idleSlot: idle,
  });
  return { ledger, initTexture, run };
}

describe('TextureResidencyLedger', () => {
  it('records a synchronous upload and a paced one, each through its own path', async () => {
    const { ledger, initTexture, run } = ledgerWith();
    const sync = new THREE.Texture();
    ledger.prewarm(sync);
    expect(initTexture).toHaveBeenCalledWith(sync);
    expect(ledger.has(sync)).toBe(true);
    const paced = new THREE.Texture();
    const task = ledger.prewarmInIdle(paced, GPU_WORK_PRIORITY.BOOT_RESUME);
    // One in flight per texture: a second ask joins it.
    expect(ledger.prewarmInIdle(paced)).toBe(task);
    expect(ledger.inFlight.get(paced)).toBe(task);
    await task;
    expect(ledger.has(paced)).toBe(true);
    expect(run).toHaveBeenCalledWith(
      expect.any(Function),
      GPU_WORK_PRIORITY.BOOT_RESUME,
      'texture-chunk-upload',
    );
    expect(ledger.tasks.size).toBe(0);
    // Resident: nothing to do the second time.
    run.mockClear();
    await ledger.prewarmInIdle(paced);
    expect(run).not.toHaveBeenCalled();
  });

  it('a context restore forgets every texture, and an upload that straddled it is not recorded', async () => {
    let releaseIdle!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseIdle = resolve;
    });
    const { ledger } = ledgerWith(() => gate);
    const sync = new THREE.Texture();
    ledger.prewarm(sync);
    const straddling = new THREE.Texture();
    const task = ledger.prewarmInIdle(straddling);
    ledger.forgetContext();
    expect(ledger.has(sync)).toBe(false);
    releaseIdle();
    await task;
    expect(ledger.has(straddling)).toBe(false);
    // A fresh upload after the restore records again.
    await ledger.prewarmInIdle(straddling);
    expect(ledger.has(straddling)).toBe(true);
  });
});
