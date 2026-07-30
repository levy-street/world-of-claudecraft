// Wing 3 of The Undermount Descent: Volzharr, the Buried Furnace (the
// movement finale). He WALKS (template moveSpeed below the player run: the
// kite emerges from ordinary chase locomotion plus the shrinking floor), and
// this module owns the five scripted systems of the pass-6 PRD:
//   1. Vent Fissures: permanent GroundAoEs on a cadence; every VENT_BAIT_EVERY
//      opens under a random raider so the raid partially authors the floor.
//   2. Geysers: standing in a vent launches you (vy set; the standing fall
//      model does the rest); a short per-player cooldown prevents juggling.
//   3. The Embers Come Home: dormant Cinderlings wake on a cadence and
//      shamble toward Volzharr (module-steered, vent-immune); one that
//      reaches him is consumed for a PERMANENT Emberfeed haste stack,
//      uncapped: the fight's aging clock. Killing a shambler denies it.
//   4. Undermount Eruption: a telegraphed arena hit; a pillar between you and
//      the boss (ctx.hasLineOfSight false) exempts you.
//   5. Forgeheat: standing near (not in) a vent stacks the offense/risk pair.
// One scheduler rule: a control effect never overlaps an Eruption telegraph;
// a suppressed Tremor re-fires after the window and RE-ANCHORS from when it
// actually fired, permanently de-syncing harmonic cadence locks.
//
// Physics facts (binding): radius checks are 2D (x/z, spatial.ts); airborne
// players take every ground pulse under them; no mechanic assumes
// height-dodging. All rng through ctx.rng in tick order: one draw pair per
// unbaited vent (angle+distance), one draw per baited vent (the target pick),
// and NOTHING else draws. src/sim-pure (tests/architecture.test.ts).

import type { SimContext } from '../sim_context';
import { type Aura, DT, dist2d, type Entity } from '../types';
import {
  EMBER_CONSUME_RADIUS,
  EMBER_SHAMBLE_SPEED,
  EMBER_WAKE_CADENCE_S,
  EMBERFEED_HASTE_PER_STACK,
  ERUPTION_CADENCE_S,
  ERUPTION_DMG_MAX,
  ERUPTION_DMG_MIN,
  ERUPTION_TELEGRAPH_S,
  FORGEHEAT_DURATION_S,
  FORGEHEAT_FIRE_TAKEN_PER_STACK,
  FORGEHEAT_HASTE_PER_STACK,
  FORGEHEAT_RADIUS,
  FORGEHEAT_STACK_CAP,
  UNDERMOUNT_ROOM_RADIUS,
  VENT_BAIT_EVERY,
  VENT_CADENCE_S,
  VENT_PULSE_DPS,
  VENT_RADIUS,
} from './undermount';

export const VOLZHARR_BOSS_ID = 'volzharr_buried_furnace';
export const CINDERLING_ID = 'undermount_cinderling';
export const EMBERFEED_AURA_ID = 'volzharr_emberfeed';
export const FORGEHEAT_AURA_ID = 'volzharr_forgeheat';
export const FORGEHEAT_VULN_AURA_ID = 'volzharr_forgeheat_vuln';
const VENT_PERMANENT_S = 36000; // "never closes" for any real pull
const GEYSER_APEX_VY = 19.5; // (tuning) ~19 yd apex, the half-HP landing
const GEYSER_COOLDOWN_S = 3; // per player: a vent cannot juggle-lock
const TREMOR_EVERY_S = 40; // (tuning) mirrors the PRD Tremor cadence
const PERMANENT_AURA_S = 36000;

export interface VolzharrEncounterState {
  ventTimer: number;
  ventCount: number;
  eruptTimer: number;
  eruptTelegraphUntil: number; // 0 when no telegraph is live
  tremorTimer: number;
  tremorSuppressed: boolean;
  emberWakeTimer: number;
  emberfeedStacks: number;
  geyserCd: Map<number, number>; // entityId -> remaining cooldown
  shamblers: Set<number>; // woken Cinderling entity ids walking home
}

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

function bossVents(ctx: SimContext, boss: Entity) {
  return ctx.groundAoEs.filter((g) => g.sourceId === boss.id);
}

function pushStackAura(
  ctx: SimContext,
  target: Entity,
  id: string,
  name: string,
  kind: Aura['kind'],
  value: number,
  stacks: number,
  duration: number,
  school: Aura['school'],
  sourceId: number,
): void {
  const had = target.auras.some((a) => a.id === id);
  target.auras = target.auras.filter((a) => a.id !== id);
  target.auras.push({
    id,
    name,
    kind,
    remaining: duration,
    duration,
    value,
    stacks,
    sourceId,
    school,
  });
  if (!had) ctx.emit({ type: 'aura', targetId: target.id, name, gained: true });
}

