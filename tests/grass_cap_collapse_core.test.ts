import { describe, expect, it } from 'vitest';
import {
  grassCapCollapseBand,
  grassCapCollapseShaderPatch,
} from '../src/render/grass_cap_collapse_core';

describe('grass cap collapse band', () => {
  it('disables collapse when no blade carpet exists', () => {
    expect(grassCapCollapseBand(0)).toBeNull();
    expect(grassCapCollapseBand(-1)).toBeNull();
    expect(grassCapCollapseBand(Number.NaN)).toBeNull();
  });

  it('keeps the authored band at the standard 34-yard carpet radius', () => {
    expect(grassCapCollapseBand(34)).toEqual({ start: 22, end: 30 });
  });

  it('scales both band edges with a dial-trimmed carpet radius', () => {
    const band = grassCapCollapseBand(24);
    expect(band?.start).toBeCloseTo((22 * 24) / 34);
    expect(band?.end).toBeCloseTo((30 * 24) / 34);
    expect(grassCapCollapseShaderPatch(band)).toContain(
      'smoothstep(15.529, 21.176, distance(tuftBase, uPlayerPos))',
    );
    expect(grassCapCollapseShaderPatch(band)).toContain('transformed *= mix(1.0, capKeep, aCap);');
  });

  it('emits no cap-collapse shader when the blade carpet is absent', () => {
    expect(grassCapCollapseShaderPatch(null)).toBe('');
  });
});
