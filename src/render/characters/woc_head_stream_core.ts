// The pure half of streaming the SPLIT WOC head library (woc_head_catalog.ts
// wocHeadCoreUrl / wocHeadPieceUrl / wocHeadLookUrls): which files a creator's
// slot prefetch fetches, which files a stored appearance's head needs, and which
// look a live head DRAWS while a newly picked hairstyle or beard is still
// streaming. Three-free and DOM-free, so the dressing (woc_head_dressing.ts, which
// applies the going-live rule below over its own hung files) stays a thin consumer
// and a Vitest pins the rules directly.
//
// The streaming rules, in one place:
//   - A head goes LIVE only once EVERY file of the look it wants is ready: the
//     core AND its hairstyle's file AND its facial hair's file. A character never
//     shows bald, then pops its hair.
//   - A body file ends at the neck and has no head of its own, so a body WAITS
//     for its head (wocHeadAwaited): the world view does not build a character
//     while its look's files are on the wire, and a body built directly (a
//     preview) draws nothing until its head is live. Only a file that FAILED to
//     load ends the wait, so a dead request can never hide a character: that
//     body draws without its head, and the head hangs when a retry lands.
//   - A live head whose look changes to a hairstyle or beard whose file is not
//     ready yet keeps drawing the one it drew before for that slot, until the
//     new file is hung and revealed, then swaps. Every other slot rides the core
//     (always ready on a live head), so it swaps at once.
//   - Bald and clean shaven have no file at all: always ready.
//   - The bald crown and the scalp tucks follow the DRAWN hairstyle, never the
//     picked one, so a held style keeps its own fitted scalp under it.
import { type ModularAppearance, normalizeAppearance, wocHeadLookOf } from './modular';
import {
  WOC_HEAD_BALD_CROWN_MORPH,
  WOC_HEAD_TYPES,
  type WocHeadLook,
  type WocHeadSlot,
  type WocHeadType,
  wocHeadLookUrls,
  wocHeadPieceUrl,
  wocHeadTuckMorph,
} from './woc_head_catalog';
import {
  type WocHeadAppearanceInput,
  type WocHeadLookState,
  wocHeadBaldCrownWeight,
} from './woc_head_look_core';

/** The slots whose variants ship in files of their own; every other slot rides the core. */
export const WOC_HEAD_STREAMED_SLOTS: readonly WocHeadSlot[] = ['hair', 'beard'];

/**
 * The files the head of a stored appearance draws on a `type` body: the core plus
 * its hairstyle's and facial hair's files, the look resolved exactly as
 * wocHeadLookFromAppearance resolves it (normalized, then this type's default for a
 * pick the type does not offer; no appearance at all is the type's default look).
 * What a host fetches BEFORE it builds the body (the world view, a portrait), so the
 * head is ready with it.
 */
export function wocHeadAppearanceUrls(app: WocHeadAppearanceInput, type: WocHeadType): string[] {
  const look = app ? wocHeadLookOf(normalizeAppearance(app as Partial<ModularAppearance>)) : null;
  return wocHeadLookUrls(type, look);
}

/**
 * Every file one slot's variants ship in for a type, deduplicated in catalog order:
 * each hairstyle's own file, the shared beards file plus every beard with a file of
 * its own, or the core for a slot that rides it. Bald and clean shaven add nothing.
 * The face builder fetches exactly these when the slot's category opens.
 */
export function wocHeadSlotUrls(type: WocHeadType, slot: WocHeadSlot): string[] {
  const out = new Set<string>();
  for (const v of WOC_HEAD_TYPES[type].slots[slot]) {
    const url = wocHeadPieceUrl(type, slot, v.id);
    if (url) out.add(url);
  }
  return [...out];
}

/**
 * The look a LIVE head draws for the look it wants (`want`, resolved), given the
 * look it drew before (`prev`): `want` itself, except that a hairstyle or beard
 * whose file is not ready keeps `prev`'s variant for that slot. Returns `want`
 * itself (the same object) when nothing is held.
 */
export function wocHeadDrawnLook(
  type: WocHeadType,
  want: WocHeadLook,
  prev: WocHeadLook,
  ready: (url: string) => boolean,
): WocHeadLook {
  let out = want;
  for (const slot of WOC_HEAD_STREAMED_SLOTS) {
    if (want[slot] === prev[slot]) continue;
    const url = wocHeadPieceUrl(type, slot, want[slot]);
    if (url === null || ready(url)) continue;
    if (out === want) out = { ...want };
    out[slot] = prev[slot];
  }
  return out;
}

/**
 * The morph influences a head draws for a look state: the state's own (the face
 * controls), with the bald crown and every scalp tuck of the type following the
 * DRAWN hairstyle (`drawn.hair`, a held one while the picked style streams), and
 * the crown raised under a hair-hiding helm (wocHeadBaldCrownWeight). Equal to
 * the state's own morphs whenever the drawn hair is the picked one and no helm is
 * worn.
 */
export function wocHeadDrawnMorphs(
  state: WocHeadLookState,
  drawn: WocHeadLook,
  hairHidden: boolean,
): Record<string, number> {
  const out: Record<string, number> = { ...state.morphs };
  out[WOC_HEAD_BALD_CROWN_MORPH] = wocHeadBaldCrownWeight(drawn, hairHidden);
  const tuck = drawn.hair === 'bald' ? null : wocHeadTuckMorph(drawn.hair);
  for (const v of WOC_HEAD_TYPES[state.type].slots.hair) {
    if (v.id === 'bald') continue;
    const name = wocHeadTuckMorph(v.id);
    out[name] = name === tuck ? 1 : 0;
  }
  return out;
}

/** One head file as a body waiting on it sees it: `resident` (ready to draw), `loading`
 *  (on the wire, or hung and still linking), `idle` (not asked for yet: the next poll
 *  fetches it) or `failed` (its fetch failed and sits in the retry cooldown, or it
 *  cannot hang on this body at all). */
export type WocHeadFileState = 'resident' | 'loading' | 'idle' | 'failed';

/**
 * Whether a body still waits for its head, given the state of every file its look
 * draws: true while any of them is not ready and none has failed. A failed file ends
 * the wait at once (the body draws without its head rather than hide behind a dead
 * request); a look whose files are all resident has nothing left to wait for.
 */
export function wocHeadAwaited(states: readonly WocHeadFileState[]): boolean {
  let waiting = false;
  for (const state of states) {
    if (state === 'failed') return false;
    if (state !== 'resident') waiting = true;
  }
  return waiting;
}
