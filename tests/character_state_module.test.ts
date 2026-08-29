import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  CharacterState as LeafCharacterState,
  PetState as LeafPetState,
} from '../src/sim/character_state';
import type {
  CharacterState as CompatCharacterState,
  PetState as CompatPetState,
} from '../src/sim/sim';
import { stripComments } from './helpers/strip_comments';

const moduleUrl = new URL('../src/sim/character_state.ts', import.meta.url);
const simUrl = new URL('../src/sim/sim.ts', import.meta.url);

describe('character_state type leaf', () => {
  it('keeps sim.ts type imports exactly compatible', () => {
    expectTypeOf<CompatCharacterState>().toEqualTypeOf<LeafCharacterState>();
    expectTypeOf<CompatPetState>().toEqualTypeOf<LeafPetState>();
  });

  it('owns CharacterState and PetState while sim.ts preserves its public type path', () => {
    expect(existsSync(fileURLToPath(moduleUrl))).toBe(true);

    const leaf = readFileSync(moduleUrl, 'utf8');
    const sim = readFileSync(simUrl, 'utf8');
    // Positive pins read comment-stripped source so commented-out code cannot
    // satisfy them; the not.toContain arms stay on the raw read (stronger there).
    const leafCode = stripComments(leaf);
    const simCode = stripComments(sim);
    expect(leafCode).toContain('export interface CharacterState');
    expect(leafCode).toContain('export interface PetState');
    expect(sim).not.toContain('export interface CharacterState');
    expect(sim).not.toContain('export interface PetState');
    expect(simCode).toMatch(
      /export type \{\s*CharacterState,\s*PetState\s*\} from ['"]\.\/character_state['"]/,
    );
  });

  it('has no runtime imports or coordinator dependency', () => {
    expect(existsSync(fileURLToPath(moduleUrl))).toBe(true);
    const source = readFileSync(moduleUrl, 'utf8');
    const parsed = ts.createSourceFile(
      fileURLToPath(moduleUrl),
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const imports = parsed.statements.filter(ts.isImportDeclaration);

    expect(imports.length).toBeGreaterThan(0);
    for (const declaration of imports) {
      expect(declaration.importClause?.isTypeOnly, declaration.getText(parsed)).toBe(true);
      expect(declaration.moduleSpecifier.getText(parsed)).not.toContain("'./sim'");
    }
  });
});
