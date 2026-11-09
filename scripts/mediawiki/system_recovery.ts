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
    'Join the queue by yourself, or have your party leader sign up your whole group. Pick the activities you want and the roles you can play. When the game finds enough players for a run, it offers that group a spot. Every member must accept it.',
    `You have ${FINDER_PROPOSAL_SECONDS} seconds to accept. If you say no, or do not answer in time, you are taken out of the queue. If you queued with a party, your whole party is taken out too. The player who said no or ran out of time must wait ${FINDER_DECLINE_COOLDOWN_SECONDS} seconds before joining the queue again. Everyone else who was offered the spot keeps their place in the queue.`,
    heading(
      'Expedition listings',
      `A leader posts an expedition and says what it is for. They can add a note of up to ${EXPEDITION_NOTE_MAX} characters, which moderators can check. Other players apply to join, and the leader picks who to accept. You can have up to ${FINDER_PLAYER_APPLICATION_CAP} applications waiting at once. A listing can hold up to ${FINDER_EXPEDITION_APPLICATION_CAP}. An application runs out after ${FINDER_EXPEDITION_APPLICATION_SECONDS} seconds. After you apply to a listing, you must wait ${FINDER_EXPEDITION_APPLICATION_COOLDOWN} seconds before you can apply to it again.`,
    ),
  );
  w.describe(
    'Death and recovery',
    heading(
      'Using /unstuck',
      `Stand still, with nothing bothering you, for ${UNSTUCK_COUNTDOWN_SECONDS} seconds. The countdown stops if you move, enter combat, take damage, cast, eat, drink, sit, die or come back to life. You can try again ${UNSTUCK_RETRY_SECONDS} seconds after you start a try. When the move works, a ${UNSTUCK_SUCCESS_COOLDOWN_SECONDS / 60} minute cooldown starts. In the normal world, you are moved to a graveyard. If you were already dead, you come back to life there with 20% health. If your class uses mana, you also get 20% mana. Other resource bars start empty. Battlegrounds send you to their own safe spot instead. If you are dead there, you keep your place in the line to come back to life.`,
    ),
    `Using /unstuck can make you sick with Unstuck Sickness. The first time you use it after ${UNSTUCK_SICKNESS_WINDOW_SECONDS / 3600} hour without using it, you do not get sick. Each use starts that hour over. Using it again sooner can lower all your attributes by ${percent(-UNSTUCK_SICKNESS_STAT_MULT)}. Characters below level ${UNSTUCK_SICKNESS_MIN_LEVEL} never get sick. The sickness lasts ${unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL)} seconds at level ${UNSTUCK_SICKNESS_MIN_LEVEL}, plus ${unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL + 1) - unstuckSicknessDuration(UNSTUCK_SICKNESS_MIN_LEVEL)} seconds for each level above that, up to ${unstuckSicknessDuration(MAX_LEVEL)} seconds at level ${MAX_LEVEL}.`,
  );
  w.describe(
    'Lockpicking',
    'Pick an ante before you start. The ante sets the best loot you can win. It also sets how many pages you must solve in a row, how many tries you get and how many seconds you have for each move. Each move takes you one column forward. Hard Set also moves you up two rows and Set up one. Steady keeps your row. Ease moves you down one and Drop down two. You cannot move past the top or bottom row. Pass each gate through its one opening and reach the last seat to win.',
    heading(
      'Ante, attempts and clock',
      list(
        ([1, 2, 3] as const).map((a) => {
          const tier = ANTE_TO_TIER[a],
            reward = LOCKPICK_TIER_REWARD[tier];
          return `Ante ${a}, ${tier} loot: ${ANTE_TO_PAGES[a]} page(s) in a row, ${ANTE_TO_TRIES[a]} attempt(s), ${ANTE_TO_STEP_TIMEOUT_MS[a] / 1000} seconds per move. Reward for solving a delve chest: ${reward.bonusMarks} bonus Marks, if you still get full rewards today. You also get extra copper equal to ${percent(reward.copperMult - 1)} of the middle of the delve's normal copper range (that middle is rounded), then rounded to a whole copper.`;
        }),
      ),
    ),
    heading(
      'Board difficulty',
      list(
        Object.entries(LOCKPICK_TIER_PRESETS).map(
          ([k, p]) =>
            `${k}: ${p.cols} columns, ${p.rows} rows, ${p.gateCount} gates, ${p.trapCount ?? 0} traps, ${p.visibilityWindow} columns you can see ahead.`,
        ),
      ),
    ),
    'If you solve a rift cache, you get (rift base level + number of floors) x 90 copper. That is multiplied by 2.2 for premium, 1.5 for medium or 1 for low, then rounded to a whole copper. The clock starts over after each allowed move. You lose one try if you hit a blocked square, miss a gate, hit a trap or run out of time. If you have tries left, you start again from the first page on a brand new board. If you choose to quit, the chest stays so you can try again later. If you use up every try on a delve reward chest, you get the low-tier prize instead and the run ends. If you use up every try on a rift cache, the cache jams and gives no loot.',
  );
}
