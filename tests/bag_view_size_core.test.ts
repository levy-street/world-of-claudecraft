import { describe, expect, it } from 'vitest';
import {
  BAG_VIEW_SIZES,
  bagViewSizeClass,
  DEFAULT_BAG_VIEW_SIZE,
  parseBagViewSize,
} from '../src/ui/bag_view_size_core';

describe('bag view size core', () => {
  it('pins the sizes in menu order, defaulting to the classic compact grid', () => {
    expect([...BAG_VIEW_SIZES]).toEqual(['compact', 'large', 'list']);
    expect(DEFAULT_BAG_VIEW_SIZE).toBe('compact');
  });

  it('parses every known size back to itself', () => {
    for (const size of BAG_VIEW_SIZES) expect(parseBagViewSize(size)).toBe(size);
  });

  it('falls back to compact for a missing, unknown, or malformed stored value', () => {
    expect(parseBagViewSize(null)).toBe('compact');
    expect(parseBagViewSize(undefined)).toBe('compact');
    expect(parseBagViewSize('')).toBe('compact');
    expect(parseBagViewSize('huge')).toBe('compact');
    expect(parseBagViewSize('LIST')).toBe('compact');
    expect(parseBagViewSize('{"size":"list"}')).toBe('compact');
  });

  it('maps each size to the grid class the stylesheet keys off', () => {
    expect(bagViewSizeClass('compact')).toBe('bag-size-compact');
    expect(bagViewSizeClass('large')).toBe('bag-size-large');
    expect(bagViewSizeClass('list')).toBe('bag-size-list');
  });
});
