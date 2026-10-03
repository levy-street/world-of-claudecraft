// The adventurers' say lines, pooled per trigger: a stable id, the catalog key
// the client renders (devCommand.graveyardShift.say.*) and the English source the
// event carries as its fallback text. Pure data, no SimContext, no rng.

import type { BotRole } from './bot_brain';

export type BotSayTrigger =
  | 'notice'
  | 'death'
  | 'healerOom'
  | 'wipeThreat'
  | 'corpseRun'
  | 'returned'
  | 'giveUp'
  | 'partyWins';

export interface BotLine {
  readonly id: string;
  readonly key: string;
  readonly text: string;
  // Only this role may say the line (a first-person healer line).
  readonly by?: BotRole;
  // This role never says the line (the healer does not call for the healer).
  readonly notBy?: BotRole;
}

const line = (
  trigger: BotSayTrigger,
  name: string,
  text: string,
  roles: { by?: BotRole; notBy?: BotRole } = {},
): BotLine => ({
  id: `${trigger}.${name}`,
  key: `devCommand.graveyardShift.say.${trigger}.${name}`,
  text,
  ...roles,
});

export const BOT_LINES: Readonly<Record<BotSayTrigger, readonly BotLine[]>> = {
  notice: [
    line('notice', 'pulledEarly', 'boss pulled early??'),
    line('notice', 'whoPulled', 'WHO PULLED'),
    line('notice', 'didntTouch', 'I DIDNT TOUCH IT'),
    line('notice', 'walkingTowards', 'uh, is the boss supposed to be walking towards us'),
    line('notice', 'notInSpot', "wait he's not in his spot. is this a new patch"),
    line('notice', 'watchedGuide', "I watched a guide, he's easy, just don't stand in purple"),
  ],
  death: [
    line('death', 'rip', 'rip'),
    line('death', 'healerHealer', 'healer?? HEALER??', { notBy: 'healer' }),
    line('death', 'lag', 'lag. that was lag. we all saw it'),
  ],
  healerOom: [
    line('healerOom', 'oom', 'oom', { by: 'healer' }),
    line('healerOom', 'emotionalSupport', "I'm healing with pure emotional support at this point", {
      by: 'healer',
    }),
    line('healerOom', 'iKnow', 'yes I know the boss is already pulled, I KNOW', { by: 'healer' }),
  ],
  wipeThreat: [
    line('wipeThreat', 'popEverything', 'pop everything. POP EVERYTHING'),
    line('wipeThreat', 'wedding', "who's been saving a cooldown for their wedding"),
    line('wipeThreat', 'blamePet', "if we wipe I'm blaming the pet"),
  ],
  corpseRun: [
    line('corpseRun', 'runningBack', "they're running back, hold on"),
    line('corpseRun', 'kiteHim', '30 sec, kite him'),
    line('corpseRun', 'stayAlive', 'just stay alive, just stay alive'),
  ],
  returned: [
    line('returned', 'roundTwo', 'ok round 2, for real this time'),
    line('returned', 'tactics', "who has the boss's tactics?"),
    line('returned', 'guideOnTheWay', 'I watched a guide on the way'),
    line('returned', 'gearRed', "my gear is red, whatever, let's go"),
  ],
  giveUp: [
    line('giveUp', 'gn', "ok I'm out, gn"),
    line('giveUp', 'ggBoss', 'gg boss, honestly that was sick'),
    line('giveUp', 'betterRotation', 'the boss had a better rotation than me'),
    line('giveUp', 'sameTime', 'same time tomorrow?'),
  ],
  partyWins: [
    line('partyWins', 'firstTry', 'WE DID IT, first try'),
    line('partyWins', 'respect', 'the boss almost had us, respect'),
  ],
};

export function botLineAllowed(l: BotLine, role: BotRole): boolean {
  return (l.by === undefined || l.by === role) && l.notBy !== role;
}
