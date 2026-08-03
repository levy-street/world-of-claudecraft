// The map tooltip's quest-marker tag table (src/ui/quest_marker_tags.ts) and
// the two questUi.log status keys phase 23 minted for it. Pure Node: the
// table is what hud.ts's questGiverTooltipHtml renders through, so pinning
// the mapping plus the resolved English here is what makes the tooltip tags
// a tested behavior rather than an inlined string soup.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { t } from '../src/ui/i18n';
import { questMarkerTooltipTag } from '../src/ui/quest_marker_tags';

describe('questMarkerTooltipTag', () => {
  it('maps each map-drawn kind to its status class and key, untagged for the plain offer', () => {
    expect(questMarkerTooltipTag('ready')).toEqual({
      cls: 'quest-complete',
      key: 'questUi.log.readyStatus',
    });
    expect(questMarkerTooltipTag('repeat')).toEqual({
      cls: 'quest-repeat',
      key: 'questUi.log.repeatableStatus',
    });
    expect(questMarkerTooltipTag('cooldown')).toEqual({
      cls: 'quest-cooldown',
      key: 'questUi.log.cooldownStatus',
    });
    // The plain available offer has always rendered untagged on the map.
    expect(questMarkerTooltipTag('available')).toBeNull();
  });

  it('resolves the three status keys to the exact English tags', () => {
    // The two new keys are load-bearing for the tooltip; the exact values
    // pin them against a silent rename or an accidental reword (the
    // ready tag rides along so the family stays pinned together).
    expect(t('questUi.log.readyStatus')).toBe('Complete');
    expect(t('questUi.log.repeatableStatus')).toBe('Repeatable');
    expect(t('questUi.log.cooldownStatus')).toBe('Available again soon');
  });

  it('resolves the gossip aria for the repeatable row to its exact English', () => {
    expect(t('questUi.dialog.repeatableQuestAria', { name: 'Forge Orders' })).toBe(
      'Repeatable quest: Forge Orders',
    );
  });

  it('is what the map tooltip actually renders through (the wiring pin)', () => {
    // The mapping above is worthless if hud.ts quietly reverts to inlined
    // strings: pin the LIVE call and the class emission, comments stripped so
    // a commented-out call cannot satisfy either arm (the raw-source rule).
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(hud).toContain('questMarkerTooltipTag(ref.kind)');
    expect(hud).toContain('<span class="${tag.cls}">');
    expect(hud).toContain('esc(t(tag.key))');
  });
});
