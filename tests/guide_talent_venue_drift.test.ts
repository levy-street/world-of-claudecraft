import { describe, expect, it } from 'vitest';
import { type ArenaMatch, Sim } from '../src/sim/sim';
import type { BgMatch } from '../src/sim/social/battleground';
import { guideStrings } from '../src/ui/i18n.catalog/guide';
import { EMPTY_TEST_WORLD } from './sim_shared';

// WHY THIS SUITE EXISTS. Four guide strings state the venue rule for changing talents
// ("out of combat and not in an arena match ..."). That rule is sim behavior
// (talentLockReason, src/sim/progression/talents.ts), and the guide re-states it in
// English rather than deriving it, so the two can drift silently. They DID: the release
// that let fighters respec inside a battleground (out of combat) left all four strings
// still naming the battleground as a blocker, so the wiki told players a rule the game
// no longer had.
//
// The guard is two-sided on purpose. It does not hardcode "the copy must not say
// battleground": it asks the REAL gate whether each venue blocks, then requires the copy
// to name that venue if and only if it does. Re-block the battleground in the sim and
// this suite reds until the copy is put back, which is the same signal in the other
// direction. tests/battleground.test.ts owns the sim-behavior arm; this owns the copy.

// The venue is decided by presence in ctx.arenaMatches / ctx.bgMatches (talentLockReason
// reads nothing else off the match), so a marker value drives the gate faithfully while
// keeping this a fast unit test with no queue, no seating, and no second player.
const MARKER = {} as ArenaMatch & BgMatch;

function warriorAtCap(): Sim {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(20);
  return sim;
}

/** Does the real gate refuse a respec in this venue, with the player out of combat? */
function blocksRespec(venue: 'none' | 'arena' | 'battleground'): boolean {
  const sim = warriorAtCap();
  const pid = sim.playerId;
  sim.player.inCombat = false;
  if (venue === 'arena') sim.ctx.arenaMatches.set(pid, MARKER);
  if (venue === 'battleground') sim.ctx.bgMatches.set(pid, MARKER);
  return sim.respec(pid) === false;
}

// The strings that state the rule. Each is rendered verbatim on a page a player reads
// (how-to-play, the talents reference twice, and the "wish I knew" starter list).
const RULE_COPY: { where: string; text: string }[] = [
  { where: 'guide.howToPlay.reassure', text: guideStrings.howToPlay.reassure },
  { where: 'guide.talentsPage.resetNote', text: guideStrings.talentsPage.resetNote },
  { where: 'guide.talentsPage.loadoutNote', text: guideStrings.talentsPage.loadoutNote },
  { where: 'guide.wishPage.i3Body', text: guideStrings.wishPage.i3Body },
];

describe('guide talent-change venue rule matches the sim gate', () => {
  it('exercises the real gate: combat blocks, and a venue only blocks if the sim says so', () => {
    // The control. Without it, a gate that refused EVERY respec (a broken rig, a changed
    // signature) would make every "blocks" answer below trivially true and the whole
    // suite vacuous.
    expect(blocksRespec('none'), 'an out-of-combat respec in the open world must succeed').toBe(
      false,
    );
    const sim = warriorAtCap();
    sim.player.inCombat = true;
    expect(sim.respec(sim.playerId), 'combat is still the line').toBe(false);
  });

  it('names every blocking venue, and no venue that does not block', () => {
    const venues = [
      { word: 'arena', blocks: blocksRespec('arena') },
      { word: 'battleground', blocks: blocksRespec('battleground') },
    ];
    // Pin the gate's own answers as literals too, so a future change to BOTH the sim and
    // the copy in the same wrong direction still has to come through this file.
    expect(venues.find((v) => v.word === 'arena')?.blocks).toBe(true);
    expect(venues.find((v) => v.word === 'battleground')?.blocks).toBe(false);

    for (const { where, text } of RULE_COPY) {
      expect(text.length, `${where} must exist and be non-empty`).toBeGreaterThan(0);
      // Positive control: the string really is the one stating the rule, so a rename or
      // a reword that drops the rule entirely cannot pass this test silently.
      expect(text.toLowerCase(), `${where} should state the out-of-combat rule`).toContain(
        'out of combat',
      );
      // Bare word-presence cannot tell "not in an arena match or a battleground" (a
      // blocker) from "a battleground is the exception" (the allowance resetNote
      // deliberately explains), and reading the second as a blocker is how a naive
      // version of this guard would force the copy to go quiet about the very change it
      // is here to track. So the claim is read where it is actually made: the
      // restriction clause, from "not in" to the end of its own sentence.
      const restriction = /not in ([^.]*)/i.exec(text)?.[1]?.toLowerCase() ?? '';
      expect(
        restriction.length,
        `${where} should state which venues are off limits`,
      ).toBeGreaterThan(0);
      for (const { word, blocks } of venues) {
        expect(
          restriction.includes(word),
          `${where} ${blocks ? 'must name' : 'must NOT name'} the ${word} as off limits ` +
            `(clause: "not in ${restriction}"): the sim gate ${
              blocks ? 'blocks' : 'allows'
            } a talent change there`,
        ).toBe(blocks);
      }
    }
  });
});
