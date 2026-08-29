// The one per-copy transfer-lock predicate (src/sim/transfer_lock.ts) and the
// import graph that makes it shared rather than copied.
//
// The predicate itself is three lines, so the interesting half is structural:
// four anonymous exchange pipes (the World Market, Ravenpost mail, the guild
// bank, and the $WOC rail) must consult the SAME rule, and the $WOC rail must
// reach it without dragging in the transfer module's runtime import graph.
// Both facts are invisible to a behavior test, so they are pinned here against
// the comment-stripped sources.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isTransferLockedInstance } from '../src/sim/transfer_lock';
import type { ItemInstancePayload } from '../src/sim/types';
import { stripComments } from './helpers/strip_comments';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const sourceOf = (rel: string): string => stripComments(readFileSync(join(repoRoot, rel), 'utf8'));

const occurrences = (src: string, needle: string): number => src.split(needle).length - 1;

describe('isTransferLockedInstance: the per-copy lock', () => {
  // Presence, never truthiness, on the boundTo arm: pid 0 is a real character
  // id, so a falsy-value read would hand copy after copy of a bound item to
  // the anonymous pipes.
  const STATES: [string, ItemInstancePayload | undefined, boolean][] = [
    ['no instance at all (a fungible stack)', undefined, false],
    ['a plain instance', {}, false],
    ['an armed copy', { bindOnTrade: true }, true],
    ['a copy bound to pid 0', { boundTo: 0 }, true],
    ['a copy bound to a nonzero pid', { boundTo: 7 }, true],
    ['an armed AND bound copy', { bindOnTrade: true, boundTo: 7 }, true],
    ['an explicitly disarmed copy', { bindOnTrade: false }, false],
  ];

  it.each(STATES)('%s answers as pinned', (_label, instance, expected) => {
    expect(isTransferLockedInstance(instance)).toBe(expected);
  });

  it('ignores the markers that are not this axis', () => {
    // Provenance and the owner's own salvage-safety mark are deliberately not
    // consulted here (the module header records the open design call), so a
    // signed or player-locked copy still trades.
    expect(isTransferLockedInstance({ signer: 'Aldric' })).toBe(false);
    expect(isTransferLockedInstance({ enchant: 'enchant_weapon_runed_edge' })).toBe(false);
  });
});

describe('the transfer-lock import graph', () => {
  it('keeps the leaf dependency-free: type-only imports and nothing else', () => {
    const src = sourceOf('src/sim/transfer_lock.ts');
    const imports = src.match(/^import\b.*$/gm) ?? [];
    // Non-vacuity first: the file really does import something, so "every
    // import is type-only" is a claim about a non-empty set.
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((line) => !line.startsWith('import type '))).toEqual([]);
    expect(src).toContain("import type { ItemInstancePayload } from './types'");
    // A dynamic import would be a runtime edge the line scan above never sees.
    expect(src).not.toMatch(/\bimport\s*\(/);
  });

  it('has the $WOC rail consume the LEAF, never the re-export', () => {
    // exchange_eligibility.ts is the rail's sim-side gate. Re-pointing it at
    // item_instance_transfer.ts would compile and behave identically today
    // while silently dragging the whole content tree (the sanitize-on-load
    // helpers) back into the rail's runtime graph.
    const src = sourceOf('src/sim/exchange_eligibility.ts');
    expect(src).toContain("import { isTransferLockedInstance } from './transfer_lock'");
    expect(src).not.toContain('item_instance_transfer');
    expect(occurrences(src, 'isTransferLockedInstance(')).toBeGreaterThan(0);
  });

  // Every sibling pipe still routes its per-copy decision through the shared
  // predicate. A pipe that grows its own copy of the rule (or drops the check)
  // reds here, which is the parity this module exists to guarantee.
  const PIPES: [string, string][] = [
    ['the World Market and mail transfer rules', 'src/sim/item_instance_transfer.ts'],
    ['Ravenpost mail', 'src/sim/mail/post_office.ts'],
    ['the guild bank', 'src/sim/guild_bank.ts'],
  ];

  it.each(PIPES)('%s still calls the shared predicate', (_label, rel) => {
    expect(occurrences(sourceOf(rel), 'isTransferLockedInstance(')).toBeGreaterThan(0);
  });

  it('re-exports the leaf from item_instance_transfer for those pipes', () => {
    // The re-export is the seam the pipes import through, so deleting it would
    // break them at build time; pinned anyway because the alternative fix (each
    // pipe importing the leaf) is exactly the drift the call pins cannot see.
    const src = sourceOf('src/sim/item_instance_transfer.ts');
    expect(src).toContain("import { isTransferLockedInstance } from './transfer_lock'");
    expect(src).toMatch(/export\s*\{\s*isTransferLockedInstance\s*\}/);
  });
});
