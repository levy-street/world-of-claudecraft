// Rogue v0.29 row mechanics (docs/design/rogue-v029-class-design.md), behind
// the SimContext seam: Dusk Economy's stealth-window energy discount and its
// linger aura, plus the Foul Play own-dot CC guard. Pure reads and one aura
// application; this module draws NO rng.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random or
// Date.now (enforced by tests/architecture.test.ts).

import type { GlobalModEffect } from '../content/talents';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const DUSK_ECONOMY_AURA_ID = 'dusk_economy';
export const DUSK_ECONOMY_LINGER_SEC = 6;

function globalsFor(ctx: SimContext, e: Entity): Required<GlobalModEffect> | null {
  if (e.kind !== 'player') return null;
  const meta = ctx.players.get(e.id);
  return meta ? ctx.playerMods(meta).global : null;
}

// Dusk Economy: energy costs are cut while a stealth aura, the post-stealth
// linger aura, or the Veilstrike shadow window (the Skulduggery engine's
// portable stealth, combat/rogue_engines.ts) is worn. Returns a cost
// multiplier, or null when inactive, so the caller can fold it beside the
// empower-next cheap multiplier.
export function duskCostMultiplier(ctx: SimContext, p: Entity): number | null {
  const globals = globalsFor(ctx, p);
  if (!globals || globals.duskEconomyPct <= 0) return null;
  const active = p.auras.some(
    (a) =>
      a.kind === 'stealth' ||
      (a.id === DUSK_ECONOMY_AURA_ID && a.kind === 'dusk_economy') ||
      (a.id === 'veilstrike' && a.sourceId === p.id),
  );
  return active ? 1 - globals.duskEconomyPct : null;
}

// Folds two independent cost multipliers (either may be null for "no change").
export function combineCostMultipliers(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a * b;
}

// Called from the single breakStealth funnel on Sim: leaving Duskveil starts
// the 6 sec linger window. Refreshes, never stacks.
export function duskLingerOnStealthBreak(ctx: SimContext, e: Entity): void {
  const globals = globalsFor(ctx, e);
  if (!globals || globals.duskEconomyPct <= 0) return;
  const existing = e.auras.find((a) => a.id === DUSK_ECONOMY_AURA_ID);
  if (existing) {
    existing.remaining = DUSK_ECONOMY_LINGER_SEC;
    existing.duration = DUSK_ECONOMY_LINGER_SEC;
    return;
  }
  ctx.applyAura(e, {
    id: DUSK_ECONOMY_AURA_ID,
    name: 'Dusk Economy',
    kind: 'dusk_economy',
    remaining: DUSK_ECONOMY_LINGER_SEC,
    duration: DUSK_ECONOMY_LINGER_SEC,
    value: globals.duskEconomyPct,
    sourceId: e.id,
    school: 'shadow',
  });
}

// Foul Play: the caster's own NON-DIRECT damage (dot ticks) never breaks the
// caster's own incapacitate (Eye Jab, Sap). Direct hits, and anyone else's
// damage, still break normally.
export function foulPlayGuardsBreak(
  ctx: SimContext,
  source: Entity | null,
  breakableKind: string,
  breakableSourceId: number,
  direct: boolean,
): boolean {
  if (direct || breakableKind !== 'incapacitate' || !source) return false;
  if (breakableSourceId !== source.id) return false;
  const globals = globalsFor(ctx, source);
  return globals !== null && globals.foulPlayGuard > 0;
}
