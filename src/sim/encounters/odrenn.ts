// Wing 2 of The Undermount Descent: Odrenn the Temperer (verb: SORT).
//
// The tempering floor sorts the raid: marks derive from ROOM GEOGRAPHY, never
// from player-pairing charges. The hot side of the centerline (arena x greater
// than the boss spawn x) marks Scorched; the quench side marks Chilled; a
// hysteresis band astride the line keeps the prior mark so edge-dancing cannot
// flap marks per tick. Mixed-mark pairs standing inside ODRENN_MARK_BURN_RADIUS
// burn each other steadily (never bursty). The Cinder Arc seeds on ONE rng draw
// and then chain-walks nearest neighbors inside ODRENN_ARC_RADIUS, damage
// growing per jump, so the taught lattice spacing (ODRENN_LATTICE_MIN to
// ODRENN_LATTICE_MAX yards) breaks the chain while keeping mixed pairs apart.
// The aging clock is Tempering, a permanent stacking haste self-buff on the
// Kiln Fury aura pattern, alongside the ordinary template `enrage` at 15%.
//
// Physics fact: radius queries here are 2D (x/z, spatial.ts); no mechanic may
// assume height-dodging. All rng goes through ctx.rng in tick order: exactly
// one draw per Cinder Arc (the seed target); the chain walk is deterministic
// nearest-neighbor. src/sim-pure (tests/architecture.test.ts).

import type { SimContext } from '../sim_context';
import { type Aura, DT, dist2d, type Entity } from '../types';
import {
  ODRENN_ARC_BASE_DMG,
  ODRENN_ARC_CADENCE_S,
  ODRENN_ARC_GROWTH,
  ODRENN_ARC_RADIUS,
  ODRENN_ENRAGE_HASTE_PER_STACK,
  ODRENN_ENRAGE_STACK_CADENCE_S,
  ODRENN_HYSTERESIS_YD,
  ODRENN_MARK_BURN_DPS,
  ODRENN_MARK_BURN_RADIUS,
  UNDERMOUNT_ROOM_RADIUS,
} from './undermount';

export const ODRENN_BOSS_ID = 'odrenn_the_temperer';
export const ODRENN_SCORCHED_AURA_ID = 'odrenn_scorched';
export const ODRENN_CHILLED_AURA_ID = 'odrenn_chilled';
export const ODRENN_TEMPER_AURA_ID = 'odrenn_temper';
// Marks are auras refreshed every tick; a short duration self-cleans a raider
// who leaves the fight (death, leash, hearth) without bespoke cleanup paths.
const MARK_DURATION_S = 2;
const TEMPER_DURATION_S = 3600; // permanent for any real pull; reset strips it

export interface OdrennEncounterState {
  arcTimer: number;
  enrageTimer: number;
  enrageStacks: number;
}

function hasAura(e: Entity, id: string): boolean {
  return e.auras.some((a) => a.id === id);
}

function removeAura(ctx: SimContext, e: Entity, id: string, name: string): void {
  const before = e.auras.length;
  e.auras = e.auras.filter((a) => a.id !== id);
  if (e.auras.length !== before) {
    ctx.emit({ type: 'aura', targetId: e.id, name, gained: false });
  }
}

function refreshMark(ctx: SimContext, boss: Entity, p: Entity, id: string, name: string): void {
  const existing = p.auras.find((a) => a.id === id);
  if (existing) {
    existing.remaining = MARK_DURATION_S;
    return;
  }
  const aura: Aura = {
    id,
    name,
    // Pure geography marker: 'vulnerability' at value 0 is arithmetically
    // inert everywhere the kind is consumed; the aura exists to be READ (by
    // this module, the wire, and the HUD), not to modify stats.
    kind: 'vulnerability',
    remaining: MARK_DURATION_S,
    duration: MARK_DURATION_S,
    value: 0,
    sourceId: boss.id,
    school: id === ODRENN_SCORCHED_AURA_ID ? 'fire' : 'frost',
  };
  p.auras.push(aura);
  ctx.emit({ type: 'aura', targetId: p.id, name, gained: true });
}

/** Living raiders inside Odrenn's room (spawn-scoped like the wing clear credit). */
function raidersIn(ctx: SimContext, boss: Entity): Entity[] {
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || p.dead) continue;
    if (dist2d(p.pos, boss.spawnPos) > UNDERMOUNT_ROOM_RADIUS) continue;
    out.push(p);
  }
  return out;
}

export function initOdrennEncounter(boss: Entity): void {
  boss.odrenn = {
    arcTimer: ODRENN_ARC_CADENCE_S,
    enrageTimer: ODRENN_ENRAGE_STACK_CADENCE_S,
    enrageStacks: 0,
  };
}

/** Wipe/leash reset: strip marks and Tempering, clear the module state. */
export function resetOdrennEncounter(ctx: SimContext, boss: Entity): void {
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p) continue;
    removeAura(ctx, p, ODRENN_SCORCHED_AURA_ID, 'Scorched');
    removeAura(ctx, p, ODRENN_CHILLED_AURA_ID, 'Chilled');
  }
  removeAura(ctx, boss, ODRENN_TEMPER_AURA_ID, 'Tempering');
  boss.odrenn = undefined;
}

