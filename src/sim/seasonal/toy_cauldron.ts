// The Gurglegreen Cauldron (Hester's toy, content/gourdlight_eve.ts GOURDLIGHT_TOYS, the
// 'cauldron' effect): its user sets a small bubbling cauldron down in front of them, and
// for `standsFor` seconds it is a ground object ANY player may drink from. A drink turns
// the drinker into a goblin (the Coinsack Scurrier's body, round 11) for the toy's
// `duration`, after a green burst of bubbles: one more `seasonal_cosmetic` aura, which no
// sim rule reads (no stat, no control, no damage). It is a body swap exactly like the
// costume draughts' (seasonal_cosmetics.ts TRICK_AURA_IDS): one body at a time, so a
// drink takes off a costume or a trick and a costume or a trick takes off the goblin, and
// combat starting ends it (seasonal_tick.ts).
//
// Server authoritative: the cauldron is an ordinary ground-object entity (the wire and
// the interest scope carry it to every client near it), and the drink is the ordinary
// object interaction (interaction.ts routes it here before any pickup path), so the
// same range, the same validation and the same aura reach every host.
//
// One cauldron per owner: a fresh one replaces the one still standing. Every cauldron
// leaves with the event (updateSeasonal's close edge). Draws no rng and reads no clock;
// a placement allocates one entity id, a drink none.
import { isBlocked } from '../colliders';
import {
  GOURDLIGHT_EVE_ID,
  GOURDLIGHT_TOY_FX_PREFIX,
  type GourdlightToy,
  GURGLEGREEN_CAULDRON_ID,
  gourdlightToy,
} from '../content/gourdlight_eve';
import { createGroundObject } from '../entity';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { stripTricks } from './seasonal_cosmetics';
import { activeSeasonalEventOf } from './seasonal_state';

/** The ground object's item id (its template is `ground_<id>`): the toy's own item id, so
 *  every label names it the way the bag does. */
export const TOY_CAULDRON_OBJECT_ID = GURGLEGREEN_CAULDRON_ID;
export const TOY_CAULDRON_TEMPLATE = `ground_${GURGLEGREEN_CAULDRON_ID}`;
/** The drinker's cue (render: seasonal_toys_fx.ts); the placement's cue is the plain
 *  `<prefix>cauldron` every toy emits. */
export const TOY_CAULDRON_DRINK_FX = `${GOURDLIGHT_TOY_FX_PREFIX}cauldron_drink`;
/** The drink's sound (scripts/sfx/gourdlight_sfx.mjs). */
export const TOY_CAULDRON_DRINK_SFX = 'spell_gurglegreen_quaff';
/** How far in front of its user the cauldron is set down (yards): clear of their feet,
 *  now that it is drawn waist-high and a yard round (round 11; seasonal_toys_fx_core.ts). */
export const TOY_CAULDRON_PLACE_REACH = 2.2;
/** Its footprint on the collider grid (a placement inside a wall is refused). */
const FOOTPRINT = 0.9;

/** True for a standing toy cauldron. */
export function isToyCauldron(e: Pick<Entity, 'kind' | 'objectItemId'>): boolean {
  return e.kind === 'object' && e.objectItemId === TOY_CAULDRON_OBJECT_ID;
}

/** The toy record (always present while the content ships the cauldron). */
function cauldronToy(): GourdlightToy | undefined {
  return gourdlightToy(GURGLEGREEN_CAULDRON_ID);
}

/** Where the cauldron goes: a step in front of its user, else at their side, else at
 *  their feet. Rounded to the centimetre (the spot survives the wire unchanged). */
