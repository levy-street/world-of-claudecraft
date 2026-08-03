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

  it('summons the reins of the first owned mount when unmounted', () => {
    expect(mobileMountAction('', ['valorsteed'])).toEqual({
      kind: 'summon',
      itemId: 'reins_valorsteed',
    });
  });

  it('picks the first entry in catalog order when several mounts are owned, never a later one', () => {
    const owned: MountKey[] = ['grag_bear', 'valorsteed'];
    expect(mobileMountAction('', owned)).toEqual({
      kind: 'summon',
      itemId: 'reins_grag_bear',
    });
  });

  it('falls back to the shared toggle when nothing is owned (preserves the existing no-op / toast)', () => {
    expect(mobileMountAction('', [])).toEqual({ kind: 'fallback' });
  });
});
