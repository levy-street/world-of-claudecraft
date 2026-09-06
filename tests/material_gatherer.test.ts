// The gatherer-identity leaf (src/sim/material_gatherer.ts): where a descriptor
// comes from, what it refuses, and the frozen line between recording WHO
// gathered a unit and marking it premium.
//
// These are the properties the whole feature rests on, so each is asserted
// decisively rather than through a helper's own return shape:
//   * identity is SUPPLIED, never derived. No input here is a seed, an entity id
//     or a name, and nothing produces an id from one.
//   * an authoritative character id outranks anything a save could carry.
//   * a persisted local identity outranks the fresh host default.
//   * a malformed persisted identity REFUSES rather than regenerating.
//   * a recorded gatherer never signs; a signature never needs a gatherer.

import { describe, expect, it } from 'vitest';
import {
  gatheredMaterialSources,
  gathererFor,
  INVALID_LOCAL_IDENTITY,
  type LocalGathererIdentity,
  persistedLocalIdentity,
  readLocalGathererIdentity,
  readPersistedLocalIdentity,
  resolveGathererIdentity,
} from '../src/sim/material_gatherer';
import { isPremiumMaterialSource, MAX_GATHERER_ID_LENGTH } from '../src/sim/material_sources';

const OFFLINE: LocalGathererIdentity = { kind: 'offline', id: 'off:device-a:1' };
const HEADLESS: LocalGathererIdentity = { kind: 'headless', id: 'hl:proc-a:7' };

describe('resolveGathererIdentity precedence', () => {
  it('takes the authoritative character id over ANY save-carried local identity', () => {
    // The anti-spoof property: a blob claiming a local identity cannot change
    // who an online character gathers as.
    expect(resolveGathererIdentity({ characterId: 42, persisted: OFFLINE })).toEqual({
      kind: 'character',
      id: 42,
    });
  });

  it('takes the PERSISTED local identity over the fresh host default', () => {
    // What makes a reloaded local character keep the identity its already
    // gathered stock is attributed to, instead of splitting in two.
    expect(resolveGathererIdentity({ persisted: OFFLINE, hostDefault: HEADLESS })).toEqual(OFFLINE);
  });

  it('falls back to the fresh host default only when nothing is persisted', () => {
    expect(resolveGathererIdentity({ hostDefault: OFFLINE })).toEqual(OFFLINE);
  });

  it('answers UNDEFINED with no inputs, inventing nothing', () => {
    // The bare test/probe Sim. There is no seed, name or entity id in scope to
    // derive from, and that is the point.
    expect(resolveGathererIdentity({})).toBeUndefined();
    expect(resolveGathererIdentity({ hostDefault: null })).toBeUndefined();
  });

  it('REFUSES a present-but-invalid character id rather than demoting to a local one', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => resolveGathererIdentity({ characterId: bad, hostDefault: OFFLINE })).toThrow(
        /positive safe integer/,
      );
    }
  });
});

describe('the persisted local identity', () => {
  it('reads an absent field as absent, so every pre-feature save still loads', () => {
    // Absent is `undefined` and nothing else.
    expect(readPersistedLocalIdentity(undefined)).toBeUndefined();
  });

  it('treats an explicit null as PRESENT and malformed, not as a pre-feature save', () => {
    // A blob that stored the field and stored a non-identity in it is corrupt.
    // Reading it as absent would regenerate a different durable id under a
    // character whose existing stock names the old one.
    expect(() => readPersistedLocalIdentity(null)).toThrow(INVALID_LOCAL_IDENTITY);
  });

  it('REFUSES a malformed stored value instead of silently regenerating one', () => {
    // Falling back to a fresh id here would hand the character a DIFFERENT
    // durable identity than its existing stock names, with nothing left to
    // detect it afterwards. So it throws, before the player is registered.
    for (const bad of [
      {},
      { kind: 'character', id: 5 },
      { kind: 'offline' },
      { kind: 'offline', id: '' },
      { kind: 'offline', id: 7 },
      { kind: 'nope', id: 'x' },
      { kind: 'offline', id: 'a'.repeat(MAX_GATHERER_ID_LENGTH + 1) },
      { kind: 'offline', id: 'has\u0000control' },
      { kind: 'offline', id: 'café' },
    ]) {
      expect(() => readPersistedLocalIdentity(bad)).toThrow(INVALID_LOCAL_IDENTITY);
    }
  });

  it('accepts exactly the bounded printable-ASCII shape the descriptor validator does', () => {
    const atBound = { kind: 'offline' as const, id: 'a'.repeat(MAX_GATHERER_ID_LENGTH) };
    expect(readPersistedLocalIdentity(atBound)).toEqual(atBound);
  });

  it('reads a malformed FRESH host default as simply absent, never as a throw', () => {
    // A host that could not mint one passes null; that is "no identity", not a
    // corrupt save, so it must not fail the join.
    expect(readLocalGathererIdentity(null)).toBeNull();
    expect(readLocalGathererIdentity({ kind: 'offline', id: '' })).toBeNull();
  });

  it('accepts ONLY an ordinary data record, so an inherited claim is not an identity', () => {
    // A save blob or a host config is a plain object or a null-prototype bag.
    // An array, a class instance, or an object whose fields live on a prototype
    // is refused as a SHAPE: those fields are not data the host handed over.
    const inherited = Object.create({ kind: 'offline', id: 'off:proto:1' });
    class Claim {
      kind = 'offline';
      id = 'off:class:1';
    }
    const arrayClaim = Object.assign([], { kind: 'offline', id: 'off:array:1' });
    for (const bad of [inherited, new Claim(), arrayClaim]) {
      expect(readLocalGathererIdentity(bad)).toBeNull();
      expect(() => readPersistedLocalIdentity(bad)).toThrow(INVALID_LOCAL_IDENTITY);
    }
    // And the refusal is what reaches the resolver: a rejected fresh default
    // never passes the original object through as an identity.
    expect(
      resolveGathererIdentity({ hostDefault: readLocalGathererIdentity(inherited) }),
    ).toBeUndefined();

    // A null-prototype bag IS ordinary data and still loads.
    const bag = Object.assign(Object.create(null), { kind: 'offline', id: 'off:bag:1' });
    expect(readLocalGathererIdentity(bag)).toEqual({ kind: 'offline', id: 'off:bag:1' });
  });

  it('persists the LOCAL kinds only, so an online blob stays byte-equal', () => {
    expect(persistedLocalIdentity({ kind: 'character', id: 42 })).toBeUndefined();
    expect(persistedLocalIdentity(undefined)).toBeUndefined();
    expect(persistedLocalIdentity(OFFLINE)).toEqual(OFFLINE);
    expect(persistedLocalIdentity(HEADLESS)).toEqual(HEADLESS);
  });
});