function placeSpot(ctx: SimContext, p: Entity): { x: number; z: number } {
  for (const turn of [0, Math.PI / 2, -Math.PI / 2]) {
    const x = p.pos.x + Math.sin(p.facing + turn) * TOY_CAULDRON_PLACE_REACH;
    const z = p.pos.z + Math.cos(p.facing + turn) * TOY_CAULDRON_PLACE_REACH;
    if (!isBlocked(ctx.cfg.seed, x, z, FOOTPRINT)) {
      return { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
    }
  }
  return { x: Math.round(p.pos.x * 100) / 100, z: Math.round(p.pos.z * 100) / 100 };
}

/** Set `owner`'s cauldron down (replacing the one still standing). The new entity. */
export function placeToyCauldron(ctx: SimContext, toy: GourdlightToy, owner: Entity): Entity {
  const live = ctx.seasonal.toyCauldrons;
  const old = live.get(owner.id);
  if (old !== undefined) {
    if (ctx.entities.get(old)?.objectItemId === TOY_CAULDRON_OBJECT_ID) ctx.dropEntity(old);
    live.delete(owner.id);
  }
  const spot = placeSpot(ctx, owner);
  const pot = createGroundObject(
    ctx.nextId++,
    TOY_CAULDRON_OBJECT_ID,
    toy.itemName,
    ctx.groundPos(spot.x, spot.z),
  );
  // it faces its maker, so the ladle and the bubbling side read from where they stand
  pot.facing = owner.facing + Math.PI;
  pot.prevFacing = pot.facing;
  pot.despawnTimer = toy.standsFor ?? toy.duration;
  ctx.addEntity(pot);
  live.set(owner.id, pot.id);
  return pot;
}

/** The drinker's goblin body: the toy's aura for its duration, sourced from the cauldron's
 *  maker. */
function brewAura(toy: GourdlightToy, sourceId: number): Aura {
  return {
    id: toy.auraId,
    name: toy.itemName,
    kind: 'seasonal_cosmetic',
    value: 0,
    remaining: toy.duration,
    duration: toy.duration,
    undispellable: true,
    sourceId,
    school: 'nature',
  };
}

/** The owner a cauldron was made by (0 when no maker tracks it any more). */
function makerOf(ctx: SimContext, potId: number): number {
  for (const [owner, id] of ctx.seasonal.toyCauldrons) if (id === potId) return owner;
  return 0;
}

/**
 * A player drinks from a toy cauldron. False when `obj` is not one (the caller falls
 * through to its other arms); true when the cauldron owned the click, including a safely
 * refused one (the event closed, a fight, stealth).
 */
export function drinkFromToyCauldron(ctx: SimContext, obj: Entity, meta: PlayerMeta): boolean {
  if (!isToyCauldron(obj)) return false;
  const toy = cauldronToy();
  const drinker = ctx.entities.get(meta.entityId);
  if (!toy || !drinker || drinker.dead || drinker.ghost) return true;
  if (activeSeasonalEventOf(ctx.seasonal) !== GOURDLIGHT_EVE_ID) return true;
  if (drinker.inCombat) {
    ctx.error(meta.entityId, "You can't do that while in combat.");
    return true;
  }
  if (drinker.stealthed) {
    ctx.emit({ type: 'seasonal', what: 'toyHidden', pid: meta.entityId });
    return true;
  }
  // one body at a time: the goblin takes off any costume, trick or guise (and a fresh sip
  // starts the goblin's time over)
  stripTricks(ctx, drinker);
  // sourced from its maker; a cauldron whose maker is no longer tracked credits the drinker
  // (never the cauldron itself, whose id dangles once it despawns)
  ctx.applyAura(drinker, brewAura(toy, makerOf(ctx, obj.id) || drinker.id));
  ctx.emit({
    type: 'spellfxAt',
    x: drinker.pos.x,
    z: drinker.pos.z,
    school: 'nature',
    fx: 'burst',
    ability: TOY_CAULDRON_DRINK_FX,
    sourceId: obj.id,
    targetId: drinker.id,
    duration: toy.duration,
    sfxKey: TOY_CAULDRON_DRINK_SFX,
  });
  ctx.emit({ type: 'seasonal', what: 'cauldronDrink', pid: meta.entityId });
  return true;
}

/** Forget cauldrons that are gone (their timer ran out), and with `all`, take every one
 *  out of the world (the event closing). Cheap: one map walk, empty almost always. */
export function updateToyCauldrons(ctx: SimContext, all: boolean): void {
  const live = ctx.seasonal.toyCauldrons;
  if (live.size === 0) return;
  for (const [owner, id] of [...live]) {
    const pot = ctx.entities.get(id);
    const standing = pot !== undefined && isToyCauldron(pot);
    if (all && standing) ctx.dropEntity(id);
    if (all || !standing) live.delete(owner);
  }
}
