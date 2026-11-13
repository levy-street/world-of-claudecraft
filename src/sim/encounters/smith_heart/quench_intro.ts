// The Guardian of the Quench's entrance (docs/design/raid/smith_heart.md
// section 7.3, "The entrance"; the timeline quench_intro_plan.ts
// QUENCH_INTRO). Until the raid first steps onto the lake, she lies frozen
// under its ice: held by the encounter (Entity.encounterHeld: the mob AI never
// scans, pulls or moves her), out of reach (`hostile` false, `damageImmune`).
// The first living player on the lake's ice wakes her: the scene runs
// QUENCH_INTRO.seconds, the guardian still held (no aggro reach, no target, no
// harm, no swing), her line yelled at QUENCH_INTRO.speakAt, and at the end
// she is handed back hostile and touchable; only then does the ordinary pull
// take her (a player inside her aggro reach, or a blow). The cinematic is the
// renderer's (render/smith_heart_fx/quench_entrance_*.ts), read off one aura
// on the guardian (QUENCH_AURAS.intro: frozen, or waking with the scene's
// clock), so a client that joins mid-scene picks it up where it is and one
// that joins after sees her standing. No camera, no control is ever taken.
//
// It plays once per guardian: a wipe sends her home awake, never frozen. A
// fight begun before she ever woke (a pull forced straight through the
// encounter tick, a dev mechanic) spends it. `/dev heart quench intro` puts
// her under the ice again for a replay.
//
// The state is keyed by the guardian's body (a fresh claim's guardian starts
// frozen); server-local, never wired. Zero rng, no clock but the sim's own.

import { QUENCH } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { QUENCH_AURAS, QUENCH_NAMES } from './quench_ids';
import { QUENCH_INTRO, QUENCH_INTRO_STAGES } from './quench_intro_plan';
import { auraOf, dropAura, putMarker } from './quench_scope';
import { quenchYell } from './quench_voice';

export type QuenchIntroStage = 'dormant' | 'waking' | 'done';

export interface QuenchIntroState {
  stage: QuenchIntroStage;
  /** Seconds into the scene (waking). */
  t: number;
  /** Seconds a replay holds her frozen before a waker counts (dormant). */
  hold: number;
  /** The line has been said this scene. */
  spoke: boolean;
  /** Sim time the scene ended (-Infinity: it never played). */
  endedAt: number;
}

const intros = new WeakMap<Entity, QuenchIntroState>();

/** The guardian's entrance state (a guardian never seen starts frozen). */
export function quenchIntroState(boss: Entity): QuenchIntroState {
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
  dropAura(boss, QUENCH_AURAS.intro);
}

/** Write the entrance aura: frozen (permanent) or waking at scene time `t`. */
function show(boss: Entity, s: QuenchIntroState): void {
  const a = auraOf(boss, QUENCH_AURAS.intro);
  if (s.stage === 'dormant') {
    if (a && a.value === QUENCH_INTRO_STAGES.dormant) return;
    putMarker(boss, QUENCH_AURAS.intro, QUENCH_NAMES.trapped, 3600, boss.id, {
      permanent: true,
      value: QUENCH_INTRO_STAGES.dormant,
      school: 'frost',
    });
    return;
  }
  const left = Math.max(0, QUENCH_INTRO.seconds - s.t);
  if (a && a.value === QUENCH_INTRO_STAGES.waking) {
    // The scene's clock is the sim's, never the aura ticker's.
    a.remaining = left;
    a.duration = QUENCH_INTRO.seconds;
    return;
  }
  const w = putMarker(
    boss,
    QUENCH_AURAS.intro,
    QUENCH_NAMES.trapped,
    QUENCH_INTRO.seconds,
    boss.id,
    {
      value: QUENCH_INTRO_STAGES.waking,
      school: 'frost',
    },
  );
  w.remaining = left;
}

/** Is (x, z) (instance-local) on the lake's ice, as the entrance counts it
 *  (the lake's ellipse grown by QUENCH_INTRO.reach)? */
export function onQuenchIntroIce(x: number, z: number): boolean {
  const L = QUENCH.lake;
  const g = QUENCH_INTRO.reach;
  return Math.hypot((x - L.x) / (L.rx + g), (z - L.z) / (L.rz + g)) <= 1;
}

/** Is a living, present player of the claim on the lake to wake her? */
export function quenchIntroWaker(ctx: SimContext, inst: InstanceSlot): boolean {
  const o = ctx.instanceOriginOf(inst);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead || e.ghost) continue;
    if (Math.abs(e.pos.y - QUENCH.lake.h) > QUENCH_INTRO.band) continue;
    if (onQuenchIntroIce(e.pos.x - o.x, e.pos.z - o.z)) return true;
  }
  return false;
}

function finish(ctx: SimContext, boss: Entity, s: QuenchIntroState, played: boolean): void {
  s.stage = 'done';
  s.t = 0;
  s.hold = 0;
  if (played) s.endedAt = ctx.time;
  release(boss);
}

/**
 * One tick of the entrance, before the fight's (quench.ts tickQuenchGuardian,
 * for a living guardian). Returns true while it holds the guardian (the fight
 * waits); false once it is over, or when a fight begun before she woke has
 * spent it (`engaged`: the guardian is in her fight this tick).
 */
export function stepQuenchIntro(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): boolean {
  const s = quenchIntroState(boss);
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
    else if (quenchIntroWaker(ctx, inst)) {
      s.stage = 'waking';
      s.t = 0;
      s.spoke = false;
    }
    show(boss, s);
    return true;
  }
  s.t += DT;
  if (!s.spoke && s.t >= QUENCH_INTRO.speakAt - 1e-9) {
    s.spoke = true;
    quenchYell(ctx, inst, boss, 'intro');
  }
  if (s.t >= QUENCH_INTRO.seconds - 1e-9) {
    finish(ctx, boss, s, true);
    return false;
  }
  show(boss, s);
  return true;
}

/** A fight begun outside the entrance (a dev pull or mechanic, a test's
 *  forced scope) spends it: the guardian is handed back at once. */
export function spendQuenchIntro(ctx: SimContext, boss: Entity): void {
  const s = quenchIntroState(boss);
  if (s.stage !== 'done') finish(ctx, boss, s, false);
}

/** Has the entrance just said its line (the pull's own line would repeat
 *  it)? */
export function quenchIntroJustSpoke(ctx: SimContext, boss: Entity): boolean {
  const s = quenchIntroState(boss);
  return ctx.time - s.endedAt < QUENCH_INTRO.pullQuiet;
}

/** `/dev heart quench intro`: put a guardian standing out of her fight under
 *  the ice again, so the next waker replays the scene (after a short hold
 *  every client sees her frozen). */
export function replayQuenchIntro(boss: Entity): void {
  const s = quenchIntroState(boss);
  s.stage = 'dormant';
  s.t = 0;
  s.hold = QUENCH_INTRO.replayHold;
  s.spoke = false;
  s.endedAt = Number.NEGATIVE_INFINITY;
  hold(boss);
  show(boss, s);
}

/** The readout's entrance part. */
export function quenchIntroReadout(boss: Entity): string {
  const s = quenchIntroState(boss);
  if (s.stage === 'waking') return `entrance ${s.t.toFixed(1)}/${QUENCH_INTRO.seconds} s`;
  return s.stage === 'dormant' ? 'frozen under the ice, waiting for the raid' : 'awake';
}
