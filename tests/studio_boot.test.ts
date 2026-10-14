import { describe, expect, it } from 'vitest';
import { resolveStudioEntry } from '../src/game/studio_boot';
import { PUBLISHED_MAPS } from '../src/sim/maps/index.generated';

describe('resolveStudioEntry', () => {
  it('is null on the normal flow: no ?map slug', () => {
    expect(resolveStudioEntry(new URLSearchParams(''), false)).toBeNull();
    expect(resolveStudioEntry(new URLSearchParams('?ref=abc'), false)).toBeNull();
  });

  it('falls through for an unknown slug and yields to an editor playtest', () => {
    const slug = PUBLISHED_MAPS[0]?.slug;
    if (!slug) throw new Error('expected a published map in the registry');
    expect(resolveStudioEntry(new URLSearchParams('?map=no_such_map'), false)).toBeNull();
    expect(resolveStudioEntry(new URLSearchParams(`?map=${slug}`), true)).toBeNull();
  });

  it('resolves a published slug to an entry', () => {
    const slug = PUBLISHED_MAPS[0]?.slug;
    if (!slug) throw new Error('expected a published map in the registry');
    expect(resolveStudioEntry(new URLSearchParams(`?map=${slug}`), false)).not.toBeNull();
  });
});
