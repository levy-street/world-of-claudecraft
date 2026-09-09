import { describe, expect, it } from 'vitest';
import {
  resolveNamedImportSpecifier,
  saveFragmentReturnKeys,
  stateLiteralSpreadKeys,
} from './save_fragment_keys';

// Direct coverage for the cross-file resolver the professions_blob_growth.test.ts
// source-discovery arm leans on. Driven over SYNTHETIC sources, per this repo's standing
// scan-guard lesson (tests/CLAUDE.md, "Coverage & guards"): a resolver proven only against
// the real tree it already passes on proves nothing about the shape it is meant to catch.

describe('resolveNamedImportSpecifier', () => {
  it('finds a named import spread across multiple import statements', () => {
    const source = `
import { alpha, beta } from './alpha_module';
import { gamma } from './gamma_module';
`;
    expect(resolveNamedImportSpecifier(source, 'host.ts', 'beta')).toEqual({
      modulePath: './alpha_module',
      exportedName: 'beta',
    });
    expect(resolveNamedImportSpecifier(source, 'host.ts', 'gamma')).toEqual({
      modulePath: './gamma_module',
      exportedName: 'gamma',
    });
  });

  // ALIAS-AWARE: the call site's local name and the target module's real export can
  // differ, and the export name is what a cross-file lookup must search for.
  it('resolves an aliased named import to its REAL exported name, not the local call-site alias', () => {
    const source = `import { realHelperName as localAlias } from './aliased_module';`;
    expect(resolveNamedImportSpecifier(source, 'host.ts', 'localAlias')).toEqual({
      modulePath: './aliased_module',
      exportedName: 'realHelperName',
    });
  });

  it('returns undefined for a name with no named import (a namespace import, a default import, or none at all)', () => {
    const source = `
import * as nsMod from './ns_module';
import defaultThing from './default_module';
import { known } from './known_module';
`;
    expect(resolveNamedImportSpecifier(source, 'host.ts', 'nsMod')).toBeUndefined();
    expect(resolveNamedImportSpecifier(source, 'host.ts', 'defaultThing')).toBeUndefined();
    expect(resolveNamedImportSpecifier(source, 'host.ts', 'unknownName')).toBeUndefined();
  });
});

describe('saveFragmentReturnKeys', () => {
  it('reads the key straight off a type-literal return annotation, the shape every live helper uses', () => {
    const source = `
export function exampleSaveFragment(x: number): { exampleKey?: number } {
  return x > 0 ? { exampleKey: x } : {};
}
`;
    expect(saveFragmentReturnKeys('exampleSaveFragment', source, 'example.ts')).toEqual([
      'exampleKey',
    ]);
  });

  it('falls back to walking the body when the helper carries no return-type annotation', () => {
    const source = `
export function untypedSaveFragment(x: number) {
  return x > 0 ? { untypedKey: x } : {};
}
`;
    expect(saveFragmentReturnKeys('untypedSaveFragment', source, 'example.ts')).toEqual([
      'untypedKey',
    ]);
  });

  it('unions the annotation and the body, so a widened annotation the body never reaches still counts', () => {
    const source = `
export function partialSaveFragment(x: number): { annotatedOnly?: number; bodyKey?: number } {
  return x > 0 ? { bodyKey: x } : {};
}
`;
    expect(saveFragmentReturnKeys('partialSaveFragment', source, 'example.ts')).toEqual([
      'annotatedOnly',
      'bodyKey',
    ]);
  });

  it('throws when the named function is not declared in the source (an unresolved helper)', () => {
    const source = `export function otherSaveFragment(): { other?: number } { return {}; }`;
    expect(() => saveFragmentReturnKeys('missingSaveFragment', source, 'example.ts')).toThrow(
      /not declared as a top-level function/,
    );
  });

  it('throws when the helper names no discoverable key at all (an empty, untyped fragment)', () => {
    const source = `export function emptySaveFragment() { return {}; }`;
    expect(() => saveFragmentReturnKeys('emptySaveFragment', source, 'example.ts')).toThrow(
      /names no discoverable return key/,
    );
  });

  // THE REGRESSION THIS RESOLVER EXISTS TO CATCH: a save-fragment helper module grows a
  // new key, and the growth test's discovery must see it appear WITHOUT any change to this
  // resolver, since the resolver reads the helper's live source rather than a fixed list.
  it('discovers a newly added key the moment the helper source grows one, unprompted', () => {
    const before = `
export function growingSaveFragment(x: number): { existingKey?: number } {
  return x > 0 ? { existingKey: x } : {};
}
`;
    const after = `
export function growingSaveFragment(x: number): { existingKey?: number; addedKey?: string } {
  return x > 0 ? { existingKey: x, addedKey: 'y' } : {};
}
`;
    expect(saveFragmentReturnKeys('growingSaveFragment', before, 'example.ts')).toEqual([
      'existingKey',
    ]);
    expect(saveFragmentReturnKeys('growingSaveFragment', after, 'example.ts')).toEqual([
      'addedKey',
      'existingKey',
    ]);
  });

  // A REPRESENTATIVE real helper, pinned so a signature or shape change in the actual
  // save-fragment family reds here first rather than silently narrowing the growth test's
  // cross-file discovery. Kept as a literal source string (not a file read) so this suite
  // stays a pure unit test of the resolver, independent of src/sim/reliquary.ts.
  it('reads the real reliquarySaveFragment shape (pinned as a literal, the representative helper)', () => {
    const source = `
export function reliquarySaveFragment(state: ReliquaryState): { reliquary?: SavedReliquaryState } {
  const reliquary = serializeReliquaryState(state);
  return reliquary ? { reliquary } : {};
}
`;
    expect(saveFragmentReturnKeys('reliquarySaveFragment', source, 'reliquary.ts')).toEqual([
      'reliquary',
    ]);
  });
});

