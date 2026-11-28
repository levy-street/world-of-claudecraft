// The Hammer Council's entrance, "The quarry wakes" (docs/design/raid/
// smith_heart.md section 7.1, "The entrance"; the timeline
// council_intro_plan.ts COUNCIL_INTRO). Until the raid first comes down into
// the Quarry, both members sleep: the Guardian fused into a spur of the
// quarry's rock, the Seam Singer inside a vein of crystal. Each is held by
// the encounter (Entity.encounterHeld: the mob AI never scans, pulls or moves
// it), out of reach (`hostile` false, `damageImmune`).
//
// The first living player within COUNCIL_INTRO.reach of the Quarry's middle
// wakes the quarry: the scene runs COUNCIL_INTRO.seconds with both members
// still held (no aggro reach, no target, no harm, no swing), the Guardian's
// pull line yelled at `guardianSpeakAt` (as it tears itself out of the rock)
// and the Singer's at `singerSpeakAt` (as her crystal rings and shatters),
// and at the end both are handed back hostile and touchable; only then does
// the ordinary pull take them (a player inside an aggro reach, or a blow).
// The cinematic is the renderer's (render/smith_heart_fx/
// council_entrance_*.ts), read off one aura on each member
// (COUNCIL_AURAS.intro: dormant, or waking with the scene's clock), so a
// client that joins mid-scene picks it up where it is and one that joins
// after sees them standing. No camera, no control is ever taken.
//
// It plays once per council: a wipe sends them home awake, never asleep. A
// fight begun before they ever woke (a pull forced straight through the
// encounter tick, a dev pull or mechanic) spends it. `/dev heart council
// intro` puts them to sleep again for a replay.
//
// The state is ONE object shared by the two bodies (a fresh claim's council
// starts asleep); server-local, never wired. Zero rng, no clock but the
// sim's own.

import { HAMMER_PIT } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { COUNCIL_AURAS, COUNCIL_NAMES, COUNCIL_ROLES, type CouncilRole } from './council_ids';
import { COUNCIL_INTRO, COUNCIL_INTRO_STAGES } from './council_intro_plan';
import { councilYell } from './council_voice';
import { auraOf, dropAura, putMarker } from './fight_kit';

/** The claim's two members, as council.ts councilBodies returns them. */
export type CouncilIntroBodies = Readonly<Record<CouncilRole, Entity | null>>;

export type CouncilIntroStage = 'dormant' | 'waking' | 'done';

export interface CouncilIntroState {
  stage: CouncilIntroStage;
  /** Seconds into the scene (waking). */
  t: number;
  /** Seconds a replay holds them asleep before a waker counts (dormant). */
  hold: number;
  /** Each member's line has been said this scene. */
  spoke: Record<CouncilRole, boolean>;
  /** Sim time the scene ended (-Infinity: it never played). */
  endedAt: number;
}

/** Each body to the council's one shared state. */
const intros = new WeakMap<Entity, CouncilIntroState>();

/** When each member speaks (seconds into the scene). */
const SPEAK_AT: Readonly<Record<CouncilRole, number>> = {
  guardian: COUNCIL_INTRO.guardianSpeakAt,
  singer: COUNCIL_INTRO.singerSpeakAt,
};

/** The council's entrance state (a council never seen starts asleep), the
 *  one object both bodies share. */
export function councilIntroState(bodies: CouncilIntroBodies): CouncilIntroState {
  let s: CouncilIntroState | undefined;
  for (const r of COUNCIL_ROLES) {
    const b = bodies[r];
    if (b) s ??= intros.get(b);
  }
  if (!s) {
    s = {
      stage: 'dormant',
      t: 0,
      hold: 0,
      spoke: { guardian: false, singer: false },
      endedAt: Number.NEGATIVE_INFINITY,
    };
  }
  for (const r of COUNCIL_ROLES) {
    const b = bodies[r];
    if (b && intros.get(b) !== s) intros.set(b, s);
  }
  return s;
}

const alive = (e: Entity | null): e is Entity => e !== null && !e.dead;

/** Held through the entrance: no aggro scan, no target, no harm, no swing. */
function hold(body: Entity): void {
  body.encounterHeld = true;
  body.damageImmune = true;
  body.hostile = false;
  body.swingTimer = Math.max(body.swingTimer, 0.6);
}

/** Handed back to the fight (and to the mob AI). */
function release(body: Entity): void {
  body.encounterHeld = false;
  body.damageImmune = false;
  body.hostile = true;
  dropAura(body, COUNCIL_AURAS.intro);
}

/** Write a member's entrance aura: dormant (permanent) or waking at scene
 *  time `t`. */
function show(body: Entity, s: CouncilIntroState): void {
  const a = auraOf(body, COUNCIL_AURAS.intro);
  if (s.stage === 'dormant') {
    if (a && a.value === COUNCIL_INTRO_STAGES.dormant) return;
    putMarker(body, COUNCIL_AURAS.intro, COUNCIL_NAMES.intro, 3600, body.id, {
      permanent: true,
      value: COUNCIL_INTRO_STAGES.dormant,
      school: 'physical',
    });
    return;
  }
  const left = Math.max(0, COUNCIL_INTRO.seconds - s.t);
  if (a && a.value === COUNCIL_INTRO_STAGES.waking) {
    // The scene's clock is the sim's, never the aura ticker's.
    a.remaining = left;
    a.duration = COUNCIL_INTRO.seconds;
    return;
  }
  const w = putMarker(
    body,
    COUNCIL_AURAS.intro,
    COUNCIL_NAMES.intro,
    COUNCIL_INTRO.seconds,
    body.id,
    {
      value: COUNCIL_INTRO_STAGES.waking,
      school: 'physical',
    },
  );
  w.remaining = left;
}

