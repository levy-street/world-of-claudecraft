import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATHERING_PROFESSION_IDS } from '../src/sim/content/professions';
import { GATHERING_PROFESSION_NAME_KEYS } from '../src/ui/gathering_profession_name';
import { hasTranslation, t } from '../src/ui/i18n';

// Gather-event localization: the sim emits ids plus values only
// (gatherResult / gatherRareEvent are text-free, the craftResult/skinEvent
// precedent), so no sim/server matcher rule exists; the client renders the
// gatherEvent.* zone-broadcast lines and the hudChrome.gathering.* gather
// lines. These pins keep that client path honest: the keys must exist, splice
// their placeholders, and stay wired into the hud event switch.

describe('gatherEvent broadcast lines (client-localized ids)', () => {
  it('all three flavor keys exist', () => {
    expect(hasTranslation('gatherEvent.pristineVein')).toBe(true);
    expect(hasTranslation('gatherEvent.ancientHeartwood')).toBe(true);
    expect(hasTranslation('gatherEvent.moonlitBloom')).toBe(true);
  });

  it('renders the exact contract English with the {finder} splice', () => {
    expect(t('gatherEvent.pristineVein', { finder: 'Alba' })).toBe('Alba struck a pristine vein!');
    expect(t('gatherEvent.ancientHeartwood', { finder: 'Alba' })).toBe(
      'Alba felled an ancient heartwood!',
    );
    expect(t('gatherEvent.moonlitBloom', { finder: 'Alba' })).toBe(
      'Alba discovered a moonlit bloom!',
    );
  });
});

describe('hudChrome.gathering gather lines', () => {
  it('the gather-line keys exist and splice name and qty', () => {
    expect(hasTranslation('hudChrome.gathering.gatherLine')).toBe(true);
    expect(hasTranslation('hudChrome.gathering.gatherLineQty')).toBe(true);
    expect(t('hudChrome.gathering.gatherLine', { name: 'Copper Ore' })).toBe(
      'You gather: Copper Ore.',
    );
    expect(t('hudChrome.gathering.gatherLineQty', { name: 'Copper Ore', qty: 5 })).toBe(
      'You gather: Copper Ore x5.',
    );
  });

  it('the gather line stays worded apart from the loot family it no longer prints beside', () => {
    // #2430 inverted the reason this pin exists. The grant hub's own 'loot'
    // SimEvent no longer prints its "You receive:" line for a harvest grant
    // (the loot event's callerLogs flag), so the gather line is the ONLY line
    // for the harvest and there is no longer a duplicate to diverge FROM.
    // The two wordings must still not collide: "You receive:" remains the
    // wording of every NON-profession grant and is the literal string
    // Hud.localizeLootText matches on to localize those lines, so a gather
    // line reworded into that family would be re-parsed as a hub line.
    expect(t('hudChrome.gathering.gatherLine', { name: 'X' }).startsWith('You receive')).toBe(
      false,
    );
    expect(
      t('hudChrome.gathering.gatherLineQty', { name: 'X', qty: 2 }).startsWith('You receive'),
    ).toBe(false);
    expect(t('hud.logs.lootReceiveItem', { item: 'X' }).startsWith('You receive')).toBe(true);
  });
});

