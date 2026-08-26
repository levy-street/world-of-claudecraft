// Pure model for the Proving Shore's floating interact prompt: the keycap
// bubble that pops over the coach's CURRENT target (the rail NPC, the next
// castaway crate, the noticeboard, the ferry bell) the moment the player is
// close enough that pressing interact will actually work. New players told
// us they do not read the coach card's body text; the bubble puts the one
// button that matters where they are already looking, without asking them
// to read anything.
//
// Island-only by construction: every caller gates on isOnProvingShore, and
// every target here is authored island content. The pure-core half of the
// pure-core + thin-consumer split (root CLAUDE.md); registered in
// UI_PURE_CORES (tests/architecture.test.ts); driven directly by
// tests/coach_prompt_view.test.ts. The consumer is bootcamp.ts, which
// projects the anchor through renderer.worldToScreen exactly like its
// guidance arrow.

import { PROVING_SHORE_NPCS, PROVING_SHORE_QUESTS } from '../sim/content/proving_shore';
import {
  CRAB_MOB_ID,
  CRAB_QUEST_ID,
  CRAB_SUMMON_SITE,
  LURE_ITEM_ID,
} from '../sim/interactions/crab_summon';
import {
  isObjectOpenedByViewer,
  type OpenedObjectQuestRow,
} from '../sim/quests/opened_object_view';
import { ABILITY_DRILL_MOB_ID, ABILITY_DRILL_QUEST_ID } from '../sim/tutorial/ability_drill';
import { PASSING_STONE_ITEM_ID } from '../sim/tutorial/death_lesson';
import { INTERACT_RANGE } from '../sim/types';
import {
  BELL_STEP_TARGET,
  type BootcampStep,
  type CoachFocus,
  DEATH_LESSON_QUEST_ID,
  type DeathLessonPhase,
} from './bootcamp_view';
import type { TranslationKey } from './i18n';

