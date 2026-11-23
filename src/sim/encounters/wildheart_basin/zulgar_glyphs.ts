// The six sun glyphs of the Jaguar Shrine Terrace (Zulgar's hunt, zulgar.ts).
// They start DARK. While the spirit hunts (a Spirit of the Hunt, the heroic
// Ambush that ends one, the final phase) the players who are NOT the Prey
// light them, and the Prey runs the avatar through the lit ones.
//
//   Lighting    a living player on the terrace who is not marked as Prey
//               lights a dark glyph by standing on it for 2 s (the bar on
//               the glyph; stepping off resets it; two players on one glyph
//               light it no faster). With no such player on the terrace the
//               Prey may light for themself, in 1 s.
//   Sunstruck   when the avatar crosses a lit glyph he is Sunstruck: 60
//               percent slower and taking 25 percent more damage for 3 s. The
//               glyph goes dark and stays cold for 8 s (it cannot be lit).
//   Wary        from a strike no glyph strikes him again for 5 s (the window
//               and 2 s after it): a lit glyph he crosses meanwhile stays lit.
//   The end     when a hunt ends every glyph goes dark and every clock stops.
//   Heroic      the Idol's Breath snuffs every lit glyph of the half it
//               washes over (zulgar_idol.ts calls snuffGlyphsInHalf).
//
// Deterministic and draw-free: the lighter of a glyph is the lowest-id player
// standing on it, the glyphs are walked in SUN_GLYPHS order. Every visible
// state rides the glyph object: its template (lit or dark) and its cast bar
// (the kindle and cold clocks, ids.ts), plus the Sunstruck and Wary auras on
// Zulgar and one `spellfx` per glyph lit and per strike.

import { SUN_GLYPHS } from '../../content/wildheart_basin_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type ZulgarFightState } from '../../types';
import { dropEncounterObject, localOf, spawnBasinObject } from './claim';
import {
  type IdolBreathSide,
  inIdolBreathHalf,
  ZULGAR_TUNING as T,
  WILDHEART_GLYPH_COLD,
  WILDHEART_GLYPH_KINDLE,
  WILDHEART_GLYPH_LIT_FX,
  WILDHEART_SUN_GLYPH_DARK,
  WILDHEART_SUN_GLYPH_LIT,
  ZULGAR_SUN_WARY,
  ZULGAR_SUNSTRUCK,
  ZULGAR_SUNSTRUCK_EXPOSED,
} from './ids';
import { clearObjectClock, setObjectClock, shrinePlayers } from './zulgar_terrace';

/** How far past a glyph's rim the avatar's centre still crosses it. */
const CROSS_MARGIN = 0.5;

/** Lay the six glyph objects, dark, when the fight starts. */
export function layGlyphs(ctx: SimContext, inst: InstanceSlot, st: ZulgarFightState): void {
  st.glyphs = SUN_GLYPHS.map((g) => ({
    objectId: spawnBasinObject(ctx, inst, WILDHEART_SUN_GLYPH_DARK, 'Sun Glyph', g.x, g.z, g.r).id,
    lit: false,
    kindle: 0,
    cold: 0,
  }));
  st.sunWary = 0;
}

/** Take the glyph objects away (the pull ended). */
export function clearGlyphs(ctx: SimContext, inst: InstanceSlot, st: ZulgarFightState): void {
  for (const g of st.glyphs) dropEncounterObject(ctx, inst, g.objectId);
  st.glyphs = [];
  st.sunWary = 0;
}

/** Glyphs lit right now. */
export function glyphsLit(st: ZulgarFightState): number {
  let n = 0;
  for (const g of st.glyphs) if (g.lit) n++;
  return n;
}

/** Put glyph `i` out: dark, with `cold` seconds before it can be lit again. */
function darken(ctx: SimContext, st: ZulgarFightState, i: number, cold: number): void {
  const g = st.glyphs[i];
  if (!g) return;
  g.lit = false;
  g.kindle = 0;
  g.cold = cold;
  const obj = ctx.entities.get(g.objectId);
  if (!obj) return;
  obj.templateId = WILDHEART_SUN_GLYPH_DARK;
  if (cold > 0) setObjectClock(obj, WILDHEART_GLYPH_COLD, T.glyphColdSeconds, cold);
  else clearObjectClock(obj);
}

/** The hunt is over: every glyph dark, every clock stopped. */
export function darkenGlyphs(ctx: SimContext, st: ZulgarFightState): void {
  for (let i = 0; i < st.glyphs.length; i++) darken(ctx, st, i, 0);
}

/** Light glyph `i` (a finished kindle, or the dev trigger). Returns true when
 *  it caught. */
export function lightGlyph(
  ctx: SimContext,
  st: ZulgarFightState,
  i: number,
  by: Entity | null,
): boolean {
  const g = st.glyphs[i];
  const obj = g ? ctx.entities.get(g.objectId) : undefined;
  if (!g || !obj || g.lit) return false;
  g.lit = true;
  g.kindle = 0;
  g.cold = 0;
  obj.templateId = WILDHEART_SUN_GLYPH_LIT;
  clearObjectClock(obj);
  ctx.emit({
    type: 'spellfx',
    sourceId: by?.id ?? obj.id,
    targetId: obj.id,
    school: 'holy',
    fx: 'nova',
    ability: WILDHEART_GLYPH_LIT_FX,
  });
  return true;
}

