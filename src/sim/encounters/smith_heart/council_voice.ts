// What the Hammer Council's three members SAY (docs/design/raid/smith_heart.md
// section 7.1, the voice lines): a boss yell to every player in the claim,
// carrying its catalog key (`hudChrome.council.say.<role>_<moment>`) so the
// client renders it through t(), with the English as the fallback and as the
// key a future voice clip is found by (scripts/voices/extra_lines.mjs). The
// voices themselves are auditions only (scripts/voices/raid_boss_voice_prompts.mjs
// HAMMER_COUNCIL_VOICE_PROMPTS) until the designer picks one.
//
//   pull       each member once, a breath apart (the Guardian first)
//   job lines  the Guardian's Wrath, the Slabwright's Wake and rock, the
//              Singer's song: spoken by the member itself (never an heir), at
//              most once in SAY_EVERY seconds each, so a five-minute pull is
//              never a chatter
//   a fall     the fallen's death line (on mythic its soul's line instead), and
//              the first survivor's "the stone remembers"
//   the end    the last to fall says its defeat line; a wipe, a survivor's
//
// Zero rng, no clock but the fight's: every line is ordered and once-gated.

import { HAMMER_PIT } from '../../content/smith_heart_layout';
import type { Entity } from '../../types';
import { COUNCIL_ROLES, type CouncilRole } from './council_ids';
import { type CouncilScope, living } from './council_scope';

/** The moments a member speaks at. */
export type CouncilMoment =
  | 'pull'
  | 'wrath'
  | 'wake'
  | 'rock'
  | 'song'
  | 'death'
  | 'remember'
  | 'soul'
  | 'wipe'
  | 'defeat';

/** Every line, by member and moment (English source; the catalog's
 *  `hudChrome.council.say.*` rows are the same text). */
export const COUNCIL_LINES: Readonly<Record<CouncilRole, Partial<Record<CouncilMoment, string>>>> =
  {
    guardian: {
      pull: "Strangers in the Quarry. The Hammer's strength does not yield to flesh.",
      wrath: 'The mountain answers me! Hide, if the stone will have you!',
      death: 'My strength... I give it to the stone.',
      remember: 'The stone remembers. What was theirs is mine.',
      soul: 'I am the stone now. My wrath has no body left to fail.',
      wipe: 'Dust. As all flesh becomes.',
      defeat: "The Hammer's strength... is yours to carry.",
    },
    slabwright: {
      pull: 'More stone for the wall. Hold still, and I will set you in it.',
      wake: 'Stand there. The stone rises where you stand!',
      rock: 'Look up, little ones! The mountain is falling!',
      death: 'The slab... splits...',
      remember: 'The stone remembers. I will finish the work.',
      soul: 'No hands left, but I will drag this stone to you.',
      wipe: 'Set, and buried. Good work.',
      defeat: 'The Quarry... falls quiet.',
    },
    singer: {
      pull: 'Hear the seam sing? It has waited so long for your voices.',
      song: 'Sing with me, and break!',
      death: 'My song... runs into the rock...',
      remember: 'The stone remembers. Listen, it still sings.',
      soul: 'Listen. In the stone, my song never ends.',
      wipe: 'Hush now. The seam is still.',
      defeat: 'The last note... fades.',
    },
  };

/** The catalog key of a line. */
export function councilLineKey(role: CouncilRole, moment: CouncilMoment): string {
  return `hudChrome.council.say.${role}_${moment}`;
}

/** Seconds between two of a member's job lines. */
export const SAY_EVERY = 45;
/** Seconds into the pull of the first line, and between the three. */
export const PULL_FIRST = 0.5;
export const PULL_GAP = 4;

const JOB_MOMENTS: ReadonlySet<CouncilMoment> = new Set(['wrath', 'wake', 'rock', 'song']);

/** Speak one line from `from` (yell range: the whole claim's Quarry). */
function yell(s: CouncilScope, from: Entity, role: CouncilRole, moment: CouncilMoment): void {
  const text = COUNCIL_LINES[role][moment];
  if (!text) return;
  const o = s.ctx.instanceOriginOf(s.inst);
  for (const meta of s.ctx.players.values()) {
    const p = s.ctx.entities.get(meta.entityId);
    if (!p) continue;
    if (Math.hypot(p.pos.x - o.x - HAMMER_PIT.x, p.pos.z - o.z - HAMMER_PIT.z) > 120) continue;
    s.ctx.emit({
      type: 'chat',
      fromPid: from.id,
      from: from.name,
      entityId: from.id,
      text,
      textKey: councilLineKey(role, moment),
      channel: 'yell',
      pid: meta.entityId,
    });
  }
}

/**
 * `role` speaks its `moment` line, if it has one and may now: a job line at
 * most once in SAY_EVERY seconds (and only from the member itself: an heir
 * casting an inherited job says nothing), every other line once a pull.
 * Returns true when it spoke.
 */
export function councilSay(s: CouncilScope, role: CouncilRole, moment: CouncilMoment): boolean {
  const body = s.bodies[role];
  if (!body || !COUNCIL_LINES[role][moment]) return false;
  const tag = `${role}_${moment}`;
  const said = s.st.said[tag];
  if (JOB_MOMENTS.has(moment)) {
    if (said !== undefined && s.st.clock - said < SAY_EVERY - 1e-9) return false;
  } else if (said !== undefined) return false;
  s.st.said[tag] = s.st.clock;
  yell(s, body, role, moment);
  return true;
}

/** The pull's three lines, a breath apart (called every tick of the fight). */
export function stepCouncilVoice(s: CouncilScope): void {
  COUNCIL_ROLES.forEach((role, i) => {
    if (s.st.clock + 1e-9 < PULL_FIRST + i * PULL_GAP) return;
    if (s.st.said[`${role}_pull`] !== undefined || !living(s.bodies[role])) return;
    councilSay(s, role, 'pull');
  });
}

/** A member fell (not the last): its own line (its soul's on mythic) and the
 *  first survivor's memory of it. */
export function sayFallen(s: CouncilScope, role: CouncilRole, soulTaken: boolean): void {
  councilSay(s, role, soulTaken ? 'soul' : 'death');
  // A survivor who has not yet said it (the second fall, the other one).
  const survivor = COUNCIL_ROLES.find(
    (r) => r !== role && living(s.bodies[r]) && s.st.said[`${r}_remember`] === undefined,
  );
  if (survivor) councilSay(s, survivor, 'remember');
}
