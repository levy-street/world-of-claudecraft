import { describe, expect, it } from 'vitest';
import { lowResourceView, LOW_RESOURCE_THRESHOLD } from '../src/ui/low_resource';

describe('lowResourceView', () => {
  it('is inactive for rage (rage builds in combat — low is normal)', () => {
    expect(lowResourceView({ resource: 0, maxResource: 100, resourceType: 'rage' }).active).toBe(false);
  });

  it('is inactive with no resource type or a degenerate max', () => {
    expect(lowResourceView({ resource: 0, maxResource: 0, resourceType: 'mana' }).active).toBe(false);
    expect(lowResourceView({ resource: 5, maxResource: 100, resourceType: null }).active).toBe(false);
  });

  it('is inactive when above the threshold', () => {
    const v = lowResourceView({ resource: 30, maxResource: 100, resourceType: 'mana' });
    expect(v.active).toBe(false);
    expect(v.opacity).toBe(0);
  });

  it('activates just below the threshold for mana', () => {
    const v = lowResourceView({ resource: LOW_RESOURCE_THRESHOLD * 100 - 1, maxResource: 100, resourceType: 'mana' });
    expect(v.active).toBe(true);
    expect(v.label).toBe('Low Mana');
    expect(v.opacity).toBeGreaterThan(0);
  });

  it('labels energy distinctly', () => {
    const v = lowResourceView({ resource: 10, maxResource: 100, resourceType: 'energy' });
    expect(v.active).toBe(true);
    expect(v.label).toBe('Low Energy');
  });

  it('intensifies (more opaque, faster pulse) toward empty', () => {
    const justLow = lowResourceView({ resource: 24, maxResource: 100, resourceType: 'mana' });
    const nearEmpty = lowResourceView({ resource: 1, maxResource: 100, resourceType: 'mana' });
    expect(nearEmpty.opacity).toBeGreaterThan(justLow.opacity);
    expect(nearEmpty.pulseSeconds).toBeLessThan(justLow.pulseSeconds);
  });

  it('clamps opacity within [0,1]', () => {
    const v = lowResourceView({ resource: 0, maxResource: 100, resourceType: 'mana' });
    expect(v.opacity).toBeGreaterThan(0);
    expect(v.opacity).toBeLessThanOrEqual(1);
  });
});
