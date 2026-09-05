// The Realm Builder of the Month page's host-agnostic helpers
// (src/admin/realm_builders.ts), plus the two agreements the page depends on
// but cannot state itself:
//
//   1. its length/range limits match server/realm_builder_db.ts, so the save
//      button never enables on something the server will refuse; and
//   2. every key validateRealmBuilderEntry can return is a real admin catalog
//      key, so a rejected draft never renders a raw dotted string at an
//      operator.

import { describe, expect, it } from 'vitest';
import {
  REALM_BUILDER_MAX_NAME_LENGTH as DB_MAX_NAME,
  REALM_BUILDER_MAX_NOTE_LENGTH as DB_MAX_NOTE,
  REALM_BUILDER_MAX_YEAR as DB_MAX_YEAR,
  REALM_BUILDER_MIN_YEAR as DB_MIN_YEAR,
} from '../server/realm_builder_db';
import { DICT, setAdminLanguage } from '../src/admin/i18n';
import {
  describeRealmBuilderMonth,
  nextRealmBuilderMonth,
  REALM_BUILDER_MAX_NAME_LENGTH,
  REALM_BUILDER_MAX_NOTE_LENGTH,
  REALM_BUILDER_MAX_YEAR,
  REALM_BUILDER_MIN_YEAR,
  validateRealmBuilderEntry,
} from '../src/admin/realm_builders';

const ok = { year: 2026, month: 9, name: 'Wren Ashdown', note: 'rebuilt the harbour' };

describe('limits stay in step with the server', () => {
  it('mirrors realm_builder_db exactly', () => {
    // The dashboard is allowed to restate these (it caps the inputs with
    // maxlength), but it is not allowed to disagree with them: a wider client
    // limit turns a clear disabled button into a confusing 400.
    expect(REALM_BUILDER_MAX_NAME_LENGTH).toBe(DB_MAX_NAME);
    expect(REALM_BUILDER_MAX_NOTE_LENGTH).toBe(DB_MAX_NOTE);
    expect(REALM_BUILDER_MIN_YEAR).toBe(DB_MIN_YEAR);
    expect(REALM_BUILDER_MAX_YEAR).toBe(DB_MAX_YEAR);
  });
});

describe('validateRealmBuilderEntry', () => {
  it('passes a well-formed draft', () => {
    expect(validateRealmBuilderEntry(ok)).toBeNull();
  });

  it('accepts an empty note: a name alone is a complete award', () => {
    expect(validateRealmBuilderEntry({ ...ok, note: '' })).toBeNull();
  });

  it('names what is wrong, one thing at a time', () => {
    expect(validateRealmBuilderEntry({ ...ok, year: 1999 })).toBe('realmBuilders.errorYear');
    expect(validateRealmBuilderEntry({ ...ok, year: 2026.5 })).toBe('realmBuilders.errorYear');
    expect(validateRealmBuilderEntry({ ...ok, month: 0 })).toBe('realmBuilders.errorMonth');
    expect(validateRealmBuilderEntry({ ...ok, month: 13 })).toBe('realmBuilders.errorMonth');
    expect(validateRealmBuilderEntry({ ...ok, name: '   ' })).toBe('realmBuilders.errorNameEmpty');
    expect(validateRealmBuilderEntry({ ...ok, name: 'x'.repeat(65) })).toBe(
      'realmBuilders.errorNameLong',
    );
    expect(validateRealmBuilderEntry({ ...ok, note: 'y'.repeat(281) })).toBe(
      'realmBuilders.errorNoteLong',
    );
  });

  it('measures a trimmed name, so trailing spaces do not eat the budget', () => {
    // The page posts name.trim(), and so does the server: judging the untrimmed
    // string would reject a name that saves fine.
    const name = `  ${'x'.repeat(REALM_BUILDER_MAX_NAME_LENGTH)}  `;
    expect(validateRealmBuilderEntry({ ...ok, name })).toBeNull();
  });

  it('only ever returns keys the admin catalog can render', () => {
    const keys = [
      { ...ok, year: 1999 },
      { ...ok, month: 13 },
      { ...ok, name: '' },
      { ...ok, name: 'x'.repeat(400) },
      { ...ok, note: 'y'.repeat(400) },
    ].map((draft) => validateRealmBuilderEntry(draft));
    expect(keys).not.toContain(null);
    for (const key of keys) expect(DICT.en[key as string]).toBeTypeOf('string');
  });
});

describe('describeRealmBuilderMonth', () => {
  it('writes the month in the operator language', () => {
    setAdminLanguage('en');
    expect(describeRealmBuilderMonth(2026, 8)).toBe('August 2026');
    setAdminLanguage('es');
    expect(describeRealmBuilderMonth(2026, 8).toLowerCase()).toContain('agosto');
    setAdminLanguage('en');
  });

  it('does not slide a month backwards west of the meridian', () => {
    // Built in UTC on purpose: a local-midnight Date for January would render
    // as December for an operator in Los Angeles.
    setAdminLanguage('en');
    expect(describeRealmBuilderMonth(2026, 1)).toBe('January 2026');
    expect(describeRealmBuilderMonth(2026, 12)).toBe('December 2026');
  });
});

describe('nextRealmBuilderMonth', () => {
  it('steps past the newest entry', () => {
    expect(nextRealmBuilderMonth({ year: 2026, month: 8 })).toEqual({ year: 2026, month: 9 });
  });

  it('rolls December into the next January', () => {
    expect(nextRealmBuilderMonth({ year: 2026, month: 12 })).toEqual({ year: 2027, month: 1 });
  });

  it('starts an empty roll at today, not at the epoch', () => {
    // The first award is being made now; nobody backfills an empty roll.
    const now = new Date(Date.UTC(2026, 8, 20));
    expect(nextRealmBuilderMonth(null, now)).toEqual({ year: 2026, month: 9 });
  });
});