/** Is (x, z, y) (x and z instance-local, y the world height) close enough to
 *  the Quarry to wake it: within COUNCIL_INTRO.reach of its middle and
 *  COUNCIL_INTRO.band of its floor? */
export function inCouncilIntroReach(x: number, z: number, y: number): boolean {
  if (Math.abs(y - HAMMER_PIT.h) > COUNCIL_INTRO.band) return false;
  return Math.hypot(x - HAMMER_PIT.x, z - HAMMER_PIT.z) <= COUNCIL_INTRO.reach;
}

/** Is a living, present player of the claim near enough to wake it? */
export function councilIntroWaker(ctx: SimContext, inst: InstanceSlot): boolean {
  const o = ctx.instanceOriginOf(inst);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead || e.ghost) continue;
    if (inCouncilIntroReach(e.pos.x - o.x, e.pos.z - o.z, e.pos.y)) return true;
  }
  return false;
}

function finish(
  ctx: SimContext,
  bodies: CouncilIntroBodies,
  s: CouncilIntroState,
  played: boolean,
): void {
  s.stage = 'done';
  s.t = 0;
  s.hold = 0;
  // Ended once a line was said (even cut short): the pull keeps quiet for
  // whoever has just spoken.
  if (played || s.spoke.guardian || s.spoke.singer) s.endedAt = ctx.time;
  for (const r of COUNCIL_ROLES) {
    const b = bodies[r];
    if (b) release(b);
  }
}

/**
 * One tick of the entrance, before the fight's (council.ts
 * tickHammerCouncil, while a member lives). Returns true while it holds the
 * council (the fight waits); false once it is over, or when a fight begun
 * before the quarry woke has spent it (`engaged`: a member is in its fight
 * this tick).
 */
export function stepCouncilIntro(
  ctx: SimContext,
  inst: InstanceSlot,
  bodies: CouncilIntroBodies,
  engaged: boolean,
): boolean {
  const s = councilIntroState(bodies);
  if (s.stage === 'done') return false;
  if (engaged) {
    // Pulled straight through the encounter tick before the scene ran its
    // course: the fight's opening takes its place.
    finish(ctx, bodies, s, s.stage === 'waking' && (s.spoke.guardian || s.spoke.singer));
    return false;
  }
  for (const r of COUNCIL_ROLES) {
    const b = bodies[r];
    if (alive(b)) hold(b);
  }
  if (s.stage === 'dormant') {
    if (s.hold > 0) s.hold = Math.max(0, s.hold - DT);
    else if (councilIntroWaker(ctx, inst)) {
      s.stage = 'waking';
      s.t = 0;
      s.spoke.guardian = false;
      s.spoke.singer = false;
    }
  } else {
    s.t += DT;
    for (const r of COUNCIL_ROLES) {
      const b = bodies[r];
      if (s.spoke[r] || s.t < SPEAK_AT[r] - 1e-9) continue;
      s.spoke[r] = true;
      if (alive(b)) councilYell(ctx, inst, b, r, 'pull');
    }
    if (s.t >= COUNCIL_INTRO.seconds - 1e-9) {
      finish(ctx, bodies, s, true);
      return false;
    }
  }
  for (const r of COUNCIL_ROLES) {
    const b = bodies[r];
    if (alive(b)) show(b, s);
  }
  return true;
}

/** A fight begun outside the entrance (a dev pull or mechanic, a test's
 *  forced scope) spends it: both are handed back at once. */
export function spendCouncilIntro(ctx: SimContext, bodies: CouncilIntroBodies): void {
  const s = councilIntroState(bodies);
  if (s.stage !== 'done') finish(ctx, bodies, s, false);
}

/** Has the entrance just said `role`'s pull line (the pull's own would
 *  repeat it)? */
export function councilIntroJustSpoke(
  ctx: SimContext,
  bodies: CouncilIntroBodies,
  role: CouncilRole,
): boolean {
  const s = councilIntroState(bodies);
  return s.spoke[role] && ctx.time - s.endedAt < COUNCIL_INTRO.pullQuiet;
}

/** `/dev heart council intro`: put a council standing out of its fight to
 *  sleep again, so the next waker replays the scene (after a short hold
 *  every client sees them dormant). */
export function replayCouncilIntro(bodies: CouncilIntroBodies): void {
  const s = councilIntroState(bodies);
  s.stage = 'dormant';
  s.t = 0;
  s.hold = COUNCIL_INTRO.replayHold;
  s.spoke.guardian = false;
  s.spoke.singer = false;
  s.endedAt = Number.NEGATIVE_INFINITY;
  for (const r of COUNCIL_ROLES) {
    const b = bodies[r];
    if (!alive(b)) continue;
    hold(b);
    show(b, s);
  }
}

/** The readout's entrance part. */
export function councilIntroReadout(bodies: CouncilIntroBodies): string {
  const s = councilIntroState(bodies);
  if (s.stage === 'waking') return `entrance ${s.t.toFixed(1)}/${COUNCIL_INTRO.seconds} s`;
  return s.stage === 'dormant'
    ? 'asleep in the rock and the crystal, waiting for the raid'
    : 'awake';
}
