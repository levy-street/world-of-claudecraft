// The Bruin Rush window: the druid-side state behind Pin, the Bruin Rush to
// Cat Form rider (Wildfang kit pass 2, combat/druid_engines.ts owns the Pin
// arm itself). Landing Bruin Rush opens a short window in which Cat Form
// costs nothing and Pins the Rush target. The window is an AURA on the druid
// rather than a new Entity field (the Colossal Might cap precedent): it rides
// the ordinary aura wire so the online client's resolvedAbility (the shared
// cost tail in combat/ability_resolution.ts) shows the free cost the server
// will bill, it expires through the aura tick, a death wipes it with every
// other aura, and it adds no field to the parity trace. Its value carries the
// Rush target's entity id, the one piece of state the rider needs.
//
// Two arms keep the window honest about WHEN it starts. The cast arm opens it
// the moment the Rush completes (the stun lands that same tick), so the rider
// exists from the first tick of the route. The landing arm (finishBruinRush,
// on the charge-route arrival hook) re-arms it to its full length when the
// route ends: the design and the tooltip measure the window from AFTER the
// Rush, and from max range the route itself runs for about a second while
// Bruin Form's own global cooldown covers the first 1.5 sec of the combo, so a
// cast-only window left a Cat Form press at 3 sec after the Rush paying full
// mana and Pinning nothing. Neither arm draws rng. A leaf module (no engine import) so charge_route.ts can call the landing
// arm without a cycle through the class engine.
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';

export const BRUIN_RUSH_WINDOW_ID = 'bruin_rush_window';
export const BRUIN_RUSH_WINDOW_SECONDS = 3;

function ownedWindow(actor: Pick<Entity, 'auras'>): Aura | undefined {
  for (const aura of actor.auras) {
    if (aura.id === BRUIN_RUSH_WINDOW_ID && aura.kind === 'internal_cd') return aura;
  }
  return undefined;
}

// The Rush target's entity id while the window is live, else null. Reads the
// aura list only, so both the Sim and the online client mirror can ask.
export function bruinRushWindowTargetId(actor: Pick<Entity, 'auras'>): number | null {
  return ownedWindow(actor)?.value ?? null;
}

// The cast arm: a landed Rush cast opens (or restarts) the window on its target.
export function openBruinRushWindow(ctx: SimContext, player: Entity, target: Entity): void {
  // A re-open inside a live window (unreachable under the 15 sec Rush
  // cooldown, kept honest anyway) fades the old one exactly as every other
  // removal of this aura does, so the combat log and parses never miss it.
  const existing = ownedWindow(player);
  if (existing) {
    player.auras.splice(player.auras.indexOf(existing), 1);
    ctx.emit({ type: 'aura', targetId: player.id, name: existing.name, gained: false });
  }
  ctx.applyAura(player, {
    id: BRUIN_RUSH_WINDOW_ID,
    name: 'Bruin Rush',
    kind: 'internal_cd',
    remaining: BRUIN_RUSH_WINDOW_SECONDS,
    duration: BRUIN_RUSH_WINDOW_SECONDS,
    value: target.id,
    sourceId: player.id,
    school: 'physical',
  });
}

// The landing arm, called from the charge-route arrival hook for EVERY charge
// (warrior Onrush and Intervene, Lunge, Bruin Rush): only a druid carrying the
// window for this very target has anything to re-arm. The window is measured
// from the END of the Rush, landed or not: a route that stops short (a root, a
// cliff, deep water, the charge clock giving up on a blocked path) still leaves
// the druid closing the last yards on foot, and the rider's Pin never carried a
// range check, so the full window belongs to that druid too. Only a dead Rush
// target ends the rider (the engaged pass closes the window with the combat).
// Mutates `remaining` in place like the engine banks do (no re-apply, so the
// aura order that feeds the rng draw-order gate is unchanged).
export function finishBruinRush(_ctx: SimContext, runner: Entity, target: Entity | null): void {
  if (!target || target.dead) return;
  const rider = ownedWindow(runner);
  if (!rider || rider.value !== target.id) return;
  rider.remaining = BRUIN_RUSH_WINDOW_SECONDS;
  rider.duration = BRUIN_RUSH_WINDOW_SECONDS;
}
