/** Pure decisions for a WOC rig's melee swing (CharacterVisual.playAttack): which dual-wield
 *  clip a swing plays, and how long after the swing starts its blade lands.
 *
 * DUAL WIELD. The sim swings each hand as its own damage event and the event carries no hand.
 * A lone swing plays the next half of the two-strike clip (`<clip>#main` / `<clip>#off`, minted
 * at load by clip_split.ts), alternating. Two swings in the SAME render frame are both hands at
 * once (matched weapon speeds keep the two timers on one sim tick for the whole fight, so this
 * is the common case for a rogue): the second swing replaces the half the first one just
 * started with a both-hands clip, cycling ClipMap.dualWieldPair (the X-slash, then the one-two
 * of the whole clip), or the whole two-strike clip on a rig that names none. A third swing in
 * that frame (a Thuggery extra main-hand swing) keeps the pair clip playing.
 *
 * CONTACT. A swing starts on its damage event, so the number, the flinch and the impact sound
 * belong to the moment the blade lands, not the moment the clip starts: ClipMap.contacts lists,
 * per clip, the seconds from its first frame to each blade contact (in hand order), measured off
 * the shipped clips (tests/woc_character.test.ts re-measures them from the GLB).
 *
 * Node-only (RENDER_PURE_CORES): no three.js, no DOM, no clock.
 */

/** The action names a split dual-wield clip is registered under. */
export function dualWieldHalfNames(clip: string): [string, string] {
  return [`${clip}#main`, `${clip}#off`];
}

export interface DualSwingState {
  /** The next lone swing plays the offhand half. */
  offNext: boolean;
  /** Index into ClipMap.dualWieldPair for the next both-hands swing. */
  pairNext: number;
  /** Mixer time of the last dual swing (same value = same render frame). */
  lastTime: number;
  /** Mixer time at which a both-hands clip was last started. */
  pairTime: number;
}

export function newDualSwingState(): DualSwingState {
  return { offNext: false, pairNext: 0, lastTime: -1, pairTime: -1 };
}

export interface DualSwingPick {
  /** The clip to play; null = keep the clip already playing (a third swing in one frame). */
  clip: string | null;
  /** Which blade contact of `clip` this swing's damage belongs to (0 = the first). */
  contact: number;
}

/**
 * The clip a dual-wield swing plays and which of its blade contacts the swing's damage lands
 * on. `clip` is the rig's attackByHand.dualwield clip, `pairs` its ClipMap.dualWieldPair,
 * `has` whether the rig carries a clip (split halves included), `mixerTime` the mixer clock of
 * this call. Mutates `st`.
 */
export function pickDualSwing(
  clip: string,
  pairs: readonly string[] | undefined,
  has: (name: string) => boolean,
  mixerTime: number,
  st: DualSwingState,
): DualSwingPick {
  const [main, off] = dualWieldHalfNames(clip);
  if (!has(main) || !has(off)) return { clip, contact: 0 };
  const sameFrame = st.lastTime === mixerTime;
  st.lastTime = mixerTime;
  if (!sameFrame) {
    const swing = st.offNext ? off : main;
    st.offNext = !st.offNext;
    return { clip: swing, contact: 0 };
  }
  st.offNext = false;
  if (st.pairTime === mixerTime) return { clip: null, contact: 1 };
  st.pairTime = mixerTime;
  const pool = (pairs ?? []).filter(has);
  if (pool.length === 0) return { clip, contact: 1 };
  const pick = pool[st.pairNext % pool.length];
  st.pairNext = (st.pairNext + 1) % pool.length;
  return { clip: pick, contact: 1 };
}

/**
 * Seconds from a swing's start to the blade contact it carries: the `contact`-th listed contact
 * of `clip` (clamped to the last one), divided by the playback `timeScale`; 0 when the clip has
 * no listed contact (the effects then play at once, as before).
 */
export function contactDelaySec(
  contacts: Readonly<Record<string, readonly number[]>> | undefined,
  clip: string | null | undefined,
  contact: number,
  timeScale: number,
): number {
  if (!clip || !contacts || !(timeScale > 0)) return 0;
  const list = contacts[clip];
  if (!list || list.length === 0) return 0;
  const t = list[Math.min(Math.max(0, contact), list.length - 1)];
  return Number.isFinite(t) && t > 0 ? t / timeScale : 0;
}
