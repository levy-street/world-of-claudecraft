import { describe, expect, it } from 'vitest';
import { isStunDrCategory, stunDrCategory } from '../src/sim/stun_dr';

describe('stun DR categories (#1004)', () => {
  it('classifies from-stealth openers as openerStun', () => {
    expect(stunDrCategory('cheap_shot')).toBe('openerStun');
    expect(stunDrCategory('pounce')).toBe('openerStun');
  });

  it('classifies deliberate on-demand stuns as controlledStun', () => {
    expect(stunDrCategory('kidney_shot')).toBe('controlledStun');
    expect(stunDrCategory('hammer_of_justice')).toBe('controlledStun');
    expect(stunDrCategory('bash')).toBe('controlledStun');
    expect(stunDrCategory('charge')).toBe('controlledStun');
    expect(stunDrCategory('bear_charge')).toBe('controlledStun');
  });

  it('keeps opener and controlled stuns in independent buckets', () => {
    // The whole point of the split: a rogue opener must not share a bucket with a
    // controlled stun, so Cheap Shot cannot diminish the following Kidney Shot.
    expect(stunDrCategory('cheap_shot')).not.toBe(stunDrCategory('kidney_shot'));
  });

  it('defaults unknown / proc stuns to randomStun', () => {
    expect(stunDrCategory('some_future_proc_stun')).toBe('randomStun');
  });

  it('recognises all three stun buckets as stun DR categories', () => {
    expect(isStunDrCategory('openerStun')).toBe(true);
    expect(isStunDrCategory('controlledStun')).toBe(true);
    expect(isStunDrCategory('randomStun')).toBe(true);
    expect(isStunDrCategory('root')).toBe(false);
    expect(isStunDrCategory('fear')).toBe(false);
  });
});
