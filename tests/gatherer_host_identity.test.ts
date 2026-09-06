// The BROWSER host's offline gatherer-identity allocator
// (src/game/gatherer_identity.ts): what it mints, what it refuses, and the two
// things it deliberately does NOT touch.
//
// The properties asserted here are the reason the module has the shape it does:
//   * every call mints INDEPENDENTLY, so two allocations can never collide
//     however they interleave. There is no counter, namespace or stored value
//     between them to read stale, race, or restart from a corrupt read.
//   * it reads NO storage, so a private-mode browser whose storage getter throws
//     still gets a real identity instead of losing attribution for nothing.
//   * no randomness means NULL. There is no `Math.random` or clock fallback,
//     because a unique-LOOKING id that collides is worse than no attribution.
//   * what it hands the sim is exactly what the sim's own shared validator
//     accepts: a bounded, printable-ASCII local identity.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  allocateOfflineGathererIdentity,
  type GathererIdentityRandomSource,
} from '../src/game/gatherer_identity';
import { readLocalGathererIdentity } from '../src/sim/material_gatherer';
import { MAX_GATHERER_ID_LENGTH } from '../src/sim/material_sources';

/** `off:` plus a canonical lowercase UUID: the one shape both mint paths emit. */
const OFFLINE_ID_SHAPE = /^off:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ID_PREFIX = 'off:';