export function initVolzharrEncounter(boss: Entity): void {
  boss.volzharr = {
    ventTimer: VENT_CADENCE_S,
    ventCount: 0,
    eruptTimer: ERUPTION_CADENCE_S,
    eruptTelegraphUntil: 0,
    tremorTimer: TREMOR_EVERY_S,
    tremorSuppressed: false,
    emberWakeTimer: EMBER_WAKE_CADENCE_S,
    emberfeedStacks: 0,
    geyserCd: new Map(),
    shamblers: new Set(),
  };
}

/** Wipe/leash reset: vents cleared, woken shamblers despawned, auras stripped. */
export function resetVolzharrEncounter(ctx: SimContext, boss: Entity): void {
  for (let i = ctx.groundAoEs.length - 1; i >= 0; i--) {
    if (ctx.groundAoEs[i].sourceId === boss.id) ctx.groundAoEs.splice(i, 1);
  }
  const st = boss.volzharr;
  if (st) {
    for (const id of st.shamblers) {
      const c = ctx.entities.get(id);
      if (c && !c.dead) ctx.dropEntity(id);
    }
  }
  boss.auras = boss.auras.filter((a) => a.id !== EMBERFEED_AURA_ID);
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p) continue;
    p.auras = p.auras.filter((a) => a.id !== FORGEHEAT_AURA_ID && a.id !== FORGEHEAT_VULN_AURA_ID);
  }
  boss.volzharr = undefined;
}

