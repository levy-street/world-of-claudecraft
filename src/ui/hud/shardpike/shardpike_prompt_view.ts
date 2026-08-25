// The one loud line that answers "what am I supposed to do with this thing".
//
// The trial shipped with three buttons, a balance beam, and a stream of chat lines. Every
// fact a player needs was in that stream and none of it was on screen at the moment it
// mattered: that the boss's EYE is the target, that there is a reach to be inside, that a
// forty-second seal (not a bug) is why the thrust is refusing, and that once the eye IS out
// the pike's job is over and they should be hitting him instead. A player who has not read
// the quest text has no way to learn any of it from the fight.
//
// So: exactly ONE instruction at a time, chosen by urgency, phrased as a command. One,
// because a prompt that lists options is a menu and a player mid-fight reads a menu as
// noise; and the ORDER below is the whole design, since almost every state is true at once
// (the pike is in hand AND he is in range AND the ward is up AND the beam is drifting).
//
// Pure: no DOM, no clock, no i18n. It returns keys and values the painter resolves, which is
// also what lets a Vitest assert the priority ladder directly.

import type { LanceGuidanceView, LanceTrialView } from '../../../world_api';
import type { TranslationKey } from '../../i18n';
import { SHARDPIKE_DANGER_BALANCE, SHARDPIKE_ITEM_ID } from './shardpike_bar_view';

/** How urgent the line is, which is all the painter needs to style it. */
export type ShardpikePromptTone =
  /** Do this now or lose the window. */
  | 'urgent'
  /** You are mid-mechanic and it is going fine. */
  | 'active'
  /** Go do a thing (walk closer, brace up). */
  | 'directive'
  /** Nothing to do with the pike right now. */
  | 'idle'
  /** It worked. */
  | 'success';

export interface ShardpikePromptState {
  visible: boolean;
  tone: ShardpikePromptTone;
  /** The instruction itself. */
  bodyKey: TranslationKey;
  /** Placeholder values for `bodyKey`. */
  values: Readonly<Record<string, string>>;
  /**
   * Landed thrusts, or null to draw no tally.
   *
   * Hidden at zero deliberately: a "0" beside a first-time player's prompt reads as a
   * failure state before they have had a chance to do anything.
   */
  thrusts: number | null;
}

export interface ShardpikePromptInput {
  mainhandItemId?: string | null;
  trial: LanceTrialView | null;
  guidance: LanceGuidanceView | null;
  restRemaining: number;
  dead: boolean;
}

const HIDDEN: ShardpikePromptState = {
  visible: false,
  tone: 'idle',
  bodyKey: 'hudChrome.shardpike.promptFindBoss',
  values: {},
  thrusts: null,
};

/** Whole seconds, floored at 1 so a live countdown never displays "0" while still running. */
const secs = (v: number): string => String(Math.max(1, Math.ceil(v)));

/**
 * The instruction for this frame.
 *
 * The ladder, in order, and why each rung outranks the ones below it:
 *  1. STRIKE. The set window is a few seconds long and it is the only irreversible moment
 *     in the mechanic; nothing may ever sit above it.
 *  2. STEADY / drifting. Mid-brace, and the beam is the thing about to fail.
 *  3. The eye is already out. Says STOP: the pike does nothing now, go hit him, and here is
 *     how long you have. Above "brace" because a player who keeps poking a blinded boss is
 *     wasting the window they just opened for everyone else.
 *  4. Sealed. The honest reason the thrust is refusing, with the clock on it. Without this
 *     rung the mechanic looks broken for forty seconds.
 *  5. Re-set. The pike's own short cooldown.
 *  6. Walk closer. He is here and vulnerable and you are simply too far away.
 *  7. Brace. The one case where the answer really is "press the button".
 *  8. No boss in reach. The resting state: carries the pike's purpose so the answer to
 *     "what is this for" is on screen before the fight, not during it.
 */
export function shardpikePromptState(input: ShardpikePromptInput): ShardpikePromptState {
  if (input.mainhandItemId !== SHARDPIKE_ITEM_ID) return HIDDEN;
  const g = input.guidance;
  const thrusts = g && g.thrusts > 0 ? g.thrusts : null;
  const show = (
    tone: ShardpikePromptTone,
    bodyKey: TranslationKey,
    values: Record<string, string> = {},
  ): ShardpikePromptState => ({ visible: true, tone, bodyKey, values, thrusts });

  if (input.dead) return { ...HIDDEN, thrusts };

  const trial = input.trial;
  if (trial?.phase === 'steadied') {
    return show('urgent', 'hudChrome.shardpike.promptStrike', {
      seconds: secs(trial.windowRemaining),
    });
  }
  if (trial) {
    const drifting = Math.abs(trial.balance) >= SHARDPIKE_DANGER_BALANCE;
    return show(
      drifting ? 'urgent' : 'active',
      drifting ? 'hudChrome.shardpike.promptCatchIt' : 'hudChrome.shardpike.promptHoldSteady',
    );
  }
  if (g?.blinded) {
    return show('success', 'hudChrome.shardpike.promptEyeOut', {
      seconds: secs(g.blindRemaining),
    });
  }
  if (g?.targetPresent && g.sealRemaining > 0) {
    return show('idle', 'hudChrome.shardpike.promptSealed', { seconds: secs(g.sealRemaining) });
  }
  if (input.restRemaining > 0) {
    return show('idle', 'hudChrome.shardpike.promptResetting', {
      seconds: secs(input.restRemaining),
    });
  }
  if (g?.targetPresent && !g.inRange) {
    return show('directive', 'hudChrome.shardpike.promptCloser', {
      yards: String(Math.max(1, Math.round(g.targetDistance ?? 0))),
    });
  }
  if (g?.targetPresent) return show('directive', 'hudChrome.shardpike.promptBrace');
  return show('idle', 'hudChrome.shardpike.promptFindBoss');
}

/** Cheap change key, so the painter only writes DOM when the line actually changes. */
export function shardpikePromptSignature(state: ShardpikePromptState): string {
  if (!state.visible) return 'hidden';
  const vals = Object.entries(state.values)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(',');
  return `${state.tone}|${state.bodyKey}|${vals}|${state.thrusts ?? ''}`;
}
