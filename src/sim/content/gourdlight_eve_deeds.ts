// Gourdlight Eve's Book of Deeds marks (data only; the write sites live in
// src/sim/seasonal/gourdlight_deed_marks.ts, the deeds in content/deeds.ts).
//
// Every leaf of the whole-event meta is a lifetime mark in the deeds visited ledger
// (PlayerMeta.deedStats.visited, namespace 'gourdlight'), written by the site where the
// act really happens: a knock, a fright, an errand turned in, a Thatchgrin kill, the
// edition's last Haunted Pumpkin. Lifetime on purpose: the knock and fright ledgers roll
// every reset day and the pumpkin hunt rolls with its edition, but a mark, once made,
// stays, so progress carries across days, sessions and yearly editions and the deeds are
// never missable. Every mark id is built from the event's own content tables, so the
// namespace stays bounded (pinned by tests/gourdlight_meta_deed.test.ts).
import { GOURDLIGHT_DAILY_POOL, TRICK_OR_TREAT_NPCS } from './gourdlight_eve';

/** The visited-ledger namespace (registered in deeds.ts VISITED_MARK_NAMESPACES). */
export const GOURDLIGHT_MARK_NAMESPACE = 'gourdlight';

export function gourdlightKnockMark(npcTemplateId: string): string {
  return `${GOURDLIGHT_MARK_NAMESPACE}:knock:${npcTemplateId}`;
}
export function gourdlightBooMark(townZoneId: string): string {
  return `${GOURDLIGHT_MARK_NAMESPACE}:boo:${townZoneId}`;
}
export function gourdlightErrandMark(questId: string): string {
  return `${GOURDLIGHT_MARK_NAMESPACE}:errand:${questId}`;
}
/** Old Thatchgrin brought down (any edition). */
export const GOURDLIGHT_THATCHGRIN_MARK = `${GOURDLIGHT_MARK_NAMESPACE}:thatchgrin`;
/** Every Haunted Pumpkin of an edition found (the Pumpkin Hunter feat's moment). */
export const GOURDLIGHT_PUMPKIN_HUNT_MARK = `${GOURDLIGHT_MARK_NAMESPACE}:pumpkins`;

/** One per townsperson who answers a knock, in authored town order. */
export const GOURDLIGHT_KNOCK_MARKS: readonly string[] = Object.freeze(
  Object.values(TRICK_OR_TREAT_NPCS).flat().map(gourdlightKnockMark),
);
/** One per event town (a fright landed on any of its townsfolk). */
export const GOURDLIGHT_BOO_MARKS: readonly string[] = Object.freeze(
  Object.keys(TRICK_OR_TREAT_NPCS).map(gourdlightBooMark),
);
/** One per rotating errand of Hester's pool. */
export const GOURDLIGHT_ERRAND_MARKS: readonly string[] = Object.freeze(
  GOURDLIGHT_DAILY_POOL.map(gourdlightErrandMark),
);
/** The whole event, every leaf: the meta deed's checklist (and its progress bar). */
export const GOURDLIGHT_EVE_MARKS: readonly string[] = Object.freeze([
  GOURDLIGHT_THATCHGRIN_MARK,
  GOURDLIGHT_PUMPKIN_HUNT_MARK,
  ...GOURDLIGHT_ERRAND_MARKS,
  ...GOURDLIGHT_KNOCK_MARKS,
  ...GOURDLIGHT_BOO_MARKS,
]);

/** The whole-event meta's title (original; IP-checked in docs/design/naming-audit.md). */
export const GOURDLIGHT_META_TITLE = 'the Gourdsworn';
