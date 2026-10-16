// The pure half of streaming the SPLIT WOC head library (woc_head_catalog.ts
// wocHeadCoreUrl / wocHeadPieceUrl / wocHeadLookUrls): which files a creator's
// slot prefetch fetches, which files a stored appearance's head needs, which
// piece nodes a look draws out of each file, when a head goes live, and which
// look a live head DRAWS while a piece it wants is still on its way. Three-free
// and DOM-free, so the dressing (woc_head_dressing.ts, which applies the rules
// below over its own hung pieces) stays a thin consumer and a Vitest pins the
// rules directly.
//
// The streaming rules, in one place:
//   - A body hangs only the pieces its look draws (wocHeadLookPieces): the rest of
//     the library stays out of its scene graph. "Ready" below is said of a PIECE
//     NODE: hung on the body and its programs linked.
//   - Going live has two modes (wocHeadLiveLook). WHOLE LOOK, the default (a
//     preview, a portrait, the face builder): only once every piece of the look is
//     ready, the core's AND its hairstyle's AND its facial hair's. Such a character
//     never shows bald, then pops its hair, and until then its body WAITS
//     (wocHeadAwaited): a body file ends at the neck, so a body built directly
//     draws nothing until its head is live. Only a file that FAILED to load ends
//     that wait, so a dead request can never hide a character.
//   - BARE STAND-IN, the world view's opt-in: a body in the world never waits on a
//     hairstyle or a beard. Its head goes live as soon as the core's own pieces of
//     the look are ready, drawing the look with whichever of its hairstyle and
//     facial hair are ready too. One still on the wire, or one whose fetch failed,
//     is simply not drawn yet (the bare head is the stand-in) and joins through the
//     slot hold below once its file is hung and revealed. A failed file never
//     hides, beheads or delays a body.
//   - A live head whose look changes to a variant whose pieces are not ready yet
//     keeps drawing the one it drew before for that slot, until the new pieces are
//     hung and revealed, then swaps (wocHeadDrawnLook). Every slot holds this way,
//     the piercing preset too: a face piece picked in the builder is hung on demand
//     like a hairstyle, it only lands sooner (its file is the core, always there).
//   - Bald and clean shaven have no piece at all: always ready.
//   - The bald crown and the scalp tucks follow the DRAWN hairstyle, never the
//     picked one, so a held style keeps its own fitted scalp under it, and a head
//     standing in bare wears the bald crown.
import { type ModularAppearance, normalizeAppearance, wocHeadLookOf } from './modular';
import {
  WOC_HEAD_BALD_CROWN_MORPH,
  WOC_HEAD_SLOTS,
  WOC_HEAD_TYPES,
  WOC_PIERCING_PRESETS,
  WOC_PIERCING_SITES,
  type WocHeadLook,
  type WocHeadSlot,
  type WocHeadType,
  wocHeadBaseNode,
  wocHeadCoreUrl,
  wocHeadLookUrls,
  wocHeadPieceUrl,
  wocHeadPiercingNode,
  wocHeadTuckMorph,
  wocHeadVariantNodes,
  wocHeadVisibleNodes,
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
 * The piece nodes a look draws out of each file of the split library, by file url in
 * wocHeadLookUrls order (the core first): everything a body wearing `look` hangs, and
 * nothing else of the library. A worn helm is NOT taken off here: the hairstyle it
 * hides stays hung (hidden), so taking the helm off is a visibility flag and a
 * portrait can show the hair it was prepared with.
 */
export function wocHeadLookPieces(type: WocHeadType, look: WocHeadLook): Map<string, string[]> {
  const core = wocHeadCoreUrl(type);
  const out = new Map<string, string[]>([[core, [wocHeadBaseNode(type)]]]);
  const add = (url: string, nodes: readonly string[]): void => {
    if (nodes.length === 0) return;
    const list = out.get(url);
    if (list) list.push(...nodes);
    else out.set(url, [...nodes]);
  };
  for (const slot of WOC_HEAD_SLOTS) {
    add(
      wocHeadPieceUrl(type, slot, look[slot]) ?? core,
      wocHeadVariantNodes(type, slot, look[slot]),
    );
  }
  add(
    core,
    (WOC_PIERCING_PRESETS[look.piercing] ?? []).map((site) => wocHeadPiercingNode(type, site)),
  );
  return out;
}

const pieceFiles = new Map<WocHeadType, ReadonlyMap<string, string>>();

/**
 * The file each piece node of a type's library ships in, for every node the catalog
 * names (woc_head_catalog.ts wocHeadAllNodes). What turns a set of drawn node names
 * (the far bake's part set) back into the files to hang them from.
 */
export function wocHeadPieceFiles(type: WocHeadType): ReadonlyMap<string, string> {
  let out = pieceFiles.get(type);
  if (out) return out;
  const core = wocHeadCoreUrl(type);
  const files = new Map<string, string>([[wocHeadBaseNode(type), core]]);
  for (const slot of WOC_HEAD_SLOTS) {
    for (const v of WOC_HEAD_TYPES[type].slots[slot]) {
      const url = wocHeadPieceUrl(type, slot, v.id) ?? core;
      for (const node of wocHeadVariantNodes(type, slot, v.id)) files.set(node, url);
    }
  }
  for (const site of WOC_PIERCING_SITES) files.set(wocHeadPiercingNode(type, site), core);
  out = files;
  pieceFiles.set(type, out);
  return out;
}

/**
 * A look with nothing drawn in the slots whose variants ship in files of their own
 * (WOC_HEAD_STREAMED_SLOTS): bald and clean shaven, every core slot as picked. What a
 * head standing in bare draws for a hairstyle and a beard it does not have yet.
 * Returns `look` itself (the same object) when it already is bare.
 */
export function wocHeadBareLook(type: WocHeadType, look: WocHeadLook): WocHeadLook {
  let out = look;
  for (const slot of WOC_HEAD_STREAMED_SLOTS) {
    if (wocHeadVariantNodes(type, slot, look[slot]).length === 0) continue;
    const none = WOC_HEAD_TYPES[type].slots[slot].find(
      (v) => wocHeadVariantNodes(type, slot, v.id).length === 0,
    );
    if (!none) continue;
    if (out === look) out = { ...look };
    out[slot] = none.id;
  }
  return out;
}

/**
 * The look a LIVE head draws for the look it wants (`want`, resolved), given the
 * look it drew before (`prev`): `want` itself, except that a slot whose wanted
 * variant has a piece node not ready yet (`ready`: hung and revealed) keeps `prev`'s
 * variant, and the piercing preset keeps `prev`'s the same way. Returns `want`
 * itself (the same object) when nothing is held.
 */
export function wocHeadDrawnLook(
  type: WocHeadType,
  want: WocHeadLook,
  prev: WocHeadLook,
  ready: (node: string) => boolean,
): WocHeadLook {
  let out = want;
  for (const slot of WOC_HEAD_SLOTS) {
    if (want[slot] === prev[slot]) continue;
    if (wocHeadVariantNodes(type, slot, want[slot]).every(ready)) continue;
    if (out === want) out = { ...want };
    out[slot] = prev[slot];
  }
  if (want.piercing !== prev.piercing) {
    const sites = WOC_PIERCING_PRESETS[want.piercing] ?? [];
    if (!sites.every((site) => ready(wocHeadPiercingNode(type, site)))) {
      if (out === want) out = { ...want };
      out.piercing = prev.piercing;
    }
  }
  return out;
}

/**
 * The look a head that is not live yet goes live on, or null while it cannot.
 *
 * Whole look (`bareStandIn` false, the default: a preview, a portrait, the face
 * builder): `want` itself, and only once EVERY piece of it is ready.
 *
 * Bare stand-in (the world view): as soon as the core's own pieces of the look are
 * ready (the head, its nose, lips, brows, ears, eyes and piercings), `want` with a
 * hairstyle or a beard that is not ready yet left off. Whatever is left off joins
 * later through wocHeadDrawnLook, exactly as a later pick does. Null only while the
 * core itself is missing: there is no head to draw at all.
 */
export function wocHeadLiveLook(
  type: WocHeadType,
  want: WocHeadLook,
  ready: (node: string) => boolean,
  bareStandIn: boolean,
): WocHeadLook | null {
  const first = bareStandIn ? wocHeadBareLook(type, want) : want;
  for (const node of wocHeadVisibleNodes(type, first, { helm: false })) {
    if (!ready(node)) return null;
  }
  return bareStandIn ? wocHeadDrawnLook(type, want, first, ready) : want;
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
 * request); a look whose files are all resident has nothing left to wait for. The
 * WHOLE LOOK mode's rule: a head standing in bare never makes its body wait.
 */
export function wocHeadAwaited(states: readonly WocHeadFileState[]): boolean {
  let waiting = false;
  for (const state of states) {
    if (state === 'failed') return false;
    if (state !== 'resident') waiting = true;
  }
  return waiting;
}

/**
 * Whether a head is at rest as far as one file of its look goes: the file is drawn
 * (`resident`), or it will not be until a retry lands (`failed`, or it cannot hang). A
 * file on its way, or one nobody asked for yet, is about to change the drawn head (a
 * hairstyle joining a bare head, a pick swapping in). The merged stand-in is built only
 * for a head at rest in EVERY file of its look: it is an optimization of a head sure to
 * stay.
 */
export function wocHeadFileSettled(state: WocHeadFileState): boolean {
  return state === 'resident' || state === 'failed';
}

/**
 * Whether a file in this state is ON ITS WAY to a head that wants it: on the wire, or
 * landed and still to be hung and linked. The far bake of a body waits while a file of
 * its head is (it would bake the bare head, then bake again the moment the hairstyle
 * joined). Narrower than "not settled" on purpose: a file nobody asked for is not on
 * its way, and a far bake must never wait on a fetch that was not started (whoever
 * draws a head asks for its files first; a body that was never asked about bakes as it
 * is).
 */
export function wocHeadFileJoining(state: WocHeadFileState): boolean {
  return state === 'loading';
}
