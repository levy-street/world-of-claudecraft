// Which chat pane a 'log' SimEvent's text belongs in: General/Chat, or the Combat
// Log. Pure predicate consumed by hud.ts's `case 'log':` dispatch.
//
// Classification rule (per the SimEvent comment on the 'log' variant, src/sim/types.ts):
// - `pid` set means the server delivered this line to exactly one player: it is that
//   player's personal narrative (a quest-vision beat, a private notice), never someone
//   else's spam, and never something classifiable as an actionable mechanic cue for a
//   wider group. It always stays in General/Chat regardless of `entityId`.
// - `telegraph: true` marks an entityId-anchored line as an actionable mechanic cue:
//   a channel, a burst/detonate warning, or a targeted debuff callout that may have no
//   other signal (no cast bar, no overhead bubble). These stay in General/Chat too, since
//   routing them to the Combat Log tab (not the default view) can hide a player's only cue.
// - Everything else with an `entityId` is genuine ambient combat/encounter flavor chatter
//   (a mob flying into a frenzy, fleeing, enraging, or a quest-boss's scripted bark) with
//   no mechanical weight; it goes to the Combat Log so it doesn't drown out real chat for
//   anyone standing near a busy mob pack.
// - An anchorless, non-pid line (ability learned, a world boss's server-wide spawn notice,
//   a fishing catch) is a genuine system/chat notice and stays in General/Chat.
export function isCombatFlavorLog(
  entityId: number | undefined,
  pid?: number,
  telegraph?: boolean,
): boolean {
  if (pid !== undefined) return false;
  if (telegraph) return false;
  return entityId !== undefined;
}
