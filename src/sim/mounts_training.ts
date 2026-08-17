// The riding lesson ("mount training"), server-authoritative, a sibling system
// behind SimContext. The riding skill itself (ridingTrained) is purchased from
// Marla for 80g (learnRiding). After accepting Marla's quest, the player stands
// on the glowing square behind the arch and presses Start Race. The lesson is
// FREE: pressing Start Race lends a training Valorsteed and arms the countdown.
// FINISHING the course passes the lesson and credits its quest objective
// (mountTrainingRaceFinished, called from src/sim/mount_race.ts). Marla takes the
// steed back afterward (an instant force-dismount; the player never keeps the
// unowned mount). Turning in q_riding_lessons awards gold and XP only (its
// itemRewards is empty); the reins_valorsteed themselves are a separate 10g
// purchase from Marla's vendor stock afterwards. Dismounting or leaving the
// paddock abandons the attempt (re-entrant: the player can start another race).
//
// The legacy mount_train_begin command remains append-only compatible, but no
// current HUD button sends it. The session lives directly on PlayerMeta.mountTraining. The NPC
// (stablemaster_marla) and the quest (q_riding_lessons, one 'interact' objective
// keyed on the sentinel targetObjectItemId 'train_valorsteed') are content-slice
// data; this module resolves them by id/string. On success it credits that
// objective directly (see creditRidingLessonObjective) rather than reusing
// interactObjectForQuests, which keys off a live Entity.objectItemId (there is no
// such entity here).
//
// Determinism: the lesson is driven off live player state only, so this system
// draws NO rng and perturbs no draw order. `src/sim`-pure: no DOM/Three, no
// Math.random/Date.now/performance.now (enforced by tests/architecture.test.ts).

import { MOUNT_RACE_START_PLATFORM, STABLE_PADDOCK, TRAINING_MOUNT_KEY } from './content/mounts';
import { QUESTS } from './data';
import { forceDismount, forceTrainingMount } from './mounts';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import {
  dist2d,
  type Entity,
  INTERACT_RANGE,
  isNonSpellCast,
  type MountTrainingSession,
} from './types';

// --- tuning (change numbers here, not inline) -------------------------------
export const MOUNT_TRAIN_MIN_LEVEL = 20;
// The retired 100g lesson fee. Nothing charges it anymore: the lesson is free
// and the only riding purchase is RIDING_SKILL_FEE_COPPER below. Kept only so
// the grandfather mapping (mountTrainingFeePaid -> ridingTrained on load) has
// its historical context documented.
export const MOUNT_TRAIN_FEE_COPPER = 1_000_000; // 100 gold (legacy)
// Riding skill purchase from Marla: 80 gold.
export const RIDING_SKILL_FEE_COPPER = 800_000; // 80 gold in copper
// The lesson's play area: the paddock rect plus a small margin (which also covers
// Marla, who stands just north of the fence at z=708). Straying beyond it during
// the lesson abandons the attempt. This replaces the old fixed radius around
// Marla, since the show-jumping course now fills the whole (enlarged) paddock.
const LESSON_MARGIN = 4;

function outsideLessonBounds(e: Entity): boolean {
  return (
    e.pos.x < STABLE_PADDOCK.x1 - LESSON_MARGIN ||
    e.pos.x > STABLE_PADDOCK.x2 + LESSON_MARGIN ||
    e.pos.z < STABLE_PADDOCK.z1 - LESSON_MARGIN ||
    e.pos.z > STABLE_PADDOCK.z2 + LESSON_MARGIN
  );
}

// The stablemaster NPC + her quest, resolved by id (content-slice data; this
// module never imports src/sim/content/* records directly, matching the seam).
const STABLEMASTER_NPC_ID = 'stablemaster_marla';
export const RIDING_LESSONS_QUEST_ID = 'q_riding_lessons';
// Sentinel targetObjectItemId the quest's one 'interact' objective is keyed on.
// No ITEMS entry and no ground Entity ever carry this id: it exists purely so this
// module and the quest objective can agree on "the lesson was cleared" without a
// real interactable object.
export const TRAIN_SENTINEL_ITEM_ID = 'train_valorsteed';

