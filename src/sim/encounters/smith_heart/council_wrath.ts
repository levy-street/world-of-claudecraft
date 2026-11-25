// The Guardian of the Hammer's job in the Hammer Council (docs/design/raid/
// smith_heart.md section 7.1):
//
//   Energy            0 to 100, full in about 55 s, shown as the holder's
//                     energy bar (its resource: the target frame draws it, and
//                     it rides the snapshot like any mob's resource).
//   Mountain's Wrath  at 100: a 4 s bar, then everyone in the Quarry outside
//                     every pillar's shelter ring is struck (Normal
//                     440 to 520; Heroic and Mythic about 3,500 to 4,100:
//                     only a tank under a strong defensive or an immunity
//                     lives through it), and then
//                     EVERY pillar in the Quarry shatters (carved columns and
//                     risen stone alike; a mythic soul pillar alone stands).
//                     The carved columns teach the first Wrath; after it the
//                     only cover is the stone Wake the Stone raises (the raid
//                     is warned), so each landing brings the next Wake due.
//                     After the 4th Wrath the energy fills much faster.
//   Hammer's Weight   every 18 s: a 1.5 s bar at the tank, a heavy blow and
//                     +100 percent physical damage taken for 25 s (swap).
//   Heir              the Guardian fallen, once his soul reaches her the Seam
//                     Singer takes the energy where he left it and casts the
//                     SAME Wrath (Grieving Fury, council_fury.ts: its fill
//                     and bar hastened); on Heroic and Mythic she takes up
//                     Hammer's Weight too. Mountain's Rush dies with him.
//
// The Wrath's shelter is a FIXED ring round every pillar (council_ids.ts
// inCouncilShelter: the footprint plus `shelterReach`), whatever the caster's
// spot (the team's review of 2026-11-17; it was the sight line before). Zero
// rng in every pick; the draws are the damage rolls.

import { DT, type Entity } from '../../types';
import { clearCastIf, dropAuraById, heavySwing } from '../sunken_bastion/claim';
import { oweCover } from './council_cover';
import { stampFloor } from './council_floor_gap';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_NAMES,
  COUNCIL_ROLES,
  councilFillSeconds,
  inCouncilShelter,
  COUNCIL_TUNING as T,
} from './council_ids';
import { collapsePillar, councilPillars } from './council_pillars';
import { breakCursed } from './council_rush';
import {
  beginBar,
  type CouncilScope,
  councilHaste,
  jobHolder,
  memberFree,
  punishRoll,
} from './council_scope';
import { councilSay } from './council_voice';

/** Every member carries the energy bar's frame; only the Wrath's holder's
 *  fills (an empty bar on the others says the stone could take it up). */
