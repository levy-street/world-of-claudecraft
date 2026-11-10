// The Guardian of the Breath's entrance (docs/design/raid/smith_heart.md
// section 7.2, "The entrance", "Calm before the storm"; the timeline
// breath_intro_plan.ts BREATH_INTRO). Until the raid first climbs onto the
// Storm Cornice, the guardian is not yet a body: held by the encounter
// (Entity.encounterHeld: the mob AI never scans, pulls or moves it), out of
// reach (`hostile` false, `damageImmune`). The first living player within
// BREATH_INTRO.reach of its spot wakes it: the scene runs
// BREATH_INTRO.seconds, the guardian still held (no aggro reach, no target,
// no harm, no swing), and at the end it is handed back hostile and
// touchable; only then does the ordinary pull take it (a player inside its
// aggro reach, or a blow). The scene says nothing (wind and thunder only),
// so the pull keeps its own line. The cinematic is the renderer's
// (render/smith_heart_fx/breath_entrance_*.ts), read off one aura on the
// guardian (BREATH_AURAS.intro: gathered, or waking with the scene's clock),
// so a client that joins mid-scene picks it up where it is and one that
// joins after sees it floating. No camera, no control is ever taken.
//
// It plays once per guardian: a wipe sends it home awake, never gathered
// again. A fight begun before it ever woke (a pull forced straight through
// the encounter tick, a dev mechanic) spends it. `/dev heart breath intro`
// gathers it into the still air again for a replay.
//
// The state is keyed by the guardian's body (a fresh claim's guardian starts
// gathered); server-local, never wired. Zero rng, no clock but the sim's own.

import { BREATH, SMITH_HEART_BOSS_SPOTS } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { BREATH_AURAS, BREATH_NAMES } from './breath_ids';
import { BREATH_INTRO, BREATH_INTRO_STAGES } from './breath_intro_plan';
import { auraOf, dropAura, putMarker } from './breath_scope';

export type BreathIntroStage = 'dormant' | 'waking' | 'done';

export interface BreathIntroState {
  stage: BreathIntroStage;
  /** Seconds into the scene (waking). */
  t: number;
  /** Seconds a replay holds it gathered before a waker counts (dormant). */
  hold: number;
}

const intros = new WeakMap<Entity, BreathIntroState>();

/** The guardian's entrance state (a guardian never seen starts gathered). */
export function breathIntroState(boss: Entity): BreathIntroState {
  let s = intros.get(boss);
  if (!s) {
    s = { stage: 'dormant', t: 0, hold: 0 };
    intros.set(boss, s);
  }
  return s;
}

/** Held through the entrance: no aggro scan, no target, no harm, no swing. */
function hold(boss: Entity): void {
  boss.encounterHeld = true;
  boss.damageImmune = true;
  boss.hostile = false;
  boss.swingTimer = Math.max(boss.swingTimer, 0.6);
}

/** Handed back to the fight (and to the mob AI). */
function release(boss: Entity): void {
  boss.encounterHeld = false;
  boss.damageImmune = false;
  boss.hostile = true;
  dropAura(boss, BREATH_AURAS.intro);
}

/** Write the entrance aura: gathered (permanent) or waking at scene time `t`. */
function show(boss: Entity, s: BreathIntroState): void {
  const a = auraOf(boss, BREATH_AURAS.intro);
  if (s.stage === 'dormant') {
    if (a && a.value === BREATH_INTRO_STAGES.dormant) return;
    putMarker(boss, BREATH_AURAS.intro, BREATH_NAMES.intro, 3600, boss.id, {
      permanent: true,
      value: BREATH_INTRO_STAGES.dormant,
      school: 'nature',
    });
    return;
  }
  const left = Math.max(0, BREATH_INTRO.seconds - s.t);
  if (a && a.value === BREATH_INTRO_STAGES.waking) {
    // The scene's clock is the sim's, never the aura ticker's.
    a.remaining = left;
    a.duration = BREATH_INTRO.seconds;
    return;
  }
  const w = putMarker(boss, BREATH_AURAS.intro, BREATH_NAMES.intro, BREATH_INTRO.seconds, boss.id, {
    value: BREATH_INTRO_STAGES.waking,
    school: 'nature',
  });
  w.remaining = left;
}

/** Is (x, z) at height y (instance-local) near enough the guardian's spot to
 *  wake it (BREATH_INTRO.reach, within `band` of the Cornice's floor)? */
export function inBreathIntroReach(x: number, z: number, y: number): boolean {
  if (Math.abs(y - BREATH.cornice.h) > BREATH_INTRO.band) return false;
  const at = SMITH_HEART_BOSS_SPOTS.breath;
  return Math.hypot(x - at.x, z - at.z) <= BREATH_INTRO.reach;
}

/** Is a living, present player of the claim near enough to wake it? */
export function breathIntroWaker(ctx: SimContext, inst: InstanceSlot): boolean {
  const o = ctx.instanceOriginOf(inst);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead || e.ghost) continue;
    if (inBreathIntroReach(e.pos.x - o.x, e.pos.z - o.z, e.pos.y)) return true;
  }
  return false;
}

function finish(boss: Entity, s: BreathIntroState): void {
  s.stage = 'done';
  s.t = 0;
  s.hold = 0;
  release(boss);
}

/**
 * One tick of the entrance, before the fight's (breath.ts tickBreathGuardian,
 * for a living guardian). Returns true while it holds the guardian (the fight
 * waits); false once it is over, or when a fight begun before it woke has
 * spent it (`engaged`: the guardian is in its fight this tick).
 */
export function stepBreathIntro(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): boolean {
  const s = breathIntroState(boss);
  if (s.stage === 'done') return false;
  if (engaged) {
    // Pulled straight through the encounter tick before the scene ran its
    // course: the fight's opening takes its place.
    finish(boss, s);
    return false;
  }
  hold(boss);
  if (s.stage === 'dormant') {
    if (s.hold > 0) s.hold = Math.max(0, s.hold - DT);
    else if (breathIntroWaker(ctx, inst)) {
      s.stage = 'waking';
      s.t = 0;
    }
    show(boss, s);
    return true;
  }
  s.t += DT;
  if (s.t >= BREATH_INTRO.seconds - 1e-9) {
    finish(boss, s);
    return false;
  }
  show(boss, s);
  return true;
}

/** A fight begun outside the entrance (a dev pull or mechanic, a test's
 *  forced scope) spends it: the guardian is handed back at once. */
export function spendBreathIntro(boss: Entity): void {
  const s = breathIntroState(boss);
  if (s.stage !== 'done') finish(boss, s);
}

/** `/dev heart breath intro`: gather a guardian standing out of its fight
 *  into the still air again, so the next waker replays the scene (after a
 *  short hold every client sees the calm). */
export function replayBreathIntro(boss: Entity): void {
  const s = breathIntroState(boss);
  s.stage = 'dormant';
  s.t = 0;
  s.hold = BREATH_INTRO.replayHold;
  hold(boss);
  show(boss, s);
}

/** The readout's entrance part. */
export function breathIntroReadout(boss: Entity): string {
  const s = breathIntroState(boss);
  if (s.stage === 'waking') return `entrance ${s.t.toFixed(1)}/${BREATH_INTRO.seconds} s`;
  return s.stage === 'dormant' ? 'gathered in the still air, waiting for the raid' : 'awake';
}
