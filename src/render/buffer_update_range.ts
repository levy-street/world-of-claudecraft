// One reused update range per buffer attribute: a producer that rewrites part
// of a dynamic buffer every frame marks what it wrote here instead of calling
// addUpdateRange, which pushes a fresh object per call. Three clears the list
// once it uploads, and it uploads only what it draws, so a range still queued
// (the mesh was hidden or culled that frame) is widened to cover the new one:
// one range per buffer, min to max, and nothing allocated after the first.
import type * as THREE from 'three';

export class BufferUpdateRange {
  private readonly range = { start: 0, count: 0 };

  constructor(private readonly attribute: THREE.BufferAttribute) {}

  /** Queues `count` array elements from `start` for the next upload. */
  mark(start: number, count: number): void {
    const ranges = this.attribute.updateRanges;
    const range = this.range;
    if (ranges.length === 1 && ranges[0] === range) {
      const end = Math.max(range.start + range.count, start + count);
      range.start = Math.min(range.start, start);
      range.count = end - range.start;
    } else {
      this.attribute.clearUpdateRanges();
      range.start = start;
      range.count = count;
      ranges.push(range);
    }
    this.attribute.needsUpdate = true;
  }
}
