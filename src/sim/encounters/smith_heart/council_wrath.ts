// The Guardian of the Hammer's job in the Hammer Council (docs/design/raid/
// smith_heart.md section 7.1):
//
//   Energy            0 to 100, full in about 55 s, shown as the holder's
//                     energy bar (its resource: the target frame draws it, and
//                     it rides the snapshot like any mob's resource).
//   Mountain's Wrath  at 100: a 4 s bar, then everyone in the Quarry with no
//                     pillar between them and the caster is struck; every
//                     pillar that shielded at least one player loses a piece.
//                     After the 4th Wrath the energy fills much faster.
//   Hammer's Weight   every 18 s: a 1.5 s bar at the tank, a heavy blow and
//                     +100 percent physical damage taken for 25 s (swap).
//   Heir              the Guardian fallen, a survivor takes the energy and
//                     casts a shorter Wrath (fills in 35 s, a 3 s bar);
//                     Hammer's Weight dies with the Guardian.
//
// The Wrath's readable telegraph is the trash engine's sight field (its
// declaration is the templates' encounter-driven `trashKit.nova`); the hit is
// the sim's own sight line (ctx.hasLineOfSight), the pillars being combat
// walls. Zero rng in every pick; the draws are the damage rolls.

import { DT, type Entity } from '../../types';
import { clearCastIf, heavySwing } from '../sunken_bastion/claim';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_NAMES,
  type CouncilRole,
  councilFillSeconds,
  COUNCIL_TUNING as T,
} from './council_ids';
import { councilPillars, crackPillar, pillarBetween } from './council_pillars';
import {
  beginBar,
  type CouncilScope,
  jobHolder,
  living,
  memberFree,
  raidWarn,
  roll,
} from './council_scope';
import { councilSay } from './council_voice';

/** Every member carries the energy bar's frame; only the Wrath's holder's
 *  fills (an empty bar on the others says the stone could take it up). */
export function syncEnergyBars(s: CouncilScope): void {
  const holder = jobHolder(s, 'wrath');
  for (const r of ['guardian', 'slabwright', 'singer'] as CouncilRole[]) {
    const b = s.bodies[r];
    if (!b) continue;
    b.resourceType = 'energy';
    b.maxResource = T.energyMax;
    b.resource = holder && holder.body === b ? Math.round(s.st.energy) : 0;
  }
}

/** The energy climbs while the holder is not casting its Wrath. */
export function fillEnergy(s: CouncilScope): void {
  const holder = jobHolder(s, 'wrath');
  if (!holder) return;
  if (s.st.bars[holder.role]?.castId === COUNCIL_CASTS.wrath) return;
  const per = T.energyMax / councilFillSeconds(holder.heir, s.st.wraths, s.rules.heirFillSeconds);
  s.st.energy = Math.min(T.energyMax, s.st.energy + per * DT);
}

/** Seconds until the next Wrath lands at the current fill (the holder's
 *  bar included); Infinity with nobody to cast it. */
export function secondsToNextWrath(s: CouncilScope): number {
  const holder = jobHolder(s, 'wrath');
  if (!holder) return Number.POSITIVE_INFINITY;
  const per = T.energyMax / councilFillSeconds(holder.heir, s.st.wraths, s.rules.heirFillSeconds);
  const cast = holder.heir ? T.heirWrathCast : T.wrathCast;
  return Math.max(0, T.energyMax - s.st.energy) / per + cast;
}

/** Start the Wrath when the energy is full and its holder is free. Exported
 *  for the dev trigger (which fills the energy first). */
export function startWrath(s: CouncilScope): boolean {
  const holder = jobHolder(s, 'wrath');
  if (!holder || s.st.energy < T.energyMax - 1e-6) return false;
  if (!memberFree(s, holder.role)) return false;
  beginBar(
    s,
    holder.role,
    COUNCIL_CASTS.wrath,
    holder.heir ? T.heirWrathCast : T.wrathCast,
    null,
    holder.heir,
  );
  raidWarn(s, holder.body, 'wrath', "Mountain's Wrath! Hide behind a pillar!");
  if (!holder.heir) councilSay(s, holder.role, 'wrath');
  return true;
}

/** The Wrath lands: who it strikes, which pillars took it for whom. Returns
 *  how many it struck (the tests read it). */
