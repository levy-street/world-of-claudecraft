// The renderer's direct-pick entry: the pure stack resolver (pick_resolution.ts)
// fed with what the live world and the static content tables know about each
// hit. WorldPicking.pickDirect raycasts the click capsules and hands the hit ids,
// nearest first, and the pick ray itself to resolveWorldDirectPick.
//
// The one fact it adds is the USE-ONLY body: a mob the local player can use
// right now and cannot attack (the Hollow Crypt's Remembrance Candle while
// Morthen's Rite runs: a held, non-hostile body whose only meaning for a click
// is "relight this"). A click aimed at such a body selects it, whatever the ray
// reached before it and whatever the player holds as target, so a boss capsule
// standing between the camera and the candle no longer swallows the click; a
// repeat click keeps the candle (pick_resolution.ts has the whole rule).
//
// It wins only a click AIMED at it. The body's click capsule is far wider than
// the candle (2.2 yd against a pillar under a yard in radius), and a click on a
// skeleton standing beside the pillar crosses that capsule too: that click is
// the skeleton's. So the body is promoted only when the pick ray comes within
// its visual's `aimCore` (characters/manifest.ts; the geometry is
// pick_aim_core.ts): the narrow column of what the player sees. Outside the
// core plain ray order and the old overlap cycling stand, exactly as if the
// rule did not exist, and with nothing nearer under the cursor the whole
// capsule still selects the body. A use-only body whose visual declares no aim
// core is never promoted.
//
// The local player's own capsule is never among the hits (WorldPicking.pickDirect
// drops it), so the resolver's "nearest live hit is a player" exception only
// ever means ANOTHER player: standing between the camera and the candle, your
// own body does not take the candle's click.
//
// "Usable right now" is the sim's own rule (encounter_use.ts kitUsableNow: a
// living mob whose kit carries a `usable`), the one the interact press reads
// (src/game/nearby_interaction_core.ts) and the HUD's use prompt mirrors. The
// candle bodies exist only while the Rite runs and each is dropped the moment
// it is lit, so existence is the gate; reach is not (the click is how a player
// picks the candle to walk to). A dead local player can use nothing.
//
// A usable body the player can ALSO attack is deliberately not use-only: the
// Gravewyrm Sanctum's Soul Brazier is a hostile mob planted beside the
// Pyre-Tender whose death snuffs it, and a click on her must not be pulled onto
// the brazier behind her. It competes nearest first like any hostile mob, and
// the interact press reaches it without a click.
//
// A pick made to ATTACK (the Attack Move key, main.ts handleAttackMove) wants
// the hostile under the cursor and nothing else, so it asks with `attackIntent`
// and gets plain ray order: a body it cannot attack must not take that pick.

import { kitUsableNow } from '../sim/mob/trash_kit/encounter_use';
import type { Entity } from '../sim/types';
import { VISUALS, visualKeyFor } from './characters/manifest';
import { type PickRay, rayAimsAtCore } from './pick_aim_core';
import { resolveDirectPickEntityId } from './pick_resolution';

/** The slice of the world a direct pick reads (IWorld satisfies it). */
export interface DirectPickWorld {
  entities: Pick<Map<number, Entity>, 'get'>;
  player: Pick<Entity, 'targetId' | 'dead'> | null | undefined;
}

/** A body whose only meaning for a click is its use: usable right now, and not
 *  something the player attacks. */
export function isUseOnlyBody(e: Entity): boolean {
  return !e.hostile && kitUsableNow(e);
}

/** Was the pick ray aimed at what the player sees of `e` (its visual's aim
 *  core)? False for a visual that declares none. */
export function isAimedAt(e: Entity, ray: PickRay): boolean {
  const core = VISUALS[visualKeyFor(e)]?.aimCore;
  return !!core && rayAimsAtCore(ray, e, core);
}

/** Resolve a raycast's hit ids (nearest first) to the entity a click selects.
 *  `ray` is the ray that produced them. */
export function resolveWorldDirectPick(
  hitEntityIds: readonly number[],
  world: DirectPickWorld,
  ray: PickRay,
  attackIntent = false,
): number | null {
  const player = world.player;
  const promotes = !!player && !player.dead && !attackIntent;
  return resolveDirectPickEntityId(
    hitEntityIds,
    world.entities,
    player?.targetId ?? null,
    promotes ? (e) => isUseOnlyBody(e) && isAimedAt(e, ray) : null,
  );
}
