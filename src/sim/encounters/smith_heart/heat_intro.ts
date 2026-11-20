// The Guardian of the Heat's entrance (docs/design/raid/smith_heart.md section
// 7.4, "The entrance"; the timeline heat_intro_plan.ts HEAT_INTRO). Until the
// raid first comes near, the guardian stands in its wellspring as cold coal:
// held by the encounter (Entity.encounterHeld: the mob AI never scans, pulls
// or moves it), out of reach (`hostile` false, `damageImmune`). The first
// living player within HEAT_INTRO.reach of the wellspring wakes it: the scene
// runs HEAT_INTRO.seconds, the guardian still held (no aggro reach, no target,
// no harm, no swing), its line yelled at HEAT_INTRO.speakAt, and at the end it
// is handed back hostile and touchable; only then does the ordinary pull take
// it (a player inside its aggro reach, or a blow). The cinematic is the
// renderer's (render/smith_heart_fx/heat_entrance_*.ts), read off one aura on
// the guardian (HEAT_AURAS.intro: cold, or waking with the scene's clock), so
// a client that joins mid-scene picks it up where it is and one that joins
// after sees it burning. No camera, no control is ever taken.
//
// It plays once per guardian: a wipe sends it home burning, never cold. A
// fight begun before it ever woke (a pull forced straight through the
// encounter tick, a dev mechanic) spends it. `/dev heart heat intro` puts it
// cold again for a replay.
//
// The state is keyed by the guardian's body (a fresh claim's guardian starts
// cold); server-local, never wired. Zero rng, no clock but the sim's own.

import { SMITH_HEART_HEIGHTS } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { wellDistance } from './heat_geometry';
import { HEAT_AURAS, HEAT_NAMES } from './heat_ids';
import { HEAT_INTRO, HEAT_INTRO_STAGES } from './heat_intro_plan';
import { auraOf, dropAura, putMarker } from './heat_scope';
import { heatYell } from './heat_voice';

export type HeatIntroStage = 'dormant' | 'waking' | 'done';

export interface HeatIntroState {
  stage: HeatIntroStage;
  /** Seconds into the scene (waking). */
  t: number;
  /** Seconds a replay holds it cold before a waker counts (dormant). */
  hold: number;
  /** The line has been said this scene. */
  spoke: boolean;
  /** Sim time the scene ended (-Infinity: it never played). */
  endedAt: number;
}

const intros = new WeakMap<Entity, HeatIntroState>();

/** The guardian's entrance state (a guardian never seen starts cold). */
export function heatIntroState(boss: Entity): HeatIntroState {
  let s = intros.get(boss);
  if (!s) {
    s = { stage: 'dormant', t: 0, hold: 0, spoke: false, endedAt: Number.NEGATIVE_INFINITY };
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
  dropAura(boss, HEAT_AURAS.intro);
}

/** Write the entrance aura: cold (permanent) or waking at scene time `t`. */
function show(boss: Entity, s: HeatIntroState): void {
  const a = auraOf(boss, HEAT_AURAS.intro);
  if (s.stage === 'dormant') {
    if (a && a.value === HEAT_INTRO_STAGES.dormant) return;
    putMarker(boss, HEAT_AURAS.intro, HEAT_NAMES.state, 3600, boss.id, {
      permanent: true,
      value: HEAT_INTRO_STAGES.dormant,
      school: 'fire',
    });
    return;
  }
  const left = Math.max(0, HEAT_INTRO.seconds - s.t);
  if (a && a.value === HEAT_INTRO_STAGES.waking) {
    // The scene's clock is the sim's, never the aura ticker's.
    a.remaining = left;
    a.duration = HEAT_INTRO.seconds;
    return;
  }
  const w = putMarker(boss, HEAT_AURAS.intro, HEAT_NAMES.state, HEAT_INTRO.seconds, boss.id, {
    value: HEAT_INTRO_STAGES.waking,
    school: 'fire',
  });
  w.remaining = left;
}

/** Is a living, present player of the claim near enough to wake it? */
export function heatIntroWaker(ctx: SimContext, inst: InstanceSlot): boolean {
  const o = ctx.instanceOriginOf(inst);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead || e.ghost) continue;
    if (Math.abs(e.pos.y - SMITH_HEART_HEIGHTS.heat) > HEAT_INTRO.band) continue;
    if (wellDistance(e.pos.x - o.x, e.pos.z - o.z) <= HEAT_INTRO.reach) return true;
  }
  return false;
}

function finish(ctx: SimContext, boss: Entity, s: HeatIntroState, played: boolean): void {
  s.stage = 'done';
  s.t = 0;
  s.hold = 0;
  if (played) s.endedAt = ctx.time;
  release(boss);
}

/**
 * One tick of the entrance, before the fight's (heat.ts tickHeatGuardian,
 * for a living guardian). Returns true while it holds the guardian (the fight
 * waits); false once it is over, or when a fight begun before it woke has
 * spent it (`engaged`: the guardian is in its fight this tick).
 */
export function stepHeatIntro(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): boolean {
  const s = heatIntroState(boss);
  if (s.stage === 'done') return false;
  if (engaged) {
    // Pulled straight through the encounter tick before the scene ran its
    // course: the fight's opening takes its place.
    finish(ctx, boss, s, s.stage === 'waking' && s.spoke);
    return false;
  }
  hold(boss);
  if (s.stage === 'dormant') {
    if (s.hold > 0) s.hold = Math.max(0, s.hold - DT);
    else if (heatIntroWaker(ctx, inst)) {
      s.stage = 'waking';
      s.t = 0;
      s.spoke = false;
    }
    show(boss, s);
    return true;
  }
  s.t += DT;
  if (!s.spoke && s.t >= HEAT_INTRO.speakAt - 1e-9) {
    s.spoke = true;
    heatYell(ctx, inst, boss, 'intro');
  }
  if (s.t >= HEAT_INTRO.seconds - 1e-9) {
    finish(ctx, boss, s, true);
    return false;
  }
  show(boss, s);
  return true;
}

/** A fight begun outside the entrance (a dev mechanic, a test's forced
 *  scope) spends it: the guardian is handed back at once. */
export function spendHeatIntro(ctx: SimContext, boss: Entity): void {
  const s = heatIntroState(boss);
  if (s.stage !== 'done') finish(ctx, boss, s, false);
}

/** Has the entrance just said its line (the pull's own line would repeat
 *  it)? */
export function heatIntroJustSpoke(ctx: SimContext, boss: Entity): boolean {
  const s = heatIntroState(boss);
  return ctx.time - s.endedAt < HEAT_INTRO.pullQuiet;
}

/** `/dev heart heat intro`: put a guardian standing out of its fight cold
 *  again, so the next waker replays the scene (after a short hold every
 *  client sees it cold). */
export function replayHeatIntro(boss: Entity): void {
  const s = heatIntroState(boss);
  s.stage = 'dormant';
  s.t = 0;
  s.hold = HEAT_INTRO.replayHold;
  s.spoke = false;
  s.endedAt = Number.NEGATIVE_INFINITY;
  hold(boss);
  show(boss, s);
}

/** The readout's entrance part. */
export function heatIntroReadout(boss: Entity): string {
  const s = heatIntroState(boss);
  if (s.stage === 'waking') return `entrance ${s.t.toFixed(1)}/${HEAT_INTRO.seconds} s`;
  return s.stage === 'dormant' ? 'cold, waiting for the raid' : 'awake';
}
