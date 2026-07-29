// How far a player may drift from an NPC before their open service window
// closes itself.
//
// Every NPC service window walks away at this one distance: the vendor,
// Heroic Quartermaster, trainer and unbind windows on the medium-band HUD
// tick, the market window on the slow band plus its indicator-click path
// (both in hud.ts), and the quest dialog through its own controller
// (src/ui/hud/quest/quest_dialog_controller.ts). It lives in its own
// DOM-free module rather than inline in the coordinator because the vendor
// row gate's safety argument READS it: a locked row is painted when the
// window opens and repainted on 'vendor' events (a purchase or sale), on an
// authoritative inventory delta (hud.ts onInventoryChanged), and on a
// language switch, but never on a proficiency change, which is only correct
// while a player cannot GAIN proficiency inside this radius (the harvest
// reach is INTERACT_RANGE around a node, and no node sits that close to a
// counter stocking a gated tool). tests/professions_tool_gate.test.ts asserts
// that separation against THIS constant, so widening the radius here fails
// there instead of silently turning the lock stale.

/** Yards past which an open NPC service window closes (see the band notes above). */
export const NPC_WINDOW_CLOSE_RANGE = 8;
