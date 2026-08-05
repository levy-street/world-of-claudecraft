// @vitest-environment happy-dom
import './_setup';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import LocationCell from '../../src/admin/components/LocationCell.svelte';
import { t } from '../../src/admin/i18n';

const dungeon = {
  kind: 'dungeon' as const,
  zoneId: 'shadowfen',
  zone: 'Shadowfen',
  instanceId: 'sf-1',
  instance: 'Sunken Crypt',
  instanceSlot: null,
  poiIndex: null,
  poi: null,
  poiDistance: null,
};

describe('LocationCell', () => {
  it('shows the coordinates and describes the full location for assistive tech', () => {
    render(LocationCell, { location: dungeon, x: 12, z: 34, zone: 'shadowfen' });
    expect(screen.getByText('12, 34')).toBeInTheDocument();
    expect(screen.getByLabelText(/Shadowfen/)).toBeInTheDocument();
  });

  it('opens the details on hover with FIXED offsets, so a scroll container cannot clip it', async () => {
    const { container } = render(LocationCell, {
      location: dungeon,
      x: 12,
      z: 34,
      zone: 'shadowfen',
    });
    const cell = container.querySelector('.location-cell');
    if (!cell) throw new Error('location cell not found');
    expect(container.querySelector('.location-tooltip')).toBeNull();

    await fireEvent.pointerEnter(cell);
    const tooltip = container.querySelector('.location-tooltip');
    if (!tooltip) throw new Error('tooltip not rendered on hover');
    expect(tooltip).toHaveTextContent(t('location.instance', { value: 'Sunken Crypt' }));
    // The offsets are viewport offsets, which only work with fixed positioning: an
    // absolutely positioned tooltip is exactly what the horizontal scroll container
    // clipped. jsdom does not apply the scoped <style>, so the rule itself is pinned
    // from the source below.
    expect(tooltip.getAttribute('style')).toMatch(/right: \d+px/);
    expect(tooltip.getAttribute('style')).toMatch(/(top|bottom): \d+px/);
    // The arrow rides on the same computation, so it keeps pointing at the cell when
    // an edge guard moves the tooltip off its right-aligned position.
    expect(tooltip.getAttribute('style')).toMatch(/--arrow-right: \d+px/);

    await fireEvent.pointerLeave(cell);
    expect(container.querySelector('.location-tooltip')).toBeNull();
  });

  it('takes focus from the keyboard, and opens and closes the details on it', async () => {
    const { container } = render(LocationCell, { location: null, x: 5, z: 6, zone: 'greenhollow' });
    const cell = container.querySelector<HTMLElement>('.location-cell');
    if (!cell) throw new Error('location cell not found');

    // The cell renders only text, so without a tabindex of its own nothing here can
    // ever take focus and focusin never fires from real keyboard navigation. Driving
    // the tooltip through a REAL focus() is what makes the rest of this case mean
    // anything: a dispatched focusin would pass against a cell no one can tab to.
    expect(cell.tabIndex).toBe(0);
    cell.focus();
    expect(document.activeElement).toBe(cell);
    await tick();
    expect(container.querySelector('.location-tooltip')).not.toBeNull();

    cell.blur();
    await tick();
    expect(container.querySelector('.location-tooltip')).toBeNull();
  });

  it('dismisses the details on Escape, which is the only way out for a focused cell', async () => {
    const { container } = render(LocationCell, {
      location: dungeon,
      x: 1,
      z: 2,
      zone: 'shadowfen',
    });
    const cell = container.querySelector<HTMLElement>('.location-cell');
    if (!cell) throw new Error('location cell not found');

    cell.focus();
    await tick();
    expect(container.querySelector('.location-tooltip')).not.toBeNull();

    await fireEvent.keyDown(cell, { key: 'Escape' });
    expect(container.querySelector('.location-tooltip')).toBeNull();
    // Escape dismisses the tooltip without stealing focus off the cell.
    expect(document.activeElement).toBe(cell);
  });

  it('dismisses the details on scroll and resize, so a fixed tooltip cannot drift', async () => {
    const { container } = render(LocationCell, {
      location: dungeon,
      x: 1,
      z: 2,
      zone: 'shadowfen',
    });
    const cell = container.querySelector<HTMLElement>('.location-cell');
    if (!cell) throw new Error('location cell not found');

    await fireEvent.pointerEnter(cell);
    expect(container.querySelector('.location-tooltip')).not.toBeNull();
    // Dispatched on the cell, and a scroll event does not bubble: only a CAPTURE
    // listener on window sees it, which is what covers the table's own scroller.
    cell.dispatchEvent(new Event('scroll'));
    await tick();
    expect(container.querySelector('.location-tooltip')).toBeNull();

    await fireEvent.pointerEnter(cell);
    expect(container.querySelector('.location-tooltip')).not.toBeNull();
    window.dispatchEvent(new Event('resize'));
    await tick();
    expect(container.querySelector('.location-tooltip')).toBeNull();
  });

  it('stops listening for scroll once the details are closed', async () => {
    const removed = new Set<string>();
    const spy = vi.spyOn(window, 'removeEventListener');
    const { container, unmount } = render(LocationCell, {
      location: dungeon,
      x: 1,
      z: 2,
      zone: 'shadowfen',
    });
    const cell = container.querySelector<HTMLElement>('.location-cell');
    if (!cell) throw new Error('location cell not found');

    await fireEvent.pointerEnter(cell);
    await fireEvent.pointerLeave(cell);
    await tick();
    for (const call of spy.mock.calls) removed.add(String(call[0]));
    expect(removed).toEqual(new Set(['scroll', 'resize']));
    unmount();
    spy.mockRestore();
  });

  it('positions the tooltip fixed, out of any scroll container it renders inside', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/admin/components/LocationCell.svelte'),
      'utf8',
    );
    expect(source).toMatch(/\.location-tooltip\s*\{[^}]*position:\s*fixed/);
    expect(source).not.toMatch(/\.location-tooltip\s*\{[^}]*position:\s*absolute/);
  });
});
