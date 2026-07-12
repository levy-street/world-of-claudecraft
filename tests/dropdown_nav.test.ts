import { describe, expect, it } from 'vitest';
import { dropdownKeyNav } from '../src/ui/dropdown_nav';

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