export function syncEnergyBars(s: CouncilScope): void {
  const holder = jobHolder(s, 'wrath');
  for (const r of COUNCIL_ROLES) {
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
  const per =
    T.energyMax / councilFillSeconds(s.st.wraths, s.rules.enrageAfterWraths, councilHaste(s));
  s.st.energy = Math.min(T.energyMax, s.st.energy + per * DT);
}

/** Seconds until the next Wrath lands at the current fill (the holder's
 *  bar included); Infinity with nobody to cast it. */
export function secondsToNextWrath(s: CouncilScope): number {
  const holder = jobHolder(s, 'wrath');
  if (!holder) return Number.POSITIVE_INFINITY;
  const haste = councilHaste(s);
  const per = T.energyMax / councilFillSeconds(s.st.wraths, s.rules.enrageAfterWraths, haste);
  return Math.max(0, T.energyMax - s.st.energy) / per + T.wrathCast / haste;
}

/** Start the Wrath when the energy is full and its holder is free. Exported
 *  for the dev trigger (which fills the energy first). */
export function startWrath(s: CouncilScope): boolean {
  const holder = jobHolder(s, 'wrath');
  if (!holder || s.st.energy < T.energyMax - 1e-6) return false;
  if (!memberFree(s, holder.role)) return false;
  stampFloor(s.st);
  beginBar(s, holder.role, COUNCIL_CASTS.wrath, T.wrathCast, null, holder.heir);
  wearPillarLimit(s, holder.body);
  if (!holder.heir) councilSay(s, holder.role, 'wrath');
  return true;
}

/** Narrow Shelter on the caster through its bar: the limit the client's runes
 *  read, and the rule its tooltip says. */
function wearPillarLimit(s: CouncilScope, caster: Entity): void {
  const limit = s.rules.pillarLimit;
  if (limit === null) return;
  s.ctx.applyAura(caster, {
    id: COUNCIL_AURAS.pillarLimit,
    name: COUNCIL_NAMES.pillarLimit,
    kind: 'vulnerability',
    remaining: 3600,
    duration: 3600,
    permanent: true,
    value: 0,
    value2: limit,
    stacks: 1,
    sourceId: caster.id,
    school: 'physical',
    undispellable: true,
  });
}

/** One Wrath hit's roll, whoever casts it, times the tier's Wrath factor
 *  (Heroic's and Mythic's kill anyone unhidden but a tank under a strong
 *  defensive; an immunity still takes none, the damage pipeline's own rule). */
function wrathRoll(s: CouncilScope, caster: Entity): number {
  return Math.round(punishRoll(s, caster, T.wrathMin, T.wrathMax) * s.rules.wrathMult);
}

/** The Wrath lands: who it strikes (whoever no pillar hides), then every
 *  pillar but a soul's shatters. Returns how many it struck (the tests read
 *  it). */
export function landWrath(s: CouncilScope, caster: Entity): number {
  const { ctx, inst, st } = s;
  st.energy = 0;
  st.wraths++;
  // The next Wrath waits for a Wake to give it cover (council_cover.ts).
  oweCover(st);
  dropAuraById(caster, COUNCIL_AURAS.pillarLimit);
  ctx.emit({
    type: 'spellfx',
    sourceId: caster.id,
    targetId: caster.id,
    school: 'physical',
    fx: 'nova',
    ability: COUNCIL_CASTS.wrath,
  });
  const all = councilPillars(ctx, inst);
  // The shelter is a FIXED ring round each pillar (council_ids.ts
  // inCouncilShelter, the team's review of 2026-11-17), never the shadow from
  // the caster's spot. A soul pillar (mythic, council_soul.ts) and the cursed
  // pillar (council_rush.ts) shield nobody.
  const pillars = all.filter((p) => p.soul === null && !p.cursed);
  // Who shelters at which pillar: a player inside two overlapping rings counts
  // for BOTH (Narrow Shelter's census), never only the first.
  const shields = new Map<number, Entity[]>();
  const sheltered: { p: Entity; at: number[] }[] = [];
  let struck = 0;
  // Arena-wide (the team's playtest of 2026-11-25): every player on the
  // council's floor (s.players, COUNCIL_ARENA_R round the Quarry's middle),
  // wherever the caster stands; only a pillar's shelter escapes it.
  for (const p of s.players) {
    if (p.dead) continue;
    const at: number[] = [];
    for (const pl of pillars) {
      if (!inCouncilShelter(pl.e.pos.x, pl.e.pos.z, pl.r, p.pos.x, p.pos.z)) continue;
      at.push(pl.e.id);
      const behind = shields.get(pl.e.id);
      if (behind) behind.push(p);
      else shields.set(pl.e.id, [p]);
    }
    if (at.length > 0) {
      sheltered.push({ p, at });
      continue;
    }
    const amount = wrathRoll(s, caster);
    ctx.dealDamage(caster, p, amount, false, 'physical', COUNCIL_NAMES.wrath, 'hit', true);
    struck++;
  }
  // One too many at a pillar (Narrow Shelter) and each of them takes the
  // tier's share of the blast (it hurts; on its own it never wipes). A player
  // counted at two pillars takes it once, when either is crowded.
  const limit = s.rules.pillarLimit;
  if (limit !== null) {
    for (const { p, at } of sheltered) {
      if (!at.some((id) => (shields.get(id)?.length ?? 0) > limit)) continue;
      const amount = wrathRoll(s, caster);
      ctx.dealDamage(
        caster,
        p,
        Math.round(amount * s.rules.crowdShare),
        false,
        'physical',
        COUNCIL_NAMES.wrath,
        'hit',
        true,
      );
      struck++;
    }
  }
  // Then the mountain's anger brings every pillar down, the cursed one too (a
  // soul's stands): the stone breaks clean, its rubble a look, never a hazard
  // under the hidden.
  for (const pl of all) {
    if (pl.soul) continue;
    if (pl.cursed) breakCursed(s, pl);
    else collapsePillar(ctx, inst, st, pl, false);
  }
  // The next cover is never more than a breath after the Wrath.
  st.wakeTimer = Math.min(st.wakeTimer, T.wakeAfterWrath);
  // Normal: the song is owed now, so its Resonance runs out before the next.
  if (s.rules.songAfterWrath) st.songDue = T.songAfterWrath;
  return struck;
}

/** Hammer's Weight: the Guardian's own; on Heroic and Mythic the Singer
 *  takes it up once his soul reaches her (jobHolder 'weight'). */
export function startWeight(s: CouncilScope): boolean {
  const holder = jobHolder(s, 'weight');
  if (!holder || !memberFree(s, holder.role)) return false;
  const g = holder.body;
  const tank = g.aggroTargetId !== null ? s.ctx.entities.get(g.aggroTargetId) : undefined;
  if (!tank || tank.dead) return false;
  s.st.weightTimer = T.weightEvery;
  beginBar(s, holder.role, COUNCIL_CASTS.weight, T.weightCast, tank.id, holder.heir);
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
  // A swing: the weapon already carries the tier's swingMult (tier_swing.ts),
  // so the mechanics' factor rides on top of it only past that raise.
  heavySwing(
    s.ctx,
    g,
    tank,
    (T.weightMult * s.rules.damageMult) / s.rules.swingMult,
    COUNCIL_NAMES.weight,
  );
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
}

/** Clear the job's bars off a body (a reset, a death). */
export function clearWrathBars(b: Entity): void {
  clearCastIf(b, COUNCIL_CASTS.wrath, COUNCIL_CASTS.weight, COUNCIL_CASTS.rush);
  dropAuraById(b, COUNCIL_AURAS.pillarLimit);
}
