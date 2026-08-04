import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import { abilityIconRecipe, hasExplicitAbilityIcon } from '../src/ui/icons';

// Every class ability must have a deliberate, visually distinct icon.
// The procedural fallback (school + name keywords) collides for many ids
// (e.g. all 6 Warlock summons render the same shadow sigil), so we require
// a hand-authored recipe per ability and guard against any two colliding.

const abilityIds = Object.keys(ABILITIES);
const iconsSourcePath = new URL('../src/ui/icons.ts', import.meta.url);

function abilityRecipeIds(): string[] {
  const source = readFileSync(iconsSourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    'src/ui/icons.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let recipes: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'ABILITY_RECIPES'
    ) {
      if (!node.initializer || !ts.isObjectLiteralExpression(node.initializer)) {
        throw new Error('ABILITY_RECIPES must remain an object literal');
      }
      recipes = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!recipes) throw new Error('ABILITY_RECIPES declaration not found');

  const ids = recipes.properties.map((property) => {
    if (!ts.isPropertyAssignment(property)) {
      throw new Error('ABILITY_RECIPES may contain only explicit property assignments');
    }
    const name = property.name;
    if (
      ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name) ||
      ts.isNoSubstitutionTemplateLiteral(name)
    ) {
      return name.text;
    }
    throw new Error('ABILITY_RECIPES keys must be statically named');
  });
  return ids.sort((left, right) => left.localeCompare(right));
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('recipe values must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`)
      .join(',')}}`;
  }
  throw new Error(`unsupported recipe value type: ${typeof value}`);
}

function serialize(id: string): string {
  const recipe = abilityIconRecipe(id);
  // Order-independent within prims is not desired: placement order matters
  // visually, so serialize as-is.
  return JSON.stringify(recipe);
}

describe('ability icons', () => {
  it('has at least the nine classes worth of abilities', () => {
    expect(abilityIds.length).toBeGreaterThan(140);
  });

  it('every ability has an explicit (non-fallback) icon recipe', () => {
    const missing = abilityIds.filter((id) => !hasExplicitAbilityIcon(id));
    expect(missing, `abilities relying on the procedural fallback: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('no two abilities resolve to an identical icon', () => {
    const byRecipe = new Map<string, string[]>();
    for (const id of abilityIds) {
      const key = serialize(id);
      const list = byRecipe.get(key) ?? [];
      list.push(id);
      byRecipe.set(key, list);
    }
    const collisions = [...byRecipe.values()].filter((ids) => ids.length > 1);
    const report = collisions.map((ids) => ids.join(' = ')).join('\n');
    expect(collisions, `colliding icon groups:\n${report}`).toEqual([]);
  });

  it('pins every ABILITY_RECIPES key and payload by stable content identity', () => {
    const ids = abilityRecipeIds();
    expect(ids).toEqual([...new Set(ids)].sort((left, right) => left.localeCompare(right)));
    expect(ids).toHaveLength(323);
    for (const id of ids) expect(hasExplicitAbilityIcon(id), id).toBe(true);

    const identity = ids.map((id) => ({ id, recipe: abilityIconRecipe(id) }));
    const hash = createHash('sha256').update(stableSerialize(identity)).digest('hex');
    expect(hash).toBe('abb6938d2aba7fffd606c8e181d3f740a9758896ab8e20719f3b1028c099be35');
  });
});
