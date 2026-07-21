import { describe, expect, it } from 'vitest';
import { lowHealthVignette, LOW_HEALTH_THRESHOLD } from '../src/ui/low_health';

describe('low-health vignette', () => {
  it('is hidden at full / comfortable HP', () => {
    expect(lowHealthVignette(100, 100).active).toBe(false);
    expect(lowHealthVignette(50, 100).active).toBe(false);
  });

  it('is hidden exactly at the threshold and active just below it', () => {
    const max = 100;
    expect(lowHealthVignette(LOW_HEALTH_THRESHOLD * max, max).active).toBe(false);
    expect(lowHealthVignette(LOW_HEALTH_THRESHOLD * max - 1, max).active).toBe(true);
  });

  it('intensifies (more opaque, faster pulse) as HP drops', () => {
    const high = lowHealthVignette(30, 100); // ~14% into the band
    const low = lowHealthVignette(5, 100); // near death
    expect(high.active).toBe(true);
    expect(low.active).toBe(true);
    expect(low.opacity).toBeGreaterThan(high.opacity);
    expect(low.pulseSeconds).toBeLessThan(high.pulseSeconds); // shorter = faster
  });

  it('keeps opacity in a readable range (never fully opaque)', () => {
    expect(lowHealthVignette(1, 100).opacity).toBeLessThan(1);
    expect(lowHealthVignette(1, 100).opacity).toBeGreaterThan(0);
  });

  it('shows nothing when dead or HP/maxHp are degenerate', () => {
    expect(lowHealthVignette(0, 100).active).toBe(false);
    expect(lowHealthVignette(-5, 100).active).toBe(false);
    expect(lowHealthVignette(10, 0).active).toBe(false);
  });
});
