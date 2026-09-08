import { describe, expect, it } from 'vitest';
import {
  isLivingWarriorAttentionSource,
  warriorAttentionCel,
  warriorAttentionSource,
} from '../src/render/ability_vfx/warrior_attention_core';

// ---------------------------------------------------------------------------
// isLivingWarriorAttentionSource
// ---------------------------------------------------------------------------

describe('isLivingWarriorAttentionSource', () => {
  it('accepts a living warrior player with positive HP', () => {
    expect(
      isLivingWarriorAttentionSource({ id: 1, kind: 'player', templateId: 'warrior', hp: 100 }),
    ).toBe(true);
  });

  it('accepts entity id 0 (zero is a valid entity id)', () => {
    expect(
      isLivingWarriorAttentionSource({ id: 0, kind: 'player', templateId: 'warrior', hp: 0.001 }),
    ).toBe(true);
  });

  it('accepts explicit dead: false', () => {
    expect(
      isLivingWarriorAttentionSource({
        id: 1,
        kind: 'player',
        templateId: 'warrior',
        hp: 50,
        dead: false,
      }),
    ).toBe(true);
  });

  it('rejects undefined', () => {
    expect(isLivingWarriorAttentionSource(undefined)).toBe(false);
  });

  it('rejects wrong kind: mob', () => {
    expect(
      isLivingWarriorAttentionSource({ id: 1, kind: 'mob', templateId: 'warrior', hp: 100 }),
    ).toBe(false);
  });

  it('rejects wrong kind: npc', () => {
    expect(
      isLivingWarriorAttentionSource({ id: 1, kind: 'npc', templateId: 'warrior', hp: 100 }),
    ).toBe(false);
  });

  it('rejects missing kind', () => {
    expect(isLivingWarriorAttentionSource({ id: 1, templateId: 'warrior', hp: 100 })).toBe(false);
  });

  it('rejects wrong class: paladin', () => {
    expect(
      isLivingWarriorAttentionSource({ id: 1, kind: 'player', templateId: 'paladin', hp: 100 }),
    ).toBe(false);
  });

  it('rejects wrong class: mage', () => {
    expect(
      isLivingWarriorAttentionSource({ id: 1, kind: 'player', templateId: 'mage', hp: 100 }),
    ).toBe(false);
  });

  it('rejects missing templateId', () => {
    expect(isLivingWarriorAttentionSource({ id: 1, kind: 'player', hp: 100 })).toBe(false);
  });

  it('rejects dead: true', () => {
    expect(
      isLivingWarriorAttentionSource({
        id: 1,
        kind: 'player',
        templateId: 'warrior',
        hp: 100,
        dead: true,
      }),
    ).toBe(false);
  });

  it('rejects NaN HP', () => {
    expect(
      isLivingWarriorAttentionSource({ id: 1, kind: 'player', templateId: 'warrior', hp: NaN }),
    ).toBe(false);
  });

  it('rejects Infinity HP', () => {
    expect(
      isLivingWarriorAttentionSource({
        id: 1,
        kind: 'player',
        templateId: 'warrior',
        hp: Infinity,
      }),
    ).toBe(false);
  });

  it('rejects zero HP', () => {
    expect(
      isLivingWarriorAttentionSource({ id: 1, kind: 'player', templateId: 'warrior', hp: 0 }),
    ).toBe(false);
  });

  it('rejects negative HP', () => {
    expect(
      isLivingWarriorAttentionSource({ id: 1, kind: 'player', templateId: 'warrior', hp: -1 }),
    ).toBe(false);
  });

  it('rejects missing HP (undefined is not finite)', () => {
    expect(isLivingWarriorAttentionSource({ id: 1, kind: 'player', templateId: 'warrior' })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// warriorAttentionSource
// ---------------------------------------------------------------------------

describe('warriorAttentionSource', () => {
  // A well-formed mob with a valid forced-target binding.
  const base = { id: 5, kind: 'mob', hp: 100, forcedTargetTimer: 3, forcedTargetId: 1 };

  it('returns the forced target id for a valid living mob', () => {
    expect(warriorAttentionSource(base)).toBe(1);
  });

  it('returns 0 when forcedTargetId is 0 (zero entity id is a valid target)', () => {
    expect(warriorAttentionSource({ ...base, forcedTargetId: 0 })).toBe(0);
  });

  it('self-reference (forcedTargetId === id) returns null', () => {
    expect(warriorAttentionSource({ ...base, forcedTargetId: 5 })).toBeNull();
  });

  it('self-reference when id is 0 returns null', () => {
    expect(
      warriorAttentionSource({
        id: 0,
        kind: 'mob',
        hp: 50,
        forcedTargetTimer: 1,
        forcedTargetId: 0,
      }),
    ).toBeNull();
  });

  it('null forcedTargetId returns null', () => {
    expect(warriorAttentionSource({ ...base, forcedTargetId: null })).toBeNull();
  });

  it('undefined forcedTargetId returns null', () => {
    expect(warriorAttentionSource({ ...base, forcedTargetId: undefined })).toBeNull();
  });

  it('fractional forcedTargetId returns null', () => {
    expect(warriorAttentionSource({ ...base, forcedTargetId: 1.5 })).toBeNull();
  });

  it('Infinity forcedTargetId returns null', () => {
    expect(warriorAttentionSource({ ...base, forcedTargetId: Infinity })).toBeNull();
  });

  it('NaN forcedTargetId returns null', () => {
    expect(warriorAttentionSource({ ...base, forcedTargetId: NaN })).toBeNull();
  });

  it('negative forcedTargetId returns null', () => {
    expect(warriorAttentionSource({ ...base, forcedTargetId: -1 })).toBeNull();
  });

  it('zero forcedTargetTimer returns null', () => {
    expect(warriorAttentionSource({ ...base, forcedTargetTimer: 0 })).toBeNull();
  });

  it('negative forcedTargetTimer returns null', () => {
    expect(warriorAttentionSource({ ...base, forcedTargetTimer: -1 })).toBeNull();
  });

  it('NaN forcedTargetTimer returns null', () => {
    expect(warriorAttentionSource({ ...base, forcedTargetTimer: NaN })).toBeNull();
  });

  it('Infinity forcedTargetTimer returns null (not finite)', () => {
    expect(warriorAttentionSource({ ...base, forcedTargetTimer: Infinity })).toBeNull();
  });

  it('ordinary aggro alone (no forcedTargetId or forcedTargetTimer) returns null', () => {
    expect(warriorAttentionSource({ id: 5, kind: 'mob', hp: 100 })).toBeNull();
  });

  it('dead mob returns null', () => {
    expect(warriorAttentionSource({ ...base, dead: true })).toBeNull();
  });

  it('zero HP returns null', () => {
    expect(warriorAttentionSource({ ...base, hp: 0 })).toBeNull();
  });

  it('negative HP returns null', () => {
    expect(warriorAttentionSource({ ...base, hp: -1 })).toBeNull();
  });

  it('NaN HP returns null', () => {
    expect(warriorAttentionSource({ ...base, hp: NaN })).toBeNull();
  });

  it('Infinity HP returns null (not finite)', () => {
    expect(warriorAttentionSource({ ...base, hp: Infinity })).toBeNull();
  });

  it('player kind returns null (source must be a mob)', () => {
    expect(warriorAttentionSource({ ...base, kind: 'player' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// warriorAttentionCel
// ---------------------------------------------------------------------------

// The authored cels cover elapsed time [0, 3s]:
//   elapsed < 0.1  => cel 0   (start)
//   elapsed < 0.2  => cel 1   (tightening)
//   else           => cel 2   (held)
// elapsed = max(0, 3 - remaining)
// reduced short-circuits to cel 2 at any remaining value.

describe('warriorAttentionCel', () => {
  describe('reduced = true always returns cel 2', () => {
    it('cel 2 at full remaining', () => {
      expect(warriorAttentionCel(3, true)).toBe(2);
    });
    it('cel 2 at mid remaining', () => {
      expect(warriorAttentionCel(1.5, true)).toBe(2);
    });
    it('cel 2 at zero remaining', () => {
      expect(warriorAttentionCel(0, true)).toBe(2);
    });
    it('cel 2 at negative remaining', () => {
      expect(warriorAttentionCel(-5, true)).toBe(2);
    });
  });

  describe('reduced = false, cel boundaries', () => {
    it('returns cel 0 at exact remaining 3 (elapsed = 0)', () => {
      expect(warriorAttentionCel(3, false)).toBe(0);
    });

    it('returns cel 0 when remaining exceeds 3 (elapsed clamped to 0)', () => {
      expect(warriorAttentionCel(4, false)).toBe(0);
      expect(warriorAttentionCel(10, false)).toBe(0);
    });

    it('returns cel 0 just inside the first window (elapsed ≈ 0.05, remaining ≈ 2.95)', () => {
      expect(warriorAttentionCel(2.95, false)).toBe(0);
    });

    // Exercise both the exact transition and its adjacent interval.
    it('returns cel 1 near the 2.9 boundary (elapsed in [0.1, 0.2), sensible values)', () => {
      expect(warriorAttentionCel(2.89, false)).toBe(1); // 3 - 2.89 ≈ 0.11
      expect(warriorAttentionCel(2.85, false)).toBe(1); // 3 - 2.85 ≈ 0.15
      expect(warriorAttentionCel(2.81, false)).toBe(1); // 3 - 2.81 ≈ 0.19
    });

    it('returns cel 1 at the exact 2.9 boundary (elapsed should = 0.1)', () => {
      expect(warriorAttentionCel(2.9, false)).toBe(1);
    });

    it('returns cel 2 at remaining 2.8 (elapsed should be >= 0.2)', () => {
      expect(warriorAttentionCel(2.8, false)).toBe(2);
    });

    it('returns cel 2 well below 2.8', () => {
      expect(warriorAttentionCel(2.79, false)).toBe(2);
      expect(warriorAttentionCel(2.5, false)).toBe(2);
      expect(warriorAttentionCel(1, false)).toBe(2);
      expect(warriorAttentionCel(0, false)).toBe(2);
    });

    it('returns cel 2 for negative remaining (elapsed = max(0, 3 - negative) > 3)', () => {
      expect(warriorAttentionCel(-1, false)).toBe(2);
    });
  });

  describe('late observation stays at final cel', () => {
    it('cel 2 holds for all remaining values at or below 2.8', () => {
      for (const r of [2.79, 2.5, 2, 1.5, 0.5, 0, -1]) {
        expect(warriorAttentionCel(r, false)).toBe(2);
      }
    });
  });
});
