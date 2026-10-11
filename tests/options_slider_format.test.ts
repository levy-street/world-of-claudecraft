import { describe, expect, it } from 'vitest';
import { sliderFormatter } from '../src/ui/options_slider_format';

describe('options_slider_format', () => {
  it('keeps the existing readouts', () => {
    expect(sliderFormatter('percent')(0.35)).toBe('35%');
    expect(sliderFormatter('degrees')(74.6)).toBe('75°');
    expect(sliderFormatter('oneDecimal')(1.26)).toBe('1.3');
  });

  it('reads the Action Cam shoulder as side plus strength, or Center', () => {
    const f = sliderFormatter('shoulder');
    expect(f(-1)).toBe('Left 100%');
    expect(f(0.6)).toBe('Right 60%');
    expect(f(0)).toBe('Center');
  });
});
