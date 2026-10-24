import { quiet } from './helpers.mjs';

export function valid(sample, before, expectedGpu) {
  return (
    sample.submitted > 0 &&
    sample.skips / sample.callbacks < 0.01 &&
    quiet(sample) &&
    [sample.start, ...sample.points, sample.end].every(
      (point) =>
        point.visibility === 'visible' &&
        !point.governor &&
        point.buffer.width === 1920 &&
        point.buffer.height === 1080 &&
        JSON.stringify(point.buffer) === JSON.stringify(before.buffer) &&
        JSON.stringify(point.quality) === JSON.stringify(before.quality) &&
        point.tier === before.tier &&
        expectedGpu.test(point.glRenderer),
    )
  );
}
