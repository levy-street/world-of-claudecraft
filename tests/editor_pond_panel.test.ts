// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { pondPanel } from '../src/editor/pond_panel';

describe('pond settings', () => {
  it('accepts typed size and depth, clamps extremes, and ignores invalid input', () => {
    const setPondRadius = vi.fn();
    const setPondDepth = vi.fn();
    const panel = pondPanel({
      getPondRadius: () => 8,
      getPondDepth: () => 2,
      setPondRadius,
      setPondDepth,
    });
    const radius = panel.querySelector<HTMLInputElement>(
      'input[type="text"][aria-label="Pond radius"]',
    );
    const depth = panel.querySelector<HTMLInputElement>(
      'input[type="text"][aria-label="Pond depth"]',
    );
    if (!radius || !depth) throw new Error('Missing pond controls');
    radius.value = '12,5';
    radius.dispatchEvent(new Event('blur'));
    expect(setPondRadius).toHaveBeenLastCalledWith(12.5);
    depth.value = '100';
    depth.dispatchEvent(new Event('blur'));
    expect(setPondDepth).toHaveBeenLastCalledWith(8);
    depth.value = 'invalid';
    depth.dispatchEvent(new Event('blur'));
    expect(setPondDepth).toHaveBeenCalledTimes(1);
    expect(depth.value).toBe('8');
  });
});
