// The Howdah Hexcaller's totems (great_saurian.ts, the rework of 2026-10-14):
// the rider fights from his seat from the pull. Every 10 s he throws a Sunbone
// Sap Totem onto the ford, 14 yd from the Saurian, and the totem feeds the
// beast down a tether until the group breaks it.
//
//   The throw     5 s into the pull, then every 10 s, while the howdah is
//                 whole. Three totems stand at most; with three up he waits.
//                 Once the howdah has broken he throws none.
//   Arming        a totem mends nothing for its first 4 s (its bar): a totem
//                 broken inside that bar has healed nothing.
//   The mending   then 0.8 percent of the Saurian's health every 2 s, each
//                 totem on its own clock, for as long as it stands.
//   The backlash  a totem broken by the group snaps its stored sap back into
//                 the beast: the Saurian takes the totem's own health, so the
//                 damage spent on a totem is never lost. On heroic the same
//                 backlash knocks the drummer off his beat (saurian_drum.ts).
//   The end       the totems crumble when the Saurian falls, and are taken
//                 away when the pull ends without a kill.
//
// Deterministic and draw-free: the landing spot is one of eight round the
// Saurian, the first that stands on its floor clear of the other totems,
// walked from a hashed start (kitHash on the Saurian's id and the throw's
// number); the mending and the backlash are flat numbers. Every visible state
// rides existing entity fields: the totem is a body of the claim, its cast bar
// is its clock (`castTargetId` the Saurian), the Saurian wears a stack aura
// while any stands, and the throw, each mending and each break is a `spellfx`.

import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import { kitHash } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type SaurianFightState } from '../../types';
import { dropEncounterBody, startBar } from './claim';
import {
  SAP_TOTEM_ID,
  SAURIAN_SAP_BACKLASH,
  SAURIAN_SAP_TETHER,
  SAURIAN_SAPPED,
  SAURIAN_TOTEM_LOG,
  SAURIAN_TOTEM_THROW,
  SAURIAN_TUNING as T,
} from './ids';

/** The damage name of a broken totem's backlash (re-localized by src/ui/sim_i18n.ts). */
export const SAP_BACKLASH_NAME = 'Sap Backlash';
/** The heal name of a totem's mending: the Hexcaller's own Ancestral Sap. */
export const SAP_HEAL_NAME = 'Ancestral Sap';
/** A step from the Saurian's floor to a spot's that is more than this is not
 *  the ford it stands in (a bank, a drum of the basalt steps, the gorge). */
const FLOOR_STEP = 1.2;

/** The living totems of this pull. */
export function sapTotems(ctx: SimContext, st: SaurianFightState): Entity[] {
  const out: Entity[] = [];
  for (const row of st.totems) {
    const e = ctx.entities.get(row.id);
    if (e && !e.dead) out.push(e);
  }
  return out;
}

/** Where the next totem lands (world), or null when no spot round the
 *  Saurian is fit. */
export function totemSpot(
  ctx: SimContext,
  saurian: Entity,
  st: SaurianFightState,
): { x: number; z: number } | null {
  const standing = sapTotems(ctx, st);
  const start = kitHash(saurian.id, st.totemsThrown) % T.totemSpots;
  for (let k = 0; k < T.totemSpots; k++) {
    const a = ((start + k) % T.totemSpots) * ((Math.PI * 2) / T.totemSpots);
    const x = saurian.pos.x + Math.sin(a) * T.totemRange;
    const z = saurian.pos.z + Math.cos(a) * T.totemRange;
    if (Math.abs(ctx.groundPos(x, z).y - saurian.pos.y) > FLOOR_STEP) continue;
    if (standing.some((t) => Math.hypot(t.pos.x - x, t.pos.z - z) < T.totemSpacing)) continue;
    return { x, z };
  }
  return null;
}

/** Keep the Saurian's stack aura on the totems that stand (none: no aura). */
function paintSapped(ctx: SimContext, saurian: Entity, st: SaurianFightState): void {
  const n = sapTotems(ctx, st).length;
  const at = saurian.auras.findIndex((a) => a.id === SAURIAN_SAPPED);
  if (n === 0 || saurian.dead) {
    if (at >= 0) saurian.auras = saurian.auras.filter((a) => a.id !== SAURIAN_SAPPED);
    return;
  }
  if (at >= 0) {
    if (saurian.auras[at].stacks !== n) saurian.auras[at].stacks = n;
    return;
  }
  ctx.applyAura(saurian, {
    id: SAURIAN_SAPPED,
    name: SAP_HEAL_NAME,
    // A mark of the rule: it carries no stat (the totems do the mending).
    kind: 'buff_dr',
    remaining: 3600,
    duration: 3600,
    permanent: true,
    value: 0,
    stacks: n,
    sourceId: saurian.id,
    school: 'nature',
    undispellable: true,
  });
}

/** The rider throws a totem now. Returns it (null when no spot is fit, or
 *  three already stand). */
