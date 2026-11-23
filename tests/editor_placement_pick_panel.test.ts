// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlacementPickPanel } from '../src/editor/3d/placement_pick_panel';

const rows = [
  { index: 2, label: 'Front wall' },
  { index: 9, label: 'Small doorway' },
];
afterEach(() => document.body.replaceChildren());

describe('named overlapping asset chooser', () => {
  it('previews keyboard-focused rows, selects on click and prevents editor shortcuts leaking', () => {
    const choose = vi.fn();
    const preview = vi.fn();
    const panel = new PlacementPickPanel(document.body, choose, preview);
    panel.update(rows, 2);
    const button = panel.root.querySelector('button')!;
    button.click();
    const choices = panel.root.querySelectorAll('.ed-pick-list button');
    expect(document.activeElement).toBe(choices[0]);
    expect(preview).toHaveBeenLastCalledWith(2);
    const global = vi.fn();
    window.addEventListener('keydown', global);
    choices[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(choices[1]);
    expect(preview).toHaveBeenLastCalledWith(9);
    for (const [key, selected] of [
      ['ArrowDown', 0],
      ['ArrowUp', 1],
      ['Home', 0],
      ['End', 1],
    ] as const) {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      expect(document.activeElement).toBe(choices[selected]);
    }
    expect(global).not.toHaveBeenCalled();
    choices[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(global).not.toHaveBeenCalled();
    (choices[1] as HTMLButtonElement).click();
    expect(choose).toHaveBeenCalledWith(9, false);
    expect(panel.isOpen).toBe(true);
    expect(choices[1].getAttribute('aria-pressed')).toBe('true');
    window.removeEventListener('keydown', global);
    panel.dispose();
  });

  it('keeps previous and next choices available and marks the current item', () => {
    const choose = vi.fn();
    const panel = new PlacementPickPanel(document.body, choose, vi.fn());
    panel.update(rows, 2, true);
    panel.root.querySelector<HTMLButtonElement>('[data-pick-action="next"]')!.click();
    expect(choose).toHaveBeenLastCalledWith(9, false);
    expect(panel.root.querySelector('[data-pick-count]')?.textContent).toContain('2');
    panel.root.querySelector<HTMLButtonElement>('[data-pick-action="previous"]')!.click();
    expect(choose).toHaveBeenLastCalledWith(2, false);
    panel.update([{ index: 31, label: 'Unrelated tower' }], 31);
    expect(panel.root.querySelector('[role="status"]')?.textContent).toContain('Front wall');
  });

  it('closes with Escape without changing selection and invalidates stale rows', () => {
    const choose = vi.fn();
    const panel = new PlacementPickPanel(document.body, choose, vi.fn());
    panel.update(rows, 2, true);
    panel.open();
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(panel.isOpen).toBe(false);
    expect(choose).not.toHaveBeenCalled();
    panel.hide();
    panel.open();
    expect(panel.isOpen).toBe(false);
    expect(panel.root.hidden).toBe(true);
  });

  it('keeps the last clicked overlap reachable through empty space and supports additive choice', () => {
    const choose = vi.fn();
    const panel = new PlacementPickPanel(document.body, choose, vi.fn());
    expect(panel.update(rows, 2, true)).toBe(true);
    expect(panel.update([], null)).toBe(false);
    expect(panel.update([{ index: 31, label: 'Neighbouring tower' }], 31)).toBe(false);
    panel.open();
    const choices = panel.root.querySelectorAll('.ed-pick-list button');
    expect(choices[1].textContent).toContain('Small doorway');
    choices[1].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    expect(choose).toHaveBeenCalledWith(9, true);
    panel.setOutline({ left: 1, top: 2, width: 30, height: 40 }, true);
    expect(document.querySelector('.ed-pick-outline')?.getAttribute('data-behind')).toBe('true');
    panel.hide();
    expect((document.querySelector('.ed-pick-outline') as HTMLElement).hidden).toBe(true);
  });

  it('keeps pinned overlaps across empty hover but hides the stale target after an empty click', () => {
    const panel = new PlacementPickPanel(document.body, vi.fn(), vi.fn());
    panel.update(rows, 2, true);
    panel.update([], null);
    expect(panel.root.hidden).toBe(false);
    panel.update([], null, true);
    expect(panel.root.hidden).toBe(true);
    panel.open();
    expect(panel.isOpen).toBe(false);
    panel.dispose();
  });

  it('does not repeat live announcements for an unchanged target and restores focus on invalidation', async () => {
    const focus = document.createElement('button');
    document.body.append(focus);
    const panel = new PlacementPickPanel(document.body, vi.fn(), vi.fn(), () => focus.focus());
    panel.update(rows, 2);
    const status = panel.root.querySelector('[role="status"]')!;
    const changed = vi.fn();
    const observer = new MutationObserver(changed);
    observer.observe(status, { childList: true, subtree: true, characterData: true });
    panel.update(rows, 2);
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
    panel.open();
    panel.hide();
    expect(document.activeElement).toBe(focus);
    observer.disconnect();
  });
  it('shows floor visibility explicitly and lets the user reveal higher items', () => {
    const changed = vi.fn();
    const panel = new PlacementPickPanel(document.body, vi.fn(), vi.fn(), vi.fn(), changed);
    panel.update(rows, 2, true);
    panel.setFloorVisibility(1, true);
    const input = panel.root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(input.checked).toBe(true);
    expect(input.parentElement?.hidden).toBe(false);
    input.click();
    expect(changed).toHaveBeenCalledWith(false);
    panel.setFloorVisibility(null, false);
    expect(input.parentElement?.hidden).toBe(true);
  });

  it('distinguishes identical names using level, identity and current elevation', () => {
    const panel = new PlacementPickPanel(document.body, vi.fn(), vi.fn());
    panel.update(
      [
        { index: 1, label: 'Wall', details: 'Item 2 · Floor 1 · Height 0' },
        { index: 4, label: 'Wall', details: 'Item 5 · Floor 3 · Height 12' },
      ],
      1,
      true,
    );
    panel.open();
    expect(panel.root.querySelectorAll('.ed-pick-list button')[1].textContent).toContain(
      'Height 12',
    );
    panel.setSelected(4, { index: 4, label: 'Wall', details: 'Item 5 · Floor 3 · Height 14' });
    expect(panel.root.querySelector('.ed-pick-hint')?.textContent).toContain('Height 14');
  });
});
