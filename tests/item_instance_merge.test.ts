// Identical-payload stacking (Professions 2.0 Phase 12d): the equality and
// mergeability matrix for src/sim/item_instance_merge.ts, the one predicate
// every merge point (bags countFit/addStacked, Sim.addItemInstance, bank
// moveBetweenContainers, trade fitsAfterSwap) consumes. Every refusal arm is
// pinned alongside its accepting sibling so a predicate that flips to
// always-true or always-false cannot stay green.

import { describe, expect, it } from 'vitest';
import {
  canStackInstancePayloads,
  isMergeableInstancePayload,
  itemInstancePayloadsEqual,
} from '../src/sim/item_instance_merge';
import type { ItemInstancePayload } from '../src/sim/types';

describe('itemInstancePayloadsEqual', () => {
  it('two absent payloads are equal; a payload never equals no payload', () => {
    expect(itemInstancePayloadsEqual(undefined, undefined)).toBe(true);
    expect(itemInstancePayloadsEqual({ signer: 'Ana' }, undefined)).toBe(false);
    expect(itemInstancePayloadsEqual(undefined, { signer: 'Ana' })).toBe(false);
    // An empty payload object is still a payload, not "no payload".
    expect(itemInstancePayloadsEqual({}, undefined)).toBe(false);
  });

  it('same-signer copies compare equal; a signer mismatch refuses', () => {
    expect(itemInstancePayloadsEqual({ signer: 'Ana' }, { signer: 'Ana' })).toBe(true);
    expect(itemInstancePayloadsEqual({ signer: 'Ana' }, { signer: 'Bru' })).toBe(false);
  });

  it('a merely-signed copy never equals an enchanted or bound one', () => {
    const signed: ItemInstancePayload = { signer: 'Ana' };
    expect(itemInstancePayloadsEqual(signed, { signer: 'Ana', enchant: 'flame_weapon' })).toBe(
      false,
    );
    expect(itemInstancePayloadsEqual(signed, { signer: 'Ana', boundTo: 7 })).toBe(false);
    expect(
      itemInstancePayloadsEqual({ signer: 'Ana', boundTo: 7 }, { signer: 'Ana', boundTo: 9 }),
    ).toBe(false);
  });

  it('the nested rolled record compares per-key: quality, stats, masterwork all participate', () => {
    const mw: ItemInstancePayload = {
      signer: 'Ana',
      rolled: { masterwork: true, stats: { int: 2, spi: 1 } },
    };
    expect(
      itemInstancePayloadsEqual(mw, {
        signer: 'Ana',
        rolled: { masterwork: true, stats: { int: 2, spi: 1 } },
      }),
    ).toBe(true);
    expect(
      itemInstancePayloadsEqual(mw, {
        signer: 'Ana',
        rolled: { masterwork: true, stats: { int: 2, spi: 2 } },
      }),
    ).toBe(false);
    expect(
      itemInstancePayloadsEqual(mw, { signer: 'Ana', rolled: { stats: { int: 2, spi: 1 } } }),
    ).toBe(false);
    expect(
      itemInstancePayloadsEqual({ rolled: { quality: 'rare' } }, { rolled: { quality: 'epic' } }),
    ).toBe(false);
    expect(
      itemInstancePayloadsEqual({ rolled: { quality: 'rare' } }, { rolled: { quality: 'rare' } }),
    ).toBe(true);
  });

  it('is key-order independent across the payload and its nested records', () => {
    const a: ItemInstancePayload = { signer: 'Ana', rolled: { stats: { a: 1, b: 2 } } };
    const b: ItemInstancePayload = { rolled: { stats: { b: 2, a: 1 } }, signer: 'Ana' };
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b)); // the byte shapes really differ
    expect(itemInstancePayloadsEqual(a, b)).toBe(true);
  });

  it('a field that is absent equals a field set to undefined', () => {
    expect(
      itemInstancePayloadsEqual({ signer: 'Ana', boundTo: undefined }, { signer: 'Ana' }),
    ).toBe(true);
    expect(
      itemInstancePayloadsEqual(
        { signer: 'Ana', rolled: { masterwork: undefined, quality: 'rare' } },
        { signer: 'Ana', rolled: { quality: 'rare' } },
      ),
    ).toBe(true);
  });

  it('charge maps compare per-key (equal maps equal, differing maps refuse)', () => {
    expect(
      itemInstancePayloadsEqual({ charges: { fireball: 3 } }, { charges: { fireball: 3 } }),
    ).toBe(true);
    expect(
      itemInstancePayloadsEqual({ charges: { fireball: 3 } }, { charges: { fireball: 2 } }),
    ).toBe(false);
    expect(itemInstancePayloadsEqual({ charges: { fireball: 3 } }, {})).toBe(false);
  });
});

describe('isMergeableInstancePayload', () => {
  it('refuses any payload carrying charges and accepts every other shape', () => {
    expect(isMergeableInstancePayload({ charges: { fireball: 3 } })).toBe(false);
    expect(isMergeableInstancePayload({ signer: 'Ana', charges: { zap: 1 } })).toBe(false);
    expect(isMergeableInstancePayload({ signer: 'Ana' })).toBe(true);
    expect(isMergeableInstancePayload({ rolled: { masterwork: true, stats: { int: 2 } } })).toBe(
      true,
    );
    expect(isMergeableInstancePayload({})).toBe(true);
    expect(isMergeableInstancePayload(undefined)).toBe(true);
  });
});

describe('canStackInstancePayloads', () => {
  it('accepts byte-equal mergeable payloads and the plain-plain arm', () => {
    expect(canStackInstancePayloads({ signer: 'Ana' }, { signer: 'Ana' })).toBe(true);
    expect(canStackInstancePayloads(undefined, undefined)).toBe(true);
  });

  it('refuses plain-vs-instanced in both directions', () => {
    expect(canStackInstancePayloads(undefined, { signer: 'Ana' })).toBe(false);
    expect(canStackInstancePayloads({ signer: 'Ana' }, undefined)).toBe(false);
  });

  it('refuses a signer mismatch, an enchanted-vs-signed pair, and a boundTo mismatch', () => {
    expect(canStackInstancePayloads({ signer: 'Ana' }, { signer: 'Bru' })).toBe(false);
    expect(
      canStackInstancePayloads({ signer: 'Ana' }, { signer: 'Ana', enchant: 'flame_weapon' }),
    ).toBe(false);
    expect(canStackInstancePayloads({ signer: 'Ana', boundTo: 7 }, { signer: 'Ana' })).toBe(false);
  });

  it('refuses byte-equal charge-bearing payloads via mergeability, not equality', () => {
    const a: ItemInstancePayload = { signer: 'Ana', charges: { zap: 2 } };
    const b: ItemInstancePayload = { signer: 'Ana', charges: { zap: 2 } };
    expect(itemInstancePayloadsEqual(a, b)).toBe(true); // equal, yet
    expect(canStackInstancePayloads(a, b)).toBe(false); // never stacked
  });
});
