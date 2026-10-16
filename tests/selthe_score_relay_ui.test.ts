import { describe, expect, it } from 'vitest';
import {
  moonTileTemplate,
  SELTHE_SCORE,
  SELTHE_SCORE_ANSWER,
  SELTHE_SCORE_WARD,
  SELTHE_SPENT_VOICE,
} from '../src/sim/encounters/drowned_temple/ids';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import {
  buildTempleAlertView,
  TEMPLE_ALERT_KINDS,
  type TempleAlertScene,
} from '../src/ui/hud/dungeon/temple_alert_view';
import { setLanguage, t } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

setLanguage('en');

const spent = { id: SELTHE_SPENT_VOICE };

function scene(dark = false): TempleAlertScene {
  return {
    selthe: {
      castingAbility: SELTHE_SCORE_ANSWER,
      castRemaining: 7,
      castTotal: 14,
      auras: [{ id: SELTHE_SCORE_WARD, value2: dark ? 1 : 0, stacks: 3 }],
    },
    tiles: [
      { templateId: moonTileTemplate('done', 1) },
      { templateId: moonTileTemplate('next', 2), pos: { x: 0, z: 0 } },
    ],
  };
}

describe('Selthe Score relay personal instructions', () => {
  it.each([false, true])(
    'prioritizes the blocked player without revealing a tile, dark=%s',
    (dark) => {
      const input = scene(dark);
      input.tiles = [...input.tiles, { templateId: moonTileTemplate('sour') }];
      const view = buildTempleAlertView({
        scene: input,
        selfPos: { x: 0, z: 0 },
        auras: [spent],
      });
      expect(view.visible).toBe(true);
      if (!view.visible) return;
      expect(view.kind).toBe('score-spent');
      expect(TEMPLE_ALERT_KINDS).toContain(view.kind);
      expect(view.title).toBe(t('hudChrome.templeAlert.spentTitle'));
      expect(view.line).toBe(t('hudChrome.templeAlert.spentLine', { done: '1', total: '3' }));
      expect(view.line).not.toContain('2');
      expect(view.line).toContain('next correct note');
      expect(view.progress).toBe(0.5);
      expect(view.progressAria).toBe(t('hudChrome.templeAlert.timeAria', { seconds: '7' }));
      expect(view.pressable).toBe(false);
    },
  );

  it('returns to the step-off instruction when the aura is removed', () => {
    const input = { scene: scene(), selfPos: { x: 0, z: 0 } };
    const blocked = buildTempleAlertView({ ...input, auras: [spent] });
    expect(blocked.visible && blocked.kind).toBe('score-spent');
    const released = buildTempleAlertView({ ...input, auras: [] });
    expect(released.visible && released.kind).toBe('score-step-off');
  });

  it('never shows the blocked answer during the melody or after the Score', () => {
    const input = scene();
    if (!input.selthe) throw new Error('missing Selthe fixture');
    input.selthe.castingAbility = SELTHE_SCORE;
    const melody = buildTempleAlertView({ scene: input, auras: [spent] });
    expect(melody.visible && melody.kind).toBe('score-melody');
    input.selthe.castingAbility = null;
    expect(buildTempleAlertView({ scene: input, auras: [spent] }).visible).toBe(false);
  });

  it('describes the relay rule instead of reporting a zero-percent damage increase', () => {
    const descriptor = auraEffectDescriptor({
      id: SELTHE_SPENT_VOICE,
      kind: 'vulnerability',
      value: 0,
    });
    expect(descriptor).toEqual({ key: 'hudChrome.auraEffect.temple.spentVoice' });
    const text = t('hudChrome.auraEffect.temple.spentVoice');
    expect(text).toContain('another player sounds the next correct note');
    expect(text).toContain('does not reset the answer or hurt you');
    expect(text).toContain('Cannot be dispelled');
    expect(text).toContain('only living player in your instance');
    expect(text).toContain('Score ends');
    expect(text).not.toMatch(/slow|%/i);
    // English uses the source text; null means no localization substitution.
    expect(localizeSimText('Spent Voice')).toBeNull();
  });
});