describe('stateLiteralSpreadKeys', () => {
  const wrap = (literalBody: string): string => `
class Sim {
  serializeCharacter(pid: number): CharacterState | null {
    const state: CharacterState = {
${literalBody}
    };
    return state;
  }
}
`;

  it('collects a plain key', () => {
    const source = wrap('      plainKey: 1,');
    const result = stateLiteralSpreadKeys(source, 'sim.ts', 'Sim', 'serializeCharacter');
    expect(result.literalKeys).toEqual(['plainKey']);
    expect(result.helperCallNames).toEqual([]);
  });

  it('collects both arms of a ternary spread, including the FALSE-branch-only key (the gatheringGoal shape)', () => {
    // The PR4 regression this producer exists to fix: the key sits in the branch AFTER
    // the `:`, which a "read right after `?`" scrape can never reach.
    const source = wrap('      ...(saved === undefined ? {} : { gatheringGoal: saved }),');
    const result = stateLiteralSpreadKeys(source, 'sim.ts', 'Sim', 'serializeCharacter');
    expect(result.literalKeys).toEqual(['gatheringGoal']);
  });

  it('collects a `cond && {k}` guard', () => {
    const source = wrap('      ...(cond && { guardedKey: 1 }),');
    const result = stateLiteralSpreadKeys(source, 'sim.ts', 'Sim', 'serializeCharacter');
    expect(result.literalKeys).toEqual(['guardedKey']);
  });

  it('collects a key from an IIFE (arrow, block body) wrapping a ternary, unwrapping the parenthesized callee', () => {
    const source = wrap(`      ...(() => {
        const saved = computeSomething();
        return saved === undefined ? {} : { iifeKey: saved };
      })(),`);
    const result = stateLiteralSpreadKeys(source, 'sim.ts', 'Sim', 'serializeCharacter');
    expect(result.literalKeys).toEqual(['iifeKey']);
  });

  it('collects a key from a concise-body IIFE (`() => ({...})`)', () => {
    const source = wrap('      ...(() => ({ conciseKey: 1 }))(),');
    const result = stateLiteralSpreadKeys(source, 'sim.ts', 'Sim', 'serializeCharacter');
    expect(result.literalKeys).toEqual(['conciseKey']);
  });

  it('reports a bare identifier call as a helper name, PLAIN and PARENTHESIZED alike', () => {
    const plain = wrap('      ...someSaveFragment(meta.thing),');
    expect(
      stateLiteralSpreadKeys(plain, 'sim.ts', 'Sim', 'serializeCharacter').helperCallNames,
    ).toEqual(['someSaveFragment']);

    const parenthesized = wrap('      ...(someSaveFragment(meta.thing)),');
    expect(
      stateLiteralSpreadKeys(parenthesized, 'sim.ts', 'Sim', 'serializeCharacter').helperCallNames,
    ).toEqual(['someSaveFragment']);
  });

  // THE SCANNER LIMIT PINNED: a namespace/property-access call spread is refused
  // explicitly, never silently treated as contributing zero keys.
  it('throws on a namespace/property-access call spread rather than silently skipping it', () => {
    const namespaced = wrap('      ...vaultMod.savedVaultFragment(meta.vault),');
    expect(() => stateLiteralSpreadKeys(namespaced, 'sim.ts', 'Sim', 'serializeCharacter')).toThrow(
      /unsupported spread-call shape/,
    );

    const method = wrap('      ...this.buildFragment(),');
    expect(() => stateLiteralSpreadKeys(method, 'sim.ts', 'Sim', 'serializeCharacter')).toThrow(
      /unsupported spread-call shape/,
    );
  });

  it('throws on a spread of something that is neither a call nor an object/ternary/&& shape', () => {
    const source = wrap('      ...someBareValue,');
    expect(() => stateLiteralSpreadKeys(source, 'sim.ts', 'Sim', 'serializeCharacter')).toThrow(
      /unsupported spread shape/,
    );
  });

  it('throws when the class, method, or the state literal itself cannot be found', () => {
    expect(() =>
      stateLiteralSpreadKeys('class Other {}', 'sim.ts', 'Sim', 'serializeCharacter'),
    ).toThrow(/class Sim not found/);
    expect(() =>
      stateLiteralSpreadKeys('class Sim {}', 'sim.ts', 'Sim', 'serializeCharacter'),
    ).toThrow(/not found \(or has no body\)/);
    expect(() =>
      stateLiteralSpreadKeys(
        'class Sim { serializeCharacter() { return null; } }',
        'sim.ts',
        'Sim',
        'serializeCharacter',
      ),
    ).toThrow(/has no top-level "const state = \{\.\.\.\}" object literal/);
  });
});
