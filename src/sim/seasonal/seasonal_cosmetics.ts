// The seasonal cosmetic auras: the worn pumpkin head and the trick-or-treat
// tricks. Every one is kind 'seasonal_cosmetic', which no sim rule reads: no stat
// fold, no control, no damage. The client draws them (render: the head piece on
// the head bone, the bat and skeleton through the polymorph slot's look, the
// fumes as a smoke cloud). `undispellable` keeps every counter (dispel, cleanse,
// steal) off them; only their wearer may take one off, with its own item, its own
// timer, or a right-click cancel (seasonal_cancel.ts).
import {
  GOURDLIGHT_COSTUMES,
  GOURDLIGHT_TOYS,
  GOURDLIGHT_TRICKS,
  type GourdlightCostume,
  PUMPKIN_HEAD_AURA_ID,
} from '../content/gourdlight_eve';
import { STRAWLING_GUISE } from '../content/gourdlight_eve_scarecrow';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';

/** Every seasonal cosmetic aura id: what the close-of-event sweep strips. */
export const SEASONAL_COSMETIC_AURA_IDS: ReadonlySet<string> = new Set([
  PUMPKIN_HEAD_AURA_ID,
  ...GOURDLIGHT_TRICKS.map((trick) => trick.id),
  STRAWLING_GUISE.id,
  ...GOURDLIGHT_COSTUMES.map((costume) => costume.auraId),
  // Hester's toys (seasonal_toys.ts): stripped on close, right-click cancellable
  ...GOURDLIGHT_TOYS.map((toy) => toy.auraId),
]);

/** Every body-swap look a seasonal toy, trick or costume plays (one at a time). */
const TRICK_AURA_IDS: readonly string[] = [
  ...GOURDLIGHT_TRICKS.map((trick) => trick.id),
  STRAWLING_GUISE.id,
  ...GOURDLIGHT_COSTUMES.map((costume) => costume.auraId),
  // the Gurglegreen Cauldron's drinker becomes a goblin (round 11, toy_cauldron.ts)
  ...GOURDLIGHT_TOYS.filter((toy) => toy.effect === 'cauldron').map((toy) => toy.auraId),
];

export function pumpkinHeadAura(sourceId: number): Aura {
  return {
    id: PUMPKIN_HEAD_AURA_ID,
    name: 'Carved Pumpkin Head',
    kind: 'seasonal_cosmetic',
    value: 0,
    remaining: 0,
    duration: 0,
    permanent: true,
    undispellable: true,
    sourceId,
    school: 'physical',
  };
}

export function trickAura(trickIndex: number, sourceId: number): Aura {
  const trick = GOURDLIGHT_TRICKS[trickIndex] ?? GOURDLIGHT_TRICKS[0];
  return {
    id: trick.id,
    name: trick.name,
    kind: 'seasonal_cosmetic',
    value: 0,
    remaining: trick.duration,
    duration: trick.duration,
    undispellable: true,
    sourceId,
    school: 'physical',
  };
}

/** Remove one seasonal cosmetic aura by id, announcing the fade like any aura
 *  that runs out. True when one was worn. */
export function stripSeasonalAura(ctx: SimContext, e: Entity, auraId: string): boolean {
  const index = e.auras.findIndex((a) => a.id === auraId && a.kind === 'seasonal_cosmetic');
  if (index < 0) return false;
  const [removed] = e.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: e.id, name: removed.name, gained: false });
  return true;
}

/** Any trick currently playing on this body (one at a time: a new trick replaces it). */
export function stripTricks(ctx: SimContext, e: Entity): void {
  for (const id of TRICK_AURA_IDS) stripSeasonalAura(ctx, e, id);
}

/** The Strawling Charm's look: Old Thatchgrin's own strawling body, for a short while. */
export function strawlingGuiseAura(sourceId: number): Aura {
  return {
    id: STRAWLING_GUISE.id,
    name: STRAWLING_GUISE.name,
    kind: 'seasonal_cosmetic',
    value: 0,
    remaining: STRAWLING_GUISE.duration,
    duration: STRAWLING_GUISE.duration,
    undispellable: true,
    sourceId,
    school: 'physical',
  };
}

/** Wear the strawling guise (replacing any trick already playing). */
export function playStrawlingGuise(ctx: SimContext, e: Entity): string {
  stripTricks(ctx, e);
  ctx.applyAura(e, strawlingGuiseAura(e.id));
  return STRAWLING_GUISE.id;
}

/** Play trick `trickIndex` on `e` (replacing any trick already playing). */
export function playTrick(
  ctx: SimContext,
  e: Entity,
  trickIndex: number,
  sourceId: number,
): string {
  stripTricks(ctx, e);
  const aura = trickAura(trickIndex, sourceId);
  ctx.applyAura(e, aura);
  return aura.id;
}

/** A costume draught's look: its body for the costume's duration (ten minutes). */
export function costumeAura(costume: GourdlightCostume, sourceId: number): Aura {
  return {
    id: costume.auraId,
    name: costume.name,
    kind: 'seasonal_cosmetic',
    value: 0,
    remaining: costume.duration,
    duration: costume.duration,
    undispellable: true,
    sourceId,
    school: 'physical',
  };
}

/** Wear a costume (replacing any trick, guise or costume already playing). */
export function playCostume(ctx: SimContext, e: Entity, costume: GourdlightCostume): string {
  stripTricks(ctx, e);
  ctx.applyAura(e, costumeAura(costume, e.id));
  return costume.auraId;
}