/** Heroic: the Idol's Breath snuffs the lit glyphs of the half it washes over
 *  (they may be lit again at once). Returns how many went out. */
export function snuffGlyphsInHalf(
  ctx: SimContext,
  st: ZulgarFightState,
  side: IdolBreathSide,
): number {
  let n = 0;
  SUN_GLYPHS.forEach((spot, i) => {
    if (!st.glyphs[i]?.lit || !inIdolBreathHalf(spot.x, side)) return;
    darken(ctx, st, i, 0);
    n++;
  });
  return n;
}

/** Sunstruck: the slow, the damage window and the wariness that follows; the
 *  glyph that struck him goes dark and cold. */
function sunstrike(ctx: SimContext, z: Entity, st: ZulgarFightState, i: number): void {
  const objectId = st.glyphs[i].objectId;
  darken(ctx, st, i, T.glyphColdSeconds);
  st.sunWary = T.sunWarySeconds;
  ctx.applyAura(z, {
    id: ZULGAR_SUNSTRUCK,
    name: 'Sunstruck',
    kind: 'slow',
    remaining: T.sunstruckSeconds,
    duration: T.sunstruckSeconds,
    value: 1 - T.sunstruckSlow,
    sourceId: z.id,
    school: 'holy',
    undispellable: true,
  });
  ctx.applyAura(z, {
    id: ZULGAR_SUNSTRUCK_EXPOSED,
    name: 'Sunstruck',
    kind: 'vulnerability',
    remaining: T.sunstruckSeconds,
    duration: T.sunstruckSeconds,
    value: T.sunstruckVuln,
    sourceId: z.id,
    school: 'holy',
    undispellable: true,
  });
  ctx.applyAura(z, {
    id: ZULGAR_SUN_WARY,
    name: 'Wary of the Sun',
    // A mark of the rule: it carries no stat.
    kind: 'buff_dr',
    remaining: T.sunWarySeconds,
    duration: T.sunWarySeconds,
    value: 0,
    sourceId: z.id,
    school: 'holy',
    undispellable: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: z.id,
    targetId: objectId,
    school: 'holy',
    fx: 'nova',
    ability: ZULGAR_SUNSTRUCK,
  });
}

/** Does the avatar stand on glyph `i` (its rim and a step past it)? */
function avatarOn(at: { x: number; z: number }, i: number): boolean {
  const g = SUN_GLYPHS[i];
  return Math.hypot(at.x - g.x, at.z - g.z) <= g.r + CROSS_MARGIN;
}

/** Strike the avatar with the first lit glyph he stands on, unless he is
 *  still wary. Returns true when one struck. */
export function strikeIfOnLitGlyph(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
): boolean {
  if (st.sunWary > 0) return false;
  const at = localOf(ctx, inst, z);
  for (let i = 0; i < st.glyphs.length; i++) {
    if (!st.glyphs[i].lit || !avatarOn(at, i)) continue;
    sunstrike(ctx, z, st, i);
    return true;
  }
  return false;
}

/**
 * One tick of the glyphs. `lighting`: the spirit hunts, so dark glyphs may be
 * lit. `striking`: the avatar is abroad (not vanished), so a lit glyph he
 * crosses strikes him.
 */
export function stepGlyphs(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
  lighting: boolean,
  striking: boolean,
): void {
  if (st.sunWary > 0) st.sunWary = Math.max(0, st.sunWary - DT);
  if (striking) strikeIfOnLitGlyph(ctx, inst, z, st);
  // Who may light: the terrace's players who are not marked; with none, the
  // Prey themselves (a lone player, or a heroic pair both marked), faster.
  const terrace = lighting ? shrinePlayers(ctx, inst) : [];
  const free = terrace.filter((p) => !st.preyIds.includes(p.id));
  const lighters = free.length > 0 ? free : terrace;
  const need = free.length > 0 ? T.glyphKindleSeconds : T.glyphKindleAloneSeconds;
  const o = ctx.instanceOriginOf(inst);
  for (let i = 0; i < st.glyphs.length; i++) {
    const g = st.glyphs[i];
    const obj = ctx.entities.get(g.objectId);
    if (g.lit || !obj) continue;
    if (g.cold > 0) {
      g.cold = Math.max(0, g.cold - DT);
      g.kindle = 0;
      if (g.cold > 0) setObjectClock(obj, WILDHEART_GLYPH_COLD, T.glyphColdSeconds, g.cold);
      else clearObjectClock(obj);
      continue;
    }
    const spot = SUN_GLYPHS[i];
    const lighter = lighters.find(
      (p) => Math.hypot(p.pos.x - o.x - spot.x, p.pos.z - o.z - spot.z) <= spot.r,
    );
    if (!lighter) {
      // Stepping off resets it.
      g.kindle = 0;
      clearObjectClock(obj);
      continue;
    }
    g.kindle += DT;
    if (g.kindle >= need - 1e-9) lightGlyph(ctx, st, i, lighter);
    else setObjectClock(obj, WILDHEART_GLYPH_KINDLE, need, need - g.kindle, lighter.id);
  }
}

/** `/dev wildheart trigger sunstrike`: strike him now off the glyph nearest
 *  him, lit or not, wary or not (a playtest look at the window). */
export function devSunstrike(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
): void {
  const at = localOf(ctx, inst, z);
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  SUN_GLYPHS.forEach((g, i) => {
    const d = Math.hypot(at.x - g.x, at.z - g.z);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  if (st.glyphs[best]) sunstrike(ctx, z, st, best);
}
