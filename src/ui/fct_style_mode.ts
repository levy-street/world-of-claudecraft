// The Classic Combat Text read for the FCT painter. Interface > Combat > Classic Combat
// Text (the `classicCombatText` setting) is mirrored onto a body class by the Interface &
// Comfort table (src/game/interface_body_classes.ts); the painter reads that class once per
// spawn to decide between the vivid look (gold abilities, keyline, fan-out, big-hit and crit
// emphasis) and the shipped classic one. Kept out of the painter so the painter stays free
// of raw classList access (its source guard pins that), and so a host without a body (a
// Node test's fake document) reads as the default vivid look instead of throwing.

import { INTERFACE_BODY_CLASSES } from '../game/interface_body_classes';

/** The minimal document shape read: an optional body with a classList. */
export interface ClassicCombatTextHost {
  readonly body?: { readonly classList?: { contains(className: string): boolean } } | null;
}

/** Whether the player chose Classic Combat Text (false, the vivid default, when unknown). */
export function classicCombatTextOn(doc: ClassicCombatTextHost): boolean {
  return doc.body?.classList?.contains(INTERFACE_BODY_CLASSES.classicCombatText) === true;
}
