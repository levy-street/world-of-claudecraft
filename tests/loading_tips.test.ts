import { describe, expect, it } from 'vitest';
import { createLoadingTipRotation } from '../src/ui/loading_tips';

describe('loading tip rotation', () => {
  it('current() returns non-empty resolved text at the given start index', () => {
    const rotation = createLoadingTipRotation(0);
    expect(rotation.current().length).toBeGreaterThan(0);
  });

  it('next() advances and wraps around back to the first tip', () => {
    const rotation = createLoadingTipRotation(0);
    const first = rotation.current();
    const seen = new Set([first]);
    let wrapped = false;
    for (let i = 0; i < 20; i++) {
      const tip = rotation.next();
      if (tip === first) {
        wrapped = true;
        break;
      }
      seen.add(tip);
    }
    expect(wrapped).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('normalizes an out-of-range or negative start index into bounds', () => {
    const a = createLoadingTipRotation(-1);
    const b = createLoadingTipRotation(1000);
    expect(a.current().length).toBeGreaterThan(0);
    expect(b.current().length).toBeGreaterThan(0);
  });
});
