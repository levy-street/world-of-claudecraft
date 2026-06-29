// Determinism + faithfulness guard for the pure SimEvent -> FctEvent discrimination
// (fct_event.ts). Pins each of the 8 hud.ts spawn-site paths to the { kind, isSelf,
// crit } triple the old inline literal produced, plus the one null (no-float) case, so the
// extraction is byte-faithful. The mapper is i18n-free / clock-free / IWorld-free (the text
// and target stay at the call site); the UI-purity guard (tests/architecture.test.ts) is the
// registered enforcement, and this is the behavioral line of defense.

import { describe, expect, it } from 'vitest';
import { type FctSpawnShape, fctSpawnShape } from '../src/ui/fct_event';

describe('fctSpawnShape: damage avoidance (miss/dodge/resist)', () => {
  it('miss/dodge/resist always float; isSelf tracks isPlayerTarget; never crit', () => {
    for (const damageKind of ['miss', 'dodge', 'resist'] as const) {
      // player is the target -> isSelf true (the #bbb self colour token)
      expect(
        fctSpawnShape({
          type: 'damage',
          damageKind,
          ability: false,
          crit: false,
          isPlayerSource: false,
          isPlayerTarget: true,
        }),
      ).toEqual<FctSpawnShape>({ kind: damageKind, isSelf: true, crit: false });
      // player is the source (other is the target) -> isSelf false (the #fff other token)
      expect(
        fctSpawnShape({
          type: 'damage',
          damageKind,
          ability: true,
          crit: true,
          isPlayerSource: true,
          isPlayerTarget: false,
        }),
      ).toEqual<FctSpawnShape>({ kind: damageKind, isSelf: false, crit: false });
    }
  });
});

describe('fctSpawnShape: landed hit (damage-done vs damage-taken vs none)', () => {
  it('player dealing to another floats damage-done; ability splits -ability vs -auto', () => {
    expect(
      fctSpawnShape({
        type: 'damage',
        damageKind: 'hit',
        ability: true,
        crit: false,
        isPlayerSource: true,
        isPlayerTarget: false,
      }),
    ).toEqual<FctSpawnShape>({ kind: 'damage-done-ability', isSelf: false, crit: false });
    expect(
      fctSpawnShape({
        type: 'damage',
        damageKind: 'hit',
        ability: false,
        crit: true,
        isPlayerSource: true,
        isPlayerTarget: false,
      }),
    ).toEqual<FctSpawnShape>({ kind: 'damage-done-auto', isSelf: false, crit: true });
  });

  it('player taking a hit floats damage-taken (isSelf, crit passthrough)', () => {
    expect(
      fctSpawnShape({
        type: 'damage',
        damageKind: 'hit',
        ability: true,
        crit: true,
        isPlayerSource: false,
        isPlayerTarget: true,
      }),
    ).toEqual<FctSpawnShape>({ kind: 'damage-taken', isSelf: true, crit: true });
    // a self-inflicted hit (player both source and target) reads as damage-taken, matching
    // the live `if (isPlayerSource && !isPlayerTarget) ... else if (isPlayerTarget)` priority.
    expect(
      fctSpawnShape({
        type: 'damage',
        damageKind: 'hit',
        ability: false,
        crit: false,
        isPlayerSource: true,
        isPlayerTarget: true,
      }),
    ).toEqual<FctSpawnShape>({ kind: 'damage-taken', isSelf: true, crit: false });
  });

  it('a hit between two non-player entities floats nothing (null)', () => {
    expect(
      fctSpawnShape({
        type: 'damage',
        damageKind: 'hit',
        ability: true,
        crit: true,
        isPlayerSource: false,
        isPlayerTarget: false,
      }),
    ).toBeNull();
  });
});

describe('fctSpawnShape: heal / xp / rested-xp / self-note', () => {
  it('heal isSelf tracks isPlayerTarget and passes crit through', () => {
    expect(
      fctSpawnShape({ type: 'heal', crit: false, isPlayerTarget: true }),
    ).toEqual<FctSpawnShape>({ kind: 'heal', isSelf: true, crit: false });
    expect(
      fctSpawnShape({ type: 'heal', crit: true, isPlayerTarget: false }),
    ).toEqual<FctSpawnShape>({ kind: 'heal', isSelf: false, crit: true });
  });

  it('xp / rested-xp / self-note are always self, never crit', () => {
    expect(fctSpawnShape({ type: 'xp' })).toEqual<FctSpawnShape>({
      kind: 'xp',
      isSelf: true,
      crit: false,
    });
    expect(fctSpawnShape({ type: 'rested-xp' })).toEqual<FctSpawnShape>({
      kind: 'rested-xp',
      isSelf: true,
      crit: false,
    });
    expect(fctSpawnShape({ type: 'self-note' })).toEqual<FctSpawnShape>({
      kind: 'self-note',
      isSelf: true,
      crit: false,
    });
  });
});

describe('fctSpawnShape: determinism (same input -> same output)', () => {
  it('returns an equal shape for the same input', () => {
    const src = {
      type: 'damage',
      damageKind: 'hit',
      ability: true,
      crit: true,
      isPlayerSource: true,
      isPlayerTarget: false,
    } as const;
    expect(fctSpawnShape(src)).toEqual(fctSpawnShape(src));
  });
});
