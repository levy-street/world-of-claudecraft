// The heavy-self marking policy's two paths (server/heavy_self.ts, Phase 18):
// every HEAVY_SELF_CMDS member marks EITHER at receipt (the dispatch's
// pre-switch line) OR in its own arm once the frame has reached the sim, never
// both and never neither. These pins hold the partition and the membership
// discipline; the online arms (deny-path-no-dirty, accepted-path-dirty over
// the real dispatch) live in tests/heavy_self_arm_marks_online.test.ts.
import { describe, expect, it } from 'vitest';
import {
  HEAVY_SELF_ARM_MARKED_CMDS,
  HEAVY_SELF_CMDS,
  heavySelfMarkOnAccept,
  heavySelfMarkOnReceipt,
} from '../server/heavy_self';

describe('the arm-marked subset', () => {
  it('is exactly the Perfecting and farming command family', () => {
    expect([...HEAVY_SELF_ARM_MARKED_CMDS].sort()).toEqual(
      [
        'convert_husks',
        'harvest_crop',
        'perfect_item',
        'place_feast',
        'plant_crop',
        'swap_perfecting_ranks',
      ].sort(),
    );
  });

  it('is a strict subset of HEAVY_SELF_CMDS (an arm-marked non-member would mark nothing)', () => {
    for (const cmd of HEAVY_SELF_ARM_MARKED_CMDS) {
      expect(HEAVY_SELF_CMDS.has(cmd), `${cmd} must stay a HEAVY_SELF_CMDS member`).toBe(true);
    }
    expect(HEAVY_SELF_ARM_MARKED_CMDS.size).toBeLessThan(HEAVY_SELF_CMDS.size);
  });

  it('consume_feast is deliberately NOT a member (it never touches heavy state)', () => {
    expect(HEAVY_SELF_CMDS.has('consume_feast')).toBe(false);
    expect(HEAVY_SELF_ARM_MARKED_CMDS.has('consume_feast')).toBe(false);
  });
});

describe('the two predicates partition the membership', () => {
  it('every member marks on exactly one path', () => {
    for (const cmd of HEAVY_SELF_CMDS) {
      const receipt = heavySelfMarkOnReceipt(cmd);
      const accept = heavySelfMarkOnAccept(cmd);
      expect(receipt !== accept, `${cmd} must mark on exactly one path`).toBe(true);
      expect(accept).toBe(HEAVY_SELF_ARM_MARKED_CMDS.has(cmd));
    }
  });

  it('a non-member marks on neither path (the combat commands stay free)', () => {
    for (const cmd of ['cast', 'target', 'attack', 'consume_feast', 'chat', 'not_a_command']) {
      expect(heavySelfMarkOnReceipt(cmd)).toBe(false);
      expect(heavySelfMarkOnAccept(cmd)).toBe(false);
    }
  });

  it('receipt marking is the pre-Phase-18 set minus the arm-marked five', () => {
    const receiptMarked = [...HEAVY_SELF_CMDS].filter(heavySelfMarkOnReceipt);
    expect(receiptMarked).toHaveLength(HEAVY_SELF_CMDS.size - HEAVY_SELF_ARM_MARKED_CMDS.size);
    expect(receiptMarked).toContain('equip');
    expect(receiptMarked).toContain('use');
    expect(receiptMarked).not.toContain('perfect_item');
    expect(receiptMarked).not.toContain('plant_crop');
  });
});
