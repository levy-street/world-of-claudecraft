// The renderer's memory of each Smith's Heart claim's final boss: whether
// the Masterless Strength has fallen and since when, so the Heart's room
// (heart_interior.ts: the core in the chasm, the rune rings, the altars and
// the roots, the channels) goes dark as its heart does. The final boss's
// effects (../smith_heart_fx/final_fx.ts, which reads the boss from IWorld)
// write it; the interior's frame driver, which has no world, reads it. A
// death first seen already settled snaps dark. Keyed like the seal memory
// (heart_seal_core.ts `heartSealSlotKey`).
//
// Pure and Three-free (the clock is passed in, render seconds).

const memory = new Map<string, number>();

/** The final boss of slot `key` fell at render time `since` (or lives:
 *  null). */
export function noteHeartFinalDeath(key: string, since: number | null): void {
  if (since === null) memory.delete(key);
  else memory.set(key, since);
}

/** When the heart starts going dark after the fall, and how long it takes
 *  (the body's own fall, final_fx_core.ts DEATH). */
export const HEART_FINAL_DARK = { at: 2.0, seconds: 1.6 } as const;

/** How dark the slot's heart is at `now` (0 burning, 1 dark). */
export function heartFinalDarkness(key: string, now: number): number {
  const since = memory.get(key);
  if (since === undefined) return 0;
  const t = (now - since - HEART_FINAL_DARK.at) / HEART_FINAL_DARK.seconds;
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Forget every slot (tests). */
export function clearHeartFinalMemoryForTest(): void {
  memory.clear();
}
