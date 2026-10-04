// The adventurers' say lines, pooled per trigger: a stable id, the catalog key
// the client renders (graveyardShift.say.*) and the English source the
// event carries as its fallback text. Pure data, no SimContext, no rng.

import type { BotRole } from './bot_brain';

export type BotSayTrigger =
  | 'clearing'
  | 'notice'
  | 'death'
  | 'healerOom'
  | 'wipeThreat'
  | 'corpseRun'
  | 'returned'
  | 'giveUp'
  | 'partyWins'
  | 'loot';

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
  key: `graveyardShift.say.${trigger}.${name}`,
  text,
  ...roles,
});

export const BOT_LINES: Readonly<Record<BotSayTrigger, readonly BotLine[]>> = {
  clearing: [
    line('clearing', 'lastPull', 'ok last pack, then boss, then bed'),
    line('clearing', 'stayAway', 'stay away from the boss guys'),
    line('clearing', 'speedUp', 'gtg in 10 min, can we speed up'),
    line('clearing', 'howsMana', "healer how's mana", { notBy: 'healer' }),
  ],
  notice: [
    line('notice', 'pulledEarly', 'boss pulled early??'),
    line('notice', 'whoPulled', 'WHO PULLED'),
    line('notice', 'boredWaiting', 'did the boss just get bored of waiting'),
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
  ],
  wipeThreat: [
    line('wipeThreat', 'popEverything', 'pop everything. POP EVERYTHING'),
    line('wipeThreat', 'wedding', "who's been saving a cooldown for their wedding"),
    line('wipeThreat', 'goingBadly', 'this is going badly'),
  ],
  corpseRun: [
    line('corpseRun', 'runningBack', "they're running back, hold on"),
    line('corpseRun', 'kiteHim', 'just kite him in circles'),
    line('corpseRun', 'holdHim', "hold him till they're back"),
  ],
  returned: [
    line('returned', 'roundTwo', 'ok round 2, for real this time'),
    line('returned', 'imBack', "I'm back, did I miss anything"),
    line('returned', 'knowHisMoves', 'ok I know his moves now'),
    line('returned', 'revengeTime', 'revenge time'),
  ],
  giveUp: [
    line('giveUp', 'gn', "ok I'm out, gn"),
    line('giveUp', 'ggBoss', 'gg boss, honestly that was sick'),
    line('giveUp', 'betterRotation', 'the boss had a better rotation than me'),
    line('giveUp', 'sameTime', 'same time tomorrow?'),
  ],
  loot: [],
  partyWins: [
    line('partyWins', 'easy', 'EZ'),
    line('partyWins', 'gg', 'gg'),
    line('partyWins', 'toldYouEasy', 'told you he was easy'),
  ],
};

// After a loss the party stands over Morthen and does what parties do. Said in
// order, by whoever is standing (outro.ts times them).
export const LOOT_LINES: readonly BotLine[] = [
  line('loot', 'whoNeeds', 'ok who needs the trousers'),
  line('loot', 'need', 'NEED'),
];

export function botLineAllowed(l: BotLine, role: BotRole): boolean {
  return (l.by === undefined || l.by === role) && l.notBy !== role;
}
