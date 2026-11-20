// PURE: a character drawn sunk into water it stands in (CharacterVisual
// setWaterSink; the Quench's holes are the first caller,
// ../smith_heart_fx/quench_glaze_core.ts quenchSinkOf). Presentation only:
// the sim keeps the body's feet where they are.

/** One frame's ease of a drawn sink toward its target (yards): quick into the
 *  water, a little slower out of it (the climb), settling exactly. */
export function easeSink(current: number, target: number, dt: number): number {
  const rate = target > current ? 7 : 4;
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  const next = current + (target - current) * k;
  return Math.abs(next - target) < 0.002 ? target : next;
}
