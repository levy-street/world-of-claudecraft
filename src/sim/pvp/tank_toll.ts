// Tank Toll: the visible debuff behind the PvP tank restraint (owner rule,
// v0.46). The restraint itself is pure math in tank_restraint.ts and runs off
// the 5 second player-vs-player exchange window; this module only decides who
// WEARS the debuff so a tank can see the rule that applies to them.
//
// Worn while BOTH hold:
//  - the player is a committed tank (the shared `isCommittedTank`: Protection
//    warrior or paladin, Feral druid in Bruin Form, Enhancement shaman with
//    Stonebound Weapon), and
//  - they are somewhere players can fight them: /pvp flag raised, seated in a
//    battleground or arena match, in an active duel, or inside a live PvP
//    exchange (free-for-all ground needs no flag, so a fight there shows it
//    too).
// The effect is still gated by the exchange window, not by the debuff: a
// flagged tank who has not traded player damage in the last 5 seconds wears
// it at no cost, exactly as the tooltip implies ("the damage you deal to other
// players").
//
// The aura is a pure visible marker: its own inert kind ('tank_toll', which no
// combat or stat reader keys on), value 0, physical school plus `undispellable`
// so no dispel, cleanse or right-click can shed it, `permanent` so it shows no
// countdown and never expires on its own. Its lifetime is owned by the sync pass
// below, which also re-applies it after a death or clean-slate wipe strips it.
// Runs on the world PvP zone pass (twice a second), draws no rng.

import { isCommittedTank } from '../combat/tank_crit_immunity';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { inPvpExchange } from './tank_restraint';

export const TANK_TOLL_AURA_ID = 'tank_toll';
/** English display name; re-localized client-side (src/ui/sim_i18n.ts). */
export const TANK_TOLL_AURA_NAME = 'Tank Toll';

function inActiveDuel(ctx: SimContext, pid: number): boolean {
  const duel = ctx.duels.get(pid);
  return !!duel && duel.endedTick === undefined && duel.state === 'active';
}

/** Should this player wear Tank Toll right now? */
export function tankTollApplies(ctx: SimContext, e: Entity): boolean {
  if (e.kind !== 'player' || e.dead) return false;
  const meta = ctx.players.get(e.id);
  if (!meta || !isCommittedTank(e, meta)) return false;
  return (
    // Entity.pvpFlag is the /pvp flag's mirror (world_pvp.ts is its only
    // writer); read here instead of importing world_pvp, which calls this pass.
    e.pvpFlag === true ||
    ctx.bgMatches.has(e.id) ||
    ctx.arenaMatches.has(e.id) ||
    inActiveDuel(ctx, e.id) ||
    inPvpExchange(e, ctx.time)
  );
}

export function tankTollAura(entityId: number): Aura {
  return {
    id: TANK_TOLL_AURA_ID,
    name: TANK_TOLL_AURA_NAME,
    kind: 'tank_toll',
    value: 0,
    remaining: 0,
    duration: 0,
    permanent: true,
    undispellable: true,
    sourceId: entityId,
    school: 'physical',
  };
}

/** Add or remove each player's Tank Toll to match `tankTollApplies`. Players
 *  whose state is unchanged cost one predicate evaluation and an aura scan. */
export function updateTankToll(ctx: SimContext): void {
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e) continue;
    const want = tankTollApplies(ctx, e);
    const idx = e.auras.findIndex((a) => a.id === TANK_TOLL_AURA_ID);
    if (want && idx < 0) {
      ctx.applyAura(e, tankTollAura(e.id));
    } else if (!want && idx >= 0) {
      const [gone] = e.auras.splice(idx, 1);
      ctx.emit({ type: 'aura', targetId: e.id, name: gone.name, gained: false });
    }
  }
}