/** 32 hex characters in canonical UUID grouping. */
function uuidFromHex(hex: string): string {
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** A deterministic `randomUUID`: call n answers the UUID encoding of n, so a
 *  repeated id would be a reproducible failure rather than a rare one. */
function countingUuidSource(): GathererIdentityRandomSource {
  let calls = 0;
  return {
    randomUUID: () => {
      calls += 1;
      return uuidFromHex(calls.toString(16).padStart(32, '0'));
    },
  };
}

/** A deterministic `getRandomValues`, filling the caller's buffer the way the
 *  Web Crypto contract does; each call fills a different byte run. */
function countingByteSource(): GathererIdentityRandomSource {
  let calls = 0;
  return {
    getRandomValues: (array: Uint8Array) => {
      calls += 1;
      for (let i = 0; i < array.length; i++) array[i] = (calls * 17 + i) & 0xff;
      return array;
    },
  };
}

/** Install a global for one test, restoring whatever was there (including
 *  nothing) afterwards. */
const installed: { key: string; descriptor: PropertyDescriptor | undefined }[] = [];

function installGlobal(key: string, descriptor: PropertyDescriptor): void {
  installed.push({ key, descriptor: Object.getOwnPropertyDescriptor(globalThis, key) });
  Object.defineProperty(globalThis, key, { configurable: true, ...descriptor });
}

afterEach(() => {
  while (installed.length > 0) {
    const entry = installed.pop();
    if (!entry) break;
    if (entry.descriptor) Object.defineProperty(globalThis, entry.key, entry.descriptor);
    else delete (globalThis as unknown as Record<string, unknown>)[entry.key];
  }
  vi.restoreAllMocks();
});

describe('allocateOfflineGathererIdentity: one fresh id per offline character', () => {
  it('mints a DISTINCT id on every call, with no allocator state between them', () => {
    const source = countingUuidSource();
    const ids = [
      allocateOfflineGathererIdentity(source),
      allocateOfflineGathererIdentity(source),
      allocateOfflineGathererIdentity(source),
    ].map((identity) => identity?.id);

    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual([
      'off:00000000-0000-0000-0000-000000000001',
      'off:00000000-0000-0000-0000-000000000002',
      'off:00000000-0000-0000-0000-000000000003',
    ]);
  });

  it('mints distinctly through the byte fallback, stamping v4 version and variant bits', () => {
    const source = countingByteSource();
    const first = allocateOfflineGathererIdentity(source);
    const second = allocateOfflineGathererIdentity(source);

    expect(first?.id).toMatch(OFFLINE_ID_SHAPE);
    expect(second?.id).toMatch(OFFLINE_ID_SHAPE);
    expect(first?.id).not.toBe(second?.id);
    // Positions 14 and 19 of the UUID itself are the version and variant nibbles.
    const uuid = (first?.id ?? '').slice(ID_PREFIX.length);
    expect(uuid[14]).toBe('4');
    expect('89ab').toContain(uuid[19]);
  });

  it('takes NO character input, so an id cannot be derived from name, class or seed', () => {
    // The randomness source is the only parameter and it is optional. There is
    // nothing here to derive from, which is the whole anti-collision argument:
    // two same-named characters of one class in one world get different ids.
    expect(allocateOfflineGathererIdentity.length).toBe(0);
    const source = countingUuidSource();
    const first = allocateOfflineGathererIdentity(source);
    const second = allocateOfflineGathererIdentity(source);
    expect(first?.id).not.toBe(second?.id);
  });

  it('uses the HOST crypto when the caller passes nothing', () => {
    installGlobal('crypto', { value: countingUuidSource() });
    expect(allocateOfflineGathererIdentity()).toEqual({
      kind: 'offline',
      id: 'off:00000000-0000-0000-0000-000000000001',
    });
  });
});

describe('what the offline allocator refuses to do', () => {
  it('still mints when every storage getter THROWS, because it reads no storage', () => {
    // The private-mode / blocked-cookie browser. Storage is irrelevant to this
    // module now, so losing attribution here would be a pure regression.
    const boom = () => {
      throw new Error('storage is blocked');
    };
    installGlobal('localStorage', { get: boom });
    installGlobal('sessionStorage', { get: boom });
    installGlobal('indexedDB', { get: boom });

    expect(allocateOfflineGathererIdentity(countingUuidSource())).toEqual({
      kind: 'offline',
      id: 'off:00000000-0000-0000-0000-000000000001',
    });
  });

  it('answers NULL when there is no usable randomness, never a guessed id', () => {
    expect(allocateOfflineGathererIdentity(null)).toBeNull();
    // A crypto object exposing neither call, and one whose members are not
    // callable, are both "no randomness".
    expect(allocateOfflineGathererIdentity({})).toBeNull();
    const notCallable = {
      randomUUID: 'nope',
      getRandomValues: 7,
    } as unknown as GathererIdentityRandomSource;
    expect(allocateOfflineGathererIdentity(notCallable)).toBeNull();
  });

  it('answers NULL when the host exposes no crypto global at all', () => {
    installGlobal('crypto', { value: undefined });
    expect(allocateOfflineGathererIdentity()).toBeNull();
  });

  it('falls back to no id rather than to Math.random or the clock', () => {
    const random = vi.spyOn(Math, 'random');
    const now = vi.spyOn(Date, 'now');

    expect(allocateOfflineGathererIdentity({})).toBeNull();
    expect(allocateOfflineGathererIdentity(countingUuidSource())).not.toBeNull();

    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it('distrusts a randomUUID that answers a non-UUID, using the byte path instead', () => {
    const bytes = countingByteSource();
    const liar: GathererIdentityRandomSource = {
      randomUUID: () => 'not-a-uuid',
      getRandomValues: bytes.getRandomValues,
    };
    expect(allocateOfflineGathererIdentity(liar)?.id).toMatch(OFFLINE_ID_SHAPE);

    // With no usable byte path behind it, the bad answer is simply refused.
    expect(allocateOfflineGathererIdentity({ randomUUID: () => 'not-a-uuid' })).toBeNull();
  });

  it('uses the byte fallback when the UUID capability throws', () => {
    const bytes = countingByteSource();
    expect(
      allocateOfflineGathererIdentity({
        randomUUID: () => {
          throw new Error('UUID unavailable');
        },
        getRandomValues: bytes.getRandomValues,
      })?.id,
    ).toMatch(OFFLINE_ID_SHAPE);
  });

  it('allows offline play without attribution when both crypto capabilities throw', () => {
    const unavailable = () => {
      throw new Error('crypto unavailable');
    };
    expect(
      allocateOfflineGathererIdentity({
        randomUUID: unavailable,
        getRandomValues: unavailable,
      }),
    ).toBeNull();
    installGlobal('crypto', { get: unavailable });
    expect(allocateOfflineGathererIdentity()).toBeNull();
  });

  it('refuses a byte source that answers the wrong thing', () => {
    const shortBuffer: GathererIdentityRandomSource = {
      getRandomValues: () => new Uint8Array(4),
    };
    const notBytes = {
      getRandomValues: () => 'bytes',
    } as unknown as GathererIdentityRandomSource;

    expect(allocateOfflineGathererIdentity(shortBuffer)).toBeNull();
    expect(allocateOfflineGathererIdentity(notBytes)).toBeNull();
  });
});

describe('the minted id is exactly what the sim accepts', () => {
  it('is a typed local identity inside the sim descriptor bound', () => {
    for (const source of [countingUuidSource(), countingByteSource()]) {
      const identity = allocateOfflineGathererIdentity(source);
      expect(identity?.kind).toBe('offline');
      const id = identity?.id ?? '';
      expect(id.length).toBeGreaterThan(0);
      expect(id.length).toBeLessThanOrEqual(MAX_GATHERER_ID_LENGTH);
      // Printable ASCII, per character, not by regex class alone.
      for (let i = 0; i < id.length; i++) {
        const code = id.charCodeAt(i);
        expect(code).toBeGreaterThanOrEqual(32);
        expect(code).toBeLessThanOrEqual(126);
      }
    }
  });

  it('passes the sim SHARED validator unchanged, so no host id is unrecordable', () => {
    // The decisive cross-check: this module restates the bound rather than
    // importing the sim at runtime, so the two must be pinned to agree.
    const fromUuid = allocateOfflineGathererIdentity(countingUuidSource());
    const fromBytes = allocateOfflineGathererIdentity(countingByteSource());
    expect(readLocalGathererIdentity(fromUuid)).toEqual(fromUuid);
    expect(readLocalGathererIdentity(fromBytes)).toEqual(fromBytes);
  });
});
