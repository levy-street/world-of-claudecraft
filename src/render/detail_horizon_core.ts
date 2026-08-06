// Pure policy for ONE question: is the detail horizon being held so far inside
// what the atmosphere asked for that the background zone-prepare lane should
// stop being polite about it?
//
// The setup. Outdoors on the vista tiers every detail subsystem culls against
// the detail horizon, and that horizon is clamped to just inside the nearest
// UNBUILT ground chunk (chunk_residency_core.fogFarForBuiltGround), so the
// player can never see a hole where terrain has not arrived. The far vista mesh
// stands underneath and fills the gap with coarse ground, which is what makes
// the clamp safe rather than a black void.
//
// The failure. That clamp keys off the single nearest pending chunk, while
// ground is built per ZONE and a zone only builds once the streaming lane
// reaches it. The chunk grid starts entirely pending, and cells in the gaps
// between zone rectangles belong to the nearest rectangle, so standing anywhere
// near a border there is unbuilt ground a couple of hundred yards away and the
// horizon collapses to it. Measured from the Eastbrook spawn: a 700 yard
// request served at 150 to 244 yards, for minutes, with the coarse mesh owning
// everything past about 90 to 180 yards. That is the "distant terrain looks
// smoothed until I walk closer, then it pops to the real thing" report: the
// coarse tiles carry no splat texture and take no shadows, so a hillside a few
// hundred yards out reads as a flat grey shell and the pop is the real terrain
// finally arriving.
//
// The clamp was also RADIAL, which made the same collapse a function of camera
// YAW: the third-person camera orbits its player, so the binding chunk swung
// around with it and turning on the spot deleted mid-field scenery and its
// shadows. That half is fixed in chunk_residency_core (the query now asks only
// about ground inside the view wedge); what remains, and what this module
// serves, is the collapse the player earns honestly by facing unbuilt ground.
//
// The missing feedback loop. Everything needed already exists: the renderer
// queues those zones from the RELAXED horizon (so the queue is right), the
// terrain view can escalate an in-flight idle build to macrotask pace
// (TerrainView.escalateZone), and the clamp knows exactly how much view it is
// costing. Nothing connected the third to the second: only the zone the player
// STANDS in escalated, so the neighbour whose unbuilt ground was actually
// binding the horizon kept streaming at idle-slot pace. This core is that
// connection, kept out of the renderer so a Vitest drives the decision.

/**
 * How far the residency clamp may hold the detail horizon below the
 * atmosphere's request before the in-flight prepare is escalated, in world
 * units. Slack, not zero: the clamp sits a fixed guard band inside the nearest
 * pending chunk (UNBUILT_GROUND_FOG_GUARD) and the horizon eases in
 * exponentially, so it brushes a few yards under the request in ordinary
 * steady state and escalating there would mean escalating forever.
 *
 * At 80 the shortfall has to be worth a frame-time trade before we take one:
 * the far mesh has taken over roughly 140 yards inside the requested horizon,
 * which is inside the band where a player reads terrain detail.
 */
export const DETAIL_HORIZON_ESCALATE_SLACK = 80;

/**
 * True when unbuilt ground is costing enough view to justify building the
 * remaining chunks at macrotask pace instead of idle pace.
 *
 * `liveFar` is the horizon the frame is actually drawing with (the eased,
 * clamped value the far mesh discards against), and `requestedFar` is what the
 * atmosphere asked for. Both are compared as given, so a caller that is not on
 * the vista arm simply never sees a gap worth acting on.
 *
 * Escalation is a real cost (the remaining chunk builds move onto macrotasks
 * and compete with the frame loop, the same pace a teleport's gating build
 * uses), so it is deliberately self-limiting: it is only ever asked while the
 * view is measurably held back, and the moment that zone's ground lands the
 * horizon opens and this goes quiet on its own.
 */
export function detailHorizonStarved(liveFar: number, requestedFar: number): boolean {
  if (!Number.isFinite(liveFar) || !Number.isFinite(requestedFar)) return false;
  return requestedFar - liveFar > DETAIL_HORIZON_ESCALATE_SLACK;
}