export function throwTotem(
  ctx: SimContext,
  inst: InstanceSlot,
  saurian: Entity,
  st: SaurianFightState,
): Entity | null {
  if (sapTotems(ctx, st).length >= T.totemMax) return null;
  const spot = totemSpot(ctx, saurian, st);
  if (!spot) return null;
  const first = st.totemsThrown === 0;
  st.totemsThrown++;
  // It never fights: no victim, so it stands idle until it is struck.
  const totem = spawnKitAdd(ctx, inst, saurian, SAP_TOTEM_ID, spot.x, spot.z, null);
  if (!totem) return null;
  totem.facing = Math.atan2(saurian.pos.x - totem.pos.x, saurian.pos.z - totem.pos.z);
  totem.prevFacing = totem.facing;
  st.totems.push({ id: totem.id, next: T.totemArm });
  startBar(totem, SAURIAN_SAP_TETHER, T.totemArm, saurian.id);
  paintSapped(ctx, saurian, st);
  ctx.emit({
    type: 'spellfx',
    sourceId: saurian.id,
    targetId: totem.id,
    school: 'nature',
    fx: 'nova',
    ability: SAURIAN_TOTEM_THROW,
  });
  if (first)
    ctx.emit({ type: 'log', text: SAURIAN_TOTEM_LOG, color: '#e8c070', entityId: saurian.id });
  return totem;
}

/** The living player highest on a standing totem's threat (ties to the lower
 *  id), or undefined while nobody has struck it. */
function topThreat(ctx: SimContext, totem: Entity): number | undefined {
  let best: number | undefined;
  let bestT = 0;
  for (const [id, threat] of totem.threat) {
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.kind !== 'player') continue;
    if (threat > bestT || (threat === bestT && best !== undefined && id < best)) {
      best = id;
      bestT = threat;
    }
  }
  return best;
}

/** Who a broken totem's backlash is credited to: whoever led its threat
 *  while it stood (a body's threat is wiped as it dies), else whoever first
 *  struck it or the Saurian (the tap), else whoever the Saurian fights. Null
 *  when no living player can be named. */
function breaker(
  ctx: SimContext,
  saurian: Entity,
  totem: Entity,
  by: number | undefined,
): Entity | null {
  for (const id of [by, totem.tappedById, saurian.aggroTargetId]) {
    const e = id === null || id === undefined ? undefined : ctx.entities.get(id);
    if (e && !e.dead && e.kind === 'player') return e;
  }
  return null;
}

/**
 * One tick of the standing totems: the ones the group broke snap back into
 * the Saurian, the rest run their clocks and mend it. Returns how many were
 * broken by the group this tick (the heroic drum reads it).
 */
export function stepTotems(ctx: SimContext, saurian: Entity, st: SaurianFightState): number {
  if (st.totems.length === 0) return 0;
  let broken = 0;
  const keep: SaurianFightState['totems'] = [];
  for (const row of st.totems) {
    const totem = ctx.entities.get(row.id);
    if (!totem) continue;
    if (totem.dead) {
      // Still on the roll and dead: the group broke it (a totem that crumbles
      // with the Saurian, or goes with a wipe, is struck off the roll first).
      if (!saurian.dead) {
        const by = breaker(ctx, saurian, totem, row.by);
        broken++;
        ctx.emit({
          type: 'spellfx',
          sourceId: totem.id,
          targetId: saurian.id,
          school: 'nature',
          fx: 'nova',
          ability: SAURIAN_SAP_BACKLASH,
        });
        // Exactly what the group spent on it, handed back: never rolled,
        // never scaled by the breaker's own output.
        ctx.dealDamage(
          by,
          saurian,
          totem.maxHp,
          false,
          'nature',
          SAP_BACKLASH_NAME,
          'hit',
          true,
          undefined,
          undefined,
          undefined,
          true,
        );
      }
      continue;
    }
    keep.push(row);
    row.by = topThreat(ctx, totem) ?? row.by;
    if (saurian.dead) continue;
    row.next -= DT;
    if (row.next > 1e-9) {
      totem.castRemaining = Math.max(0, row.next);
      continue;
    }
    row.next += T.totemHealEvery;
    startBar(totem, SAURIAN_SAP_TETHER, T.totemHealEvery, saurian.id);
    ctx.emit({
      type: 'spellfx',
      sourceId: totem.id,
      targetId: saurian.id,
      school: 'nature',
      fx: 'nova',
      ability: SAURIAN_SAP_TETHER,
    });
    if (saurian.hp < saurian.maxHp)
      ctx.applyHeal(
        totem,
        saurian,
        Math.max(1, Math.round(saurian.maxHp * T.totemHealPct)),
        SAP_HEAL_NAME,
        SAURIAN_SAP_TETHER,
        false,
      );
  }
  st.totems = keep;
  paintSapped(ctx, saurian, st);
  return broken;
}

/** The rider's throwing clock, while he sits the howdah. */
export function stepTotemThrows(
  ctx: SimContext,
  inst: InstanceSlot,
  saurian: Entity,
  st: SaurianFightState,
): void {
  if (st.howdahBroken) return;
  st.totemTimer -= DT;
  if (st.totemTimer > 1e-9) return;
  st.totemTimer = throwTotem(ctx, inst, saurian, st) ? T.totemEvery : T.totemRetry;
}

/** The Saurian has fallen: its totems crumble where they stand. */
export function crumbleTotems(ctx: SimContext, saurian: Entity, st: SaurianFightState): void {
  for (const totem of sapTotems(ctx, st)) ctx.handleDeath(totem, null);
  st.totems = [];
  paintSapped(ctx, saurian, st);
}

/** The pull ended without a kill: the totems are taken away. */
export function clearTotems(
  ctx: SimContext,
  inst: InstanceSlot,
  saurian: Entity,
  st: SaurianFightState,
): void {
  for (const row of st.totems) dropEncounterBody(ctx, inst, saurian, row.id);
  st.totems = [];
  paintSapped(ctx, saurian, st);
}