describe('hudChrome.gathering corpse-harvest lines (#2457)', () => {
  it('the harvest-line keys exist and splice name and qty', () => {
    expect(hasTranslation('hudChrome.gathering.harvestLine')).toBe(true);
    expect(hasTranslation('hudChrome.gathering.harvestLineQty')).toBe(true);
    expect(hasTranslation('hudChrome.gathering.harvestSpecimenLine')).toBe(true);
    expect(t('hudChrome.gathering.harvestLine', { name: 'Rough Hide' })).toBe(
      'You harvest: Rough Hide.',
    );
    expect(t('hudChrome.gathering.harvestLineQty', { name: 'Rough Hide', qty: 3 })).toBe(
      'You harvest: Rough Hide x3.',
    );
    expect(t('hudChrome.gathering.harvestSpecimenLine', { name: 'Pristine Hide' })).toBe(
      'You also recover Pristine Hide.',
    );
  });

  it('leaves no placeholder unspliced on any of the three', () => {
    // A key whose English drifted to a token the arm does not supply reaches
    // the player as a literal "{qty}", which every wording pin above would
    // still miss if it only checked the happy value.
    const rendered = [
      t('hudChrome.gathering.harvestLine', { name: 'X' }),
      t('hudChrome.gathering.harvestLineQty', { name: 'X', qty: 2 }),
      t('hudChrome.gathering.harvestSpecimenLine', { name: 'X' }),
    ];
    for (const line of rendered) expect(line).not.toMatch(/\{[A-Za-z0-9_]+\}/);
  });

  it('the harvest lines stay worded apart from the loot family they replaced', () => {
    // Same reason as the gather line above: "You receive:" is still the
    // wording of every non-profession grant and the literal string
    // Hud.localizeLootText matches on, so a harvest line reworded into that
    // family would be re-parsed as a hub line.
    expect(t('hudChrome.gathering.harvestLine', { name: 'X' }).startsWith('You receive')).toBe(
      false,
    );
    expect(
      t('hudChrome.gathering.harvestLineQty', { name: 'X', qty: 2 }).startsWith('You receive'),
    ).toBe(false);
    expect(
      t('hudChrome.gathering.harvestSpecimenLine', { name: 'X' }).startsWith('You receive'),
    ).toBe(false);
  });

  it('the harvest wording is distinct from the node-gather wording', () => {
    // Two gathering surfaces the player can tell apart in the log. If the
    // corpse family were ever reworded onto the node family's sentence, the
    // key-collision pin in tests/grant_line_view.test.ts would still pass.
    expect(t('hudChrome.gathering.harvestLine', { name: 'X' })).not.toBe(
      t('hudChrome.gathering.gatherLine', { name: 'X' }),
    );
    expect(t('hudChrome.gathering.harvestLineQty', { name: 'X', qty: 2 })).not.toBe(
      t('hudChrome.gathering.gatherLineQty', { name: 'X', qty: 2 }),
    );
  });

  // The five non-Latin fills these wordy new values need in the same change
  // (M16) are enforced whole-catalog by the English-leak guard in
  // tests/i18n_completeness.test.ts, which fails on any non-Latin value left
  // byte-identical to a wordy English leaf. Not restated here.
});

describe('the single-line grant contract (#2430)', () => {
  // The load-bearing half of the fix lives in hud.ts's `case 'loot':` arm: the
  // hub's log() call is the ONE thing a callerLogs grant elides. A regression
  // that widens the guard (eliding the loot-roll close or the bag refresh with
  // it) or narrows it back out (printing the hub line again) leaves every
  // wording pin above green, so bind the arm's structure at the source level.
  // Comments stripped (`://` protocol slashes preserved), the repo's
  // raw-source-pin idiom, matching tests/professions_silent_loot.test.ts and
  // tests/professions_audio_wiring.test.ts. Every pin below matches on call
  // TEXT, and commenting a call out in place is the ordinary way to disable
  // one, which would otherwise leave the call's own words sitting in the arm
  // and every assertion here green.
  const hudSource = () =>
    readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const lootArm = () => {
    const source = hudSource();
    const start = source.indexOf("case 'loot': {");
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf('break;', start));
  };

  it('the hub log call is the only thing the callerLogs guard elides', () => {
    const arm = lootArm();
    // The guard and the log are ONE statement: `if (!ev.callerLogs) this.log(`.
    // Pinning the exact adjacency is what stops the "guard inserted above an
    // unguarded log" shape, which would keep an index-order pin green while
    // printing both lines again.
    expect(arm).toContain('if (!ev.callerLogs) this.log(');
    const guard = arm.indexOf('if (!ev.callerLogs)');
    // The loot-roll close and the bag refresh must sit AFTER the one-statement
    // guard, so they still run for a professions grant.
    expect(arm.indexOf('this.lootRolls.closeForItem(')).toBeGreaterThan(guard);
    expect(arm.indexOf('this.renderBags()')).toBeGreaterThan(guard);
    // Exactly one log() call in the arm, and it is the guarded one.
    expect(arm.match(/this\.log\(/g)).toHaveLength(1);
  });

  it('the audio guard stays independent of the text guard', () => {
    // silent and callerLogs are separate flags on purpose: a caller may own
    // the cue without owning the line (and vice versa). Collapsing them into
    // one condition would silence the cue for any future line-owning caller
    // that still wants the ding.
    const arm = lootArm();
    expect(arm).toContain('if (!ev.silent)');
    expect(arm).toContain('audio.lootItem()');
    expect(arm).toContain('audio.coin()');
    // Neither flag may appear in the other's condition.
    expect(arm).not.toContain('!ev.silent && !ev.callerLogs');
    expect(arm).not.toContain('!ev.callerLogs && !ev.silent');
  });
});