// Player notices (English at the emit site; localized client-side by sim_i18n's
// EXACT matcher, S3-guarded). Placeholder-free, so they auto-register.
const NOTICE_SUCCESS = "Marla takes the Valorsteed's reins. Well ridden.";
const NOTICE_LEFT_YARD =
  'You leave the paddock and the lesson ends. Come back to Marla to try again.';
const NOTICE_RIDING_LEARNED = 'You have learned Riding. You can now summon and ride a mount.';

function findStablemaster(ctx: SimContext): Entity | null {
  for (const e of ctx.entities.values()) {
    if (e.kind === 'npc' && e.templateId === STABLEMASTER_NPC_ID) return e;
  }
  return null;
}

/** Purchase the riding skill from Marla for 80 gold. Server-authoritative: checks
 *  level 20, proximity to Marla, sufficient copper, and that the skill is not
 *  already owned. On success sets ridingTrained = true, charges 80g, and emits
 *  a notice toast. The npcId param identifies which NPC the client is interacting
 *  with (validated against the stablemaster template). */
export function learnRiding(ctx: SimContext, npcId: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e } = r;
  if (meta.ridingTrained) {
    ctx.error(meta.entityId, 'You have already learned Riding.');
    return;
  }
  if (e.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (e.level < MOUNT_TRAIN_MIN_LEVEL) {
    ctx.error(meta.entityId, 'You must be level 20 to learn Riding.');
    return;
  }
  const npc = ctx.entities.get(npcId);
  if (!npc || npc.kind !== 'npc' || npc.templateId !== STABLEMASTER_NPC_ID) {
    ctx.error(meta.entityId, 'You must speak to Marla Hitchen to learn Riding.');
    return;
  }
  if (dist2d(e.pos, npc.pos) > INTERACT_RANGE + 2) {
    ctx.error(meta.entityId, 'Too far away.');
    return;
  }
  if (meta.copper < RIDING_SKILL_FEE_COPPER) {
    ctx.error(meta.entityId, 'Not enough money.');
    return;
  }
  meta.copper -= RIDING_SKILL_FEE_COPPER;
  meta.ridingTrained = true;
  ctx.notice(meta.entityId, NOTICE_RIDING_LEARNED);
}

/** Whether this player still needs to clear the course for the accepted riding
 *  lesson. A ready or completed quest no longer uses the training mount. */
export function needsRidingLessonRace(meta: PlayerMeta): boolean {
  return meta.questLog.get(RIDING_LESSONS_QUEST_ID)?.state === 'active';
}

/** Prepare the accepted riding lesson directly from the glowing start platform.
 *  This replaces the old extra Begin Lesson gossip click: the deliberate Start
 *  Race click charges the one-time fee, opens the lesson, and lends the training
 *  Valorsteed immediately. */
export function prepareRidingLessonRace(ctx: SimContext, meta: PlayerMeta, e: Entity): boolean {
  if (!needsRidingLessonRace(meta)) return false;
  if (e.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return false;
  }
  if (e.level < MOUNT_TRAIN_MIN_LEVEL) {
    ctx.error(meta.entityId, 'You must be level 20 to take riding lessons.');
    return false;
  }
  if (e.inCombat) {
    ctx.error(meta.entityId, "You can't do that while in combat.");
    return false;
  }
  // The profession-cast interlock's fourth route: the race start mounts the
  // lesson steed INSTANTLY (forceTrainingMount), so a live gather or fishing
  // cast refuses here exactly as the reins click refuses through useItem's
  // busy guard. Draw-free, before any session state is written.
  if (isNonSpellCast(e.castingAbility)) {
    ctx.error(meta.entityId, 'You are busy.');
    return false;
  }
  // The lesson itself is free: the only riding purchase is the 80g skill at
  // Marla (learnRiding), and quest acceptance already requires ridingTrained.
  let session = meta.mountTraining;
  const announce = session?.state !== 'IN_PROGRESS' || session.phase !== 'ride';
  if (session?.state !== 'IN_PROGRESS') {
    session = {
      sessionId: `mt_${meta.entityId}_${ctx.tickCount}`,
      ownerId: meta.entityId,
      anchor: { x: MOUNT_RACE_START_PLATFORM.x, z: MOUNT_RACE_START_PLATFORM.z },
      state: 'IN_PROGRESS',
      phase: 'ride',
    };
    meta.mountTraining = session;
  } else {
    session.phase = 'ride';
  }
  if (!forceTrainingMount(ctx, e)) return false;
  if (announce) {
    ctx.emit({
      type: 'mountTrainSession',
      sessionId: session.sessionId,
      phase: 'ride',
      pid: meta.entityId,
    });
  }
  return true;
}

