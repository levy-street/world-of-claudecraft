// ClientWorld.characterProfile: the "Player Info" lookup for a chat name that is
// nowhere near your ~120yd interest scope, so there is no local entity to read.
//
// It deliberately reads the EXISTING public character sheet (the same subset the
// crawlable /c/<name> page serves), which is why the request carries no bearer
// token and why the rich in-view inspect card (wallet balance, Discord/GitHub
// identity, worn gear) is NOT part of this shape: those stay on the
// proximity-gated entity wire.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';

const SHEET = {
  name: 'Mira',
  realm: 'Claudemoon',
  class: 'mage',
  classLabel: 'Mage',
  spec: 'Fire',
  level: 34,
  skin: 3,
  zone: 'Thornpeak Heights',
  guild: 'Iron Vanguard',
  // fields the public sheet also carries but the profile shape drops
  arena: [],
  rank: null,
  profileUrl: 'https://example.test/c/Mira',
};

function makeWorld(): any {
  // ClientWorld's constructor takes the connection params; we never open a socket,
  // we only exercise the REST read.
  const w = Object.create(ClientWorld.prototype);
  w.base = 'https://example.test';
  w.token = 'SECRET-BEARER-TOKEN';
  return w;
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe('ClientWorld.characterProfile', () => {
  it('reads the public sheet and maps it onto CharacterProfile', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => SHEET });

    const profile = await makeWorld().characterProfile('Mira');

    expect(profile).toEqual({
      name: 'Mira',
      cls: 'mage',
      classLabel: 'Mage',
      spec: 'Fire',
      level: 34,
      guild: 'Iron Vanguard',
      zone: 'Thornpeak Heights',
      skin: 3,
      realm: 'Claudemoon',
    });
  });

  it('hits the public sheet route, URL-encoding the name', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => SHEET });

    await makeWorld().characterProfile('Mira Vale');

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://example.test/api/public/characters/Mira%20Vale/sheet',
    );
  });

  it('sends NO Authorization header: this is a public read that ignores one', async () => {
    // Re-adding the bearer would leak it to an unauthenticated route for nothing.
    fetchSpy.mockResolvedValue({ ok: true, json: async () => SHEET });

    await makeWorld().characterProfile('Mira');

    const init = fetchSpy.mock.calls[0][1];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.stringify(init ?? {})).not.toContain('SECRET-BEARER-TOKEN');
  });

  it('resolves null on a miss, a malformed body, a network error, and an empty name', async () => {
    const w = makeWorld();

    fetchSpy.mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await w.characterProfile('Ghost')).toBeNull();

    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ nope: 1 }) });
    expect(await w.characterProfile('Ghost')).toBeNull();

    fetchSpy.mockRejectedValue(new Error('offline'));
    expect(await w.characterProfile('Ghost')).toBeNull();

    fetchSpy.mockClear();
    expect(await w.characterProfile('   ')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
