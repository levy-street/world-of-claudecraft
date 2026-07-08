import { describe, expect, it } from 'vitest';
import { adaptiveSelfAlphaLead, SELF_LEAD_DEFAULT } from '../src/game/self_alpha_lead';

describe('adaptiveSelfAlphaLead', () => {
  it('falls back to the legacy constant before the first echo sample', () => {
    expect(adaptiveSelfAlphaLead(0, 0, 50)).toBe(SELF_LEAD_DEFAULT);
    expect(adaptiveSelfAlphaLead(-5, 0, 50)).toBe(SELF_LEAD_DEFAULT);
  });

  it('reproduces the old tuning at a typical echo (50ms echo, low jitter, 50ms interval)', () => {
    // 0.5*50 + 15 - 4 = 36ms -> 0.72 of an interval, near the legacy 0.65
    expect(adaptiveSelfAlphaLead(50, 4, 50)).toBeCloseTo(0.72, 6);
  });

  it('gives more lead at higher ping, capped at 0.9', () => {
    const low = adaptiveSelfAlphaLead(40, 0, 50);
    const high = adaptiveSelfAlphaLead(120, 0, 50);
    expect(high).toBeGreaterThan(low);
    expect(adaptiveSelfAlphaLead(400, 0, 50)).toBe(0.9);
  });

  it('never drops below the floor when jitter swamps the echo', () => {
    // 0.5*10 + 15 - 40 = -20ms would be a negative lead; clamps to the floor
    expect(adaptiveSelfAlphaLead(10, 40, 50)).toBe(0.25);
  });

  it('jitter monotonically reduces the lead (unstable link backs off)', () => {
    const calm = adaptiveSelfAlphaLead(80, 0, 50);
    const shaky = adaptiveSelfAlphaLead(80, 20, 50);
    const stormy = adaptiveSelfAlphaLead(80, 40, 50);
    expect(shaky).toBeLessThan(calm);
    expect(stormy).toBeLessThanOrEqual(shaky);
  });

  it('floors the snapshot interval at 20ms (matches the renderer alpha floor)', () => {
    expect(adaptiveSelfAlphaLead(50, 0, 5)).toBe(adaptiveSelfAlphaLead(50, 0, 20));
  });
});