/** Credit the q_riding_lessons 'interact' objective (sentinel targetObjectItemId
 *  TRAIN_SENTINEL_ITEM_ID) on SUCCESS, mirroring interactObjectForQuests's own body
 *  (sim.ts) but keyed on the sentinel instead of a live Entity.objectItemId (there is
 *  no ground object here). Least-invasive: no new SimContext callback,
 *  checkQuestReady is already on the seam. Turn-in at Marla (the existing
 *  quest-commands turn-in path) grants reins_valorsteed from there; this never grants
 *  the item directly. */
function creditRidingLessonObjective(ctx: SimContext, meta: PlayerMeta): void {
  for (const qp of meta.questLog.values()) {
    if (qp.state !== 'active') continue;
    const quest = QUESTS[qp.questId];
    quest.objectives.forEach((objective, i) => {
      if (objective.type !== 'interact' || objective.targetObjectItemId !== TRAIN_SENTINEL_ITEM_ID)
        return;
      if (qp.counts[i] >= objective.count) return;
      qp.counts[i]++;
      meta.counters.questProgress++;
      ctx.emit({
        type: 'questProgress',
        questId: qp.questId,
        objectiveIndex: i,
        current: qp.counts[i],
        required: objective.count,
        text: `${objective.label}: ${qp.counts[i]}/${objective.count}`,
        pid: meta.entityId,
      });
      ctx.checkQuestReady(qp, meta);
    });
  }
}

/** Start a riding lesson. Refuses (via ctx.error) unless alive, level 20+, standing
 *  at the stablemaster, actively on q_riding_lessons with its objective not yet
 *  complete, and no session already IN_PROGRESS; charges the one-time 100g fee on the
 *  first-ever successful begin (later attempts are free: the fee stays paid). The
 *  player then climbs aboard with the Mount/Dismount hotkey. */
export function mountTrainBegin(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e } = r;
  if (e.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (e.level < MOUNT_TRAIN_MIN_LEVEL) {
    ctx.error(meta.entityId, 'You must be level 20 to take riding lessons.');
    return;
  }
  // The lesson IS climbing into the saddle with the Mount/Dismount key, so a
  // player already riding (or mid-summon) must step down first: otherwise the
  // driver would credit the objective the same tick and the lesson would feel
  // like it completed itself.
  if (e.mountKey !== '' || (e.mountCastRemaining ?? 0) > 0) {
    ctx.error(meta.entityId, 'Dismount first.');
    return;
  }
  const marla = findStablemaster(ctx);
  if (!marla || dist2d(e.pos, marla.pos) > INTERACT_RANGE + 2) {
    ctx.error(meta.entityId, 'Too far away.');
    return;
  }
  const qp = meta.questLog.get(RIDING_LESSONS_QUEST_ID);
  if (!qp || qp.state !== 'active') {
    ctx.error(meta.entityId, 'You need to accept the riding lesson quest first.');
    return;
  }
  if (meta.mountTraining?.state === 'IN_PROGRESS') {
    ctx.error(meta.entityId, 'A riding lesson is already in progress.');
    return;
  }
  // The lesson is free (see prepareRidingLessonRace): riding is bought once,
  // as the 80g skill at Marla.
  const session: MountTrainingSession = {
    sessionId: `mt_${meta.entityId}_${ctx.tickCount}`,
    ownerId: meta.entityId,
    anchor: { x: marla.pos.x, z: marla.pos.z },
    state: 'IN_PROGRESS',
    phase: 'mount',
  };
  meta.mountTraining = session;
  ctx.emit({
    type: 'mountTrainSession',
    sessionId: session.sessionId,
    phase: 'mount',
    pid: meta.entityId,
  });
}

