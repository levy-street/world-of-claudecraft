// The used JS heap in MB for the hitch tracker's per-frame sample. Chrome-only
// (performance.memory); every other browser reads 0, which the tracker treats
// as unknown. Allocation-free: this runs once per frame while the overlay is up.

const BYTES_PER_MB = 1024 * 1024;

type MemoryPerformance = Performance & { memory?: { usedJSHeapSize?: number } };

export function usedJsHeapMb(): number {
  const memory = (performance as MemoryPerformance).memory;
  const used = memory?.usedJSHeapSize;
  return typeof used === 'number' && used > 0 ? used / BYTES_PER_MB : 0;
}
