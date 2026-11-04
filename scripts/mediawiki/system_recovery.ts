import {
  LOCKPICK_TIER_PRESETS,
  LOCKPICK_TIER_REWARD,
} from '../../src/sim/content/delves/lockpick_tiers';
import {
  ANTE_TO_PAGES,
  ANTE_TO_STEP_TIMEOUT_MS,
  ANTE_TO_TIER,
  ANTE_TO_TRIES,
} from '../../src/sim/lockpick';
import {
  UNSTUCK_SICKNESS_MIN_LEVEL,
  UNSTUCK_SICKNESS_STAT_MULT,
  unstuckSicknessDuration,
} from '../../src/sim/resurrection';
import {
  FINDER_DECLINE_COOLDOWN_SECONDS,
  FINDER_EXPEDITION_APPLICATION_CAP,
  FINDER_EXPEDITION_APPLICATION_COOLDOWN,
  FINDER_EXPEDITION_APPLICATION_SECONDS,
  FINDER_PROPOSAL_SECONDS,
} from '../../src/sim/social/dungeon_finder';
import { EXPEDITION_NOTE_MAX } from '../../src/sim/social/expedition_social';
import { FINDER_PLAYER_APPLICATION_CAP } from '../../src/sim/social/finder_applications';
import { MAX_LEVEL } from '../../src/sim/types';
import {
  UNSTUCK_COUNTDOWN_SECONDS,
  UNSTUCK_RETRY_SECONDS,
  UNSTUCK_SICKNESS_WINDOW_SECONDS,
  UNSTUCK_SUCCESS_COOLDOWN_SECONDS,
} from '../../src/sim/unstuck';
import { heading, list, percent, type SystemWriter } from './system_writer';

export function addRecoveryAndFinder(w: SystemWriter) {
  w.describe(
    'Dungeon Finder',
    'Join the automatic queue on your own, or have your party leader enter your group. Choose the activities and roles you can fill. Once enough players fit a run, every member must accept the same proposal.',
    `A proposal expires after ${FINDER_PROPOSAL_SECONDS} seconds. Declining or failing to answer removes your queued unit (you and any party queued with you). The player who declined or timed out must wait ${FINDER_DECLINE_COOLDOWN_SECONDS} seconds before queueing again. Other intact units keep their original place in the queue.`,
    heading(
      'Expedition listings',
      `A leader posts an expedition with a purpose and an optional moderated note of up to ${EXPEDITION_NOTE_MAX} characters. Players can apply for the leader to accept. You may have up to ${FINDER_PLAYER_APPLICATION_CAP} pending applications; a listing takes up to ${FINDER_EXPEDITION_APPLICATION_CAP}. An expedition application expires after ${FINDER_EXPEDITION_APPLICATION_SECONDS} seconds. Requests to the same listing have a ${FINDER_EXPEDITION_APPLICATION_COOLDOWN}-second retry cooldown.`,
    ),
  );
  w.describe(
    'Death and recovery',
    heading(
      'Using /unstuck',
      `Stand still and undisturbed for ${UNSTUCK_COUNTDOWN_SECONDS} seconds. Movement, entering combat, taking damage, casting, eating, drinking, sitting, or a change between living and dead cancels the countdown. The retry timer starts when you begin an attempt and lasts ${UNSTUCK_RETRY_SECONDS} seconds. A completed move starts a ${UNSTUCK_SUCCESS_COOLDOWN_SECONDS / 60}-minute cooldown. In the ordinary world you move to a graveyard; if already dead, you revive there with 20% health and, for a mana user, 20% mana. Other resource bars start at zero. Battlegrounds use their own recovery point and preserve a dead player's resurrection queue.`,
    ),
    `The first completion after ${UNSTUCK_SICKNESS_WINDOW_SECONDS / 3600} hour without one is free of Unstuck Sickness. Each completion restarts that window. A repeat can reduce all attributes by ${percent(-UNSTUCK_SICKNESS_STAT_MULT)}. Below level ${UNSTUCK_SICKNESS_MIN_LEVEL} there is no sickness. It lasts ${unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL)} seconds at level ${UNSTUCK_SICKNESS_MIN_LEVEL}, plus ${unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL + 1) - unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL)} seconds per further level, up to ${unstuckSicknessDuration(MAX_LEVEL)} seconds at level ${MAX_LEVEL}.`,
  );
  w.describe(
    'Lockpicking',
    'Choose an ante before starting. It fixes the highest loot tier and determines how many consecutive pages, attempts and seconds you get. Each move goes forward one column. Hard Set moves up two rows, Set up one, Steady holds the row, Ease moves down one and Drop down two. At the edge the row is clamped. Pass every gate through its single opening and reach the final seat.',
    heading(
      'Ante, attempts and clock',
      list(
        ([1, 2, 3] as const).map((a) => {
          const tier = ANTE_TO_TIER[a],
            reward = LOCKPICK_TIER_REWARD[tier];
          return `Ante ${a}, ${tier} loot: ${ANTE_TO_PAGES[a]} page(s) in a row, ${ANTE_TO_TRIES[a]} attempt(s), ${ANTE_TO_STEP_TIMEOUT_MS[a] / 1000} seconds per move. Solved delve reward: ${reward.bonusMarks} bonus Marks within the daily full-reward window and extra copper equal to ${percent(reward.copperMult - 1)} of the rounded midpoint of the delve's base copper range, rounded to a whole copper.`;
        }),
      ),
    ),
    heading(
      'Board difficulty',
      list(
        Object.entries(LOCKPICK_TIER_PRESETS).map(
          ([k, p]) =>
            `${k}: ${p.cols} columns, ${p.rows} rows, ${p.gateCount} gates, ${p.trapCount ?? 0} traps, ${p.visibilityWindow} columns visible ahead.`,
        ),
      ),
    ),
    'A solved rift cache pays the picker (rift base level + floor count) x 90 copper, multiplied by 2.2 for premium, 1.5 for medium or 1 for low and rounded to a whole copper. The clock resets after each legal advance. A blocked cell, missed gate, trap or missed deadline costs one attempt. If attempts remain, restart at the first page on a newly generated board. Choosing to abort preserves the chest for a fresh attempt. Exhausting all attempts at a delve reward chest gives the low-tier consolation and ends the run. At a rift cache the same failure jams the cache and gives no cache loot.',
  );
}
