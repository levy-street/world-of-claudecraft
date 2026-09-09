// The shared key-binding action names (src/ui/keybind_action_names_core.ts): the
// Key Bindings rows and the on-bar rebind prompts must name an action the same
// way, so both read this one table.
import { describe, expect, it } from 'vitest';
import { BIND_ACTIONS } from '../src/game/keybinds';
import { BIND_ACTION_LABEL_KEYS, bindActionDisplayName } from '../src/ui/keybind_action_names_core';

const noSlotName = () => null;

describe('bindActionDisplayName', () => {
  it('localizes every non-slot registry action through a label key', () => {
    for (const a of BIND_ACTIONS) {
      if (a.id.startsWith('slot')) continue;
      expect(BIND_ACTION_LABEL_KEYS[a.id], a.id).toBeDefined();
      expect(bindActionDisplayName(a.id, a.label, noSlotName)).not.toBe('');
    }
  });

  it('falls back to the supplied label for an unknown action', () => {
    expect(bindActionDisplayName('notAnAction', 'Mystery', noSlotName)).toBe('Mystery');
  });

  it('names slot 0 Attack, a filled slot by its contents, and an empty slot by its number', () => {
    expect(bindActionDisplayName('slot0', 'slot0', () => 'Fireball')).toBe(
      bindActionDisplayName('slot0', 'slot0', noSlotName),
    );
    expect(
      bindActionDisplayName('slot3', 'slot3', (slot) => (slot === 3 ? 'Fireball' : null)),
    ).toBe('Fireball');
    const empty = bindActionDisplayName('slot3', 'slot3', noSlotName);
    expect(empty).toContain('4');
    expect(empty).not.toBe('slot3');
  });
});
