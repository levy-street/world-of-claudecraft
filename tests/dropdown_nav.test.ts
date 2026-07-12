import { describe, expect, it } from 'vitest';
import { dropdownKeyNav, TYPEAHEAD_MIN_OPTIONS, typeaheadTarget } from '../src/ui/dropdown_nav';

describe('dropdownKeyNav', () => {
  it('ignores keys when there are no options', () => {
    expect(dropdownKeyNav('ArrowDown', false, -1, 0)).toEqual({ kind: 'none' });
  });

  describe('collapsed', () => {
    it('opens at the current option on Enter/Space/Arrows', () => {
      for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
        expect(dropdownKeyNav(key, false, 2, 5)).toEqual({ kind: 'open', index: 2 });
      }
    });

    it('opens at the first option when nothing is focused yet', () => {
      expect(dropdownKeyNav('ArrowDown', false, -1, 5)).toEqual({ kind: 'open', index: 0 });
    });

    it('opens at the extremes on Home/End', () => {
      expect(dropdownKeyNav('Home', false, 3, 5)).toEqual({ kind: 'open', index: 0 });
      expect(dropdownKeyNav('End', false, 0, 5)).toEqual({ kind: 'open', index: 4 });
    });

    it('passes unrelated keys through to the browser', () => {
      expect(dropdownKeyNav('a', false, 0, 5)).toEqual({ kind: 'none' });
    });
  });

  describe('expanded', () => {
    it('moves down and clamps at the last option', () => {
      expect(dropdownKeyNav('ArrowDown', true, 1, 5)).toEqual({ kind: 'move', index: 2 });
      expect(dropdownKeyNav('ArrowDown', true, 4, 5)).toEqual({ kind: 'move', index: 4 });
    });

    it('moves up and clamps at the first option', () => {
      expect(dropdownKeyNav('ArrowUp', true, 2, 5)).toEqual({ kind: 'move', index: 1 });
      expect(dropdownKeyNav('ArrowUp', true, 0, 5)).toEqual({ kind: 'move', index: 0 });
    });

    it('wraps to an end when nothing is focused', () => {
      expect(dropdownKeyNav('ArrowDown', true, -1, 5)).toEqual({ kind: 'move', index: 0 });
      expect(dropdownKeyNav('ArrowUp', true, -1, 5)).toEqual({ kind: 'move', index: 4 });
    });

    it('jumps to extremes on Home/End', () => {
      expect(dropdownKeyNav('Home', true, 3, 5)).toEqual({ kind: 'move', index: 0 });
      expect(dropdownKeyNav('End', true, 1, 5)).toEqual({ kind: 'move', index: 4 });
    });

    it('selects on Enter/Space and closes on Escape', () => {
      expect(dropdownKeyNav('Enter', true, 2, 5)).toEqual({ kind: 'select' });
      expect(dropdownKeyNav(' ', true, 2, 5)).toEqual({ kind: 'select' });
      expect(dropdownKeyNav('Escape', true, 2, 5)).toEqual({ kind: 'close' });
    });
    it('closes on Tab via a distinct action so native focus traversal continues', () => {
      expect(dropdownKeyNav('Tab', true, 2, 5)).toEqual({ kind: 'tab' });
    });
  });
});

describe('typeaheadTarget (first-letter listbox jump)', () => {
  const labels = ['English', 'Español', 'Français', 'Deutsch', '简体中文', 'Русский', '日本語'];

  it('jumps to the next option starting with the char, cyclically after `from`', () => {
    // From nothing (-1): first match. F -> Français (index 2).
    expect(typeaheadTarget(labels, -1, 'F')).toBe(2);
    // Case-insensitive; from Français, F wraps back around to Français itself.
    expect(typeaheadTarget(labels, 2, 'f')).toBe(2);
    // D -> Deutsch (index 3).
    expect(typeaheadTarget(labels, -1, 'D')).toBe(3);
    // From Français (2), E finds the next E, wrapping to English (0).
    expect(typeaheadTarget(labels, 2, 'E')).toBe(0);
  });

  it('cycles through same-initial options on repeated presses', () => {
    const es = ['English', 'Español', 'Esperanto', 'Deutsch'];
    expect(typeaheadTarget(es, -1, 'E')).toBe(0);
    expect(typeaheadTarget(es, 0, 'E')).toBe(1);
    expect(typeaheadTarget(es, 1, 'E')).toBe(2);
    expect(typeaheadTarget(es, 2, 'E')).toBe(0); // wraps
  });

  it('returns null for no match, empty list, or a non-single char', () => {
    expect(typeaheadTarget(labels, -1, 'Z')).toBeNull();
    expect(typeaheadTarget([], -1, 'A')).toBeNull();
    expect(typeaheadTarget(labels, -1, 'Ab')).toBeNull();
    expect(typeaheadTarget(labels, -1, '')).toBeNull();
  });

  it('the 7+ threshold matches the language picker size', () => {
    expect(TYPEAHEAD_MIN_OPTIONS).toBe(7);
    expect(labels.length).toBeGreaterThanOrEqual(TYPEAHEAD_MIN_OPTIONS);
  });
});
