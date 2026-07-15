import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import { abilityIconRecipe, hasExplicitAbilityIcon } from '../src/ui/icons';

// Every class ability must have a deliberate, visually distinct authored icon.
// Painted images are keyed by their unique path; procedural icons are keyed by
// recipe. The generic fallback is never an acceptable source.

const abilityIds = Object.keys(ABILITIES);

function serialize(id: string): string {
  const recipe = abilityIconRecipe(id);
  // Order-independent within prims is not desired: placement order matters
  // visually, so serialize as-is.
  return JSON.stringify(recipe);
}

describe('ability icons', () => {
  it('has at least ten classes worth of abilities', () => {
    expect(abilityIds.length).toBeGreaterThan(150);
  });

  it('every ability has an explicit non-fallback icon source', () => {
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
});
