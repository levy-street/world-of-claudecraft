// @vitest-environment happy-dom
// The bank window's search-box focus carry (src/ui/bank_search_focus.ts):
// capture the caret of a focused `.bag-search` before a rebuild, restore it
// onto the fresh input after. Extracted from bank_window.ts when the guild
// history grew a search box of its own, so both pane arms share one rule.
import { describe, expect, it } from 'vitest';

import { captureSearchCaret, restoreSearchCaret } from '../src/ui/bank_search_focus';

function rootWithSearch(value = 'iron'): { root: HTMLElement; input: HTMLInputElement } {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'bag-search';
  input.value = value;
  root.appendChild(input);
  document.body.appendChild(root);
  return { root, input };
}

describe('captureSearchCaret', () => {
  it('records the caret only when the search box is the active element', () => {
    const { root, input } = rootWithSearch();
    input.focus();
    input.setSelectionRange(1, 3);
    expect(captureSearchCaret(root, input)).toEqual({ start: 1, end: 3 });
    // Something else focused: nothing to carry.
    expect(captureSearchCaret(root, document.body)).toBeNull();
    expect(captureSearchCaret(root, null)).toBeNull();
  });

  it('is null when the root has no search box at all', () => {
    const root = document.createElement('div');
    expect(captureSearchCaret(root, document.body)).toBeNull();
  });
});

describe('restoreSearchCaret', () => {
  it('focuses the FRESH box and re-lands the caret, reporting that it did', () => {
    const { root, input } = rootWithSearch();
    input.focus();
    input.setSelectionRange(2, 2);
    const caret = captureSearchCaret(root, input);
    // The rebuild: a new input with the value re-installed by its owner.
    root.innerHTML = '';
    const fresh = document.createElement('input');
    fresh.type = 'search';
    fresh.className = 'bag-search';
    fresh.value = 'iron';
    root.appendChild(fresh);
    expect(restoreSearchCaret(root, caret)).toBe(true);
    expect(document.activeElement).toBe(fresh);
    expect(fresh.selectionStart).toBe(2);
    expect(fresh.selectionEnd).toBe(2);
  });

  it('reports false with nothing captured, or when the rebuild dropped the box', () => {
    const { root } = rootWithSearch();
    expect(restoreSearchCaret(root, null)).toBe(false);
    root.innerHTML = '';
    expect(restoreSearchCaret(root, { start: 0, end: 0 })).toBe(false);
  });
});
