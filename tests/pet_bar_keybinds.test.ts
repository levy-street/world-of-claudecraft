// Pet bar keybinds: the five pet-command actions bound to Ctrl+1..5 by default,
// resolvable through the Keybinds machine (and rebindable like any other action).
import { beforeEach, describe, expect, it } from 'vitest';
import { BIND_ACTIONS, Keybinds } from '../src/game/keybinds';

function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

const PET_DEFAULTS: [string, string][] = [
  ['petAttack', 'Ctrl+Digit1'],
  ['petStop', 'Ctrl+Digit2'],
  ['petTaunt', 'Ctrl+Digit3'],
  ['petDefensive', 'Ctrl+Digit4'],
  ['petAggressive', 'Ctrl+Digit5'],
];

describe('pet bar keybinds', () => {
  beforeEach(installStorage);

  it('registers the five pet actions in a Pet category with Ctrl+1..5 defaults', () => {
    for (const [id, combo] of PET_DEFAULTS) {
      const action = BIND_ACTIONS.find((a) => a.id === id);
      expect(action, id).toBeDefined();
      expect(action!.category).toBe('Pet');
      expect(action!.kind).toBe('edge');
      expect(action!.defaults).toEqual([combo]);
    }
  });

  it('resolves the default Ctrl+digit chord to the matching pet action', () => {
    const kb = new Keybinds();
    for (const [id, combo] of PET_DEFAULTS) {
      expect(kb.actionForCode(combo), combo).toBe(id);
    }
    // the bare digit (no Ctrl) still belongs to the action bar, not the pet bar
    expect(kb.actionForCode('Digit1')).not.toBe('petAttack');
  });

  it('rebinds a pet action like any other (the point of the feature)', () => {
    const kb = new Keybinds();
    kb.bind('petAttack', 0, 'KeyP');
    expect(kb.actionForCode('KeyP')).toBe('petAttack');
    expect(kb.actionForCode('Ctrl+Digit1')).toBeNull(); // old default freed
  });
});
