// Determinism + faithfulness guard for the pure SimEvent -> FctEvent discrimination
// (fct_event.ts). Pins each hud.ts spawn-site path to the { kind, isSelf,
// crit } triple the old inline literal produced, plus the null (no-float) cases, so the
// extraction is byte-faithful. The mapper is i18n-free / clock-free / IWorld-free (the text
// and target stay at the call site); the UI-purity guard (tests/architecture.test.ts) is the
// registered enforcement, and this is the behavioral line of defense. The absorb arm carries
// BOTH sides of the swing (issue: an absorbed hit gave the attacker no feedback at all), so
// its call-site half (the amount gate and the anchor entity, which stay in hud.ts) is pinned
// at the bottom of this file.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type FctSpawnShape, fctSpawnShape } from '../src/ui/fct_event';

const hudTs = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);

describe('fctSpawnShape: damage avoidance (miss/dodge/resist/evade)', () => {
  it('miss/dodge/resist/evade always float; isSelf tracks isPlayerTarget; never crit', () => {
    for (const damageKind of ['miss', 'dodge', 'resist', 'evade'] as const) {
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

  it('an owned guardian hit floats as player damage', () => {
    expect(
      fctSpawnShape({
        type: 'damage',
        damageKind: 'hit',
        ability: true,
        crit: false,
        isPlayerSource: false,
        isPlayerTarget: false,
        isPlayerOwnedSource: true,
      } as Parameters<typeof fctSpawnShape>[0]),
    ).toEqual<FctSpawnShape>({
      kind: 'damage-done-ability',
      isSelf: false,
      crit: false,
    });
  });
});

describe('fctSpawnShape: shield block (a landed hit, distinct from a plain hit)', () => {
  it('player dealing a hit that gets blocked floats damage-done-block, not damage-done-ability/auto', () => {
    expect(
      fctSpawnShape({
        type: 'damage',
        damageKind: 'block',
        ability: true,
        crit: false,
        isPlayerSource: true,
        isPlayerTarget: false,
      }),
    ).toEqual<FctSpawnShape>({ kind: 'damage-done-block', isSelf: false, crit: false });
    // Even an auto-attack block stays 'damage-done-block' (never splits -ability vs -auto
    // the way a plain hit does; the block distinction takes priority).
    expect(
      fctSpawnShape({
        type: 'damage',
        damageKind: 'block',
        ability: false,
        crit: true,
        isPlayerSource: true,
        isPlayerTarget: false,
      }),
    ).toEqual<FctSpawnShape>({ kind: 'damage-done-block', isSelf: false, crit: true });
  });

  it('player taking a blocked hit floats damage-taken-block, not damage-taken', () => {
    expect(
      fctSpawnShape({
        type: 'damage',
        damageKind: 'block',
        ability: false,
        crit: true,
        isPlayerSource: false,
        isPlayerTarget: true,
      }),
    ).toEqual<FctSpawnShape>({ kind: 'damage-taken-block', isSelf: true, crit: true });
    // A self-inflicted block (player both source and target) reads as damage-taken-block,
    // matching the plain-hit priority (isPlayerTarget wins over isPlayerSource).
    expect(
      fctSpawnShape({
        type: 'damage',
        damageKind: 'block',
        ability: true,
        crit: false,
        isPlayerSource: true,
        isPlayerTarget: true,
      }),
    ).toEqual<FctSpawnShape>({ kind: 'damage-taken-block', isSelf: true, crit: false });
  });

  it('a block between two non-player entities floats nothing (null)', () => {
    expect(
      fctSpawnShape({
        type: 'damage',
        damageKind: 'block',
        ability: false,
        crit: false,
        isPlayerSource: false,
        isPlayerTarget: false,
      }),
    ).toBeNull();
  });
});

describe('fctSpawnShape: absorb (defender side and attacker side)', () => {
  it('a shield of yours soaking a hit floats over you (isSelf true)', () => {
    expect(
      fctSpawnShape({ type: 'absorb', isPlayerSource: false, isPlayerTarget: true }),
    ).toEqual<FctSpawnShape>({ kind: 'absorb', isSelf: true, crit: false });
  });

  it('your hit soaked by the target shield floats over the target (isSelf false)', () => {
    // The attacker-side arm: without it, attacking a shielded target gives no feedback
    // at all, so the hits read as doing nothing. isSelf false because the local player
    // is NOT the entity the floater is anchored on.
    expect(
      fctSpawnShape({ type: 'absorb', isPlayerSource: true, isPlayerTarget: false }),
    ).toEqual<FctSpawnShape>({ kind: 'absorb', isSelf: false, crit: false });
  });

  it('a self-inflicted absorbed hit stays the defender-side floater (one shape, isSelf true)', () => {
    // Same priority as the landed-hit arm: isPlayerTarget wins over isPlayerSource, so a
    // player both source and target reads as the self floater rather than two of them.
    expect(
      fctSpawnShape({ type: 'absorb', isPlayerSource: true, isPlayerTarget: true }),
    ).toEqual<FctSpawnShape>({ kind: 'absorb', isSelf: true, crit: false });
  });

  it('an absorbed hit between two other entities floats nothing (null)', () => {
    expect(
      fctSpawnShape({ type: 'absorb', isPlayerSource: false, isPlayerTarget: false }),
    ).toBeNull();
  });

  it('absorb never crits on either side', () => {
    for (const roles of [
      { isPlayerSource: true, isPlayerTarget: false },
      { isPlayerSource: false, isPlayerTarget: true },
    ] as const) {
      expect(fctSpawnShape({ type: 'absorb', ...roles })?.crit).toBe(false);
    }
  });
});

describe('fctSpawnShape: heal / xp / rested-xp / honor / self-note', () => {
  it('heal isSelf tracks isPlayerTarget and passes crit through', () => {
    expect(
      fctSpawnShape({ type: 'heal', crit: false, isPlayerTarget: true }),
    ).toEqual<FctSpawnShape>({ kind: 'heal', isSelf: true, crit: false });
    expect(
      fctSpawnShape({ type: 'heal', crit: true, isPlayerTarget: false }),
    ).toEqual<FctSpawnShape>({ kind: 'heal', isSelf: false, crit: true });
  });

  it('xp / rested-xp / honor / self-note are always self, never crit', () => {
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
    expect(fctSpawnShape({ type: 'honor' })).toEqual<FctSpawnShape>({
      kind: 'honor',
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

describe('absorb floater call site (hud.ts damage arm)', () => {
  // The mapper owns the ROLE split, but the amount gate and the anchor entity stay at the
  // call site, so the negative arm (a hit nothing absorbed floats no absorb text) and the
  // over-the-target anchoring are only pinnable here. One site, so an attacker-side copy
  // of the block would fail rather than silently double-float.
  // Resolved per test (not once in the describe body) so a moved gate fails ONE assertion
  // with a readable message instead of throwing at collection and reporting no tests at all.
  const absorbSite = (): string => {
    const start = hudTs.indexOf('if ((ev.absorbed ?? 0) > 0) {');
    // The old attacker-blind gate. Its removal IS the fix, so name it in the failure.
    expect({
      gateFound: start > -1,
      oldTargetOnlyGate: hudTs.includes('if (isPlayerTarget && (ev.absorbed ?? 0) > 0)'),
    }).toEqual({ gateFound: true, oldTargetOnlyGate: false });
    return hudTs.slice(start, start + 700);
  };

  it('spawns the absorb floater from exactly one site', () => {
    expect(hudTs.match(/fctSpawnShape\(\{ type: 'absorb'/g)).toHaveLength(1);
  });

  it('gates the floater on a non-zero absorbed amount, not on the player being the target', () => {
    expect(absorbSite()).toContain("const absorbShape = fctSpawnShape({ type: 'absorb'");
  });

  it('hands both role flags to the mapper so the attacker side resolves', () => {
    expect(absorbSite()).toContain("{ type: 'absorb', isPlayerSource, isPlayerTarget }");
  });

  it('anchors the floater on the damaged entity and reuses the existing absorbed key', () => {
    const site = absorbSite();
    expect(site).toContain("text: t('hudChrome.fct.absorbed'");
    expect(site).toContain('target: tgt,');
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

describe('a fully absorbed hit floats no number', () => {
  // The bare "0" is the misleading half of the pair: beside "Absorbed (240)" it
  // reads as a broken attack rather than a soaked one. Heals already guard on
  // amount > 0; damage never got the same guard.
  const hit = (over = {}) =>
    fctSpawnShape({
      type: 'damage',
      damageKind: 'hit',
      ability: false,
      crit: false,
      isPlayerSource: true,
      isPlayerTarget: false,
      ...over,
    });

  it('suppresses the number on both sides when the shield ate all of it', () => {
    expect(hit({ fullyAbsorbed: true })).toBeNull();
    expect(hit({ fullyAbsorbed: true, isPlayerSource: false, isPlayerTarget: true })).toBeNull();
  });

  it('still floats the number when damage got through', () => {
    // The negative that makes the case above decisive: a partial absorb is a real
    // hit and must keep reporting what landed.
    expect(hit({ fullyAbsorbed: false })).not.toBeNull();
    expect(hit()).not.toBeNull();
  });

  it('leaves the avoidance words alone', () => {
    // Miss/dodge/parry carry no amount, so they can never be fully absorbed and
    // must not be caught by the new guard.
    for (const kind of ['miss', 'dodge', 'parry', 'resist', 'evade'] as const) {
      expect(hit({ damageKind: kind })).not.toBeNull();
    }
  });
});