/** Planar distance (sim dist2d needs full Vec3s; the prompt only has x/z). */
function planar(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

/** The one client-side gate the interact key itself uses for NPCs
 *  (game/interactions.ts, game/nearby_interaction.ts): objects reach
 *  INTERACT_RANGE, NPC talk reaches two yards further. */
export const PROMPT_NPC_RANGE = INTERACT_RANGE + 2;
export const PROMPT_OBJECT_RANGE = INTERACT_RANGE;

/** The crate line's live ground objects (entity.ts createGroundObject). */
export const CRATE_OBJECT_ITEM_ID = 'ps_castaway_crate';

export interface CoachPromptPlan {
  /** World anchor (the target's feet). */
  x: number;
  z: number;
  /** Bubble height above the sampled ground at the anchor. */
  lift: number;
  /** Interact reach for this target kind (the show gate). */
  range: number;
  /** The verb under the keycap: Talk, Turn in quest, Pick up, Read, Ring,
   *  Select, Attack. */
  verbKey: TranslationKey;
  /** 'select' asks for the pointer press that picks the quarry, or the target
   *  cycle button on a pad; 'kill' is the same bubble once the quarry IS the
   *  target, and chips the attack bind (desktop) or the action-bar icon (touch);
   *  'jump' bubbles chip the jump bind (the lane 2 parkour obstacles);
   *  'use' bubbles chip the bags bind (the tide-pool lure). */
  kind: 'interact' | 'select' | 'kill' | 'jump' | 'use';
}

/** The minimal entity shape the crate and mob scans read
 *  (IWorld.entities values). */
export interface CoachPromptEntity {
  /** Entity id, compared against the viewer's targetId so the kill lessons
   *  can tell "nothing selected yet" from "selected, now hit it". */
  id: number;
  kind: string;
  templateId?: string;
  objectItemId?: string | null;
  dead?: boolean;
  pos: { x: number; z: number };
}

/** How close to the lesson's mobs the Attack bubble shows: wide enough to
 *  catch the approach, tight enough to point at THIS camp. */
export const KILL_PROMPT_RANGE = 12;

/** The classes whose first real button is the SPELL on slot 2, not the
 *  melee Attack on slot 1: their combat lessons teach {attackKey} = the
 *  slot1 bind and speak of casting, not swinging. */
export const CASTER_CLASSES: ReadonlySet<string> = new Set(['mage', 'warlock', 'priest', 'druid']);

/** Which action-bar bind the combat lessons teach for this class. */
export function attackBindFor(playerClass: string): 'slot0' | 'slot1' {
  return CASTER_CLASSES.has(playerClass) ? 'slot1' : 'slot0';
}

const NPC_LIFT = 2.5;
const OBJECT_LIFT = 1.6;
const KILL_BUBBLE_LIFT = 0.55;

function npcPlan(npcId: string, verbKey: TranslationKey): CoachPromptPlan | null {
  const npc = PROVING_SHORE_NPCS[npcId];
  if (!npc) return null;
  return {
    x: npc.pos.x,
    z: npc.pos.z,
    lift: NPC_LIFT,
    range: PROMPT_NPC_RANGE,
    verbKey,
    kind: 'interact',
  };
}

/** The nearest LIVE mob of the lesson's template, the Attack bubble's anchor. */
export function nearestMob(
  entities: Iterable<CoachPromptEntity>,
  templateId: string,
  playerPos: { x: number; z: number },
): CoachPromptEntity | null {
  let best: CoachPromptEntity | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const e of entities) {
    if (e.kind !== 'mob' || e.templateId !== templateId || e.dead) continue;
    const d = planar(e.pos.x, e.pos.z, playerPos.x, playerPos.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** The nearest DEAD mob of a template: the pearl detour's loot window (the
 *  king's corpse holds the prize, and the press that matters is Pick up,
 *  not a re-summon). */
export function nearestDeadMob(
  entities: Iterable<CoachPromptEntity>,
  templateId: string,
  playerPos: { x: number; z: number },
): CoachPromptEntity | null {
  let best: CoachPromptEntity | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const e of entities) {
    if (e.kind !== 'mob' || e.templateId !== templateId || !e.dead) continue;
    const d = planar(e.pos.x, e.pos.z, playerPos.x, playerPos.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** The two kill lessons' quarry (the Attack bubble's scan target). */
const KILL_LESSON_TEMPLATE: Readonly<Record<string, string>> = {
  q_ps_strike_true: 'training_effigy',
  [ABILITY_DRILL_QUEST_ID]: ABILITY_DRILL_MOB_ID,
  q_ps_shell_and_claw: 'shore_scuttler',
  [CRAB_QUEST_ID]: CRAB_MOB_ID,
};

/**
 * How close to the corner it just turned the TURN ask keeps the bubble.
 *
 * Lane 2's hurdle sits inside JUMP_PROMPT_RANGE of its own checkpoint, so
 * without this the bubble skipped straight from "Hold W" to "Jump" the
 * instant a player rounded the first corner: the card said "D then W" and
 * the loud floating prompt never did (CX). Lane 3 has no obstacle, which is
 * exactly why it read correctly and lane 2 did not.
 *
 * Sized under JUMP_PROMPT_RANGE so the handover still happens well before
 * the hurdle: turn at the flag, then the jump ask takes the bubble as you
 * run at the rail.
 */
export const CORNER_ASK_YD = 5;

/**
 * Does the turn-and-walk ask own the bubble right now? True while the player
 * is still standing at the checkpoint they just tagged, which is the moment
 * the instruction is actually about.
 */
export function turnAskOwnsBubble(
  checkpointsReached: number,
  playerPos: { x: number; z: number },
  checkpoints: readonly { x: number; z: number }[],
): boolean {
  const corner = checkpoints[checkpointsReached - 1];
  if (!corner) return false;
  return planar(corner.x, corner.z, playerPos.x, playerPos.z) <= CORNER_ASK_YD;
}

/** How close to the tide pool the lure bubble shows (a step wider than the
 *  summon gate itself, so the ask reads on approach). */
export const LURE_PROMPT_RANGE = 10;

/** The nearest live castaway crate the player has NOT already opened, or
 *  null between respawns (an opened crate is gone for this viewer, so the
 *  bubble never points at a crate that would only refuse). */
export function nearestCrate(
  entities: Iterable<CoachPromptEntity>,
  playerPos: { x: number; z: number },
  questLog?: ReadonlyMap<string, OpenedObjectQuestRow>,
): CoachPromptEntity | null {
  let best: CoachPromptEntity | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const e of entities) {
    if (e.kind !== 'object' || e.objectItemId !== CRATE_OBJECT_ITEM_ID || e.dead) continue;
    if (questLog && isObjectOpenedByViewer(e, questLog)) continue;
    const d = planar(e.pos.x, e.pos.z, playerPos.x, playerPos.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** The signpost lesson's reading spot (mirrors COACH_ACTIVE_TARGETS: the
 *  noticeboard is a sentinel object, not a live entity the client can key). */
const SIGNPOST_SPOT = { x: -312, z: 42.5 };

/** Lane 2's parkour obstacles in running order (lane 2 runs SOUTH, so -z):
 *  the hurdle rail the player jumps OVER, then the crate step they jump
 *  ONTO. Each anchor sits mid-lane on its obstacle's line; both mirror the
 *  PROVING_SHORE_PROPS fence + crate authoring
 *  (tests/coach_prompt_view.test.ts pins them against the content). */
export const BOOTCAMP_PARKOUR: readonly { x: number; z: number }[] = [
  { x: -308, z: -23 },
  { x: -308, z: -27 },
];
/** Wide enough to read the ask on approach, tight enough to mean THIS rail. */
export const JUMP_PROMPT_RANGE = 9;
/** A stride past the obstacle's line counts as cleared: the bubble moves on
 *  to the next obstacle instead of nagging over a jump already landed. */
const PARKOUR_PASSED_SLACK = 1.2;
/** Half of lane 2's width plus a step of slack (walls at x -312 and -304). */
const PARKOUR_LANE_HALF_WIDTH = 5;
/** Above the hurdle rail's top, below the lane's sightline. */
const JUMP_LIFT = 1.2;

/** The next un-cleared lane 2 obstacle's bubble, or null once both are
 *  behind the player. Exported for the consumer's movement-bubble yield:
 *  the centered D-then-W chips give way while a jump ask is on screen. */
export function parkourPromptPlan(playerPos: { x: number; z: number }): CoachPromptPlan | null {
  for (const ob of BOOTCAMP_PARKOUR) {
    // Lane-scoped: lanes 1 and 3 run within 9 yd of the obstacles' x line,
    // and a jump ask over there would point at a wall.
    if (Math.abs(playerPos.x - ob.x) > PARKOUR_LANE_HALF_WIDTH) continue;
    if (playerPos.z <= ob.z - PARKOUR_PASSED_SLACK) continue;
    return {
      x: ob.x,
      z: ob.z,
      lift: JUMP_LIFT,
      range: JUMP_PROMPT_RANGE,
      verbKey: 'hudChrome.bootcamp.promptJump',
      kind: 'jump',
    };
  }
  return null;
}

/**
 * Where the interact bubble belongs for the current coach station, or null
 * when the station's lesson is not an interact press (the kill quests, the
 * gauntlet lanes, the camera swing). `step` is the gauntlet ladder's lesson
 * when the head quest holds the focus, null otherwise.
 */
export function coachPromptPlan(args: {
  bellPhase: boolean;
  step: BootcampStep | null;
  focus: CoachFocus | null;
  /** The world's entities. Accepts any iterable, INCLUDING a one-shot
   *  iterator (the live caller hands over `world.entities.values()`), which
   *  is why the plan materializes it before scanning: see the walk below. */
  entities: Iterable<CoachPromptEntity>;
  playerPos: { x: number; z: number };
  /** The viewer's quest log, for the opened-crate skip (optional so the
   *  bell/ladder callers stay unchanged). */
  questLog?: ReadonlyMap<string, OpenedObjectQuestRow>;
  /** Where the viewer is in the death lesson's arc: the stone's bubble is
   *  for the living only. Defaults to 'alive' so every other caller is
   *  unchanged. */
  deathPhase?: DeathLessonPhase;
  /** The viewer's current target (entity.targetId), which splits every kill
   *  lesson into its two halves: pick the quarry, then hit it. Optional so
   *  the bell/ladder callers stay unchanged; absent reads as "nothing
   *  selected", which is the safe half to show. */
  targetId?: number | null;
}): CoachPromptPlan | null {
  if (args.bellPhase) {
    return {
      x: BELL_STEP_TARGET.x,
      z: BELL_STEP_TARGET.z,
      lift: OBJECT_LIFT,
      range: PROMPT_OBJECT_RANGE,
      verbKey: 'hudChrome.bootcamp.promptRing',
      kind: 'interact',
    };
  }
  if (args.step !== null) {
    // The gauntlet ladder: the two interact lessons bubble their NPC, and
    // lane 2's run carries the parkour jump asks between its flags.
    if (args.step === 'talk') return npcPlan('warden_tam', 'hudChrome.bootcamp.promptTalk');
    if (args.step === 'done') return npcPlan('overseer_pell', 'hudChrome.bootcamp.promptTurnIn');
    if (args.step === 'turnwalk') return parkourPromptPlan(args.playerPos);
    return null;
  }
  const focus = args.focus;
  const deathPhase = args.deathPhase ?? 'alive';
  if (!focus) return null;
  const quest = PROVING_SHORE_QUESTS[focus.questId];
  if (!quest) return null;
  if (focus.state === 'available') {
    return npcPlan(quest.giverNpcId, 'hudChrome.bootcamp.promptTalk');
  }
  if (focus.state === 'ready') {
    return npcPlan(quest.turnInNpcId, 'hudChrome.bootcamp.promptTurnIn');
  }
  // Materialize ONCE, past the arms that never scan. The live caller hands
  // over `world.entities.values()`, a Map iterator that is spent after a
  // single walk: the pearl detour scans twice (live boss, then his corpse),
  // so the second scan saw an empty world and the bubble asked for a
  // re-summon while the corpse it should have pointed at lay in frame (CX).
  // A list here makes every arm below re-scannable by construction.
  const entities = [...args.entities];
  // Active tasks: interact-press lessons bubble their target; the kill
  // lessons bubble the nearest live quarry with the target and attack chips
  // (the playtest ask: Strike True's instruction comes up like the others).
  const quarry = KILL_LESSON_TEMPLATE[focus.questId];
  if (quarry) {
    const mob = nearestMob(entities, quarry, args.playerPos);
    // The pearl detour's quarry is SUMMONED: while the king's corpse still
    // lies on the sand the press that matters is the loot (the pearl is on
    // it), and only with no corpse at all does the bubble stand on the tide
    // pool asking for the lure (bags bind).
    if (!mob && focus.questId === CRAB_QUEST_ID) {
      const corpse = nearestDeadMob(entities, CRAB_MOB_ID, args.playerPos);
      if (corpse) {
        return {
          x: corpse.pos.x,
          z: corpse.pos.z,
          lift: KILL_BUBBLE_LIFT,
          // The LOOT reach, not the wide kill reach: corpse loot is gated on
          // INTERACT_RANGE (game/nearby_interaction.ts), so a bubble carried
          // over from the fight's 12 yards would ask for a press that does
          // nothing, which is how a first-timer decides the game is broken.
          range: PROMPT_OBJECT_RANGE,
          verbKey: 'hudChrome.bootcamp.promptLootPearl',
          kind: 'interact',
        };
      }
      return {
        x: CRAB_SUMMON_SITE.x,
        z: CRAB_SUMMON_SITE.z,
        lift: OBJECT_LIFT,
        range: LURE_PROMPT_RANGE,
        verbKey: 'hudChrome.bootcamp.promptSummon',
        kind: 'use',
      };
    }
    if (!mob) return null;
    // Two halves, because asking for both presses at once is what confused
    // new players: until the quarry IS the target the bubble asks only for
    // the click that selects it, and only then does it name the button that
    // hits it. Comparing ids rather than "has any target" matters: a player
    // who tabbed onto the wrong effigy still needs the select ask.
    const selected = args.targetId != null && args.targetId === mob.id;
    return {
      x: mob.pos.x,
      z: mob.pos.z,
      // Low anchor: the mob's nameplate health bar owns the space over its
      // head, and both must stay visible (playtest).
      lift: KILL_BUBBLE_LIFT,
      range: KILL_PROMPT_RANGE,
      // The ability drill asks for a different press on the same effigies,
      // so its second half names the ability rather than the swing.
      verbKey: selected
        ? focus.questId === ABILITY_DRILL_QUEST_ID || focus.questId === 'q_ps_shell_and_claw'
          ? 'hudChrome.bootcamp.promptUseAbility'
          : 'hudChrome.bootcamp.promptAttack'
        : 'hudChrome.bootcamp.promptSelect',
      kind: selected ? 'kill' : 'select',
    };
  }
  if (focus.questId === 'q_ps_the_wreck_line') {
    const crate = nearestCrate(entities, args.playerPos, args.questLog);
    if (!crate) return null;
    return {
      x: crate.pos.x,
      z: crate.pos.z,
      lift: OBJECT_LIFT,
      range: PROMPT_OBJECT_RANGE,
      verbKey: 'hudChrome.bootcamp.promptPickUp',
      kind: 'interact',
    };
  }
  if (focus.questId === 'q_ps_the_signpost') {
    return {
      x: SIGNPOST_SPOT.x,
      z: SIGNPOST_SPOT.z,
      lift: OBJECT_LIFT,
      range: PROMPT_NPC_RANGE,
      verbKey: 'hudChrome.bootcamp.promptRead',
      kind: 'interact',
    };
  }
  if (focus.questId === POUCH_QUEST_ID) {
    return npcPlan(quest.giverNpcId, 'hudChrome.bootcamp.promptTalk');
  }
  if (focus.questId === 'q_ps_set_sail') {
    return npcPlan(quest.turnInNpcId, 'hudChrome.bootcamp.promptTalk');
  }
  return null;
}

/** True when the bubble should be VISIBLE: standing close enough that the
 *  interact press will land on this plan's target. */
export function coachPromptInRange(
  plan: CoachPromptPlan,
  playerPos: { x: number; z: number },
): boolean {
  return planar(plan.x, plan.z, playerPos.x, playerPos.z) <= plan.range;
}

// ---------------------------------------------------------------------------
// The press-this-next UI glow (styles/components.css .qd-coach): which
// control outside the dialog pulses for the current station. Applied by the
// bootcamp overlay's glow applicator; the quest dialog gates its own rows.
// ---------------------------------------------------------------------------

/** The rail quest whose tracker title and quest-log row pulse. */
export function coachGlowQuestId(focus: CoachFocus | null): string | null {
  return focus?.questId ?? null;
}

/** The bag-lesson quest and the bag it teaches. */
export const POUCH_QUEST_ID = 'q_ps_pouch_and_purse';
export const POUCH_ITEM_ID = 'linen_pouch';

/** The vendor stock row that pulses (the pouch purchase lesson). */
export function coachGlowVendorItemId(focus: CoachFocus | null): string | null {
  return focus?.questId === POUCH_QUEST_ID && focus.state === 'active' ? POUCH_ITEM_ID : null;
}

/**
 * Is the buckle-the-pouch-on lesson still owed?
 *
 * The end of this lesson is the pouch being WORN, not the quest being handed
 * back. Keying on the 'ready' state alone left the bag stack pulsing and the
 * bottom edge blooming for the whole walk to the turn-in, long after the
 * player had done the thing being taught (CX: "gold trim is always at the
 * bottom here, no matter what").
 *
 * @param bags the four equippable bag sockets (IWorld.bags).
 */
export function pouchLessonActive(
  focus: CoachFocus | null,
  bags: readonly (string | null)[],
): boolean {
  if (focus?.questId !== POUCH_QUEST_ID || focus.state !== 'ready') return false;
  return !bags.includes(POUCH_ITEM_ID);
}

/** The bag stack that pulses: the pouch buckle-on lesson, and the Briny Lure
 *  while the pearl detour still wants the king summoned. A new player was
 *  told in prose to open their bags and click an item, which is not something
 *  they have ever done: the stack itself has to ask (CX). */
export function coachGlowBagItemId(
  focus: CoachFocus | null,
  bags: readonly (string | null)[],
): string | null {
  if (pouchLessonActive(focus, bags)) return POUCH_ITEM_ID;
  if (focus?.questId === CRAB_QUEST_ID && focus.state === 'active') return LURE_ITEM_ID;
  // The death lesson's rite stone lives in the bags now, so the stack itself
  // asks rather than the prose alone (CX).
  if (focus?.questId === DEATH_LESSON_QUEST_ID && focus.state === 'active') {
    return PASSING_STONE_ITEM_ID;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ferryman Odo's guiding voice: the clip key (rendered by the ElevenLabs
// pipeline from scripts/voices/extra_lines.mjs, whose guide__odo__* texts
// mirror these captions in English) plus the LOCALIZED caption row the coach
// card shows while the line plays. tests/coach_prompt_view.test.ts holds the
// clip keys and the extra_lines entries together.
// ---------------------------------------------------------------------------

export type GuideVoiceLineName =
  | 'arrival'
  | 'firstFlag'
  | 'runDone'
  | 'stationDoneA'
  | 'stationDoneB'
  | 'veerOff'
  | 'graduate';

export const GUIDE_VOICE_LINES: Readonly<
  Record<GuideVoiceLineName, { clip: string; caption: TranslationKey }>
> = {
  arrival: { clip: 'guide__odo__arrival', caption: 'hudChrome.bootcamp.voiceArrival' },
  firstFlag: { clip: 'guide__odo__first_flag', caption: 'hudChrome.bootcamp.voiceFirstFlag' },
  runDone: { clip: 'guide__odo__run_done', caption: 'hudChrome.bootcamp.voiceRunDone' },
  stationDoneA: {
    clip: 'guide__odo__station_done_a',
    caption: 'hudChrome.bootcamp.voiceStationDoneA',
  },
  stationDoneB: {
    clip: 'guide__odo__station_done_b',
    caption: 'hudChrome.bootcamp.voiceStationDoneB',
  },
  veerOff: { clip: 'guide__odo__veer_off', caption: 'hudChrome.bootcamp.voiceVeerOff' },
  graduate: { clip: 'guide__odo__graduate', caption: 'hudChrome.bootcamp.voiceGraduate' },
};

/** How far from the golden trail counts as veering off (the trail legs are
 *  straight chords of winding roads, so this carries real slack), and how
 *  long the player must stay out before Odo says anything. */
export const VEER_OFF_YD = 30;
export const VEER_GRACE_MS = 5000;
export const VEER_NUDGE_COOLDOWN_MS = 45000;
export const VEER_NUDGES_PER_STATION = 2;

/** The chip text beside the verb: the live interact bind on keyboard, the
 *  connected pad's resolved hardware glyph, and no keycap on touch. Null
 *  hides the chip and shows the verb alone. */
export function coachPromptChip(
  mode: 'keyboard' | 'touch' | 'pad',
  interactLabel: string,
  padInteractLabel: string,
): { chip: string | null; chipIsKey: boolean } {
  if (mode === 'keyboard') return { chip: interactLabel || null, chipIsKey: true };
  if (mode === 'pad') return { chip: padInteractLabel || null, chipIsKey: true };
  return { chip: null, chipIsKey: false };
}

/** One bubble chip: a keycap the player presses, the action-bar icon they
 *  tap, or a mobile cluster BUTTON's own glyph. Touch has no keys to name,
 *  so its bubbles show the button's own picture, and the matching cluster
 *  button pulses gold (coachGlowButtonId) so the picture and the control
 *  find each other (CX: "on mobile you don't know what that button means"). */
export type PromptChip =
  | { readonly cap: string }
  | { readonly abilityIcon: string }
  | { readonly buttonIcon: 'interact' | 'jump' | 'attack' };

/** The resolved inputs the chip row needs; the caller owns the lookups so
 *  this stays pure. */
export interface CoachPromptChipInputs {
  /** The ability drill asks for the class's OWN button, never Attack. */
  abilityAsk: boolean;
  /** Caster classes' first real button is their spell on slot 2; their kill
   *  bubble keeps that spell's icon (it matches the ring slot art). */
  caster: boolean;
  /** Icon id for the kill/drill bubble's ability art (touch). */
  killIconId: string;
  /** Resolved keycap labels (keyboard); empty string hides the chip. */
  slotLabel: string;
  jumpLabel: string;
  bagsLabel: string;
  interactLabel: string;
  /** Resolved through the live flat/XHB layout and connected pad brand. */
  padControlCaps: readonly string[];
}

/** The chip row for a visible ask, per input family. Every desktop interact
 *  keycap (the F family: Talk, Turn in quest, Pick up, Read, Ring) maps on
 *  touch to the Interact button's own glyph; the melee kill ask maps to the
 *  Attack button's glyph; the parkour ask to the Jump button's. */
export function coachPromptChips(
  kind: CoachPromptPlan['kind'],
  mode: 'keyboard' | 'touch' | 'pad',
  i: CoachPromptChipInputs,
): readonly PromptChip[] {
  if (mode === 'pad') return i.padControlCaps.map((cap) => ({ cap }));
  if (kind === 'select') return [];
  if (kind === 'kill') {
    if (mode === 'keyboard') return i.slotLabel ? [{ cap: i.slotLabel }] : [];
    if (i.abilityAsk || i.caster) return [{ abilityIcon: i.killIconId }];
    return [{ buttonIcon: 'attack' }];
  }
  if (kind === 'jump') {
    if (mode === 'keyboard') return i.jumpLabel ? [{ cap: i.jumpLabel }] : [];
    return [{ buttonIcon: 'jump' }];
  }
  if (kind === 'use') {
    return mode === 'keyboard' && i.bagsLabel ? [{ cap: i.bagsLabel }] : [];
  }
  if (mode === 'touch') return [{ buttonIcon: 'interact' }];
  const { chip } = coachPromptChip(mode, i.interactLabel, '');
  return chip ? [{ cap: chip }] : [];
}

/** Which mobile cluster control pulses gold for the visible ask. Touch only:
 *  the desktop keycap already names its key. The drill and caster kill
 *  bubbles point at the primary action RING slot (bar slot 1, the "2" bind)
 *  whose art the chip repeats, so the slot itself wears the ring too. */
export function coachGlowButtonId(
  kind: CoachPromptPlan['kind'] | null,
  mode: 'keyboard' | 'touch' | 'pad',
  i: Pick<CoachPromptChipInputs, 'abilityAsk' | 'caster'>,
): 'mobile-interact' | 'mobile-jump' | 'mobile-action-attack' | 'mobile-slot-primary' | null {
  if (mode !== 'touch' || kind === null || kind === 'select' || kind === 'use') return null;
  if (kind === 'kill')
    return i.abilityAsk || i.caster ? 'mobile-slot-primary' : 'mobile-action-attack';
  if (kind === 'jump') return 'mobile-jump';
  return 'mobile-interact';
}
