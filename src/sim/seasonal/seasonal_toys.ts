// Hester's toys (content/gourdlight_eve.ts GOURDLIGHT_TOYS): five reusable playthings,
// each a short `seasonal_cosmetic` aura and nothing else (the cauldron sets down a ground
// object instead, which hands that aura to whoever drinks: toy_cauldron.ts). No sim rule reads that kind (no
// stat fold, no control, no damage), so a toy can never change a fight; the client draws
// it (render/seasonal_toys_fx.ts) and its sound rides the spellfxAt sfxKey, so everyone
// near hears it. Draws no rng and reads no clock.
//
// The rules, in refusal order (a refused use spends nothing and starts no cooldown):
//   - never in combat, never while stealthed (a toy's light and noise would give a hidden
//     player away), and never while the toy's own cooldown runs;
//   - the prank needs another living player targeted, within reach, out of combat and
//     visible (a prank never lands on a stranger hidden in the shadows).
// The toy is never consumed: its cooldown (p.cooldowns under the item id, mirrored in
// content/item_cooldowns.ts for the bar swipe) is what keeps it from being spammed.
import {
  GOURDLIGHT_TOY_FX_PREFIX,
  type GourdlightToy,
  gourdlightToy,
} from '../content/gourdlight_eve';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Aura, dist2d, type Entity } from '../types';
import { stripSeasonalAura } from './seasonal_cosmetics';
import { placeToyCauldron } from './toy_cauldron';

/** The spellfxAt ability tag each toy's cue carries (render: seasonal_toys_fx_core.ts). */
export const TOY_FX_ABILITY_PREFIX = GOURDLIGHT_TOY_FX_PREFIX;
/** Each toy's own sound (scripts/sfx/gourdlight_sfx.mjs). */
export const TOY_SFX: Readonly<Record<GourdlightToy['effect'], string>> = Object.freeze({
  prank: 'impact_prank_pumpkin_splat',
  lantern: 'spell_wanderwisp_lantern',
  bats: 'spell_startled_bats',
  candle: 'spell_murmurwick_candle',
  cauldron: 'spell_gurglegreen_cauldron',
});

/** A toy's look on `e`: a cosmetic aura for the toy's duration. The lantern and the
 *  candle carry the spot they were set down (value2 = x, value3 = z). */
export function toyAura(toy: GourdlightToy, sourceId: number, at?: { x: number; z: number }): Aura {
  const aura: Aura = {
    id: toy.auraId,
    name: toy.itemName,
    kind: 'seasonal_cosmetic',
    value: 0,
    remaining: toy.duration,
    duration: toy.duration,
    undispellable: true,
    sourceId,
    school: 'physical',
  };
  if (at) {
    aura.value2 = at.x;
    aura.value3 = at.z;
  }
  return aura;
}

/** Why the prank cannot land on `target` right now, or null when it can. */
export function prankRefusal(
  thrower: Entity,
  target: Entity | undefined,
  range: number,
): 'noTarget' | 'needsPlayer' | 'outOfRange' | null {
  if (!target) return 'noTarget';
  if (
    target.id === thrower.id ||
    target.kind !== 'player' ||
    target.dead ||
    target.ghost ||
    target.stealthed ||
    target.inCombat
  )
    return 'needsPlayer';
  if (dist2d(thrower.pos, target.pos) > range) return 'outOfRange';
  return null;
}

/** Play the toy `itemId` for `p`. True when it played (and its cooldown started). */
export function useGourdlightToy(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  itemId: string,
): boolean {
  const toy = gourdlightToy(itemId);
  if (!toy) return false;
  if (p.inCombat) {
    ctx.error(meta.entityId, "You can't do that while in combat.");
    return false;
  }
  if (p.stealthed) {
    ctx.emit({ type: 'seasonal', what: 'toyHidden', pid: meta.entityId });
    return false;
  }
  if ((p.cooldowns.get(toy.itemId) ?? 0) > 0) {
    ctx.error(meta.entityId, 'That item is not ready yet.');
    return false;
  }
  if (toy.effect === 'prank') {
    const target = p.targetId !== null ? ctx.entities.get(p.targetId) : undefined;
    const refusal = prankRefusal(p, target, toy.range ?? 0);
    if (refusal === 'noTarget') {
      ctx.error(meta.entityId, 'You have no target.');
      return false;
    }
    if (refusal === 'outOfRange') {
      ctx.error(meta.entityId, 'Out of range.');
      return false;
    }
    if (refusal || !target) {
      ctx.emit({ type: 'seasonal', what: 'prankNeedsPlayer', pid: meta.entityId });
      return false;
    }
    // a fresh splat replaces one still worn (its timer starts over)
    stripSeasonalAura(ctx, target, toy.auraId);
    ctx.applyAura(target, toyAura(toy, p.id));
    toyCue(ctx, toy, p, target.pos.x, target.pos.z, target.id);
    p.cooldowns.set(toy.itemId, toy.cooldown);
    ctx.emit({ type: 'seasonal', what: 'toy', trick: toy.itemId, who: target.name, pid: p.id });
    ctx.emit({ type: 'seasonal', what: 'pranked', who: p.name, pid: target.id });
    return true;
  }
  if (toy.effect === 'cauldron') {
    const pot = placeToyCauldron(ctx, toy, p);
    toyCue(ctx, toy, p, pot.pos.x, pot.pos.z, pot.id);
    p.cooldowns.set(toy.itemId, toy.cooldown);
    ctx.emit({ type: 'seasonal', what: 'toy', trick: toy.itemId, pid: meta.entityId });
    return true;
  }
  // every other toy plays on its user; a fresh use replaces the one still playing
  const at = toy.effect === 'lantern' || toy.effect === 'candle' ? placeSpot(p) : undefined;
  stripSeasonalAura(ctx, p, toy.auraId);
  ctx.applyAura(p, toyAura(toy, p.id, at));
  toyCue(ctx, toy, p, at?.x ?? p.pos.x, at?.z ?? p.pos.z);
  p.cooldowns.set(toy.itemId, toy.cooldown);
  ctx.emit({ type: 'seasonal', what: 'toy', trick: toy.itemId, pid: meta.entityId });
  return true;
}

/** Where a lantern or candle is set down: a step in front of its user's feet, rounded
 *  to the centimetre so the spot survives the wire unchanged. */
function placeSpot(p: Entity): { x: number; z: number } {
  const x = p.pos.x + Math.sin(p.facing) * 1.2;
  const z = p.pos.z + Math.cos(p.facing) * 1.2;
  return { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
}

/** The toy's moment for everyone near (interest-scoped like any ground cue): its sound
 *  (the HUD plays sfxKey) and the render layer's one-shot (the prank's throw, the bats'
 *  burst, the lantern and candle lighting). The prank's splat sound is the render
 *  layer's own, timed to the landing, so this cue carries no sfxKey for it. */
function toyCue(
  ctx: SimContext,
  toy: GourdlightToy,
  p: Entity,
  x: number,
  z: number,
  targetId?: number,
): void {
  ctx.emit({
    type: 'spellfxAt',
    x,
    z,
    school: 'physical',
    fx: 'burst',
    ability: TOY_FX_ABILITY_PREFIX + toy.effect,
    sourceId: p.id,
    targetId,
    duration: toy.duration,
    sfxKey: toy.effect === 'prank' ? undefined : TOY_SFX[toy.effect],
  });
}
