import { describe, expect, it } from 'vitest';
import type { MountKey } from '../src/sim/content/mounts';
import { mobileMountAction } from '../src/ui/mount_quick_summon';

describe('mobileMountAction (mobile Mount/Dismount quick-access button)', () => {
  it('dismounts when already riding, regardless of what is owned', () => {
    expect(mobileMountAction('valorsteed', [])).toEqual({ kind: 'dismount' });
    expect(mobileMountAction('grag_bear', ['stormfeather_griffin', 'grag_bear'])).toEqual({
      kind: 'dismount',
    });
  });

  it('uses the trained mount toggle without selecting a bagged cosmetic', () => {
    expect(mobileMountAction('', ['valorsteed'])).toEqual({
      kind: 'fallback',
    });
  });

  it('preserves the selected cosmetic when several reins are bagged', () => {
    const owned: MountKey[] = ['grag_bear', 'valorsteed'];
    expect(mobileMountAction('', owned)).toEqual({
      kind: 'fallback',
    });
  });

  it('falls back to the shared toggle when nothing is owned (preserves the existing no-op / toast)', () => {
    expect(mobileMountAction('', [])).toEqual({ kind: 'fallback' });
  });
});
