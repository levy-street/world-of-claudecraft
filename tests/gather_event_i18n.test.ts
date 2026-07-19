import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasTranslation, t } from '../src/ui/i18n';

// Phase 4 gather-event localization: the sim emits ids plus values only
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
    // Phase 4 review regression this pin guards).
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
