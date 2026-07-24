import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATHERING_PROFESSION_IDS } from '../src/sim/content/professions';
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

  it('the gather line never regresses into the loot-family "You receive:" wording', () => {
    // The grant hub's own 'loot' SimEvent already renders "You receive:" and
    // plays the loot cue for every harvest grant; the gatherResult line exists
    // ON TOP of it as the rarity-colored gather summary. Rewording it back to
    // the loot family would print two near-identical lines per harvest (the
    // double-log regression this pin guards).
    expect(t('hudChrome.gathering.gatherLine', { name: 'X' }).startsWith('You receive')).toBe(
      false,
    );
    expect(
      t('hudChrome.gathering.gatherLineQty', { name: 'X', qty: 2 }).startsWith('You receive'),
    ).toBe(false);
    expect(t('hud.logs.lootReceiveItem', { item: 'X' }).startsWith('You receive')).toBe(true);
  });
});

describe('hud event switch stays wired to the ids', () => {
  it('hud.ts references every gather-event key the sim ids resolve to', () => {
    // Source liveness pin (the S3-scan spirit): the flavor-to-key mapping and
    // the gather-line keys live in the hud.ts event switch; losing one silently
    // would strand the id-based event without player-visible text.
    const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
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
  // splice, diverge from BOTH the loot family and the gather family (the
  // grant hub still prints "You receive:" for the same catch), stay wired in
  // the hud switch, and color by item quality. The arm plays
  // exactly the reel cue (the landed-reel splash/crank), never the loot
  // notification the grant hub already owns (the double-log trap).
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

  it('every gathering profession id has a catalog label and both window rows', () => {
    // The label maps in char_window.ts and professions_window.ts are
    // string-keyed (an id with no key renders no row), so tsc no longer
    // forces exhaustiveness. This is the tripwire a future fifth gathering
    // profession trips instead: its id must have the catalog key and a row
    // in BOTH name-key maps, or the row silently vanishes from the windows.
    const charSource = readFileSync(path.resolve(process.cwd(), 'src/ui/char_window.ts'), 'utf8');
    const wheelSource = readFileSync(
      path.resolve(process.cwd(), 'src/ui/professions_window.ts'),
      'utf8',
    );
    for (const id of GATHERING_PROFESSION_IDS) {
      const key = `hudChrome.gathering.${id}`;
      expect(hasTranslation(key as Parameters<typeof hasTranslation>[0]), key).toBe(true);
      expect(charSource.includes(key), `char_window ${key}`).toBe(true);
      expect(wheelSource.includes(key), `professions_window ${key}`).toBe(true);
    }
  });
});
