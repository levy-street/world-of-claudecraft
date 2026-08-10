// The t()/tOptional/tEntity resolved-string memo (hitch-elimination B3).
//
// Pins the four B3 guarantees at the REAL t() pipeline level:
//   1. A repeated hot call with unchanged inputs performs no split / regex /
//      replacer-closure work at all (String.prototype.split,
//      String.prototype.replace and RegExp.prototype.exec are all spied at
//      zero across hundreds of repeats), for t() with and without params and
//      for tEntity.
//   2. Same key + different params rebuilds the correct distinct output
//      (the memo compares slot VALUES, never the params object identity).
//   3. Locale-switch invalidation: BOTH revision arms (setLanguage and the
//      late ensureLocaleLoaded chunk arrival) drop every memoized string, so
//      the next read re-resolves through the same t() pipeline. Serving a
//      stale cached string after either arm turns this suite red (the memo
//      mutant guard).
//   4. The per-call miss policy stays live across the cached miss: an
//      untracked key throws on EVERY dev call, not just the first.
//
// No referee scenarios, no macro claims: unit-level evidence only.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import { tEntity } from '../src/ui/entity_i18n';
import { en, ensureLocaleLoaded, es, isLocaleResident, setLanguage, t } from '../src/ui/i18n';

afterEach(() => setLanguage('en'));

/** Count split/replace/exec calls performed by `run` (tight window, no expects inside). */
function stringWorkDuring(run: () => void): { splits: number; replaces: number; execs: number } {
  const splitSpy = vi.spyOn(String.prototype, 'split');
  const replaceSpy = vi.spyOn(String.prototype, 'replace');
  const execSpy = vi.spyOn(RegExp.prototype, 'exec');
  try {
    run();
    return {
      splits: splitSpy.mock.calls.length,
      replaces: replaceSpy.mock.calls.length,
      execs: execSpy.mock.calls.length,
    };
  } finally {
    splitSpy.mockRestore();
    replaceSpy.mockRestore();
    execSpy.mockRestore();
  }
}

