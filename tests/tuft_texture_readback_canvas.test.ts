import { afterEach, describe, expect, it, vi } from 'vitest';
import { flowerTuftTexture, grassTuftTexture } from '../src/render/textures';

// The tuft painters read their canvas back once for the mip bleed. On a
// GPU-backed canvas that readback waits for the GPU: measured at 84 ms of the
// grass tuft's paint in the Fire and Fly arena prebuild, 114 to 181 ms for the
// whole warm unit. A CPU-backed canvas (willReadFrequently) reads back without
// that wait.
function stubCanvas(): { options: unknown[] } {
  const seen: { options: unknown[] } = { options: [] };
  const noop = (): void => {};
  const context = new Proxy(
    {
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      }),
    } as Record<string | symbol, unknown>,
    {
      get: (target, key) => (key in target ? target[key] : noop),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: (_kind: string, options?: unknown) => {
        seen.options.push(options);
        return context;
      },
    }),
  });
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tuft texture painters read back from a CPU-backed canvas', () => {
  it('the grass tuft asks for willReadFrequently', () => {
    const seen = stubCanvas();
    grassTuftTexture(30).dispose();
    expect(seen.options).toEqual([{ willReadFrequently: true }]);
  });

  it('the flower tuft asks for willReadFrequently', () => {
    const seen = stubCanvas();
    flowerTuftTexture().dispose();
    expect(seen.options).toEqual([{ willReadFrequently: true }]);
  });
});