describe('hud event switch stays wired to the ids', () => {
  it('the client references every gather-event key the sim ids resolve to', () => {
    // Source liveness pin (the S3-scan spirit): losing one of these mappings
    // silently would strand the id-based event without player-visible text.
    // The flavor-to-key mapping still lives in the hud.ts event switch; the
    // two gather-line keys moved to the grant_line_view.ts pure core when the
    // qty-variant choice was extracted there (#2430), so scan both files.
    const source =
      readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8') +
      readFileSync(path.resolve(process.cwd(), 'src/ui/grant_line_view.ts'), 'utf8');
    for (const key of [
      'gatherEvent.pristineVein',
      'gatherEvent.ancientHeartwood',
      'gatherEvent.moonlitBloom',
      'hudChrome.gathering.gatherLine',
      'hudChrome.gathering.gatherLineQty',
    ]) {
      expect(source.includes(key), key).toBe(true);
    }
  });

  it('the receive matcher accepts the xN batch suffix and still localizes the name', () => {
    // Both grant hubs emit "You receive: X xN." for a multi-unit grant (the
    // batched windfall). A greedy single-capture arm would feed "Copper Ore
    // x5" to the exact-name lookup and silently render the item name in raw
    // English for every non-English locale.
    const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    const armStart = source.indexOf('/^You receive: (.+?)( x\\d+)?\\.$/');
    expect(armStart).toBeGreaterThan(-1);
    const arm = source.slice(
      armStart,
      source.indexOf(';', source.indexOf('lootReceiveItem', armStart)),
    );
    expect(arm).toContain('itemStackDisplayName(match[1], match[2])');
  });

  it('each flavor maps to its own broadcast key in the hud switch', () => {
    // A swapped flavor-to-key mapping would pass the mere-existence pin above;
    // bind each slug to its key through the conditional chain in the
    // gatherRareEvent case (order: pristine_vein then ancient_heartwood, with
    // moonlitBloom as the remaining arm).
    const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    const caseStart = source.indexOf("case 'gatherRareEvent'");
    expect(caseStart).toBeGreaterThan(-1);
    const block = source.slice(caseStart, source.indexOf('break;', caseStart));
    const pv = block.indexOf("'pristine_vein'");
    const pvKey = block.indexOf("'gatherEvent.pristineVein'");
    const ah = block.indexOf("'ancient_heartwood'");
    const ahKey = block.indexOf("'gatherEvent.ancientHeartwood'");
    const mbKey = block.indexOf("'gatherEvent.moonlitBloom'");
    expect(pv).toBeGreaterThan(-1);
    expect(pvKey).toBeGreaterThan(pv);
    expect(ah).toBeGreaterThan(pvKey);
    expect(ahKey).toBeGreaterThan(ah);
    expect(mbKey).toBeGreaterThan(ahKey);
  });

  it('the gatherResult case adds no second loot cue (the loot event owns the cue)', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    const caseStart = source.indexOf("case 'gatherResult'");
    expect(caseStart).toBeGreaterThan(-1);
    const block = source.slice(caseStart, source.indexOf('break;', caseStart));
    expect(block.includes('audio.lootItem')).toBe(false);
  });

  it('the achievement cue on gatherRareEvent is finder-only (the other D1 half)', () => {
    // The zone fanout delivers one copy per in-zone recipient; only the
    // finder may hear the celebratory cue. A regression that cues every
    // recipient (or drops the cue) would pass the wording pins above, so
    // bind the cue call to the finder guard: the conditional must appear in
    // the case block BEFORE the cue call (same index-order technique as the
    // flavor-to-key pin).
    const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    const caseStart = source.indexOf("case 'gatherRareEvent'");
    expect(caseStart).toBeGreaterThan(-1);
    const block = source.slice(caseStart, source.indexOf('break;', caseStart));
    const guard = block.indexOf('ev.finderPid === sim.playerId');
    const cue = block.indexOf('audio.achievement()');
    expect(guard).toBeGreaterThan(-1);
    expect(cue).toBeGreaterThan(guard);
  });

  it('both lines color through the existing quality token family only', () => {
    // Acceptance criterion 5: the gather line is rarity-colored and the
    // broadcast line rides the epic token; a regression to a fixed default
    // color (or an ad-hoc hex) keeps every wording pin green, so pin the
    // color arguments at the source level.
    const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    const gatherStart = source.indexOf("case 'gatherResult'");
    const gatherBlock = source.slice(gatherStart, source.indexOf('break;', gatherStart));
    expect(gatherBlock.includes('QUALITY_COLOR[ev.rarity]')).toBe(true);
    const rareStart = source.indexOf("case 'gatherRareEvent'");
    const rareBlock = source.slice(rareStart, source.indexOf('break;', rareStart));
    expect(rareBlock.includes('QUALITY_COLOR.epic')).toBe(true);
  });
});

