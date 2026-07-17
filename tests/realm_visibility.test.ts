import { describe, expect, it } from 'vitest';

import type { RealmEntry } from '../src/net/online';
import { realmIsP2w, visibleRealms } from '../src/net/realm_visibility';

const DIR: RealmEntry[] = [
  { name: 'Claudemoon', url: 'https://claudemoon.example.com', type: 'Normal' },
  {
    name: 'RiverBoat',
    url: 'https://riverboat.example.com',
    type: 'Normal',
    flags: ['web', 'p2w'],
  },
];

describe('visibleRealms', () => {
  it('shows everything to a browser client', () => {
    expect(visibleRealms(DIR, false).map((r) => r.name)).toEqual(['Claudemoon', 'RiverBoat']);
  });
  it('hides web-only realms inside an app shell', () => {
    expect(visibleRealms(DIR, true).map((r) => r.name)).toEqual(['Claudemoon']);
  });
  it('treats a missing flags field as no flags (servers predating the field)', () => {
    expect(visibleRealms([{ name: 'X', url: '', type: 'Normal' }], true)).toHaveLength(1);
  });
});

describe('realmIsP2w', () => {
  it('reads the p2w label off the entry flags', () => {
    expect(realmIsP2w(DIR[0])).toBe(false);
    expect(realmIsP2w(DIR[1])).toBe(true);
    expect(realmIsP2w({ flags: undefined })).toBe(false);
  });
});