export function landWrath(s: CouncilScope, caster: Entity, heir: boolean): number {
  const { ctx, inst, st } = s;
  st.energy = 0;
  st.wraths++;
  ctx.emit({
    type: 'spellfx',
    sourceId: caster.id,
    targetId: caster.id,
    school: 'physical',
    fx: 'nova',
    ability: COUNCIL_CASTS.wrath,
  });
  const all = councilPillars(ctx, inst);
  // A soul pillar shields nobody (mythic, council_soul.ts): its wall still
  // stands in the sight line, so a player it alone hides is struck anyway.
  const pillars = all.some((p) => p.soul) ? all.filter((p) => !p.soul) : all;
  const souls = pillars === all ? null : all.filter((p) => p.soul);
  const shields = new Set<number>();
  let struck = 0;
  for (const p of s.players) {
    if (p.dead) continue;
    if (Math.hypot(p.pos.x - caster.pos.x, p.pos.z - caster.pos.z) > T.wrathRadius) continue;
    const seen =
      ctx.hasLineOfSight(caster, p) ||
      (souls !== null &&
        pillarBetween(pillars, caster.pos, p.pos) === null &&
        pillarBetween(souls, caster.pos, p.pos) !== null);
    if (seen) {
      const amount = heir
        ? roll(s, caster, T.heirWrathMin, T.heirWrathMax)
        : roll(s, caster, T.wrathMin, T.wrathMax);
      ctx.dealDamage(caster, p, amount, false, 'physical', COUNCIL_NAMES.wrath, 'hit', true);
      struck++;
      continue;
    }
    const cover = pillarBetween(pillars, caster.pos, p.pos);
    if (cover) shields.add(cover.e.id);
  }
  // Each pillar that shielded someone takes the blast for them, once.
  for (const pl of pillars) if (shields.has(pl.e.id)) crackPillar(ctx, inst, st, pl);
  // Normal: the song is owed now, so its Resonance runs out before the next.
  if (s.rules.songAfterWrath) st.songDue = T.songAfterWrath;
  if (st.wraths === T.enrageAfterWraths)
    raidWarn(
      s,
      caster,
      'enrage',
      "The mountain's anger quickens! Mountain's Wrath comes much sooner now.",
    );
  return struck;
}

/** Hammer's Weight: the Guardian's own (it dies with it). */
export function startWeight(s: CouncilScope): boolean {
  const g = s.bodies.guardian;
  if (!living(g) || !memberFree(s, 'guardian')) return false;
  const tank = g.aggroTargetId !== null ? s.ctx.entities.get(g.aggroTargetId) : undefined;
  if (!tank || tank.dead) return false;
  s.st.weightTimer = T.weightEvery;
  beginBar(s, 'guardian', COUNCIL_CASTS.weight, T.weightCast, tank.id, false);
  return true;
}

export function landWeight(s: CouncilScope, g: Entity, targetId: number | null): void {
  const tank = targetId !== null ? s.ctx.entities.get(targetId) : undefined;
  if (!tank || tank.dead) return;
  // Still within the Guardian's reach (the swing's, a breath more).
  if (Math.hypot(tank.pos.x - g.pos.x, tank.pos.z - g.pos.z) > 12) return;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: g.id,
    targetId: tank.id,
    school: 'physical',
    fx: 'nova',
    ability: COUNCIL_CASTS.weight,
  });
  heavySwing(s.ctx, g, tank, T.weightMult * s.rules.damageMult, COUNCIL_NAMES.weight);
  if (tank.dead) return;
  s.ctx.applyAura(tank, {
    id: COUNCIL_AURAS.weight,
    name: COUNCIL_NAMES.weight,
    kind: 'expose',
    remaining: T.weightSeconds,
    duration: T.weightSeconds,
    value: T.weightTaken,
    sourceId: g.id,
    school: 'physical',
    undispellable: true,
  });
  raidWarn(s, g, 'weight', `Hammer's Weight on ${tank.name}: swap tanks!`, { player: tank.name });
}

/** Clear the job's bars off a body (a reset, a death). */
export function clearWrathBars(b: Entity): void {
  clearCastIf(b, COUNCIL_CASTS.wrath, COUNCIL_CASTS.weight);
}
