// Source-guard for the gatherResult/craftResult/masterwork audio wiring
// (the player_death_audio.test.ts pattern): pins that a successful craft
// resolves the recipe's professionId to its own ui_craft_<family> cue via
// audio.craftSuccess(), and that a masterwork proc LAYERS audio.masterwork()
// alongside that cue rather than replacing it. Every professions grant also
// suppresses BOTH generic hub feedbacks at the source (Sim.addItem/
// addItemInstance opts.silent and opts.callerLogs, see
// tests/professions_silent_loot.test.ts) so neither the generic ding nor the
// generic "You receive:" line stacks on top of the profession's own cue and
// line; the corresponding hud.ts case 'loot' halves of that contract are
// pinned below. gatherResult/harvestResult's OWN cue+line behavior now lives
// behind the extracted gathering_result_feedback.ts executor and is pinned
// there (tests/gathering_result_feedback.test.ts); this file keeps only the
// hud.ts dispatch weld to it (see below).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Comments stripped (`://` protocol slashes preserved), the repo's raw-source-pin
// idiom. Every pin in this file matches on hud.ts source text, and these arms are
// more comment than code (the harvestResult arm is 33 lines of which 20 explain
// why), so without this a comment naming a call keeps a pin green after the call
// itself is gone. Stripped once here rather than per block, so the older arms
// below get the same protection.
const hud = readFileSync(join(__dirname, '../src/ui/hud.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// gatherResult and harvestResult used to be inline hud.ts arms (a
// audio.gather(ev.nodeType) call and a for-loop over ev.yields plus one
// audio.lootItem() ding); the monolith-ratchet heal moved both bodies whole
// into src/ui/hud/professions/gathering_result_feedback.ts
// (handleGatherResult / handleHarvestResult), leaving hud.ts a one-line
// dispatch per case. The BEHAVIOR these two blocks used to pin (the node-type
// cue, the rare-tier stinger layering, the one-log-line-per-yield loop, the
// single post-loop ding, the QUALITY_COLOR rarity coloring, the self-note on
// a depleted charge) is now pinned directly against the extracted executor in
// tests/gathering_result_feedback.test.ts, through a recording host: that
// file can see everything a hud.ts source-text scan could and drives real
// function calls instead of matching strings, so the behavior pins moved
// there rather than being restated here. What a body-side scan of the
// executor's OWN file cannot see is whether hud.ts's case bodies still wire
// to it, so that is all this guard checks: the two cases call the real
// handlers, imported from the real module, with `this` (the Hud host) as the
// second argument.
describe('gatherResult / harvestResult dispatch weld (#2457, extracted to gathering_result_feedback.ts)', () => {
  it('imports both handlers from the extracted module', () => {
    expect(hud).toContain("from './hud/professions/gathering_result_feedback'");
    expect(hud).toContain('handleGatherResult');
    expect(hud).toContain('handleHarvestResult');
  });

  it("case 'gatherResult' delegates to handleGatherResult(ev, this)", () => {
    const start = hud.indexOf("case 'gatherResult':");
    expect(start).toBeGreaterThan(-1);
    const body = hud.slice(start, hud.indexOf('break;', start));
    expect(body).toContain('handleGatherResult(ev, this)');
  });

  it("case 'harvestResult' delegates to handleHarvestResult(ev, this)", () => {
    const start = hud.indexOf("case 'harvestResult':");
    expect(start).toBeGreaterThan(-1);
    const body = hud.slice(start, hud.indexOf('break;', start));
    expect(body).toContain('handleHarvestResult(ev, this)');
  });
});

describe('gather-cast tool-out audio wiring', () => {
  it('plays a node-type-keyed cue on a gather cast start, not the flat fallback', () => {
    // hud.ts has two 'castStart' cases (a spatial cast-loop handler, and this
    // personal-cue one); anchor on GATHER_CAST_ID, unique to the latter.
    const start = hud.indexOf('ev.ability === GATHER_CAST_ID');
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain('audio.gatherCast(ev.gatherNodeType)');
  });
});

describe('craft-family cast-start audio wiring (Craft Cast System Phase 6)', () => {
  // Same personal castStart arm as gather/fish: one shared workbench wind-up
  // for every craft-family non-spell cast id. Completes keep their own cues.
  const castStartArm = () => {
    const start = hud.indexOf('ev.ability === GATHER_CAST_ID');
    expect(start).toBeGreaterThan(-1);
    return hud.slice(start, hud.indexOf('break;', start));
  };

  it('plays audio.craftCast for craft, enchant-family, and tool-recharge cast starts', () => {
    const body = castStartArm();
    expect(body).toContain('audio.craftCast()');
    expect(body).toContain('CRAFT_CAST_ID');
    expect(body).toContain('DISENCHANT_CAST_ID');
    expect(body).toContain('ENCHANT_CAST_ID');
    expect(body).toContain('SALVAGE_CAST_ID');
    // Masterwrought phase 04: the sunder cast joins the family wind-up.
    expect(body).toContain('SUNDER_CAST_ID');
    expect(body).toContain('TOOL_RECHARGE_CAST_ID');
  });
});

describe('craftResult audio wiring', () => {
  // The slice ends at the arm's OWN break, the shape every other block in this
  // file uses. It used to run to `case 'lootRoll'`, roughly fifteen arms
  // further down, so the "no loot ding" assertion below was silently policing
  // every arm in between; the corpse-harvest arm (#2457), which legitimately
  // plays audio.lootItem() once, is what surfaced it.
  const craftArm = () => {
    const start = hud.indexOf("case 'craftResult':");
    expect(start).toBeGreaterThan(-1);
    return hud.slice(start, hud.indexOf('break;', start));
  };

  it('resolves the recipe to its craft family instead of always playing the loot ding', () => {
    const body = craftArm();
    expect(body).toContain('audio.craftSuccess(');
    expect(body).not.toContain('audio.lootItem()');
  });

  it('layers the masterwork sting alongside the family cue, gated on ev.masterwork', () => {
    const body = craftArm();
    expect(body).toContain('if (ev.masterwork) audio.masterwork();');
    // The masterwork call must come strictly after the craftSuccess call, so
    // it layers on top rather than replacing it.
    expect(body.indexOf('audio.craftSuccess(')).toBeLessThan(body.indexOf('audio.masterwork();'));
  });
});

describe('legendaryForged audio wiring (Masterwrought phase 14)', () => {
  // The orange promotion's personal celebration used to reuse ui_achievement
  // (audibly identical to any deed unlock); the dedicated capstone cue
  // supersedes it on the personal arm ONLY. The zone arm's view bundle
  // decides no cue for anyone (playCue: false in
  // craft_celebration_text_view.ts), so its inert achievement call is not
  // policed here.
  it('the personal arm plays the dedicated forged cue, not the deed chime', () => {
    const start = hud.indexOf("case 'legendaryForged':");
    expect(start).toBeGreaterThan(-1);
    const body = hud.slice(start, hud.indexOf('break;', start));
    expect(body).toContain('if (l.playCue) audio.legendaryForged();');
    expect(body).not.toContain('audio.achievement()');
  });
});

describe('the generic loot cue respects ev.silent', () => {
  it('skips both audio.coin() and audio.lootItem() when the loot event is silent', () => {
    const start = hud.indexOf("case 'loot':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain('if (!ev.silent)');
    // Both generic cues sit INSIDE the silent guard, and nothing else does:
    // a professions grant suppresses the ding without suppressing anything
    // else this arm does for it.
    const guard = body.indexOf('if (!ev.silent)');
    expect(body.indexOf('audio.lootItem()')).toBeGreaterThan(guard);
    expect(body.indexOf('audio.coin()')).toBeGreaterThan(guard);
  });
});

describe('the generic loot LINE respects ev.callerLogs', () => {
  // The text half of the same idea (#2430). This block replaces an earlier pin
  // that asserted the opposite contract ("the log line must sit OUTSIDE the
  // silent guard, so a professions grant's 'You receive:' line still prints"):
  // that line was the second of the two lines one profession action printed
  // for one grant, and it now stands down. The old pin's index-order form
  // would have stayed GREEN under this change while asserting a contract the
  // code no longer has, so it is replaced rather than adjusted.
  it('the hub log call sits inside a callerLogs guard, as one statement', () => {
    const start = hud.indexOf("case 'loot':");
    const body = hud.slice(start, hud.indexOf('break;', start));
    // One statement, not a guard placed above an unguarded log: the adjacency
    // is what makes this pin fail if the line ever prints unconditionally
    // again.
    expect(body).toContain('if (!ev.callerLogs) this.log(');
    expect(body.match(/this\.log\(/g)).toHaveLength(1);
  });

  it('the bag refresh and the loot-roll close stay OUTSIDE the callerLogs guard', () => {
    // A professions grant still moves items, so the online bag mirror must
    // still repaint, and a loot-roll line must still close its prompt. Only
    // the duplicate TEXT is elided.
    const start = hud.indexOf("case 'loot':");
    const body = hud.slice(start, hud.indexOf('break;', start));
    const guard = body.indexOf('if (!ev.callerLogs)');
    expect(guard).toBeGreaterThan(-1);
    expect(body.indexOf('this.lootRolls.closeForItem(')).toBeGreaterThan(guard);
    expect(body.indexOf('this.renderBags()')).toBeGreaterThan(guard);
  });

  it('the two flags stay independent conditions', () => {
    // Merging them would tie a caller's cue ownership to its line ownership;
    // they are deliberately separate (a caller can own one without the other).
    const start = hud.indexOf("case 'loot':");
    const body = hud.slice(start, hud.indexOf('break;', start));
    expect(body).not.toContain('!ev.silent && !ev.callerLogs');
    expect(body).not.toContain('!ev.callerLogs && !ev.silent');
  });
});

describe('disenchantResult audio wiring', () => {
  // disenchantItem is called from the bag item action menu
  // (src/ui/bag_item_action_menu.ts); the success (toast.sink === 'log') arm
  // plays audio.disenchant(), a denial (showError) never does.
  it('plays the disenchant cue on a successful disenchant, not on a denial', () => {
    const start = hud.indexOf("case 'disenchantResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain("if (toast.sink === 'log') {");
    expect(body).toContain('audio.disenchant();');
    // The disenchant call must sit inside the log (success) arm, before the
    // else (showError/denial) branch.
    expect(body.indexOf('audio.disenchant();')).toBeLessThan(body.indexOf('else'));
  });
});

describe('salvageResult audio wiring', () => {
  // salvageItem is called from the bag item action menu, same shape as
  // disenchantResult above.
  it('plays the salvage cue on a successful salvage, not on a denial', () => {
    const start = hud.indexOf("case 'salvageResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain("if (toast.sink === 'log') {");
    expect(body).toContain('audio.salvage();');
    expect(body.indexOf('audio.salvage();')).toBeLessThan(body.indexOf('else'));
  });
});

describe('enchantResult audio wiring', () => {
  // applyEnchant is called from the bag item action menu, same shape as
  // disenchantResult above.
  it('plays the enchant cue on a successful apply-enchant, not on a denial', () => {
    const start = hud.indexOf("case 'enchantResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain("if (toast.sink === 'log') {");
    expect(body).toContain('audio.enchant();');
    expect(body.indexOf('audio.enchant();')).toBeLessThan(body.indexOf('else'));
  });
});

describe('sunder completion audio wiring (Masterwrought phase 14)', () => {
  // The sunder grant is silent + callerLogs (the recorded one silent
  // craft-family completion), so the cue keys off the personal log line's RAW
  // English in hud.ts's case 'log' via the pure predicate. Three welds so a
  // reword in ANY home fails here: the hud call, the predicate's two literal
  // halves, and the sim emit template they must keep matching.
  const core = readFileSync(
    join(__dirname, '../src/ui/hud/professions/profession_event_lines_core.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const sundering = readFileSync(join(__dirname, '../src/sim/professions/sundering.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it("the case 'log' arm routes the sunder line to audio.sunderComplete()", () => {
    const start = hud.indexOf("case 'log': {");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf("case 'playerDeath'", start);
    const body = hud.slice(start, end);
    expect(body).toContain('if (isSunderCompletionLog(ev.text)) audio.sunderComplete();');
  });

  it('the predicate spells both halves of the emit, and the sim emit still matches them', () => {
    expect(core).toContain("text.startsWith('You sunder ')");
    expect(core).toContain("text.endsWith(' into Sundered Essence.')");
    // The emit template in sundering.ts: interpolated name between the exact
    // prefix and suffix the predicate tests.
    expect(sundering).toContain('`You sunder ${def?.name ?? itemId} into Sundered Essence.`');
  });

  it('the predicate itself accepts the live emit shape and refuses near misses', async () => {
    const { isSunderCompletionLog } = await import(
      '../src/ui/hud/professions/profession_event_lines_core'
    );
    expect(isSunderCompletionLog('You sunder Gravewyrm Bone Quiver into Sundered Essence.')).toBe(
      true,
    );
    expect(isSunderCompletionLog('You sunder it.')).toBe(false);
    expect(isSunderCompletionLog('Sundered Essence.')).toBe(false);
    expect(isSunderCompletionLog('They sunder Gravewyrm Bone Quiver into Sundered Essence.')).toBe(
      false,
    );
  });
});