describe('hudChrome.gathering catch line (Professions 2.0)', () => {
  // The fishingResult SimEvent is text-free like gatherResult, so the client
  // catch line carries the same duties as the gather line above: exist,
  // splice, stay distinct from BOTH the loot family and the gather family,
  // stay wired in the hud switch, and color by item quality. Since #2430 it is
  // also the SOLE line for a landed catch and the reel cue its SOLE cue: the
  // catch grant now passes both silent and callerLogs, so the hub neither
  // prints "You receive:" nor plays the loot ding on top of it (a catch used
  // to be three lines and two cues).
  it('the catch-line key exists and splices the name', () => {
    expect(hasTranslation('hudChrome.gathering.catchLine')).toBe(true);
    expect(t('hudChrome.gathering.catchLine', { name: 'Sunglint Koi' })).toBe(
      'You reel in: Sunglint Koi',
    );
  });

  it('the catch line never regresses into the loot or gather wording families', () => {
    const line = t('hudChrome.gathering.catchLine', { name: 'X' });
    expect(line.startsWith('You receive')).toBe(false);
    expect(line.startsWith('You gather')).toBe(false);
  });

  it('the fishingResult case is wired, quality-colored, and plays only the reel cue', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    const caseStart = source.indexOf("case 'fishingResult'");
    expect(caseStart).toBeGreaterThan(-1);
    const block = source.slice(caseStart, source.indexOf('break;', caseStart));
    expect(block.includes('hudChrome.gathering.catchLine')).toBe(true);
    expect(block.includes('QUALITY_COLOR[ev.quality]')).toBe(true);
    // The reel cue rides this arm and it is the ONLY cue there
    // (the earlier pin excluded every cue; the exact-set form keeps the
    // same third-cue protection while mandating the reel).
    const cueCalls = [...block.matchAll(/audio\.(\w+)\(/g)].map((m) => m[1]);
    expect(cueCalls).toEqual(['fishReel']);
  });

  it('the fishingEmptyHook case self-notes and plays exactly the reel cue (the timed press)', () => {
    // Comment-stripped (the phase 14 QA): the arm's own prose names the
    // self-note and the cue, so a commented-out body satisfied every raw
    // includes/matchAll below.
    const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    const caseStart = source.indexOf("case 'fishingEmptyHook'");
    expect(caseStart).toBeGreaterThan(-1);
    const block = source.slice(caseStart, source.indexOf('break;', caseStart));
    expect(block.includes("showSelfNote(t('hudChrome.gathering.emptyHookNote'))")).toBe(true);
    // Exactly the reel cue: the timing confirmation, and nothing stacking.
    const cueCalls = [...block.matchAll(/audio\.(\w+)\(/g)].map((m) => m[1]);
    expect(cueCalls).toEqual(['fishReel']);
    // The sim's own grey "No fish are biting." line stays the ONLY log line.
    expect(block.includes('this.log(')).toBe(false);
    expect(hasTranslation('hudChrome.gathering.emptyHookNote')).toBe(true);
  });

  it('the fishingEarlyReel case logs the grey teach line and plays no cue (the spam-click fix)', () => {
    // Same comment-stripped idiom as the fishingEmptyHook pin above. The
    // early reel is self-inflicted and free, so it takes the gotAwayLine
    // register exactly: a grey log line, no self-note, and NO cue (a spammer
    // would turn a cue into noise).
    const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    const caseStart = source.indexOf("case 'fishingEarlyReel'");
    expect(caseStart).toBeGreaterThan(-1);
    const block = source.slice(caseStart, source.indexOf('break;', caseStart));
    expect(block.includes("this.log(t('hudChrome.gathering.earlyReelLine'), '#a8a8a8')")).toBe(
      true,
    );
    expect([...block.matchAll(/audio\.(\w+)\(/g)]).toHaveLength(0);
    expect(block.includes('showSelfNote(')).toBe(false);
    expect(hasTranslation('hudChrome.gathering.earlyReelLine')).toBe(true);
  });

  it('the effectDepleted flag renders ONE gated FCT self-note (the last-charge signal)', () => {
    // The phase 14 QA: the HUD arm had no test at all. Same idiom as the
    // fishingEmptyHook pin above: comment-stripped, the note gated on the
    // additive flag, the key real, and no log line doubling the announce
    // (the professions window's charge row is the durable record).
    const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    const caseStart = source.indexOf("case 'gatherResult': {");
    expect(caseStart).toBeGreaterThan(-1);
    const block = source.slice(caseStart, source.indexOf('break;', caseStart));
    const gateAt = block.indexOf('if (ev.effectDepleted) {');
    expect(gateAt).toBeGreaterThan(-1);
    const gated = block.slice(gateAt, block.indexOf('}', gateAt));
    expect(gated).toContain("this.showSelfNote(t('hudChrome.professions.toolEffectDepleted'));");
    expect(gated).not.toContain('this.log(');
    expect(hasTranslation('hudChrome.professions.toolEffectDepleted')).toBe(true);
  });

  it('every gathering profession id has a catalog label in the shared name table', () => {
    // The label map is string-keyed (an id with no key renders no row), so tsc
    // does not force exhaustiveness. This is the tripwire a future fifth
    // gathering profession trips instead: its id must carry the catalog key or
    // the row silently vanishes from every surface that names a profession.
    //
    // Re-pointed when the table was extracted: char_window.ts and
    // professions_window.ts each held a byte-identical private copy, and the
    // locked vendor row was the third consumer, so the one table now lives in
    // gathering_profession_name.ts. This arm reads the REAL map rather than
    // scanning the two window sources for the key string, which is both
    // stronger (a source scan passes on a key that appears only in a comment,
    // or on an entry mapped to the wrong value) and no longer coupled to which
    // file the table happens to sit in.
    for (const id of GATHERING_PROFESSION_IDS) {
      const key = `hudChrome.gathering.${id}`;
      expect(hasTranslation(key as Parameters<typeof hasTranslation>[0]), key).toBe(true);
      expect(GATHERING_PROFESSION_NAME_KEYS[id], `name key for ${id}`).toBe(key);
    }
    // No extra ids: an entry for a profession that no longer exists would
    // render a label for a row nothing produces.
    expect(Object.keys(GATHERING_PROFESSION_NAME_KEYS).sort()).toEqual(
      [...GATHERING_PROFESSION_IDS].sort(),
    );
  });

  it('both profession windows read the shared name table rather than a private copy', () => {
    // The half the map read above cannot see: a window that re-privatises its
    // own copy would keep passing the exhaustiveness arm while drifting from
    // it. Comments are stripped first, so the import cannot be satisfied by a
    // mention in prose.
    const withoutComments = (file: string) =>
      readFileSync(path.resolve(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // Trailing comments too, not just whole lines: a `// ... KEYS` tail
        // would otherwise satisfy the positive check below on its own. The
        // strip is context-free, so a string literal containing whitespace
        // then `//` would be truncated; verified absent in the files below,
        // and a URL's `//` follows a colon, so it is never matched.
        .replace(/(^|\s)\/\/.*$/gm, '$1');
    for (const file of [
      'src/ui/char_window.ts',
      'src/ui/professions_window.ts',
      // The third consumer, which is why the table was extracted at all.
      'src/ui/hud/vendor/vendor_window.ts',
    ]) {
      const source = withoutComments(file);
      // Either spelling reads the ONE shared table: the raw map (behind an
      // Object.hasOwn guard at the call site) or the hasOwn-safe getter the
      // whole-branch review extracted beside it.
      expect(
        source.includes('GATHERING_PROFESSION_NAME_KEYS') ||
          source.includes('gatheringProfessionNameKey('),
        `${file} consumes the table`,
      ).toBe(true);
      expect(source.includes("hudChrome.gathering.mining'"), `${file} has no private copy`).toBe(
        false,
      );
    }
  });
});
