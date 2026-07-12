import { describe, expect, it } from 'vitest';
import { declutterNameplates, type NameplateAnchor } from '../src/render/nameplate_declutter';

describe('nameplate declutter', () => {
  it('leaves well-separated anchors untouched', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 100, sy: 100 },
      { id: 2, sx: 500, sy: 300 },
    ];
    expect(declutterNameplates(anchors)).toEqual(anchors);
  });

  it('separates two anchors that project to nearly the same spot', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 200, sy: 150 },
      { id: 2, sx: 202, sy: 151 },
    ];
    const out = declutterNameplates(anchors);
    const a = out.find((n) => n.id === 1);
    const b = out.find((n) => n.id === 2);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(Math.abs((a?.sy ?? 0) - (b?.sy ?? 0))).toBeGreaterThanOrEqual(18);
    // horizontal position is untouched, only vertical stacking separates plates
    expect(a?.sx).toBe(200);
    expect(b?.sx).toBe(202);
  });

  it('separates anchors whose wide labels would overlap even though the anchor points are tens of px apart', () => {
    // Two NPCs standing near each other project anchor points ~60px apart
    // horizontally, well beyond a naive point-collision check, but their
    // rendered name labels (100-250px wide, single text line) still overlap.
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 400, sy: 200 },
      { id: 2, sx: 460, sy: 202 },
    ];
    const out = declutterNameplates(anchors);
    const a = out.find((n) => n.id === 1);
    const b = out.find((n) => n.id === 2);
    expect(Math.abs((a?.sy ?? 0) - (b?.sy ?? 0))).toBeGreaterThanOrEqual(18);
  });

  it('stacks a cluster of 3+ overlapping anchors without unbounded growth', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 300, sy: 200 },
      { id: 2, sx: 301, sy: 200 },
      { id: 3, sx: 299, sy: 201 },
    ];
    const out = declutterNameplates(anchors);
    const ys = out.map((n) => n.sy).sort((x, y) => x - y);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(18);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(18);
    expect(ys[2] - ys[0]).toBeLessThan(200);
  });

  it('orders a cluster stably by id regardless of input order', () => {
    const anchors: NameplateAnchor[] = [
      { id: 9, sx: 400, sy: 400 },
      { id: 1, sx: 401, sy: 400 },
    ];
    const reversed: NameplateAnchor[] = [anchors[1], anchors[0]];
    const out1 = declutterNameplates(anchors);
    const out2 = declutterNameplates(reversed);
    const find = (arr: NameplateAnchor[], id: number) => arr.find((n) => n.id === id)?.sy;
    expect(find(out1, 1)).toBe(find(out2, 1));
    expect(find(out1, 9)).toBe(find(out2, 9));
  });

  it('does not mutate the input array elements', () => {
    const anchors: NameplateAnchor[] = [
      { id: 1, sx: 10, sy: 10 },
      { id: 2, sx: 11, sy: 10 },
    ];
    const originalSy = anchors.map((n) => n.sy);
    declutterNameplates(anchors);
    expect(anchors.map((n) => n.sy)).toEqual(originalSy);
  });
});
