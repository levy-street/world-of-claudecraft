// Intentional Gathering PR3: the pure boundary validator for the online
// `harvestCorpse` wire command (server/CLAUDE.md, "New WS/loop-side
// behavior": pure decision logic behind a host-agnostic module, never inline
// in game.ts's dispatch switch). No admission, reservation, cast, or rng may
// ever be reached unless the frame is id-only: `id` a positive safe integer,
// and `components` entirely ABSENT as a PROPERTY (checked with
// `Object.hasOwn`, not `=== undefined`: an explicit own `components:
// undefined` key must refuse exactly like `[]`/`null`/any other value, the
// legacy per-call component override no longer exists in any shape). `pid`
// always comes from the caller's authenticated session, never the payload.

import { CORPSE_HARVEST_CAST_ID, type Entity } from '../src/sim/types';

export interface HarvestCorpsePayload {
  readonly id?: unknown;
  readonly components?: unknown;
}

export function validHarvestCorpseCommand(
  msg: HarvestCorpsePayload,
): msg is { readonly id: number } {
  return (
    typeof msg.id === 'number' &&
    Number.isSafeInteger(msg.id) &&
    msg.id > 0 &&
    !Object.hasOwn(msg, 'components')
  );
}

export function harvestCorpseCommandOutcome(
  sim: { harvestCorpse(id: number, pid?: number): boolean },
  msg: HarvestCorpsePayload,
  pid: number,
): boolean {
  return validHarvestCorpseCommand(msg) && sim.harvestCorpse(msg.id, pid);
}

export interface CorpseHarvestCastCancelHost {
  readonly entities: ReadonlyMap<number, Entity>;
  readonly ctx: { cancelCast(entity: Entity): void };
}

/** A live corpse-harvest cast must not survive into the linkdead grace
 *  window: called from server/game.ts socketClosed BEFORE its safety
 *  saveCharacter. No-op for every other cast, or a pid with no live entity. */
export function cancelCorpseHarvestCastOnDisconnect(
  sim: CorpseHarvestCastCancelHost,
  pid: number,
): void {
  const actor = sim.entities.get(pid);
  if (actor?.castingAbility === CORPSE_HARVEST_CAST_ID) sim.ctx.cancelCast(actor);
}
