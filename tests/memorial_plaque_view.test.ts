// The memorial plaque's pure core: name composition and the column split that
// keeps a cut roll reading oldest-first.
import { describe, expect, it } from 'vitest';
import { MEMORIALS } from '../src/sim/content/memorials';
import {
  buildMemorialPlaqueModel,
  composeRollName,
  splitIntoColumns,
} from '../src/ui/hud/memorial/memorial_plaque_view';

describe('memorial plaque view', () => {
  it('composes initials and surname, and tolerates a missing initial', () => {
    expect(composeRollName({ initials: 'J T', surname: 'Hale' })).toBe('J T Hale');
    expect(composeRollName({ initials: 'E', surname: 'Brack' })).toBe('E Brack');
    expect(composeRollName({ initials: '', surname: 'Hale' })).toBe('Hale');
    expect(composeRollName({ initials: '  M J  ', surname: '  Voss ' })).toBe('M J Voss');
  });

  it('reads down each column in turn, so the flattened order is the roll order', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(splitIntoColumns(names, 2)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
    expect(splitIntoColumns(names, 2).flat()).toEqual(names);
  });

  it('gives the extra name to the earlier column on an uneven split', () => {
    expect(splitIntoColumns(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
    // still no name lost or reordered
    expect(splitIntoColumns(['a', 'b', 'c', 'd', 'e'], 3).flat()).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('degrades safely on the edges rather than emitting empty columns', () => {
    expect(splitIntoColumns([], 2)).toEqual([]);
    expect(splitIntoColumns(['a'], 4)).toEqual([['a']]);
    expect(splitIntoColumns(['a', 'b'], 0)).toEqual([['a', 'b']]);
  });

  it('builds the Gullhaven plaque with Hale last and every name accounted for', () => {
    const def = MEMORIALS.find((m) => m.id === 'gullhaven_warden_memorial');
    if (!def) throw new Error('Gullhaven memorial is not registered');
    const model = buildMemorialPlaqueModel(def);
    expect(model.total).toBe(def.roll.length);
    expect(model.columns.flat()).toEqual(model.names);
    expect(model.names[model.names.length - 1]).toBe('J T Hale');
    // the chrome is keyed; the names are not
    expect(model.titleKey).toBe('hudChrome.memorial.title');
    expect(model.rollHeadingKey).toBe('hudChrome.memorial.rollHeading');
  });
});
