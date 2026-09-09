// @vitest-environment happy-dom
//
// The gathering source-info detail hookup inside the shared harvest
// preference picker (Intentional Gathering PR5): shown for the GENERAL
// catalog picker only (componentTags undefined), updates on every draft
// change (a click or a roving key landing), and never appears for a corpse's
// own picker. Only the existing Apply button ever commits a preference; the
// detail itself never writes anything.

import { describe, expect, it, vi } from 'vitest';
import { HARVEST_PREFERENCE_ALL_TOKEN } from '../src/sim/professions/harvest_preference';
import { renderHarvestPreferencePicker } from '../src/ui/hud/professions/harvest_preference_picker';

function makeContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

function radioRowFor(root: HTMLElement, token: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (b) => b.dataset.harvestChoice === token,
  );
  if (!found) throw new Error(`no radio row for token ${token}`);
  return found;
}

function sourceDetail(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.harvest-preference-source-container');
}

describe('gathering source detail: general picker only', () => {
  it('shows the detail for a preselected material on first paint', () => {
    const container = makeContainer();
    renderHarvestPreferencePicker(
      container,
      { preference: { kind: 'material', itemId: 'rough_hide' } },
      { onDraftChange: vi.fn(), onCommit: vi.fn(), onDismiss: vi.fn() },
    );
    const detail = sourceDetail(container);
    expect(detail).not.toBeNull();
    expect(detail?.textContent).not.toBe('');
    // A real creature id must never appear as raw text; only the localized
    // display name (resolved via tEntity) shows.
    expect(detail?.textContent).not.toContain('forest_wolf');
  });

  it('updates when a different row is drafted, and clears for All', () => {
    const container = makeContainer();
    renderHarvestPreferencePicker(
      container,
      { preference: { kind: 'all' } },
      { onDraftChange: vi.fn(), onCommit: vi.fn(), onDismiss: vi.fn() },
    );
    expect(sourceDetail(container)?.textContent ?? '').toBe('');

    radioRowFor(container, 'rough_hide').click();
    const afterMaterial = sourceDetail(container);
    expect(afterMaterial?.textContent).not.toBe('');

    radioRowFor(container, HARVEST_PREFERENCE_ALL_TOKEN).click();
    expect(sourceDetail(container)?.textContent ?? '').toBe('');
  });

  it('never appears on a corpse-scoped picker (componentTags supplied)', () => {
    const container = makeContainer();
    renderHarvestPreferencePicker(
      container,
      { preference: null, componentTags: ['hide', 'fang'] },
      { onDraftChange: vi.fn(), onCommit: vi.fn(), onDismiss: vi.fn() },
    );
    expect(sourceDetail(container)).toBeNull();
  });

  it('associates the checked row with the detail via aria-describedby on first paint', () => {
    const container = makeContainer();
    renderHarvestPreferencePicker(
      container,
      { preference: { kind: 'material', itemId: 'rough_hide' } },
      { onDraftChange: vi.fn(), onCommit: vi.fn(), onDismiss: vi.fn() },
    );
    const detail = sourceDetail(container)!;
    expect(detail.id).not.toBe('');
    const row = radioRowFor(container, 'rough_hide');
    expect(row.getAttribute('aria-describedby')).toBe(detail.id);
    // No other row carries it.
    for (const other of container.querySelectorAll<HTMLButtonElement>('[role="radio"]')) {
      if (other !== row) expect(other.getAttribute('aria-describedby')).toBeNull();
    }
  });

  it('moves aria-describedby to the newly drafted row and never adds an aria-live region for it', () => {
    const container = makeContainer();
    renderHarvestPreferencePicker(
      container,
      { preference: { kind: 'all' } },
      { onDraftChange: vi.fn(), onCommit: vi.fn(), onDismiss: vi.fn() },
    );
    const detail = sourceDetail(container)!;
    expect(detail.getAttribute('aria-live')).toBeNull();
    const allRow = radioRowFor(container, HARVEST_PREFERENCE_ALL_TOKEN);
    expect(allRow.getAttribute('aria-describedby')).toBeNull();

    const hideRow = radioRowFor(container, 'rough_hide');
    hideRow.click();
    expect(hideRow.getAttribute('aria-describedby')).toBe(detail.id);

    const fangRow = radioRowFor(container, 'wolf_fang');
    fangRow.click();
    expect(fangRow.getAttribute('aria-describedby')).toBe(detail.id);
    // The previous row's description association is removed, not just
    // superseded, so an assistive tech reading it stale never happens.
    expect(hideRow.getAttribute('aria-describedby')).toBeNull();
  });

  it('returning to All clears the previous radio aria-describedby and never assigns an empty-description reference', () => {
    const container = makeContainer();
    renderHarvestPreferencePicker(
      container,
      { preference: { kind: 'all' } },
      { onDraftChange: vi.fn(), onCommit: vi.fn(), onDismiss: vi.fn() },
    );
    const detail = sourceDetail(container)!;
    const allRow = radioRowFor(container, HARVEST_PREFERENCE_ALL_TOKEN);
    const hideRow = radioRowFor(container, 'rough_hide');

    hideRow.click();
    expect(hideRow.getAttribute('aria-describedby')).toBe(detail.id);

    allRow.click();
    expect(detail.textContent).toBe('');
    // The previously-described row loses the association entirely, and All
    // itself never gains one: an aria-describedby pointing at an empty
    // detail is worse than none, since a screen reader would announce
    // nothing for it.
    expect(hideRow.getAttribute('aria-describedby')).toBeNull();
    expect(allRow.getAttribute('aria-describedby')).toBeNull();
  });

  it('rewrites the detail content before a keyboard landing moves focus to the new row', () => {
    const container = makeContainer();
    renderHarvestPreferencePicker(
      container,
      { preference: { kind: 'material', itemId: 'rough_hide' } },
      { onDraftChange: vi.fn(), onCommit: vi.fn(), onDismiss: vi.fn() },
    );
    const detail = sourceDetail(container)!;
    const beforeText = detail.textContent;
    const hideRow = radioRowFor(container, 'rough_hide');
    const fangRow = radioRowFor(container, 'wolf_fang');
    let detailTextAtFocusTime: string | null = null;
    fangRow.focus = new Proxy(fangRow.focus, {
      apply(target, thisArg, args) {
        detailTextAtFocusTime = detail.textContent;
        return Reflect.apply(target, thisArg, args);
      },
    });
    // ArrowDown from the checked hide row lands on the very next row (fang,
    // the general catalog's fixed row order).
    hideRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(fangRow);
    expect(detail.textContent).not.toBe(beforeText);
    // The description was already rewritten by the time focus() ran.
    expect(detailTextAtFocusTime).toBe(detail.textContent);
    expect(detailTextAtFocusTime).not.toBe(beforeText);
  });

  it('draft changes never commit; only Apply calls onCommit, exactly once', () => {
    const container = makeContainer();
    const onCommit = vi.fn();
    renderHarvestPreferencePicker(
      container,
      { preference: { kind: 'all' } },
      { onDraftChange: vi.fn(), onCommit, onDismiss: vi.fn() },
    );
    radioRowFor(container, 'rough_hide').click();
    expect(onCommit).not.toHaveBeenCalled();
    const applyButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.dataset.focusKey === 'apply',
    )!;
    applyButton.click();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('rough_hide');
    // A stray second click on the same terminal render must not double-commit.
    applyButton.click();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