export function updateOdrennEncounter(ctx: SimContext, boss: Entity): void {
  if (boss.dead) return;
  if (!boss.odrenn) initOdrennEncounter(boss);
  const st = boss.odrenn;
  if (!st) return;
  const raiders = raidersIn(ctx, boss);

  // 1) Geography marks with hysteresis: exactly one mark per living raider.
  //    The centerline is the spawn x axis; hot side is +x, quench side is -x.
  for (const p of raiders) {
    const rel = p.pos.x - boss.spawnPos.x;
    const inBand = Math.abs(rel) <= ODRENN_HYSTERESIS_YD;
    const prior = hasAura(p, ODRENN_SCORCHED_AURA_ID)
      ? ODRENN_SCORCHED_AURA_ID
      : hasAura(p, ODRENN_CHILLED_AURA_ID)
        ? ODRENN_CHILLED_AURA_ID
        : null;
    const side =
      inBand && prior ? prior : rel >= 0 ? ODRENN_SCORCHED_AURA_ID : ODRENN_CHILLED_AURA_ID;
    if (side === ODRENN_SCORCHED_AURA_ID) {
      refreshMark(ctx, boss, p, ODRENN_SCORCHED_AURA_ID, 'Scorched');
      if (prior === ODRENN_CHILLED_AURA_ID) removeAura(ctx, p, ODRENN_CHILLED_AURA_ID, 'Chilled');
    } else {
      refreshMark(ctx, boss, p, ODRENN_CHILLED_AURA_ID, 'Chilled');
      if (prior === ODRENN_SCORCHED_AURA_ID)
        removeAura(ctx, p, ODRENN_SCORCHED_AURA_ID, 'Scorched');
    }
  }

  // 2) Mixed-mark burn: steady per-tick damage to BOTH members of each mixed
  //    pair in range. Steady, never bursty: the tick quantum is the pulse.
  const burnPerTick = Math.max(1, Math.round(ODRENN_MARK_BURN_DPS * DT));
  for (let i = 0; i < raiders.length; i++) {
    for (let j = i + 1; j < raiders.length; j++) {
      const a = raiders[i];
      const b = raiders[j];
      const mixed =
        (hasAura(a, ODRENN_SCORCHED_AURA_ID) && hasAura(b, ODRENN_CHILLED_AURA_ID)) ||
        (hasAura(a, ODRENN_CHILLED_AURA_ID) && hasAura(b, ODRENN_SCORCHED_AURA_ID));
      if (!mixed || dist2d(a.pos, b.pos) > ODRENN_MARK_BURN_RADIUS) continue;
      ctx.dealDamage(boss, a, burnPerTick, false, 'fire', 'Tempering Clash', 'hit', true);
      ctx.dealDamage(boss, b, burnPerTick, false, 'fire', 'Tempering Clash', 'hit', true);
    }
  }

  // 3) Cinder Arc: ONE rng draw seeds the chain; the walk is deterministic
  //    nearest-neighbor within ODRENN_ARC_RADIUS, damage growing per jump.
  st.arcTimer -= DT;
  if (st.arcTimer <= 0) {
    st.arcTimer = ODRENN_ARC_CADENCE_S;
    if (raiders.length > 0) {
      let current = raiders[ctx.rng.int(0, raiders.length - 1)];
      const hit = new Set<number>([current.id]);
      let dmg = ODRENN_ARC_BASE_DMG;
      for (;;) {
        ctx.dealDamage(boss, current, Math.round(dmg), false, 'fire', 'Cinder Arc', 'hit', true);
        let next: Entity | null = null;
        let best = ODRENN_ARC_RADIUS;
        for (const p of raiders) {
          if (hit.has(p.id)) continue;
          const d = dist2d(current.pos, p.pos);
          if (d <= best) {
            best = d;
            next = p;
          }
        }
        if (!next) break;
        hit.add(next.id);
        current = next;
        dmg *= ODRENN_ARC_GROWTH;
      }
    }
  }

  // 4) Tempering, the aging clock: a permanent stacking haste self-buff on
  //    the Kiln Fury aura pattern (proven mob-side kind on this raid).
  st.enrageTimer -= DT;
  if (st.enrageTimer <= 0) {
    st.enrageTimer = ODRENN_ENRAGE_STACK_CADENCE_S;
    st.enrageStacks += 1;
    boss.auras = boss.auras.filter((a) => a.id !== ODRENN_TEMPER_AURA_ID);
    const aura: Aura = {
      id: ODRENN_TEMPER_AURA_ID,
      name: 'Tempering',
      kind: 'buff_haste',
      remaining: TEMPER_DURATION_S,
      duration: TEMPER_DURATION_S,
      value: st.enrageStacks * ODRENN_ENRAGE_HASTE_PER_STACK,
      stacks: st.enrageStacks,
      sourceId: boss.id,
      school: 'fire',
    };
    boss.auras.push(aura);
    ctx.emit({ type: 'aura', targetId: boss.id, name: 'Tempering', gained: true });
  }
}