function leaf(table: unknown, path: readonly string[]): unknown {
  let current: unknown = table;
  for (const part of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const seg = (value: string) => value.replace(/[^A-Za-z0-9_]/g, '_');

describe('t(): repeated hot calls with unchanged inputs do zero string work', () => {
  it('a params-bearing key: no split, no replace, no regex exec after the warm call', () => {
    setLanguage('en');
    // Warm: resolves the leaf, compiles the plan, latches the memo.
    expect(t('worldContent.corpseName', { name: 'Web Weaver' })).toBe('Web Weaver (corpse)');
    let out = '';
    const work = stringWorkDuring(() => {
      // A FRESH params object every call: the memo must hit on shallow slot
      // values, never on object identity (hot callers rebuild params per frame).
      for (let i = 0; i < 200; i++) out = t('worldContent.corpseName', { name: 'Web Weaver' });
    });
    expect(out).toBe('Web Weaver (corpse)');
    expect(work).toEqual({ splits: 0, replaces: 0, execs: 0 });
  });

  it('a no-params key (the per-frame aura duration units): zero string work on repeats', () => {
    setLanguage('en');
    const warm = t('hudChrome.unitFrame.durationUnitSeconds');
    expect(warm).toBe(en.hudChrome.unitFrame.durationUnitSeconds);
    let out = '';
    const work = stringWorkDuring(() => {
      for (let i = 0; i < 200; i++) out = t('hudChrome.unitFrame.durationUnitSeconds');
    });
    expect(out).toBe(warm);
    expect(work).toEqual({ splits: 0, replaces: 0, execs: 0 });
  });
});

describe('t(): params-change correctness (the memo never over-serves)', () => {
  it('same key, different params, different (correct) output, both directions', () => {
    setLanguage('en');
    expect(t('hud.core.riftLabelRanked', { name: 'Rift', rank: 'S' })).toBe('Rift (S)');
    // Change only the SECOND slot: a memo comparing fewer than all slots
    // would serve the stale result here.
    expect(t('hud.core.riftLabelRanked', { name: 'Rift', rank: 'A' })).toBe('Rift (A)');
    expect(t('hud.core.riftLabelRanked', { name: 'Vale', rank: 'A' })).toBe('Vale (A)');
    // Returning to earlier params rebuilds the correct bytes (single-entry memo).
    expect(t('hud.core.riftLabelRanked', { name: 'Rift', rank: 'S' })).toBe('Rift (S)');
  });
});

describe('tEntity: hot repeats do zero string work (key memo + leaf memo)', () => {
  it('a repeated mob-name resolution runs no entityPathSegment regex and no split', () => {
    setLanguage('en');
    const mobId = Object.keys(MOBS)[0];
    expect(mobId).toBeTruthy();
    const warm = tEntity({ kind: 'mob', id: mobId, field: 'name' });
    expect(warm).toBe(leaf(en, ['entities', 'mobs', seg(mobId), 'name']));
    let out = '';
    const work = stringWorkDuring(() => {
      for (let i = 0; i < 200; i++) out = tEntity({ kind: 'mob', id: mobId, field: 'name' });
    });
    expect(out).toBe(warm);
    expect(work).toEqual({ splits: 0, replaces: 0, execs: 0 });
  });
});

describe('locale switch invalidates every memoized string (the memo mutant guard)', () => {
  it('setLanguage AND the late chunk arrival both drop the memo; stale strings never survive', async () => {
    setLanguage('en');
    // Warm the memo under en, params memo included.
    expect(t('nav.play')).toBe(en.nav.play);
    expect(t('worldContent.corpseName', { name: 'Iron Boar' })).toBe('Iron Boar (corpse)');
    // Non-vacuous floor: es genuinely differs from en on both keys, so a stale
    // memo is distinguishable from a correct re-resolve.
    expect(es.nav.play).not.toBe(en.nav.play);
    expect(es.worldContent.corpseName).not.toBe(en.worldContent.corpseName);
    expect(isLocaleResident('es')).toBe(false);

    // Arm 1: setLanguage bumps the revision. The es chunk is NOT resident yet,
    // so the pipeline's synchronous English fallback serves (never a throw).
    setLanguage('es');
    expect(t('nav.play')).toBe(en.nav.play);

    // Arm 2: the late chunk arrival bumps the revision again. If that bump or
    // the memo's epoch compare were broken, the warmed English strings above
    // would be served stale here: red.
    await ensureLocaleLoaded('es');
    expect(t('nav.play')).toBe(es.nav.play);
    expect(t('worldContent.corpseName', { name: 'Iron Boar' })).toBe(
      es.worldContent.corpseName.replace('{name}', 'Iron Boar'),
    );

    // And back: switching to en again must re-resolve English (the es strings
    // just memoized may not survive either).
    setLanguage('en');
    expect(t('nav.play')).toBe(en.nav.play);
    expect(t('worldContent.corpseName', { name: 'Iron Boar' })).toBe('Iron Boar (corpse)');
  });

  it('tEntity re-resolves through the switched locale too', async () => {
    const mobId = Object.keys(MOBS).find((id) => {
      const path = ['entities', 'mobs', seg(id), 'name'];
      const enName = leaf(en, path);
      const esName = leaf(es, path);
      return typeof enName === 'string' && typeof esName === 'string' && enName !== esName;
    });
    // Non-vacuous floor: at least one mob name is genuinely translated.
    expect(mobId).toBeTruthy();
    if (!mobId) return;
    setLanguage('en');
    const enName = tEntity({ kind: 'mob', id: mobId, field: 'name' });
    expect(enName).toBe(leaf(en, ['entities', 'mobs', seg(mobId), 'name']));
    await ensureLocaleLoaded('es');
    setLanguage('es');
    expect(tEntity({ kind: 'mob', id: mobId, field: 'name' })).toBe(
      leaf(es, ['entities', 'mobs', seg(mobId), 'name']),
    );
    setLanguage('en');
    expect(tEntity({ kind: 'mob', id: mobId, field: 'name' })).toBe(enName);
  });
});

describe('the cached miss keeps the per-call policy live', () => {
  it('an untracked key throws on EVERY dev call, not just the first', () => {
    setLanguage('en');
    const tRaw = t as unknown as (key: string) => string;
    expect(() => tRaw('totally.bogus.b3.memo.key')).toThrow(/untracked key/);
    // The second call hits the cached miss and must STILL throw.
    expect(() => tRaw('totally.bogus.b3.memo.key')).toThrow(/untracked key/);
    // A real key beside it still resolves (the miss cache never blankets).
    expect(t('nav.home')).toBe(en.nav.home);
  });
});
