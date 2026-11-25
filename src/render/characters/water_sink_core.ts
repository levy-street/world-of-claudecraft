// PURE: a character drawn sunk into water it stands in (CharacterVisual
// setWaterSink; the Quench's holes are the first caller,
// ../smith_heart_fx/quench_glaze_core.ts quenchSinkOf). Presentation only:
// the sim keeps the body's feet where they are.

/** Does a body drawn sunk `target` yards into water TREAD it (the swim
 *  latch's upright tread pose, its weapon stowed) instead of standing in it?
 *  Always, once it sinks at all: the team's playtest of 2026-11-25 read a
 *  standing body sunk in a Quench hole as one sunk into the ground "up to the
 *  hips instead of swimming". The tread's own sink (visual.ts SWIM_RISE_TREAD)
 *  rides on top of this one, as it does in deep water. */
export function treadsWater(target: number): boolean {
  return target > 0;
}

/** One frame's ease of a drawn sink toward its target (yards): quick into the
 *  water, a little slower out of it (the climb), settling exactly. */
export function easeSink(current: number, target: number, dt: number): number {
  const rate = target > current ? 7 : 4;
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  const next = current + (target - current) * k;
  return Math.abs(next - target) < 0.002 ? target : next;
}
