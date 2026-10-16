// What a NON-player unit frame shows, resolved once per repaint for every frame
// that can hold one (the target frame, the target-of-target frame, the pet
// frame) so they cannot disagree, plus the matching rule that tells a frame a
// landed portrait is the face it framed. The sibling of player_portrait_core.ts,
// which answers the same two questions for a player.
//
// A character with an authored look (every world NPC, and any mob-kind quest
// character that wears one: src/render/characters/npc_looks.ts) is a class body
// in a face built in the character creator, so its frame draws that face the
// way a player's frame draws theirs: a live headshot, the crest while the
// capture runs. A look wins over committed art. Every other mob keeps its
// committed portrait (target_portrait_view.ts), and anything else its crest.
// No pet wears a look today (no escortee is ever owned), so the pet frame has
// no capture to wait on and the Hud's portrait listeners leave it out.
//
// DOM-free and three-free on purpose: the painter (unit_portrait_painter.ts)
// draws the answer and the Hud supplies the one lookup only the render layer
// owns. The head is a type parameter (the painter binds it) so this core
// imports nothing from the render layer; the whole decision is unit-tested in
// tests/nonplayer_portrait_core.test.ts.

import { MOBS } from '../sim/data';
import type { Entity } from '../sim/types';
import type { PortraitUpdate } from './player_portrait_core';
import { targetPortraitSourceId, targetPortraitUrl } from './target_portrait_view';
import { crestIdForEntity } from './unit_portrait';

/** The skin a look's body is captured in: an authored look names a class body
 *  and a face, never a class-atlas skin, so its headshot is always the default. */
export const FACE_PORTRAIT_SKIN = 0;

/** Who a frame holds, as far as its portrait cares. */
export type PortraitUnit = Pick<Entity, 'templateId' | 'kind'>;

/** The body an authored look is drawn on and the head it wears there. */
export interface FacePortraitSource<Head> {
  readonly visualKey: string;
  readonly head: Head;
}

/** The render-layer lookup the rule needs, injected so this core never imports
 *  the character manifest: null for a unit with no authored look. The entity
 *  kind is part of the question (a mob can share a templateId with an NPC). */
export type FacePortraitLookup<Head> = (
  templateId: string,
  kind: Entity['kind'],
) => FacePortraitSource<Head> | null;

/** What the frame draws, in precedence order. Every outcome carries the crest
 *  it falls back to: while a face is still being captured, and when an image
 *  fails to decode. */
export type NonPlayerPortraitSubject<Head> =
  | { kind: 'face'; crestId: string; visualKey: string; head: Head }
  | { kind: 'art'; crestId: string; url: string }
  | { kind: 'crest'; crestId: string };

export function nonPlayerPortraitSubject<Head>(
  unit: PortraitUnit,
  faceFor: FacePortraitLookup<Head>,
): NonPlayerPortraitSubject<Head> {
  const isMobEntity = unit.kind === 'mob';
  // A transient guardian is no MOBS row: it borrows the family (and the art) of
  // the creature whose body it wears.
  const sourceId = targetPortraitSourceId(unit.templateId, isMobEntity);
  const template = MOBS[unit.templateId] ?? (sourceId ? MOBS[sourceId] : undefined);
  const crestId = crestIdForEntity(unit.kind, template?.family);
  const face = faceFor(unit.templateId, unit.kind);
  if (face) return { kind: 'face', crestId, visualKey: face.visualKey, head: face.head };
  const url = targetPortraitUrl(unit.templateId, isMobEntity);
  return url ? { kind: 'art', crestId, url } : { kind: 'crest', crestId };
}

/**
 * Whether `update` is the portrait `subject` shows, so the frame holding that
 * subject repaints, and no other frame does.
 *
 * Only a face waits on a capture. Its headshot is keyed on the head, and a
 * head-keyed capture reports the (body, skin) pair it was drawn on with no
 * cache key (portrait.ts requestLiveCapture), so every frame holding that body
 * re-asks with its OWN head: a hit for the character the capture was for, a
 * cheap miss for anyone else on the same body. A composed capture always
 * carries a key and is never this subject's.
 */
export function nonPlayerPortraitUpdateFrames<Head>(
  subject: NonPlayerPortraitSubject<Head>,
  update: PortraitUpdate,
): boolean {
  return (
    subject.kind === 'face' &&
    update.key === undefined &&
    update.visualKey === subject.visualKey &&
    update.skin === FACE_PORTRAIT_SKIN
  );
}