describe('gathererFor: the name is a LIVE snapshot', () => {
  it('reads the current name, so a rename applies to future mints only', () => {
    const meta = { name: 'Ana', gathererIdentity: { kind: 'character' as const, id: 42 } };
    expect(gathererFor(meta)).toEqual({ kind: 'character', id: 42, name: 'Ana' });
    expect(gathererFor({ ...meta, name: 'Anastasia' })).toEqual({
      kind: 'character',
      id: 42,
      name: 'Anastasia',
    });
  });

  it('answers undefined with no identity, whatever the name is', () => {
    expect(gathererFor({ name: 'Ana' })).toBeUndefined();
  });

  it('answers undefined for a name that cannot be recorded', () => {
    const identity = { kind: 'offline' as const, id: 'off:d:1' };
    expect(gathererFor({ name: '', gathererIdentity: identity })).toBeUndefined();
    expect(gathererFor({ name: 'café', gathererIdentity: identity })).toBeUndefined();
  });
});

describe('gatheredMaterialSources: attribution and signature are independent', () => {
  const meta = { name: 'Ana', gathererIdentity: { kind: 'character' as const, id: 42 } };

  it('records the gatherer and, on its own, confers NO premium benefit', () => {
    const sources = gatheredMaterialSources(meta, 3);
    expect(sources).toHaveLength(1);
    expect(sources?.[0].count).toBe(3);
    expect(sources?.[0].source.gatherer).toEqual({ kind: 'character', id: 42, name: 'Ana' });
    expect(sources?.[0].source.signer).toBeUndefined();
    // The frozen line, asserted through the SHARED predicate rather than by
    // reading the field back: a gathered unit is not a signed unit.
    expect(isPremiumMaterialSource(sources?.[0].source ?? {})).toBe(false);
  });

  it('carries BOTH in one bucket when the caller says the roll signed it', () => {
    const sources = gatheredMaterialSources(meta, 2, { signer: 'Ana' });
    expect(sources?.[0].source.gatherer).toEqual({ kind: 'character', id: 42, name: 'Ana' });
    expect(sources?.[0].source.signer).toBe('Ana');
    expect(isPremiumMaterialSource(sources?.[0].source ?? {})).toBe(true);
  });

  it('still signs when there is no identity at all: the premium half stands alone', () => {
    const sources = gatheredMaterialSources({ name: 'Ana' }, 2, { signer: 'Ana' });
    expect(sources?.[0].source.gatherer).toBeUndefined();
    expect(sources?.[0].source.signer).toBe('Ana');
    expect(isPremiumMaterialSource(sources?.[0].source ?? {})).toBe(true);
  });

  it('records NOTHING when there is neither, which is the pre-feature grant', () => {
    expect(gatheredMaterialSources({ name: 'Ana' }, 4)).toBeUndefined();
  });

  it('refuses a non-positive or unsafe count rather than emitting a broken bucket', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(gatheredMaterialSources(meta, bad)).toBeUndefined();
    }
  });

  it('shares no object with the meta it read, so a later rename cannot rewrite a landed bucket', () => {
    const live = { name: 'Ana', gathererIdentity: { kind: 'character' as const, id: 42 } };
    const sources = gatheredMaterialSources(live, 1);
    live.name = 'Mallory';
    expect(sources?.[0].source.gatherer?.name).toBe('Ana');
  });
});
