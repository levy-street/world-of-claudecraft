// When each Deepglass spectator throws its next cheer, and which one.
//
// Pure policy, no Three and no renderer state, so the cadence is testable and
// the renderer half stays a loop that plays what this returns.
//
// The shape of the problem: twenty-three bodies standing in a bowl, all with
// the same three cheer clips. Fire them on a shared timer and the stand claps
// in military unison, which reads as a bug rather than a crowd. So every
// spectator gets its own phase and its own gap from a hash of its entity id:
// deterministic (the same body cheers on the same beat every session), stable
// across a rebuild, and free of any shared counter.

/** Emote ids the crowd draws from. All four resolve to Cheer-family clips on
 *  the KayKit rigs the composed spectators wear (characters/manifest.ts). */
export type CrowdCheerEmote = 'cheer' | 'clap' | 'roar' | 'wave';

const CHEER_EMOTES: readonly CrowdCheerEmote[] = ['cheer', 'clap', 'cheer', 'roar', 'clap', 'wave'];

/** Seconds between one body's cheers. Long enough that a given spectator is
 *  mostly just standing (the crowd should idle, not spasm), short enough that
 *  the stand as a whole always has several people going. */
export const CHEER_GAP_MIN = 3.5;
export const CHEER_GAP_MAX = 11;

/** Cheap deterministic hash of an entity id to [0, 1).
 *
 *  Every step re-coerces with `>>> 0`, the last one included: `^` in JS yields
 *  a SIGNED 32-bit int, so without the final coercion this returned negatives
 *  and a spectator could come up with a sub-minimum gap (caught by the cadence
 *  test, which is why that test asserts the window rather than just the mean). */
function hash01(id: number, salt: number): number {
  let h = Math.imul(id ^ salt, 0x27d4eb2d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}

/**
 * The clock reading at which `id` should cheer next, given the current time.
 * Called both to seed a body (`now` at spawn) and to re-arm it after a cheer.
 */
export function nextCheerTime(id: number, now: number, round: number): number {
  const gap = CHEER_GAP_MIN + hash01(id, round * 0x9e37 + 17) * (CHEER_GAP_MAX - CHEER_GAP_MIN);
  return now + gap;
}

/** A spectator's first cheer is spread across one whole gap window, so a
 *  freshly spawned crowd does not open with everyone cheering at once. */
export function firstCheerTime(id: number, now: number): number {
  return now + hash01(id, 5) * CHEER_GAP_MAX;
}

/** Which cheer this body throws this time. */
export function pickCheerEmote(id: number, round: number): CrowdCheerEmote {
  const i = Math.floor(hash01(id, round * 0x2545 + 3) * CHEER_EMOTES.length);
  return CHEER_EMOTES[Math.min(CHEER_EMOTES.length - 1, i)];
}