export function updateVolzharrEncounter(ctx: SimContext, boss: Entity): void {
  if (boss.dead) return;
  if (!boss.volzharr) initVolzharrEncounter(boss);
  const st = boss.volzharr;
  if (!st) return;
  const raiders = raidersIn(ctx, boss);
  const vents = bossVents(ctx, boss);

  // 1) Vent Fissures on cadence; every VENT_BAIT_EVERY-th baits a raider.
  st.ventTimer -= DT;
  if (st.ventTimer <= 0) {
    st.ventTimer = VENT_CADENCE_S;
    st.ventCount += 1;
    let x: number;
    let z: number;
    if (st.ventCount % VENT_BAIT_EVERY === 0 && raiders.length > 0) {
      const bait = raiders[ctx.rng.int(0, raiders.length - 1)];
      x = bait.pos.x;
      z = bait.pos.z;
    } else {
      const angle = ctx.rng.range(0, Math.PI * 2);
      const dist = ctx.rng.range(8, 32);
      x = boss.spawnPos.x + Math.cos(angle) * dist;
      z = boss.spawnPos.z + Math.sin(angle) * dist;
    }
    ctx.groundAoEs.push({
      sourceId: boss.id,
      pos: { x, y: boss.pos.y, z },
      radius: VENT_RADIUS,
      min: VENT_PULSE_DPS,
      max: VENT_PULSE_DPS,
      remaining: VENT_PERMANENT_S,
      interval: 1,
      tickTimer: 1,
      school: 'fire',
      ability: 'Vent Fissure',
    });
  }

  // 2) Geysers + 5) Forgeheat: one pass over raiders against the vent set.
  for (const [id, cd] of st.geyserCd) {
    const left = cd - DT;
    if (left <= 0) st.geyserCd.delete(id);
    else st.geyserCd.set(id, left);
  }
  for (const p of raiders) {
    let inVent = false;
    let nearVent = false;
    for (const v of vents) {
      const d = dist2d(p.pos, v.pos);
      if (d <= v.radius) {
        inVent = true;
        break;
      }
      if (d <= v.radius + FORGEHEAT_RADIUS) nearVent = true;
    }
    if (inVent && !st.geyserCd.has(p.id)) {
      st.geyserCd.set(p.id, GEYSER_COOLDOWN_S);
      p.vy = GEYSER_APEX_VY; // the standing fall model prices the landing
    }
    if (nearVent && !inVent) {
      const current = p.auras.find((a) => a.id === FORGEHEAT_AURA_ID)?.stacks ?? 0;
      const stacks = Math.min(FORGEHEAT_STACK_CAP, current + (current === 0 ? 1 : 0));
      // One stack gained on entering the rim; held stacks refresh while near.
      // Additional stacks accrue on a 1 s cadence via the aura's own refresh:
      // model it simply: while near, bump at most once per second of exposure.
      const holder = p.auras.find((a) => a.id === FORGEHEAT_AURA_ID);
      let next = stacks;
      if (holder) {
        // remaining ticks down; when it has decayed a full second below its
        // duration, treat that as one second of exposure and add a stack.
        if (holder.duration - holder.remaining >= 1 && (holder.stacks ?? 1) < FORGEHEAT_STACK_CAP) {
          next = (holder.stacks ?? 1) + 1;
        } else {
          next = holder.stacks ?? 1;
        }
      }
      pushStackAura(
        ctx,
        p,
        FORGEHEAT_AURA_ID,
        'Forgeheat',
        'buff_haste',
        next * FORGEHEAT_HASTE_PER_STACK,
        next,
        FORGEHEAT_DURATION_S,
        'fire',
        boss.id,
      );
      pushStackAura(
        ctx,
        p,
        FORGEHEAT_VULN_AURA_ID,
        'Forgeheat',
        'vulnerability',
        next * FORGEHEAT_FIRE_TAKEN_PER_STACK,
        next,
        FORGEHEAT_DURATION_S,
        'fire',
        boss.id,
      );
    }
  }

  // 3) The Embers Come Home.
  st.emberWakeTimer -= DT;
  if (st.emberWakeTimer <= 0) {
    st.emberWakeTimer = EMBER_WAKE_CADENCE_S;
    let best: Entity | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const e of ctx.entities.values()) {
      if (e.kind !== 'mob' || e.dead || e.templateId !== CINDERLING_ID) continue;
      if (st.shamblers.has(e.id)) continue;
      if (dist2d(e.pos, boss.spawnPos) > UNDERMOUNT_ROOM_RADIUS) continue;
      const d = dist2d(e.pos, boss.pos);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) {
      st.shamblers.add(best.id);
      ctx.emit({ type: 'aura', targetId: best.id, name: 'The Embers Come Home', gained: true });
    }
  }
  for (const id of [...st.shamblers]) {
    const c = ctx.entities.get(id);
    if (!c || c.dead) {
      st.shamblers.delete(id); // killed en route: the stack is denied
      continue;
    }
    const d = dist2d(c.pos, boss.pos);
    if (d <= EMBER_CONSUME_RADIUS) {
      st.shamblers.delete(id);
      ctx.dropEntity(id);
      st.emberfeedStacks += 1;
      pushStackAura(
        ctx,
        boss,
        EMBERFEED_AURA_ID,
        'Emberfeed',
        'buff_haste',
        st.emberfeedStacks * EMBERFEED_HASTE_PER_STACK,
        st.emberfeedStacks,
        PERMANENT_AURA_S,
        'fire',
        boss.id,
      );
      continue;
    }
    // Module-steered shamble: a straight x/z step toward the boss, immune to
    // vents by fiat (magma walking home through magma). The spatial grid
    // re-buckets at end of tick, so direct mutation here is the house pattern.
    const step = Math.min(1, (EMBER_SHAMBLE_SPEED * DT) / Math.max(d, 0.001));
    c.pos.x += (boss.pos.x - c.pos.x) * step;
    c.pos.z += (boss.pos.z - c.pos.z) * step;
  }

  // 4) Undermount Eruption with the one scheduler rule.
  st.eruptTimer -= DT;
  if (st.eruptTelegraphUntil > 0) {
    st.eruptTelegraphUntil -= DT;
    if (st.eruptTelegraphUntil <= 0) {
      st.eruptTelegraphUntil = 0;
      const dmg = Math.round(ctx.rng.range(ERUPTION_DMG_MIN, ERUPTION_DMG_MAX));
      for (const p of raiders) {
        if (!ctx.hasLineOfSight(boss, p)) continue; // a pillar covers you
        ctx.dealDamage(boss, p, dmg, false, 'fire', 'Undermount Eruption', 'hit', true);
      }
      if (st.tremorSuppressed) {
        st.tremorSuppressed = false;
        st.tremorTimer = 0.5; // re-fires just after the window...
      }
    }
  } else if (st.eruptTimer <= 0) {
    st.eruptTimer = ERUPTION_CADENCE_S;
    st.eruptTelegraphUntil = ERUPTION_TELEGRAPH_S;
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      fx: 'windup',
      school: 'fire',
    });
  }

  // The Tremor gate: the stomp itself is the template field; this bookkeeping
  // only forbids its window from overlapping a live telegraph.
  st.tremorTimer -= DT;
  if (st.tremorTimer <= 0) {
    if (st.eruptTelegraphUntil > 0) {
      st.tremorSuppressed = true;
      st.tremorTimer = Number.POSITIVE_INFINITY; // released by the Eruption fire
    } else {
      st.tremorTimer = TREMOR_EVERY_S; // ...and RE-ANCHORS from actual fire time
    }
  }
}
