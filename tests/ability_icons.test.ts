import { describe, it, expect } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import { abilityIconRecipe, hasExplicitAbilityIcon } from '../src/ui/icons';

// Every class ability must have a deliberate, visually distinct icon.
// The procedural fallback (school + name keywords) collides for many ids
// (e.g. all 6 Warlock summons render the same shadow sigil), so we require
// a hand-authored recipe per ability and guard against any two colliding.

const abilityIds = Object.keys(ABILITIES);

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
    expect(missing, `abilities relying on the procedural fallback: ${missing.join(', ')}`).toEqual([]);
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
