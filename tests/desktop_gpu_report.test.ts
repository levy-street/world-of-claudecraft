// The game reports its WebGL renderer string to the desktop shell
// (src/game/desktop_gpu_report.ts): the shell's Vulkan trial is judged on it.

import { describe, expect, it } from 'vitest';
import { reportDesktopGpuRenderer } from '../src/game/desktop_gpu_report';
import type { DesktopBridge } from '../src/runtime';

const VULKAN =
  'ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA NVIDIA GeForce RTX 3090 (0x00002204)), NVIDIA)';

function bridge(onReport?: (renderer: string) => void) {
  const reported: [string, boolean | undefined][] = [];
  return {
    reported,
    bridge: {
      reportGpuRenderer: (renderer: string, parallelCompile?: boolean) => {
        reported.push([renderer, parallelCompile]);
        onReport?.(renderer);
      },
    } as unknown as DesktopBridge,
  };
}

describe('reportDesktopGpuRenderer', () => {
  it('hands the shell the renderer string the page context reports, with the extension flag', () => {
    const { bridge: b, reported } = bridge();
    expect(
      reportDesktopGpuRenderer(
        b,
        () => VULKAN,
        () => true,
      ),
    ).toBe(true);
    expect(
      reportDesktopGpuRenderer(
        b,
        () => VULKAN,
        () => false,
      ),
    ).toBe(true);
    // No context to probe: the string alone, the shell keeps its rung.
    expect(
      reportDesktopGpuRenderer(
        b,
        () => VULKAN,
        () => undefined,
      ),
    ).toBe(true);
    expect(reported).toEqual([
      [VULKAN, true],
      [VULKAN, false],
      [VULKAN, undefined],
    ]);
  });

  it('reports nothing without the method, without a string, or when the read throws', () => {
    expect(reportDesktopGpuRenderer(null, () => VULKAN)).toBe(false);
    expect(reportDesktopGpuRenderer({} as DesktopBridge, () => VULKAN)).toBe(false);
    const { bridge: b, reported } = bridge();
    expect(
      reportDesktopGpuRenderer(
        b,
        () => undefined,
        () => true,
      ),
    ).toBe(false);
    expect(
      reportDesktopGpuRenderer(
        b,
        () => '',
        () => true,
      ),
    ).toBe(false);
    expect(
      reportDesktopGpuRenderer(
        b,
        () => {
          throw new Error('no context');
        },
        () => true,
      ),
    ).toBe(false);
    expect(reported).toEqual([]);
  });

  it('swallows a throwing channel', () => {
    const { bridge: b } = bridge(() => {
      throw new Error('channel closed');
    });
    expect(
      reportDesktopGpuRenderer(
        b,
        () => VULKAN,
        () => true,
      ),
    ).toBe(false);
  });
});
