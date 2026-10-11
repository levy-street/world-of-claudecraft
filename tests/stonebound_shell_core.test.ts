import { describe, expect, it } from 'vitest';
import {
  STONEBOUND_SHARD_TINT,
  STONEBOUND_SHELL_TINT,
  stoneboundShellStyle,
} from '../src/render/characters/stonebound_shell_core';

describe('stoneboundShellStyle', () => {
  it('keeps the wireframe stone shell whenever an antialiasing pass runs', () => {
    for (const aa of [
      { smaa: true, fxaa: false, msaaSamples: 0 },
      { smaa: false, fxaa: true, msaaSamples: 0 },
      { smaa: false, fxaa: false, msaaSamples: 4 },
    ]) {
      const style = stoneboundShellStyle(aa);
      expect(style.wireframe).toBe(true);
      expect(style.shellOpacity).toBe(0.72);
      expect(style.shardOpacity).toBe(0.82);
    }
  });

  it('swaps to a solid translucent sheath when the frame has no antialiasing at all', () => {
    // Low tier and the memory-constrained WebKit profiles: a one-pixel GPU
    // wireframe over the dense weapon mesh crawls and aliases with no AA.
    const style = stoneboundShellStyle({ smaa: false, fxaa: false, msaaSamples: 0 });
    expect(style.wireframe).toBe(false);
    // Solid must stay see-through so the weapon silhouette remains readable.
    expect(style.shellOpacity).toBeGreaterThan(0);
    expect(style.shellOpacity).toBeLessThan(0.72);
    expect(style.shardOpacity).toBeGreaterThan(0);
    expect(style.shardOpacity).toBeLessThan(0.82);
  });

  it('never changes the tint: the aa arm only decides the line style and its opacity', () => {
    expect(STONEBOUND_SHELL_TINT).toBe(0x9a9384);
    expect(STONEBOUND_SHARD_TINT).toBe(0x777065);
  });
});
