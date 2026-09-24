// Which body a PLAYER entity's portrait shows, resolved once per repaint for
// every frame that can hold a player (the player frame, the target frame, the
// target-of-target frame) so the three cannot disagree, plus the matching rule
// that tells a frame a landed portrait update is the one it framed.
//
// The look rides the identity wire (`app`, the character's own DB column, see
// src/net/online.ts), so a PEER's authored face is as known to this client as
// the viewer's own; a frame that draws the stock class art for a peer shows a
// face that player never had. DOM-free and three-free on purpose: the painter
// (unit_portrait_painter.ts) draws the answer, the Hud supplies the two lookups
// only it wires (the look provider and the modular visual key), and the whole
// decision is unit-tested in tests/player_portrait_core.test.ts. The look is a
// type parameter (the painter binds it to ModularLook) so this core imports
// nothing from the render layer.

import { type Entity, isMechWearer, type PlayerClass } from '../sim/types';

/** The body a player entity's portrait renders, in precedence order: a Combat
 *  Mech wearer IS the mech in the world (and their `skin` is a chroma index
 *  that means nothing to the class atlas); a player with an authored look
 *  shows the face they built; everyone else the stock art for their class. */
export type PlayerPortraitSubject<Look> =
  | { kind: 'mech'; cls: PlayerClass; chroma: number }
  | { kind: 'composed'; cls: PlayerClass; skin: number; visualKey: string; look: Look }
  | { kind: 'class'; cls: PlayerClass; skin: number };

/** The two render-layer lookups the rule needs, injected so this core never
 *  imports the character barrel (modularLookFor and modularKeyFor in the Hud). */
export interface PlayerPortraitLookups<Look> {
  /** The look an entity composes with, null for a fixed class rig. */
  lookFor: (e: Entity) => Look | null;
  /** The composed-body visual key for an entity the look provider claimed. */
  visualKeyFor: (e: Entity) => string;
}

export function playerPortraitSubject<Look>(
  e: Entity,
  lookups: PlayerPortraitLookups<Look>,
): PlayerPortraitSubject<Look> {
  const cls = e.templateId as PlayerClass;
  const skin = e.skin ?? 0;
  if (isMechWearer(e)) return { kind: 'mech', cls, chroma: skin };
  const look = lookups.lookFor(e);
  if (look) return { kind: 'composed', cls, skin, visualKey: lookups.visualKeyFor(e), look };
  return { kind: 'class', cls, skin };
}

/** A landed portrait as onPortraitUpdate (portrait.ts) reports it. */
export interface PortraitUpdate {
  visualKey: string;
  skin: number;
  /** The cache key, reported for a COMPOSED capture only. */
  key?: string;
}

/**
 * Whether `update` is a portrait `subject` shows, so the frame holding that
 * subject repaints, and no other frame does.
 *
 * A composed subject matches its own cache key (the look signature: no class
 * name or skin index describes a composed body), and ALSO the stock (class,
 * skin) headshot, which is the interim the painter shows while the composed
 * capture is still running. A mech wearer matches the chroma atlas arriving
 * for their body. `composedKeyOf` is the key rule from portrait.ts
 * (composedPortraitKey), injected so this core stays three-free.
 */
export function portraitUpdateFrames<Look>(
  subject: PlayerPortraitSubject<Look>,
  update: PortraitUpdate,
  composedKeyOf: (visualKey: string, look: Look) => string,
): boolean {
  switch (subject.kind) {
    case 'mech':
      return update.visualKey === 'player_mech' && update.skin === subject.chroma;
    case 'composed':
      if (update.key !== undefined) {
        return update.key === composedKeyOf(subject.visualKey, subject.look);
      }
      return classUpdateFrames(subject, update);
    case 'class':
      return update.key === undefined && classUpdateFrames(subject, update);
  }
}

function classUpdateFrames(
  subject: { cls: PlayerClass; skin: number },
  update: PortraitUpdate,
): boolean {
  return update.visualKey === `player_${subject.cls}` && update.skin === subject.skin;
}
