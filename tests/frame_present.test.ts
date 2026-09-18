import { describe, expect, it } from 'vitest';
import { type FramePresentHost, presentFrame } from '../src/render/frame_present';

// Fake draw surfaces that record the call order: the contract is not only WHICH
// calls happen but that the vfx prep runs before the composer submits, and that
// a skipped frame issues no GL work at all.

function makeHost(options: { withPost: boolean }) {
  const calls: string[] = [];
  const screenFxDts: number[] = [];
  const host = {
    calls,
    gpuTimer: null as FramePresentHost['gpuTimer'],
    screenFxDts,
    scene: { tag: 'scene' },
    camera: { tag: 'camera' },
    prepareDrawCameras: [] as unknown[],
    webglArgs: [] as unknown[][],
    vfx: {
      prepareDraw(camera: unknown): void {
        calls.push('prepareDraw');
        host.prepareDrawCameras.push(camera);
      },
    },
    post: options.withPost
      ? {
          updateScreenFx(dt: number): void {
            calls.push('updateScreenFx');
            screenFxDts.push(dt);
          },
          render(): void {
            calls.push('post.render');
          },
        }
      : null,
    webgl: {
      render(scene: unknown, camera: unknown): void {
        calls.push('webgl.render');
        host.webglArgs.push([scene, camera]);
      },
    },
  };
  return host;
}

describe('presentFrame', () => {
  it('draws through the composer in order when one exists', () => {
    const host = makeHost({ withPost: true });
    expect(presentFrame(host, 0.016, true)).toBe(true);
    expect(host.calls).toEqual(['prepareDraw', 'updateScreenFx', 'post.render']);
    expect(host.prepareDrawCameras).toEqual([host.camera]);
    expect(host.screenFxDts).toEqual([0.016]);
    // The composer owns the submit: a direct renderer draw here would double it.
    expect(host.webglArgs).toEqual([]);
  });

  it('draws straight through the renderer when there is no composer', () => {
    const host = makeHost({ withPost: false });
    expect(presentFrame(host, 0.033, true)).toBe(true);
    expect(host.calls).toEqual(['prepareDraw', 'webgl.render']);
    expect(host.webglArgs).toEqual([[host.scene, host.camera]]);
  });

  it('issues no GL work when the frame is skipped, but still ages the screen fx', () => {
    const host = makeHost({ withPost: true });
    expect(presentFrame(host, 0.016, false)).toBe(false);
    // updateScreenFx only decays CPU-side state (ripple ages, the flash), so it
    // keeps running: freezing it leaves a stale flash to pop on the next show.
    expect(host.calls).toEqual(['updateScreenFx']);
    expect(host.screenFxDts).toEqual([0.016]);
    expect(host.prepareDrawCameras).toEqual([]);
    expect(host.webglArgs).toEqual([]);
  });

  it('issues nothing at all on a skipped frame with no composer', () => {
    const host = makeHost({ withPost: false });
    expect(presentFrame(host, 0.016, false)).toBe(false);
    expect(host.calls).toEqual([]);
    expect(host.webglArgs).toEqual([]);
  });

  it('resumes drawing the frame after a skip', () => {
    const host = makeHost({ withPost: true });
    presentFrame(host, 0.016, false);
    expect(presentFrame(host, 0.016, true)).toBe(true);
    expect(host.calls).toEqual(['updateScreenFx', 'prepareDraw', 'updateScreenFx', 'post.render']);
  });
});

describe('presentFrame: the GPU timer probe', () => {
  function withTimer(host: ReturnType<typeof makeHost>) {
    return Object.assign(host, {
      gpuTimer: {
        beginFrame: () => host.calls.push('beginFrame'),
        beginScene: (name?: string) => host.calls.push(`beginScene ${name ?? ''}`.trim()),
        begin: (name: string) => host.calls.push(`begin ${name}`),
        end: () => host.calls.push('end'),
        endFrame: () => host.calls.push('endFrame'),
      },
    });
  }

  it('brackets the direct draw as a scene submit and seals the frame after it', () => {
    const host = withTimer(makeHost({ withPost: false }));
    expect(presentFrame(host, 0.016, true)).toBe(true);
    expect(host.calls).toEqual([
      'prepareDraw',
      'beginFrame',
      'beginScene',
      'webgl.render',
      'end',
      'endFrame',
    ]);
  });

  it('arms the probe around the composer submit and leaves the passes to it', () => {
    const host = withTimer(makeHost({ withPost: true }));
    expect(presentFrame(host, 0.016, true)).toBe(true);
    expect(host.calls).toEqual([
      'prepareDraw',
      'beginFrame',
      'updateScreenFx',
      'post.render',
      'endFrame',
    ]);
  });

  it('seals the frame when the composer submit throws', () => {
    const host = withTimer(makeHost({ withPost: true }));
    const failure = new Error('post submit failed');
    host.post!.render = (): void => {
      host.calls.push('post.render');
      throw failure;
    };

    expect(() => presentFrame(host, 0.016, true)).toThrow(failure);
    expect(host.calls).toEqual([
      'prepareDraw',
      'beginFrame',
      'updateScreenFx',
      'post.render',
      'endFrame',
    ]);
  });

  it('closes the direct scene bracket and seals the frame when the renderer throws', () => {
    const host = withTimer(makeHost({ withPost: false }));
    const failure = new Error('direct render failed');
    host.webgl.render = (scene: unknown, camera: unknown): void => {
      host.calls.push('webgl.render');
      host.webglArgs.push([scene, camera]);
      throw failure;
    };

    expect(() => presentFrame(host, 0.016, true)).toThrow(failure);
    expect(host.calls).toEqual([
      'prepareDraw',
      'beginFrame',
      'beginScene',
      'webgl.render',
      'end',
      'endFrame',
    ]);
  });

  it('still polls the readback on a skipped frame, with no bracket opened', () => {
    const host = withTimer(makeHost({ withPost: true }));
    expect(presentFrame(host, 0.016, false)).toBe(false);
    expect(host.calls).toEqual(['updateScreenFx', 'endFrame']);
  });

  it('draws exactly as before when no probe is attached', () => {
    const host = makeHost({ withPost: false });
    host.gpuTimer = null;
    expect(presentFrame(host, 0.016, true)).toBe(true);
    expect(host.calls).toEqual(['prepareDraw', 'webgl.render']);
  });
});
