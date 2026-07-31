import { describe, expect, it, vi } from 'vitest';
import { CharacterPreview } from '../src/render/characters/preview';

type CaptureRequest = Parameters<CharacterPreview['captureCloseup']>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function captureHarness() {
  const preview = Object.create(CharacterPreview.prototype) as CharacterPreview;
  const first = deferred<HTMLCanvasElement>();
  const second = deferred<HTMLCanvasElement>();
  const captureCloseupNow = vi
    .fn<(opts?: CaptureRequest) => Promise<HTMLCanvasElement>>()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  Object.assign(preview, { captureQueue: Promise.resolve(), captureCloseupNow });
  return { preview, captureCloseupNow, first, second };
}

describe('CharacterPreview player-card capture queue', () => {
  it('serializes target readbacks so rapid pose clicks cannot overwrite pixels', async () => {
    const test = captureHarness();
    const hero = test.preview.captureCloseup({ poseClips: ['Hero'], poseFraction: 0.5 });
    const battle = test.preview.captureCloseup({ poseClips: ['Battle'], poseFraction: 0.4 });

    await Promise.resolve();
    expect(test.captureCloseupNow).toHaveBeenCalledTimes(1);
    expect(test.captureCloseupNow).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ poseClips: ['Hero'] }),
    );

    const heroCanvas = {} as HTMLCanvasElement;
    test.first.resolve(heroCanvas);
    await expect(hero).resolves.toBe(heroCanvas);
    await Promise.resolve();
    expect(test.captureCloseupNow).toHaveBeenCalledTimes(2);
    expect(test.captureCloseupNow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ poseClips: ['Battle'] }),
    );

    const battleCanvas = {} as HTMLCanvasElement;
    test.second.resolve(battleCanvas);
    await expect(battle).resolves.toBe(battleCanvas);
  });

  it('continues the queue after a failed readback', async () => {
    const test = captureHarness();
    const failed = test.preview.captureCloseup({ poseClips: ['Hero'] });
    const next = test.preview.captureCloseup({ poseClips: ['Victory'] });

    await Promise.resolve();
    test.first.reject(new Error('context lost'));
    await expect(failed).rejects.toThrow('context lost');
    await Promise.resolve();
    expect(test.captureCloseupNow).toHaveBeenCalledTimes(2);

    const canvas = {} as HTMLCanvasElement;
    test.second.resolve(canvas);
    await expect(next).resolves.toBe(canvas);
  });
});