/** Server-authoritative per-tick driver, run every tick for every player. Advances
 *  the lesson from 'mount' (climb aboard) to 'ride' (ride the course to the start
 *  line), and ends it on death or on straying beyond the paddock. The lesson is NO
 *  LONGER completed by mounting: a race finished while it is live credits it (see
 *  mountTrainingRaceFinished). Draws no rng. */
export function tickMountTraining(ctx: SimContext, meta: PlayerMeta): void {
  const session = meta.mountTraining;
  if (session?.state !== 'IN_PROGRESS') return;
  const e = ctx.entities.get(meta.entityId);
  if (!e) return;

  // Death ends the lesson (handleDeath already force-dismounted any steed). The
  // quest stays active, so the player just begins again at Marla, fee still paid.
  if (e.dead) {
    abandonMountTraining(ctx, meta);
    return;
  }
  // Straying beyond the paddock abandons (the course fills the whole yard now, so
  // the bound is the paddock rect, not a small radius around Marla).
  if (outsideLessonBounds(e)) {
    ctx.notice(meta.entityId, NOTICE_LEFT_YARD);
    abandonMountTraining(ctx, meta);
    return;
  }

  if (session.phase === 'mount') {
    // Climbing into the saddle advances to the ride phase (it no longer completes
    // the lesson). Re-emit the session event so the HUD toasts the marker hint.
    if (e.mountKey === TRAINING_MOUNT_KEY) {
      session.phase = 'ride';
      ctx.emit({
        type: 'mountTrainSession',
        sessionId: session.sessionId,
        phase: 'ride',
        pid: meta.entityId,
      });
    }
    return;
  }
  // 'ride' phase: stepping off the training steed abandons the attempt (the toast
  // rides the mountTrainEnd event). A finished race is what passes the lesson.
  if (e.mountKey !== TRAINING_MOUNT_KEY) abandonMountTraining(ctx, meta);
}

/** Credit a live riding lesson when the player finishes a show-jumping race
 *  (src/sim/mount_race.ts calls this on a 'finished' outcome). A no-op unless a
 *  lesson is IN_PROGRESS: runs the same success body as before (credit the quest
 *  objective, hand the unowned steed back, notice + event). */
export function mountTrainingRaceFinished(ctx: SimContext, meta: PlayerMeta): void {
  const session = meta.mountTraining;
  if (session?.state !== 'IN_PROGRESS') return;
  const e = ctx.entities.get(meta.entityId);
  if (!e) return;
  succeed(ctx, meta, session, e);
}

function succeed(
  ctx: SimContext,
  meta: PlayerMeta,
  session: MountTrainingSession,
  e: Entity,
): void {
  session.state = 'SUCCESS';
  creditRidingLessonObjective(ctx, meta);
  // The player does not own the training steed, so take it back instantly (no
  // put-away channel) rather than leaving them riding an unowned mount.
  forceDismount(ctx, e);
  ctx.notice(meta.entityId, NOTICE_SUCCESS);
  ctx.emit({
    type: 'mountTrainEnd',
    sessionId: session.sessionId,
    outcome: 'success',
    pid: session.ownerId,
  });
  meta.mountTraining = null;
}

/** Tear down an active riding-lesson session, preserving the fee (paid stays paid)
 *  and force-dismounting the unowned training steed if the player is riding it (or
 *  mid-summon). Shared by the wire abort, the leave/disconnect path, and the
 *  death/strayed driver branches. */
export function abandonMountTraining(ctx: SimContext, meta: PlayerMeta): void {
  const session = meta.mountTraining;
  if (session?.state !== 'IN_PROGRESS') return;
  session.state = 'ABANDONED';
  const e = ctx.entities.get(meta.entityId);
  if (e) forceDismount(ctx, e);
  ctx.emit({
    type: 'mountTrainEnd',
    sessionId: session.sessionId,
    outcome: 'abandoned',
    pid: session.ownerId,
  });
  meta.mountTraining = null;
}

/** Wire-initiated abort (the append-only mount_train_abort command): resolves the
 *  acting pid, then shares abandonMountTraining's body with the leave-path caller. */
export function mountTrainAbort(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  abandonMountTraining(ctx, r.meta);
}
